// WP4.1 全域候选碰撞世界导出：每个分区一个 collision-<zone>.json（格式冻结于
// docs/AREA-COLLISION-FORMAT.md，记录形式与 src/world/collisionAdapter.js 形式 (a) 一致）。
// 位置一律从 baseline/layout.json 重算；套件件用各自模块的局部碰撞记录 + layout 派生位姿。
// wave1-walkr1 K1 起新增园林套件碰撞：园廊 3 条 + 复廊 + 听涛阁水廊（GLB 实际几何确认的柱/栏/中墙）、
// 豫园门楼（GLB 墙体两面 Pier，门洞留 ≥2.2 m 通道）、garden 46 棵树干、bazaar 摊位/长凳包围盒。
// 由 scripts/rebuild-review.sh 在分区导出与 connectivity/route 产物之后调用；WALK_COLLISION=0 跳过。
// 用法：OUT_DIR=out-zone node scripts/export-collision.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';
import { readGlb } from '../../../src/world/glbReader.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out');

const layoutBuf = fs.readFileSync(path.join(AREA, 'baseline', 'layout.json'));
const layoutSha = crypto.createHash('sha256').update(layoutBuf).digest('hex');
const layout = JSON.parse(layoutBuf.toString('utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const gardenKitCollision = JSON.parse(fs.readFileSync(path.join(OUT, 'garden-kit-collision.json'), 'utf8'));
const rockeryCollision = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'rockery', 'collision.json'), 'utf8'));
const sansuitangLocal = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'sansuitang', 'collision.json'), 'utf8'));
const templeV3 = JSON.parse(fs.readFileSync(path.join(AREA, 'resources', 'temple-v3', 'collision-world.json'), 'utf8'));
const sansuitangWorld = JSON.parse(fs.readFileSync(path.join(OUT, 'sansuitang-collision-world.json'), 'utf8'));
// HALL_KIT=1（默认关）：厅堂套件样板仰山堂走模块碰撞记录（与 assemble 的世界记录互核）
const HALL_KIT = process.env.HALL_KIT === '1';
const HALLKIT_ID = 'bld-428179902';
const hallkitLocal = HALL_KIT ? JSON.parse(fs.readFileSync(path.join(AREA, 'out-garden-kits', 'hallkit-' + HALLKIT_ID, 'collision.json'), 'utf8')) : null;
const hallkitWorld = HALL_KIT ? JSON.parse(fs.readFileSync(path.join(OUT, 'hallkit-collision-world.json'), 'utf8')) : null;

const AXIS = 'glTF Y-up; X east, Z south; heights from ground y=0';
const EDGE_THICK = 0.3, EDGE_H_DEFAULT = 6;   // 建筑 footprint 薄墙（冻结格式）
const WALL_THICK = 0.45;                       // garden-wall / temple-wall 墙厚（garden-kit 记录）
const GUARD_H = 1.2, GUARD_THICK = 0.2;        // 水面隐形挡墙（冻结格式）
const ROUTE_CLEAR = 0.55;                      // 胶囊 0.35 + 半墙厚 0.15 + 余量：路线旁的「街口边」不留墙
const PAVILIONS = ['bld-428179924', 'bld-428186467', 'bld-428196085', 'bld-428196091', 'bld-428196098'];
const SANSUITANG_ID = 'bld-428179901';
const ZONES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];

// 庙区记录名前缀 -> 布局实例 id（layout.instances / templeAnchor，2026-09-23 核对：
// resources/temple-v3/collision-world.json 的记录名前缀与 layout 实例 id 对应如下，
// entrycourt 实例的记录名前缀是 court —— 见 artifacts/walk/RESULT.json templeMapping 记录）
const TEMPLE_INSTANCE_OF_RECORD = {
  shanmen: 'temple-shanmen', court: 'temple-entrycourt', yimen: 'temple-yimen', yimenstage: 'temple-yimenstage',
  dadiancourt: 'temple-dadiancourt', 'peidian-w': 'temple-peidian-w', 'peidian-e': 'temple-peidian-e',
  'gallery-w': 'temple-gallery-w', 'gallery-e': 'temple-gallery-e', dadian: 'temple-dadian',
  court3: 'temple-court3', houdian: 'temple-houdian',
  'tree-court2-w': 'temple-tree-court2-w', 'tree-court2-e': 'temple-tree-court2-e',
  'tree-court3-w': 'temple-tree-court3-w', 'tree-court3-e': 'temple-tree-court3-e',
}; // 记录名 -> layout.instances.id（实例 id 与 templeAnchor id 相同，且已带 temple- 前缀）

const stats = { zones: {}, skippedStreetMouths: [], openings: [], modulesRecomputed: {} };
const zones = Object.fromEntries(ZONES.map(z => [z, { colliders: [], openings: [] }]));

// ---------- 基础工具 ----------
function ring(pts) { return (pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) ? pts.slice(0, -1) : pts; }
function segPointDist2D(ax, az, bx, bz, px, pz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
// 路线折线到线段的最小距离（0.5 m 密采样，与契约测试同一粒度）
function routeDistToSeg(a, b) {
  let m = Infinity;
  for (const r of routes) {
    const pts = r.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const k = Math.max(1, Math.ceil(L / 0.5));
      for (let j = 0; j <= k; j++) {
        const t = j / k;
        m = Math.min(m, segPointDist2D(a[0], a[1], b[0], b[1], p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])));
      }
    }
  }
  return m;
}
// 桥/廊折线到线段是否穿过（线段相交）
function segsCross(a, b, c, d) {
  const cr = (o, u, v) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
// obbToWorld 形式 (a)：pos = 模块原点（世界），theta = 模块偏航，center = 模块局部中心，size = 全尺寸
function add(zone, name, module, theta, pos, center, size) {
  const rec = { name, module, type: 'box', obb: { pos, theta, center, size } };
  const w = obbToWorld(rec); // 导出前自检：每条记录都必须能被生产变换转换
  if (!w.halfExtents.every(v => Number.isFinite(v) && v > 0) || !w.center.every(Number.isFinite) || !Number.isFinite(w.yaw))
    throw new Error(`bad collider ${name}: ${JSON.stringify(w)}`);
  zones[zone].colliders.push(rec);
}
// 薄墙：模块原点放在墙中点，本地 +Z 对齐线段方向（theta = 段向偏航），center 为局部原点
function edgeWall(zone, name, module, a, b, height, thick) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (!(L > 0.01)) return;
  const yaw = Math.atan2(dx, dz);
  add(zone, name, module, yaw, [+( (a[0] + b[0]) / 2 ).toFixed(4), 0, +((a[1] + b[1]) / 2).toFixed(4)],
    [0, height / 2, 0], [thick, height, +L.toFixed(4)]);
}
function ringEdges(fp) { const f = ring(fp); return f.map((p, i) => [p, f[(i + 1) % f.length]]); }
const unit2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const leftNormal = (u) => [u[1], -u[0]];                       // 地图系左法线（东行 -> 北）
const dedupeClosed = (pts) => (pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts);

// GLB 顶点（世界系；readGlb 已烘焙节点变换）。site 模块 GLB 即地图 (x, 高, z)。
const glbVertCache = {};
function glbVerts(relFile, namePrefix) {
  const key = `${relFile}::${namePrefix ?? '*'}`;
  if (!glbVertCache[key]) {
    const { meshes } = readGlb(fs.readFileSync(path.join(AREA, relFile)));
    glbVertCache[key] = meshes.flatMap(m => {
      if (namePrefix && !(m.name ?? '').startsWith(namePrefix)) return [];
      const out = [];
      for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      return out;
    });
  }
  return glbVertCache[key];
}
// 柱在 GLB 实际几何中的确认：±0.12 m 内、y 0.1–2.6 有顶点（与 corridor-kit 自测「柱位在场」同判据）
function pillarInGlb(relFile, x, z) {
  return glbVerts(relFile).some(v => Math.hypot(v[0] - x, v[2] - z) < 0.12 && v[1] > 0.1 && v[1] < 2.6);
}

// ---------- 1) 建筑类 footprint 薄墙（亭/三穗堂走套件记录，不在此列） ----------
const PAV = new Set(PAVILIONS);
for (const o of layout.objects) {
  if (!ZONES.includes(o.zone)) continue;
  const g = o.geometry || {};
  const isBuilding = ['hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock'].includes(o.kind)
    || (o.kind === 'outerBuilding' && o.zone === 'bazaar');
  if (!isBuilding || !g.footprint || o.id === SANSUITANG_ID || (HALL_KIT && o.id === HALLKIT_ID) || PAV.has(o.id)) continue;
  const h = o.height || EDGE_H_DEFAULT;
  ringEdges(g.footprint).forEach(([a, b], i) => {
    // 非凸老街块（旧校场路沿线）的「街口边」：路线中心线 0.55 m 内的是街口，真实墙在店前不含这条边
    if (routeDistToSeg(a, b) < ROUTE_CLEAR) {
      zones[o.zone].openings.push({ name: `${o.id}:edge-${i}`, reason: 'street mouth on commercial route' });
      stats.skippedStreetMouths.push({ object: o.id, zone: o.zone, edge: i });
      return;
    }
    edgeWall(o.zone, `${o.id}:edge-${i}`, 'footprint', a, b, h, EDGE_THICK);
  });
}

// ---------- 2) 园墙 / 庙墙：layout 段重算（高/厚取 garden-kit 记录值） ----------
const WALL_HEIGHT = { 'garden-wall': 2.9, 'temple-wall': 2.6 };
for (const o of layout.objects) {
  if (o.kind !== 'wall' || !Array.isArray((o.geometry || {}).segments)) continue;
  const h = WALL_HEIGHT[o.id] ?? 2.9;
  o.geometry.segments.forEach((s, i) => edgeWall(o.zone, `${o.id}:seg-${i}`, 'wall-segment', s[0], s[1], h, WALL_THICK));
}

// ---------- 3) 月洞墙（yuhuatang-moongate）：garden-kit 三条代理盒，世界坐标 ----------
const moonGate = layout.objects.find(o => o.kind === 'moonGateWall');
if (moonGate) {
  gardenKitCollision.modules['moon-gate'].boxes.forEach((b, i) => {
    add(moonGate.zone, `${moonGate.id}:box-${i}`, 'garden-kit:moon-gate', b.yaw ?? 0, [0, 0, 0], b.center, b.size);
  });
}

// ---------- 4) 五亭（pavilion-kit 局部记录 + layout 派生位姿：形心 + facade.dir） ----------
for (const pid of PAVILIONS) {
  const o = layout.objects.find(x => x.id === pid);
  const fp = ring(o.geometry.footprint);
  const cx = fp.reduce((s, q) => s + q[0], 0) / fp.length;
  const cz = fp.reduce((s, q) => s + q[1], 0) / fp.length;
  const d = o.facade.dir;
  const rotY = Math.atan2(d[0], d[1]);
  const rec = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'pavilion-kit', 'records', pid, 'collision.json'), 'utf8'));
  let obbSkipped = 0;
  for (const b of rec.colliders) {
    // obb 记录（p0/p1/width/thick 的背栏带状标记，径向半径最大 2.3 m）不能直译为薄盒，
    // 且坐凳栏 seat-* / post-* 已在 box 记录里挡住开敞面 —— 跳过并计数。
    if (b.type !== 'box') { obbSkipped += 1; continue; }
    // pavilion 记录约定：本地 +X -> (cos th, sin th)，+Z -> (-sin th, cos th)，即 obbToWorld 的 R(-th)
    const th = -(b.rotYDeg ?? 0) * Math.PI / 180;
    add(o.zone, `${pid}:${b.name}`, 'pavilion-kit', rotY + th, [cx, 0, cz], b.center, b.size);
  }
  if (obbSkipped) stats.pavilionObbSkipped = { ...(stats.pavilionObbSkipped || {}), [pid]: obbSkipped };
  stats.modulesRecomputed[pid] = { pos: [cx, cz], rotY };
}

// ---------- 5) 三穗堂（modules/sansuitang 局部记录 + layout 形心/facade 位姿，复核 OUT 世界记录） ----------
{
  const o = layout.objects.find(x => x.id === SANSUITANG_ID);
  const fp = ring(o.geometry.footprint);
  const cx = fp.reduce((s, q) => s + q[0], 0) / fp.length;
  const cz = fp.reduce((s, q) => s + q[1], 0) / fp.length;
  const d = o.facade.dir;
  const rotY = Math.atan2(d[0], d[1]);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  let maxDelta = 0;
  const world = sansuitangWorld.colliders;
  if (world.length !== sansuitangLocal.colliders.length) throw new Error('sansuitang: assemble record count mismatch');
  sansuitangLocal.colliders.forEach((b, bi) => {
    const [lx, ly, lz] = b.center;
    const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c; // 与 assemble.py 同式
    add(o.zone, `${SANSUITANG_ID}:${b.name}`, 'sansuitang', rotY, [cx, 0, cz], [lx, ly, lz], b.size);
    const ref = world[bi]; // assemble 输出与 modules 顺序一致；名字可能重复，不能按名配对
    if (ref.name !== b.name) throw new Error(`sansuitang: record order mismatch at ${bi} (${ref.name} vs ${b.name})`);
    maxDelta = Math.max(maxDelta, Math.hypot(ref.center[0] - wx, ref.center[2] - wz));
  });
  if (maxDelta > 0.05) throw new Error(`sansuitang recompute diverges from assemble output by ${maxDelta.toFixed(3)} m`);
  stats.modulesRecomputed[SANSUITANG_ID] = { pos: [cx, cz], rotY, maxDeltaVsAssemble: +maxDelta.toFixed(4) };
}

// ---------- 5b) 厅堂套件（HALL_KIT=1：hallkit-<id> 局部记录 + layout 面积形心/facade 位姿，复核 OUT 世界记录） ----------
if (HALL_KIT) {
  const o = layout.objects.find(x => x.id === HALLKIT_ID);
  const fp = ring(o.geometry.footprint);
  // 位置公式 = footprint 多边形面积形心（GOAL 冻结；与 assemble.py / build_hall.py 同式）
  const n = fp.length;
  const a2 = fp.reduce((s, p, i) => s + p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1], 0) / 2;
  const cx = Math.abs(a2) < 1e-6
    ? fp.reduce((s, q) => s + q[0], 0) / n
    : fp.reduce((s, p, i) => s + (p[0] + fp[(i + 1) % n][0]) * (p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1]), 0) / (6 * a2);
  const cz = Math.abs(a2) < 1e-6
    ? fp.reduce((s, q) => s + q[1], 0) / n
    : fp.reduce((s, p, i) => s + (p[1] + fp[(i + 1) % n][1]) * (p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1]), 0) / (6 * a2);
  const d = o.facade.dir;
  const rotY = Math.atan2(d[0], d[1]);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  let maxDelta = 0;
  const world = hallkitWorld.colliders;
  if (world.length !== hallkitLocal.colliders.length) throw new Error('hallkit: assemble record count mismatch');
  hallkitLocal.colliders.forEach((b, bi) => {
    const [lx, ly, lz] = b.center;
    const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c; // 与 assemble.py 同式
    add(o.zone, `${HALLKIT_ID}:${b.name}`, 'hall-kit', rotY, [cx, 0, cz], [lx, ly, lz], b.size);
    const ref = world[bi];
    if (ref.name !== b.name) throw new Error(`hallkit: record order mismatch at ${bi} (${ref.name} vs ${b.name})`);
    maxDelta = Math.max(maxDelta, Math.hypot(ref.center[0] - wx, ref.center[2] - wz));
  });
  if (maxDelta > 0.05) throw new Error(`hallkit recompute diverges from assemble output by ${maxDelta.toFixed(3)} m`);
  stats.modulesRecomputed[HALLKIT_ID] = { pos: [cx, cz], rotY, maxDeltaVsAssemble: +maxDelta.toFixed(4) };
}

// ---------- 6) 假山（modules/rockery 世界坐标盒） ----------
for (const [cluster, data] of Object.entries(rockeryCollision.clusters)) {
  data.boxes.forEach((b, i) => {
    const center = [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2];
    const size = [b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin];
    add('garden', `${cluster}:rock-${i}`, 'rockery-kit', 0, [0, 0, 0], center, size);
  });
}

// ---------- 7) 庙区 11+5 模块：temple-v3 记录按 layout 实例位姿变换 ----------
for (const rec of templeV3.colliders) {
  const prefix = rec.name.split(':')[0];
  const instId = TEMPLE_INSTANCE_OF_RECORD[prefix];
  if (!instId) throw new Error(`temple-v3 record ${rec.name}: no instance mapping`);
  const inst = layout.instances.find(x => x.id === instId);
  if (!inst) throw new Error(`temple-v3 record ${rec.name}: layout instance ${instId} missing`);
  // 记录已烘焙 temple-v3 内部位姿 (pos, theta)；再叠加区域锚点位姿：pos' = A + R(rotA)·pos，theta' = theta + rotA
  const [ax, az] = inst.position, rotA = inst.rotY;
  const c = Math.cos(rotA), s = Math.sin(rotA);
  const px = rec.obb.pos[0], pz = rec.obb.pos[2];
  const pos = [+(ax + c * px + s * pz).toFixed(4), 0, +(az - s * px + c * pz).toFixed(4)];
  add('temple', `${instId}:${rec.name}`, 'temple-v3', rec.obb.theta + rotA, pos, rec.obb.center, rec.obb.size);
}

// ---------- 8) 水面隐形挡墙：每边一条，路线 / 九曲桥跨过的边记 openings ----------
const bridge = layout.objects.find(o => o.kind === 'zigzagBridge');
const bridgePoly = bridge ? (bridge.geometry.polyline || bridge.geometry.footprint) : [];
for (const o of layout.objects) {
  if (o.kind !== 'water' || !ZONES.includes(o.zone)) continue;
  ringEdges(o.geometry.footprint).forEach(([a, b], i) => {
    const name = `water-${o.id}:edge-${i}`;
    const routeCrossed = routeDistToSeg(a, b) < ROUTE_CLEAR;
    const bridgeCrossed = bridgePoly.some((p, j) => j + 1 < bridgePoly.length && segsCross(a, b, bridgePoly[j], bridgePoly[j + 1]));
    if (routeCrossed || bridgeCrossed) {
      zones[o.zone].openings.push({ name, reason: bridgeCrossed ? 'jiuqu-bridge crossing' : 'commercial route crossing' });
      stats.openings.push({ water: o.id, edge: i, zone: o.zone, reason: bridgeCrossed ? 'jiuqu-bridge crossing' : 'commercial route crossing' });
      return;
    }
    edgeWall(o.zone, name, 'water-guard', a, b, GUARD_H, GUARD_THICK);
  });
}

// ---------- 9) 园林套件碰撞（wave1-walkr1 K1）：园廊 3 条 + 复廊 + 听涛阁水廊 ----------
// 来源：out-garden-kits/*.glb 的实际几何。柱位按 corridor-kit 冻结算法从 layout 折线重算，
// 逐根经 pillarInGlb 确认后才出盒（GLB 里不存在的候选位不出——部署 GLB 与设计记录可能有出入）。
// 美人靠 = 沿走向的薄长盒（坐面+扶手带合并）；复廊中墙 = 每段一个实体盒（漏窗窗台 0.9 m，胶囊不可穿越）。
// 廊的入口与园路/商业路线相交处不留栏/墙，记 openings（GOAL K1）。
const CORRIDOR_CFG = {
  'bld-553893874': { glb: 'out-garden-kits/corridor-bld-553893874.glb', width: 2.2, closed: true },
  'bld-428179906': { glb: 'out-garden-kits/ring-corridor-bld-428179906.glb', width: 2.2, closed: true },
  'bld-428179920': { glb: 'out-garden-kits/waterside-gallery-bld-428179920.glb', width: 2.6, closed: false, pavilion: true, pavW: 10.1, pavD: 6.4 },
};
const K_SEAT_H = 0.42, K_SEAT_T = 0.10, K_RAIL_TOP = 0.95, K_FLOOR_T = 0.12, K_COL_H = 2.55;
// 美人靠侧（corridor-kit ASSUMPTIONS[0]）：段中点 6m 内有水面取水侧；闭合环取环外侧（无水或水不在外侧时），
// 开放廊先水侧后背厅堂侧；均以 layout footprint 形心为参照，与 build_corridor_kit.rail_side_for 同式。
function railSidesFor(pts, closed) {
  const halls = [], waters = [];
  for (const o of layout.objects) {
    const fp = (o.geometry || {}).footprint;
    if (!fp || o.zone !== 'garden') continue;
    const f = dedupeClosed(fp);
    const centroid = [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length];
    if (['hall', 'tower', 'xuan', 'pavilion', 'waterside', 'stage'].includes(o.kind)) halls.push(centroid);
    else if (o.kind === 'water') waters.push(centroid);
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const n = pts.length, nseg = closed ? n : n - 1, sides = [];
  for (let i = 0; i < nseg; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const nl = leftNormal(unit2(b[0] - a[0], b[1] - a[1]));
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const near = (lst, rng) => {
      let best = null;
      for (const h of lst) {
        const d = Math.hypot(h[0] - mx, h[1] - mz);
        if (d < rng && (best === null || d < best[0])) best = [d, nl[0] * (h[0] - mx) + nl[1] * (h[1] - mz) > 0 ? 1 : -1];
      }
      return best;
    };
    const w = near(waters, 6.0), h = near(halls, 40.0);
    if (closed) {
      const outward = nl[0] * (mx - cx) + nl[1] * (mz - cz) > 0 ? 1 : -1;
      sides.push(w && w[1] === outward ? outward : (w === null && (h === null || h[0] > 15.0 || h[1] !== outward) ? outward : null));
    } else {
      sides.push(w ? w[1] : (h ? -h[1] : null));
    }
  }
  return sides;
}
// 折线（园路）到线段的最小距离
function polylineDistToSeg(a, b, pts) {
  let m = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, segPointDist2D(a[0], a[1], b[0], b[1], pts[i][0], pts[i][1]));
  return m;
}
// 园区步线（path/road/paving/steps 折线或墙段），用于「廊与园路相交处留开口」
const gardenPathPolylines = [];
for (const o of layout.objects) {
  if (o.zone !== 'garden' && o.zone !== 'pond') continue;
  const g = o.geometry || {};
  if (['path', 'road', 'paving', 'steps'].includes(o.kind) && Array.isArray(g.polyline)) gardenPathPolylines.push(g.polyline);
  if (Array.isArray(g.segments)) for (const s of g.segments) gardenPathPolylines.push([s[0], s[1]]);
}
// 栏/墙段与路线或园路相交 → 不建，记 openings
function blockedByPath(zone, name, a, b) {
  if (routeDistToSeg(a[0], a[1], b[0], b[1]) < ROUTE_CLEAR) {
    zones[zone].openings.push({ name, reason: 'commercial route crossing corridor rail/wall' });
    return true;
  }
  for (const pp of gardenPathPolylines) {
    if (polylineDistToSeg(a, b, pp) < ROUTE_CLEAR) {
      zones[zone].openings.push({ name, reason: 'garden path crossing corridor rail/wall' });
      return true;
    }
  }
  return false;
}
let corridorKitStats = {};
for (const [oid, cfg] of Object.entries(CORRIDOR_CFG)) {
  const o = layout.objects.find(x => x.id === oid);
  if (!o) throw new Error(`corridor ${oid}: layout object missing`);
  const poly = o.geometry.polyline;
  let pts;
  if (cfg.pavilion) {
    // 听涛阁水廊自端亭南边缘起建：p1 沿 seg0 反向 pavW/2；seg0 由端亭 massing 覆盖（build_corridor_kit 同式）
    const u0 = unit2(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]);
    pts = [[poly[1][0] - u0[0] * cfg.pavW / 2, poly[1][1] - u0[1] * cfg.pavW / 2], ...poly.slice(1)];
  } else {
    pts = dedupeClosed(poly);
  }
  const n = pts.length, nseg = cfg.closed ? n : n - 1, coloff = cfg.width / 2 - 0.1;
  const cols = [];
  for (let i = 0; i < nseg; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const u = unit2(b[0] - a[0], b[1] - a[1]), nl = leftNormal(u);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ns = Math.max(1, Math.round(L / 2.5));
    const ts = cfg.closed ? Array.from({ length: ns }, (_, k) => k / ns) : Array.from({ length: ns + 1 }, (_, k) => k / ns);
    for (const side of [-1, 1]) for (const t of ts)
      cols.push({ x: a[0] + (b[0] - a[0]) * t + side * nl[0] * coloff, z: a[1] + (b[1] - a[1]) * t + side * nl[1] * coloff });
  }
  // GLB 确认后才出柱盒（候选位里 GLB 没有柱的不出，避免隐形墙）
  let ci = 0, confirmedCols = 0;
  for (const c of cols) {
    if (!pillarInGlb(cfg.glb, c.x, c.z)) continue;
    confirmedCols += 1;
    add(o.zone, `${oid}:col-${ci++}`, 'corridor-kit', 0, [0, 0, 0], [c.x, (K_FLOOR_T + K_COL_H) / 2, c.z], [0.24, K_COL_H - K_FLOOR_T, 0.24]);
  }
  if (!confirmedCols) throw new Error(`corridor ${oid}: no GLB-confirmed pillars`);
  // 美人靠：坐面(0.32–0.42)+扶手(至0.95) 合并为一条薄长盒（急弯端部内缩与 build_corridor_kit 同式）
  const turnAt = (i) => {
    if (!cfg.closed && (i <= 0 || i >= n - 1)) return 0;
    const a = pts[(i - 1 + n) % n], b = pts[i % n], c = pts[(i + 1) % n];
    const v1 = unit2(b[0] - a[0], b[1] - a[1]), v2 = unit2(c[0] - b[0], c[1] - b[1]);
    return Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1]))) * 180 / Math.PI;
  };
  let railCount = 0;
  railSidesFor(pts, cfg.closed).forEach((side, i) => {
    if (side === null) return;
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t0 = (cfg.closed || i > 0) && turnAt(i) > 50 ? 1.4 : 0.18;
    const t1 = (cfg.closed || i < n - 1) && turnAt(i + 1) > 50 ? 1.4 : 0.18;
    if (L - t0 - t1 < 0.4) return;
    const u = unit2(b[0] - a[0], b[1] - a[1]), nl = leftNormal(u), run = L - t0 - t1;
    const s0 = t0, s1 = L - t1, amx = (s0 + s1) / 2;
    const ox = a[0] + u[0] * amx + side * nl[0] * (coloff - 0.08);
    const oz = a[1] + u[1] * amx + side * nl[1] * (coloff - 0.08);
    if (blockedByPath(o.zone, `${oid}:rail-${i}`, [a[0] + u[0] * s0, a[1] + u[1] * s0], [a[0] + u[0] * s1, a[1] + u[1] * s1])) return;
    // corridor-kit box_part 约定：本地 +X -> (sin rot, cos rot)；obbToWorld 的 +Z 同向 → θ 同值、size XZ 互换
    // （pos 放世界位、center 留局部 0——obbToWorld 对 center 也要转 θ）
    const yaw = Math.atan2(u[0], u[1]);
    const yMid = ((K_SEAT_H - K_SEAT_T) + K_RAIL_TOP) / 2, ySize = K_RAIL_TOP - (K_SEAT_H - K_SEAT_T);
    add(o.zone, `${oid}:rail-${i}`, 'corridor-kit', yaw, [ox, 0, oz], [0, yMid, 0], [0.24, ySize, run]);
    railCount += 1;
  });
  // 听涛阁端亭 massing：台基一盒 + 底层柱网 6x4（corridor-kit build_pavilion 同式；方盒 θ=0）
  if (cfg.pavilion) {
    const c = poly[1];
    const u = unit2(poly[2][0] - poly[1][0], poly[2][1] - poly[1][1]);
    const yaw = Math.atan2(u[0], u[1]);
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    const lp = (lx, lz) => [c[0] + lx * sn + lz * cs, c[1] + lx * cs - lz * sn];
    const [bx, bz] = lp(0, 0);
    add(o.zone, `${oid}:pav-base`, 'corridor-kit', 0, [0, 0, 0], [bx, 0.3 / 2, bz], [cfg.pavW, 0.3, cfg.pavD]);
    let pi = 0;
    for (const lx of Array.from({ length: 6 }, (_, i) => -cfg.pavW / 2 + cfg.pavW * i / 5))
      for (const lz of Array.from({ length: 4 }, (_, k) => -cfg.pavD / 2 + cfg.pavD * k / 3)) {
        const [px, pz] = lp(lx, lz);
        if (!pillarInGlb(cfg.glb, px, pz)) continue;
        add(o.zone, `${oid}:pav-col-${pi++}`, 'corridor-kit', 0, [0, 0, 0], [px, (0.3 + 3.05) / 2, pz], [0.24, 2.75, 0.24]);
      }
    corridorKitStats[oid] = { cols: confirmedCols, rails: railCount, pavCols: pi };
  } else {
    corridorKitStats[oid] = { cols: confirmedCols, rails: railCount };
  }
}

// ---------- 10) 复廊（bld-428186469）：modules/double-corridor 部署 GLB（记录 sha 对应）的柱/栏/中墙 ----------
{
  const oid = 'bld-428186469';
  const o = layout.objects.find(x => x.id === oid);
  const rec = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'double-corridor', 'double-corridor-record.json'), 'utf8'));
  const glbSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(AREA, 'out-garden-kits', 'double-corridor-bld-428186469.glb'))).digest('hex');
  if (glbSha !== rec.sha256) throw new Error(`double-corridor GLB sha mismatch: ${glbSha} vs record ${rec.sha256}`);
  const CL = rec.centreline, D = rec.designValues;
  const FP = dedupeClosed(o.geometry.polyline);
  const offsetPoly = (poly, d) => {
    const n = poly.length;
    const area = poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0) / 2;
    const sgn = area > 0 ? 1 : -1;
    return poly.map((_, i) => {
      const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
      const nrm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [sgn * dz / l, -sgn * dx / l]; };
      const n1 = nrm(p0, p1), n2 = nrm(p1, p2), bx = n1[0] + n2[0], bz = n1[1] + n2[1], bl = Math.hypot(bx, bz);
      const k = d / Math.max(0.35, (bx * n1[0] + bz * n1[1]) / bl);
      return [p1[0] + bx / bl * k, p1[1] + bz / bl * k];
    });
  };
  const inside = (p, poly) => {
    let c = false;
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const distCl = (p) => {
    let m = Infinity;
    for (let i = 0; i + 1 < CL.length; i++) {
      const a = CL[i], b = CL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
      m = Math.min(m, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
    }
    return m;
  };
  const half = D.sideOffset + 0.2 + D.overhang;
  const roofY = (p) => D.ridgeY - (D.ridgeY - D.eaveY) * Math.min(distCl(p) / half, 1.25);
  const offsetLine = (pl, d) => pl.map((p, i) => {
    const dirs = [];
    if (i > 0) dirs.push([p[0] - pl[i - 1][0], p[1] - pl[i - 1][1]]);
    if (i < pl.length - 1) dirs.push([pl[i + 1][0] - p[0], pl[i + 1][1] - p[1]]);
    const ns = dirs.map(([dx, dz]) => [-dz / Math.hypot(dx, dz), dx / Math.hypot(dx, dz)]);
    let nx = 0, nz = 0; for (const q of ns) { nx += q[0]; nz += q[1]; }
    const l = Math.hypot(nx, nz), c = (nx / l) * ns[0][0] + (nz / l) * ns[0][1];
    return [p[0] + nx / l * d / Math.max(c, 0.5), p[1] + nz / l * d / Math.max(c, 0.5)];
  });
  const FPin = offsetPoly(FP, -0.12);
  let ci = 0, ri = 0, wi = 0, confirmedCols = 0;
  for (const side of [-1, 1]) {
    const line = offsetLine(CL, side * D.sideOffset), pts = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / D.colSpacing));
      for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    pts.push(line.at(-1));
    const on = pts.filter(p => inside(p, FPin));
    for (const p of on) {
      if (!pillarInGlb('out-garden-kits/double-corridor-bld-428186469.glb', p[0], p[1])) continue;
      confirmedCols += 1;
      const topY = roofY(p) - 0.1;
      add(o.zone, `${oid}:col-${ci++}`, 'double-corridor', 0, [0, 0, 0], [p[0], (D.floorY + topY) / 2, p[1]], [0.2, topY - D.floorY, 0.2]);
    }
    // 栏杆：首末跨留空（入口），bar 间各一条薄长盒（rail-top+rail-panel 合并，y 0.12–0.57）
    // double-corridor box() 的 yaw = atan2(dz, dx)（本地 +X 沿段向）；obbToWorld +X -> (cos θ, -sin θ) → θ = -yaw
    for (let i = 1; i + 2 < on.length; i++) {
      const a = on[i], b = on[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (blockedByPath(o.zone, `${oid}:rail-${ri}`, a, b)) { ri += 1; continue; }
      add(o.zone, `${oid}:rail-${ri++}`, 'double-corridor', -Math.atan2(b[1] - a[1], b[0] - a[0]), [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2],
        [0, D.floorY + D.railH / 2, 0], [L - 0.2, D.railH, 0.12]);
    }
  }
  if (!confirmedCols) throw new Error(`double-corridor: no GLB-confirmed pillars`);
  // 中墙：每段一个实体盒（漏窗窗台 0.9 m，胶囊不可穿越，无需开窗洞）
  for (let i = 0; i + 1 < CL.length; i++) {
    const a = CL[i], b = CL[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (blockedByPath(o.zone, `${oid}:wall-${wi}`, a, b)) { wi += 1; continue; }
    add(o.zone, `${oid}:wall-${wi++}`, 'double-corridor', -Math.atan2(b[1] - a[1], b[0] - a[0]), [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2],
      [0, (D.floorY + D.wallTop) / 2, 0], [L + 0.24, D.wallTop - D.floorY, D.wallT]);
  }
  corridorKitStats[oid] = { cols: confirmedCols, module: 'double-corridor (deployed GLB sha verified)' };
}

// ---------- 11) 豫园门楼（garden-gate）：inputs/yuyuan-gate-v2.glb 实体两面 Pier，门洞留 ≥2.2 m 通道 ----------
{
  const o = layout.objects.find(x => x.id === 'garden-gate');
  const [gx, gz] = o.geometry.position, rotY = o.geometry.rotY;
  // 只取 gate-wall 网格（墙体实体）；折起的门扇/脊饰/檐/瓦不建（檐棚在身体带以上同理）
  const verts = glbVerts('inputs/yuyuan-gate-v2.glb', 'gate-wall').filter(v => v[1] > 0.2 && v[1] < 2.5);
  const wallsY = glbVerts('inputs/yuyuan-gate-v2.glb', 'gate-wall').reduce((m, v) => Math.max(m, v[1]), 0);
  const piers = {};
  for (const [key, sel] of [['pier-w', v => v[0] < -1.0], ['pier-e', v => v[0] > 1.0]]) {
    const vs = verts.filter(sel);
    if (!vs.length) throw new Error(`gate ${key}: no wall geometry`);
    piers[key] = {
      cx: (Math.min(...vs.map(v => v[0])) + Math.max(...vs.map(v => v[0]))) / 2,
      cz: (Math.min(...vs.map(v => v[2])) + Math.max(...vs.map(v => v[2]))) / 2,
      sx: Math.max(...vs.map(v => v[0])) - Math.min(...vs.map(v => v[0])),
      sz: Math.max(...vs.map(v => v[2])) - Math.min(...vs.map(v => v[2])),
    };
  }
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const passageM = piers['pier-e'].cx - piers['pier-e'].sx / 2 - (piers['pier-w'].cx + piers['pier-w'].sx / 2);
  if (passageM < 2.2) throw new Error(`gate passage ${passageM.toFixed(2)} m < 2.2 m`);
  for (const [key, p] of Object.entries(piers)) {
    const wx = gx + c * p.cx + s * p.cz, wz = gz - s * p.cx + c * p.cz;
    add(o.zone, `garden-gate:${key}`, 'yuyuan-gate-v2', rotY, [gx, 0, gz], [p.cx, wallsY / 2, p.cz], [p.sx, wallsY, p.sz]);
  }
  corridorKitStats['garden-gate'] = { piers: 2, passageM: +passageM.toFixed(2) };
}

// ---------- 12) 树（garden 46 棵）：树干一个 0.4 m 方盒（高 2 m），位置 = tree-placements（含 9 棵避让移位） ----------
{
  const tp = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'tree-kit', 'tree-placements.json'), 'utf8')).placements;
  if (tp.length !== 46) throw new Error(`tree placements ${tp.length} != 46`);
  for (const t of tp) {
    add('garden', `${t.id}:trunk`, 'tree-kit', 0, [0, 0, 0], [t.position[0], 1.0, t.position[1]], [0.4, 2.0, 0.4]);
  }
  corridorKitStats['trees'] = tp.length;
}

// ---------- 13) 摊位/长凳（bazaar 51 件）：每件一个 GLB 包围盒盒；檐棚（身体带以上）不建 ----------
{
  const sp = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'bazaar-stalls', 'records', 'placements.json'), 'utf8'));
  const items = [...sp.stalls, ...sp.benches];
  const bboxCache = {};
  const bboxOf = (mod) => {
    if (!bboxCache[mod]) {
      const { meshes } = readGlb(fs.readFileSync(path.join(AREA, 'out-bazaar-stalls', mod)));
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3)
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]); }
      bboxCache[mod] = { mn, mx };
    }
    return bboxCache[mod];
  };
  for (const it of items) {
    const { mn, mx } = bboxOf(it.module);
    add('bazaar', `${it.id}:body`, 'bazaar-stalls', it.rotY, [it.position[0], 0, it.position[1]],
      [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]);
  }
  corridorKitStats['stalls+benches'] = items.length;
}
stats.corridorKits = corridorKitStats;

// ---------- 14) spawns：nav-gap anchors 按layout zones 多边形落入分区 ----------
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
    if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) inside = !inside;
  }
  return inside;
}
function zoneOfPoint(x, z, fallback) {
  for (const z of ['pond', 'temple', 'garden', 'bazaar']) {   // 小分区优先，避免大包围盒吞并
    const poly = layout.zones?.[z]?.polygon;
    if (poly && pointInPoly(x, z, poly)) return z;
  }
  // 都不在：取最近的多边形（点到各分区多边形边的最小距离）
  let best = fallback, bestD = Infinity;
  for (const z of ['pond', 'temple', 'garden', 'bazaar']) {
    const poly = layout.zones?.[z]?.polygon;
    if (!poly) continue;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
      if (d < bestD) { bestD = d; best = z; }
    }
  }
  return best;
}
for (const [k, [x, z]] of Object.entries(nav.anchors)) {
  const zone = zoneOfPoint(x, z, 'bazaar');
  zones[zone].spawns = zones[zone].spawns || {};
  zones[zone].spawns[k] = [x, 0, z];
  stats.spawnAssignment = stats.spawnAssignment || {};
  stats.spawnAssignment[k] = zone;
}

// ---------- 15) 地面节点规则（浏览器/测试把分区 GLB 命中节点交给 collectGroundTriangles 别名层） ----------
const FROZEN_EXTRA_GROUND = ['jiuqu-bridge*', 'pavilion-*/floor*', 'sansuitang*/platform*'];
const GROUND_RE = {
  garden: '^(garden|pond)\\|[^|]+\\|(road|plaza|path|paving|steps|ground)\\|',
  pond: '^(garden|pond)\\|[^|]+\\|(road|plaza|path|paving|steps|ground)\\|',
  temple: '^temple-ground__(paving-frontage|worn-stone)',
  bazaar: '^bazaar\\|[^|]+\\|(road|plaza|path|paving|steps|ground)\\|',
  outer: '^outer\\|[^|]+\\|(road|plaza|path|paving|steps|ground)\\|',
};
const EXTRA_GROUND = {
  garden: FROZEN_EXTRA_GROUND,
  pond: FROZEN_EXTRA_GROUND,
  // 庙区模块地坪逐一列名（节点名取自分区 GLB：*-body__worn-stone 等不用通配防跨件误配）
  temple: [...FROZEN_EXTRA_GROUND,
    'shanmen-body__worn-stone*', 'entry-court__worn-stone*', 'yimen-body__worn-stone*',
    'yimen-stage-body__worn-stone*', 'dadian-court__worn-stone*', 'peidian-body__worn-stone*',
    'gallery-body__worn-stone*', 'dadian-body__worn-stone*', 'court3-boundary__worn-stone*',
    'houdian-body__worn-stone*'],
  bazaar: FROZEN_EXTRA_GROUND,
  outer: FROZEN_EXTRA_GROUND,
};

// ---------- 写文件 ----------
for (const z of ZONES) {
  const f = {
    axis: AXIS,
    zone: z,
    sourceLayoutSha256: layoutSha,
    colliders: zones[z].colliders,
    openings: zones[z].openings,
    groundNodeRe: GROUND_RE[z],
    extraGroundNodes: EXTRA_GROUND[z],
    spawns: zones[z].spawns || {},
  };
  fs.writeFileSync(path.join(OUT, `collision-${z}.json`), JSON.stringify(f, null, 1) + '\n');
  stats.zones[z] = { ...(stats.zones[z] || {}), colliders: f.colliders.length, openings: f.openings.length };
}
console.log(`export-collision: wrote ${ZONES.length} files to ${OUT}`);
console.log(JSON.stringify(stats.zones));
console.log('spawn assignment:', JSON.stringify(stats.spawnAssignment));
console.log(`street-mouth edges skipped: ${stats.skippedStreetMouths.length}, water openings: ${stats.openings.length}`);
