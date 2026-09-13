#!/usr/bin/env bash
# R2 one-command reproducible delivery. Any failing step aborts with non-zero exit.
#
#   bash scripts/build_world_review.sh
#
# Steps: rebuild the repaired corner module -> assemble the frozen layout ->
# package the reviewed world (road orientation fix, kit, packed reopenable
# scene, 11 cameras) -> write the manifest from real bytes/hash/tris ->
# verify the saved scene -> verify geometry the glTF validator cannot see ->
# re-check glTF format on the changed assets -> strict web build (dist) ->
# strict manifest verification (workspace + dist) -> manifest corruption
# negative test -> R3 camera contract regression.
set -euo pipefail
cd "$(dirname "$0")/.."
B=${BLENDER:-blender}
FLAGS="--factory-startup -t 4"

echo "== 1/10 rebuild repaired corner module"
"$B" -b $FLAGS -P building/build_new_unit.py -- corner

echo "== 2/10 assemble frozen street layout"
"$B" -b $FLAGS -P scripts/assemble_street.py

echo "== 3/10 package reviewed world + scene.blend + cameras"
"$B" -b $FLAGS -P scripts/prepare_world_review.py

echo "== 4/10 write review-manifest from measured bytes/sha/tris"
python3 -X utf8 scripts/write_review_manifest.py

echo "== 5/10 verify saved scene reopens (triangles, 11 cameras, packed images, camera poses)"
"$B" -b $FLAGS -P scripts/check_world_scene.py

echo "== 6/10 verify road orientation + image connections in the reimported GLB"
"$B" -b $FLAGS -P scripts/check_world_geometry.py -- --glb world/street-reviewed.glb

echo "== 7/10 glTF format re-check (changed corner + assembled world + kit)"
node scripts/validate_all.cjs

echo "== 8/10 strict review web build"
npm run build

echo "== 9/10 strict manifest verification, workspace and dist"
node scripts/validate_manifest.cjs

echo "== 10/10 negative test (corrupted manifest must be rejected) + camera contract"
node scripts/manifest_negative_test.mjs
node scripts/camera_contract_test.mjs

echo "BUILD_WORLD_REVIEW: ALL STEPS PASSED"
