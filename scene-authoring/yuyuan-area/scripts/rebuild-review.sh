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
# First generate projections from final geometry; routes are calculated after this step.
PROJECT_ONLY=1 blender -b --python-exit-code 1 -P scripts/check-route-glb.py
node scripts/check-connectivity.mjs
blender -b --python-exit-code 1 -P scripts/check-route-glb.py
node scripts/validate.mjs
node src/coverage.mjs
npm test
