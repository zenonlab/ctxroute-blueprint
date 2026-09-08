#!/bin/bash
set -euo pipefail
connector_identity=-
connector_team=""
connector_development=false
if [[ $# == 1 && "$1" == --help ]]; then
  echo 'Usage: build.sh [--development | --sign CERTIFICATE_SHA1 TEAM_ID] (no installation)'
  exit 0
elif [[ $# == 1 && "$1" == --development ]]; then
  connector_development=true
elif [[ $# != 0 ]]; then
  if [[ $# != 3 || "$1" != --sign || ! "$2" =~ ^[A-Fa-f0-9]{40}$ || ! "$3" =~ ^[A-Z0-9]{10}$ ]]; then
    echo 'Expected --sign CERTIFICATE_SHA1 TEAM_ID; no build created.' >&2
    exit 2
  fi
  connector_identity="$(echo "$2" | tr '[:lower:]' '[:upper:]')"
  connector_team="$3"
  if ! security find-identity -v -p codesigning | awk -v fingerprint="$connector_identity" '$2 == fingerprint { found=1 } END { exit !found }'; then
    echo 'Selected signing identity is unavailable; no ad hoc fallback.' >&2
    exit 2
  fi
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$connector_root/pocs/macos-connector"
connector_base="$connector_root/dist/pocs/macos-connector"
mkdir -p "$connector_base"
connector_stage="$(mktemp -d "$connector_base/build.XXXXXX")"
for connector_role in App Extension; do
  cp "$connector_source/Packaging/$connector_role.entitlements" "$connector_stage/$connector_role.entitlements"
  if [[ -n "$connector_team" ]]; then
    /usr/libexec/PlistBuddy -c "Set :com.apple.security.application-groups:0 $connector_team.org.wallpaperthemes.connectorpoc2" "$connector_stage/$connector_role.entitlements"
  elif [[ "$connector_development" == true ]]; then
    /usr/libexec/PlistBuddy -c 'Set :com.apple.security.application-groups:0 group.org.wallpaperthemes.connectorpoc2.local' "$connector_stage/$connector_role.entitlements"
  fi
done
connector_app="$connector_stage/Wallpaper Connector PoC 2.app"
connector_extension="$connector_app/Contents/Extensions/WallpaperProvider.appex"
connector_sdk="$(env -u SDKROOT xcrun --sdk macosx --show-sdk-path)"
connector_arch="$(uname -m)"
mkdir -p "$connector_app/Contents/MacOS" "$connector_app/Contents/Resources" \
  "$connector_extension/Contents/MacOS" "$connector_extension/Contents/Resources"
cp "$connector_source/Packaging/App.plist" "$connector_app/Contents/Info.plist"
cp "$connector_source/Packaging/Extension.plist" "$connector_extension/Contents/Info.plist"
for connector_bundle in "$connector_app" "$connector_extension"; do
  cp "$connector_source"/Sources/ThemeModel/Resources/*.json "$connector_bundle/Contents/Resources/"
  cp "$connector_source/Native/Bridge/LICENSE" "$connector_bundle/Contents/Resources/Phosphene-LICENSE"
done
connector_shared=("$connector_source/Sources/ThemeModel/Theme.swift"
  "$connector_source/Sources/ThemeModel/GestureRouter.swift"
  "$connector_source/Sources/ThemeModel/LaunchPolicy.swift"
  "$connector_source/Sources/SceneRenderer/Scene.swift"
  "$connector_source/Sources/ConnectorTransport/Mailbox.swift")
connector_flags=(-sdk "$connector_sdk" -target "$connector_arch-apple-macos26.0"
  -swift-version 6 -warnings-as-errors -parse-as-library -O
  -module-cache-path "$connector_base/module-cache")
if [[ "$connector_development" == true ]]; then
  connector_flags+=(-D CONNECTOR_LOCAL_DEVELOPMENT)
fi
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" "${connector_shared[@]}" \
  "$connector_source"/App/*.swift -o "$connector_app/Contents/MacOS/WallpaperConnector"
"$connector_app/Contents/MacOS/WallpaperConnector" --thumbnails "$connector_extension/Contents/Resources"
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" -module-name WallpaperProvider \
  -import-objc-header "$connector_source/Native/Bridge/WallpaperExtension-Bridging-Header.h" \
  "${connector_shared[@]}" "$connector_source"/Native/*.swift "$connector_source"/Native/Bridge/*.swift \
  -Xlinker -e -Xlinker _NSExtensionMain -o "$connector_extension/Contents/MacOS/WallpaperProvider"
bash "$connector_source/test-native.sh" "$connector_app"
codesign --sign "$connector_identity" --entitlements "$connector_stage/Extension.entitlements" "$connector_extension"
codesign --sign "$connector_identity" --entitlements "$connector_stage/App.entitlements" "$connector_app"
codesign --verify --deep --strict "$connector_app"
if [[ -n "$connector_team" ]]; then
  for connector_bundle in "$connector_app" "$connector_extension"; do
    connector_actual_team="$(codesign -dv "$connector_bundle" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
    if [[ "$connector_actual_team" != "$connector_team" ]]; then
      echo 'Signed Team ID differs from requested team; do not install this build.' >&2
      exit 2
    fi
    codesign -d --entitlements :- "$connector_bundle" > "$connector_stage/verified-entitlements.plist" 2>/dev/null
    connector_actual_group="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.application-groups:0' "$connector_stage/verified-entitlements.plist")"
    if [[ "$connector_actual_group" != "$connector_team.org.wallpaperthemes.connectorpoc2" ]]; then
      echo 'Signed App Group differs from requested group; do not install this build.' >&2
      exit 2
    fi
  done
fi
plutil -lint "$connector_app/Contents/Info.plist" "$connector_extension/Contents/Info.plist"
for connector_manifest in "$connector_source"/Sources/ThemeModel/Resources/*.json; do
  connector_name="$(basename "$connector_manifest")"
  cmp "$connector_app/Contents/Resources/$connector_name" "$connector_extension/Contents/Resources/$connector_name"
done
echo "$connector_app"
