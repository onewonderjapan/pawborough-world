#!/usr/bin/env bash
# Full test run for the handheld snack batch. Exits 0 only if everything is green.
# R1 mode: SNACKS_R1_ART set (e.g. $PKG/artifacts/r1) -> validate/test the repair
# package's props/renders for the 8 reworked ids instead of the adopted WS/props batch.
set -u
cd "$(dirname "$0")/.."
WS=$(pwd)
PKG=$(dirname "$WS")
ART="$PKG/artifacts/snacks-handheld"

FAIL=0

if [ -n "${SNACKS_R1_ART:-}" ]; then
  ART="$SNACKS_R1_ART"
  export SNACKS_PROPS="${SNACKS_PROPS:-$ART/props}"
  export SNACKS_ART="$ART"
  export SNACKS_REND="${SNACKS_REND:-$ART/renders}"
  PROPS="$SNACKS_PROPS"
  IDS=$(python3 -X utf8 -c "
import json
spec=json.load(open('$PKG/DESIGN_SPEC.json'))
r1={'shengjian','youdunzi','congyoubing','bean-single','bean-dish','bean-jar','bean-packet-open','steamer-xiaolongbao-8'}
print(','.join(i['id'] for i in spec['items'] if i['id'] in r1))")
  FILES=$(echo "$IDS" | tr ',' '\n' | sed 's|$|.glb|' | paste -sd, -)
  export SNACKS_IDS="$IDS"
  echo "== R1 mode: props=$PROPS ids=$IDS =="
else
  IDS=$(python3 -X utf8 -c "
import json
spec=json.load(open('$PKG/DESIGN_SPEC.json'))
print(','.join(i['id'] for i in spec['items']))")
  FILES=$(echo "$IDS" | tr ',' '\n' | sed 's|$|.glb|' | paste -sd, -)
  PROPS="$WS/props"
fi

mkdir -p "$ART"

echo "== 1. gltf validator ($FILES) =="
(cd "$PROPS" && node /home/baibai/pawborough-world/scripts/validate_all.cjs --files "$FILES" --root . --report "$ART/validator/report.json") > "$ART/validator/stdout.log" 2>&1
VEXIT=$?
echo "validator exit=$VEXIT (log: $ART/validator/stdout.log)"
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
