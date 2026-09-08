#!/bin/bash
set -euo pipefail
if [[ $# != 1 || ! "$1" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  echo 'Usage: test-signing.sh <certificate-sha1>' >&2; exit 2
fi
connector_source="$(cd "$(dirname "$0")" && pwd)"
connector_stage="$(mktemp -d "$connector_source/../../dist/pocs/macos-connector/signing-test.XXXXXX")"
for connector_variant in 1 2; do
  env -u SDKROOT xcrun clang -DPROBE_VARIANT="$connector_variant" "$connector_source/Tests/SigningProbe.c" -o "$connector_stage/probe-$connector_variant"
  codesign --sign "$1" --identifier org.wallpaperthemes.signing-probe "$connector_stage/probe-$connector_variant"
done
connector_requirement="$(codesign -dr - "$connector_stage/probe-1" 2>&1 | sed -n 's/^designated => //p')"
test -n "$connector_requirement"
test "$connector_requirement" = "$(codesign -dr - "$connector_stage/probe-2" 2>&1 | sed -n 's/^designated => //p')"
if cmp -s "$connector_stage/probe-1" "$connector_stage/probe-2"; then
  echo 'Test requires different code bytes.' >&2; exit 2
fi
codesign --verify --strict --test-requirement "=$connector_requirement" "$connector_stage/probe-2"
echo 'stable-signature=PASS distinct-code=same-designated-requirement tcc=unverified'
