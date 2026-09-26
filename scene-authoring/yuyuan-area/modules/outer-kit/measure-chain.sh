#!/usr/bin/env bash
# wave7-outerkit 方案对比实测：拿一份已完成默认全流程重建的 OUT_DIR（SRC）复制到 DST，只重跑 outerBuilding 会影响到的环节
# （build-scene → assemble → audit-commerce → plan-food → assemble-food → export-zones → compress-zones），
# 得到 DST/zones-manifest.json 里 zone-outer.glb / .cm.glb 的实测字节。不跑路线 / 碰撞 / 测试（公共验收另跑全流程）。
# 用法：SRC=out-zone DST=out-kit-tex OUTER_KIT=1 OUTER_KIT_MODE=tex bash modules/outer-kit/measure-chain.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${SRC:?SRC=<rebuilt OUT_DIR>}" "${DST:?DST=<scratch OUT_DIR>}"
mkdir -p "$DST"
cp -a "$SRC"/. "$DST"/
export OUT_DIR="$DST" PYTHONPATH="$PWD/.python-deps" SITE_MODULES=1 STALL_KIT=1 GARDEN_KITS=1 SANSUITANG=1 ZONE_SPLIT=1
BL="${BLENDER:-$HOME/.local/bin/blender} -b -t 4 --python-exit-code 1"
node src/build-scene.mjs
$BL -P scripts/assemble.py
node scripts/audit-commerce.mjs
node scripts/plan-food.mjs
$BL -P scripts/assemble-food.py
$BL -P scripts/export-zones.py
node scripts/compress-zones.mjs
node -e "const m=require('./$DST/zones-manifest.json');const z=m.zones.find(z=>z.id==='outer');console.log('MEASURE',process.env.OUTER_KIT_MODE||'off',z.bytes,z.cm.bytes,z.cm.validatorErrors)"
