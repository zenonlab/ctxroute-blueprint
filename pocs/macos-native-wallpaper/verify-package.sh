#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'Usage: bash pocs/macos-native-wallpaper/verify-package.sh <Native Wallpaper Probe.app>' >&2
  exit 64
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Requires macOS.' >&2
  exit 69
fi

probe_root="$(cd "$(dirname "$0")/../.." && pwd)"
probe_app="$(cd "$1" && pwd -P)"
case "$probe_app" in
  "$probe_root"/dist/pocs/macos-native-wallpaper/compile.*/Native\ Wallpaper\ Probe.app) ;;
  *) echo "Refusing package outside the isolated POC build directory: $probe_app" >&2; exit 65 ;;
esac

probe_extension="$probe_app/Contents/Extensions/NativeWallpaperProbe.appex"
host_plist="$probe_app/Contents/Info.plist"
extension_plist="$probe_extension/Contents/Info.plist"
host_binary="$probe_app/Contents/MacOS/NativeWallpaperProbeHost"
extension_binary="$probe_extension/Contents/MacOS/NativeWallpaperProbe"
theme_asset="$probe_extension/Contents/Resources/interactive-theme.json"
schema_asset="$probe_extension/Contents/Resources/interactive-theme.schema.json"

[[ -x "$host_binary" ]]
[[ -x "$extension_binary" ]]
plutil -lint "$host_plist" "$extension_plist" >/dev/null
[[ "$(plutil -extract CFBundleIdentifier raw "$host_plist")" == \
  org.wallpaperthemes.nativeprobe.interactive ]]
[[ "$(plutil -extract CFBundleIdentifier raw "$extension_plist")" == \
  org.wallpaperthemes.nativeprobe.interactive.extension ]]
[[ "$(plutil -extract CFBundleVersion raw "$host_plist")" == 7 ]]
[[ "$(plutil -extract CFBundleVersion raw "$extension_plist")" == 7 ]]
[[ "$(plutil -extract EXAppExtensionAttributes.EXExtensionPointIdentifier raw "$extension_plist")" == \
  com.apple.wallpaper ]]
[[ -f "$theme_asset" && -f "$schema_asset" ]]
[[ "$(plutil -extract displayName raw "$theme_asset")" == 'Balayage interactif' ]]
[[ "$(plutil -extract sceneID raw "$theme_asset")" == 22222222-2222-4222-8222-222222222222 ]]
strings "$extension_binary" | grep -Fxq 'native-wallpaper-interactive'
codesign --verify --strict "$probe_extension"
codesign --verify --deep --strict "$probe_app"

entitlements="$(codesign -d --entitlements - "$probe_extension" 2>&1)"
grep -Fq '[Key] com.apple.security.app-sandbox' <<<"$entitlements"
[[ "$(grep -c '^[[:space:]]*\[Key\]' <<<"$entitlements")" == 1 ]]

echo 'PASS: 16 package checks; isolated identities, catalog version, assets, signatures and sandbox verified'
