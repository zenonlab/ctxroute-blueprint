#!/bin/bash
set -euo pipefail
if [[ $# != 1 && $# != 2 ]] || [[ $# == 2 && "$2" != --allow-identity-change ]]; then
  echo 'Usage: install.sh <built.app> [--allow-identity-change]' >&2
  exit 2
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$(cd "${1:?Pass the exact built .app path}" && pwd -P)"
connector_destination="$HOME/Applications/Wallpaper Themes/Orbite Wallpaper.app"
connector_source_extension="$connector_source/Contents/Extensions/WallpaperProvider.appex"
connector_destination_extension="$connector_destination/Contents/Extensions/WallpaperProvider.appex"
connector_service="org.orbite.wallpaper.agent"
connector_job="gui/$(id -u)/$connector_service"
connector_register="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
test "$connector_source" != "$connector_destination"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$connector_source/Contents/Info.plist")" = org.orbite.wallpaper
codesign --verify --deep --strict "$connector_source"
test -x "$connector_source_extension/Contents/MacOS/WallpaperProvider"

if [[ -d "$connector_destination" ]]; then
  connector_old_agent="$connector_destination/Contents/Library/LoginItems/Orbite Wallpaper Agent.app"
  connector_requirement="$(codesign -dr - "$connector_old_agent" 2>&1 | sed -n 's/^# designated => //p; s/^designated => //p')"
  test -n "$connector_requirement"
  if ! codesign --verify --strict --test-requirement "=$connector_requirement" \
      "$connector_source/Contents/Library/LoginItems/Orbite Wallpaper Agent.app" 2>/dev/null; then
    if [[ "${2:-}" != --allow-identity-change ]]; then
      echo 'Identity change refused: use stable signing or --allow-identity-change.' >&2
      exit 2
    fi
    echo 'Explicit identity migration: Accessibility must be requalified.'
  fi
fi

if connector_state="$(launchctl print "$connector_job" 2>/dev/null)"; then
  connector_program="$(printf '%s\n' "$connector_state" | sed -n 's/^[[:space:]]*program = //p')"
  connector_expected="$connector_destination/Contents/Library/LoginItems/Orbite Wallpaper Agent.app/Contents/MacOS/WallpaperConnector"
  [[ "$connector_program" == "$connector_expected" ]] || { echo 'Refusing to stop an agent from another package.' >&2; exit 2; }
  launchctl bootout "$connector_job"
fi

mkdir -p "$HOME/Applications/Wallpaper Themes" "$connector_root/dist/pocs/macos-connector"
while IFS= read -r connector_provider; do
  [[ -n "$connector_provider" ]] || continue
  case "$connector_provider" in
    "$connector_destination"/Contents/Extensions/WallpaperProvider.appex|\
    "$connector_root"/dist/pocs/macos-connector/build.*/"Orbite Wallpaper.app/Contents/Extensions/WallpaperProvider.appex")
      pluginkit -r "$connector_provider"
      ;;
    *) echo "Refusing unrelated provider registration: $connector_provider" >&2; exit 2 ;;
  esac
done < <(pluginkit -m -A -D -vv -i org.orbite.wallpaper.provider 2>/dev/null | sed -n 's/^[[:space:]]*Path = //p')

if [[ -e "$connector_destination" ]]; then
  connector_backup="$(mktemp -d "$connector_root/dist/pocs/macos-connector/replaced.XXXXXX")"
  "$connector_register" -u "$connector_destination" 2>/dev/null || true
  mv "$connector_destination" "$connector_backup/previous-app.disabled"
  echo "Previous version preserved: $connector_backup/previous-app.disabled"
fi
ditto "$connector_source" "$connector_destination"
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
"$connector_destination/Contents/MacOS/WallpaperConnector" --check
bash "$connector_root/pocs/macos-connector/start-agent.sh" "$connector_destination" --persistent
echo "Installed: $connector_destination"
echo 'Open Orbite Wallpaper once to add a library and approve its RenderHost, then choose the theme in System Settings > Wallpaper.'
