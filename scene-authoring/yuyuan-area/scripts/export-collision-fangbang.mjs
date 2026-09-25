// 方浜中路分区碰撞 + 路线导出（FANGBANG=1；GOAL wave1-fangbang F2）。
// 碰撞：v7 world/fangbang-temple-v7/collision-world.json 的**非庙轴**记录平移 (53.5,-17.4) 后写
//   OUT_DIR/collision-fangbang.json，格式同 docs/AREA-COLLISION-FORMAT.md（形式 (a) obb / 形式 (b) min-max，
//   obbToWorld() 不改）；`module` 保留 v7 原值，记录名加前缀 `fangbang-`。庙轴记录（全域庙区已有）不导出，
//   山门前不产生与庙区重复或留缝的墙（见 tests/fangbang-test.mjs 接缝检查）。
// 路线：OUT_DIR/fangbang-route.json = v7 route.json mainStreet 平移到地图坐标；山门接点 = baseline/layout.json
//   的 temple-shanmen 锚（与平移后的 v7 山门锚逐位一致），并把 out-zone/commercial-route.json 里离山门最近的
//   商业路线采样点记为全域衔接（存在时）。
// 用法：OUT_DIR=out-zone node scripts/export-collision-fangbang.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AREA, '..', '..');                 // 仓库根（world/ 所在）
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const FB7 = path.join(REPO, 'world', 'fangbang-temple-v7');
const OFF = [53.5, -17.4];                                   // 地图 = v7 + (53.5,-17.4)（v7 blocks.json anchor）

const instDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'instances.json'), 'utf8'));
const colDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'collision-world.json'), 'utf8'));
const routeDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'route.json'), 'utf8'));
const layoutSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(AREA, 'baseline', 'layout.json'))).digest('hex');

const templeIds = new Set(instDoc.instances.filter(i => i.group === 'temple-axis-v2').map(i => i.id));
if (templeIds.size !== 19) throw new Error(`expected 19 temple-axis-v2 instances in v7, got ${templeIds.size}`);

// ---------- 主控决定 1（GOAL 放行口径）：未放置实例的碰撞一并剔除。以 assemble-stats.json 的
// fangbangExcluded 为准（封墙一律去；168/170/171 由装配时几何判定），GLB 与碰撞同源不走样。
// ---------- 主控决定 2：补齐件（fangbang-infill.json）的碰撞按 donor 记录克隆（同模块局部 center/size
// 不随实例变，pos=补齐位姿、theta=补齐 rotY 即精确）。
const statsFile = path.join(OUT, 'assemble-stats.json');
if (!fs.existsSync(statsFile)) throw new Error(`missing ${statsFile} — run assemble with FANGBANG=1 first`);
const fbStats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
const notPlaced = new Set((fbStats.fangbangExcluded || []).filter(e => !e.kept).map(e => e.id));
const infillDoc = JSON.parse(fs.readFileSync(path.join(OUT, 'fangbang-infill.json'), 'utf8'));

const kept = [], skipped = [], skippedNotPlaced = [];
for (const rec of colDoc.colliders) {
  const instId = rec.name.split(':')[0];
  if (templeIds.has(instId)) { skipped.push(rec.name); continue; }
  if (notPlaced.has(instId)) { skippedNotPlaced.push(rec.name); continue; }
  const out = { name: 'fangbang-' + rec.name, module: rec.module, type: rec.type || 'box' };
  if (rec.obb) {
    out.obb = {
      pos: [+(rec.obb.pos[0] + OFF[0]).toFixed(4), rec.obb.pos[1] ?? 0, +(rec.obb.pos[2] + OFF[1]).toFixed(4)],
      theta: rec.obb.theta,
      center: rec.obb.center,
      size: rec.obb.size,
    };
  } else if (Array.isArray(rec.min) && Array.isArray(rec.max)) {
    out.min = [rec.min[0] + OFF[0], rec.min[1], rec.min[2] + OFF[1]];
    out.max = [rec.max[0] + OFF[0], rec.max[1], rec.max[2] + OFF[1]];
  } else {
    throw new Error(`collider ${rec.name}: neither obb nor min/max`);
  }
  kept.push(out);
}
// ---------- wave5 F-04：collision-world.json 没有记录的已放置实例，取模块旁的 collision.json sidecar ----------
// east-edge（128/129）、street-completion（130–133）、lanes-v2（lane-a / lane-b-v2 / interfaces）的碰撞在 v7 里是按件
// sidecar 交付的（v7 世界坐标，obb.pos = 实例位姿），collision-world.json 没合进来 —— 这 9 件原先在方浜分区里没有墙。
// 模块路径取 v7 review-manifest（与 assemble 放置同源）；同样平移 (53.5,-17.4)，名字加 fangbang- 前缀。
const manifestFb = JSON.parse(fs.readFileSync(path.join(FB7, 'review-manifest.json'), 'utf8'));
const modPathFb = new Map(manifestFb.modules.map(m => [m.id, path.join(REPO, m.path.replace(/^\.\//, ''))]));
const haveWorldRecs = new Set(colDoc.colliders.map(r => r.name.split(':')[0]));
const sidecarAdded = [];
for (const inst of instDoc.instances) {
  if (templeIds.has(inst.id) || notPlaced.has(inst.id) || haveWorldRecs.has(inst.id)) continue;
  const mp = modPathFb.get(inst.module);
  const side = mp && path.join(path.dirname(mp), 'collision.json');
  if (!side || !fs.existsSync(side)) continue;
  // 目录级 sidecar 可能装着别的件（west-extension/collision.json 里是封墙和围界），只取记录名前缀 = 本实例 id 的
  const own = (JSON.parse(fs.readFileSync(side, 'utf8')).colliders || []).filter(r => r.name.split(':')[0] === inst.id);
  if (!own.length) continue;
  for (const rec of own) {
    if (!rec.obb) throw new Error(`sidecar record ${rec.name} (${side}) not obb form`);
    kept.push({
      name: 'fangbang-' + rec.name, module: rec.module ?? inst.module, type: rec.type || 'box',
      obb: { pos: [+(rec.obb.pos[0] + OFF[0]).toFixed(4), rec.obb.pos[1] ?? 0, +(rec.obb.pos[2] + OFF[1]).toFixed(4)], theta: rec.obb.theta, center: rec.obb.center, size: rec.obb.size },
    });
  }
  sidecarAdded.push({ id: inst.id, source: path.relative(REPO, side), records: own.length });
}
for (const it of infillDoc.southGap.placed.concat(infillDoc.northGap.placed)) {
  for (const rec of colDoc.colliders.filter(r => r.name.split(':')[0] === it.donor)) {
    if (!rec.obb) throw new Error(`infill donor record ${rec.name} not obb form`);
    kept.push({
      name: `fangbang-${it.id}:${rec.name.split(':').slice(1).join(':')}`,
      module: it.module, type: 'box', designInference: true,
      obb: { pos: [it.positionMap[0], 0, it.positionMap[2]], theta: it.rotY, center: rec.obb.center, size: rec.obb.size },
    });
  }
}

// ---------- 山门接缝去重（GOAL Fallback：以全域庙区为准，删 fangbang 一侧的重叠碰撞，记录 id） ----------
// 庙区基准 = v7 collision-world.json 的 temple-axis-v2 记录同平移（全域庙区碰撞源；山门锚与 layout 逐位一致）。
// 山门 10 m 内 fangbang 记录与庙区记录的 AABB 相交体积 > 0.05 m^3 的，丢弃并登记 seamDedup。
const SHANMEN = [-74.317, 9.657];
const SEAM_R = 10, SEAM_CAP = 0.05;
const toBox = (rec, translate) => {
  let w;
  if (translate) {
    w = obbToWorld(rec.obb
      ? { ...rec, obb: { ...rec.obb, pos: [rec.obb.pos[0] + OFF[0], rec.obb.pos[1] ?? 0, rec.obb.pos[2] + OFF[1]] } }
      : { ...rec, min: [rec.min[0] + OFF[0], rec.min[1], rec.min[2] + OFF[1]], max: [rec.max[0] + OFF[0], rec.max[1], rec.max[2] + OFF[1]] });
  } else {
    w = obbToWorld(rec);   // collision-fangbang 记录已是地图坐标
  }
  const c = Math.abs(Math.cos(w.yaw)), s = Math.abs(Math.sin(w.yaw));
  const ex = [c * w.halfExtents[0] + s * w.halfExtents[2], w.halfExtents[1], s * w.halfExtents[0] + c * w.halfExtents[2]];
  return { center: w.center, aabb: [w.center.map((v, i) => v - ex[i]), w.center.map((v, i) => v + ex[i])] };
};
const overlapVol = (a, b) => [0, 1, 2].reduce((v, i) => v * Math.max(0, Math.min(a[1][i], b[1][i]) - Math.max(a[0][i], b[0][i])), 1);
const templeRecs = colDoc.colliders.filter(r => templeIds.has(r.name.split(':')[0]));
const templeNear = templeRecs.map(r => ({ name: r.name, box: toBox(r, true) })).filter(x => Math.hypot(x.box.center[0] - SHANMEN[0], x.box.center[2] - SHANMEN[1]) <= SEAM_R);
const seamDedup = [];
const kept2 = [];
for (const rec of kept) {
  const box = toBox(rec, false);
  const near = Math.hypot(box.center[0] - SHANMEN[0], box.center[2] - SHANMEN[1]) <= SEAM_R;
  let worst = null;
  if (near) {
    for (const t of templeNear) {
      const v = overlapVol(box.aabb, t.box.aabb);
      if (v > SEAM_CAP && (!worst || v > worst.overlapM3)) worst = { templeRecord: t.name, overlapM3: +v.toFixed(4) };
    }
  }
  if (worst) seamDedup.push({ dropped: rec.name, module: rec.module ?? null, ...worst, reason: 'shanmen seam overlap; temple zone wins (GOAL Fallback #3)' });
  else kept2.push(rec);
}

// ---------- 街段↔连接段接缝去重（主控决定 3：视觉保留，碰撞以街段一侧为准） ----------
// F1 实测两处实体互穿：N01-plain-v1 × westshop-shop-154（北缝，mesh 15 690 对）、
// S01-corner × westshop-shop-153（南缝，14 072 对）。缝两侧的 fangbang 记录都在本分区里，
// 店屋一侧与街段记录 AABB 相交 > 0.05 m³ 的丢弃，缝由街段（N01/S01）碰撞覆盖。
const STREET_SEAM = [['N01-plain-v1', 'westshop-shop-154'], ['S01-corner', 'westshop-shop-153']];
const SEAM_CAP2 = 0.05;
const streetSeamDedup = [];
const kept3 = [];
for (const rec of kept2) {
  const instId = rec.name.replace(/^fangbang-/, '').split(':')[0];
  const pair = STREET_SEAM.find(([, shop]) => shop === instId);
  let worst = null;
  if (pair) {
    for (const st of kept2) {
      if (st.name.replace(/^fangbang-/, '').split(':')[0] !== pair[0]) continue;
      const v = overlapVol(toBox(rec, false).aabb, toBox(st, false).aabb);
      if (v > SEAM_CAP2 && (!worst || v > worst.overlapM3)) worst = { streetRecord: st.name, overlapM3: +v.toFixed(4) };
    }
  }
  if (worst) streetSeamDedup.push({ dropped: rec.name, ...worst, reason: 'street/connector seam overlap; street side wins (lead decision 3)' });
  else kept3.push(rec);
}

const collision = {
  axis: 'glTF Y-up; X east, Z south; heights from ground y=0',
  zone: 'fangbang',
  source: 'world/fangbang-temple-v7/collision-world.json non-temple-axis records translated by (53.5, -17.4); names prefixed fangbang-, module kept from v7',
  sourceLayoutSha256: layoutSha,
  mapOffset: OFF,
  excludedTempleAxisRecords: skipped.length,
  notPlacedInstances: [...notPlaced].sort(),
  notPlacedRecordsDropped: skippedNotPlaced.length,
  sidecarColliders: sidecarAdded,
  infillColliders: infillDoc.southGap.placed.concat(infillDoc.northGap.placed).length ? infillDoc.southGap.placed.map(i => i.id) : 'none',
  seamDedup: seamDedup.length ? seamDedup : 'none',
  streetSeamDedup: streetSeamDedup.length ? streetSeamDedup : 'none',
  groundNodeRe: 'street-kit__(quiet-gray-asphalt|paving-frontage|worn-stone)|sctail__(quiet-gray-asphalt|worn-stone)|westbounds__worn-stone',
  colliders: kept3,
};
fs.writeFileSync(path.join(OUT, 'collision-fangbang.json'), JSON.stringify(collision, null, 1) + '\n');
console.log(`sidecar colliders: ${sidecarAdded.map(a => a.id + ' ' + a.records).join(', ') || 'none'}`);
console.log(`collision-fangbang.json: ${kept3.length} colliders (excluded ${skipped.length} temple-axis records; dropped ${skippedNotPlaced.length} not-placed records for ${[...notPlaced].join(', ') || 'none'}; v7 total ${colDoc.colliders.length}); seamDedup dropped ${seamDedup.length}: ${seamDedup.map(d => d.dropped).join(', ') || 'none'}; streetSeamDedup dropped ${streetSeamDedup.length}: ${streetSeamDedup.map(d => d.dropped).join(', ') || 'none'}`);

// ---------- 路线（平移到地图坐标 + 山门接点） ----------
const mainStreet = routeDoc.mainStreet.map(p => [+(p[0] + OFF[0]).toFixed(4), p[1], +(p[2] + OFF[1]).toFixed(4)]);
// v7 山门锚平移后 = layout temple-shanmen (−74.317, 9.657)；找 mainStreet 上离它最近的采样点作为接点
const shanmen = [-74.317, 9.657];
let ji = 0, jd = Infinity;
mainStreet.forEach((p, i) => {
  const d = Math.hypot(p[0] - shanmen[0], p[2] - shanmen[1]);
  if (d < jd) { jd = d; ji = i; }
});
if (jd > 0.01) throw new Error(`fangbang route does not pass the shanmen anchor (nearest ${jd.toFixed(3)}m)`);

const junction = {
  at: shanmen,
  atV7: [-127.817, 27.057],
  pointIndex: ji,
  distanceToAnchorM: +jd.toFixed(4),
  connects: 'baseline/layout.json templeAnchor temple-shanmen（全域庙区山门）；过门后沿庙轴北上（v7 路线继续经仪门/大殿/后殿），与庙区分区共用以庙区碰撞为准',
};
const crFile = path.join(OUT, 'commercial-route.json');
if (fs.existsSync(crFile)) {
  const cr = JSON.parse(fs.readFileSync(crFile, 'utf8'));
  let best = null;
  for (const r of cr.routes || []) {
    for (const p of r.points || []) {
      const d = Math.hypot(p[0] - shanmen[0], p[1] - shanmen[1]);
      if (!best || d < best.distanceM) best = { route: `${r.from}->${r.to}`, pass: r.pass || undefined, point: [+(p[0]).toFixed(3), +(p[1]).toFixed(3)], distanceM: +d.toFixed(2) };
    }
  }
  if (best) junction.nearestCommercialRoute = best;
} else {
  junction.nearestCommercialRoute = 'out-zone/commercial-route.json 不存在（本轮 OUT_DIR 未跑路线检查），仅记录山门锚接点';
}
const route = {
  axis: 'glTF Y-up; X east, Z south; heights 0 (ground walking)',
  zone: 'fangbang',
  source: 'world/fangbang-temple-v7/route.json mainStreet translated by (53.5, -17.4)',
  mapOffset: OFF,
  mainStreet,
  junction,
};
fs.writeFileSync(path.join(OUT, 'fangbang-route.json'), JSON.stringify(route, null, 1) + '\n');
console.log(`fangbang-route.json: ${mainStreet.length} points, junction at index ${ji} (shanmen), nearestCommercialRoute: ${junction.nearestCommercialRoute && junction.nearestCommercialRoute.route ? junction.nearestCommercialRoute.route + ' @' + junction.nearestCommercialRoute.distanceM + 'm' : 'n/a'}`);
