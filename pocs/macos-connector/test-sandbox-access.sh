#!/bin/bash
# Bounded CLI diagnostic using the built companion and the provider's sandbox rights.
# Not hosted by WallpaperAgent; a pass does not qualify the wallpaper provider.
set -euo pipefail
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$connector_root/pocs/macos-connector"
if [[ $# != 1 || ! -f "$1/Contents/MacOS/WallpaperConnector" ]]; then
  echo 'Usage: test-sandbox-access.sh <development-build.app>' >&2
  exit 2
fi
codesign --verify --deep --strict "$1"
connector_stage="$(mktemp -d "$connector_root/dist/pocs/macos-connector/access.XXXXXX")"
connector_probe="$connector_stage/Transport Access Probe.app"
mkdir -p "$connector_probe/Contents/MacOS" "$connector_probe/Contents/Resources"
cp "$1/Contents/MacOS/WallpaperConnector" "$connector_probe/Contents/MacOS/WallpaperConnector"
cp "$1/Contents/Resources/"*.json "$connector_probe/Contents/Resources/"
cp "$connector_source/Packaging/App.plist" "$connector_probe/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier org.wallpaperthemes.connectorpoc2.accessprobe' "$connector_probe/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Transport Access Probe' "$connector_probe/Contents/Info.plist"
cp "$connector_source/Packaging/Extension.entitlements" "$connector_stage/Probe.entitlements"
/usr/libexec/PlistBuddy -c 'Set :com.apple.security.application-groups:0 group.org.wallpaperthemes.connectorpoc2.local' "$connector_stage/Probe.entitlements"
codesign --force --sign - --entitlements "$connector_stage/Probe.entitlements" "$connector_probe"
codesign --verify --strict "$connector_probe"
echo "probe=$connector_probe (sandboxed CLI, not WallpaperAgent)"
"$connector_probe/Contents/MacOS/WallpaperConnector" --probe-mailbox
