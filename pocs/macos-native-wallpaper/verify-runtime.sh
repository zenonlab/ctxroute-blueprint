#!/bin/bash
set -euo pipefail

fail() {
  echo "FAIL: $1" >&2
  exit 66
}

if [[ $# -ne 1 ]]; then
  echo 'Usage: bash pocs/macos-native-wallpaper/verify-runtime.sh <Native Wallpaper Probe.app>' >&2
  exit 64
fi

probe_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
probe_base="$probe_root/dist/pocs/macos-native-wallpaper"
probe_app="$(cd "$1" 2>/dev/null && pwd -P)" || exit 65
case "$probe_app" in
  "$probe_base"/compile.??????/'Native Wallpaper Probe.app') ;;
  *) echo 'Package must be an isolated build created by this PoC.' >&2; exit 65 ;;
esac

probe_extension="$probe_app/Contents/Extensions/NativeWallpaperProbe.appex"
host_binary="$probe_app/Contents/MacOS/NativeWallpaperProbeHost"
extension_binary="$probe_extension/Contents/MacOS/NativeWallpaperProbe"
extension_plist="$probe_extension/Contents/Info.plist"
extension_id="$(plutil -extract CFBundleIdentifier raw "$extension_plist")" || \
  fail 'cannot read extension identity'

plugin_listing="$(pluginkit -m -A -D -v -i "$extension_id")" || \
  fail 'provider is not registered'
grep -Fq "$probe_extension" <<<"$plugin_listing" || fail 'registered provider uses another package'

process_pid() {
  ps -Ao pid=,command= | awk -v path="$1" '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
      if (index($0, path) == 1) print pid
    }'
}

host_pids="$(process_pid "$host_binary")"
extension_pids="$(process_pid "$extension_binary")"
[[ "$(wc -w <<<"$host_pids" | tr -d ' ')" == 1 ]] || fail 'expected exactly one current host process'
[[ "$(wc -w <<<"$extension_pids" | tr -d ' ')" == 1 ]] || fail 'expected exactly one current extension process'
extension_pid="$(tr -d '[:space:]' <<<"$extension_pids")"

index_plist="$HOME/Library/Application Support/com.apple.wallpaper/Store/Index.plist"
[[ -f "$index_plist" ]] || fail 'wallpaper Index.plist is missing'
index_strings="$(strings "$index_plist")"
grep -Fq "$extension_id" <<<"$index_strings" || fail 'active wallpaper uses another provider'
grep -Fq '22222222-2222-4222-8222-222222222222' <<<"$index_strings" || \
  fail 'active wallpaper uses another scene'

extension_log="$HOME/Library/Containers/$extension_id/Data/Documents/extension.log"
[[ -f "$extension_log" ]] || fail 'extension log is missing'
runtime_log="$(awk -v marker="INIT (PID: $extension_pid)" '
  index($0, marker) { found = 1; output = "" }
  found { output = output $0 ORS }
  END { printf "%s", output }
' "$extension_log")"
[[ -n "$runtime_log" ]] || fail 'current extension PID has no initialization record'
context_count="$(grep -Fc '[colorDiag] installed sweep' <<<"$runtime_log" || true)"
[[ "$context_count" -ge 2 ]] || fail 'current extension did not install both renderer contexts'
for command in showPanel pause effectOn resume reset; do
  grep -Eq "\[Interaction\] applied $command roots=[1-9][0-9]*" <<<"$runtime_log" || \
    fail "command $command was not applied by the current renderer"
done

echo "PASS: 8 runtime checks; provider, selection, processes, two surfaces and five applied commands verified (extension PID $extension_pid)"
