#!/bin/bash
set -euo pipefail
if [[ $# != 1 && $# != 2 ]] || [[ $# == 2 && "$2" != --allow-identity-change ]]; then
  echo 'Usage: install.sh <built.app> [--allow-identity-change]' >&2
  exit 2
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="${1:?Pass the exact built .app path}"
connector_source="$(cd "$connector_source" && pwd -P)"
connector_destination="$HOME/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app"
test "$connector_source" != "$connector_destination"
connector_register="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
connector_identity="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_source/Contents/Info.plist")"
test "$connector_identity" = org.wallpaperthemes.connectorpoc2
codesign --verify --deep --strict "$connector_source"
if [[ -d "$connector_destination" ]]; then
  connector_old_agent="$connector_destination/Contents/Library/LoginItems/Wallpaper Connector Agent.app"
  connector_requirement="$(codesign -dr - "$connector_old_agent" 2>&1 | sed -n 's/^# designated => //p; s/^designated => //p')"
  test -n "$connector_requirement"
  if ! codesign --verify --strict --test-requirement "=$connector_requirement" \
      "$connector_source/Contents/Library/LoginItems/Wallpaper Connector Agent.app" 2>/dev/null; then
    if [[ "${2:-}" != --allow-identity-change ]]; then
      echo 'Identity change refused: Accessibility may be lost. Use stable signing or explicitly plan reauthorization with --allow-identity-change.' >&2
      exit 2
    fi
    echo 'Explicit identity migration: Accessibility must be requalified in the launchd agent.'
  fi
fi
if launchctl print "gui/$(id -u)/org.wallpaperthemes.connectorpoc2.agent" >/dev/null 2>&1; then
  echo 'Agent registered: stop the exact connector job before replacing its package.' >&2
  exit 2
fi
bash "$connector_root/pocs/macos-connector/test-native.sh" "$connector_source"
"$connector_source/Contents/MacOS/WallpaperConnector" --preflight-install
mkdir -p "$HOME/Applications/Wallpaper Themes" "$connector_root/dist/pocs/macos-connector"
if test -e "$connector_destination"; then
  connector_backup="$(mktemp -d "$connector_root/dist/pocs/macos-connector/replaced.XXXXXX")"
  pluginkit -r "$connector_destination/Contents/Extensions/WallpaperProvider.appex"
  "$connector_register" -u "$connector_destination"
  mv "$connector_destination" "$connector_backup/previous-app.disabled"
  echo "Previous version preserved: $connector_backup/previous-app.disabled"
fi
ditto "$connector_source" "$connector_destination"
"$connector_register" -f "$connector_destination"
pluginkit -a "$connector_destination/Contents/Extensions/WallpaperProvider.appex"
pluginkit -m -A -D -v -i org.wallpaperthemes.connectorpoc2.extension
echo "Installed: $connector_destination"
echo 'Reopen the Wallpaper settings pane. The active wallpaper was not changed.'
