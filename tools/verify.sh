#!/usr/bin/env bash
# One-shot delivery verification for the Pawborough world workspace (N1).
# Chains: GLB format validation -> strict build -> manifest+dist hash check ->
# negative controls (manifest corruption, corrupted GLB) -> camera contract.
# Any step failing makes the script exit non-zero (set -e + explicit checks).
# The result JSON is bound to the exact input hashes and git commit it ran on.
#
# Run from anywhere: bash tools/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EV="../artifacts/N1"
mkdir -p "$EV"
LOG="$EV/verify-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1

echo "== pawborough-world verify.sh $STAMP =="
echo "git: $(git rev-parse HEAD) branch: $(git rev-parse --abbrev-ref HEAD)"

hashof() { sha256sum "$1" | cut -d' ' -f1; }
declare -A INPUT_HASHES=(
  [world/street-reviewed.glb]="$(hashof world/street-reviewed.glb)"
  [world/street-kit.glb]="$(hashof world/street-kit.glb)"
  [world/street.glb]="$(hashof world/street.glb)"
  [building/corner/model.glb]="$(hashof building/corner/model.glb)"
  [world/review-manifest.json]="$(hashof world/review-manifest.json)"
)
for k in "${!INPUT_HASHES[@]}"; do echo "input $k sha256 ${INPUT_HASHES[$k]}"; done

STEP=0
declare -a STEPS=() RESULTS=()
run_step() {
  STEP=$((STEP + 1))
  local name="$1"; shift
  echo "== step $STEP: $name =="
  if "$@"; then
    STEPS+=("$name"); RESULTS+=("pass")
  else
    STEPS+=("$name"); RESULTS+=("FAIL exit=$?")
    echo "VERIFY_FAIL at: $name"
    exit 1
  fi
}

run_step "glb-format-validate" node scripts/validate_all.cjs --report "$EV/validation.json"
run_step "strict-build" node scripts/build_review.mjs
run_step "manifest-and-dist-hash" node scripts/validate_manifest.cjs --report "$EV/manifest-validation.json"
run_step "negative-manifest-corruption" node scripts/manifest_negative_test.mjs
run_step "negative-corrupted-glb" node scripts/validate_negative_test.mjs
run_step "camera-contract" node scripts/camera_contract_test.mjs
run_step "world-inputs" node tests/world_inputs.test.mjs
run_step "walk-camera" node tests/walk_camera.test.mjs
run_step "physics-contract" node tests/physics_contract.test.mjs
run_step "session-lifecycle" node tests/session_lifecycle.test.mjs
run_step "laneb-contract" node tests/laneb_contract.test.mjs
run_step "laneb-texture-slots" node tests/laneb_texture_slots.test.mjs
run_step "block-lifecycle" node tests/block_lifecycle.test.mjs
run_step "block-production" node tests/block_production.test.mjs
run_step "placeholder-presentation" node tests/placeholder_presentation.test.mjs
# browser smoke + evidence endpoint: SMOKE_PORT / EV_PREVIEW_PORT / EV_DEV_PORT
# default to the PROJECT ports; override them when those are occupied (e.g.
# the owner's live 5285 preview must never be disturbed)
run_step "browser-smoke" node tools/browser_smoke.mjs ${SMOKE_PORT:+--port "$SMOKE_PORT"} ${SMOKE_SHOTS:+--shots "$SMOKE_SHOTS"}
run_step "evidence-endpoint-origin" bash tools/evidence_endpoint_test.sh

RESULT="$EV/verify-result.json"
{
  echo "{"
  echo "  \"what\": \"tools/verify.sh full chain\","
  echo "  \"atUTC\": \"$STAMP\","
  echo "  \"gitHead\": \"$(git rev-parse HEAD)\","
  echo "  \"gitBranch\": \"$(git rev-parse --abbrev-ref HEAD)\","
  echo "  \"inputSha256\": {"
  first=1
  for k in "${!INPUT_HASHES[@]}"; do
    [ $first -eq 1 ] && first=0 || echo ","
    printf '    "%s": "%s"' "$k" "${INPUT_HASHES[$k]}"
  done
  echo ""
  echo "  },"
  echo "  \"steps\": ["
  first=1
  for i in "${!STEPS[@]}"; do
    [ $first -eq 1 ] && first=0 || echo ","
    printf '    {"step": %d, "name": "%s", "result": "%s"}' "$((i + 1))" "${STEPS[$i]}" "${RESULTS[$i]}"
  done
  echo ""
  echo "  ],"
  echo "  \"verdict\": \"PASS\","
  echo "  \"log\": \"artifacts/N1/verify-$STAMP.log\""
  echo "}"
} > "$RESULT"
echo "VERIFY_PASS steps=$STEP result=$RESULT"
