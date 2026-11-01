# Spec Delta

## ADDED Requirements

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
