# Design

## Context

网关已经用 stdio 拉起并持有一个 `codex app-server`，浏览器只走白名单 HTTP 和单会话 SSE。`thread/list` 按工作目录过滤，并包含 `appServer` 与 `vscode`。SQLite 只有用户、登录会话、项目、任务和审批，没有对话正文。`startTurnNow` 看到任意 `running` 或 `waiting_approval` 任务就拒绝。审批决定只有 `accept` 和 `decline`。页面把命令和待批从对话里拆出去。见 `proposal.md` 的 Why。

机器仍是 2 核、约 3.8 GiB 内存。网关和 app-server 以 root 运行，Codex 配置是 `sandbox_mode = "danger-full-access"`、`approval_policy = "on-request"`。已登记项目里有一个路径就是 `/srv/projects`，所以 worktree 不能靠「放在项目根目录里、又放在仓库外面」同时满足。

## Goals / Non-Goals

**Goals:**

- 拆掉全机 turn 锁，保留同一条会话一个活动 turn。
- 让 Git 项目的新会话默认得到一份网关分配的 worktree，并仍能显式选中项目目录本身。
- 用现有 SSE 把增量正文、命令和 diff 送进对话，而不是等整段结束再整页重拉。
- 页面按对话重排。线程操作和 Git 操作走白名单，不把浏览器放成任意 JSON-RPC 客户端。

**Non-Goals:**

- 不增加第二个 app-server 进程，也不把官方桌面的语音、听写、本机编辑器和 Codex Cloud 做进来。
- 不改网页登录、监听端口和对外地址。
- 不把 worktree 当成对 systemd、端口或 `/etc` 的隔离。

## Decisions

### 并行发生在同一个 app-server 里

去掉按全表查找活动任务并拒绝的判断。开始 turn 时只检查这条 `thread_id` 是否已有 `running` 或 `waiting_approval`。`enqueue` 继续串行化开轮、审批和删除这些短操作，不等待模型把整轮跑完。停止和删除仍按会话处理。进程退出时，每一条活动任务都标成 `interrupted`，不自动重放，队列里还没开始的文本也不自动开跑。

备选是每个会话一个 app-server。这会多占内存，并让 `CODEX_HOME` 上的锁更难处理，因此不采用。

### worktree 放在数据目录

`worktreeRoot` 固定为 `<dataDir>/worktrees`。新的 Git 会话执行 `git worktree add <worktreeRoot>/<projectId>/<threadId> -b codex/<thread 短号>`，起点是该仓库当前 HEAD。浏览器不传 cwd。路径若落进被检出的仓库或其他已登记项目，就拒绝创建。不是 Git 仓库时不走这条路径。操作者显式选择「直接改这个目录」时，cwd 就是已登记路径。

已有会话没有检出记录，列表时按项目路径上的 `thread/list` 结果视为 `local`。删除带 worktree 的空闲会话时，先 `git worktree remove`，成功后再 `thread/delete`；移除失败则保留会话。归档只调用归档，不删目录。

备选是把检出放在 `/srv/projects` 下面。项目「验收」的路径就是这个根，任何子目录都在它的检出里面，因此不采用。

### 平台表只记位置、队列、授权和标题

新增会话位置（项目、`worktree` 或 `local`、路径、分支）、待发队列、会话级审批授权（命令与文件变更分开）、短标题和模型与策略选择。对话正文继续只读 Codex 会话库。队列在 turn 完成或失败后取出下一条；停止只把当前 turn 标成中断。网关重启后队列还在，但不自动开跑。

列表是项目路径上的 `thread/list`，再加上该项目每条 worktree 路径上的 `thread/list`，按会话 id 合并，用最近活动排序。侧栏标题用短标题；第一条长提示只出现在对话里。先把首行收成短标题写入平台表，若引擎随后给出名字再替换。改名同时写平台表和引擎的改名方法。

### 增量输出沿用现有 SSE

先在 0.166 上确认增量正文的通知名和字段，再把片段追加到该会话的 live item，经现有 SSE 推给打开这条会话的页面。条目完成时仍用落盘记录对齐。没有确认到增量通知之前，不用把整段回复切块冒充流式。侧栏上其他会话的执行中和待审批状态来自任务表；工作区订阅项目级活动，这样不看某条会话时也能看到它在等审批。

### 审批授权记在网关

「允许这一次」仍把 `accept` 交回正在等的那条请求。「这一会话都允许」写入该会话的同类授权，并接受当前请求。之后同类请求到达时，网关直接代答 `accept`，不再发给页面。命令执行和文件变更分两类。未知种类一律询问。拒绝仍是 `decline`。

### 模型、沙箱和 Git 不交给浏览器拼方法

模型列表、改名、归档、取消归档、分叉以 0.166 里实际存在的方法为准，参数先用一次只读探测确认。会话没改过策略时，沿用现在的 `danger-full-access` 和 `on-request`。改过的选择在该会话下一次 `thread/start` 或 `thread/resume` 时传入。

diff、暂存、还原、提交、推送由网关在该会话 cwd 里用参数数组调用 `git`，不经过模型，也不拼 shell 字符串。pull request 调用 `gh`；`gh` 不存在或未登录时，把失败原因返回页面。这些动作加入浏览器白名单。`POST /api/engine` 继续拒绝。

会话内查找在页面已加载的时间线上做，不为此再开一轮 turn。

### 页面换成一条对话

主列是对话和底部输入。活动 turn 时输入位置只有停止。命令、diff 和审批画在对应回合里。侧栏是当前项目的平铺会话，登记项目收在角落。不再保留独立的命令卡片区和待批区。

## Risks / Trade-offs

- [2 核、约 3.8 GiB 上同时跑多轮] → 仍用一个 app-server；不设第二把全机锁。内存吃紧时由操作者停止部分会话，而不是把并行改回拒绝。
- [同一目录上的多条 `local` 会话会互相改文件] → 这是显式选择或非 Git 目录的结果。Git 项目的默认路径是独立 worktree。
- [worktree 隔离不了 systemd 和端口] → 部署仍选「直接改这个目录」，并接受 root 上的命令会作用于整台机器。
- [重启网关会把所有活动 turn 标成中断] → 发布放在没有需要保住的 turn 时。不自动重放。
- [0.166 的方法名和增量通知尚未逐个钉死] → 实现时先探测再接线。探测不到增量通知就停下来说明，不用假流式交差。
- [网页密码等价于 root，Git 推送会用服务器上已有的凭据] → 不在日志或仓库里记录凭据。推送失败只返回错误，不回显密钥。

## Migration Plan

1. 先部署网关和页面，再重启 `codex-web`。重启会使当时还在跑的 turn 变为 `interrupted`。
2. 不迁移对话正文。旧会话在第一次列出时记为 `local`。
3. 回退时换回上一份网关源码和 `web/dist`，再重启。新表可以留着，旧代码不读它们。

## Open Questions

无。方法名以探测结果为准，探测本身写进任务，不改变上面的做法。
