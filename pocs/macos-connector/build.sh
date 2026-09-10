#!/bin/bash
set -euo pipefail
connector_identity=-
connector_local_background="${CONNECTOR_LOCAL_BACKGROUND_PATH:-}"
if [[ $# == 1 && "$1" == --help ]]; then
  echo 'Usage: build.sh [--sign CERTIFICATE_SHA1] (no installation)'
  exit 0
elif [[ $# == 2 && "$1" == --sign && "$2" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  connector_identity="$(echo "$2" | tr '[:lower:]' '[:upper:]')"
  if ! security find-identity -v -p codesigning | awk -v fingerprint="$connector_identity" '$2 == fingerprint { found=1 } END { exit !found }'; then
    echo 'Local signing identity unavailable; no ad hoc fallback.' >&2
    exit 2
  fi
elif [[ $# != 0 ]]; then
  echo 'Expected --sign CERTIFICATE_SHA1; no build created.' >&2
  exit 2
fi
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$connector_root/pocs/macos-connector"
connector_base="$connector_root/dist/pocs/macos-connector"
mkdir -p "$connector_base"
connector_stage="$(mktemp -d "$connector_base/build.XXXXXX")"
cp "$connector_source/Packaging/App.entitlements" "$connector_stage/App.entitlements"
cp "$connector_source/Packaging/Extension.entitlements" "$connector_stage/Extension.entitlements"
connector_app="$connector_stage/Orbite Wallpaper.app"
connector_extension="$connector_app/Contents/Extensions/WallpaperProvider.appex"
connector_agent="$connector_app/Contents/Library/LoginItems/Orbite Wallpaper Agent.app"
connector_sdk="$(env -u SDKROOT xcrun --sdk macosx --show-sdk-path)"
connector_arch="$(uname -m)"
mkdir -p "$connector_app/Contents/MacOS" "$connector_app/Contents/Resources" \
  "$connector_extension/Contents/MacOS" "$connector_extension/Contents/Resources"
cp "$connector_source/Packaging/App.plist" "$connector_app/Contents/Info.plist"
cp "$connector_source/Packaging/Extension.plist" "$connector_extension/Contents/Info.plist"
for connector_bundle in "$connector_app" "$connector_extension"; do
  cp "$connector_source"/Sources/ThemeModel/Resources/*.json "$connector_bundle/Contents/Resources/"
  cp "$connector_source/Native/Bridge/LICENSE" "$connector_bundle/Contents/Resources/Phosphene-LICENSE"
  cp "$connector_source/Packaging/Lucide-LICENSE" "$connector_bundle/Contents/Resources/Lucide-LICENSE"
done
if [[ -n "$connector_local_background" ]]; then
  if [[ "$connector_local_background" != /* || ! -f "$connector_local_background" || -L "$connector_local_background" ]]; then
    echo 'CONNECTOR_LOCAL_BACKGROUND_PATH must name an absolute regular PNG file.' >&2
    exit 2
  fi
  if ! sips -g format "$connector_local_background" 2>/dev/null | grep -q 'format: png'; then
    echo 'CONNECTOR_LOCAL_BACKGROUND_PATH is not a readable PNG.' >&2
    exit 2
  fi
  cp "$connector_local_background" "$connector_app/Contents/Resources/theme-background.png"
  cp "$connector_local_background" "$connector_extension/Contents/Resources/theme-background.png"
  for connector_bundle in "$connector_app" "$connector_extension"; do
    plutil -insert background_asset -string theme-background.png \
      "$connector_bundle/Contents/Resources/theme.json"
  done
fi
connector_shared=("$connector_source/Sources/ThemeModel/Theme.swift"
  "$connector_source/Sources/ThemeModel/ThemeDiscovery.swift"
  "$connector_source/Sources/ThemeModel/ThemeLayout.swift"
  "$connector_source/Sources/ThemeModel/ThemeStore.swift"
  "$connector_source/Sources/ThemeModel/ProductIdentity.swift"
  "$connector_source/Sources/ThemeModel/GestureRouter.swift"
  "$connector_source/Sources/ThemeModel/LaunchPolicy.swift"
  "$connector_source/Sources/SceneRenderer/Scene.swift")
connector_shared+=("$connector_source/Sources/ConnectorTransport/NativeXPC.swift")
connector_flags=(-sdk "$connector_sdk" -target "$connector_arch-apple-macos26.0"
  -swift-version 6 -warnings-as-errors -parse-as-library -O
  -module-cache-path "$connector_base/module-cache")
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" "${connector_shared[@]}" \
  "$connector_source"/App/*.swift -o "$connector_app/Contents/MacOS/WallpaperConnector"
mkdir -p "$connector_agent/Contents/MacOS" "$connector_agent/Contents/Resources"
cp "$connector_app/Contents/MacOS/WallpaperConnector" "$connector_agent/Contents/MacOS/WallpaperConnector"
cp "$connector_app/Contents/Info.plist" "$connector_agent/Contents/Info.plist"
cp "$connector_app/Contents/Resources/"*.json "$connector_agent/Contents/Resources/"
cp "$connector_source/Packaging/Lucide-LICENSE" "$connector_agent/Contents/Resources/Lucide-LICENSE"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier org.orbite.wallpaper.agent' "$connector_agent/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Orbite Wallpaper Agent' "$connector_agent/Contents/Info.plist"
codesign --sign "$connector_identity" --entitlements "$connector_stage/App.entitlements" "$connector_agent"
codesign -dr - "$connector_agent" 2>&1 | sed -n 's/^# designated => //p; s/^designated => //p' > "$connector_extension/Contents/Resources/agent-requirement.txt"
test -s "$connector_extension/Contents/Resources/agent-requirement.txt"
connector_agent_requirement="$(< "$connector_extension/Contents/Resources/agent-requirement.txt")"
codesign --verify --strict --test-requirement "=$connector_agent_requirement" "$connector_agent"
"$connector_app/Contents/MacOS/WallpaperConnector" --thumbnails "$connector_extension/Contents/Resources"
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" -module-name WallpaperProvider \
  -import-objc-header "$connector_source/Native/Bridge/WallpaperExtension-Bridging-Header.h" \
  "${connector_shared[@]}" "$connector_source"/Native/*.swift "$connector_source"/Native/Bridge/*.swift \
  -Xlinker -e -Xlinker _NSExtensionMain -o "$connector_extension/Contents/MacOS/WallpaperProvider"
bash "$connector_source/test-native.sh" "$connector_app"
codesign --sign "$connector_identity" --entitlements "$connector_stage/Extension.entitlements" "$connector_extension"
codesign --sign "$connector_identity" --entitlements "$connector_stage/App.entitlements" "$connector_app"
codesign --verify --deep --strict "$connector_app"
plutil -lint "$connector_app/Contents/Info.plist" "$connector_extension/Contents/Info.plist"
for connector_manifest in "$connector_source"/Sources/ThemeModel/Resources/*.json; do
  connector_name="$(basename "$connector_manifest")"
  cmp "$connector_app/Contents/Resources/$connector_name" "$connector_extension/Contents/Resources/$connector_name"
  cmp "$connector_app/Contents/Resources/$connector_name" "$connector_agent/Contents/Resources/$connector_name"
done
"$connector_app/Contents/MacOS/WallpaperConnector" --check
echo "$connector_app"
