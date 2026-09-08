#!/bin/bash
# One launchd owner. Persistence is explicit; starting twice does not restart it.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo 'Usage: start-agent.sh <installed.app> [--persistent] [--diagnostics]' >&2
  exit 2
fi
connector_app="${1:?Pass the exact installed app path}"
shift
connector_persistent=false
connector_diagnostics=false
for connector_option in "$@"; do
  case "$connector_option" in
    --persistent) connector_persistent=true ;;
    --diagnostics) connector_diagnostics=true ;;
    *) echo 'Usage: start-agent.sh <installed.app> [--persistent] [--diagnostics]' >&2; exit 2 ;;
  esac
done
connector_app="$(cd "$connector_app" && pwd -P)"
connector_service=org.wallpaperthemes.connectorpoc2.agent
connector_domain="gui/$(id -u)"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_app/Contents/Info.plist")" = org.wallpaperthemes.connectorpoc2
codesign --verify --deep --strict "$connector_app"
connector_expected="$connector_app/Contents/Library/LoginItems/Wallpaper Connector Agent.app/Contents/MacOS/WallpaperConnector"
connector_state="$(launchctl print "$connector_domain/$connector_service" 2>/dev/null || true)"
if [[ -n "$connector_state" ]] && [[ "$(echo "$connector_state" | sed -n 's/^[[:space:]]*program = //p')" != "$connector_expected" ]]; then
  echo 'Refusing a job registered from a different package.' >&2; exit 2
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_stage="$(mktemp -d "$connector_root/dist/pocs/macos-connector/agent.XXXXXX")"
connector_job="$connector_stage/agent.plist"
plutil -create xml1 "$connector_job"
plutil -insert Label -string "$connector_service" "$connector_job"
plutil -insert ProgramArguments -array "$connector_job"
plutil -insert ProgramArguments.0 -string "$connector_expected" "$connector_job"
/usr/libexec/PlistBuddy -c 'Add :ProgramArguments:1 string --agent' "$connector_job"
if [[ "$connector_diagnostics" == true ]]; then
  /usr/libexec/PlistBuddy -c 'Add :ProgramArguments:2 string --diagnostics' "$connector_job"
fi
plutil -insert MachServices -dictionary "$connector_job"
/usr/libexec/PlistBuddy -c "Add :MachServices:$connector_service bool true" "$connector_job"
plutil -insert LimitLoadToSessionType -string Aqua "$connector_job"
plutil -insert RunAtLoad -bool true "$connector_job"
plutil -insert KeepAlive -dictionary "$connector_job"
/usr/libexec/PlistBuddy -c 'Add :KeepAlive:SuccessfulExit bool false' "$connector_job"
plutil -insert ThrottleInterval -integer 10 "$connector_job"
plutil -lint "$connector_job"
if [[ "$connector_persistent" == true ]]; then
  connector_login="$HOME/Library/LaunchAgents/$connector_service.plist"
  if [[ -e "$connector_login" || -L "$connector_login" ]]; then
    if [[ -L "$connector_login" ]] || \
       [[ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$connector_login")" != "$connector_service" ]] || \
       [[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$connector_login")" != "$connector_expected" ]]; then
      echo 'Refusing to replace an unrelated login item.' >&2; exit 2
    fi
    if ! cmp -s "$connector_job" "$connector_login"; then
      cp -p "$connector_login" "$connector_stage/previous-login.plist"
    fi
  fi
  connector_loaded_path="$(echo "$connector_state" | sed -n 's/^[[:space:]]*path = //p')"
  if [[ -n "$connector_state" ]] && { [[ "$connector_loaded_path" != "$connector_login" ]] || ! cmp -s "$connector_job" "$connector_login"; }; then
    launchctl bootout "$connector_domain/$connector_service"
    connector_state=""
  fi
  mkdir -p "$HOME/Library/LaunchAgents"
  if ! cmp -s "$connector_job" "$connector_login"; then
    cp "$connector_job" "$connector_login"
    chmod 600 "$connector_login"
  fi
  connector_job="$connector_login"
fi
if [[ -z "$connector_state" ]]; then
  launchctl bootstrap "$connector_domain" "$connector_job"
fi
launchctl kickstart "$connector_domain/$connector_service"
sleep 1
connector_state="$(launchctl print "$connector_domain/$connector_service")"
connector_pid="$(echo "$connector_state" | sed -n 's/^[[:space:]]*pid = //p')"
if [[ ! "$connector_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$connector_pid" 2>/dev/null; then
  echo 'Agent exited during startup. Process readiness failed; inspect the native logs.' >&2; exit 2
fi
echo "agent-process=running pid=$connector_pid input=unverified provider=unverified"
echo "Registered job: $(echo "$connector_state" | sed -n 's/^[[:space:]]*path = //p')"
echo "Stop: launchctl bootout $connector_domain/$connector_service"
