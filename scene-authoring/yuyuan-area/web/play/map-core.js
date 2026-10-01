// 小地图 DOM-free 核心（小吃工单 20261001）。从 out/layout.json 派生底图几何，
// 提供世界→图面投影与两种视窗（附近 80m / 全图）。纯函数，节点测试直接驱动；
// 浏览器绘制层在 web/play/minimap.js（静态底图缓存 + 每帧只画动态标记）。
//
// 坐标约定（GOAL.md）：世界 x 向东 = 图面向右，世界 z 向南 = 图面向下。
// layout 的 2D geometry（position/footprint/polyline）就是 [x, z]。

// 附近视图世界窗宽（米）；全图 = layout meta.bounds 适配画布。
export const NEAR_RANGE_M = 80;

// 入图底图的 kind 分层（只取有 footprint / polyline 的真实几何，不造任何占位图形）
const BLOCK_KINDS = new Set([
  'outerBuilding', 'bazaarBlock', 'hall', 'xuan', 'pavilion', 'tower',
  'stage', 'watersideGallery', 'bench',
]);
const PLAZA_KINDS = new Set(['plaza', 'paving']);
const ROAD_KINDS = new Set(['road', 'path']);

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

// 面积过滤：layout 里既有真实 footprint 也有设计占位（如 ground 基底平面），
// 底图只收有意义的多边形，超界/自交退化的整环丢弃。
function usableRing(ring, bounds) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const [x0, z0, x1, z1] = bounds;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2
      || !Number.isFinite(p[0]) || !Number.isFinite(p[1])
      || p[0] < x0 || p[0] > x1 || p[1] < z0 || p[1] > z1) return false;
  }
  return Math.abs(ringArea(ring)) > 1; // <1m² 的碎面不上底图
}

export function collectMapGeometry(layout) {
  const bounds = layout?.meta?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4
    || !bounds.every(Number.isFinite)) throw new Error('map-core: layout.meta.bounds invalid');
  const roads = [], blocks = [], plazas = [], waters = [];
  for (const o of layout.objects ?? []) {
    if (o.skipRender || o.disposition === 'skipped') continue;
    const g = o.geometry ?? {};
    if (ROAD_KINDS.has(o.kind) && Array.isArray(g.polyline) && g.polyline.length >= 2) {
      roads.push({ pts: g.polyline, widthM: Number.isFinite(g.width) ? g.width : 6 });
    } else if (PLAZA_KINDS.has(o.kind) && usableRing(g.footprint, bounds)) {
      plazas.push(g.footprint);
    } else if (o.kind === 'water' && usableRing(g.footprint, bounds)) {
      waters.push(g.footprint);
    } else if (BLOCK_KINDS.has(o.kind) && usableRing(g.footprint, bounds)) {
      blocks.push(g.footprint);
    }
  }
  return { bounds, roads, blocks, plazas, waters };
}

// 视窗：{cx, cz, halfW(世界米/半宽), sizePx}。附近视图以玩家为中心；全图 fit bounds。
export function makeNearView(feet, sizePx, rangeM = NEAR_RANGE_M) {
  if (!Array.isArray(feet) || !feet.every(Number.isFinite)) throw new Error('map-core: feet invalid');
  return { cx: feet[0], cz: feet[2], halfW: rangeM / 2, sizePx, full: false };
}

export function makeFullView(bounds, sizePx) {
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
  return { cx: (bounds[0] + bounds[2]) / 2, cz: (bounds[1] + bounds[3]) / 2, halfW: Math.max(w, h) / 2, sizePx, full: true };
}

// 世界 → 画布 px。等比（x/z 同缩放），超窗返回 null（调用方决定裁剪/钳边）。
export function project(view, x, z) {
  const s = view.sizePx / (view.halfW * 2);
  return [(x - view.cx) * s + view.sizePx / 2, (z - view.cz) * s + view.sizePx / 2, s];
}

// 屏外目标钳到窗缘（只导向不传送）：返回 {x, y, inside}
export function projectClamped(view, x, z) {
  const [px, py] = project(view, x, z);
  const m = 10; // 边缘留白
  const cx = Math.min(view.sizePx - m, Math.max(m, px));
  const cy = Math.min(view.sizePx - m, Math.max(m, py));
  return { x: cx, y: cy, inside: px >= 0 && px <= view.sizePx && py >= 0 && py <= view.sizePx };
}

// 玩家箭头顶点：以朝向 yaw（controller 约定 forward=(-sin,-cos)）为箭头方向。
// 返回 3 个画布点 [尖, 左翼, 右翼]。
export function playerArrow(view, feet, yaw, r = 7) {
  const [px, py] = project(view, feet[0], feet[2]);
  // 世界 -Z 前进方向在图上是 -y；yaw 增大 = 向左转（controller 约定）→ 图上逆时针
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  const nx = -dz, ny = dx; // 左法线（图面系）
  return [
    [px + dx * r, py + dz * r],
    [px - dx * r * 0.7 + nx * r * 0.6, py - dz * r * 0.7 + ny * r * 0.6],
    [px - dx * r * 0.7 - nx * r * 0.6, py - dz * r * 0.7 - ny * r * 0.6],
  ];
}

// 相机/视角提示线终点（短须，从玩家点伸出，长度 = 图上半径 12px）
export function viewTick(view, feet, yaw, len = 12) {
  const [px, py] = project(view, feet[0], feet[2]);
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  return [[px, py], [px + dx * len, py + dz * len]];
}
