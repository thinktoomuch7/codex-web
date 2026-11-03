# codex-gateway Specification

## Purpose

让服务器上的网关成为 Codex 的唯一长期客户端，使任务、审批和会话在浏览器断开后仍然存在。

## Requirements

### Requirement: Browser disconnect does not stop the agent

系统 SHALL 在浏览器连接断开后继续保留 app-server 进程和正在执行的 turn。

#### Scenario: Browser closes during a turn

- **WHEN** 一个 turn 正在执行且浏览器连接断开
- **THEN** app-server 进程仍在运行且该 turn 不被系统主动中断

### Requirement: Different threads can run at the same time

系统 SHALL 允许不同会话上的 turn 同时处于执行中或等待审批。浏览器断开 SHALL 不停掉其中任何一条。

#### Scenario: Second project thread starts while another runs

- **WHEN** 会话 A 的任务为 `running` 或 `waiting_approval`，且操作者在同一项目的会话 B 上发起 turn
- **THEN** 会话 B 的 turn 开始，且会话 A 的任务继续

### Requirement: One thread has one active turn

系统 SHALL 在一条会话已有 `running` 或 `waiting_approval` 的 turn 时，不为该会话再启动一个 turn。此期间发给该会话的下一条文本 SHALL 进入这条会话的队列。队列 SHALL 在该轮完成或失败后才开始下一条。停止或进程重启 SHALL 不自动开始队列。

#### Scenario: Send again on the busy thread

- **WHEN** 会话 A 正在执行或等待审批，且操作者再向 A 发送文本
- **THEN** 系统不在 A 上启动第二个 turn，且该文本留在 A 的队列中

#### Scenario: Queue starts after the turn finishes

- **WHEN** 会话 A 的当前 turn 完成或失败，且 A 的队列里还有文本
- **THEN** 系统用队列中的下一条文本在 A 上启动下一轮

#### Scenario: Stop does not start the queue

- **WHEN** 操作者停止会话 A 的当前 turn，且 A 的队列里还有文本
- **THEN** 该 turn 变为 `interrupted`，且队列中的文本不自动启动

#### Scenario: Restart does not start the queue

- **WHEN** 网关进程退出时一条会话仍有活动 turn，且该会话的队列里还有文本
- **THEN** 活动回合变为 `interrupted`，且队列中的文本不自动启动

### Requirement: A thread runs one turn at a time

系统 SHALL 允许不同会话同时执行。同一条会话在已有执行中或等待审批的 turn 时，新的文本 SHALL 进入该会话的队列，SHALL 不并列开启第二轮。队列 SHALL 在该轮结束或失败后才开始下一条。停止 SHALL 不自动开始队列。

#### Scenario: Second turn while one is running

- **WHEN** 一条会话正在执行，操作者向同一条会话再发送文本，同时另一条会话处于空闲
- **THEN** 同一条会话的新文本进入队列，另一条会话可以开始自己的 turn

### Requirement: Project directory is a path the server can use

系统 SHALL 接受进程可以读取的目录作为项目和会话工作目录，并 SHALL 在进程可以写入的父目录下创建新目录。系统 SHALL 不因路径位于配置根之外而拒绝。浏览器提交的路径 SHALL 由网关解析后再使用。

#### Scenario: Path outside the root

- **WHEN** 操作者提交一个配置根之外、且进程可以读取的目录
- **THEN** 系统登记该目录并可以在其中启动会话

#### Scenario: Create a child directory

- **WHEN** 操作者要求在一个进程可以写入的目录下新建子目录
- **THEN** 系统创建该子目录并返回它的路径

### Requirement: Files git and terminal stay on the selected directory

系统 SHALL 只对当前项目、其 worktree 或该会话已记录的工作目录提供列目录、读取、上传、Git 和终端。未打开该项目的会话时，列目录 SHALL 使用所选项目目录。终端命令 SHALL 在该目录执行，SHALL 不通过模型转发。

#### Scenario: List the session directory

- **WHEN** 操作者打开一条会话的文件列表，且该会话属于当前项目
- **THEN** 系统返回该会话工作目录中的条目

#### Scenario: List the selected project without a session

- **WHEN** 操作者选中一个项目，且没有打开该项目下的会话
- **THEN** 系统返回该项目目录中的条目

#### Scenario: Reject a path outside the selected directory

- **WHEN** 操作者请求读取一条不在该会话或当前项目目录内的路径
- **THEN** 系统拒绝该请求

### Requirement: Worktree is created beside the repository

系统 SHALL 在 Git 仓库根旁创建 worktree，路径为 `<仓库名>-worktrees/<分支名>`。新会话 SHALL 可以使用该检出。已有会话 SHALL 保留自己的工作目录。非仓库目录 SHALL 不提供 worktree。

#### Scenario: Create a worktree from the repository root

- **WHEN** 操作者在一个 Git 仓库根上新建 worktree 并给出分支名
- **THEN** 系统在仓库旁边的 `<仓库名>-worktrees/<分支名>` 创建检出，并可以在其中开始会话

### Requirement: Approval survives disconnect

系统 SHALL 保存尚未回答的审批，并允许之后重新连接的浏览器提交决定。

#### Scenario: Reconnect while waiting for approval

- **WHEN** turn 正在等待审批且浏览器已经断开，另一连接再次打开该会话
- **THEN** 系统显示同一条未决审批且接受对该审批的决定

### Requirement: Reconnect restores persisted and in-progress events

系统 SHALL 在重新连接时先提供官方已落盘的会话记录，再提供尚未落盘的进行中输出。

#### Scenario: Reconnect during streaming

- **WHEN** 操作者在 turn 输出过程中断开并再次连接
- **THEN** 系统展示断开前已落盘的记录以及仍在进行的输出

### Requirement: App-server crash is recoverable by a person

系统 SHALL 在 app-server 进程消失后把执行中的任务标为 `interrupted`，保留已落盘记录，且不自动重放该 turn。

#### Scenario: Process exits mid-turn

- **WHEN** app-server 在 turn 未完成时退出并随后被重新拉起
- **THEN** 任务状态为 `interrupted` 且操作者可以在原会话上继续

### Requirement: Session list includes gateway-created threads

系统 SHALL 列出由本平台创建的 app-server 会话，而不是只列出其他客户端来源的会话。工作目录是 worktree 的会话 SHALL 归在它所属的已登记项目下，而不是从该项目的列表中消失。

#### Scenario: List after creating a thread

- **WHEN** 操作者通过本平台创建会话后查看列表
- **THEN** 该会话出现在列表中

#### Scenario: List a worktree thread under its project

- **WHEN** 操作者打开一个已登记项目，且该项目有一条工作目录落在独立 worktree 上的会话
- **THEN** 这条会话出现在该项目的列表中

### Requirement: Running thread cannot be deleted

系统 SHALL 拒绝删除仍有 `running` 或 `waiting_approval` 任务的会话，并保留其工作目录。

#### Scenario: Delete while the thread is running

- **WHEN** 操作者删除一条正在执行或等待审批的会话
- **THEN** 系统拒绝删除，且该会话及其检出仍在

### Requirement: Git project thread defaults to its own worktree

系统 SHALL 在操作者于 Git 仓库项目中新建会话且未另选目录方式时，为该会话创建独立 worktree，并把该 worktree 作为这条会话的工作目录。操作者显式选择直接修改项目目录时，系统 SHALL 使用已登记的项目路径。项目路径不是 Git 仓库时，系统 SHALL 不创建 worktree，并使用该项目路径。

#### Scenario: Default new thread in a git project

- **WHEN** 操作者在已登记的 Git 仓库项目中新建会话，且没有选择目录方式
- **THEN** 该会话的工作目录是一份新 worktree，位于仓库旁边的 `<仓库名>-worktrees/<分支名>`，不在该仓库里面，也不在其他已登记项目里面，并且该会话列在这个项目下

#### Scenario: Operator chooses the project directory

- **WHEN** 操作者新建会话时选择直接修改项目目录
- **THEN** 该会话的工作目录是已登记的项目路径

#### Scenario: Project path is not a git repository

- **WHEN** 操作者在不是 Git 仓库的已登记目录中新建会话
- **THEN** 系统不创建 worktree，且会话工作目录就是该目录

### Requirement: Deleting a thread removes its worktree

系统 SHALL 在删除一条带有 worktree 且当前没有活动 turn 的会话时，删掉该会话并移除其 worktree。归档 SHALL 不删除 worktree。

#### Scenario: Delete an idle worktree thread

- **WHEN** 操作者删除一条没有活动 turn、且工作目录是 worktree 的会话
- **THEN** 该会话从项目列表消失，且该 worktree 目录被移除

#### Scenario: Archive keeps the worktree

- **WHEN** 操作者归档一条带有 worktree 的会话
- **THEN** 该会话离开项目的默认列表，且 worktree 目录仍在

### Requirement: Thread title is short and editable

系统 SHALL 为每条会话保存短标题。列表中的标题 SHALL 不是第一条用户提示的全文。操作者 SHALL 能改这个短标题，且改名不改变已有对话记录。

#### Scenario: Long first prompt gets a short title

- **WHEN** 操作者用一句长提示开始新会话，随后查看项目列表
- **THEN** 列表中的标题是短标题，且这句长提示仍作为对话中的第一条用户消息存在

#### Scenario: Rename keeps the transcript

- **WHEN** 操作者把一条已有会话改名
- **THEN** 列表显示新名字，且原有对话记录仍在

### Requirement: Thread can be archived and forked

系统 SHALL 允许归档会话、取消归档，以及从一条会话分叉出新会话。分叉 SHALL 保留原会话。原项目是 Git 仓库时，分叉出的新会话 SHALL 使用自己的 worktree，路径在仓库旁边。

#### Scenario: Unarchive returns the thread

- **WHEN** 操作者取消归档一条此前被归档的会话
- **THEN** 该会话重新出现在项目的默认列表中

#### Scenario: Fork leaves the original intact

- **WHEN** 操作者分叉一条已有对话的会话，且该项目是 Git 仓库
- **THEN** 原会话仍在，新会话带有分叉前的对话记录，且新会话的工作目录是另一份 worktree

### Requirement: Approval can allow the rest of the thread

系统 SHALL 接受「允许这一次」「这一会话都允许」和「拒绝」。选择「这一会话都允许」后，本会话后续同类审批 SHALL 不再询问。命令审批与文件变更审批 SHALL 分开计算。

#### Scenario: Allow once asks again later

- **WHEN** 操作者对一条命令审批选择允许这一次，且同一会话稍后再次请求命令审批
- **THEN** 系统再次展示未决审批

#### Scenario: Allow for the thread skips the same kind

- **WHEN** 操作者对一条命令审批选择这一会话都允许，且同一会话稍后再次请求命令审批
- **THEN** 系统接受该后续命令审批且不再询问

#### Scenario: File approval stays separate

- **WHEN** 操作者已经对本会话的命令审批选择这一会话都允许，且随后出现文件变更审批
- **THEN** 系统仍展示这条文件变更审批

### Requirement: Operator can choose model and thread policy

系统 SHALL 列出当前 Codex 账号可用的模型，并在该会话后续 turn 上使用操作者选定的模型。系统 SHALL 允许为一条会话设置沙箱和审批策略，且该会话的后续 turn 使用这条会话上的设置。尚未设置时，系统 SHALL 不在开启会话时替操作者指定沙箱或审批策略。

#### Scenario: Selected model is used on the next turn

- **WHEN** 操作者为一条会话选定一个可用模型后再发送文本
- **THEN** 该 turn 使用这个模型

#### Scenario: Thread policy applies to the next turn

- **WHEN** 操作者把一条会话的沙箱或审批策略改成另一档后再发送文本
- **THEN** 该 turn 使用改后的策略

#### Scenario: Unset policy is left to Codex

- **WHEN** 操作者没有改过一条会话的沙箱和审批策略就发送文本
- **THEN** 系统不为该会话指定沙箱或审批策略

### Requirement: Operator can review and publish git changes

系统 SHALL 对会话工作目录中的 Git 变更提供查看 diff、暂存、还原指定文件或片段、提交和推送。系统 SHALL 为该检出的当前分支创建 pull request，并返回结果地址或失败原因。工作目录不是 Git 仓库时，系统 SHALL 拒绝这些操作。

#### Scenario: Review the thread checkout

- **WHEN** 操作者查看一条 Git 工作目录上的变更
- **THEN** 系统返回该目录里尚未提交的 diff

#### Scenario: Create a pull request

- **WHEN** 操作者要求为该检出的当前分支创建 pull request
- **THEN** 系统返回 pull request 的地址，或返回失败原因且不谎报成功

#### Scenario: Git action on a plain directory

- **WHEN** 操作者对不是 Git 仓库的会话工作目录要求提交
- **THEN** 系统拒绝该操作

### Requirement: Browser cannot send raw engine methods

系统 SHALL 只接受白名单内的会话、turn 和审批操作，并拒绝浏览器直接提交任意引擎方法。

#### Scenario: Raw method from the browser

- **WHEN** 浏览器提交一个不在白名单内的引擎方法
- **THEN** 系统拒绝该请求且不把它转发给 app-server

### Requirement: Missing Codex login does not start a turn

系统 SHALL 在 Codex 账号未登录时拒绝启动 turn，并报告未登录。

#### Scenario: Turn requested before login

- **WHEN** 账号未登录且操作者请求启动 turn
- **THEN** 系统不启动 turn 并表明需要先登录 Codex

### Requirement: Recent threads span registered projects

系统 SHALL 提供跨已登记项目的最近会话列表。每条 SHALL 包含会话标识、短标题、所属项目名和最近活动。列表 SHALL 按最近活动从新到旧排列，SHALL 不包含日期分组字段。默认列表 SHALL 排除已归档会话。浏览器 SHALL 不能用该列表传入任意工作目录。

#### Scenario: Two projects appear together

- **WHEN** 两个已登记项目各自有一条未归档会话，且其中一条活动更近
- **THEN** 最近列表同时返回这两条，较新的在前，并各自带有项目名

#### Scenario: A text fragment does not rebuild the list

- **WHEN** 一条会话正在输出正文片段
- **THEN** 系统不为这个片段向引擎重新列出全部会话

### Requirement: Text fragments do not reread the transcript

系统 SHALL 在会话初次打开时提供当前可见记录。其后的助手正文增量 SHALL 只包含新出现的片段。系统 SHALL 不为每个片段重新读取整份已落盘时间线。重新连接时 SHALL 仍先给出已有记录，再继续接收新片段。

#### Scenario: Fragment during a turn

- **WHEN** 引擎发出一段助手正文，且浏览器已经连着这条会话
- **THEN** 该连接收到的是这段新文字，而不是整份时间线

#### Scenario: Reconnect during streaming

- **WHEN** 操作者在正文输出过程中断开并再次连接
- **THEN** 系统先提供断开前已有的记录，随后的增量仍只包含新片段
