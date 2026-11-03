# Codex 0.166 方法探测

探测对象是服务器上的 `codex-cli 0.166.0` 原生二进制，只做字符串扫描，没有再启动 `app-server`。

二进制里的方法名经常首尾相接，下面只记能独立对上的名字。参数字段没有拆成单独的字符串表，调用时按这里写的形状发送。

## 增量正文

找到：

- `item/agentMessage/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`
- `item/reasoning/textDelta`
- `item/reasoning/summaryTextDelta`
- `item/plan/delta`

通知参数使用 `threadId`、`itemId`（没有则用 `item.id`）和 `delta`（没有则用 `text`）。这三项和现有 `item/started`、`item/completed` 的会话字段对齐，不是另一次猜出来的方法名。

## 改名

找到：`thread/name/set`

调用参数：`{ threadId, name }`

通知：`thread/name/updated`，名字读 `name` 或 `title`。

## 归档

找到：`thread/archive`

调用参数：`{ threadId }`

## 取消归档

找到：`thread/unarchive`

调用参数：`{ threadId }`

## 分叉

找到：`thread/fork`

调用参数：`{ threadId, cwd }`。二进制里能看到 `thread/fork.path`。

## 模型列表

找到：`model/list`

调用参数：`{}`

后续 turn 要改模型、沙箱或审批策略时，走 `thread/resume`，字段为 `model`、`sandbox`、`approvalPolicy`。没改过的会话不传这些字段。
