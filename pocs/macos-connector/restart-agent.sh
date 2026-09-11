#!/bin/bash
# Restart only our verified per-session connector, never Finder or a RenderHost we do not own.
set -euo pipefail
if [[ $# != 1 ]]; then
  echo 'Usage: restart-agent.sh <installed.app>' >&2
  exit 2
fi
connector_app="$(cd "$1" && pwd -P)"
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$connector_root/pocs/macos-connector/process-ownership.sh"
connector_service=org.wallpaperthemes.connectorpoc2.agent
connector_job="gui/$(id -u)/$connector_service"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_app/Contents/Info.plist")" = org.orbite.wallpaper
codesign --verify --deep --strict "$connector_app"
connector_expected="$connector_app/Contents/Library/LoginItems/Orbite Wallpaper Agent.app/Contents/MacOS/WallpaperConnector"
if connector_state="$(launchctl print "$connector_job" 2>/dev/null)"; then
  connector_program="$(echo "$connector_state" | sed -n 's/^[[:space:]]*program = //p')"
  if [[ "$connector_program" != "$connector_expected" ]]; then
    echo 'Refusing to stop an agent registered from a different package.' >&2
    exit 2
  fi
  orbite_stop_agent_children "$connector_state"
  launchctl bootout "$connector_job"
fi
if [[ -f "$HOME/Library/LaunchAgents/$connector_service.plist" ]]; then
  bash "$connector_root/pocs/macos-connector/start-agent.sh" "$connector_app" --persistent
else
  bash "$connector_root/pocs/macos-connector/start-agent.sh" "$connector_app"
fi
echo 'Connector restarted without diagnostics; discovered themes will be refreshed.'
