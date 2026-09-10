#!/bin/bash
set -euo pipefail
if [[ $# != 1 && $# != 2 ]] || [[ $# == 2 && "$2" != --allow-identity-change ]]; then
  echo 'Usage: install.sh <built.app> [--allow-identity-change]' >&2
  exit 2
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="${1:?Pass the exact built .app path}"
connector_source="$(cd "$connector_source" && pwd -P)"
connector_destination="$HOME/Applications/Wallpaper Themes/Orbite Wallpaper.app"
connector_source_extension="$connector_source/Contents/Extensions/WallpaperProvider.appex"
connector_destination_extension="$connector_destination/Contents/Extensions/WallpaperProvider.appex"
test "$connector_source" != "$connector_destination"
connector_register="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
connector_identity="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_source/Contents/Info.plist")"
test "$connector_identity" = org.orbite.wallpaper
codesign --verify --deep --strict "$connector_source"
if [[ -d "$connector_destination" ]]; then
  connector_old_agent="$connector_destination/Contents/Library/LoginItems/Orbite Wallpaper Agent.app"
  connector_requirement="$(codesign -dr - "$connector_old_agent" 2>&1 | sed -n 's/^# designated => //p; s/^designated => //p')"
  test -n "$connector_requirement"
  if ! codesign --verify --strict --test-requirement "=$connector_requirement" \
      "$connector_source/Contents/Library/LoginItems/Orbite Wallpaper Agent.app" 2>/dev/null; then
    if [[ "${2:-}" != --allow-identity-change ]]; then
      echo 'Identity change refused: Accessibility may be lost. Use stable signing or explicitly plan reauthorization with --allow-identity-change.' >&2
      exit 2
    fi
    echo 'Explicit identity migration: Accessibility must be requalified in the launchd agent.'
  fi
fi
if launchctl print "gui/$(id -u)/org.orbite.wallpaper.agent" >/dev/null 2>&1; then
  echo 'Agent registered: stop the exact connector job before replacing its package.' >&2
  exit 2
fi
bash "$connector_root/pocs/macos-connector/test-native.sh" "$connector_source"
"$connector_source/Contents/MacOS/WallpaperConnector" --preflight-install
mkdir -p "$HOME/Applications/Wallpaper Themes" "$connector_root/dist/pocs/macos-connector"
while IFS= read -r connector_registered_extension; do
  [[ -n "$connector_registered_extension" ]] || continue
  case "$connector_registered_extension" in
    "$connector_destination_extension"|"$connector_source_extension") ;;
    "$connector_root"/dist/pocs/macos-connector/build.*/"Orbite Wallpaper.app/Contents/Extensions/WallpaperProvider.appex")
      pluginkit -r "$connector_registered_extension"
      connector_registered_host="${connector_registered_extension%/Contents/Extensions/WallpaperProvider.appex}"
      "$connector_register" -u "$connector_registered_host"
      ;;
    *)
      echo "Refusing unrelated provider registration: $connector_registered_extension" >&2
      exit 2
      ;;
  esac
done < <(pluginkit -m -A -D -vv -i org.orbite.wallpaper.provider | \
  sed -n 's/^[[:space:]]*Path = //p')
if test -e "$connector_destination"; then
  connector_backup="$(mktemp -d "$connector_root/dist/pocs/macos-connector/replaced.XXXXXX")"
  pluginkit -r "$connector_destination/Contents/Extensions/WallpaperProvider.appex" 2>/dev/null || true
  "$connector_register" -u "$connector_destination" 2>/dev/null || true
  mv "$connector_destination" "$connector_backup/previous-app.disabled"
  echo "Previous version preserved: $connector_backup/previous-app.disabled"
fi
ditto "$connector_source" "$connector_destination"
pluginkit -r "$connector_source_extension" 2>/dev/null || true
"$connector_register" -u "$connector_source" 2>/dev/null || true
"$connector_register" -f "$connector_destination"
pluginkit -a "$connector_destination_extension"
connector_plugins="$(pluginkit -m -A -D -vv -i org.orbite.wallpaper.provider)"
connector_paths="$(printf '%s\n' "$connector_plugins" | sed -n 's/^[[:space:]]*Path = //p')"
if [[ "$connector_paths" != "$connector_destination_extension" ]]; then
  echo 'PluginKit did not retain exactly the installed provider path.' >&2
  printf '%s\n' "$connector_plugins" >&2
  exit 2
fi
printf '%s\n' "$connector_plugins"
echo "Installed: $connector_destination"
echo 'Reopen the Wallpaper settings pane. The active wallpaper was not changed.'
