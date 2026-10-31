# Proposal

## Why

四台电脑需要共用同一个跑在自有服务器上的 Codex 执行环境。Git 只能同步代码，不能保住正在运行的会话和任务；官方 Codex Cloud 又不稳定。现在服务器已经换成 Ubuntu 24.04，并且能通过本机代理到达 OpenAI，可以开始做这个平台本身。

## What Changes

- 新增自写的 TypeScript 网关和 React 网页。浏览器只订阅和操作，不决定 Agent 进程的存亡。
- 网关成为官方 `codex app-server` 的唯一长期 JSON-RPC 客户端。会话正文以 `CODEX_HOME` 为准，SQLite 只保存平台状态。
- 同一时刻只允许一个执行中的 turn。审批在浏览器断开后仍留在服务器上。
- Codex 账号登录放到实现完成之后的验收步骤，不作为写代码的前置条件。程序先按官方协议和录制事件完成。
- 不引入、不 fork 社区 Codex Web 项目。出站代理保持为服务器上已有的 mihomo，不放进本仓库。

## Capabilities

### New Capabilities

- `web-auth`: 单用户密码登录和浏览器会话。
- `codex-gateway`: 托管 app-server、项目登记、单任务锁、审批收件箱、断线补齐和崩溃对账。
- `workspace-ui`: 项目、会话、聊天、实时日志、审批和停止任务的网页。

### Modified Capabilities

- 无。仓库里还没有已发布的能力规格。

## Impact

- 绿场仓库。新增网关、前端和 SQLite 数据文件，不改现有业务代码。
- 运行依赖：Node.js 22、官方 Codex gnu 包（glibc 2.39）、本机 Unix socket、服务器上已有的 `127.0.0.1:7890` 代理。
- 部署目标是 2 核、约 3.8 GiB 内存、无 swap 的 Ubuntu 24.04。验收前应加上约 2GB swap。
- 最终验收需要一次设备码登录，以及「关掉客户端后任务仍在跑、另一连接能看到结果」。
