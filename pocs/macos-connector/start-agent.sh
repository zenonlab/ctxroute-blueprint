#!/bin/bash
# Explicit, per-login-session registration. No plist is installed in LaunchAgents.
set -euo pipefail
if [[ $# != 1 && $# != 2 ]] || [[ $# == 2 && "$2" != --diagnostics ]]; then
  echo 'Usage: start-agent.sh <installed.app> [--diagnostics]' >&2
  exit 2
fi
connector_app="${1:?Pass the exact installed app path}"
connector_app="$(cd "$connector_app" && pwd -P)"
connector_service=org.wallpaperthemes.connectorpoc2.agent
connector_domain="gui/$(id -u)"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_app/Contents/Info.plist")" = org.wallpaperthemes.connectorpoc2
codesign --verify --deep --strict "$connector_app"
if launchctl print "$connector_domain/$connector_service" >/dev/null 2>&1; then
  echo 'Agent already registered; stop that exact job before replacing it.' >&2
  exit 2
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_stage="$(mktemp -d "$connector_root/dist/pocs/macos-connector/agent.XXXXXX")"
connector_job="$connector_stage/agent.plist"
plutil -create xml1 "$connector_job"
plutil -insert Label -string "$connector_service" "$connector_job"
plutil -insert ProgramArguments -array "$connector_job"
plutil -insert ProgramArguments.0 -string "$connector_app/Contents/Library/LoginItems/Wallpaper Connector Agent.app/Contents/MacOS/WallpaperConnector" "$connector_job"
/usr/libexec/PlistBuddy -c 'Add :ProgramArguments:1 string --agent' "$connector_job"
if [[ $# == 2 ]]; then
  /usr/libexec/PlistBuddy -c 'Add :ProgramArguments:2 string --diagnostics' "$connector_job"
fi
plutil -insert MachServices -dictionary "$connector_job"
/usr/libexec/PlistBuddy -c "Add :MachServices:$connector_service bool true" "$connector_job"
plutil -insert LimitLoadToSessionType -string Aqua "$connector_job"
plutil -lint "$connector_job"
launchctl bootstrap "$connector_domain" "$connector_job"
launchctl kickstart "$connector_domain/$connector_service"
echo "Agent registered for this login session: $connector_job"
echo "Stop: launchctl bootout $connector_domain/$connector_service"
