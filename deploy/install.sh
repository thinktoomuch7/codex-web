!/bin/bash
# 在 Linux 上安装并启动 Codex Web。可重复执行。
# 已有配置文件不会被覆盖。有正在执行的回合时不会重启网关。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIND="127.0.0.1"
PORT="8787"
PROXY=""
PASSWORD=""
DATA_DIR="/var/lib/codex-web"
PROXY_SET=0
DATA_SET=0
CONFIG_DIR="/etc/codex-web"
CONFIG_PATH="$CONFIG_DIR/config.json"

usage() {
  cat <<'EOF'
用法: sudo bash deploy/install.sh [选项]

  --bind 地址       网页监听地址，默认 127.0.0.1
  --port 端口       网页监听端口，默认 8787
  --proxy URL       Codex 出站代理，例如 http://127.0.0.1:7890。不设则直连
  --password 密码   仅在第一次生成配置时使用。已有配置不会改密码
  --data-dir 目录   平台数据和 CODEX_HOME 的父目录，默认 /var/lib/codex-web

不要启用 deploy/codex-app-server.service。网关会自己拉起唯一的 codex app-server。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bind) BIND="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --proxy) PROXY="$2"; PROXY_SET=1; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; DATA_SET=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "不认识的参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "这个脚本只在 Linux 上安装 systemd 服务。Windows 上请看 README 的本地检查。" >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行: sudo bash deploy/install.sh" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "没有 systemctl，不能安装服务。" >&2
  exit 1
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [[ "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  echo "端口必须是 1 到 65535。" >&2
  exit 1
fi

if [[ -n "$PROXY" ]]; then
  export https_proxy="$PROXY" http_proxy="$PROXY"
  export HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY"
  export NO_PROXY="127.0.0.1,localhost"
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'const p=process.versions.node.split(".").map(Number); if (p[0]<22 || (p[0]===22 && p[1]<19)) process.exit(1)'; then
  echo "需要 Node.js 22.19 或更新。当前: $(command -v node || echo 未安装) $(node -v 2>/dev/null || true)" >&2
  echo "Ubuntu 可执行: curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs" >&2
  exit 1
fi
NODE="$(command -v node)"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3 make g++ bubblewrap git ca-certificates
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y python3 make gcc-c++ bubblewrap git ca-certificates
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "未找到 codex，正在安装官方 @openai/codex …"
  npm install -g @openai/codex@0.166.0
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "codex 安装后仍不在 PATH 里。" >&2
  exit 1
fi
CODEX_VERSION="$(codex --version | awk '{print $NF}')"
CODEX_BIN="$(command -v codex)"

echo "安装依赖并构建页面…"
cd "$ROOT"
npm install
npm run build

echo "安装网页终端需要的 node-pty …"
if ! npm install node-pty@1.2.0-beta.15 --no-save --no-package-lock --prefix "$ROOT"; then
  echo "node-pty 没有装上。页面可以打开，网页终端会显示启动失败。" >&2
fi

mkdir -p "$DATA_DIR/codex-home" "$DATA_DIR/projects" "$CONFIG_DIR"
PROXY_FIELD="${PROXY:-http://127.0.0.1:9}"
CREATED=0
if [[ ! -f "$CONFIG_PATH" ]]; then
  if [[ -z "$PASSWORD" ]]; then
    PASSWORD="$("$NODE" -e 'process.stdout.write(require("crypto").randomBytes(18).toString("base64url"))')"
  fi
  CREATED=1
fi

export CW_CONFIG="$CONFIG_PATH" CW_BIND="$BIND" CW_PORT="$PORT" CW_PROXY_FIELD="$PROXY_FIELD"
export CW_PASSWORD="${PASSWORD:-}" CW_DATA="$DATA_DIR" CW_VERSION="$CODEX_VERSION" CW_CREATED="$CREATED"
"$NODE" --input-type=module <<'EOF'
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const path = process.env.CW_CONFIG;
const version = process.env.CW_VERSION;
if (process.env.CW_CREATED === "1") {
  const config = {
    bindHost: process.env.CW_BIND,
    bindPort: Number(process.env.CW_PORT),
    projectRoots: [`${process.env.CW_DATA}/projects`],
    appServerSocket: "/run/codex/app.sock",
    allowedCodexVersions: [version],
    httpsProxy: process.env.CW_PROXY_FIELD,
    username: "admin",
    password: process.env.CW_PASSWORD,
    dataDir: process.env.CW_DATA,
  };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
} else {
  const config = JSON.parse(readFileSync(path, "utf8"));
  const allowed = Array.isArray(config.allowedCodexVersions) ? config.allowedCodexVersions : [];
  if (!allowed.includes(version)) {
    config.allowedCodexVersions = [...allowed, version];
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`已把 Codex ${version} 加入允许列表`);
  } else {
    console.log("沿用已有配置，没有改密码");
  }
}
if (!existsSync(path)) process.exit(1);
EOF
chmod 600 "$CONFIG_PATH"

UNIT_PATH="/etc/systemd/system/codex-web.service"
if [[ -f "$UNIT_PATH" ]]; then
  if [[ "$PROXY_SET" -eq 0 ]]; then
    EXISTING_PROXY="$(sed -n 's/^Environment=https_proxy=//p' "$UNIT_PATH" | head -n 1 || true)"
    if [[ -n "${EXISTING_PROXY:-}" ]]; then PROXY="$EXISTING_PROXY"; fi
  fi
  if [[ "$DATA_SET" -eq 0 ]]; then
    EXISTING_HOME="$(sed -n 's/^Environment=CODEX_HOME=//p' "$UNIT_PATH" | head -n 1 || true)"
    if [[ -n "${EXISTING_HOME:-}" ]]; then DATA_DIR="$(dirname "$EXISTING_HOME")"; fi
  fi
fi
{
  echo "[Unit]"
  echo "Description=Codex Web gateway"
  echo "After=network-online.target"
  echo "Wants=network-online.target"
  echo
  echo "[Service]"
  echo "User=root"
  echo "Group=root"
  if [[ -n "$PROXY" ]]; then
    echo "Environment=https_proxy=$PROXY"
    echo "Environment=http_proxy=$PROXY"
  fi
  echo "Environment=NO_PROXY=127.0.0.1,localhost"
  echo "Environment=CODEX_HOME=$DATA_DIR/codex-home"
  echo "WorkingDirectory=$ROOT"
  echo "ExecStart=$NODE --experimental-strip-types $ROOT/gateway/src/index.ts $CONFIG_PATH"
  echo "Restart=on-failure"
  echo "RestartSec=3"
  echo
  echo "[Install]"
  echo "WantedBy=multi-user.target"
} > "$UNIT_PATH"

if systemctl list-unit-files codex-app-server.service --no-legend 2>/dev/null | grep -q codex-app-server; then
  systemctl disable --now codex-app-server.service || true
fi

ACTIVE_TURNS=0
if [[ -f "$DATA_DIR/app.db" ]] && systemctl is-active --quiet codex-web; then
  COUNT_JS="$(mktemp --suffix=.mjs)"
  cat > "$COUNT_JS" <<'EOF'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const row = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('running', 'waiting_approval')").get();
console.log(row.n);
EOF
  ACTIVE_TURNS="$("$NODE" "$COUNT_JS" "$DATA_DIR/app.db" | tail -n 1)"
  rm -f "$COUNT_JS"
fi

systemctl daemon-reload
systemctl enable codex-web.service
if [[ "$ACTIVE_TURNS" != "0" ]]; then
  echo "有 $ACTIVE_TURNS 个回合还在执行，没有重启网关。空闲后再执行: systemctl restart codex-web" >&2
else
  systemctl restart codex-web
fi

sleep 1
if systemctl is-active --quiet codex-web; then
  CHECK_HOST="$BIND"
  if [[ "$CHECK_HOST" == "0.0.0.0" || "$CHECK_HOST" == "::" ]]; then CHECK_HOST="127.0.0.1"; fi
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://${CHECK_HOST}:${PORT}/api/account" || true)"
  echo "网关状态: active"
  echo "未登录访问 /api/account 返回: ${CODE:-无法连接}（401 表示服务已起来）"
else
  echo "网关没有进入 active。查看: journalctl -u codex-web -n 80 --no-pager" >&2
  exit 1
fi

echo
echo "程序目录: $ROOT"
echo "配置: $CONFIG_PATH"
echo "CODEX_HOME: $DATA_DIR/codex-home"
echo "codex: $CODEX_BIN $CODEX_VERSION"
echo "页面: http://${BIND}:${PORT}/"
if [[ "$CREATED" == "1" ]]; then
  echo "网页登录密码（只显示这一次）: $PASSWORD"
fi
echo "若页面显示 Codex 未登录，执行:"
echo "  CODEX_HOME=$DATA_DIR/codex-home codex login"
echo "  systemctl restart codex-web"
