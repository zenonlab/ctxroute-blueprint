#!/bin/bash
set -euo pipefail
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$connector_root/pocs/macos-connector"
connector_base="$connector_root/dist/pocs/macos-connector"
mkdir -p "$connector_base"
connector_stage="$(mktemp -d "$connector_base/build.XXXXXX")"
connector_app="$connector_stage/Wallpaper Connector PoC 2.app"
connector_extension="$connector_app/Contents/Extensions/WallpaperProvider.appex"
connector_sdk="$(env -u SDKROOT xcrun --sdk macosx --show-sdk-path)"
connector_arch="$(uname -m)"
mkdir -p "$connector_app/Contents/MacOS" "$connector_app/Contents/Resources" \
  "$connector_extension/Contents/MacOS" "$connector_extension/Contents/Resources"
cp "$connector_source/Packaging/App.plist" "$connector_app/Contents/Info.plist"
cp "$connector_source/Packaging/Extension.plist" "$connector_extension/Contents/Info.plist"
for connector_bundle in "$connector_app" "$connector_extension"; do
  cp "$connector_source/Sources/ThemeModel/Resources/theme.json" "$connector_bundle/Contents/Resources/theme.json"
  cp "$connector_source/Native/Bridge/LICENSE" "$connector_bundle/Contents/Resources/Phosphene-LICENSE"
done
connector_shared=("$connector_source/Sources/ThemeModel/Theme.swift"
  "$connector_source/Sources/SceneRenderer/Scene.swift"
  "$connector_source/Sources/ConnectorTransport/Mailbox.swift")
connector_flags=(-sdk "$connector_sdk" -target "$connector_arch-apple-macos26.0"
  -swift-version 6 -warnings-as-errors -parse-as-library -O
  -module-cache-path "$connector_base/module-cache")
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" "${connector_shared[@]}" \
  "$connector_source/App/Main.swift" -o "$connector_app/Contents/MacOS/WallpaperConnector"
"$connector_app/Contents/MacOS/WallpaperConnector" --thumbnail "$connector_extension/Contents/Resources/thumbnail.png"
env -u SDKROOT xcrun swiftc "${connector_flags[@]}" -module-name WallpaperProvider \
  -import-objc-header "$connector_source/Native/Bridge/WallpaperExtension-Bridging-Header.h" \
  "${connector_shared[@]}" "$connector_source"/Native/*.swift "$connector_source"/Native/Bridge/*.swift \
  -Xlinker -e -Xlinker _NSExtensionMain -o "$connector_extension/Contents/MacOS/WallpaperProvider"
codesign --sign - --entitlements "$connector_source/Packaging/Extension.entitlements" "$connector_extension"
codesign --sign - --entitlements "$connector_source/Packaging/App.entitlements" "$connector_app"
codesign --verify --deep --strict "$connector_app"
plutil -lint "$connector_app/Contents/Info.plist" "$connector_extension/Contents/Info.plist"
cmp "$connector_app/Contents/Resources/theme.json" "$connector_extension/Contents/Resources/theme.json"
echo "$connector_app"
