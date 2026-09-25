#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT_DIR="${OUT_DIR:-out-rebuilt-review}"
# M1: garden-kit 站点模块是预生成输入（记录在 docs/MIGRATION-ASSETS.json，sha 定账）。
# 权威副本在固定暂存目录 staged/site-modules/；管线从那里读，这里另复制一份进 OUT_DIR，
# 让交付清单 / validator / 产物检查继续把站点模块 GLB 当作 OUT_DIR 产物看待（下游不变）。
if [ -d staged/site-modules ]; then
  mkdir -p "$OUT_DIR"
  cp -pr staged/site-modules/. "$OUT_DIR"/
fi
# The input snapshot and accepted source modules remain read-only.
python3 -X utf8 scripts/repair-layout.py
# HALL_KIT=1: 厅堂套件逐栋从 layout 字段重生成（id 列表唯一来源 modules/hall-kit/ids.json），再由 assemble 实例放置
if [ "${HALL_KIT:-0}" = "1" ]; then
  for hk_id in $(node -e "console.log(JSON.parse(require('fs').readFileSync('modules/hall-kit/ids.json','utf8')).ids.join(' '))"); do
    blender -b -t 4 --python-exit-code 1 -P modules/hall-kit/build_hall.py -- --id "$hk_id"
  done
fi
# 湖心亭站点模块（默认开启，2026-09-25 机主定；HUXINTING=0 关闭）：先生成 $OUT_DIR/huxin-ting.glb，assemble 导入 SITE-pond
if [ "${HUXINTING:-1}" != "0" ]; then
  blender -b -t 4 --python-exit-code 1 -P modules/huxinting/build.py
fi
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
# 方浜中路 fifth zone (default on since 2026-09-24; FANGBANG=0 turns it off) -> zone collision + route
if [ "${FANGBANG:-1}" != "0" ] && [ "${ZONE_SPLIT:-0}" = "1" ]; then
  node scripts/export-collision-fangbang.mjs
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
