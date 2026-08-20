#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PORT=18080
FORK_REPO_URL="https://github.com/qingan123/Chat2API.git"
PROJECT_NAME="Chat2API Fork版"

log() { printf '[Chat2API] %s\n' "$*"; }
die() { printf '[Chat2API] 错误：%s\n' "$*" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "请使用 root 或 sudo 执行。"; }

prompt_port() {
  local value="${CHAT2API_PORT:-}"
  if [ -z "$value" ]; then
    [ -r /dev/tty ] || die "无法读取交互终端；请设置 CHAT2API_PORT 后重试。"
    read -r -p "请输入 API 端口 [$DEFAULT_PORT]: " value </dev/tty
    value="${value:-$DEFAULT_PORT}"
  fi
  [[ "$value" =~ ^[0-9]+$ ]] || die "端口必须是数字。"
  [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || die "端口必须在 1-65535 之间。"
  printf '%s' "$value"
}

port_is_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN
  else
    python3 - "$port" <<'PY'
import socket, sys
s=socket.socket()
try: s.bind(('0.0.0.0',int(sys.argv[1])))
except OSError: raise SystemExit(0)
raise SystemExit(1)
PY
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git nodejs npm python3 openssl xvfb
  node -e 'const n=Number(process.versions.node.split(".")[0]); if(n<18) process.exit(1)' || die "需要 Node.js 18 或更高版本。"
}

clone_source() {
  git clone --branch main --single-branch "$FORK_REPO_URL" "$SOURCE_DIR"
  git -C "$SOURCE_DIR" remote set-url origin "$FORK_REPO_URL"
  SOURCE_VERSION="$(git -C "$SOURCE_DIR" rev-parse --short=12 HEAD)"
}

build_application() {
  log "安装依赖并构建 Fork 源码，首次执行可能需要几分钟"
  (
    cd "$SOURCE_DIR"
    npm ci
    npm run build:unpack
  )
  local executable
  executable="$(find "$SOURCE_DIR/dist" -maxdepth 3 -type f -name chat2api -perm -111 -print -quit 2>/dev/null || true)"
  [ -n "$executable" ] || die "构建完成后未找到 Linux 可执行文件。"
  APP_EXECUTABLE="$executable"
}

configure_data() {
  install -d -m 700 "$APP_HOME/.chat2api" "$APP_HOME/.config" "$APP_HOME/.cache"
  umask 077
  printf 'c2a_%s\n' "$(openssl rand -hex 32)" > "$KEY_FILE"
  CHAT2API_DATA="$DATA_FILE" CHAT2API_KEY_FILE="$KEY_FILE" CHAT2API_PORT_VALUE="$PORT" python3 - <<'PY'
import json, os, time
p=os.environ['CHAT2API_DATA']; key=open(os.environ['CHAT2API_KEY_FILE']).read().strip(); port=int(os.environ['CHAT2API_PORT_VALUE'])
d={'providers':[],'accounts':[],'config':{},'logs':[],'requestLogs':[],'systemPrompts':[],'sessions':[],'statistics':{},'userModelOverrides':{}}
c=d['config']; c.update({'proxyPort':port,'proxyHost':'0.0.0.0','autoStartProxy':True,'enableApiKey':True,'apiKeys':[{'id':f'chat2api-{port}','name':'server-default','key':key,'enabled':True,'createdAt':int(time.time()*1000),'usageCount':0,'description':'Initial server API key'}]})
t=p+'.tmp'; open(t,'w').write(json.dumps(d,ensure_ascii=False,indent=2)); os.replace(t,p)
PY
  chmod 600 "$KEY_FILE" "$DATA_FILE"
}

write_runtime() {
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$APP_HOME"
export ELECTRON_DISABLE_GPU=1
exec /usr/bin/xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" "$APP_EXECUTABLE" --no-sandbox --disable-gpu
EOF
  chmod 700 "$LAUNCHER"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Chat2API fork instance on port $PORT
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$(dirname "$APP_EXECUTABLE")
ExecStart=$LAUNCHER
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
  cat > "$META_FILE" <<EOF
TYPE=fork
PROJECT_NAME=$PROJECT_NAME
PORT=$PORT
VERSION=$SOURCE_VERSION
APP_DIR=$APP_DIR
SERVICE_NAME=$SERVICE_NAME
REPOSITORY=qingan123/Chat2API
SOURCE_DIR=$SOURCE_DIR
EOF
  chmod 600 "$META_FILE"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME.service"
}

verify_service() {
  local i health="" ready=0 unauth auth key
  for i in $(seq 1 90); do
    if health="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null)" && python3 -c 'import json,sys; assert json.load(sys.stdin).get("status")=="running"' <<<"$health" 2>/dev/null; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" -eq 1 ] || { journalctl -u "$SERVICE_NAME" -n 100 --no-pager || true; die "健康检查超时。"; }
  unauth="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/models")"
  [ "$unauth" = 401 ] || die "未认证模型接口应返回 401，实际为 $unauth。"
  key="$(<"$KEY_FILE")"
  auth="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $key" "http://127.0.0.1:$PORT/v1/models")"
  [ "$auth" = 200 ] || die "带 API Key 的模型接口应返回 200，实际为 $auth。"
}

print_result() {
  local public_host="${PUBLIC_HOST:-}"
  [ -n "$public_host" ] || public_host="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  printf '\n部署完成：%s %s\n' "$PROJECT_NAME" "$SOURCE_VERSION"
  printf '安装目录：%s\n' "$APP_DIR"
  printf '本机 OpenAI Base URL：http://127.0.0.1:%s/v1\n' "$PORT"
  if [ -n "$public_host" ]; then printf '公网 OpenAI Base URL：http://%s:%s/v1\n' "$public_host" "$PORT"; else printf '公网地址探测失败，请自行使用服务器公网地址。\n'; fi
  printf 'API Key 文件：%s（仅 root 可读，脚本不会显示密钥）\n' "$KEY_FILE"
  printf '服务状态：systemctl status %s --no-pager\n' "$SERVICE_NAME"
  printf '实时日志：journalctl -u %s -f\n' "$SERVICE_NAME"
  printf '注意：请另行确认云安全组、UFW、NAT 或反向代理已放行端口 %s。\n' "$PORT"
}

main() {
  require_root
  PORT="$(prompt_port)"
  APP_DIR="${APP_DIR_BASE:-/opt/chat2api-$PORT}"
  SOURCE_DIR="$APP_DIR/source"
  APP_HOME="$APP_DIR/home"
  KEY_FILE="$APP_DIR/api-key.txt"
  DATA_FILE="$APP_HOME/.chat2api/data.json"
  LAUNCHER="$APP_DIR/run-chat2api.sh"
  META_FILE="$APP_DIR/.chat2api-deploy"
  SERVICE_NAME="chat2api-$PORT"
  UNIT_FILE="/etc/systemd/system/$SERVICE_NAME.service"
  port_is_listening "$PORT" && die "端口 $PORT 已被占用。"
  [ ! -e "$APP_DIR" ] || die "安装目录已存在：$APP_DIR；请使用更新脚本。"
  install_packages
  install -d -m 755 "$APP_DIR"
  clone_source
  build_application
  configure_data
  write_runtime
  verify_service
  print_result
}
main "$@"
