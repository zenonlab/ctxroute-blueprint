#!/bin/bash
# Build-only probe: never install or execute the upstream extension.
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --package ) ]]; then
  echo 'Usage: bash pocs/macos-native-wallpaper/prepare.sh [--package]' >&2
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
patch --batch -p1 -d "$probe_stage" -i "$probe_root/pocs/macos-native-wallpaper/diagnostic.patch"
# git apply from a nested export can silently skip paths relative to the outer repo.
grep -q '#if WALLPAPER_NATIVE_DIAGNOSTIC' "$probe_stage/PhospheneExtension/ColorDiag.swift"
probe_sdk="$(env -u SDKROOT xcrun --sdk macosx --show-sdk-path)"
probe_arch="$(uname -m)"
probe_sources=()
probe_linker=(-Xlinker -e -Xlinker _main)
for probe_source in "$probe_stage"/PhospheneExtension/*.swift; do
  if [[ "${1:-}" == --package && ( "$probe_source" == */VideoLibrary.swift || "$probe_source" == */SpiralRecovery.swift ) ]]; then
    continue
  fi
  probe_sources+=("$probe_source")
done
if [[ "${1:-}" == --package ]]; then
  # Match Xcode's extensionkit-extension product (DarwinProductTypes.xcspec).
  # AppExtension.main registers the implementation; NSExtensionMain hosts its loop.
  probe_linker=(-Xlinker -e -Xlinker _NSExtensionMain)
  (cd "$probe_root" && node pocs/macos-native-wallpaper/package.mjs "$probe_stage")
  probe_sources+=("$probe_root/pocs/macos-native-wallpaper/DiagnosticLibrary.swift")
  probe_sources+=("$probe_root/pocs/macos-native-wallpaper/DiagnosticCommand.swift")
  probe_sources+=("$probe_root/pocs/macos-native-wallpaper/DiagnosticTheme.swift")
  probe_sources+=("$probe_root/pocs/macos-native-wallpaper/InteractiveDiagnostic.swift")
fi
env -u SDKROOT xcrun swiftc \
  -sdk "$probe_sdk" -target "$probe_arch-apple-macos26.0" \
  -swift-version 6 -parse-as-library -D WALLPAPER_NATIVE_DIAGNOSTIC \
  -module-name NativeWallpaperProbe \
  -module-cache-path "$probe_stage/module-cache" \
  -import-objc-header "$probe_stage/PhospheneExtension/WallpaperExtension-Bridging-Header.h" \
  "${probe_sources[@]}" "${probe_linker[@]}" \
  -o "$probe_stage/NativeWallpaperProbe"
file "$probe_stage/NativeWallpaperProbe"
shasum -a 256 "$probe_stage/NativeWallpaperProbe"
echo "Compile-only artifact: $probe_stage/NativeWallpaperProbe"
echo 'NOT installed, registered, launched, or qualified as an Apple wallpaper extension.'
echo 'Keep the adjacent upstream LICENSE with this diagnostic artifact.'
if [[ "${1:-}" == --package ]]; then
  probe_app="$probe_stage/Native Wallpaper Probe.app"
  probe_extension="$probe_app/Contents/Extensions/NativeWallpaperProbe.appex"
  mkdir -p "$probe_app/Contents/MacOS" "$probe_app/Contents/Resources" \
    "$probe_extension/Contents/MacOS" "$probe_extension/Contents/Resources"
  cp "$probe_root/pocs/macos-native-wallpaper/Host-Info.plist" "$probe_app/Contents/Info.plist"
  cp "$probe_root/pocs/macos-native-wallpaper/Extension-Info.plist" "$probe_extension/Contents/Info.plist"
  cp "$probe_stage/NativeWallpaperProbe" "$probe_extension/Contents/MacOS/NativeWallpaperProbe"
  cp "$probe_stage/LICENSE" "$probe_app/Contents/Resources/Phosphene-LICENSE"
  cp "$probe_root/pocs/macos-native-wallpaper/interactive-theme.json" "$probe_app/Contents/Resources/interactive-theme.json"
  cp "$probe_root/pocs/macos-native-wallpaper/interactive-theme.json" "$probe_extension/Contents/Resources/interactive-theme.json"
  cp "$probe_root/pocs/macos-native-wallpaper/interactive-theme.schema.json" "$probe_app/Contents/Resources/interactive-theme.schema.json"
  cp "$probe_root/pocs/macos-native-wallpaper/interactive-theme.schema.json" "$probe_extension/Contents/Resources/interactive-theme.schema.json"
  env -u SDKROOT xcrun swiftc -sdk "$probe_sdk" -target "$probe_arch-apple-macos26.0" \
    -swift-version 6 -parse-as-library "$probe_root/pocs/macos-native-wallpaper/Host.swift" \
    "$probe_root/pocs/macos-native-wallpaper/HostControls.swift" \
    "$probe_root/pocs/macos-native-wallpaper/DiagnosticCommand.swift" \
    "$probe_root/pocs/macos-native-wallpaper/DiagnosticTheme.swift" \
    -o "$probe_app/Contents/MacOS/NativeWallpaperProbeHost"
  "$probe_app/Contents/MacOS/NativeWallpaperProbeHost" --thumbnail "$probe_extension/Contents/Resources/diagnostic.png"
  plutil -lint "$probe_app/Contents/Info.plist" "$probe_extension/Contents/Info.plist"
  codesign --force --sign - --entitlements "$probe_root/pocs/macos-native-wallpaper/Extension.entitlements" "$probe_extension"
  codesign --force --sign - "$probe_app"
  codesign --verify --strict --verbose=2 "$probe_extension"
  codesign --verify --deep --strict --verbose=2 "$probe_app"
  echo "Package (ad hoc signature; OS admission untested): $probe_app"
fi
