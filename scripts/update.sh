#!/usr/bin/env bash
set -euo pipefail

TMP_DIR=""
BACKUP_DIR=""
APP_BACKUP=""
OLD_HEAD=""

log() { printf '[Chat2API 更新] %s\n' "$*"; }
die() { printf '[Chat2API 更新] 错误：%s\n' "$*" >&2; exit 1; }
cleanup() { [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"; }
trap cleanup EXIT

require_root() { [ "$(id -u)" -eq 0 ] || die "请使用 root 或 sudo 执行。"; }

load_meta() {
  local file="$1" key value
  TYPE=""; PROJECT_NAME=""; PORT=""; VERSION=""; APP_DIR=""; SERVICE_NAME=""; REPOSITORY=""; SOURCE_DIR=""
  while IFS='=' read -r key value; do
    case "$key" in
      TYPE|PROJECT_NAME|PORT|VERSION|APP_DIR|SERVICE_NAME|REPOSITORY|SOURCE_DIR) printf -v "$key" '%s' "$value" ;;
    esac
  done < "$file"
  [ -n "$TYPE" ] && [ -n "$PORT" ] && [ -n "$APP_DIR" ] && [ -n "$SERVICE_NAME" ]
}

discover_instances() {
  META_FILES=()
  local file seen="|"
  shopt -s nullglob
  for file in /opt/chat2api-*/.chat2api-deploy /opt/chat2api-official-*/.chat2api-deploy; do
    case "$seen" in *"|$file|"*) continue ;; esac
    if load_meta "$file"; then
      META_FILES+=("$file")
      seen+="$file|"
    fi
  done
  shopt -u nullglob
  [ "${#META_FILES[@]}" -gt 0 ] || die "没有发现由本仓库脚本创建的 Chat2API 实例。"
}

show_instances() {
  local i file
  printf '%-4s %-22s %-8s %-16s %s\n' '编号' '项目名' '端口' '版本号' '项目目录'
  for i in "${!META_FILES[@]}"; do
    file="${META_FILES[$i]}"; load_meta "$file"
    printf '%-4s %-22s %-8s %-16s %s\n' "$((i+1))" "$PROJECT_NAME" "$PORT" "$VERSION" "$APP_DIR"
  done
}

select_instance() {
  local selection="${CHAT2API_SELECT:-}" i file matched=""
  if [ -z "$selection" ]; then
    [ -r /dev/tty ] || die "无法读取交互终端；请设置 CHAT2API_SELECT 为编号或端口。"
    read -r -p "请输入编号或端口: " selection </dev/tty
  fi
  [[ "$selection" =~ ^[0-9]+$ ]] || die "请输入数字编号或端口。"
  if [ "$selection" -ge 1 ] && [ "$selection" -le "${#META_FILES[@]}" ]; then
    SELECTED_META="${META_FILES[$((selection-1))]}"
    return
  fi
  for file in "${META_FILES[@]}"; do
    load_meta "$file"
    if [ "$PORT" = "$selection" ]; then
      [ -z "$matched" ] || die "端口 $selection 对应多个实例，请按编号选择。"
      matched="$file"
    fi
  done
  [ -n "$matched" ] || die "未找到编号或端口：$selection"
  SELECTED_META="$matched"
}

backup_persistent() {
  BACKUP_DIR="$APP_DIR/backups/update-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 700 "$BACKUP_DIR"
  [ ! -f "$APP_DIR/api-key.txt" ] || cp -a "$APP_DIR/api-key.txt" "$BACKUP_DIR/"
  [ ! -d "$APP_DIR/home/.chat2api" ] || cp -a "$APP_DIR/home/.chat2api" "$BACKUP_DIR/"
  cp -a "$SELECTED_META" "$BACKUP_DIR/deploy-meta"
}

verify_service() {
  local health="" ready=0 i unauth auth key_file="$APP_DIR/api-key.txt" key
  for i in $(seq 1 90); do
    if health="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null)" && python3 -c 'import json,sys; assert json.load(sys.stdin).get("status")=="running"' <<<"$health" 2>/dev/null; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" -eq 1 ] || return 1
  unauth="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/models")"
  [ "$unauth" = 401 ] || return 1
  [ -s "$key_file" ] || return 1
  key="$(<"$key_file")"
  auth="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $key" "http://127.0.0.1:$PORT/v1/models")"
  [ "$auth" = 200 ]
}

write_meta_version() {
  local new_version="$1"
  META_PATH="$SELECTED_META" NEW_VERSION="$new_version" python3 - <<'PY'
import os
p=os.environ['META_PATH']; version=os.environ['NEW_VERSION']
lines=open(p,encoding='utf-8').read().splitlines()
out=[]; found=False
for line in lines:
    if line.startswith('VERSION='):
        out.append('VERSION='+version); found=True
    else: out.append(line)
if not found: out.append('VERSION='+version)
t=p+'.tmp'; open(t,'w').write('\n'.join(out)+'\n'); os.replace(t,p)
PY
  chmod 600 "$SELECTED_META"
}

update_fork() {
  SOURCE_DIR="${SOURCE_DIR:-$APP_DIR/source}"
  [ -d "$SOURCE_DIR/.git" ] || die "Fork 源码目录不是 Git 仓库：$SOURCE_DIR"
  [ -z "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)" ] || die "源码存在已跟踪的本地修改，已停止更新。"
  OLD_HEAD="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
  git -C "$SOURCE_DIR" fetch origin main
  git -C "$SOURCE_DIR" merge-base --is-ancestor "$OLD_HEAD" origin/main || die "远程 main 不是当前版本的快进更新，已停止。"
  if [ "$OLD_HEAD" = "$(git -C "$SOURCE_DIR" rev-parse origin/main)" ]; then
    log "Fork 已是最新版本。"
  else
    git -C "$SOURCE_DIR" merge --ff-only origin/main
  fi
  APP_BACKUP="$APP_DIR/app-build.previous"
  rm -rf "$APP_BACKUP"
  [ ! -d "$SOURCE_DIR/dist/linux-unpacked" ] || cp -a "$SOURCE_DIR/dist/linux-unpacked" "$APP_BACKUP"
  if ! (cd "$SOURCE_DIR" && npm ci && npm run build:unpack); then
    git -C "$SOURCE_DIR" reset --keep "$OLD_HEAD" || true
    [ ! -d "$APP_BACKUP" ] || { rm -rf "$SOURCE_DIR/dist/linux-unpacked"; mv "$APP_BACKUP" "$SOURCE_DIR/dist/linux-unpacked"; }
    die "Fork 构建失败，已尝试回滚。"
  fi
  local executable
  executable="$(find "$SOURCE_DIR/dist" -maxdepth 3 -type f -name chat2api -perm -111 -print -quit 2>/dev/null || true)"
  [ -n "$executable" ] || die "更新后未找到可执行文件。"
  cat > "$APP_DIR/run-chat2api.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$APP_DIR/home"
export ELECTRON_DISABLE_GPU=1
exec /usr/bin/xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" "$executable" --no-sandbox --disable-gpu
EOF
  chmod 700 "$APP_DIR/run-chat2api.sh"
  systemctl restart "$SERVICE_NAME.service"
  if ! verify_service; then
    systemctl stop "$SERVICE_NAME.service" || true
    git -C "$SOURCE_DIR" reset --keep "$OLD_HEAD" || true
    if [ -d "$APP_BACKUP" ]; then rm -rf "$SOURCE_DIR/dist/linux-unpacked"; mv "$APP_BACKUP" "$SOURCE_DIR/dist/linux-unpacked"; fi
    systemctl start "$SERVICE_NAME.service" || true
    die "新版本验收失败，已尝试回滚至原 HEAD。"
  fi
  VERSION="$(git -C "$SOURCE_DIR" rev-parse --short=12 HEAD)"
  write_meta_version "$VERSION"
  rm -rf "$APP_BACKUP"
}

resolve_official_release() {
  local arch filter json
  arch="$(uname -m)"
  case "$arch" in x86_64|amd64) filter='x86_64.AppImage$';; aarch64|arm64) filter='arm64.AppImage$';; *) die "暂不支持架构：$arch";; esac
  json="$(curl -fsSL --retry 3 "https://api.github.com/repos/xiaoY233/Chat2API/releases/latest")"
  RELEASE_TAG="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' <<<"$json")"
  ASSET_URL="$(ASSET_FILTER="$filter" python3 -c 'import json,os,re,sys; d=json.load(sys.stdin); a=[x["browser_download_url"] for x in d.get("assets",[]) if re.search(os.environ["ASSET_FILTER"],x.get("name",""))]; print(a[0] if a else "")' <<<"$json")"
  [ -n "$RELEASE_TAG" ] && [ -n "$ASSET_URL" ] || die "最新 Release 缺少匹配架构的 AppImage。"
}

update_official() {
  resolve_official_release
  if [ "$VERSION" = "$RELEASE_TAG" ]; then log "官方版已是最新版本 $VERSION。"; return; fi
  TMP_DIR="$(mktemp -d)"
  curl -fL --retry 3 -o "$TMP_DIR/Chat2API.AppImage" "$ASSET_URL"
  chmod 700 "$TMP_DIR/Chat2API.AppImage"
  (cd "$TMP_DIR" && ./Chat2API.AppImage --appimage-extract >/dev/null)
  [ -x "$TMP_DIR/squashfs-root/AppRun" ] || die "新版 AppImage 解包失败。"
  APP_BACKUP="$APP_DIR/app.previous"
  rm -rf "$APP_BACKUP" "$APP_DIR/app.new"
  mv "$TMP_DIR/squashfs-root" "$APP_DIR/app.new"
  systemctl stop "$SERVICE_NAME.service"
  mv "$APP_DIR/app" "$APP_BACKUP"
  mv "$APP_DIR/app.new" "$APP_DIR/app"
  systemctl start "$SERVICE_NAME.service"
  if ! verify_service; then
    systemctl stop "$SERVICE_NAME.service" || true
    rm -rf "$APP_DIR/app"
    mv "$APP_BACKUP" "$APP_DIR/app"
    systemctl start "$SERVICE_NAME.service" || true
    die "新版本验收失败，已回滚旧应用目录。"
  fi
  VERSION="$RELEASE_TAG"
  write_meta_version "$VERSION"
  rm -rf "$APP_BACKUP"
}

main() {
  require_root
  discover_instances
  show_instances
  select_instance
  load_meta "$SELECTED_META" || die "实例元数据损坏。"
  printf '\n将更新：%s，端口 %s，目录 %s\n' "$PROJECT_NAME" "$PORT" "$APP_DIR"
  backup_persistent
  case "$TYPE" in
    fork) update_fork ;;
    official) update_official ;;
    *) die "未知实例类型：$TYPE" ;;
  esac
  verify_service || die "更新后的最终验收失败。"
  printf '\n更新完成：%s %s\n' "$PROJECT_NAME" "$VERSION"
  printf '端口：%s\n项目目录：%s\n备份目录：%s\n' "$PORT" "$APP_DIR" "$BACKUP_DIR"
  printf '状态：systemctl status %s --no-pager\n' "$SERVICE_NAME"
}
main "$@"
