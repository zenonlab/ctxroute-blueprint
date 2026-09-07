#!/bin/bash
# Compile-only probe: never install or execute the upstream extension.
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo 'Usage: bash pocs/macos-native-wallpaper/prepare.sh (compile only)' >&2
  exit 64
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Requires macOS and its Swift SDK.' >&2
  exit 69
fi
probe_root="$(cd "$(dirname "$0")/../.." && pwd)"
probe_revision=8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6
probe_base="$probe_root/dist/pocs/macos-native-wallpaper"
probe_upstream="$probe_base/upstream"
mkdir -p "$probe_base"
if [[ ! -e "$probe_upstream" ]]; then
  git clone --no-checkout https://github.com/kageroumado/phosphene.git "$probe_upstream"
fi
git -C "$probe_upstream" cat-file -e "$probe_revision^{commit}"
# Export exactly the pin, ignoring local working-tree changes; never reset upstream.
probe_stage="$(mktemp -d "$probe_base/compile.XXXXXX")"
git -C "$probe_upstream" archive "$probe_revision" PhospheneExtension LICENSE |
  tar -x -C "$probe_stage"
git -C "$probe_stage" apply --check "$probe_root/pocs/macos-native-wallpaper/diagnostic.patch"
git -C "$probe_stage" apply "$probe_root/pocs/macos-native-wallpaper/diagnostic.patch"
probe_sdk="$(env -u SDKROOT xcrun --sdk macosx --show-sdk-path)"
probe_arch="$(uname -m)"
env -u SDKROOT xcrun swiftc \
  -sdk "$probe_sdk" -target "$probe_arch-apple-macos26.0" \
  -swift-version 6 -parse-as-library -D WALLPAPER_NATIVE_DIAGNOSTIC \
  -module-name NativeWallpaperProbe \
  -module-cache-path "$probe_stage/module-cache" \
  -import-objc-header "$probe_stage/PhospheneExtension/WallpaperExtension-Bridging-Header.h" \
  "$probe_stage"/PhospheneExtension/*.swift \
  -o "$probe_stage/NativeWallpaperProbe"
file "$probe_stage/NativeWallpaperProbe"
shasum -a 256 "$probe_stage/NativeWallpaperProbe"
echo "Compile-only artifact: $probe_stage/NativeWallpaperProbe"
echo 'NOT installed, registered, launched, or qualified as an Apple wallpaper extension.'
echo 'Keep the adjacent upstream LICENSE with this diagnostic artifact.'
