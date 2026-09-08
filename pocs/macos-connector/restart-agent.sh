#!/bin/bash
# Restart only our verified per-session connector, never Finder or WallpaperAgent.
set -euo pipefail
if [[ $# != 1 ]]; then
  echo 'Usage: restart-agent.sh <installed.app>' >&2
  exit 2
fi
connector_app="$(cd "$1" && pwd -P)"
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_job="gui/$(id -u)/org.wallpaperthemes.connectorpoc2.agent"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_app/Contents/Info.plist")" = org.wallpaperthemes.connectorpoc2
codesign --verify --deep --strict "$connector_app"
connector_expected="$connector_app/Contents/Library/LoginItems/Wallpaper Connector Agent.app/Contents/MacOS/WallpaperConnector"
if connector_state="$(launchctl print "$connector_job" 2>/dev/null)"; then
  connector_program="$(echo "$connector_state" | sed -n 's/^[[:space:]]*program = //p')"
  if [[ "$connector_program" != "$connector_expected" ]]; then
    echo 'Refusing to stop an agent registered from a different package.' >&2
    exit 2
  fi
  launchctl bootout "$connector_job"
fi
bash "$connector_root/pocs/macos-connector/start-agent.sh" "$connector_app"
echo 'Connector restarted without diagnostics; native receipt still required. Provider is not restarted.'
