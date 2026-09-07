#!/bin/bash
set -euo pipefail
probe_root="$(cd "$(dirname "$0")/../.." && pwd)"
probe_base="$probe_root/dist/pocs/macos-native-wallpaper"
probe_revision=8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6
git -C "$probe_base/upstream" cat-file -e "$probe_revision^{commit}"
probe_tests="$(mktemp -d "$probe_base/tests.XXXXXX")"
git -C "$probe_base/upstream" archive "$probe_revision" PhospheneExtension/ColorDiag.swift |
  tar -x -C "$probe_tests"
probe_source="$probe_root/pocs/macos-native-wallpaper"
xcrun swiftc -swift-version 6 -parse-as-library \
  "$probe_source/DiagnosticCommand.swift" "$probe_source/CommandTests.swift" \
  -o "$probe_tests/commands"
"$probe_tests/commands"
xcrun swiftc -swift-version 6 -parse-as-library \
  "$probe_source/DiagnosticCommand.swift" "$probe_source/DiagnosticTheme.swift" \
  "$probe_source/ThemeTests.swift" -o "$probe_tests/theme"
"$probe_tests/theme" "$probe_source/interactive-theme.json"
# Force only the diagnostic toggle in this isolated fixture; no file in the
# extension container is created and no notification is posted by these tests.
patch --batch -p1 -d "$probe_tests" -i "$probe_source/diagnostic.patch"
xcrun swiftc -swift-version 6 -parse-as-library -D WALLPAPER_NATIVE_DIAGNOSTIC \
  "$probe_source/DiagnosticCommand.swift" "$probe_source/InteractiveDiagnostic.swift" \
  "$probe_source/DiagnosticTheme.swift" "$probe_source/RenderTests.swift" \
  "$probe_tests/PhospheneExtension/ColorDiag.swift" \
  -o "$probe_tests/layers"
"$probe_tests/layers" "$probe_source/interactive-theme.json"
echo "Isolated test artifacts retained: $probe_tests"
