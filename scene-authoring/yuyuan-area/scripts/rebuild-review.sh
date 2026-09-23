#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT_DIR="${OUT_DIR:-out-rebuilt-review}"
# The input snapshot and accepted source modules remain read-only.
python3 -X utf8 scripts/repair-layout.py
node src/build-scene.mjs
blender -b --python-exit-code 1 -P scripts/assemble.py
node scripts/audit-commerce.mjs
node scripts/plan-food.mjs
blender -b --python-exit-code 1 -P scripts/assemble-food.py
# ZONE_SPLIT=1: runtime zone GLBs + zones-manifest.json (browser loads per zone; scene-areas.glb stays as the offline check artifact)
if [ "${ZONE_SPLIT:-0}" = "1" ]; then blender -b --python-exit-code 1 -P scripts/export-zones.py; fi
# First generate projections from final geometry; routes are calculated after this step.
PROJECT_ONLY=1 blender -b --python-exit-code 1 -P scripts/check-route-glb.py
node scripts/check-connectivity.mjs
blender -b --python-exit-code 1 -P scripts/check-route-glb.py
node scripts/validate.mjs
node src/coverage.mjs
npm test
