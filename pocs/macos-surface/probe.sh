#!/bin/sh
set -eu

# Local build boundary. No dependency install, persistent service or cleanup.
poc_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
poc_repo=$(CDPATH= cd -- "$poc_root/../.." && pwd -P)
poc_output="$poc_repo/dist/pocs/macos-surface"
poc_action=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi
case "$poc_action" in
  build|test|run) ;;
  *) printf '%s\n' 'Usage: sh pocs/macos-surface/probe.sh build|test|run [probe arguments]'; exit 2 ;;
esac
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'This isolated probe requires macOS and a local Swift toolchain.' >&2
  exit 2
fi
poc_sdk=$(env -u SDKROOT xcrun --sdk macosx --show-sdk-path)
mkdir -p "$poc_output"

poc_swift() {
  env -u SDKROOT xcrun swift "$1" \
    --package-path "$poc_root" --scratch-path "$poc_output/build" \
    --cache-path "$poc_output/cache" --config-path "$poc_output/config" \
    --security-path "$poc_output/security" --manifest-cache local \
    --sdk "$poc_sdk" --configuration release --jobs 2 \
    -Xswiftc -warnings-as-errors
}

case "$poc_action" in
  build) poc_swift build ;;
  test) poc_swift test ;;
  run)
    poc_swift build >&2
    cd "$poc_output"
    exec "$poc_output/build/release/SurfaceProbe" "$@"
    ;;
esac
