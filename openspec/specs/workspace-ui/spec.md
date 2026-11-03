# workspace-ui Specification

## Purpose

让操作者在浏览器里查看已登记项目和会话、发送对话、跟随执行过程，并在同一页面处理审批或停止任务。

## Requirements

### Requirement: Workspace shows projects and threads

系统 SHALL 按侧栏展示最近会话和按项目归组的会话。最近列表 SHALL 按最近活动从新到旧排列，SHALL 不按日期分组，每条 SHALL 显示短标题和项目名。项目组 SHALL 可以新建会话、改名、置顶、归档、恢复、分叉、删除，并按标题搜索。第一条提示的全文 SHALL 不放在侧栏。

#### Scenario: Open a project

- **WHEN** 已登录的操作者打开工作区，且两个项目各自有会话
- **THEN** 最近列表同时显示这两条会话，每条带有项目名，按最近活动排列，且没有今天或昨天这样的分组

#### Scenario: Thread title is not the whole prompt

- **WHEN** 一条会话的第一条用户消息是长提示
- **THEN** 侧栏显示短标题和项目名，对话里仍能看到这句原文

### Requirement: Operator can send and stop a turn

系统 SHALL 让操作者从底部输入框发送对话，并在输入框旁选择模型。Codex 已登录且当前会话没有活动 turn 时，发送 SHALL 开始这一轮。当前会话已有活动 turn 时，再发送的文本 SHALL 进入这条会话的队列，输入位置 SHALL 变为停止。停止 SHALL 只作用于当前打开的会话。队列 SHALL 在该轮结束或失败后才开始。

#### Scenario: Send a message

- **WHEN** Codex 已登录、当前会话没有活动 turn，且操作者在输入框发送一条文本
- **THEN** 系统开始这一轮，页面显示其执行状态，且不要求其他会话处于空闲

#### Scenario: Send while this thread runs

- **WHEN** 当前会话已有活动 turn，且操作者再发送一条文本
- **THEN** 页面表明该文本已排队，且当前 turn 仍是原来的那一轮

#### Scenario: Stop the active turn

- **WHEN** 当前会话正在执行且操作者按下停止
- **THEN** 系统请求中断该会话的 turn，页面把该会话显示为已停止，且其他正在执行的会话继续

### Requirement: Live activity stays on the server timeline

系统 SHALL 在同一栏对话里显示用户消息、助手 Markdown、可折叠的思考、工具调用和文件变更。助手正文 SHALL 在条目完成之前按新片段追加。未决审批 SHALL 留在产生它的回合里。当前回合进行时，顶栏 SHALL 显示这一轮已经过去的时间。操作者 SHALL 可以向上继续查看更早的记录。

#### Scenario: Command runs during a turn

- **WHEN** 活动 turn 产生工具或命令执行
- **THEN** 页面在这一栏里显示该工具调用及其进行状态，操作者可以展开查看输出

#### Scenario: Text arrives in fragments

- **WHEN** 助手正文陆续到来
- **THEN** 页面把每个新片段追加到正在增长的正文上，且不因该片段重画整份已加载对话之外的内容

#### Scenario: File change stays in the turn

- **WHEN** 活动 turn 产生文件变更
- **THEN** 该变更显示在这个回合的对话里

### Requirement: Approval can be answered from the page

系统 SHALL 在产生审批的回合里展示未决审批，并让操作者提交「允许这一次」「这一会话都允许」或「拒绝」。

#### Scenario: Approve a command

- **WHEN** 当前会话的回合里有一条未决命令审批，且操作者选择允许这一次
- **THEN** 系统把该决定提交给正在等待的 turn

#### Scenario: Approve for the rest of the thread

- **WHEN** 当前会话的回合里有一条未决命令审批，且操作者选择这一会话都允许
- **THEN** 系统提交该决定，且本会话后续同类审批不再在页面上询问

### Requirement: Unsigned Codex account is visible

系统 SHALL 在 Codex 账号未登录时明确显示未登录，并且不把失败伪装成已开始的任务。

#### Scenario: Open the workspace before Codex login

- **WHEN** 操作者已登录网页但 Codex 账号未登录
- **THEN** 页面显示 Codex 未登录且不出现一个新的执行中任务

### Requirement: Secondary controls open only when asked

系统 SHALL 把文件、Git 和终端放在各自的页面里。模型 SHALL 放在输入框旁。改名、归档、分叉和删除 SHALL 放在该会话自己的菜单里。沙箱、审批策略和查找 SHALL 放在设置里。官方 Codex 没有交给网页的控件 SHALL 不出现。

#### Scenario: Open the workspace

- **WHEN** 操作者打开一条已有会话
- **THEN** 画面上有侧栏、同一栏对话和输入框，模型在输入框旁，删除在该会话的菜单里

#### Scenario: Open settings while text is arriving

- **WHEN** 正文正在增长且操作者没有打开文件、Git 或终端页面
- **THEN** 页面不为该片段重画这些页面

### Requirement: A long transcript draws a recent window

系统 SHALL 在对话很长时只绘制最近的一段。更早的内容 SHALL 仍保留在服务器上，操作者要求查看时再载入。

#### Scenario: Thread has more turns than the window

- **WHEN** 一条会话的回合数超过页面一次绘制的窗口
- **THEN** 页面先显示最近的一段，且更早的正文仍可通过继续查看得到

### Requirement: Conversation is the main surface

系统 SHALL 把主区域用于对话。新会话的第一条用户消息 SHALL 是对话中的第一句。回合进行时，发送控件 SHALL 变为停止。

#### Scenario: First message opens the transcript

- **WHEN** 操作者在没有选定已有会话时发送第一条文本
- **THEN** 主区域以这句用户消息作为对话的开头，并显示随后的回合

#### Scenario: Composer shows stop during the turn

- **WHEN** 当前打开的会话有活动 turn
- **THEN** 输入位置显示停止，且该操作只针对这条会话

### Requirement: New thread exposes the directory choice

系统 SHALL 在 Git 仓库项目中新建会话时默认使用单独 worktree，并让操作者改选直接修改项目目录。项目不是 Git 仓库时，系统 SHALL 直接使用该目录，且不提供 worktree 选项。

#### Scenario: Git project shows both choices

- **WHEN** 操作者在 Git 仓库项目中开始新会话
- **THEN** 页面默认选中单独 worktree，并提供直接修改项目目录这一选项

#### Scenario: Plain directory has no worktree choice

- **WHEN** 操作者在不是 Git 仓库的项目中开始新会话
- **THEN** 页面不提供 worktree 选项，且新会话使用该项目目录

### Requirement: Operator can manage the thread from the page

系统 SHALL 让操作者在页面上改名、归档、取消归档、分叉、删除空闲会话，以及在当前对话中查找。正在执行或等待审批的会话 SHALL 不能从页面上删掉。

#### Scenario: Find text in the open thread

- **WHEN** 操作者在当前对话中查找一段已经出现过的文字
- **THEN** 页面标出这段文字所在的位置

#### Scenario: Archive hides the thread from the default list

- **WHEN** 操作者归档当前会话
- **THEN** 该会话离开项目的默认列表，并且仍可被取消归档后再次打开

#### Scenario: Delete control is unavailable while running

- **WHEN** 当前会话正在执行或等待审批
- **THEN** 页面不把这次删除送出去

### Requirement: Model and policy are visible on the thread

系统 SHALL 在输入框旁提供模型选择。沙箱和审批策略 SHALL 放在设置里。未登录 Codex 时，这些选择 SHALL 不可用，且页面仍显示未登录。

#### Scenario: Pick a model for the thread

- **WHEN** Codex 已登录且操作者为当前会话选定一个列出的模型
- **THEN** 页面保持这个选择，直到操作者再次更改

### Requirement: Git review is available from the thread

系统 SHALL 在会话使用 Git 工作目录时，让操作者从该会话查看 diff、暂存、还原、提交、推送和创建 pull request。失败原因 SHALL 显示在页面上。工作目录不是 Git 仓库时，这些操作 SHALL 不可用。

#### Scenario: Open the diff for the thread

- **WHEN** 操作者打开一条 Git 会话的变更
- **THEN** 页面显示该工作目录的 diff

#### Scenario: Failed pull request is visible

- **WHEN** 创建 pull request 失败
- **THEN** 页面显示失败原因，且不显示一个不存在的地址

### Requirement: Directory selection follows the server

系统 SHALL 让操作者浏览进程读得到的目录，并在进程写得到的地方新建目录。选中的目录 SHALL 成为项目和之后新会话的工作目录。

#### Scenario: Choose any readable directory

- **WHEN** 操作者在目录选择里选中一个进程可以读取的目录
- **THEN** 系统登记该目录，且不因为该目录位于某个配置根之外而拒绝

#### Scenario: Create a directory

- **WHEN** 操作者在一个进程可以写入的父目录下新建目录
- **THEN** 系统创建该目录并可以把它登记为项目

### Requirement: Files and terminal follow the current directory

系统 SHALL 在文件页列出当前项目、其 worktree 或这条会话的目录，并可以上传到这个目录。没有打开该项目的会话时，文件页 SHALL 列出所选项目目录。终端页 SHALL 在已打开的会话目录中执行命令。Git 变更 SHALL 来自这个目录。

#### Scenario: Open the file page

- **WHEN** 操作者打开一条会话的文件页
- **THEN** 页面列出该会话目录中的文件，并可以上传到这个目录

#### Scenario: Open the selected project files

- **WHEN** 操作者选中一个项目且没有打开该项目下的会话
- **THEN** 文件页列出该项目目录中的文件

#### Scenario: Open the terminal

- **WHEN** 操作者在一条会话中打开终端并输入命令
- **THEN** 命令在该会话的目录中执行，输出回到这个终端页
