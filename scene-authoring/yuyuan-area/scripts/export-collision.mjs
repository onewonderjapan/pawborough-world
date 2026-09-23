// WP4.1 全域候选碰撞世界导出：每个分区一个 collision-<zone>.json（格式冻结于
// docs/AREA-COLLISION-FORMAT.md，记录形式与 src/world/collisionAdapter.js 形式 (a) 一致）。
// 位置一律从 baseline/layout.json 重算；套件件用各自模块的局部碰撞记录 + layout 派生位姿。
// 由 scripts/rebuild-review.sh 在分区导出与 connectivity/route 产物之后调用；WALK_COLLISION=0 跳过。
// 用法：OUT_DIR=out-zone node scripts/export-collision.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';

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

// ---------- 1) 建筑类 footprint 薄墙（亭/三穗堂走套件记录，不在此列） ----------
const PAV = new Set(PAVILIONS);
for (const o of layout.objects) {
  if (!ZONES.includes(o.zone)) continue;
  const g = o.geometry || {};
  const isBuilding = ['hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock'].includes(o.kind)
    || (o.kind === 'outerBuilding' && o.zone === 'bazaar');
  if (!isBuilding || !g.footprint || o.id === SANSUITANG_ID || PAV.has(o.id)) continue;
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

// ---------- 9) spawns：nav-gap anchors 按layout zones 多边形落入分区 ----------
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

// ---------- 10) 地面节点规则（浏览器/测试把分区 GLB 命中节点交给 collectGroundTriangles 别名层） ----------
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
