#!/bin/bash
set -euo pipefail
connector_identity=-
if [[ -n "${CONNECTOR_LOCAL_BACKGROUND_PATH:-}" ]]; then
  echo 'CONNECTOR_LOCAL_BACKGROUND_PATH is no longer accepted: themes must stay in external packages.' >&2
  exit 2
fi
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
mkdir -p "$connector_app/Contents/MacOS" "$connector_agent/Contents/MacOS" \
  "$connector_extension/Contents/MacOS" "$connector_extension/Contents/Resources"
cp "$connector_source/Packaging/App.plist" "$connector_app/Contents/Info.plist"
cp "$connector_source/Packaging/Extension.plist" "$connector_extension/Contents/Info.plist"
cp "$connector_source/Native/Bridge/LICENSE" "$connector_extension/Contents/Resources/Phosphene-LICENSE"

connector_sources=(
  "$connector_source/Sources/ThemeModel/ModelError.swift"
  "$connector_source/Sources/ThemeModel/ProductIdentity.swift"
  "$connector_source/Sources/ThemeModel/ThemeDiscovery.swift"
  "$connector_source/Sources/ThemeModel/ThemeInterface.swift"
  "$connector_source/Sources/ThemeModel/ThemeInterfaceOverrides.swift"
  "$connector_source/Sources/ThemeModel/TerminalSessions.swift"
  "$connector_source/Sources/ThemeModel/RenderHost.swift"
  "$connector_source/Sources/ThemeModel/RenderHostControl.swift"
  "$connector_source/Sources/ThemeModel/RenderHostEvents.swift"
  "$connector_source/Sources/ThemeModel/LaunchPolicy.swift"
  "$connector_source/Sources/ConnectorTransport/NativeXPC.swift"
  "$connector_source/App/AgentTransport.swift"
  "$connector_source/App/AgentLauncher.swift"
  "$connector_source/App/ProviderCover.swift"
  "$connector_source/App/DesktopEventTap.swift"
  "$connector_source/App/HiddenDesktopInputPlane.swift"
  "$connector_source/App/RenderHostDesktopInput.swift"
  "$connector_source/App/ThemeControlsView.swift"
  "$connector_source/App/VehicleCustomizationPanel.swift"
  "$connector_source/App/DesktopItems.swift"
  "$connector_source/App/Preflight.swift"
  "$connector_source/App/Main.swift"
)
connector_flags=(-sdk "$connector_sdk" -target "$connector_arch-apple-macos26.0"
  -swift-version 6 -warnings-as-errors -parse-as-library -O
  -module-cache-path "$connector_base/module-cache")
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" "${connector_sources[@]}" \
  -o "$connector_app/Contents/MacOS/WallpaperConnector"

cp "$connector_app/Contents/MacOS/WallpaperConnector" "$connector_agent/Contents/MacOS/WallpaperConnector"
cp "$connector_app/Contents/Info.plist" "$connector_agent/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier org.orbite.wallpaper.agent' "$connector_agent/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Orbite Wallpaper Agent' "$connector_agent/Contents/Info.plist"
codesign --sign "$connector_identity" --entitlements "$connector_stage/App.entitlements" "$connector_agent"
codesign -dr - "$connector_agent" 2>&1 |
  sed -n 's/^# designated => //p; s/^designated => //p' \
  > "$connector_extension/Contents/Resources/agent-requirement.txt"
test -s "$connector_extension/Contents/Resources/agent-requirement.txt"
connector_agent_requirement="$(< "$connector_extension/Contents/Resources/agent-requirement.txt")"
codesign --verify --strict --test-requirement "=$connector_agent_requirement" "$connector_agent"

connector_provider_sources=(
  "$connector_source/Sources/ThemeModel/ModelError.swift"
  "$connector_source/Sources/ThemeModel/ProductIdentity.swift"
  "$connector_source/Sources/ConnectorTransport/NativeXPC.swift"
)
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" -module-name WallpaperProvider \
  -import-objc-header "$connector_source/Native/Bridge/WallpaperExtension-Bridging-Header.h" \
  "${connector_provider_sources[@]}" "$connector_source"/Native/*.swift \
  "$connector_source"/Native/Bridge/*.swift \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$connector_extension/Contents/MacOS/WallpaperProvider"
codesign --sign "$connector_identity" --entitlements "$connector_stage/Extension.entitlements" "$connector_extension"
codesign --sign "$connector_identity" --entitlements "$connector_stage/App.entitlements" "$connector_app"
codesign --verify --deep --strict "$connector_app"
plutil -lint "$connector_app/Contents/Info.plist" "$connector_agent/Contents/Info.plist" \
  "$connector_extension/Contents/Info.plist"
test "$(find "$connector_app/Contents/Extensions" -mindepth 1 -maxdepth 1 -name '*.appex' | wc -l | tr -d ' ')" = 1
test -z "$(find "$connector_app" -type f \( -name 'theme*.json' -o -name 'catalog.json' \) -print -quit)"
"$connector_app/Contents/MacOS/WallpaperConnector" --check
echo "$connector_app"
