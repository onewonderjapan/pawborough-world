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
if [ "${ZONE_SPLIT:-0}" = "1" ]; then
  blender -b --python-exit-code 1 -P scripts/export-zones.py
  # meshopt runtime copies (G6 compressed default); ZONE_CM=0 skips
  if [ "${ZONE_CM:-1}" = "1" ]; then node scripts/compress-zones.mjs; fi
fi
# First generate projections from final geometry; routes are calculated after this step.
PROJECT_ONLY=1 blender -b --python-exit-code 1 -P scripts/check-route-glb.py
node scripts/check-connectivity.mjs
blender -b --python-exit-code 1 -P scripts/check-route-glb.py
# WP4 walk: per-zone collision world export (format: docs/AREA-COLLISION-FORMAT.md);
# runs after nav-gap.json / commercial-route.json exist; WALK_COLLISION=0 skips
if [ "${WALK_COLLISION:-1}" = "1" ]; then node scripts/export-collision.mjs; fi
node scripts/validate.mjs
node src/coverage.mjs
# WP13: 导览机位 tour.json（依赖 check-connectivity 产出的 nav-gap.json；web 端取景导览按钮读取）
node scripts/compute-area-tour.mjs
npm test
