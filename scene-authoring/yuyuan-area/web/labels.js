// WP13/T2 标签去重：屏幕空间矩形相交时隐藏低优先级标签（region > landmark > facility > note），
// 非区域标签（landmark+facility）每屏上限 FACILITY_CAP，landmark 永远先于普通设施保留；
// 返回本帧重叠对数（去重后应为 0）供 headless 断言。
// WP13/R1/T2 返修新增：
//   - 遮挡剔除：标签锚点→相机视线被碰撞盒挡住就隐藏（地标除外，改半透明 ghost）；
//   - 导览机位下距离上限 TOUR_MAX_DIST=120 m；
//   - buildLabelOccluders：collision-<zone>.json 的 colliders 记录 → 世界 OBB 集合
//     （obbToWorld 同式变换；module=water-guard 是不可见的防落水护栏，不参与视觉遮挡）。
// web/main.js 只在 drawLabels 里调用 dedupeLabels / buildLabelOccluders —— 逻辑集中在本文件方便合并。

const FACILITY_CAP = 12;
const PAD = 2;          // 矩形外扩 px，宁严勿漏
const TOUR_MAX_DIST = 120; // R1：导览机位下标签距离上限（m）
const GHOST_OPACITY = '0.45'; // R1：地标被挡时的半透明
const sizeCache = new WeakMap();

function sizeOf(el) {
  let s = sizeCache.get(el);
  if (!s) { s = { w: el.offsetWidth, h: el.offsetHeight }; sizeCache.set(el, s); }
  return s;
}
// .lbl 的 transform 为 translate(-50%,-130%)：left/top 锚点在标签盒底部中心
function rectOf(it) {
  const { w, h } = sizeOf(it.el);
  return { x0: it.x - w / 2 - PAD, y0: it.y - h * 1.3 - PAD, x1: it.x + w / 2 + PAD, y1: it.y - h * 0.3 + PAD };
}
const intersects = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
const onScreen = (r, w, h) => r.x1 > 0 && r.x0 < w && r.y1 > 0 && r.y0 < h;

// ---------- R1/T2 遮挡集 ----------
// records: 各 collision-<zone>.json 的 colliders 拼接。返回世界 OBB 数组（含世界 AABB 供快速排除）。
export function buildLabelOccluders(records) {
  const out = [];
  for (const rec of records || []) {
    if (!rec || rec.module === 'water-guard') continue;
    const obb = rec.obb;
    let cx, cy, cz, hx, hy, hz, yaw;
    if (obb) {
      const c = Math.cos(obb.theta), s = Math.sin(obb.theta);
      cx = obb.pos[0] + c * obb.center[0] + s * obb.center[2];
      cz = obb.pos[2] - s * obb.center[0] + c * obb.center[2];
      cy = obb.center[1] + (obb.pos[1] ?? 0);
      hx = obb.size[0] / 2; hy = obb.size[1] / 2; hz = obb.size[2] / 2;
      yaw = obb.theta;
    } else if (rec.min && rec.max) {
      cx = (rec.min[0] + rec.max[0]) / 2; cy = (rec.min[1] + rec.max[1]) / 2; cz = (rec.min[2] + rec.max[2]) / 2;
      hx = (rec.max[0] - rec.min[0]) / 2; hy = (rec.max[1] - rec.min[1]) / 2; hz = (rec.max[2] - rec.min[2]) / 2;
      yaw = 0;
    } else continue;
    const ac = Math.abs(Math.cos(yaw)), as = Math.abs(Math.sin(yaw));
    out.push({
      name: rec.name, center: [cx, cy, cz], half: [hx, hy, hz], yaw, cos: Math.cos(yaw), sin: Math.sin(yaw),
      aabb: { x0: cx - (ac * hx + as * hz), x1: cx + (ac * hx + as * hz), y0: cy - hy, y1: cy + hy, z0: cz - (as * hx + ac * hz), z1: cz + (as * hx + ac * hz) },
    });
  }
  return out;
}
// 线段 a→b 是否穿过某个 OBB（端点不计；滑块法，局部坐标同 obbToWorld 旋转变换）
export function segBlockedByOccluders(occluders, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  for (const bx of occluders) {
    const bb = bx.aabb;
    if ((a[0] < bb.x0 && b[0] < bb.x0) || (a[0] > bb.x1 && b[0] > bb.x1)) continue;
    if ((a[2] < bb.z0 && b[2] < bb.z0) || (a[2] > bb.z1 && b[2] > bb.z1)) continue;
    if ((a[1] < bb.y0 && b[1] < bb.y0) || (a[1] > bb.y1 && b[1] > bb.y1)) continue;
    const wx = a[0] - bx.center[0], wy = a[1] - bx.center[1], wz = a[2] - bx.center[2];
    const ox = bx.cos * wx - bx.sin * wz, oy = wy, oz = bx.sin * wx + bx.cos * wz;
    const rx = bx.cos * dx - bx.sin * dz, ry = dy, rz = bx.sin * dx + bx.cos * dz;
    let t0 = 0, t1 = 1, hit = true;
    const slab = (o, r, h) => {
      if (Math.abs(r) < 1e-12) { if (Math.abs(o) > h) hit = false; return; }
      let u0 = (-h - o) / r, u1 = (h - o) / r;
      if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) hit = false;
    };
    slab(ox, rx, bx.half[0]); if (!hit) continue;
    slab(oy, ry, bx.half[1]); if (!hit) continue;
    slab(oz, rz, bx.half[2]); if (!hit) continue;
    if (t1 > 1e-6 && t0 < 1 - 1e-6 && t1 - t0 > 1e-6) return bx.name;
  }
  return null;
}

// items: [{el, prio(0=region,1=landmark,2=facility,3=note), x, y, dist, wpos?}]，x/y 为已设置的 left/top。
// wpos = 标签世界锚点 [x,4,z]（main.js drawLabels 投影用同一高度）；无 wpos 的条目不做遮挡判定。
// opts: { occluders, cam:[x,y,z], tourActive } —— R1/T2 遮挡剔除与导览机位距离上限。
// 处理顺序 = prio 升序（region/landmark 先占位）；与已放置矩形相交的后到者隐藏；
// 非区域标签超出 CAP 时按 (prio, 距离) 保留前 CAP 个。
// 返回 {hidden, overlaps, occludedHidden, occludedGhost, distCapHidden, maxVisibleDist}。
export function dedupeLabels(items, w, h, facilityCap = FACILITY_CAP, opts = {}) {
  const { occluders, cam, tourActive } = opts;
  let occludedHidden = 0, occludedGhost = 0, distCapHidden = 0, maxVisibleDist = 0;
  const kept = [];
  for (const it of items) {
    // R1：导览机位下距离上限 120 m
    if (tourActive && it.dist > TOUR_MAX_DIST) {
      it.el.style.visibility = 'hidden';
      it.el.style.opacity = '';
      distCapHidden++;
      continue;
    }
    // R1：视线被碰撞盒挡住 → 隐藏；地标（prio 1）改半透明保留
    if (occluders && occluders.length && cam && it.wpos) {
      const blocker = segBlockedByOccluders(occluders, cam, it.wpos);
      if (blocker) {
        if (it.prio === 1) { it.el.style.opacity = GHOST_OPACITY; occludedGhost++; }
        else { it.el.style.visibility = 'hidden'; it.el.style.opacity = ''; occludedHidden++; continue; }
      } else {
        it.el.style.opacity = '';
      }
    }
    maxVisibleDist = Math.max(maxVisibleDist, it.dist);
    kept.push(it);
  }
  const lab = kept.filter(i => i.prio >= 1).sort((a, b) => (a.prio - b.prio) || (a.dist - b.dist));
  const capHide = new Set(lab.slice(facilityCap).map(i => i.el));
  const order = [...kept].sort((a, b) => a.prio - b.prio);
  const placed = [];
  let hidden = 0;
  for (const it of order) {
    if (capHide.has(it.el)) { it.el.style.visibility = 'hidden'; hidden++; continue; }
    const r = rectOf(it);
    if (!onScreen(r, w, h)) continue; // 屏外标签由 overflow:hidden 裁剪，不参与占位
    const clash = placed.find(q => intersects(r, q.rect));
    if (clash && it.prio >= clash.prio) { it.el.style.visibility = 'hidden'; hidden++; continue; }
    placed.push({ el: it.el, prio: it.prio, rect: r });
  }
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++)
      if (intersects(placed[i].rect, placed[j].rect)) overlaps++;
  return { hidden, overlaps, occludedHidden, occludedGhost, distCapHidden, maxVisibleDist: +maxVisibleDist.toFixed(1) };
}
export const FACILITY_LABEL_CAP = FACILITY_CAP;
export const TOUR_LABEL_MAX_DIST = TOUR_MAX_DIST;
