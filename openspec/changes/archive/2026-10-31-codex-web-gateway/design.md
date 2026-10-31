# Design

## Context

仓库是绿场，只有 OpenSpec 骨架。目标服务器是 Ubuntu 24.04.1、glibc 2.39、2 核、约 3.8 GiB 内存、目前没有 swap。本机 mihomo 以规则模式监听 `127.0.0.1:7890`，OpenAI 和 GitHub 已经能通过它到达。见 `proposal.md` 的 Why。

官方 `codex app-server` 用 Unix socket 长驻。stdio 客户端断开时，该进程会退出，所以浏览器不能成为 JSON-RPC 客户端。

## Goals / Non-Goals

**Goals:**

- 网关进程独占一条到 app-server 的连接，浏览器只通过网关的白名单操作。
- 会话历史读官方 thread store，SQLite 只存平台状态。
- 全局同时一个 turn。崩溃后标成中断，由人在原会话继续。
- 在没有 Codex 登录的情况下，程序仍能启动并明确报告未登录。

**Non-Goals:**

- 不实现模型、Agent 循环或社区 Web 项目的功能。
- 不把 mihomo 或订阅配置放进本仓库。
- 不做多用户、多任务并发、Worktree、Git 写入和定时任务。
- 不在编码阶段执行 Codex 设备码登录。

## Decisions

### 网关与 app-server 分成两个 systemd 单元

app-server 使用 `codex app-server --listen unix://...`。网关作为客户端连接该 socket。浏览器 WebSocket 断开只取消订阅。

备选是网关用 stdio 拉起 app-server。stdio 连接一关，官方进程会退出，网关重启会杀掉正在跑的 turn，因此不采用。

### 手写有限协议客户端

只调用会话、turn、审批和账号读取所需的方法。`thread/list` 必须带上 `sourceKinds: ["appServer"]`。启动时核对本机 `codex --version`，不在记录过的版本范围内就拒绝启动。

备选是引入现成客户端库。协议变动会落在别人的发布节奏上，因此不采用。

### SQLite 表

`users`、`sessions`、`projects`、`tasks`、`approvals`。任务状态为 `running`、`waiting_approval`、`completed`、`failed`、`interrupted`。不建会话正文表。

断线补齐：先读官方已落盘条目，再用网关内存中的短缓冲补尚未落盘的 delta。

### 单任务队列

浏览器操作进入网关内部队列，由唯一的 socket 客户端顺序发出。已有 `running` 或 `waiting_approval` 时，新的 `turn/start` 被拒绝。

### 路径与方法白名单

项目路径 `realpath` 后必须落在配置的根目录下。网页不能提交任意 `cwd`，也不能转发原始 JSON-RPC。

### 登录靠后

网关在 `account/read` 显示未登录时保持运行，API 返回未登录，不启动 turn。设备码登录和断开试验是实现完成后的验收，不阻塞前面的代码。

出站访问沿用服务器环境里的 `https_proxy=http://127.0.0.1:7890`，由 app-server 单元继承，不在应用里再写一套代理。

### 技术栈

TypeScript。前端 Vite 与 React。网关 Node.js 22。SQLite 使用本地驱动。网页默认只绑 `127.0.0.1`，远程访问由操作者用 SSH 隧道或 Tailscale 接入。

## Risks / Trade-offs

- [官方协议升级导致方法不兼容] → 锁定已测版本，客户端只覆盖实际调用的方法。
- [无 swap，编译时 OOM] → 全局一个 turn；验收前在服务器上增加约 2GB swap。
- [登录放在最后，断开语义只能到验收时实测] → 设计按文档中的 Unix socket 与 `thread/resume` 实现；验收失败时改进程托管，不先铺开更多界面。
- [代理节点失效会导致验收时模型请求失败] → 验收前用现有 mihomo 控制方式确认 AI 组选中的是真实节点。

## Migration Plan

1. 在仓库中实现网关、前端和配置示例。
2. 服务器上安装 Node.js 22、Codex gnu 包和 bubblewrap，创建专用系统用户。
3. 安装两个 systemd 单元：先 app-server，后网关。网关单元带上本机代理环境变量。
4. 增加约 2GB swap。
5. 用录制事件完成开发自测。
6. 最后做设备码登录和断开试验。

回滚：停止两个单元并保留 `CODEX_HOME` 与 SQLite 文件。不自动重放中断的 turn。

## Open Questions

无。远程入口使用反向隧道还是 Tailscale 不影响规格，部署时在配置里选择绑定地址即可。
