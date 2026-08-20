#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PORT=18080
UPSTREAM_REPO="xiaoY233/Chat2API"
PROJECT_NAME="Chat2API 官方版"
TMP_DIR=""

log() { printf '[Chat2API] %s\n' "$*"; }
die() { printf '[Chat2API] 错误：%s\n' "$*" >&2; exit 1; }
cleanup() { [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"; }
trap cleanup EXIT

require_root() {
  [ "$(id -u)" -eq 0 ] || die "请使用 root 或 sudo 执行。"
}

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
try:
    s.bind(('0.0.0.0', int(sys.argv[1])))
except OSError:
    raise SystemExit(0)
raise SystemExit(1)
PY
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl python3 openssl xvfb
}

resolve_release() {
  local arch api asset_filter release_json
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) asset_filter='x86_64.AppImage$' ;;
    aarch64|arm64) asset_filter='arm64.AppImage$' ;;
    *) die "暂不支持架构：$arch" ;;
  esac
  api="https://api.github.com/repos/$UPSTREAM_REPO/releases/latest"
  release_json="$(curl -fsSL --retry 3 --connect-timeout 15 "$api")" || die "无法查询官方最新版本。"
  RELEASE_TAG="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' <<<"$release_json")"
  ASSET_URL="$(ASSET_FILTER="$asset_filter" python3 -c 'import json,os,re,sys; d=json.load(sys.stdin); xs=[a["browser_download_url"] for a in d.get("assets",[]) if re.search(os.environ["ASSET_FILTER"],a.get("name",""))]; print(xs[0] if xs else "")' <<<"$release_json")"
  [ -n "$RELEASE_TAG" ] && [ -n "$ASSET_URL" ] || die "最新 Release 中没有匹配当前架构的 AppImage。"
}

extract_release() {
  local appimage="$TMP_DIR/Chat2API.AppImage"
  log "下载官方版本 $RELEASE_TAG"
  curl -fL --retry 3 --connect-timeout 15 -o "$appimage" "$ASSET_URL"
  chmod 700 "$appimage"
  (
    cd "$TMP_DIR"
    "$appimage" --appimage-extract >/dev/null
  ) || die "AppImage 解包失败。"
  [ -x "$TMP_DIR/squashfs-root/AppRun" ] || die "解包后未找到 AppRun。"
}

install_application() {
  local new_dir="$APP_DIR/app.new" old_dir="$APP_DIR/app.previous"
  rm -rf "$new_dir" "$old_dir"
  mv "$TMP_DIR/squashfs-root" "$new_dir"
  if [ -d "$APP_DIR/app" ]; then mv "$APP_DIR/app" "$old_dir"; fi
  mv "$new_dir" "$APP_DIR/app"
}

configure_data() {
  install -d -m 700 "$APP_HOME/.chat2api" "$APP_HOME/.config" "$APP_HOME/.cache"
  if [ ! -s "$KEY_FILE" ]; then
    umask 077
    printf 'c2a_%s\n' "$(openssl rand -hex 32)" > "$KEY_FILE"
  fi
  chmod 600 "$KEY_FILE"
  CHAT2API_DATA="$DATA_FILE" CHAT2API_KEY_FILE="$KEY_FILE" CHAT2API_PORT_VALUE="$PORT" python3 - <<'PY'
import json, os, time
p=os.environ['CHAT2API_DATA']
try:
    with open(p,encoding='utf-8') as f: d=json.load(f)
except FileNotFoundError:
    d={}
d.setdefault('providers',[]); d.setdefault('accounts',[])
d.setdefault('logs',[]); d.setdefault('requestLogs',[])
d.setdefault('systemPrompts',[]); d.setdefault('sessions',[])
d.setdefault('statistics',{}); d.setdefault('userModelOverrides',{})
c=d.setdefault('config',{})
key=open(os.environ['CHAT2API_KEY_FILE'],encoding='utf-8').read().strip()
port=int(os.environ['CHAT2API_PORT_VALUE'])
c.update({'proxyPort':port,'proxyHost':'0.0.0.0','autoStartProxy':True,'enableApiKey':True})
keys=c.get('apiKeys') or []
match=next((x for x in keys if x.get('id')==f'chat2api-{port}'),None)
if match:
    match.update({'key':key,'enabled':True})
else:
    keys.append({'id':f'chat2api-{port}','name':'server-default','key':key,'enabled':True,'createdAt':int(time.time()*1000),'usageCount':0,'description':'Initial server API key'})
c['apiKeys']=keys
t=p+'.tmp'
with open(t,'w',encoding='utf-8') as f: json.dump(d,f,ensure_ascii=False,indent=2)
os.replace(t,p)
PY
  chmod 600 "$DATA_FILE"
}

write_runtime() {
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$APP_HOME"
export APPDIR="$APP_DIR/app"
export ELECTRON_DISABLE_GPU=1
exec /usr/bin/xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" "$APP_DIR/app/AppRun" --no-sandbox --disable-gpu
EOF
  chmod 700 "$LAUNCHER"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Chat2API official instance on port $PORT
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR/app
ExecStart=$LAUNCHER
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
  cat > "$META_FILE" <<EOF
TYPE=official
PROJECT_NAME=$PROJECT_NAME
PORT=$PORT
VERSION=$RELEASE_TAG
APP_DIR=$APP_DIR
SERVICE_NAME=$SERVICE_NAME
REPOSITORY=$UPSTREAM_REPO
EOF
  chmod 600 "$META_FILE"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME.service"
}

verify_service() {
  local i health="" ready=0 unauth auth key
  for i in $(seq 1 60); do
    if health="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null)" && \
       python3 -c 'import json,sys; assert json.load(sys.stdin).get("status")=="running"' <<<"$health" 2>/dev/null; then
      ready=1
      break
    fi
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
  if [ -z "$public_host" ]; then public_host="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"; fi
  printf '\n部署完成：%s %s\n' "$PROJECT_NAME" "$RELEASE_TAG"
  printf '安装目录：%s\n' "$APP_DIR"
  printf '本机 API 根地址：http://127.0.0.1:%s/\n' "$PORT"
  printf '本机 OpenAI Base URL：http://127.0.0.1:%s/v1\n' "$PORT"
  if [ -n "$public_host" ]; then
    printf '公网 API 根地址：http://%s:%s/\n' "$public_host" "$PORT"
    printf '公网 OpenAI Base URL：http://%s:%s/v1\n' "$public_host" "$PORT"
  else
    printf '公网地址探测失败；可设置 PUBLIC_HOST 后重新运行或自行使用服务器公网地址。\n'
  fi
  printf 'API Key 文件：%s（仅 root 可读，脚本不会显示密钥）\n' "$KEY_FILE"
  printf '服务状态：systemctl status %s --no-pager\n' "$SERVICE_NAME"
  printf '实时日志：journalctl -u %s -f\n' "$SERVICE_NAME"
  printf '注意：监听 0.0.0.0 不代表云安全组、UFW、NAT 或反向代理已放行端口 %s。\n' "$PORT"
}

main() {
  require_root
  PORT="$(prompt_port)"
  APP_DIR="${APP_DIR_BASE:-/opt/chat2api-official-$PORT}"
  APP_HOME="$APP_DIR/home"
  KEY_FILE="$APP_DIR/api-key.txt"
  DATA_FILE="$APP_HOME/.chat2api/data.json"
  LAUNCHER="$APP_DIR/run-chat2api.sh"
  META_FILE="$APP_DIR/.chat2api-deploy"
  SERVICE_NAME="chat2api-official-$PORT"
  UNIT_FILE="/etc/systemd/system/$SERVICE_NAME.service"
  if port_is_listening "$PORT"; then die "端口 $PORT 已被占用。"; fi
  [ ! -e "$APP_DIR" ] || die "安装目录已存在：$APP_DIR；请使用更新脚本。"
  install_packages
  install -d -m 755 "$APP_DIR"
  TMP_DIR="$(mktemp -d)"
  resolve_release
  extract_release
  install_application
  configure_data
  write_runtime
  verify_service
  rm -rf "$APP_DIR/app.previous"
  print_result
}

main "$@"
