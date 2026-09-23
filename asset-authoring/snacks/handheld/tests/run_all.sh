#!/usr/bin/env bash
# Full test run for the handheld snack batch. Exits 0 only if everything is green.
set -u
cd "$(dirname "$0")/.."
WS=$(pwd)
PKG=$(dirname "$WS")
ART="$PKG/artifacts/snacks-handheld"
mkdir -p "$ART"

FAIL=0

echo "== 1. gltf validator (all 27 GLBs) =="
IDS=$(python3 -X utf8 -c "
import json
spec=json.load(open('$PKG/DESIGN_SPEC.json'))
print(','.join(i['id'] for i in spec['items']))")
FILES=$(echo "$IDS" | tr ',' '\n' | sed 's|$|.glb|' | paste -sd, -)
(cd "$WS/props" && node /home/baibai/pawborough-world/scripts/validate_all.cjs --files "$FILES" --root . --report "$ART/validator/report.json") > "$ART/validator/stdout.log" 2>&1
VEXIT=$?
echo "validator exit=$VEXIT (log: artifacts/snacks-handheld/validator/stdout.log)"
[ $VEXIT -ne 0 ] && FAIL=1

echo "== 2. per-GLB contract tests =="
python3 -X utf8 tests/test_item_contract.py || FAIL=1

echo "== 3. bean set tests =="
python3 -X utf8 tests/test_beans.py || FAIL=1

echo "== 4. render completeness + blank guard =="
python3 -X utf8 tests/test_renders.py || FAIL=1

echo
if [ $FAIL -eq 0 ]; then
  echo "RUN_ALL_GREEN"
else
  echo "RUN_ALL_FAILED"
fi
exit $FAIL
