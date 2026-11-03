# Spec Delta

## REMOVED Requirements

### Requirement: Only one turn executes at a time

**Reason**: 操作者需要多条会话同时执行。全机一把锁会拒绝另一条会话上的合法 turn。
**Migration**: 只拒绝同一条会话上的第二个 turn。其他会话的 turn 可以同时处于 `running` 或 `waiting_approval`。

## MODIFIED Requirements

### Requirement: Project directory stays inside configured roots

系统 SHALL 只允许已登记且解析后仍位于配置根目录内的路径作为操作者提交的项目路径。会话工作目录 SHALL 要么是这个已登记路径，要么是网关为该项目分配的 worktree。浏览器 SHALL 不能提交任意工作目录。

#### Scenario: Path outside the root

- **WHEN** 操作者提交一个解析后不在配置根目录内的项目路径
- **THEN** 系统拒绝登记或启动该路径上的会话

#### Scenario: Browser picks a working directory

- **WHEN** 浏览器在启动会话时自行指定一个工作目录
- **THEN** 系统忽略该路径，只使用已登记项目路径或网关分配的 worktree

### Requirement: Session list includes gateway-created threads

系统 SHALL 列出由本平台创建的 app-server 会话，而不是只列出其他客户端来源的会话。工作目录是 worktree 的会话 SHALL 归在它所属的已登记项目下，而不是从该项目的列表中消失。

#### Scenario: List after creating a thread

- **WHEN** 操作者通过本平台创建会话后查看列表
- **THEN** 该会话出现在列表中

#### Scenario: List a worktree thread under its project

- **WHEN** 操作者打开一个已登记项目，且该项目有一条工作目录落在独立 worktree 上的会话
- **THEN** 这条会话出现在该项目的列表中

## ADDED Requirements

### Requirement: Different threads can run at the same time

系统 SHALL 允许不同会话上的 turn 同时处于执行中或等待审批。浏览器断开 SHALL 不停掉其中任何一条。

#### Scenario: Second project thread starts while another runs

- **WHEN** 会话 A 的任务为 `running` 或 `waiting_approval`，且操作者在同一项目的会话 B 上发起 turn
- **THEN** 会话 B 的 turn 开始，且会话 A 的任务继续

### Requirement: One thread has one active turn

系统 SHALL 在一条会话已有 `running` 或 `waiting_approval` 的 turn 时，不为该会话再启动一个 turn。此期间发给该会话的下一条文本 SHALL 进入这条会话的队列。

#### Scenario: Send again on the busy thread

- **WHEN** 会话 A 正在执行或等待审批，且操作者再向 A 发送文本
- **THEN** 系统不在 A 上启动第二个 turn，且该文本留在 A 的队列中

#### Scenario: Queue starts after the turn finishes

- **WHEN** 会话 A 的当前 turn 完成或失败，且 A 的队列里还有文本
- **THEN** 系统用队列中的下一条文本在 A 上启动下一轮

#### Scenario: Stop does not start the queue

- **WHEN** 操作者停止会话 A 的当前 turn，且 A 的队列里还有文本
- **THEN** 该 turn 变为 `interrupted`，且队列中的文本不自动启动

### Requirement: Running thread cannot be deleted

系统 SHALL 拒绝删除仍有 `running` 或 `waiting_approval` 任务的会话，并保留其工作目录。

#### Scenario: Delete while the thread is running

- **WHEN** 操作者删除一条正在执行或等待审批的会话
- **THEN** 系统拒绝删除，且该会话及其检出仍在

### Requirement: Git project thread defaults to its own worktree

系统 SHALL 在操作者于 Git 仓库项目中新建会话且未另选目录方式时，为该会话创建独立 worktree，并把该 worktree 作为这条会话的工作目录。操作者显式选择直接修改项目目录时，系统 SHALL 使用已登记的项目路径。项目路径不是 Git 仓库时，系统 SHALL 不创建 worktree，并使用该项目路径。

#### Scenario: Default new thread in a git project

- **WHEN** 操作者在已登记的 Git 仓库项目中新建会话，且没有选择目录方式
- **THEN** 该会话的工作目录是一份新 worktree，位于数据目录中的 worktree 根下，不在该仓库里面，也不在其他已登记项目里面，并且该会话列在这个项目下

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

系统 SHALL 允许归档会话、取消归档，以及从一条会话分叉出新会话。分叉 SHALL 保留原会话。原项目是 Git 仓库时，分叉出的新会话 SHALL 使用自己的 worktree。

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

系统 SHALL 列出当前 Codex 账号可用的模型，并在该会话后续 turn 上使用操作者选定的模型。系统 SHALL 允许为一条会话设置沙箱和审批策略，且该会话的后续 turn 使用这条会话上的设置。

#### Scenario: Selected model is used on the next turn

- **WHEN** 操作者为一条会话选定一个可用模型后再发送文本
- **THEN** 该 turn 使用这个模型

#### Scenario: Thread policy applies to the next turn

- **WHEN** 操作者把一条会话的沙箱或审批策略改成另一档后再发送文本
- **THEN** 该 turn 使用改后的策略

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
