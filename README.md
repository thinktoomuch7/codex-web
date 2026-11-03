# Codex Web

把自己的服务器变成一部可以多人打开的 Codex。手机和电脑都用浏览器进同一套会话，关掉页面不会把正在跑的任务停掉。

执行引擎只用官方 `codex`。浏览器不持有代理进程，也不直接和 app-server 说话。网关拉起并守住唯一一个 `codex app-server`（标准输入输出）。不要再启动第二个 app-server 去占用同一份 `CODEX_HOME`。

网页登录密码和 Codex 账号不是同一个东西。密码只决定谁能打开这个页面。网关以 root 运行，所以页面密码等同于这台机器的 root：审批通过后的命令也是 root 执行的。

## 给别人或 AI：先跑这一条

在已经装好 Node.js 22.19+ 的 Linux 上，克隆仓库后执行：

```sh
sudo bash deploy/install.sh
```

脚本会安装依赖、构建页面、写入 `/etc/codex-web/config.json`、安装 `codex-web` 服务并启动。第一次运行会在终端打印网页登录密码，只打印一次。已有配置文件不会被覆盖，密码也不会改。

需要从别的机器访问时：

```sh
sudo bash deploy/install.sh --bind 0.0.0.0 --port 8081
```

Codex 必须走本机代理时：

```sh
sudo bash deploy/install.sh --proxy http://127.0.0.1:7890
```

| 选项 | 作用 | 默认 |
| --- | --- | --- |
| `--bind` | 监听地址 | `127.0.0.1`，只有本机能打开 |
| `--port` | 监听端口 | `8787` |
| `--proxy` | 传给 Codex 进程的 `https_proxy` | 不设置，直连 |
| `--password` | 只在第一次生成配置时使用 | 随机生成并打印 |
| `--data-dir` | 平台数据库和 `CODEX_HOME` 的父目录 | `/var/lib/codex-web` |

脚本不会做这些事：

- 不执行 `codex login`。登录必须由人完成。
- 不覆盖已经存在的 `/etc/codex-web/config.json`。
- 发现有正在执行或等待审批的回合时，不重启网关。
- 不启用 `deploy/codex-app-server.service`。如果机器上已经启用了这个单元，脚本会停掉它。

装好后用下面两条确认。第二条应返回 `401`。

```sh
systemctl is-active codex-web
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/account
```

端口如果改过，把 `8787` 换成实际端口。

## 安装之前

- Linux，并且有 systemd。脚本要 root。
- Node.js 22.19 或更新。`node` 必须在 root 的 `PATH` 里。脚本会把当时的绝对路径写进服务，避免以后换成另一个 node。
- 官方 `codex`。找不到时，脚本安装 `@openai/codex@0.166.0`。机器上已经有 `codex` 时不会重装；脚本把 `codex --version` 的最后一个字段写进 `allowedCodexVersions`。版本不在名单里，网关拒绝启动。
- 能编译原生模块的工具。脚本在有 `apt-get` 或 `dnf` 时安装 `python3`、`make`、`g++`、`git`、`bubblewrap`。网页里的终端依赖 `node-pty`，编译失败时页面仍能打开，终端会显示启动失败。

Ubuntu 上如果还没有 Node.js 22：

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v
```

## 登录 Codex

网页能打开之后，用网关同一份 `CODEX_HOME` 登录。不要 `codex logout`。

```sh
CODEX_HOME=/var/lib/codex-web/codex-home codex login
systemctl restart codex-web
```

`--data-dir` 改过的话，把路径换成那个目录下的 `codex-home`。重启会把当时还在跑的回合标成中断，不会自动重放。登录完成后刷新页面，顶栏应显示「Codex 已登录」。

## 打开页面

浏览器打开 `http://<监听地址>:<端口>/`，输入安装时打印的密码。登录框没有用户名。

`bind` 仍是 `127.0.0.1` 时，别的机器访问不了。要对外提供，用 `--bind 0.0.0.0`，再由防火墙或端口转发放行。不要把 Codex 的 app-server 暴露出去；它没有单独监听端口。

## 再次部署

代码更新后，在仓库目录再执行一次：

```sh
sudo bash deploy/install.sh
```

再次执行时如果没写 `--proxy` 或 `--data-dir`，会保留服务里已经写好的代理和 `CODEX_HOME`。

它会重新构建页面。没有正在执行的回合时重启网关；有的话会停下来，并告诉你稍后执行 `systemctl restart codex-web`。只换了页面静态文件时，其实不重启也能在下次请求读到新文件，但这条命令仍以服务里的程序目录为准。

升级了 `codex` 之后也要再跑一次，好把新版本号补进允许列表。

## 配置字段

文件是 `/etc/codex-web/config.json`，权限 `600`。字段缺一不可。

| 字段 | 含义 |
| --- | --- |
| `bindHost` / `bindPort` | 网页和 API 的监听地址 |
| `password` | 网页登录密码。网关每次启动都会按这个值更新口令哈希 |
| `username` | 写进平台数据库的用户名。登录框不使用它 |
| `dataDir` | 平台 SQLite 所在目录，文件是 `<dataDir>/app.db` |
| `allowedCodexVersions` | 允许的 `codex --version` 版本号 |
| `projectRoots` | 必须是非空字符串数组，配置才能通过解析。它不是目录白名单。页面可以打开进程读得到的任何目录 |
| `appServerSocket` | 必须填写。当前网关不用这个 socket，而是自己拉起 `codex app-server` |
| `httpsProxy` | 必须是非空字符串。网关不读它。真正影响 Codex 出站的是服务单元里的 `https_proxy` |

没有代理时，配置里的 `httpsProxy` 可以留着 `http://127.0.0.1:9`。不要因为这个字段去启动一个代理。

改密码：编辑 `password` 后执行 `systemctl restart codex-web`。不要把这个文件提交进仓库。

## 数据放在哪

| 内容 | 位置 |
| --- | --- |
| 网页登录、项目、任务、审批、队列、会话所在目录 | `<dataDir>/app.db` |
| 会话正文 | `$CODEX_HOME`，默认 `/var/lib/codex-web/codex-home` |
| 单独检出 | 仓库上一级的 `<仓库名>-worktrees/<分支名>` |

平台数据库不保存对话正文。Git 仓库里的新会话可以选择单独 worktree，也可以直接使用项目目录。普通目录没有 worktree。

## 页面上能做什么

- 一个项目下面有多条会话，可以同时跑。同一条会话一次只有一轮，下一句会排队。
- 助手正文随生成逐段出现。
- 命令、文件变更和审批留在对应回合里。可以只允许这一次，或这一会话都允许同类请求。
- 会话可以改名、置顶、归档、分叉和删除。正在执行或等待审批时不能删除。
- 选中目录后就能看文件，不必先开会话。已打开的会话显示那条会话自己的目录。
- Git 变更、提交、推送在会话目录里执行。创建 pull request 需要本机有 `gh` 并且已经登录。

## 不要这样做

- 不要 `systemctl enable --now codex-app-server`。仓库里的 `deploy/codex-app-server.service` 是旧草案。
- 不要同时手工再跑一个 `codex app-server`。
- 服务的启动参数只有 `--experimental-strip-types`。不要加上 `--experimental-transform-types`，那个参数会让网关入口的顶层 await 起不来。
- 进程重启会把进行中的回合标成中断，不会自动重放。
- 不要把网页密码、Codex 令牌或代理订阅写进仓库和日志。

查看网关日志：

```sh
journalctl -u codex-web -n 80 --no-pager
```

## 本地检查

开发和测试需要 Node.js 22。Windows 上可以跑测试和构建，一键安装脚本只用于 Linux 服务。

```sh
npm install
npm test
npm run build
```

`npm test` 只跑网关测试。`npm run build` 生成 `web/dist`，网关和页面共用一个端口。本地临时看页面时，另开一个终端执行 `npm run dev -w web`，开发服务器在 `http://127.0.0.1:5173`，并把 `/api` 转到 `127.0.0.1:8787`。
