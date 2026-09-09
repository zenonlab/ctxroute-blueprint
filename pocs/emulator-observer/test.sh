#!/bin/bash
set -euo pipefail
observer_root="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$observer_root/../.." && pwd)"
run_root="$(mktemp -d "$repository_root/dist/pocs/emulator-observer.XXXXXX")"
case "$(uname -s)" in
  Darwin) core="$run_root/fixture_libretro.dylib"; cc -std=c99 -Wall -Wextra -Werror -dynamiclib "$observer_root/fixture/core.c" -o "$core" ;;
  Linux) core="$run_root/fixture_libretro.so"; cc -std=c99 -Wall -Wextra -Werror -shared -fPIC "$observer_root/fixture/core.c" -o "$core" ;;
  *) echo 'Unsupported test host' >&2; exit 2 ;;
esac
for run in 1 2 3 4 5; do
  python3 "$observer_root/observe.py" --core "$core" \
    --content "$observer_root/fixture/demo.fixture" --inputs "$observer_root/fixture/inputs.json" \
    --frames 12 --output "$run_root/run-$run"
done
reference="$(python3 - "$run_root/run-1/observation.json" <<'PY'
import json, pathlib, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(json.dumps({"run": value["run"], "artifacts": value["artifacts"], "capabilities": value["capabilities"]}, sort_keys=True))
PY
)"
for run in 2 3 4 5; do
  candidate="$(python3 - "$run_root/run-$run/observation.json" <<'PY'
import json, pathlib, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(json.dumps({"run": value["run"], "artifacts": value["artifacts"], "capabilities": value["capabilities"]}, sort_keys=True))
PY
)"
  test "$candidate" = "$reference"
done
if python3 "$observer_root/observe.py" --core "$core" \
    --content "$observer_root/fixture/demo.fixture" --inputs "$observer_root/fixture/inputs.json" \
    --frames 0 --output "$run_root/rejected-zero-frames" >/dev/null 2>&1; then
  echo 'Zero-frame quota was not rejected' >&2; exit 1
fi
ln -s "$observer_root/fixture/demo.fixture" "$run_root/content-link.fixture"
if python3 "$observer_root/observe.py" --core "$core" \
    --content "$run_root/content-link.fixture" --inputs "$observer_root/fixture/inputs.json" \
    --frames 1 --output "$run_root/rejected-symlink" >/dev/null 2>&1; then
  echo 'Symlink input was not rejected' >&2; exit 1
fi
mkdir "$run_root/non-empty-output"
printf '%s\n' occupied > "$run_root/non-empty-output/sentinel"
if python3 "$observer_root/observe.py" --core "$core" \
    --content "$observer_root/fixture/demo.fixture" --inputs "$observer_root/fixture/inputs.json" \
    --frames 1 --output "$run_root/non-empty-output" >/dev/null 2>&1; then
  echo 'Non-empty output was not rejected' >&2; exit 1
fi
PYTHONPYCACHEPREFIX="$run_root/pycache" python3 -m py_compile "$observer_root/observe.py"
echo "emulator-observer=PASS runs=5 frames=12 artifacts=5 refusals=3 output=$run_root"
