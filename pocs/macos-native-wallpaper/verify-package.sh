#!/bin/bash
set -euo pipefail

fail() {
  echo "FAIL: $1" >&2
  exit 66
}

require_equal() {
  [[ "$1" == "$2" ]] || fail "$3"
}

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
host_theme_asset="$probe_app/Contents/Resources/interactive-theme.json"
host_schema_asset="$probe_app/Contents/Resources/interactive-theme.schema.json"
snapshot_asset="$probe_extension/Contents/Resources/diagnostic.png"

[[ -x "$host_binary" ]] || fail 'host executable is missing'
[[ -x "$extension_binary" ]] || fail 'extension executable is missing'
plutil -lint "$host_plist" "$extension_plist" >/dev/null || fail 'invalid bundle plist'
require_equal "$(plutil -extract CFBundleIdentifier raw "$host_plist")" \
  org.wallpaperthemes.nativeprobe.controls 'unexpected host bundle identity'
require_equal "$(plutil -extract CFBundleIdentifier raw "$extension_plist")" \
  org.wallpaperthemes.nativeprobe.controls.extension 'unexpected extension bundle identity'
require_equal "$(plutil -extract CFBundleVersion raw "$host_plist")" 10 'unexpected host catalog version'
require_equal "$(plutil -extract CFBundleVersion raw "$extension_plist")" 10 'unexpected extension catalog version'
require_equal "$(plutil -extract EXAppExtensionAttributes.EXExtensionPointIdentifier raw "$extension_plist")" \
  com.apple.wallpaper 'unexpected extension point'
[[ -f "$theme_asset" && -f "$schema_asset" && -f "$host_theme_asset" && -f "$host_schema_asset" ]] || \
  fail 'theme assets are missing'
cmp -s "$host_theme_asset" "$theme_asset" && cmp -s "$host_schema_asset" "$schema_asset" || \
  fail 'host and extension theme assets differ'
require_equal "$(plutil -extract displayName raw "$theme_asset")" 'Balayage interactif' \
  'unexpected theme display name'
require_equal "$(plutil -extract sceneID raw "$theme_asset")" \
  22222222-2222-4222-8222-222222222222 'unexpected theme scene identity'
[[ -f "$snapshot_asset" ]] || fail 'diagnostic snapshot is missing'
snapshot_width="$(sips -g pixelWidth "$snapshot_asset" | awk '/pixelWidth/ { print $2 }')"
snapshot_height="$(sips -g pixelHeight "$snapshot_asset" | awk '/pixelHeight/ { print $2 }')"
require_equal "${snapshot_width}x${snapshot_height}" 480x270 'unexpected diagnostic snapshot dimensions'
extension_strings="$(strings "$extension_binary")"
grep -Fxq 'native-wallpaper-controls' <<<"$extension_strings" || fail 'compiled settings group is missing'
grep -Fxq 'org.wallpaperthemes.nativeprobe.controls.receipt.' <<<"$extension_strings" || \
  fail 'compiled receipt channel is missing'
codesign --verify --strict "$probe_extension" || fail 'extension signature is invalid'
codesign --verify --deep --strict "$probe_app" || fail 'application signature is invalid'

entitlements="$(codesign -d --entitlements - "$probe_extension" 2>&1)" || fail 'cannot read extension entitlements'
grep -Fq '[Key] com.apple.security.app-sandbox' <<<"$entitlements" || fail 'sandbox entitlement is missing'
entitlement_count="$(grep -c '^[[:space:]]*\[Key\]' <<<"$entitlements" || true)"
require_equal "$entitlement_count" 1 'extension has an unexpected entitlement'

echo 'PASS: 19 package checks; identities, receipt channel, synchronized assets, signatures and sandbox verified'
