# codex-gateway Specification

## Purpose

让服务器上的网关成为 Codex 的唯一长期客户端，使任务、审批和会话在浏览器断开后仍然存在。

## Requirements

### Requirement: Browser disconnect does not stop the agent

系统 SHALL 在浏览器连接断开后继续保留 app-server 进程和正在执行的 turn。

#### Scenario: Browser closes during a turn

- **WHEN** 一个 turn 正在执行且浏览器连接断开
- **THEN** app-server 进程仍在运行且该 turn 不被系统主动中断

### Requirement: Only one turn executes at a time

系统 SHALL 在已有执行中或等待审批的 turn 时拒绝新的 turn。

#### Scenario: Second turn while one is running

- **WHEN** 已有一个 `running` 或 `waiting_approval` 的任务且操作者再次发起 turn
- **THEN** 系统拒绝新的 turn 且原来的任务继续

### Requirement: Project directory stays inside configured roots

系统 SHALL 只允许已登记且解析后仍位于配置根目录内的路径作为会话工作目录。

#### Scenario: Path outside the root

- **WHEN** 操作者提交一个解析后不在配置根目录内的项目路径
- **THEN** 系统拒绝登记或启动该路径上的会话

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

系统 SHALL 列出由本平台创建的 app-server 会话，而不是只列出其他客户端来源的会话。

#### Scenario: List after creating a thread

- **WHEN** 操作者通过本平台创建会话后查看列表
- **THEN** 该会话出现在列表中

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
