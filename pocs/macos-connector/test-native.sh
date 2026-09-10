#!/bin/bash
set -euo pipefail
connector_root="$(cd "$(dirname "$0")/../.." && pwd)"
connector_source="$connector_root/pocs/macos-connector"
connector_app="${1:?Pass the exact built .app path}"
mkdir -p "$connector_root/dist/pocs/macos-connector"
connector_output="$connector_root/dist/pocs/macos-connector/native-catalog-test"
connector_fixture_root="$(mktemp -d "$connector_root/dist/pocs/macos-connector/catalog-fixture.XXXXXX")"
connector_fixture="$connector_fixture_root/CatalogFixture.bundle"
mkdir -p "$connector_fixture/Contents/Resources"
plutil -create xml1 "$connector_fixture/Contents/Info.plist"
plutil -insert CFBundleIdentifier -string org.orbite.wallpaper.catalog-fixture \
  "$connector_fixture/Contents/Info.plist"
plutil -insert CFBundleName -string 'Orbite Wallpaper Catalog Fixture' \
  "$connector_fixture/Contents/Info.plist"
plutil -insert CFBundlePackageType -string BNDL "$connector_fixture/Contents/Info.plist"
cp "$connector_app/Contents/Extensions/WallpaperProvider.appex/Contents/Resources/"*.json \
  "$connector_fixture/Contents/Resources/"
cp "$connector_app/Contents/Extensions/WallpaperProvider.appex/Contents/Resources/"*.png \
  "$connector_fixture/Contents/Resources/"
env -u SDKROOT xcrun swiftc -swift-version 6 -warnings-as-errors -parse-as-library \
  "$connector_source/Sources/ThemeModel/Theme.swift" \
  "$connector_source/Sources/ThemeModel/ThemeDiscovery.swift" \
  "$connector_source/Sources/ThemeModel/ProductIdentity.swift" \
  "$connector_source/Sources/ThemeModel/ThemeLayout.swift" \
  "$connector_source/Sources/ThemeModel/GestureRouter.swift" \
  "$connector_source/App/DesktopEventTap.swift" \
  "$connector_source/App/DesktopInput.swift" \
  "$connector_source/App/ControlInputPlane.swift" \
  "$connector_source/App/HiddenDesktopInputPlane.swift" \
  "$connector_source/App/DesktopItems.swift" \
  "$connector_source/App/DesktopVisibility.swift" \
  "$connector_source/App/AgentLauncher.swift" \
  "$connector_source/Tests/DesktopItemsTests.swift" \
  "$connector_source/Tests/DesktopVisibilityTests.swift" \
  "$connector_source/Tests/ControlInputPlaneTests.swift" \
  "$connector_source/Native/Bridge/CodableShims.swift" \
  "$connector_source/Native/Catalog.swift" "$connector_source/Tests/NativeCatalog.swift" \
  -o "$connector_output"
"$connector_output" "$connector_fixture"
