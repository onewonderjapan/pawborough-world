#!/usr/bin/env bash
# Evidence-endpoint origin contract test (N1).
# Starts the built preview server on 5285 and the dev server on 5284 as
# temporary local services owned by this run, then issues real HTTP requests:
#   - POST with a correct same-origin Origin header  -> 200, jpg+json saved
#   - POST with a wrong-port Origin                  -> 403
#   - POST with a foreign-host Origin                -> 403
# The test image is an existing task JPEG fixture sent over HTTP; it is NOT a
# browser screenshot and is recorded nowhere as one.
#
# Run: bash tools/evidence_endpoint_test.sh   (exit 0 = contract holds)
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EV="../artifacts/N1"
mkdir -p "$EV"
LOG="$EV/evidence-endpoint-$STAMP.log"
FIXTURE="$(ls ../inputs/photos/*.jpg | head -1)"
NAME="http-fixture-pbr"
NAME_SUFFIXED="http-fixture-pbr-noph"   # F3 presentation-labeled shots
VITE="node_modules/.bin/vite"

echo "== evidence endpoint origin test $STAMP ==" | tee -a "$LOG"
echo "fixture: $FIXTURE ($(stat -c%s "$FIXTURE") bytes)" | tee -a "$LOG"

python3 - "$FIXTURE" "$NAME" "$NAME_SUFFIXED" "$EV/.fixture-body-suffixed.json" > "$EV/.fixture-body.json" <<'PYEOF'
import base64, json, sys
path, name, name_suffixed, suffixed_out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
data = base64.b64encode(open(path, 'rb').read()).decode()
record = {'fixture': True, 'note': 'HTTP-level endpoint test with an existing task JPEG; not a browser screenshot'}
with open(suffixed_out, 'w') as f:
    json.dump({'name': name_suffixed, 'image': 'data:image/jpeg;base64,' + data, 'record': record}, f)
json.dump({'name': name, 'image': 'data:image/jpeg;base64,' + data, 'record': record}, sys.stdout)
PYEOF

PORT=""; PID=""
# Ports default to the PROJECT-configured 5284/5285; EV_PREVIEW_PORT /
# EV_DEV_PORT let verification runs use their own idle ports (e.g. when the
# owner's live preview already holds 5285). The vite children get a matching
# EVIDENCE_PORTS origin allowlist.
PREVIEW_PORT="${EV_PREVIEW_PORT:-5285}"
DEV_PORT="${EV_DEV_PORT:-5284}"
export EVIDENCE_PORTS="${EVIDENCE_PORTS:-${PREVIEW_PORT}|${DEV_PORT}}"
start_server() { # $1=mode(dev|preview) $2=port
  "$VITE" "$1" --host 127.0.0.1 --port "$2" --strictPort >>"$LOG" 2>&1 &
  PID=$!
  PORT="$2"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://127.0.0.1:$2/"; then return 0; fi
    sleep 0.3
  done
  echo "server $1 on $2 did not come up"; return 1
}
stop_server() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  sleep 0.5
  PID=""
}
check() { # $1=body-file $2=origin $3=expect $4=label ; uses $PORT
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/__review-evidence" \
    -H 'Content-Type: application/json' -H "Origin: $2" --data-binary @"$1")
  echo "$4 -> HTTP $code (expect $3)" >>"$LOG"
  [ "$code" = "$3" ]
}

RESULT="$EV/evidence-endpoint-result.json"
overall=0
comma=""
{
  echo "{"
  echo "  \"what\": \"/__review-evidence origin contract over real HTTP\","
  echo "  \"atUTC\": \"$STAMP\","
  echo "  \"fixtureImage\": \"$FIXTURE\","
  echo "  \"fixtureIsBrowserScreenshot\": false,"
  echo "  \"checks\": ["
  for entry in "preview $PREVIEW_PORT" "dev $DEV_PORT"; do
    set -- $entry
    mode=$1; port=$2
    start_server "$mode" "$port"
    set +e
    check "$EV/.fixture-body.json" "http://127.0.0.1:$port"    200 "$port correct-origin"      ; r1=$?
    check "$EV/.fixture-body-suffixed.json" "http://127.0.0.1:$port" 200 "$port suffix-name-accepted" ; r1b=$?
    check "$EV/.fixture-body.json" "http://127.0.0.1:9999"     403 "$port wrong-port-origin"   ; r2=$?
    check "$EV/.fixture-body.json" "http://evil.example:$port" 403 "$port foreign-host-origin" ; r3=$?
    set -e
    stop_server
    overall=$((overall + r1 + r1b + r2 + r3))
    printf '%s\n    {"mode": "%s", "port": %s, "checks": ["correct-origin %s", "suffix-name-accepted %s", "wrong-port-origin %s", "foreign-host-origin %s"]}' \
      "$comma" "$mode" "$port" \
      "$([ $r1 -eq 0 ] && echo pass || echo FAIL)" \
      "$([ $r1b -eq 0 ] && echo pass || echo FAIL)" \
      "$([ $r2 -eq 0 ] && echo pass || echo FAIL)" \
      "$([ $r3 -eq 0 ] && echo pass || echo FAIL)"
    comma=","
  done
  echo ""
  echo "  ],"
  echo "  \"verdict\": \"$([ $overall -eq 0 ] && echo PASS || echo FAIL)\""
  echo "}"
} > "$RESULT"
rm -f "$EV/.fixture-body.json" "$EV/.fixture-body-suffixed.json"
echo "EVIDENCE_ENDPOINT $([ $overall -eq 0 ] && echo PASS || echo FAIL) result=$RESULT"
[ $overall -eq 0 ]
