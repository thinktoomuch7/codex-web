# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace shows projects and threads

系统 SHALL 展示已登记项目，以及所选项目下的会话列表。该列表 SHALL 按最近活动排列，SHALL 不按日期分组，并且 SHALL 显示短标题而不是第一条提示的全文。登记项目的入口 SHALL 留在侧栏角落，而不是占住主区域。

#### Scenario: Open a project

- **WHEN** 已登录的操作者打开一个已登记项目
- **THEN** 系统显示该项目的会话列表，条目按最近活动排列，且没有按日期分组的标题

#### Scenario: Thread title is not the whole prompt

- **WHEN** 一条会话的第一条用户消息是长提示
- **THEN** 侧栏显示短标题，主区域的对话里仍能看到这句原文

### Requirement: Operator can send and stop a turn

系统 SHALL 允许操作者在 Codex 已登录时向一条会话发送对话，即使其他会话正在执行。该会话已有活动 turn 时，新文本 SHALL 进入这条会话的队列。系统 SHALL 允许停止当前打开的这条会话的 turn，且不停掉其他会话。

#### Scenario: Send a message

- **WHEN** Codex 已登录、另一条会话正在执行，且操作者向当前会话发送一条文本
- **THEN** 系统开始当前会话的 turn，并显示其执行状态

#### Scenario: Send while this thread runs

- **WHEN** 当前会话已有活动 turn，且操作者再发送一条文本
- **THEN** 页面表明该文本已排队，且当前 turn 仍是原来的那一轮

#### Scenario: Stop the active turn

- **WHEN** 操作者停止当前打开的会话
- **THEN** 系统请求中断该会话的 turn，页面把该会话显示为已停止，且其他正在执行的会话继续

### Requirement: Live activity stays on the server timeline

系统 SHALL 在当前会话的对话流里连续显示助手输出、命令执行、文件变更和审批请求。助手正文 SHALL 在对应条目结束之前按输出逐步出现。命令、文件变更和审批 SHALL 留在产生它们的回合里。

#### Scenario: Command runs during a turn

- **WHEN** 活动 turn 产生命令执行事件
- **THEN** 网页在该回合内显示这条命令及其输出进度

#### Scenario: Assistant text arrives before the item finishes

- **WHEN** 模型还在输出一条助手消息
- **THEN** 页面上已经出现这段消息中已经吐出的文字

#### Scenario: File change stays in the turn

- **WHEN** 活动 turn 产生文件变更
- **THEN** 该变更显示在这个回合的对话里，而不是单独的一块区域

### Requirement: Approval can be answered from the page

系统 SHALL 在产生审批的回合里展示未决审批，并让操作者提交「允许这一次」「这一会话都允许」或「拒绝」。其他会话上的未决审批 SHALL 在侧栏对应会话上标出来。

#### Scenario: Approve a command

- **WHEN** 当前会话的回合里有一条未决命令审批，且操作者选择允许这一次
- **THEN** 系统把该决定提交给正在等待的 turn

#### Scenario: Approve for the rest of the thread

- **WHEN** 当前会话的回合里有一条未决命令审批，且操作者选择这一会话都允许
- **THEN** 系统提交该决定，且本会话后续同类审批不再在页面上询问

#### Scenario: Another thread is waiting

- **WHEN** 操作者正在看会话 A，且会话 B 有未决审批
- **THEN** 侧栏上的会话 B 显示出有待处理的审批

## ADDED Requirements

### Requirement: Conversation is the main surface

系统 SHALL 把主区域用于一条向上生长的对话。新会话的第一条用户消息 SHALL 是对话中的第一句。回合进行时，发送控件 SHALL 变为停止。

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

系统 SHALL 在会话界面提供模型选择，以及该会话的沙箱和审批策略。未登录 Codex 时，这些选择 SHALL 不可用，且页面仍显示未登录。

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
