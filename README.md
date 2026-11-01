# Codex Web

把自己的服务器变成一部可以多人打开的 Codex。手机和电脑都用浏览器进同一套会话，关掉页面不会把正在跑的任务停掉。

执行引擎只用官方 `codex`。浏览器不持有代理进程，也不直接和 app-server 说话。网关拉起并守住唯一一个 `codex app-server`（标准输入输出）。不要再启动第二个 app-server 去占用同一份 `CODEX_HOME`。

## 页面上能做什么

- 一个项目下面有多条会话，可以同时跑。同一条会话一次只有一轮，下一句会排队。
- 助手正文随生成逐段出现。
- 命令、文件变更和审批留在对应回合里。可以只允许这一次，或这一会话都允许同类请求。
- Git 仓库里的新会话默认使用单独 worktree，也可以改成直接修改项目目录。普通目录没有 worktree。
- 会话可以改名、归档、分叉和删除。正在执行或等待审批时不能删除。

网页登录密码和 Codex 账号不是同一个东西。密码只决定谁能打开这个页面。

## 数据放在哪

| 内容 | 位置 |
| --- | --- |
| 网页登录、项目、任务、审批、队列、worktree 位置 | `dataDir` 里的 SQLite，例如 `/var/lib/codex-web/app.db` |
| 会话正文 | Codex 自己的 `CODEX_HOME`，例如 `/var/lib/codex-web/codex-home` |
| 单独检出 | `<dataDir>/worktrees/<projectId>/<threadId>` |

平台数据库不保存对话正文。

## 本地检查

需要 Node.js 22。

```sh
npm test
npm run build
```

`npm test` 跑网关测试。`npm run build` 生成 `web/dist`，网关和页面共用一个端口。

## 服务器

配置从 `config.example.json` 复制到 `/etc/codex-web/config.json`。至少改掉 `password`，并把 `allowedCodexVersions` 设成这台机器上 `codex --version` 的版本号。`projectRoots` 只登记已经存在的目录，登记项目不会创建文件夹。

网关单元是 `codex-web.service`。它以 root 运行，工作目录 `/opt/codex-web`，并带上本机已有的 `https_proxy`。不要把 Codex 的监听端口暴露到公网。进程重启会把进行中的回合标成中断，不会自动重放。
