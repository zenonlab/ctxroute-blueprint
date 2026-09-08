#!/bin/bash
set -euo pipefail
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="${1:?Pass the exact built .app path}"
connector_source="$(cd "$connector_source" && pwd -P)"
connector_destination="$HOME/Applications/Wallpaper Themes/Wallpaper Connector PoC 2.app"
test "$connector_source" != "$connector_destination"
connector_register="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
connector_identity="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_source/Contents/Info.plist")"
test "$connector_identity" = org.wallpaperthemes.connectorpoc2
codesign --verify --deep --strict "$connector_source"
bash "$connector_root/pocs/macos-connector/test-native.sh" "$connector_source"
if pgrep -x WallpaperConnector >/dev/null; then
  echo 'Quit Wallpaper Connector before installation. No process was stopped.' >&2
  exit 1
fi
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
