// WP13/R1 导览机位可见性几何（共享原始运算，生成器与测试都从这里引用，避免规则分叉）：
//   - loadColliders：out-zone/collision-<zone>.json 记录 → obbToWorld 世界 OBB + 包围盒；
//   - segBlocked：三维线段是否穿过某 OBB（滑块法）；
//   - targetBox：baseline/layout.json 对象 → 目标包围盒（footprint / rocks / polyline 三种）；
//   - visiblePointCount：相机→目标包围盒 9 采样点（中心 + 8 角）被碰撞盒遮挡计数；
//   - screenAreaFrac：目标包围盒投到画面的凸包、再裁到画框后的面积占比（与 web/main.js 相机同参 fov46 / 视口 1400×900；
//     导览 tour-test / compute-area-tour 与控制层 control-shot-visibility 共用这一个函数，只有一种口径）；
//   - nearestColliderDist：点到最近可遮挡碰撞盒（顶 ≥ eyeY）的 3D 距离。
// 数值只从冻结源（baseline/layout.json）与管线产物（collision-*.json）重算，不依赖 tour.json。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';
import { dist2d } from '../src/lib.mjs';

// 与 web/main.js PerspectiveCamera(46, w/h) 及 tour-browser-check 视口一致
export const VIEW = { fovDeg: 46, width: 1400, height: 900 };
export const ZONE_FILES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];

const EPS = 1e-6;

// ---------- 碰撞集 ----------
// module 'water-guard'（水面隐形挡墙，高 1.2 m 的物理护栏，渲染不可见）不参与视觉遮挡与净距——
// 它是步行防落水碰撞，不是看得见的墙；把它当视觉遮挡会让一切低视角望水/望桥的机位失真。
export function loadColliders(areaRoot, outDir, zones = ZONE_FILES) {
  const out = [];
  for (const z of zones) {
    const file = path.join(areaRoot, outDir, `collision-${z}.json`);
    if (!fs.existsSync(file)) throw new Error(`collision-${z}.json 不存在（${file}）— 先跑 scripts/export-collision.mjs`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const rec of data.colliders) {
      if (rec.module === 'water-guard') continue;
      const w = obbToWorld(rec);
      const [cx, cy, cz] = w.center, [hx, hy, hz] = w.halfExtents, yaw = w.yaw;
      const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
      out.push({
        name: rec.name, zone: z, id: rec.name.split(':')[0],
        center: [cx, cy, cz], half: [hx, hy, hz], yaw,
        cos: Math.cos(yaw), sin: Math.sin(yaw),
        aabb: { x0: cx - (c * hx + s * hz), x1: cx + (c * hx + s * hz), y0: cy - hy, y1: cy + hy, z0: cz - (s * hx + c * hz), z1: cz + (s * hx + c * hz) },
        topY: cy + hy,
      });
    }
  }
  return out;
}

// 线段 a→b 是否穿过盒（端点不算，t ∈ (0,1)）。OBB 局部化后滑块法。
export function segHitsBox(a, b, bx) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  // 世界 → 盒局部：先平移到中心，再转 -yaw（obbToWorld 的 R=[[c,s],[-s,c]]，逆即转置）
  const wx = a[0] - bx.center[0], wy = a[1] - bx.center[1], wz = a[2] - bx.center[2];
  const ox = bx.cos * wx - bx.sin * wz, oy = wy, oz = bx.sin * wx + bx.cos * wz;
  const rx = bx.cos * dx - bx.sin * dz, ry = dy, rz = bx.sin * dx + bx.cos * dz;
  let t0 = 0, t1 = 1;
  for (const [o, r, h] of [[ox, rx, bx.half[0]], [oy, ry, bx.half[1]], [oz, rz, bx.half[2]]]) {
    if (Math.abs(r) < 1e-12) { if (Math.abs(o) > h) return false; continue; }
    let u0 = (-h - o) / r, u1 = (h - o) / r;
    if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return t1 > EPS && t0 < 1 - EPS && t1 - t0 > EPS;
}

// a→b 是否被任一碰撞盒挡住（ignoreIds：目标自身记录不计——它就是被看的东西）
export function segBlocked(boxes, a, b, ignoreIds = []) {
  for (const bx of boxes) {
    if (ignoreIds.includes(bx.id)) continue;
    if (b[0] < bx.aabb.x0 && a[0] < bx.aabb.x0) continue;
    if (b[0] > bx.aabb.x1 && a[0] > bx.aabb.x1) continue;
    if (b[2] < bx.aabb.z0 && a[2] < bx.aabb.z0) continue;
    if (b[2] > bx.aabb.z1 && a[2] > bx.aabb.z1) continue;
    if (Math.min(a[1], b[1]) > bx.aabb.y1 || Math.max(a[1], b[1]) < bx.aabb.y0) continue;
    if (segHitsBox(a, b, bx)) return bx.name;
  }
  return null;
}

// ---------- 目标包围盒（从 baseline/layout.json 对象重算） ----------
export function targetBox(o) {
  const g = o.geometry;
  if (g.footprint) {
    const xs = g.footprint.map(p => p[0]), zs = g.footprint.map(p => p[1]);
    return { id: o.id, min: [Math.min(...xs), 0, Math.min(...zs)], max: [Math.max(...xs), o.height || 6, Math.max(...zs)] };
  }
  if (g.rocks) {
    const xs = g.rocks.flatMap(r => [r.x - r.size / 2, r.x + r.size / 2]);
    const zs = g.rocks.flatMap(r => [r.z - r.size / 2, r.z + r.size / 2]);
    const top = Math.max(...g.rocks.map(r => r.h ?? r.height ?? 0));
    return { id: o.id, min: [Math.min(...xs), 0, Math.min(...zs)], max: [Math.max(...xs), top, Math.max(...zs)] };
  }
  if (g.polyline) {
    const hw = (o.width || 2.4) / 2;
    const xs = g.polyline.map(p => p[0]), zs = g.polyline.map(p => p[1]);
    const deck = o.deckY ?? 0.55;
    return { id: o.id, min: [Math.min(...xs) - hw, 0, Math.min(...zs) - hw], max: [Math.max(...xs) + hw, deck + 0.9, Math.max(...zs) + hw] };
  }
  throw new Error('unsupported target geometry: ' + o.id);
}
export const boxPoints = (box) => {
  // OBB 形式 {center, half, yaw}（锚点街廊盒）：局部角点按 obbToWorld 同一旋转变到世界
  if (box.center && box.half) {
    const [cx, cy, cz] = box.center, [hx, hy, hz] = box.half;
    const c = Math.cos(box.yaw || 0), s = Math.sin(box.yaw || 0);
    const world = (lx, ly, lz) => [cx + c * lx + s * lz, cy + ly, cz - s * lx + c * lz];
    return [ world(0, 0, 0),
      world(-hx, -hy, -hz), world(hx, -hy, -hz), world(-hx, hy, -hz), world(hx, hy, -hz),
      world(-hx, -hy, hz), world(hx, -hy, hz), world(-hx, hy, hz), world(hx, hy, hz) ];
  }
  const [cx, cy, cz] = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const [hx, hy, hz] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
  return [ [cx, cy, cz],
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx - hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx - hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz + hz] ];
};

// ---------- 锚点街景目标走廊盒（只依赖冻结源：nav-gap 锚点 + commercial-route 出发路线，确定性重算） ----------
// 锚点机位的「目标」是沿行进方向的街景本身：锚点前方沿街走廊盒（OBB，长轴 = 出发方向）。
// 长度 = 出发路线第一段的拐点前长度，夹在 [S0, S1]（路线长直时即原 6–36 m；首段短/拐弯时
// 截到拐点前，避免直线走廊越过拐角落进街旁建筑、被碰撞薄墙误判遮挡）。终点延伸型
// （street:cont:，锚点是路线终点）没有前向折线 → 传 null，保持全长 S1。
// 半宽 1.4 m：商业路线宽 3 m（commercial-route.json widthM），走廊必须贴在街内，
// 否则两角落进侧旁山墙、被碰撞薄墙误判遮挡。围合式老街块（街道在 footprint 多边形内部）
// 套任何单一建筑的 bbox 都会把相机罩进去 —— 街廊盒才是「街景」的可验证几何。
// 生成器与测试共用本函数。
export const CORRIDOR = { S0: 6, S1: 36, HALF_W: 1.4, H: 2.2, AIM_S: 21 };
// 出发路线第一段（拐点前）长度；无折线/退化时返回全长 S1
export function streetCorridorLen(routePts) {
  if (!Array.isArray(routePts) || routePts.length < 2) return CORRIDOR.S1;
  const l = Math.hypot(routePts[1][0] - routePts[0][0], routePts[1][1] - routePts[0][1]);
  if (!l) return CORRIDOR.S1;
  return Math.max(CORRIDOR.S0 + 2, Math.min(CORRIDOR.S1, l));
}
export function streetCorridorBox(anchor2, dir, routePts = null) {
  const { S0, HALF_W, H } = CORRIDOR;
  const s1 = routePts ? streetCorridorLen(routePts) : CORRIDOR.S1;
  const mid = [anchor2[0] + dir[0] * (S0 + s1) / 2, anchor2[1] + dir[1] * (S0 + s1) / 2];
  return {
    id: 'street-corridor',
    center: [mid[0], H / 2, mid[1]],
    // obbToWorld 约定：局部 +Z 轴 = (sin yaw, cos yaw) = 出发方向 —— 长度在 Z 半轴，宽度在 X 半轴
    half: [HALF_W, H / 2, (s1 - S0) / 2],
    yaw: Math.atan2(dir[0], dir[1]),
  };
}
// ---------- wave4-touranchor：锚点街景新口径（街面 + 两侧立面；渲染复核 tests/tour-render-check.mjs 用同一组常数） ----------
// 目标 = 街廊盒里的街面（streetCorridorBox）+ 走廊盒两侧各 FACADE_BAND_M 内的建筑立面像素
//   （立面 = 建筑类 layout 对象的近竖直面 |n_y| < VERTICAL_NY，落在「走廊盒横向外扩 FACADE_BAND_M、高 FACADE_H」的带盒里）。
// 画面门槛：目标 ≥ MIN_TARGET；天空（没有任何几何的像素）≤ MAX_SKY；
// 画面下 1/3 的「近景墙」（近竖直面且距相机 < NEAR_M）最大 4-连通区 < MAX_NEAR_COMPONENT（占下 1/3 面积）。
export const STREET_VIEW = {
  FACADE_BAND_M: 6, FACADE_H: 30, VERTICAL_NY: 0.5,
  MIN_TARGET: 0.25, MAX_SKY: 0.35, NEAR_M: 6, MAX_NEAR_COMPONENT: 0.40,
};
// 「建筑立面」归属的 layout 类别（建筑体、立面开间、商铺/庙宇锚、园墙类）；树/摊位/道路/水/岩石不算立面
export const FACADE_KINDS = new Set([
  'outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'corridor', 'waterside', 'stage', 'watersideGallery',
  'facadeBay', 'shopAnchor', 'templeAnchor', 'wall', 'wallHead', 'moonGateWall', 'gateAnchor',
]);
export function facadeIds(layout) {
  return layout.objects.filter(o => FACADE_KINDS.has(o.kind)).map(o => o.id);
}
// 立面带盒：与街廊盒同中心线/同长度，横向半宽 = HALF_W + FACADE_BAND_M，高 0–FACADE_H
export function streetFacadeBand(anchor2, dir, routePts = null) {
  const c = streetCorridorBox(anchor2, dir, routePts);
  const { FACADE_BAND_M, FACADE_H } = STREET_VIEW;
  return { id: 'street-facade-band', center: [c.center[0], FACADE_H / 2, c.center[2]], half: [c.half[0] + FACADE_BAND_M, FACADE_H / 2, c.half[2]], yaw: c.yaw };
}
export function streetCorridorAim(anchor2, dir, routePts = null) {
  const { AIM_S, S0 } = CORRIDOR;
  const s1 = routePts ? streetCorridorLen(routePts) : CORRIDOR.S1;
  const s = Math.min(AIM_S, (S0 + s1) / 2);   // 注视点 = 走廊中点（全长时即原 AIM_S=21）
  return [anchor2[0] + dir[0] * s, 1.8, anchor2[1] + dir[1] * s];
}
// 长折线对象（九曲桥）的锚点局部包围盒：折线中距锚点 R 半径内的点取 AABB。
// 九曲桥全长 zigzag ~60 m，全域 AABB 会罩住机位、远端被湖心亭遮挡 —— 眼高机位的
// 「看得到目标」只能对近段成立；R 固定 30 m，只依赖 nav-gap 锚点与 layout 折线，确定性重算。
export const NEAR_BOX_R = 30;
export function polylineNearBox(o, anchor2, R = NEAR_BOX_R) {
  const pts = (o.geometry.polyline || []).filter(p => dist2d(p, anchor2) <= R);
  if (pts.length < 2) return null;
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const deck = o.deckY ?? 0.55;
  const hw = (o.width || 2.4) / 2;
  return { id: o.id, min: [Math.min(...xs) - hw, 0, Math.min(...zs) - hw], max: [Math.max(...xs) + hw, deck + 0.9, Math.max(...zs) + hw] };
}
// 点(2D) 到盒俯平面的距离（盒内 = 0）；支持 AABB {min,max} 与 OBB {center,half,yaw}
export function boxDist2d(box, p2) {
  let lx, lz, hx, hz;
  if (box.center && box.half) {
    const dx = p2[0] - box.center[0], dz = p2[1] - box.center[2];
    const c = Math.cos(box.yaw || 0), s = Math.sin(box.yaw || 0);
    lx = c * dx - s * dz; lz = s * dx + c * dz;
    hx = box.half[0]; hz = box.half[2];
  } else {
    lx = p2[0] - (box.min[0] + box.max[0]) / 2; lz = p2[1] - (box.min[2] + box.max[2]) / 2;
    hx = (box.max[0] - box.min[0]) / 2; hz = (box.max[2] - box.min[2]) / 2;
  }
  return Math.hypot(Math.max(Math.abs(lx) - hx, 0), Math.max(Math.abs(lz) - hz, 0));
}

// 相机 → 目标包围盒 9 点可见计数（目标自身碰撞盒剔除）
export function visiblePointCount(boxes, cam, box) {
  let vis = 0;
  for (const p of boxPoints(box)) if (!segBlocked(boxes, cam, p, [box.id])) vis++;
  return vis;
}

// ---------- 画面投影面积占比（与 three.js 透视同式：fov 竖直、aspect = W/H） ----------
// 包围盒 12 条棱投到画面取凸包；棱与近平面（z=0.05）求交裁剪 ——
// 相机落在目标 bbox 水平范围内时（围合大院、长桥折线），部分角点在相机背后，
// 直接返回 0 会漏判，必须裁剪后投影。
// 凸包再裁到画面矩形 [0,W]×[0,H]，得到「画面内」面积占比（wave3-tourfix T1 起导览也用此口径；
// 旧导览口径不裁，目标整体在画外时投影点落在画外也会算出大面积——见 tests/tour-visibility-test.mjs 用例 1）。
export function screenAreaFrac(box, cam, look, view = VIEW) {
  const f = norm3(sub3(look, cam));
  const r = norm3(cross(f, [0, 1, 0]));
  if (!isFinite(r[0])) return 0; // 望天/望地退化
  const u = cross(r, f);
  const tanY = Math.tan((view.fovDeg / 2) * Math.PI / 180), tanX = tanY * (view.width / view.height);
  const toView = (p) => {
    const d = sub3(p, cam);
    return [d[0] * r[0] + d[1] * r[1] + d[2] * r[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * f[0] + d[1] * f[1] + d[2] * f[2]];
  };
  const cs = boxPoints(box).slice(1); // 8 角（中心在凸包内部，不参与）
  const pairs = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
  const NEAR = 0.05, pts = [];
  for (const [i, j] of pairs) {
    let a = toView(cs[i]), b = toView(cs[j]);
    if (a[2] < NEAR && b[2] < NEAR) continue;
    if (a[2] < NEAR || b[2] < NEAR) { // 裁到近平面
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR];
      if (a[2] < NEAR) a = m; else b = m;
    }
    pts.push([(a[0] / (a[2] * tanX) * 0.5 + 0.5) * view.width, (-a[1] / (a[2] * tanY) * 0.5 + 0.5) * view.height]);
    pts.push([(b[0] / (b[2] * tanX) * 0.5 + 0.5) * view.width, (-b[1] / (b[2] * tanY) * 0.5 + 0.5) * view.height]);
  }
  if (pts.length < 3) return 0; // 整盒在相机背后
  const hull = clipToRect(convexHull(pts), view.width, view.height);
  if (hull.length < 3) return 0;
  return Math.abs(shoelace(hull)) / (view.width * view.height);
}

// ---------- WP11/R1 控制层镜头：视图参数与画面内判定（口径见 docs/CONTROL-PASSES.md） ----------
// Blender 相机（sensor_fit AUTO、横幅 → 水平传感器宽）焦距 → three.js 口径的竖直 fov 视图参数。
// 与 render-control-passes.py write_camera_json 同式：fovY = 2·atan(sensorW·H/W / 2f)。
export function viewFromLens(lensMm = 50, width = 1280, height = 720, sensorWMm = 36) {
  const fovY = 2 * Math.atan(sensorWMm * height / width / (2 * lensMm));
  return { fovDeg: fovY * 180 / Math.PI, width, height, lensMm };
}
// 世界点 → 画面像素 [px, py, 视轴深度]；在相机背后（深度 ≤ 0.05）返回 null
export function projectPoint(p, cam, look, view = VIEW) {
  const f = norm3(sub3(look, cam));
  const r = norm3(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub3(p, cam);
  const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2], y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z <= 0.05) return null;
  const tanY = Math.tan((view.fovDeg / 2) * Math.PI / 180), tanX = tanY * (view.width / view.height);
  return [(x / (z * tanX) * 0.5 + 0.5) * view.width, (-y / (z * tanY) * 0.5 + 0.5) * view.height, z];
}
export function inFrame(p, cam, look, view = VIEW) {
  const q = projectPoint(p, cam, look, view);
  return !!q && q[0] >= 0 && q[0] <= view.width && q[1] >= 0 && q[1] <= view.height;
}
// 9 采样点里「在画面内且视线不被碰撞盒挡」的点数（visiblePointCount 只查遮挡，画外的点也算可见）
export function framedVisiblePointCount(boxes, cam, look, box, view = VIEW) {
  let vis = 0;
  for (const p of boxPoints(box)) if (inFrame(p, cam, look, view) && !segBlocked(boxes, cam, p, [box.id])) vis++;
  return vis;
}
// 凸多边形裁到 [0,W]×[0,H]（Sutherland–Hodgman，四条轴对齐边）
function clipToRect(poly, W, H) {
  const edges = [[0, 0, 1], [0, W, -1], [1, 0, 1], [1, H, -1]]; // [轴, 界, 保留侧符号]
  let out = poly;
  for (const [ax, lim, sg] of edges) {
    const src = out; out = [];
    if (!src.length) break;
    const inside = (q) => sg * (q[ax] - lim) >= 0;
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (lim - a[ax]) / (b[ax] - a[ax]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return out;
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function shoelace(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; }
  return s / 2;
}
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (src) => {
    const st = [];
    for (const q of src) {
      while (st.length >= 2 && (st[st.length - 1][0] - st[st.length - 2][0]) * (q[1] - st[st.length - 2][1]) - (st[st.length - 1][1] - st[st.length - 2][1]) * (q[0] - st[st.length - 2][0]) <= 0) st.pop();
      st.push(q);
    }
    return st;
  };
  return [...half(p), ...half(p.reverse()).slice(1, -1)];
}

// 点到最近「可遮挡」碰撞盒的 3D 距离（顶 < eyeY 的矮挡墙不参与——挡不住站立视线；
// 忽略 ignoreIds，返回 { dist, name }，点在盒内时 dist=0）。
export function nearestColliderDist(boxes, p, { eyeY = 1.6, ignoreIds = [] } = {}) {
  let best = { dist: Infinity, name: null };
  for (const bx of boxes) {
    if (ignoreIds.includes(bx.id) || bx.topY < eyeY) continue;
    if (p[0] < bx.aabb.x0 - best.dist || p[0] > bx.aabb.x1 + best.dist) continue;
    if (p[2] < bx.aabb.z0 - best.dist || p[2] > bx.aabb.z1 + best.dist) continue;
    const wx = p[0] - bx.center[0], wy = p[1] - bx.center[1], wz = p[2] - bx.center[2];
    const lx = bx.cos * wx - bx.sin * wz, ly = wy, lz = bx.sin * wx + bx.cos * wz;
    const qx = Math.max(-bx.half[0], Math.min(bx.half[0], lx));
    const qy = Math.max(-bx.half[1], Math.min(bx.half[1], ly));
    const qz = Math.max(-bx.half[2], Math.min(bx.half[2], lz));
    const d = Math.hypot(lx - qx, ly - qy, lz - qz);
    if (d < best.dist) best = { dist: d, name: bx.name };
  }
  return best;
}

// ---------- wave4-touranchor：锚点街景画面几何代理（生成器选位 + tour-test 断言共用；真值在 tests/tour-render-check.mjs 渲染复核） ----------
// 碰撞盒只有墙体（无屋面/檐），所以代理的天空偏多、目标偏少——是渲染口径的保守近似。
// 场景：碰撞盒（loadColliders，按 id 归属 layout 对象）+ 没有碰撞记录的建筑类 layout footprint 竖直棱柱（外围建筑等，高 = layout height）+ 地面 y=0。
// 画面按 GRID 网格发射视线（同 VIEW 相机式），每条视线取最近命中：
//   无命中 → 天空；地面 → 落在街廊盒（2D + pad）内为目标；
//   竖直面 → 建筑类（facadeSet）且落在立面带盒内为目标；命中点落在街廊盒体积内（街上的摊位等）也算目标；距相机 < NEAR_M 为近景墙；
// 近景墙在画面下 1/3 行内取 4-连通最大区。返回 {target, sky, nearMax}（均为占比）。
export const PROXY_GRID = { nx: 70, ny: 45, farM: 400 };
// 店屋实例（layout.instances 里 module = shop-*，锚 = shopAnchor）没有碰撞记录：按 resources/shops/<module>/measurements.json
// 的 frontageM × depthM × eaveM 做竖直棱柱（原点 = 前墙中点地面，立面朝局部 +Z，进深 −Z；与 GLB axis 声明一致）。
// 过街楼/骑楼式通道顶棚：管线产物 OUT/layout.json 的 reviewRepair.passages（repair-layout.py 从冻结源生成）——
// 每段通道矩形在 clearHeight 高度有顶棚（build-scene cutPassages + passageHeight 顶面）。视线向上穿过该高度且落在矩形内 = 命中顶棚（朝下面，非目标）。
export function passageCeilings(outLayout) {
  const out = [];
  for (const p of outLayout?.reviewRepair?.passages || []) for (const r of p.rectangles || []) out.push({ poly: r, y: p.clearHeight ?? 3.5 });
  return out;
}
// 被通道穿过的建筑：通道高度（passageHeight）以上仍是实体楼身——竖直棱柱 y ∈ [passageHeight, height]（碰撞盒只到地面层墙体）
export function passageMasses(outLayout) {
  return (outLayout?.objects || []).filter(o => o.geometry?.passageHeight && o.geometry.footprint)
    .map(o => ({ id: o.id, fp: o.geometry.footprint, y0: o.geometry.passageHeight, h: o.height || 6 }));
}
export function makeStreetViewScene(boxes, layout, { zones = null, areaRoot = null, ceilings = [], masses = [] } = {}) {
  const fac = new Set(facadeIds(layout));
  const haveColl = new Set(boxes.map(b => b.id));
  const prisms = [];
  for (const m of masses) {
    const xs = m.fp.map(q => q[0]), zs = m.fp.map(q => q[1]);
    prisms.push({ id: m.id, fp: m.fp, y0: m.y0, h: m.h, aabb: { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } });
  }
  if (areaRoot) {
    for (const inst of layout.instances || []) {
      if (!/^shop-/.test(inst.module || '') || haveColl.has(inst.id)) continue;
      const mf = path.join(areaRoot, 'resources', 'shops', inst.module, 'measurements.json');
      if (!fs.existsSync(mf)) continue;
      const d = JSON.parse(fs.readFileSync(mf, 'utf8')).design || {};
      if (!d.frontageM || !d.depthM) continue;
      const ry = inst.rotY || 0, zx = Math.sin(ry), zz = Math.cos(ry), xx = Math.cos(ry), xz = -Math.sin(ry);
      const [ox, oz] = inst.position, hw = d.frontageM / 2, dp = d.depthM;
      const fp = [[-hw, 0], [hw, 0], [hw, -dp], [-hw, -dp]].map(([lx, lz]) => [ox + xx * lx + zx * lz, oz + xz * lx + zz * lz]);
      const xs = fp.map(q => q[0]), zs = fp.map(q => q[1]);
      prisms.push({ id: inst.id, fp, h: d.eaveM || 6.8, aabb: { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } });
    }
  }
  for (const o of layout.objects) {
    if (!FACADE_KINDS.has(o.kind) || !o.geometry?.footprint || haveColl.has(o.id)) continue;
    if (zones && !zones.includes(o.zone)) continue;
    const fp = o.geometry.footprint, h = o.height || 6;
    const xs = fp.map(p => p[0]), zs = fp.map(p => p[1]);
    prisms.push({ id: o.id, fp, h, aabb: { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } });
  }
  return { boxes, prisms, fac, ceilings };
}
// 视线与 OBB 的进入距离（在盒外起点）；返回 {t, vertical} 或 null
function rayBox(o, d, bx) {
  const wx = o[0] - bx.center[0], wy = o[1] - bx.center[1], wz = o[2] - bx.center[2];
  const ox = bx.cos * wx - bx.sin * wz, oy = wy, oz = bx.sin * wx + bx.cos * wz;
  const rx = bx.cos * d[0] - bx.sin * d[2], ry = d[1], rz = bx.sin * d[0] + bx.cos * d[2];
  let t0 = -Infinity, t1 = Infinity, ax = -1;
  const sl = [[ox, rx, bx.half[0]], [oy, ry, bx.half[1]], [oz, rz, bx.half[2]]];
  for (let i = 0; i < 3; i++) {
    const [p, r, h] = sl[i];
    if (Math.abs(r) < 1e-12) { if (Math.abs(p) > h) return null; continue; }
    let u0 = (-h - p) / r, u1 = (h - p) / r;
    if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    if (u0 > t0) { t0 = u0; ax = i; }
    t1 = Math.min(t1, u1);
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  if (t0 < 0) return { t: 0, vertical: true }; // 起点在盒内
  return { t: t0, vertical: ax !== 1 };
}
function rayPrism(o, d, pr) {
  let best = Infinity;
  const fp = pr.fp, n = fp.length;
  for (let i = 0; i < n; i++) {
    const a = fp[i], b = fp[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const den = d[0] * ez - d[2] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const qx = a[0] - o[0], qz = a[1] - o[2];
    const t = (qx * ez - qz * ex) / den, u = (qx * d[2] - qz * d[0]) / den;
    if (t <= 1e-6 || u < 0 || u > 1 || t >= best) continue;
    const y = o[1] + d[1] * t;
    if (y >= (pr.y0 || 0) && y <= pr.h) best = t;
  }
  return best;
}
function pointInPoly2(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const inObb2 = (box, p, pad = 0) => {
  const dx = p[0] - box.center[0], dy = p[1] - box.center[1], dz = p[2] - box.center[2];
  const c = Math.cos(box.yaw || 0), s = Math.sin(box.yaw || 0);
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  return Math.abs(lx) <= box.half[0] + pad && Math.abs(dy) <= box.half[1] + pad && Math.abs(lz) <= box.half[2] + pad;
};
export function streetViewProxy(scene, cam, look, corridor, band, { grid = PROXY_GRID, view = VIEW, pad = 0.25, debug = false } = {}) {
  const f = norm3(sub3(look, cam)), r = norm3(cross(f, [0, 1, 0])), u = cross(r, f);
  const tanY = Math.tan((view.fovDeg / 2) * Math.PI / 180), tanX = tanY * (view.width / view.height);
  const R = grid.farM;
  // 方位角分桶加速（1° 一桶，相对视轴水平方位）：每个盒/棱柱按其 2D 角点相对相机的方位区间入桶，视线只查所在桶
  const yaw0 = Math.atan2(f[2], f[0]);
  const relAz = (x, z) => { let a = Math.atan2(z - cam[2], x - cam[0]) - yaw0; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const NB = 360, bucket = Array.from({ length: NB }, () => ({ b: [], p: [] }));
  const binOf = (a) => Math.min(NB - 1, Math.max(0, Math.floor((a + Math.PI) / (2 * Math.PI) * NB)));
  const insert = (corners, item, key) => {
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of corners) { const a = relAz(x, z); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    if (hi - lo > Math.PI) { for (const bk of bucket) bk[key].push(item); return; } // 跨背后/包住相机：全桶
    for (let k = binOf(lo); k <= binOf(hi); k++) bucket[k][key].push(item);
  };
  for (const b of scene.boxes) {
    if (b.aabb.x1 < cam[0] - R || b.aabb.x0 > cam[0] + R || b.aabb.z1 < cam[2] - R || b.aabb.z0 > cam[2] + R) continue;
    const [hx, , hz] = b.half, c = b.cos, sn = b.sin;
    const cn = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => [b.center[0] + c * lx + sn * lz, b.center[2] - sn * lx + c * lz]);
    const inside = Math.abs(c * (cam[0] - b.center[0]) - sn * (cam[2] - b.center[2])) <= hx && Math.abs(sn * (cam[0] - b.center[0]) + c * (cam[2] - b.center[2])) <= hz;
    if (inside) { for (const bk of bucket) bk.b.push(b); continue; }
    insert(cn, b, 'b');
  }
  for (const p of scene.prisms) {
    if (p.aabb.x1 < cam[0] - R || p.aabb.x0 > cam[0] + R || p.aabb.z1 < cam[2] - R || p.aabb.z0 > cam[2] + R) continue;
    insert(p.fp, p, 'p');
  }
  const { nx, ny } = grid;
  let tgt = 0, sky = 0, soffit = 0;
  const near = new Uint8Array(nx * ny);
  const cls = debug ? new Array(nx * ny).fill('') : null; // 调试：逐格分类
  for (let j = 0; j < ny; j++) {
    const sy = 1 - (2 * (j + 0.5)) / ny; // j=0 画面顶
    for (let i = 0; i < nx; i++) {
      const sx = (2 * (i + 0.5)) / nx - 1;
      const d = norm3([f[0] + r[0] * sx * tanX + u[0] * sy * tanY, f[1] + r[1] * sx * tanX + u[1] * sy * tanY, f[2] + r[2] * sx * tanX + u[2] * sy * tanY]);
      let bestT = d[1] < -1e-9 ? cam[1] / -d[1] : Infinity, kind = bestT < Infinity ? 'ground' : 'sky', hitId = null, vertical = false;
      const bk = bucket[binOf(relAz(cam[0] + d[0], cam[2] + d[2]))];
      const boxes = bk.b, prisms = bk.p;
      for (const bx of boxes) {
        const h = rayBox(cam, d, bx);
        if (h && h.t < bestT) { bestT = h.t; kind = 'box'; hitId = bx.id; vertical = h.vertical; }
      }
      for (const pr of prisms) {
        const t = rayPrism(cam, d, pr);
        if (t < bestT) { bestT = t; kind = 'prism'; hitId = pr.id; vertical = true; }
      }
      if (d[1] > 1e-9) for (const cl of scene.ceilings) { // 通道顶棚（朝下面）
        const t = (cl.y - cam[1]) / d[1];
        if (t <= 0 || t >= bestT) continue;
        if (pointInPoly2([cam[0] + d[0] * t, cam[2] + d[2] * t], cl.poly)) { bestT = t; kind = 'ceiling'; hitId = null; vertical = false; }
      }
      if (kind === 'ceiling') { soffit++; if (cls) cls[j * nx + i] = 'C'; continue; }
      if (kind === 'sky' || bestT > R) { if (d[1] >= 0) { sky++; if (cls) cls[j * nx + i] = ' '; continue; } }
      const p = [cam[0] + d[0] * bestT, cam[1] + d[1] * bestT, cam[2] + d[2] * bestT];
      let isT = inObb2(corridor, p, pad);
      if (!isT && vertical && hitId && scene.fac.has(hitId) && inObb2(band, p)) isT = true;
      if (isT) tgt++;
      if (kind !== 'ground' && vertical && bestT < STREET_VIEW.NEAR_M) near[j * nx + i] = 1;
      if (cls) cls[j * nx + i] = isT ? 'T' : kind === 'ground' ? '.' : vertical ? 'w' : 'h';
    }
  }
  // 画面下 1/3 行的近景墙 4-连通最大区
  const j0 = ny - Math.floor(ny / 3), rows = ny - j0, seen = new Uint8Array(nx * ny);
  let best = 0;
  for (let j = j0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k0 = j * nx + i;
    if (!near[k0] || seen[k0]) continue;
    const st = [k0]; seen[k0] = 1; let n = 0;
    while (st.length) {
      const k = st.pop(); n++;
      const x = k % nx, y = (k - x) / nx;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (xx < 0 || xx >= nx || yy < j0 || yy >= ny) continue;
        const q = yy * nx + xx;
        if (near[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    best = Math.max(best, n);
  }
  const out = { target: tgt / (nx * ny), sky: sky / (nx * ny), soffit: soffit / (nx * ny), nearMax: best / (nx * rows) };
  if (cls) out.grid = Array.from({ length: ny }, (_, j) => cls.slice(j * nx, (j + 1) * nx).join(''));
  return out;
}
