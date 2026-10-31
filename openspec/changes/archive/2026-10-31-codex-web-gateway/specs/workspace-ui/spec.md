# Spec Delta

## Purpose

让操作者在浏览器里查看已登记项目和会话、发送对话、跟随执行过程，并在同一页面处理审批或停止任务。

## ADDED Requirements

### Requirement: Workspace shows projects and threads

系统 SHALL 展示已登记项目，以及所选项目下的会话列表。

#### Scenario: Open a project

- **WHEN** 已登录的操作者打开一个已登记项目
- **THEN** 系统显示该项目的会话列表

### Requirement: Operator can send and stop a turn

系统 SHALL 允许操作者在已登录 Codex 且没有其他活动 turn 时发送对话，并允许停止当前 turn。

#### Scenario: Send a message

- **WHEN** Codex 已登录、没有活动 turn，且操作者发送一条文本
- **THEN** 系统开始一个 turn 并显示其执行状态

#### Scenario: Stop the active turn

- **WHEN** 操作者停止当前 turn
- **THEN** 系统请求中断该 turn 并把可见状态更新为已停止

### Requirement: Live activity stays on the server timeline

系统 SHALL 在网页上连续显示助手输出、命令执行、文件变更和审批请求。

#### Scenario: Command runs during a turn

- **WHEN** 活动 turn 产生命令执行事件
- **THEN** 网页显示该命令及其输出进度

### Requirement: Approval can be answered from the page

系统 SHALL 在网页上展示未决审批，并让操作者提交允许或拒绝。

#### Scenario: Approve a command

- **WHEN** 页面上有一条未决命令审批且操作者选择允许
- **THEN** 系统把该决定提交给正在等待的 turn

### Requirement: Unsigned Codex account is visible

系统 SHALL 在 Codex 账号未登录时明确显示未登录，并且不把失败伪装成已开始的任务。

#### Scenario: Open the workspace before Codex login

- **WHEN** 操作者已登录网页但 Codex 账号未登录
- **THEN** 页面显示 Codex 未登录且不出现一个新的执行中任务
