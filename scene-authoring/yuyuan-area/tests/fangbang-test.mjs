// 方浜中路第五分区验收（GOAL wave1-fangbang F2 + 主控放行口径 2026-09-23）。
// 对照基准全部取自源数据（不拿产物和自己比）：
//   实例/位置 = world/fangbang-temple-v7/instances.json + (53.5,-17.4)；
//   剔除规则独立重算：westext-seal-wall 一律去（决定 1）；168/170/171 与 layout 实体 footprint 多边形、
//     v7 庙轴碰撞盒（=全域庙区包围盒，山门锚逐位一致）任一相交即剔（决定 1）；
//   补齐件 = OUT_DIR/fangbang-infill.json 的位姿，但几何合法性（不相交、在断带内、路口保留）全部用
//     v7 collision-world + layout 重算校验（决定 2）；
//   街缝去重 = N01×154、S01×153 按 v7 记录重算应删集合，碰撞产物里不得出现（决定 3，街段一侧为准）；
//   山门 10m 缝 = 与庙轴记录平移后 AABB 相交体积 ≤ 0.05 m³；路线 = 每 0.5m 胶囊采样不落任何 fangbang 盒。
// 用法：OUT_DIR=out-zone node tests/fangbang-test.mjs（产物缺失时退出码 2 = 未构建，也算「在未修改产物上失败」）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';
import { triangleCounts } from '../src/reconcile.mjs';
import { readGlb, transformPoint } from '../../../src/world/glbReader.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AREA, '..', '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const FB7 = path.join(REPO, 'world', 'fangbang-temple-v7');
const OFF = [53.5, -17.4];
const R = 0.35, BODY = [0.3, 1.9], STEP = 0.5;
const SHANMEN = [-74.317, 9.657];
const SEAM_CAP = 0.05;
const SOLID_KINDS = new Set(['outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'waterside',
  'stage', 'wall', 'corridor', 'watersideGallery', 'moonGateWall', 'wallHead']);
const WEST_SHOPS = ['westshop-shop-168', 'westshop-shop-170', 'westshop-shop-171'];

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; if (process.env.VERBOSE) console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

function glbJson(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(`${file}: not GLB`);
  let off = 12;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off), typ = b.readUInt32LE(off + 4);
    if (typ === 0x4E4F534A) return JSON.parse(b.slice(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len;
  }
  throw new Error(`${file}: no JSON chunk`);
}
function aabbOfBox(bx) {   // obbToWorld -> rotated AABB
  const { center, halfExtents, yaw } = bx;
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const ex = [c * halfExtents[0] + s * halfExtents[2], halfExtents[1], s * halfExtents[0] + c * halfExtents[2]];
  return [center.map((v, i) => v - ex[i]), center.map((v, i) => v + ex[i])];
}
const overlapVol = (a, b) => [0, 1, 2].reduce((v, i) => v * Math.max(0, Math.min(a[1][i], b[1][i]) - Math.max(a[0][i], b[0][i])), 1);
function polyOverlapsAabb(poly, lo, hi) {   // 2D polygon (x,z) vs AABB — vertex/corner/edge 任一相交即真
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  if (Math.max(...xs) < lo[0] || Math.min(...xs) > hi[0] || Math.max(...zs) < lo[2] || Math.min(...zs) > hi[2]) return false;
  const corners = [[lo[0], lo[2]], [hi[0], lo[2]], [hi[0], hi[2]], [lo[0], hi[2]]];
  const inside = (px, pz) => {
    let cin = false;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
      if ((z1 > pz) !== (z2 > pz) && px < (x2 - x1) * (pz - z1) / (z2 - z1) + x1) cin = !cin;
    }
    return cin;
  };
  if (corners.some(([cx, cz]) => inside(cx, cz))) return true;
  if (poly.some(([px, pz]) => px >= lo[0] && px <= hi[0] && pz >= lo[2] && pz <= hi[2])) return true;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      const d = (p, q, rx, ry, sx, sy) => (sx - rx) * (q - ry) - (sy - ry) * (p - rx);
      const d1 = d(x1, z1, x2, z2, ax, az), d2 = d(x1, z1, x2, z2, bx, bz);
      const d3 = d(ax, az, bx, bz, x1, z1), d4 = d(ax, az, bx, bz, x2, z2);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
}

// ---------- 源数据 ----------
const manifestPath = path.join(OUT, 'zones-manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { zones: [] };
const listed = manifest.zones.filter(z => z.id === 'fangbang' && z.file).map(z => path.join(OUT, z.file));
const files = listed.length ? listed : fs.readdirSync(OUT).filter(f => /^zone-fangbang(-\d+)?\.glb$/.test(f) && !f.endsWith('.cm.glb')).map(f => path.join(OUT, f));
if (!files.length) {
  console.log('fangbang-test: NOT BUILT — no zone-fangbang-*.glb in', OUT, '(build with FANGBANG=1 ZONE_SPLIT=1)');
  process.exit(2);
}
for (const f of [path.join(OUT, 'collision-fangbang.json'), path.join(OUT, 'fangbang-route.json'), path.join(OUT, 'fangbang-infill.json'), path.join(OUT, 'assemble-stats.json')]) {
  if (!fs.existsSync(f)) { console.log('fangbang-test: NOT BUILT — missing', path.basename(f)); process.exit(2); }
}
const instDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'instances.json'), 'utf8'));
const v7 = new Map(instDoc.instances.map(i => [i.id, i]));
const templeIds = new Set(instDoc.instances.filter(i => i.group === 'temple-axis-v2').map(i => i.id));
const colDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'collision-world.json'), 'utf8'));
const perId = new Map();
for (const r of colDoc.colliders) {
  const id = r.name.split(':')[0];
  if (!perId.has(id)) perId.set(id, []);
  perId.get(id).push(r);
}
const recAabb = r => aabbOfBox(obbToWorld(r));
const instAabb = (id, baseOnly = false) => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const r of perId.get(id) || []) {
    if (baseOnly && r.obb && r.obb.center[1] - r.obb.size[1] / 2 > 1.0) continue;
    const [a, b] = recAabb(r);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a[i]); hi[i] = Math.max(hi[i], b[i]); }
  }
  return [lo, hi];
};
const layout = JSON.parse(fs.readFileSync(path.join(AREA, 'baseline', 'layout.json'), 'utf8'));
const solids = layout.objects.filter(o => SOLID_KINDS.has(o.kind) && o.geometry && o.geometry.footprint)
  .map(o => [o.id, o.geometry.footprint]);
// 剔除集独立重算（决定 1）
// 封墙规则（主控决定 1 的同一口径，wave5 F-03 推广到两端）：v7 *-seal-wall 件若挡住 layout 里继续延伸的方浜中路，
// 一律不放。判定全部取源：墙 = v7 collision-world 记录平移；路 = baseline/layout.json 名为「方浜中路」的 road 折线；
// 墙法线 = 记录 theta 的局部 x 轴；fangbang 主路线（v7 route.json 平移）质心所在一侧为「内」，另一侧有路点离墙 ≥ 10 m、
// 且该路有点离墙中心 ≤ 15 m（同一条路）= 路继续延伸，墙挡路。
const fbRoads = layout.objects.filter(o => o.kind === 'road' && o.name === '方浜中路' && o.geometry && o.geometry.polyline).map(o => o.geometry.polyline);
const v7Route = JSON.parse(fs.readFileSync(path.join(FB7, 'route.json'), 'utf8')).mainStreet.map(p => [p[0] + OFF[0], p[2] + OFF[1]]);
const routeC = v7Route.reduce((a, p) => [a[0] + p[0] / v7Route.length, a[1] + p[1] / v7Route.length], [0, 0]);
const sealWallIds = instDoc.instances.filter(i => /seal-wall$/.test(i.module)).map(i => i.id);
const sealBlocks = {};
for (const wid of sealWallIds) {
  const rec = (perId.get(wid) || [])[0];
  if (!rec) continue;
  const w = obbToWorld(rec);
  const wc = [w.center[0] + OFF[0], w.center[2] + OFF[1]];
  const n = [Math.cos(w.yaw), -Math.sin(w.yaw)];
  const side = Math.sign((routeC[0] - wc[0]) * n[0] + (routeC[1] - wc[1]) * n[1]) || 1;
  sealBlocks[wid] = fbRoads.some(pl => pl.some(q => Math.hypot(q[0] - wc[0], q[1] - wc[1]) <= 15)
    && pl.some(q => -side * ((q[0] - wc[0]) * n[0] + (q[1] - wc[1]) * n[1]) >= 10));
}
const excluded = new Set(Object.entries(sealBlocks).filter(([, b]) => b).map(([id]) => id));
for (const sid of WEST_SHOPS) {
  const [lo, hi] = instAabb(sid);
  const mlo = [lo[0] + OFF[0], lo[1], lo[2] + OFF[1]], mhi = [hi[0] + OFF[0], hi[1], hi[2] + OFF[1]];
  const hitSolid = solids.some(([, poly]) => polyOverlapsAabb(poly, mlo, mhi));
  const hitTemple = colDoc.colliders.some(r => templeIds.has(r.name.split(':')[0]) && overlapVol([lo, hi], recAabb(r)) > 1e-6);
  if (hitSolid || hitTemple) excluded.add(sid);
}
const v7Expected = instDoc.instances.filter(i => i.group !== 'temple-axis-v2' && !excluded.has(i.id));
const infillDoc = JSON.parse(fs.readFileSync(path.join(OUT, 'fangbang-infill.json'), 'utf8'));
const gapSpec = (infillDoc.frontageGaps && infillDoc.frontageGaps.placed) || [];   // wave5 F-07 临街面补齐
const infillSpec = infillDoc.southGap.placed.concat(infillDoc.northGap.placed, gapSpec);

// ---------- 1) GLB 锚：实例数 / 前缀 / 剔除不泄漏 / street-ground 偏移 ----------
const v7Anchors = [], infillAnchors = [];
let streetGroundT = null;
const groundAnchors = [];   // wave5 F-05：其余街地面件（尾段路面），不计入 v7 实例数
for (const f of files) {
  const j = glbJson(f);
  for (const n of j.nodes || []) {
    const ex = n.extras || {};
    if (ex.id === 'fangbang-street-ground') streetGroundT = n.translation || [0, 0, 0];
    else if (ex.group === 'street-ground') groundAnchors.push({ id: ex.id, t: n.translation || [0, 0, 0], ex });
    else if (ex.id && String(ex.id).startsWith('fangbang-infill-')) infillAnchors.push({ id: ex.id, t: n.translation || [0, 0, 0], ex, file: path.basename(f) });
    else if (ex.id && String(ex.id).startsWith('fangbang-')) v7Anchors.push({ id: ex.id, v7id: ex.v7id, t: n.translation || [0, 0, 0], file: path.basename(f) });
  }
}
const expectedTotal = v7Expected.length + infillSpec.length;
ok(`instance count = ${instDoc.instances.length} - ${templeIds.size} temple - ${excluded.size} excluded + ${infillSpec.length} infill = ${expectedTotal} (got ${v7Anchors.length + infillAnchors.length})`,
  v7Anchors.length + infillAnchors.length === expectedTotal,
  `v7 ${v7Anchors.length}/${v7Expected.length} infill ${infillAnchors.length}/${infillSpec.length}`);
ok(`v7 anchor set == expected placed set (excluded ${[...excluded].join(', ')})`,
  v7Anchors.length === v7Expected.length && v7Anchors.every(a => v7.has(a.v7id) && !excluded.has(a.v7id) && !templeIds.has(a.v7id))
  && new Set(v7Anchors.map(a => a.v7id)).size === v7Expected.length
  && v7Expected.every(i => v7Anchors.some(a => a.v7id === i.id)));
ok('anchor names prefixed fangbang-', v7Anchors.every(a => a.id === 'fangbang-' + a.v7id) && infillAnchors.every(a => a.id.startsWith('fangbang-infill-')));
ok('street-ground anchor at map offset (53.5, -17.4)',
  streetGroundT && Math.abs(streetGroundT[0] - 53.5) <= 0.01 && Math.abs(streetGroundT[2] + 17.4) <= 0.01,
  JSON.stringify(streetGroundT));
{
  // wave5 F-05：v7 尾段路面（review-manifest streetCompletion.eastTailSurface）按同一坐标契约放置
  const ets = JSON.parse(fs.readFileSync(path.join(FB7, 'review-manifest.json'), 'utf8')).streetCompletion.eastTailSurface;
  const g = groundAnchors.find(a => a.id === 'fangbang-east-tail-surface');
  ok(`east tail surface (${ets.path}) placed at map offset (53.5, -17.4)`,
    !!g && g.ex.source === ets.path && Math.abs(g.t[0] - 53.5) <= 0.01 && Math.abs(g.t[2] + 17.4) <= 0.01, JSON.stringify(g && g.t));
  ok(`only known street-ground anchors (${groundAnchors.map(a => a.id).join(',')})`, groundAnchors.every(a => a.id === 'fangbang-east-tail-surface'));
}

// ---------- 2) v7 件放置位置与 v7 平移差 ≤ 0.01 m ----------
let maxErr = 0, worst = '';
for (const a of v7Anchors) {
  const inst = v7.get(a.v7id);
  const dx = Math.abs(a.t[0] - (inst.positionGlb[0] + OFF[0]));
  const dz = Math.abs(a.t[2] - (inst.positionGlb[2] + OFF[1]));
  if (Math.max(dx, dz) > maxErr) { maxErr = Math.max(dx, dz); worst = a.id; }
}
ok(`v7 placement vs v7+offset <= 0.01m (max ${maxErr.toFixed(5)} @${worst})`, maxErr <= 0.01);

// ---------- 3) 补齐件校验（决定 2）：designInference、位姿与 infill.json 一致、几何合法性全重算 ----------
const westModules = new Set(instDoc.instances.filter(i => (i.group || '').startsWith('west-band') || (i.group || '') === 'west-extension' || (i.group || '').startsWith('westshops')).map(i => i.module));
ok(`infill spec non-empty in south gap (got ${infillDoc.southGap.placed.length})`, infillDoc.southGap.placed.length >= 1);
const infillBoxes = [];
for (const it of infillSpec) {
  const [ilo, ihi] = [ [1e9, 1e9, 1e9], [-1e9, -1e9, -1e9] ];
  const rot = it.rotY, c = Math.cos(rot), s = Math.sin(rot);
  const cz0 = it.positionGlb[2];
  for (const r of (perId.get(it.donor) || [])) {
    if (r.obb && r.obb.center[1] - r.obb.size[1] / 2 > 1.0) continue;
    const o = r.obb;
    const lx = c * o.center[0] + s * o.center[2], lz = -s * o.center[0] + c * o.center[2];
    const hx = o.size[0] / 2, hy = o.size[1] / 2, hz = o.size[2] / 2;
    const cc = Math.abs(c), ss = Math.abs(s);
    const ex = cc * hx + ss * hz, ez = ss * hx + cc * hz;
    for (let i = 0; i < 3; i++) {
      const a = [it.positionGlb[0] + lx - ex, o.center[1] - hy, cz0 + lz - ez][i];
      const b = [it.positionGlb[0] + lx + ex, o.center[1] + hy, cz0 + lz + ez][i];
      ilo[i] = Math.min(ilo[i], a); ihi[i] = Math.max(ihi[i], b);
    }
  }
  infillBoxes.push([ilo, ihi]);
}
ok('infill modules reuse west-band shop modules', infillSpec.every(it => westModules.has(it.module) && v7.get(it.donor)?.module === it.module),
  JSON.stringify(infillSpec.map(i => i.module)));
ok('infill flagged designInference (json + glb extras)', infillSpec.every(it => it.designInference === true) && infillAnchors.every(a => a.ex.designInference === true));
ok(`infill anchor poses match fangbang-infill.json (<=0.01m / 1e-3 rad)`,
  infillAnchors.length === infillSpec.length && infillSpec.every(it => {
    const a = infillAnchors.find(x => x.id === it.id);
    return a && Math.abs(a.t[0] - it.positionMap[0]) <= 0.01 && Math.abs(a.t[2] - it.positionMap[2]) <= 0.01
      && Math.abs((a.ex.rotY ?? 9) - it.rotY) <= 1e-3;
  }));
{
  // 几何合法性全部重算：补齐件 AABB 与任何已放置 v7 件（逐碰撞记录，散件实例不做联合）、
  // 其他补齐件、layout 实体 footprint 都不相交
  const placedRecs = colDoc.colliders.filter(r => {
    const id = r.name.split(':')[0];
    return !templeIds.has(id) && !excluded.has(id);
  });
  let worstPair = '', maxVol = 0, solidClash = '';
  for (let i = 0; i < infillBoxes.length; i++) {
    for (const r of placedRecs) {
      const v = overlapVol(infillBoxes[i], recAabb(r));
      if (v > maxVol) { maxVol = v; worstPair = `${infillSpec[i].id}×${r.name}`; }
    }
    for (let j = i + 1; j < infillBoxes.length; j++) {
      const v = overlapVol(infillBoxes[i], infillBoxes[j]);
      if (v > maxVol) { maxVol = v; worstPair = `${infillSpec[i].id}×${infillSpec[j].id}`; }
    }
    if (!solidClash) {
      const mlo = [infillBoxes[i][0][0] + OFF[0], infillBoxes[i][0][1], infillBoxes[i][0][2] + OFF[1]];
      const mhi = [infillBoxes[i][1][0] + OFF[0], infillBoxes[i][1][1], infillBoxes[i][1][2] + OFF[1]];
      for (const [solidId, poly] of solids) {
        if (polyOverlapsAabb(poly, mlo, mhi)) { solidClash = `${infillSpec[i].id}×${solidId}`; break; }
      }
    }
  }
  ok(`infill no AABB overlap with placed instances / each other (max ${maxVol.toFixed(4)} ${worstPair})`, maxVol <= 1e-6, worstPair);
  ok(`infill no overlap with layout solid footprints`, !solidClash, solidClash);
}
{
  // 南断带范围（源重算：158 的西缘 … 163 的东缘）内、北侧保留带（安仁街路口）内不得有补齐件
  const [elo158] = instAabb('westshop-shop-158', true);
  const [, whi163] = instAabb('westshop-shop-163', true);
  const southOK = infillDoc.southGap.placed.every(it => it.positionGlb[0] <= elo158[0] + 1 && it.positionGlb[0] >= whi163[0] - 1);
  const mouth = [-84.9 - 6.5, -84.9 + 6.5];   // 安仁街 v7 汇入点 ±6.5m（road-495101845 末端 (−31.38,12.28)map）
  // 路口保留带在安仁街一侧（北侧，路线左手 = 庙一侧）；wave5 F-07 起对街（南侧）允许补齐——T 字路口对面不是路口。
  // 侧别从源重算：件位置相对 v7 主路线最近段的叉积，与安仁街末端点同号 = 同侧。
  const v7ms = JSON.parse(fs.readFileSync(path.join(FB7, 'route.json'), 'utf8')).mainStreet.map(p => [p[0], p[2]]);
  const sideOf = (x, z) => {
    let best = null;
    for (let i = 1; i < v7ms.length; i++) {
      const [ax, az] = v7ms[i - 1], [bx, bz] = v7ms[i];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const d = Math.hypot(x - ax - t * vx, z - az - t * vz);
      if (!best || d < best[0]) best = [d, Math.sign(vx * (z - az) - vz * (x - ax))];
    }
    return best[1];
  };
  const anrenEnd = layout.objects.find(o => o.id === 'road-495101845').geometry.polyline;
  const anrenMid = anrenEnd[anrenEnd.length - 2];   // 末端前一点（在街北侧），末端点本身落在路中线上
  const anrenSide = sideOf(anrenMid[0] - OFF[0], anrenMid[1] - OFF[1]);
  const northOK = infillSpec.every(it => !(it.positionGlb[0] > mouth[0] && it.positionGlb[0] < mouth[1] && sideOf(it.positionGlb[0], it.positionGlb[2]) === anrenSide));
  ok(`infill within south gap x[${whi163[0].toFixed(1)},${elo158[0].toFixed(1)}] and 安仁街 mouth (${mouth[0]}..${mouth[1]}, 安仁街 side) kept clear`, southOK && northOK);
}

// ---------- 4) 街缝去重（决定 3）：应删记录不得出现在碰撞产物，街段记录必须在 ----------
{
  const fbCol = JSON.parse(fs.readFileSync(path.join(OUT, 'collision-fangbang.json'), 'utf8'));
  const have = new Set(fbCol.colliders.map(r => r.name));
  const pairs = [['N01-plain-v1', 'westshop-shop-154'], ['S01-corner', 'westshop-shop-153']];
  let shouldDrop = [], missingStreet = [];
  for (const [streetId, shopId] of pairs) {
    const streetRecs = colDoc.colliders.filter(r => r.name.split(':')[0] === streetId);
    if (!streetRecs.every(r => have.has('fangbang-' + r.name))) missingStreet.push(streetId);
    for (const r of colDoc.colliders.filter(r => r.name.split(':')[0] === shopId)) {
      const A = recAabb(r);
      if (streetRecs.some(sr => overlapVol(A, recAabb(sr)) > SEAM_CAP)) shouldDrop.push(r.name);
    }
  }
  ok(`street seam (street wins): ${shouldDrop.length} shop records dropped, none in product`,
    shouldDrop.every(n => !have.has('fangbang-' + n)) && Array.isArray(fbCol.streetSeamDedup) && fbCol.streetSeamDedup.length === shouldDrop.length,
    JSON.stringify(shouldDrop));
  ok('street seam street-side records present', missingStreet.length === 0, JSON.stringify(missingStreet));
}

// ---------- 5) 山门 10m 缝：fangbang × 庙轴（平移后）AABB 相交体积 ≤ 0.05 m³ ----------
const fbColDoc = JSON.parse(fs.readFileSync(path.join(OUT, 'collision-fangbang.json'), 'utf8'));
const near = bx => Math.hypot(bx.center[0] - SHANMEN[0], bx.center[2] - SHANMEN[1]) <= 10;
const toTempleMap = rec => {
  const w = obbToWorld(rec);
  return { center: [w.center[0] + OFF[0], w.center[1], w.center[2] + OFF[1]], halfExtents: w.halfExtents, yaw: w.yaw };
};
const fbNear = fbColDoc.colliders.map(r => obbToWorld(r)).filter(near);
const templeNear = colDoc.colliders.filter(r => templeIds.has(r.name.split(':')[0])).map(toTempleMap).filter(near);
ok(`seam colliders present (fangbang ${fbNear.length}, temple ${templeNear.length} within 10m)`, true);
let worstVol = 0, worstPair = '';
for (const a of fbNear) for (const b of templeNear) {
  const v = overlapVol(aabbOfBox(a), aabbOfBox(b));
  if (v > worstVol) { worstVol = v; worstPair = a.center.map(x => x.toFixed(1)).join(','); }
}
ok(`shanmen 10m seam overlap <= 0.05 m^3 (max ${worstVol.toFixed(4)})`, worstVol <= 0.05, worstPair);

// ---------- 6) 路线每 0.5 m 取样（胶囊 r0.35，身体 y 0.3-1.9）不落在任何 fangbang 碰撞盒内（含补齐件） ----------
const route = JSON.parse(fs.readFileSync(path.join(OUT, 'fangbang-route.json'), 'utf8'));
const samples = [];
const ms = route.mainStreet;
for (let i = 1; i < ms.length; i++) {
  const a = ms[i - 1], b = ms[i];
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(L / STEP));
  for (let k = 0; k < n; k++) samples.push([a[0] + (b[0] - a[0]) * k / n, a[2] + (b[2] - a[2]) * k / n]);
}
samples.push([ms[ms.length - 1][0], ms[ms.length - 1][2]]);
const boxes = fbColDoc.colliders.map(r => {
  const w = obbToWorld(r);
  return { ...w, ab: aabbOfBox(w) };
});
let hits = 0, hitAt = '';
for (const [x, z] of samples) {
  for (const bx of boxes) {
    if (x < bx.ab[0][0] - R || x > bx.ab[1][0] + R || z < bx.ab[0][2] - R || z > bx.ab[1][2] + R) continue;
    const c = Math.cos(bx.yaw), s = Math.sin(bx.yaw);
    const lx = c * (x - bx.center[0]) - s * (z - bx.center[2]);
    const lz = s * (x - bx.center[0]) + c * (z - bx.center[2]);
    if (Math.abs(lx) <= bx.halfExtents[0] + R && Math.abs(lz) <= bx.halfExtents[2] + R &&
        bx.center[1] - bx.halfExtents[1] - R < BODY[1] && bx.center[1] + bx.halfExtents[1] + R > BODY[0]) {
      hits++; hitAt = `${x.toFixed(1)},${z.toFixed(1)}`;
      break;
    }
  }
}
ok(`route capsule sweep clean (${samples.length} samples, ${hits} hits)`, hits === 0, hitAt);
ok('route junction at shanmen anchor (<=0.01m)', route.junction && route.junction.distanceToAnchorM <= 0.01, JSON.stringify(route.junction && route.junction.at));

// ---------- R1：去重 + 每模块一份网格 ----------
// 街段店屋按 instances 放；street-reviewed-lanes 里的店屋节点（Nxx-/Sxx-）不得再进分区。
// 「放置三角面」取各件 unique 之和：同一 mesh 被多个 node 引用只计一次，同模块不得拆进多件。
// 对照 v7 triangleAccounting：非庙轴 = fullScene − templeAxis，再加 lanesV2。补齐件复用已在库里的模块，不加第二份。
{
  let unique = 0, placed = 0;
  const laneShopNodes = [];
  const shareOk = [];
  for (const f of files) {
    const j = glbJson(f);
    const t = triangleCounts(j);
    unique += t.unique;
    placed += t.placed;
    for (const n of j.nodes || []) {
      if (n.mesh !== undefined && /^(N\d|S\d)/.test(n.name || '')) laneShopNodes.push(n.name);
    }
    const uses = new Map();
    for (const n of j.nodes || []) if (n.mesh !== undefined) uses.set(n.mesh, (uses.get(n.mesh) || 0) + 1);
    const multi = [...uses.values()].filter(c => c > 1).length;
    shareOk.push(multi);
  }
  const acct = JSON.parse(fs.readFileSync(path.join(FB7, 'review-manifest.json'), 'utf8')).triangleAccounting;
  const nonTemple = acct.fullSceneTris - acct.breakdown.templeAxisV2;
  // lanesV2 已含在模块库里（lane-a / lane-b-v2 / interfaces）。账目 note 把它加在 fullScene 之外，
  // 再加一遍会把这 16210 面算两次。补齐件复用 dry_goods_shop / curio-b，没有新网格。
  const lanesInLibrary = acct.lanesV2;
  const infillNewMeshes = 0;
  const ref = nonTemple + Math.max(0, acct.lanesV2 - lanesInLibrary) + infillNewMeshes;
  const rel = Math.abs(unique - ref) / ref;
  ok(`street-reviewed shop nodes absent (street-kit ground only, got ${laneShopNodes.length})`, laneShopNodes.length === 0, laneShopNodes.slice(0, 4).join(','));
  ok(`fangbang shared triangles ${unique} <= 260000 (instance-weighted ${placed})`, unique <= 260000);
  ok(`shared triangles within 5% of v7 non-temple+lanesV2(once)+infill ${ref} (rel ${rel.toFixed(3)}; books nonTemple ${nonTemple} + lanes ${acct.lanesV2})`, rel <= 0.05, `unique=${unique} ref=${ref}`);
  ok('fangbang parts loadPolicy on-demand', manifest.zones.filter(z => z.id === 'fangbang' && z.file).every(z => z.loadPolicy === 'on-demand'));
  const cmBytes = manifest.zones.filter(z => z.id === 'fangbang' && z.cm).reduce((s, z) => s + z.cm.bytes, 0);
  ok(`fangbang cm total ${(cmBytes / 1e6).toFixed(2)}MB <= 7MB`, cmBytes > 0 && cmBytes <= 7e6, String(cmBytes));
  console.log('R1 triangles', { unique, placed, ref, partsSharingMultiMesh: shareOk });
}

// ================= wave5-fangbangqa（Q2）新增：眼高普查 F-01 / F-03 / F-04 / F-05 / F-06 =================
// 全部对照源数据（v7 instances / collision sidecar / review-manifest、baseline/layout.json）或另一分区的产物，不拿产物和自己比。

// ---------- W1（F-03）封墙：挡住继续延伸的方浜中路的 *-seal-wall 不得放置 ----------
ok(`seal walls blocking a continuing 方浜中路 not placed (${JSON.stringify(sealBlocks)})`,
  sealWallIds.length >= 2 && Object.entries(sealBlocks).every(([id, blocks]) => !blocks || !v7Anchors.some(a => a.v7id === id)),
  v7Anchors.filter(a => sealBlocks[a.v7id]).map(a => a.id).join(','));

// ---------- W2（F-04）碰撞完整：每个已放置实例的源碰撞记录都在 collision-fangbang.json ----------
// 源 = v7 collision-world.json 的同名记录；collision-world 没有该实例时，取 review-manifest 模块路径同目录的 collision.json
// （east-edge / street-completion / lanes-v2 的 sidecar，v7 世界坐标，obb.pos = 实例位姿）。允许的缺口只有有记录的去重
// （seamDedup / streetSeamDedup）。位置 = 源 + (53.5,-17.4)，≤ 0.01 m。
{
  const fbColW = JSON.parse(fs.readFileSync(path.join(OUT, 'collision-fangbang.json'), 'utf8'));
  const have = new Map();   // 同一实例里记录名可重名（facade-post ×4），按名分组后逐条配对
  for (const r of fbColW.colliders) { if (!have.has(r.name)) have.set(r.name, []); have.get(r.name).push(r); }
  const dropped = new Set([...(Array.isArray(fbColW.seamDedup) ? fbColW.seamDedup : []), ...(Array.isArray(fbColW.streetSeamDedup) ? fbColW.streetSeamDedup : [])].map(d => d.dropped));
  const man = JSON.parse(fs.readFileSync(path.join(FB7, 'review-manifest.json'), 'utf8'));
  const modPath = new Map(man.modules.map(m => [m.id, path.join(REPO, m.path.replace(/^\.\//, ''))]));
  const missing = [], moved = [], noSource = [];
  let expectedN = 0;
  for (const a of v7Anchors) {
    let recs = perId.get(a.v7id) || [];
    if (!recs.length) {
      const mp = modPath.get(v7.get(a.v7id).module);
      const side = mp && path.join(path.dirname(mp), 'collision.json');
      if (side && fs.existsSync(side)) recs = (JSON.parse(fs.readFileSync(side, 'utf8')).colliders || []).filter(r => r.name.split(':')[0] === a.v7id);
    }
    if (!recs.length) { noSource.push(a.v7id); continue; }
    for (const r of recs) {
      const nm = 'fangbang-' + r.name;
      if (dropped.has(nm)) continue;
      expectedN++;
      const cands = have.get(nm);
      if (!cands || !cands.length) { missing.push(nm); continue; }
      const B = obbToWorld(r);
      const k = cands.findIndex(c => { const A = obbToWorld(c); return Math.hypot(A.center[0] - (B.center[0] + OFF[0]), A.center[2] - (B.center[2] + OFF[1])) <= 0.01 && Math.abs(A.center[1] - B.center[1]) <= 0.01; });
      if (k < 0) moved.push(nm); else cands.splice(k, 1);
    }
  }
  ok(`every placed instance's source colliders present (${expectedN} expected, ${missing.length} missing; no-source ${noSource.join(',')})`,
    missing.length === 0, missing.slice(0, 6).join(', '));
  ok(`sidecar/v7 colliders translated by map offset (<=0.01 m, ${moved.length} off)`, moved.length === 0, moved.slice(0, 4).join(', '));
  // 无源碰撞的只允许是纯地面件（路面 / 街地面），不许是建筑
  ok(`instances without any collision source are ground-only (${noSource.join(',')})`,
    noSource.every(id => /surface$/.test(v7.get(id).module)));
}

// ---------- W3（F-05 / F-06）路面叠放：沿方浜主路线，fangbang 路面在顶，外围路面不得压在上面 ----------
// 路线每 0.5 m（到山门接点，山门 12 m 内归庙区不查），中线与 ±2.5 m 各一点竖直探测：
//   a) 中线点下必须有 fangbang 路面（街地面 street-kit / 路面 sctail / 围界 westbounds 网格）；
//   b) 外围 zone-outer.glb 的 road 网格顶面不得高于该点 fangbang 路面顶面 − 0.005 m（盖住或 z-fighting）。
{
  const FB_GROUND_RE = /^(street-kit__(quiet-gray-asphalt|paving-frontage|worn-stone)|sctail__(quiet-gray-asphalt|worn-stone)|westbounds__worn-stone)/;
  const CELL = 4;
  const binTris = (meshes, pick) => {
    const grid = new Map();
    for (const m of meshes) {
      if (!pick(m.name || '')) continue;
      const P = m.positions, I = m.indices;
      const wp = i => transformPoint(m.matrix, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      for (let t = 0; t < I.length; t += 3) {
        const a = wp(I[t]), b = wp(I[t + 1]), c = wp(I[t + 2]);
        const tri = [a, b, c];
        const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0], c[0]) / CELL);
        const z0 = Math.floor(Math.min(a[2], b[2], c[2]) / CELL), z1 = Math.floor(Math.max(a[2], b[2], c[2]) / CELL);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const k = gx + ',' + gz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(tri);
        }
      }
    }
    return grid;
  };
  const topAt = (grid, x, z) => {
    let best = null;
    for (const [a, b, c] of grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || []) {
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (y < -0.6 || y > 0.6) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  };
  const fbMeshes = files.flatMap(f => readGlb(fs.readFileSync(f)).meshes);
  const fbGrid = binTris(fbMeshes, n => FB_GROUND_RE.test(n));
  const outerFile = path.join(OUT, 'zone-outer.glb');
  const outerGrid = fs.existsSync(outerFile) ? binTris(readGlb(fs.readFileSync(outerFile)).meshes, n => /^outer\|road-/.test(n)) : new Map();
  const rj = route.junction.pointIndex;
  const line = ms.slice(0, rj + 1);
  let n = 0, noGround = 0, covered = 0, firstNoGround = '', firstCovered = '';
  const coveredBy = {};
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (L < 1e-6) continue;
    const t = [(b[0] - a[0]) / L, (b[2] - a[2]) / L], nv = [-t[1], t[0]];
    const k = Math.max(1, Math.ceil(L / 0.5));
    for (let j = 0; j < k; j++) {
      const cx = a[0] + (b[0] - a[0]) * j / k, cz = a[2] + (b[2] - a[2]) * j / k;
      if (Math.hypot(cx - SHANMEN[0], cz - SHANMEN[1]) <= 12) continue;
      for (const off of [0, -2.5, 2.5]) {
        const x = cx + nv[0] * off, z = cz + nv[1] * off;
        const fy = topAt(fbGrid, x, z);
        n++;
        if (fy === null) {
          if (off === 0) { noGround++; if (!firstNoGround) firstNoGround = `${x.toFixed(1)},${z.toFixed(1)}`; }
          continue;
        }
        const oy = topAt(outerGrid, x, z);
        if (oy !== null && oy > fy - 0.005) {
          covered++;
          if (!firstCovered) firstCovered = `${x.toFixed(1)},${z.toFixed(1)} outer ${oy.toFixed(3)} >= fb ${fy.toFixed(3)}`;
        }
      }
    }
  }
  ok(`fangbang ground under every route centerline sample (${noGround} of ${n} samples without; first ${firstNoGround || '-'})`, noGround === 0);
  ok(`no outer road surface on/above fangbang ground along the route (${covered} covered samples; first ${firstCovered || '-'})`, covered === 0);
}

// ---------- W4（F-01）外围占位店让位：同一提案点的外围 shoprow 在方浜分区加载后隐藏 ----------
// 源重算：baseline/layout.json 的 shopAnchor「shoprow-p<N>」（提案点 shop-<N>）与已放置的 v7「westshop-shop-<N>」是同一提案点的
// 两个版本；后者放置了 → 前者必须列入 OUT_DIR/fangbang-supersede.json（web/main.js 在方浜分区加载后隐藏）。
// 反向：列表里不许有 fangbang 没有对应件的外围件（山门前 p167 等不是本分区能决定的）。
{
  const supFile = path.join(OUT, 'fangbang-supersede.json');
  const sup = fs.existsSync(supFile) ? JSON.parse(fs.readFileSync(supFile, 'utf8')) : null;
  const placedV7 = new Set(v7Anchors.map(a => a.v7id));
  const expected = layout.objects.filter(o => o.kind === 'shopAnchor' && /^shoprow-p\d+$/.test(o.id))
    .filter(o => placedV7.has('westshop-shop-' + o.id.slice('shoprow-p'.length)))
    .map(o => o.id).sort();
  const got = sup ? (sup.supersedes || []).map(e => e.outer).sort() : null;
  ok(`fangbang-supersede.json lists exactly the outer shoprows realised by placed westshops (${expected.length}: ${expected.join(',')})`,
    !!sup && JSON.stringify(got) === JSON.stringify(expected), sup ? JSON.stringify(got) : 'missing file');
  ok('supersede entries name their fangbang counterpart', !!sup && (sup.supersedes || []).every(e => e.fangbang === 'fangbang-westshop-shop-' + e.outer.slice('shoprow-p'.length) && placedV7.has(e.fangbang.slice('fangbang-'.length))));
  // 浏览器侧（给 FANGBANG_BASE 时跑）：核心三区加载后外围件可见；点「方浜中路」加载后被让位件全部不可见，其余 shoprow 仍可见
  if (process.env.FANGBANG_BASE && sup) {
    const { createRequire } = await import('node:module');
    const req = createRequire('/home/baibai/pawborough-world/node_modules/');
    const { chromium } = req('playwright');
    const browser = await chromium.launch({ executablePath: '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome', args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    await page.goto(process.env.FANGBANG_BASE + '?zone=core', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true && (window.__zonesLoaded || []).includes('outer'), null, { timeout: 900000 });
    const vis = (ids) => page.evaluate((ids) => {
      const out = {};
      window.__scene.traverse(o => {
        const id = o.userData && o.userData.id;
        if (!ids.includes(id)) return;
        let v = true; for (let n = o; n; n = n.parent) if (n.visible === false) v = false;
        out[id] = (out[id] === undefined ? v : out[id] || v);
      });
      return out;
    }, ids);
    const supIds = got;
    const others = layout.objects.filter(o => o.kind === 'shopAnchor' && /^shoprow-p\d+$/.test(o.id) && !supIds.includes(o.id)).map(o => o.id);
    const before = await vis(supIds);
    await page.click('[data-zone="fangbang"]');
    await page.waitForFunction(() => (window.__zonesLoaded || []).filter(z => z.startsWith('fangbang')).length >= 2 && window.__fangbangSuperseded !== undefined, null, { timeout: 900000 });
    const after = await vis(supIds), afterOthers = await vis(others);
    await browser.close();
    ok(`browser: superseded shoprows visible before fangbang loads (${Object.values(before).filter(Boolean).length}/${supIds.length})`, supIds.every(id => before[id] === true));
    ok(`browser: superseded shoprows hidden after fangbang loads (${Object.values(after).filter(v => !v).length}/${supIds.length})`, supIds.every(id => after[id] === false));
    ok(`browser: other shoprows untouched (${Object.values(afterOthers).filter(Boolean).length}/${others.length} visible)`, others.every(id => afterOthers[id] === true));
  }
}

// ---------- W5（F-08 已知例外 + 庙墙净空）：fangbang 网格不得越过庙区院墙 ----------
// 源：baseline/layout.json temple-wall 段 + 厚度、temple 分区多边形（判庙内侧）。fangbang 网格（原始分区 GLB，按锚分组）
// 离墙中线 3 m 内、在段投影范围内、高 ≥ 0.05 m 的三角形顶点（任何高度：墙头以上的楼层 / 檐口越墙从庙内同样看得见），
// 越过墙中线朝庙内的距离 = 越墙深度。除已知例外外，任何件都不得碰到墙体（深度 > −厚度/2）。
// 已知例外（主控 2026-09-26 F-08 选项 3 接受）：westshop-shop-165 东后角的二层与屋檐越过院墙（墙高以内只贴到墙面），
// 只在庙内可见；上限 1.1 m 防扩大。
const KNOWN_WALL_EXCEPTIONS = { 'fangbang-westshop-shop-165': { maxDepthM: 1.1, decision: 'lead 2026-09-26 F-08 option 3: accepted, only visible from inside the temple' } };
{
  const wall = layout.objects.find(o => o.id === 'temple-wall');
  const half = (wall.thickness || 0.4) / 2;
  const tz = layout.zones.temple.polygon;
  const inPoly = (pt, poly) => { let c = false; for (let i = 0, n = poly.length; i < n; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n]; if ((z1 > pt[1]) !== (z2 > pt[1]) && pt[0] < (x2 - x1) * (pt[1] - z1) / (z2 - z1) + x1) c = !c; } return c; };
  const segs = wall.geometry.segments.map(([a, b]) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let n = [-u[1], u[0]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!inPoly([mid[0] + n[0] * 0.5, mid[1] + n[1] * 0.5], tz)) n = [-n[0], -n[1]];   // n 指向庙内
    return { a, u, n, L };
  });
  const depthBy = new Map();
  for (const f of files) {
    const g = readGlb(fs.readFileSync(f));
    const J = g.gltf, anc = [];
    const walk = (ni, id) => {
      const nd = J.nodes[ni];
      const my = (nd.extras && typeof nd.extras.id === 'string' && nd.extras.id.startsWith('fangbang-')) ? nd.extras.id : id;
      for (const ci of nd.children ?? []) walk(ci, my);
      if (nd.mesh !== undefined) for (const _ of J.meshes[nd.mesh].primitives) anc.push(my);   // 与 readGlb 的遍历次序一致
    };
    for (const r of J.scenes[J.scene ?? 0].nodes) walk(r, null);
    g.meshes.forEach((m, k) => {
      const id = anc[k];
      if (!id) return;
      const P = m.positions, I = m.indices;
      const W = [];
      for (let i = 0; i < P.length; i += 3) W.push(transformPoint(m.matrix, [P[i], P[i + 1], P[i + 2]]));
      // 按三角形取（大面片只有角点，不能按顶点高度筛）：最高点 ≥ 0.05 m 的三角形，其顶点平面位置参与
      const use = new Set();
      for (let t = 0; t < I.length; t += 3) {
        const ys = [W[I[t]][1], W[I[t + 1]][1], W[I[t + 2]][1]];
        if (Math.max(...ys) >= 0.05) { use.add(I[t]); use.add(I[t + 1]); use.add(I[t + 2]); }
      }
      for (const vi of use) {
        const w = W[vi];
        for (const sg of segs) {
          const dx = w[0] - sg.a[0], dz = w[2] - sg.a[1];
          const t = dx * sg.u[0] + dz * sg.u[1];
          if (t < 0 || t > sg.L) continue;
          const d = dx * sg.n[0] + dz * sg.n[1];
          if (d < -3 || d > 3) continue;
          if (!depthBy.has(id) || d > depthBy.get(id)) depthBy.set(id, d);
        }
      }
    });
  }
  const offenders = [...depthBy].filter(([id, d]) => d > -half && !KNOWN_WALL_EXCEPTIONS[id]).map(([id, d]) => `${id} ${d.toFixed(2)}`);
  ok(`no fangbang mesh reaches the temple wall except known exceptions (${offenders.length} offenders)`, offenders.length === 0, offenders.join(', '));
  for (const [id, ex] of Object.entries(KNOWN_WALL_EXCEPTIONS)) {
    const d = depthBy.get(id);
    ok(`known exception ${id}: through temple wall ${d?.toFixed(2)} m <= ${ex.maxDepthM} m (${ex.decision})`, d !== undefined && d <= ex.maxDepthM);
  }
}

// ---------- W6（F-07）临街面补齐：主控 2026-09-26 选项 1，按 wave1 决定 2 的规则逐条从源重算 ----------
// 取样口径：donor 底层碰撞记录（底 ≤ 1 m）按补齐位姿重放的矩形，内部与边上每 0.2 m 取点。
{
  ok(`frontage gap infill placed (${gapSpec.length})`, gapSpec.length >= 1);
  const man6 = JSON.parse(fs.readFileSync(path.join(FB7, 'review-manifest.json'), 'utf8'));
  const modPath6 = new Map(man6.modules.map(m => [m.id, path.join(REPO, m.path.replace(/^\.\//, ''))]));
  const isBase = r => r.obb && r.obb.center[1] - r.obb.size[1] / 2 <= 1.0;
  const rectAt = (r, px, pz, rot) => {
    const c = Math.cos(rot), sn = Math.sin(rot), o = r.obb, hx = o.size[0] / 2, hz = o.size[2] / 2;
    return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => {
      const lx = o.center[0] + a, lz = o.center[2] + b;
      return [px + c * lx + sn * lz, pz - sn * lx + c * lz];
    });
  };
  const samples = (rect) => {   // 矩形内网格 + 边 0.2 m
    const out = [];
    const [p0, p1, , p3] = rect;
    const ux = [p1[0] - p0[0], p1[1] - p0[1]], uz = [p3[0] - p0[0], p3[1] - p0[1]];
    const nx = Math.max(1, Math.ceil(Math.hypot(...ux) / 0.2)), nz = Math.max(1, Math.ceil(Math.hypot(...uz) / 0.2));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) out.push([p0[0] + ux[0] * i / nx + uz[0] * j / nz, p0[1] + ux[1] * i / nx + uz[1] * j / nz]);
    return out;
  };
  const inPoly6 = (pt, poly) => { let c = false; for (let i = 0, n = poly.length; i < n; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n]; if ((z1 > pt[1]) !== (z2 > pt[1]) && pt[0] < (x2 - x1) * (pt[1] - z1) / (z2 - z1) + x1) c = !c; } return c; };
  const inTri = (p, [a, b, c]) => {
    const d = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const d1 = d(p, a, b), d2 = d(p, b, c), d3 = d(p, c, a);
    return !(((d1 < -1e-9) || (d2 < -1e-9) || (d3 < -1e-9)) && ((d1 > 1e-9) || (d2 > 1e-9) || (d3 > 1e-9)));
  };
  // 路面：fangbang 沥青三角形（源 GLB，v7 坐标 -> 地图）
  const asphaltSrc = [[path.join(FB7, 'street-reviewed-lanes.glb'), /^street-kit__quiet-gray-asphalt/],
    [modPath6.get('westext-surface'), /^sctail__quiet-gray-asphalt/], [modPath6.get('eastext-surface'), /^sctail__quiet-gray-asphalt/],
    [path.join(REPO, man6.streetCompletion.eastTailSurface.path.replace(/^\.\//, '')), /^sctail__quiet-gray-asphalt/]];
  const tris = [];
  for (const [f, re] of asphaltSrc) {
    for (const m of readGlb(fs.readFileSync(f)).meshes) {
      if (!re.test(m.name)) continue;
      const W = []; for (let i = 0; i < m.positions.length; i += 3) { const w = transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]); W.push([w[0] + OFF[0], w[2] + OFF[1]]); }
      for (let t = 0; t < m.indices.length; t += 3) tris.push([W[m.indices[t]], W[m.indices[t + 1]], W[m.indices[t + 2]]]);
    }
  }
  const triBox = tris.map(t => [Math.min(...t.map(p => p[0])), Math.min(...t.map(p => p[1])), Math.max(...t.map(p => p[0])), Math.max(...t.map(p => p[1]))]);
  // 路线（地图）：主路线到山门接点 + 支弄出入线
  const rt = JSON.parse(fs.readFileSync(path.join(FB7, 'route.json'), 'utf8'));
  const toMap = p => [p[0] + OFF[0], p[2] + OFF[1]];
  const main = route.mainStreet.slice(0, route.junction.pointIndex + 1).map(p => [p[0], p[2]]);
  const walkLines = [main, rt.laneAExcursion.map(toMap), rt.laneBExcursion.map(toMap)];
  const dSeg = (p, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2)); return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vz); };
  const dLine = (p, l) => { let d = Infinity; for (let i = 1; i < l.length; i++) d = Math.min(d, dSeg(p, l[i - 1], l[i])); return d; };
  // 全域：前广场（layout）、仍可见的外围店屋、非方浜道路（平头路面带 + 3.0 m）
  const fc = layout.shanmenForecourt ? layout.shanmenForecourt.polygon : null;
  const placedV7Ids = new Set(v7Anchors.map(a => a.v7id));
  const linst = new Map(layout.instances.map(i => [i.id, i]));
  const outerPolys = [];
  for (const o of layout.objects.filter(o => o.kind === 'shopAnchor' && o.zone === 'outer')) {
    const m = /^shoprow-p(\d+)$/.exec(o.id);
    if (m && placedV7Ids.has('westshop-shop-' + m[1])) continue;
    const li = linst.get(o.id), mf = li && path.join(AREA, 'resources', 'shops', li.module, 'measurements.json');
    if (!mf || !fs.existsSync(mf)) continue;
    const dsg = JSON.parse(fs.readFileSync(mf, 'utf8')).design;
    const c = Math.cos(o.geometry.rotY), sn = Math.sin(o.geometry.rotY), [x, z] = o.geometry.position;
    outerPolys.push([o.id, [[-dsg.frontageM / 2, 0], [dsg.frontageM / 2, 0], [dsg.frontageM / 2, -dsg.depthM], [-dsg.frontageM / 2, -dsg.depthM]].map(([a, b]) => [x + c * a + sn * b, z - sn * a + c * b])]);
  }
  const sideRoads = layout.objects.filter(o => o.kind === 'road' && o.name !== '方浜中路' && o.geometry && o.geometry.polyline);
  const flatD = (p, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], L = Math.hypot(vx, vz) || 1; const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L; if (t < 0 || t > L) return Infinity; return Math.abs(((p[0] - a[0]) * vz - (p[1] - a[1]) * vx) / L); };
  // 邻居：源碰撞（v7 world 非庙轴非剔除 + sidecar）+ 其它补齐件 donor 克隆，全高记录 AABB
  const srcRecs = [];
  for (const a of v7Anchors) {
    let recs = perId.get(a.v7id) || [];
    if (!recs.length) {
      const mp = modPath6.get(v7.get(a.v7id).module), side = mp && path.join(path.dirname(mp), 'collision.json');
      if (side && fs.existsSync(side)) recs = (JSON.parse(fs.readFileSync(side, 'utf8')).colliders || []).filter(r => r.name.split(':')[0] === a.v7id);
    }
    for (const r of recs) srcRecs.push([a.v7id, aabbOfBox(obbToWorld(r)).map(v => [v[0] + OFF[0], v[1], v[2] + OFF[1]])]);
  }
  for (const it of infillSpec) for (const r of perId.get(it.donor) || []) {
    const rr = rectAt(r, it.positionMap[0], it.positionMap[2], it.rotY);
    srcRecs.push([it.id, [[Math.min(...rr.map(p => p[0])), 0, Math.min(...rr.map(p => p[1]))], [Math.max(...rr.map(p => p[0])), 9, Math.max(...rr.map(p => p[1]))]]]);
  }
  const bad = { frontage: [], facing: [], asphalt: [], walk: [], forecourt: [], outer: [], mouth: [], neighbour: [] };
  for (const it of gapSpec) {
    const recs = perId.get(it.donor) || [];
    const base = recs.filter(isBase);
    const lo = Math.min(...base.map(r => r.obb.center[0] - r.obb.size[0] / 2)), hi = Math.max(...base.map(r => r.obb.center[0] + r.obb.size[0] / 2));
    if (!(hi - lo >= 5 && hi - lo <= 7)) bad.frontage.push(`${it.id} ${(hi - lo).toFixed(2)}`);
    // 门脸朝街：门脸方向与「门面中点 -> 主路线最近点」夹角 ≤ 30°
    const px = it.positionMap[0], pz = it.positionMap[2], f = [Math.sin(it.rotY), Math.cos(it.rotY)];
    let q = null, qd = Infinity;
    for (let i = 1; i < main.length; i++) { const a = main[i - 1], b = main[i]; const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / l2)); const c = [a[0] + t * vx, a[1] + t * vz]; const d = Math.hypot(px - c[0], pz - c[1]); if (d < qd) { qd = d; q = c; } }
    const ang = Math.acos(Math.max(-1, Math.min(1, (f[0] * (q[0] - px) + f[1] * (q[1] - pz)) / (qd || 1)))) * 180 / Math.PI;
    if (ang > 30) bad.facing.push(`${it.id} ${ang.toFixed(1)}°`);
    const baseRects = base.map(r => rectAt(r, px, pz, it.rotY));
    const allRects = recs.map(r => rectAt(r, px, pz, it.rotY));
    for (const rc of baseRects) for (const sp of samples(rc)) {
      if (tris.some((t, k) => sp[0] >= triBox[k][0] && sp[0] <= triBox[k][2] && sp[1] >= triBox[k][1] && sp[1] <= triBox[k][3] && inTri(sp, t))) { bad.asphalt.push(it.id); break; }
    }
    for (const rc of baseRects) if (samples(rc).some(sp => walkLines.some(l => dLine(sp, l) < 2.0))) { bad.walk.push(it.id); break; }
    for (const rc of allRects) {
      const sp = samples(rc);
      if (fc && (sp.some(p => inPoly6(p, fc)) || fc.some(p => inPoly6(p, rc)))) bad.forecourt.push(it.id);
      for (const [oid, poly] of outerPolys) if (sp.some(p => inPoly6(p, poly)) || poly.some(p => inPoly6(p, rc))) bad.outer.push(`${it.id}×${oid}`);
      for (const r of sideRoads) { const pl = r.geometry.polyline, w = r.geometry.width || 6; if (sp.some(p => pl.some((a, i) => i > 0 && flatD(p, pl[i - 1], a) < w / 2 + 3.0 - 0.05))) bad.mouth.push(`${it.id}×${r.id}`); }
      const bb = [[Math.min(...rc.map(p => p[0])), 0, Math.min(...rc.map(p => p[1]))], [Math.max(...rc.map(p => p[0])), 9, Math.max(...rc.map(p => p[1]))]];
      for (const [oid, box] of srcRecs) if (oid !== it.id && bb[0][0] < box[1][0] && box[0][0] < bb[1][0] && bb[0][2] < box[1][2] && box[0][2] < bb[1][2]) bad.neighbour.push(`${it.id}×${oid}`);
    }
  }
  ok(`gap infill frontage 5-7 m (donor base records) ${gapSpec.length ? 'ok' : ''}`, bad.frontage.length === 0, bad.frontage.join(','));
  ok('gap infill faces the street (<= 30° to nearest route point)', bad.facing.length === 0, bad.facing.join(','));
  ok('gap infill base clear of fangbang asphalt (source GLB triangles, 0.2 m samples)', bad.asphalt.length === 0, [...new Set(bad.asphalt)].join(','));
  ok('gap infill base >= 2.0 m from main route and lane excursion lines', bad.walk.length === 0, bad.walk.join(','));
  ok('gap infill clear of the shanmen forecourt (layout)', bad.forecourt.length === 0, [...new Set(bad.forecourt)].join(','));
  ok('gap infill clear of visible outer shops', bad.outer.length === 0, [...new Set(bad.outer)].join(','));
  ok('gap infill keeps side-road mouths open (flat-capped road width/2 + 3.0 m)', bad.mouth.length === 0, [...new Set(bad.mouth)].join(','));
  ok('gap infill no AABB overlap with any source collider or other infill (full height)', bad.neighbour.length === 0, [...new Set(bad.neighbour)].slice(0, 6).join(','));
  // 临街覆盖率（报告，不设门槛）：collision-fangbang 1.6 m 高 OBB，每 2 m 两侧 12 m 水平射线
  const fbc = JSON.parse(fs.readFileSync(path.join(OUT, 'collision-fangbang.json'), 'utf8')).colliders.map(r => obbToWorld(r)).filter(w => Math.abs(1.6 - w.center[1]) < w.halfExtents[1] && w.halfExtents[1] * 2 >= 1.2);
  const rayHit = (o, d) => fbc.some(w => { const c = Math.cos(w.yaw), sn = Math.sin(w.yaw); for (let t = 0; t <= 12; t += 0.1) { const x = o[0] + d[0] * t - w.center[0], z = o[1] + d[1] * t - w.center[2]; if (Math.abs(c * x - sn * z) <= w.halfExtents[0] && Math.abs(sn * x + c * z) <= w.halfExtents[2]) return true; } return false; });
  const cov = { L: [0, 0], R: [0, 0] };
  let acc = 0;
  for (let i = 1; i < main.length; i++) {
    const a = main[i - 1], b = main[i], Ls = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (Ls < 1e-6) continue;
    const t = [(b[0] - a[0]) / Ls, (b[1] - a[1]) / Ls];
    for (let u = (2 - acc % 2) % 2; u < Ls; u += 2) {
      const o = [a[0] + t[0] * u, a[1] + t[1] * u];
      for (const [k, n] of [['L', [t[1], -t[0]]], ['R', [-t[1], t[0]]]]) { cov[k][1]++; if (rayHit(o, n)) cov[k][0]++; }
    }
    acc += Ls;
  }
  console.log(`frontage coverage (collision OBB @1.6 m, 12 m rays every 2 m): L ${(cov.L[0] / cov.L[1] * 100).toFixed(1)}% R ${(cov.R[0] / cov.R[1] * 100).toFixed(1)}%`);
}

console.log(`fangbang-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
