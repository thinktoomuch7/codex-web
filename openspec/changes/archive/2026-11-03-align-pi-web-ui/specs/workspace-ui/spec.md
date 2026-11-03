# workspace-ui Specification

## MODIFIED Requirements

### Requirement: Workspace shows projects and threads

系统 SHALL 按 Pi Web 的侧栏展示最近会话和按项目归组的会话。最近列表 SHALL 按最近活动从新到旧排列，SHALL 不按日期分组，每条 SHALL 显示短标题和项目名。项目组 SHALL 可以新建会话、改名、置顶、归档、恢复、分叉、删除，并按标题搜索。第一条提示的全文 SHALL 不放在侧栏。

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

#### Scenario: Stop the active turn

- **WHEN** 当前会话正在执行且操作者按下停止
- **THEN** 系统请求中断该会话的 turn，页面把该会话显示为已停止，且其他正在执行的会话继续

### Requirement: Live activity stays on the server timeline

系统 SHALL 在同一栏对话里按文档流显示用户消息、助手 Markdown、可折叠的思考、工具调用、这一轮写出的文件和用时。助手正文 SHALL 在条目完成之前按新片段追加。未决审批 SHALL 留在产生它的回合里。操作者 SHALL 可以从小地图回到较近的位置，并向上继续查看更早的记录。

#### Scenario: Command runs during a turn

- **WHEN** 活动 turn 产生工具或命令执行
- **THEN** 页面在这一栏里显示该工具调用及其进行状态，操作者可以展开查看输出

#### Scenario: Text arrives in fragments

- **WHEN** 助手正文陆续到来
- **THEN** 页面把每个新片段追加到正在增长的正文上，且不因该片段重画整份已加载对话之外的内容

### Requirement: Secondary controls open only when asked

系统 SHALL 把文件、Git 和终端放在与 Pi Web 对应的页面里，而不是在没有实现时放空入口。模型 SHALL 放在输入框旁。改名、归档、分叉和删除 SHALL 放在该会话自己的菜单里。沙箱、审批策略和查找 SHALL 放在设置里。Codex 官方没有对应能力的 Pi 专有控件 SHALL 不出现。

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

## ADDED Requirements

### Requirement: Directory selection follows the server

系统 SHALL 让操作者浏览进程读得到的目录，并在进程写得到的地方新建目录。选中的目录 SHALL 成为项目和之后新会话的工作目录。

#### Scenario: Choose any readable directory

- **WHEN** 操作者在目录选择里选中一个进程可以读取的目录
- **THEN** 系统登记该目录，且不因为该目录位于某个配置根之外而拒绝

#### Scenario: Create a directory

- **WHEN** 操作者在一个进程可以写入的父目录下新建目录
- **THEN** 系统创建该目录并可以把它登记为项目

### Requirement: Files and terminal follow the current directory

系统 SHALL 在文件页浏览、预览并上传到当前项目、其 worktree 或这条会话的目录，并在终端页于该目录执行命令。Git 变更 SHALL 来自这个目录。

#### Scenario: Open the file page

- **WHEN** 操作者打开一条会话的文件页
- **THEN** 页面列出该会话目录中的文件，并可以预览和上传到这个目录

#### Scenario: Open the terminal

- **WHEN** 操作者在一条会话中打开终端并输入命令
- **THEN** 命令在该会话的目录中执行，输出回到这个终端页
