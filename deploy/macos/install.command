#!/bin/bash
set -euo pipefail

REPO_SLUG="${DOSLINEAS_REPO_SLUG:-podcast-lab/doslineas}"
REF="${DOSLINEAS_REF:-main}"
NODE_MAJOR=22
FFMPEG_MIN_MAJOR=7
APP_NAME="Dos Lineas"
LABEL_WORKER="com.doslineas.worker"
LABEL_PANEL="com.doslineas.panel"
SERVICE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

FORCE=0
ASK_KEYS=0
for argument in "$@"; do
  case "$argument" in
    --force) FORCE=1 ;;
    --keys) ASK_KEYS=1 ;;
    *) echo "unknown option $argument (use --force or --keys)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS"

if [ "$(id -u)" -eq 0 ]; then
  TARGET_USER="${DOSLINEAS_USER:-$(stat -f%Su /dev/console)}"
  [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ] || fail "run as root, set DOSLINEAS_USER to the desktop user"
else
  TARGET_USER="$(id -un)"
fi
TARGET_UID="$(id -u "$TARGET_USER")"
TARGET_HOME="$(dscl . -read "/Users/$TARGET_USER" NFSHomeDirectory | awk '{print $2}')"
[ -d "$TARGET_HOME" ] || fail "no home directory for $TARGET_USER"

ROOT="${DOSLINEAS_ROOT:-$TARGET_HOME/doslineas}"
APP="$ROOT/app"
ENV_FILE="$APP/.env"
AGENTS="$TARGET_HOME/Library/LaunchAgents"
LOGS="$ROOT/logs"

as_user() {
  if [ "$(id -u)" -eq 0 ]; then sudo -u "$TARGET_USER" -H env PATH="$SERVICE_PATH" "$@"; else env PATH="$SERVICE_PATH:$PATH" "$@"; fi
}
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}
ask() {
  local prompt="$1" answer=""
  if [ -r /dev/tty ]; then
    printf '   %s' "$prompt" > /dev/tty
    IFS= read -r answer < /dev/tty || true
  fi
  printf '%s' "$answer"
}

WORK="$(mktemp -d /tmp/doslineas.XXXXXX)"
chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "Installing $APP_NAME for $TARGET_USER in $ROOT"

step "Node.js $NODE_MAJOR"
node_major() { /usr/local/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -ge "$NODE_MAJOR" ]; then
  info "already there: $(/usr/local/bin/node -v)"
else
  sums="$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/SHASUMS256.txt")"
  pkg="$(printf '%s\n' "$sums" | awk '/\.pkg$/ {print $2; exit}')"
  [ -n "$pkg" ] || fail "nodejs.org did not list a macOS installer"
  info "downloading $pkg"
  curl -fsSL -o "$WORK/$pkg" "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$pkg"
  expected="$(printf '%s\n' "$sums" | awk -v name="$pkg" '$2 == name {print $1}')"
  actual="$(shasum -a 256 "$WORK/$pkg" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || fail "the Node.js installer does not match its checksum"
  as_root installer -pkg "$WORK/$pkg" -target / > /dev/null
  info "installed $(/usr/local/bin/node -v)"
fi

step "FFmpeg $FFMPEG_MIN_MAJOR or newer"
tool_major() { "/usr/local/bin/$1" -version 2>/dev/null | awk 'NR==1 {split($3, v, "."); print v[1] + 0}' || echo 0; }
for tool in ffmpeg ffprobe; do
  current="$(tool_major "$tool")"
  if [ "${current:-0}" -ge "$FFMPEG_MIN_MAJOR" ]; then
    info "$tool already there: $("/usr/local/bin/$tool" -version | awk 'NR==1 {print $3}')"
    continue
  fi
  [ "$(uname -m)" = "x86_64" ] || fail "the static FFmpeg builds of evermeet.cx are for Intel Macs; install $tool by hand"
  curl -fsSL -o "$WORK/$tool.json" "https://evermeet.cx/ffmpeg/info/$tool/release"
  url="$(plutil -extract download.zip.url raw -o - "$WORK/$tool.json")"
  info "downloading $url"
  curl -fsSL -o "$WORK/$tool.zip" "$url"
  unzip -oq "$WORK/$tool.zip" -d "$WORK/$tool"
  as_root mkdir -p /usr/local/bin
  as_root install -m 0755 "$WORK/$tool/$tool" "/usr/local/bin/$tool"
  as_root xattr -d com.apple.quarantine "/usr/local/bin/$tool" 2>/dev/null || true
  info "installed $tool $("/usr/local/bin/$tool" -version | awk 'NR==1 {print $3}')"
done

step "Stopping the services"
if [ "$FORCE" -eq 0 ] && pgrep -u "$TARGET_UID" -f "apps/cli/src/index.ts" > /dev/null; then
  fail "a step is running right now (a render or a transcription); try again when it ends, or pass --force to cut it"
fi
for label in "$LABEL_WORKER" "$LABEL_PANEL"; do
  launchctl bootout "gui/$TARGET_UID/$label" 2>/dev/null && info "stopped $label" || true
done

step "The software ($REPO_SLUG@$REF)"
curl -fsSL -o "$WORK/app.tar.gz" "https://codeload.github.com/$REPO_SLUG/tar.gz/$REF"
as_user mkdir -p "$ROOT"
staging="$ROOT/app.new"
rm -rf "$staging"
as_user mkdir -p "$staging"
as_user tar -xzf "$WORK/app.tar.gz" -C "$staging" --strip-components 1
for previous in "$ENV_FILE" "$TARGET_HOME/podcast-tool/.env"; do
  if [ -f "$previous" ]; then
    as_user cp "$previous" "$staging/.env"
    info "kept the settings of $previous"
    break
  fi
done
rm -rf "$ROOT/app.old"
[ -d "$APP" ] && mv "$APP" "$ROOT/app.old"
mv "$staging" "$APP"
info "unpacked in $APP"

step "Dependencies"
pnpm_version="$(/usr/local/bin/node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$APP/package.json")"
if [ "$(/usr/local/bin/pnpm -v 2>/dev/null || true)" != "$pnpm_version" ]; then
  as_root /usr/local/bin/npm install -g "pnpm@$pnpm_version" > /dev/null
fi
info "pnpm $(/usr/local/bin/pnpm -v)"
(cd "$APP" && as_user /usr/local/bin/pnpm install --frozen-lockfile --reporter=silent)
info "installed"

step "Settings"
as_user mkdir -p "$ROOT/sessions" "$ROOT/delivered" "$ROOT/state" "$LOGS"
[ -f "$ENV_FILE" ] || as_user touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
current_value() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); value = $0} END {print value}' "$ENV_FILE"; }
set_value() {
  local key="$1" value="$2"
  awk -F= -v key="$key" '$1 != key' "$ENV_FILE" > "$WORK/env"
  printf '%s=%s\n' "$key" "$value" >> "$WORK/env"
  cat "$WORK/env" > "$ENV_FILE"
}
default_value() { [ -n "$(current_value "$1")" ] || set_value "$1" "$2"; }

set_value DOSLINEAS_REPO "$APP"
default_value DOSLINEAS_SESSIONS "$ROOT/sessions"
default_value DOSLINEAS_DELIVERY "$ROOT/delivered"
default_value DOSLINEAS_DB "$ROOT/state/jobs.db"
default_value DOSLINEAS_PORT 4310
if /usr/local/bin/ffmpeg -hide_banner -h encoder=h264_videotoolbox 2>/dev/null | grep h264_videotoolbox > /dev/null; then
  default_value DOSLINEAS_ENCODER h264_videotoolbox
fi

for key in DEEPGRAM_API_KEY ANTHROPIC_API_KEY; do
  if [ -n "$(current_value "$key")" ] && [ "$ASK_KEYS" -eq 0 ]; then
    info "$key is set"
    continue
  fi
  value="$(ask "$key (leave empty to skip): ")"
  [ -n "$value" ] && set_value "$key" "$value"
  if [ -n "$(current_value "$key")" ]; then info "$key is set"; else info "$key is EMPTY"; fi
done
[ -n "$(current_value DEEPGRAM_API_KEY)" ] || info "without DEEPGRAM_API_KEY the transcription step will fail"
PORT="$(current_value DOSLINEAS_PORT)"
info "encoder: $(current_value DOSLINEAS_ENCODER || true)"

step "Services"
write_agent() {
  local label="$1" entry="$2" name="$3"
  cat > "$WORK/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP/node_modules/.bin/tsx</string>
    <string>--env-file-if-exists=$ENV_FILE</string>
    <string>$entry</string>
  </array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$SERVICE_PATH</string>
    <key>DOSLINEAS_REPO</key><string>$APP</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOGS/$name.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$name.log</string>
</dict>
</plist>
PLIST
  as_user mkdir -p "$AGENTS"
  as_user cp "$WORK/$label.plist" "$AGENTS/$label.plist"
  launchctl bootstrap "gui/$TARGET_UID" "$AGENTS/$label.plist" \
    || fail "could not start $label; is $TARGET_USER logged in on the iMac's screen?"
  info "started $label (log in $LOGS/$name.log)"
}
write_agent "$LABEL_WORKER" "$APP/apps/worker/src/main.ts" worker
write_agent "$LABEL_PANEL" "$APP/apps/api/src/main.ts" panel

step "The $APP_NAME icon"
launcher="$TARGET_HOME/Applications/$APP_NAME.app"
cat > "$WORK/launcher.applescript" <<SCRIPT
do shell script "uid=\$(id -u); launchctl kickstart gui/\$uid/$LABEL_PANEL; launchctl kickstart gui/\$uid/$LABEL_WORKER; for i in \$(seq 1 30); do curl -fs -o /dev/null http://localhost:$PORT && exit 0; sleep 1; done; exit 0"
open location "http://localhost:$PORT"
SCRIPT
as_user mkdir -p "$TARGET_HOME/Applications"
rm -rf "$launcher"
as_user osacompile -o "$launcher" "$WORK/launcher.applescript"
info "created $launcher"
url="file://$(printf '%s' "$launcher" | sed 's/ /%20/g')/"
if ! as_user defaults read com.apple.dock persistent-apps 2>/dev/null | grep "$url" > /dev/null; then
  as_user defaults write com.apple.dock persistent-apps -array-add \
    "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$url</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
  as_user killall Dock 2>/dev/null || true
  info "added to the Dock"
fi

step "Checks"
if [ "$(current_value DOSLINEAS_ENCODER)" = "h264_videotoolbox" ]; then
  if /usr/local/bin/ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=1920x1080:rate=25 -t 2 \
    -c:v h264_videotoolbox -b:v 16M -y "$WORK/check.mp4"; then
    info "VideoToolbox encodes"
  else
    info "VideoToolbox did NOT encode; remove DOSLINEAS_ENCODER from $ENV_FILE to render on the CPU"
  fi
fi
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://localhost:$PORT" && break
  sleep 1
done
if curl -fs -o /dev/null "http://localhost:$PORT"; then
  info "the panel answers on http://localhost:$PORT"
else
  fail "the panel does not answer; look at $LOGS/panel.log"
fi
launchctl print "gui/$TARGET_UID/$LABEL_WORKER" 2>/dev/null | grep "state = running" > /dev/null \
  || fail "the worker is not running; look at $LOGS/worker.log"
info "the worker is running"
rm -rf "$ROOT/app.old"

printf '\n\033[32mDone.\033[0m Sessions go into %s; open "%s" from the Dock to see them.\n' "$ROOT/sessions" "$APP_NAME"
