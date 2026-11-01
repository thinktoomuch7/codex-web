# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace shows projects and threads

系统 SHALL 在默认侧栏展示跨已登记项目的最近会话。每条 SHALL 显示短标题和所属项目名，并按最近活动从新到旧排列。列表 SHALL 不按日期分组，SHALL 不把第一条提示的全文放在侧栏。登记项目 SHALL 从加号进入，而不是占住侧栏。

#### Scenario: Open a project

- **WHEN** 已登录的操作者打开工作区，且两个已登记项目各自有会话
- **THEN** 侧栏同时显示这两条会话，每条带有项目名，按最近活动排列，且没有今天或昨天这样的分组

#### Scenario: Thread title is not the whole prompt

- **WHEN** 一条会话的第一条用户消息是长提示
- **THEN** 侧栏显示短标题和项目名，对话里仍能看到这句原文

### Requirement: Operator can send and stop a turn

系统 SHALL 让操作者从底部输入框发送对话。Codex 已登录且当前会话没有活动 turn 时，发送 SHALL 开始这一轮。当前会话已有活动 turn 时，再发送的文本 SHALL 进入这条会话的队列，输入位置 SHALL 变为停止。停止 SHALL 只作用于当前打开的会话。

#### Scenario: Send a message

- **WHEN** Codex 已登录、当前会话没有活动 turn，且操作者在输入框发送一条文本
- **THEN** 系统开始这一轮，页面显示其执行状态，且不要求其他会话处于空闲

#### Scenario: Stop the active turn

- **WHEN** 当前会话正在执行且操作者按下停止
- **THEN** 系统请求中断该会话的 turn，页面把该会话显示为已停止，且其他正在执行的会话继续

### Requirement: Live activity stays on the server timeline

系统 SHALL 在当前对话里显示助手正文、命令、文件变更和审批。助手正文 SHALL 在条目完成之前按新片段追加。命令输出在检查项未展开时 SHALL 不画进页面。未决审批 SHALL 留在产生它的回合里，并且不用打开另一页就能回答。

#### Scenario: Command runs during a turn

- **WHEN** 活动 turn 产生命令执行，且操作者没有展开检查项
- **THEN** 页面表明这一轮仍有检查项，且不把命令输出作为常驻区块画出来

#### Scenario: Text arrives in fragments

- **WHEN** 助手正文陆续到来
- **THEN** 页面把每个新片段追加到正在增长的正文上，且不因该片段重画整份已加载对话之外的内容

### Requirement: Approval can be answered from the page

系统 SHALL 在产生审批的回合里展示未决审批，并让操作者提交允许这一次、这一会话都允许，或拒绝。

#### Scenario: Approve a command

- **WHEN** 当前对话里有一条未决命令审批且操作者选择允许这一次
- **THEN** 系统把该决定提交给正在等待的 turn

## ADDED Requirements

### Requirement: Secondary controls open only when asked

系统 SHALL 把模型、沙箱、审批策略和查找放在按需打开的设置里。系统 SHALL 把改名、归档、分叉和删除放在该会话自己的菜单里。系统 SHALL 把 diff、暂存、还原、提交、推送和创建 pull request 放在按需打开的审查里。这些区域在操作者打开之前 SHALL 不作为常驻画面。系统 SHALL 不为主规格之外的定时任务、资料库、插件、探索、分享、语音、内嵌终端或文件编辑器放置空入口。

#### Scenario: Open the workspace

- **WHEN** 操作者打开一条已有会话
- **THEN** 画面上的常驻操作是最近列表、对话和输入框，模型选择、Git 按钮和删除按钮都不在默认画面上

#### Scenario: Open settings while text is arriving

- **WHEN** 正文正在增长且操作者没有打开设置
- **THEN** 页面不为该片段渲染模型、沙箱或审批策略控件

### Requirement: A long transcript draws a recent window

系统 SHALL 在对话很长时只绘制最近的一段。更早的内容 SHALL 仍保留在服务器上，操作者要求查看时再载入。

#### Scenario: Thread has more turns than the window

- **WHEN** 一条会话的回合数超过页面一次绘制的窗口
- **THEN** 页面先显示最近的一段，且更早的正文仍可通过继续查看得到
