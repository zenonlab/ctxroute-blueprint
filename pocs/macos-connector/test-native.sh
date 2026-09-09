#!/bin/bash
set -euo pipefail
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$connector_root/pocs/macos-connector"
connector_app="${1:?Pass the exact built .app path}"
mkdir -p "$connector_root/dist/pocs/macos-connector"
connector_output="$connector_root/dist/pocs/macos-connector/native-catalog-test"
env -u SDKROOT xcrun swiftc -swift-version 6 -warnings-as-errors -parse-as-library \
  "$connector_source/Sources/ThemeModel/Theme.swift" \
  "$connector_source/Sources/ThemeModel/ThemeLayout.swift" \
  "$connector_source/Sources/ThemeModel/GestureRouter.swift" \
  "$connector_source/App/DesktopEventTap.swift" \
  "$connector_source/App/DesktopInput.swift" \
  "$connector_source/App/ControlInputPlane.swift" \
  "$connector_source/App/HiddenDesktopInputPlane.swift" \
  "$connector_source/App/DesktopItems.swift" \
  "$connector_source/App/AgentLauncher.swift" \
  "$connector_source/Tests/DesktopItemsTests.swift" \
  "$connector_source/Tests/ControlInputPlaneTests.swift" \
  "$connector_source/Native/Bridge/CodableShims.swift" \
  "$connector_source/Native/Catalog.swift" "$connector_source/Tests/NativeCatalog.swift" \
  -o "$connector_output"
"$connector_output" "$connector_app/Contents/Extensions/WallpaperProvider.appex"
