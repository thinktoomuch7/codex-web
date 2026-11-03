# codex-gateway Specification

## REMOVED Requirements

### Requirement: Project directory stays inside configured roots

**Reason**: 配置根目录是本平台额外加上的限制。Codex 接受进程能够使用的工作目录，目录选择改为与 Pi Web 一致。
**Migration**: 已登记且进程仍能读取的路径继续可用。新的登记和新建目录不再对照配置根。

### Requirement: Only one turn executes at a time

**Reason**: 全机同时只跑一个 turn 与当前行为和 Pi Web 的多会话都不一致。
**Migration**: 不同会话可以同时执行。同一条会话仍然一次只有一轮，下一句排队，等这一轮结束或失败后再开始。

## ADDED Requirements

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

系统 SHALL 只对当前项目、其 worktree 或该会话已记录的工作目录提供列目录、读取、上传、Git 和终端。终端命令 SHALL 在该目录执行，SHALL 不通过模型转发。

#### Scenario: List the session directory

- **WHEN** 操作者打开一条会话的文件列表
- **THEN** 系统返回该会话工作目录中的条目

#### Scenario: Reject a path outside the selected directory

- **WHEN** 操作者请求读取一条不在该会话或当前项目目录内的路径
- **THEN** 系统拒绝该请求

### Requirement: Worktree is created beside the repository

系统 SHALL 在 Git 仓库根旁创建 worktree，路径为 `<仓库名>-worktrees/<分支名>`。新会话 SHALL 可以使用该检出。已有会话 SHALL 保留自己的工作目录。非仓库目录 SHALL 不提供 worktree。

#### Scenario: Create a worktree from the repository root

- **WHEN** 操作者在一个 Git 仓库根上新建 worktree 并给出分支名
- **THEN** 系统在仓库旁边的 `<仓库名>-worktrees/<分支名>` 创建检出，并可以在其中开始会话
