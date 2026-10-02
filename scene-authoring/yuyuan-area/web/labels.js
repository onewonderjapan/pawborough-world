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

// wave13-tourfix U2（巡检报告第 16 条）：个别标签的锚点高度偏移（查看器侧取景修正，不动 layout 数据/几何）。
// 默认锚高 4 m（main.js drawLabels 同值）正落在城隍庙门楣匾额板面（temple.glb plaque-face 网格实测
// 山门匾 y 3.9–4.8、仪门横匾 y 3.7–4.0），「山门」「仪门」chip 因此压住匾额文字（pv02/pv03 实拍）。
// 山门 2.9 m：chip 落在门楣以下的门洞留白处。
// 仪门 1.6 m：R1 必修1——2.6 m 时 pv03 中 chip 与「大殿」（prio 0，同轴竖排 sy≈604–625）重叠被挤掉；
// 「后殿」chip 紧随其下（sy≈636–658），两圈之间放不下第三个 chip，再降到门洞内 1.6 m（实测 sy≈672–697，
// 避开两圈；pv02 亦由被「大殿」挤掉变为可见；拆分匾面后门洞空隙无保留区，见 labels.js R1 必修2）。
export const LABEL_ANCHOR_Y = { '山门': 2.9, '仪门': 1.6 };
export const LABEL_ANCHOR_Y_DEFAULT = 4;
// chip 视口内收（报告第 16 条：tour-huabaolou 左下角「信大祥」chip 被视口裁半）。
// 锚点在视口内时把 chip 矩形（transform: translate(-50%,-130%) 口径，同 rectOf）钳回视口；
// 返回 null 表示锚点已出视口——chip 属于不在画内的对象，交由调用方隐藏，避免悬半截的裁切残留。
export function clampChipIntoViewport(el, x, y, vw, vh) {
  const { w, h } = sizeOf(el);
  if (x < 0 || x > vw || y < 0 || y > vh) return null;
  const cx = Math.min(Math.max(x, w / 2 + PAD), vw - w / 2 - PAD);
  const cy = Math.min(Math.max(y, h * 1.3 + PAD), vh + h * 0.3 - PAD);
  return { x: cx, y: cy };
}

// ---------- playtest-remnants 20261002 工单 A：取景/游玩画面里的玩家剪影保留区 ----------
// 世界包围盒 8 角经 project(x,y,z)→[sx,sy] 投影后的屏幕外接矩形（含 margin px 外扩）。
// pure：main.js 传相机投影闭包，node 测试传桩投影器（tests/play_photo_labels.test.mjs）。
// 调用方每帧只投影 8 个角（玩家剪影尺寸一次性缓存），无逐帧网格遍历。
export function rectFromWorldBox(project, corners, margin = 4) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of corners) {
    const s = project(p[0], p[1], p[2]);
    if (!s || s[2] > 1) return null;   // 任一角在相机后方 → 不建保留区（玩家不在画内/被裁）
    x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]);
    y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]);
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
}

function sizeOf(el) {
  let s = sizeCache.get(el);
  if (!s) { s = { w: el.offsetWidth, h: el.offsetHeight }; sizeCache.set(el, s); }
  return s;
}

// ---------- wave13-tourfix R1 必修2：匾额整组网格 → 独立匾面 ----------
// 巡检 R1：按材质合并的仪门匾额盒横跨左右两块匾之间的门洞空隙（x ±5.3 m 各一块匾、中间 ~6 m 空），
// 保护范围远大于文字区。这里按三角形质心连通性把一块匾额网格拆成独立匾面：质心间距 ≤ PLAQUE_LINK_M
// 视为同一匾面（单块匾 ~2.2 m 宽、三角形间距远小于它；两匾间隙 > 6 m 远大于它），viewer（web/main.js
// prepare 收集 plaqueBoxes）与 headless 检查（tests/tour-label-chip-check.mjs 自解析 GLB）共用同一实现。
// centroids: 长度 3n 的展平三角形质心（局部坐标）；返回长度 n 的簇号数组。
// PLAQUE_LINK_M=3.0 实测依据：同一块匾的边框条/饰条与主体之间空档可达 ~3 m（dadian 边框条 x≈±2.26
// 与内饰条 x≈±0.74，条间 ~1.5 m、框-饰条间 ~1.5 m），须连成一块；仪门左右两匾间隙 ~6.2 m
// （质心最近距 ≈6.2 m），3.0 m 仍稳分两侧。
export const PLAQUE_LINK_M = 3.0;
export function clusterTriangleFaces(centroids, n, linkDist = PLAQUE_LINK_M) {
  const label = new Int32Array(n).fill(-1);
  // 网格哈希（cell = linkDist）找近邻对，n ≤ ~1100 三角形，一次加载只算一遍
  const cell = new Map();
  const key = (i, j, k) => i + ',' + j + ',' + k;
  for (let t = 0; t < n; t++) {
    const k = key(Math.floor(centroids[t * 3] / linkDist), Math.floor(centroids[t * 3 + 1] / linkDist), Math.floor(centroids[t * 3 + 2] / linkDist));
    (cell.get(k) || cell.set(k, []).get(k)).push(t);
  }
  const find = (t) => { while (label[t] >= 0 && label[t] !== t) t = label[t]; return t; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) label[Math.max(a, b)] = Math.min(a, b); };
  for (let t = 0; t < n; t++) label[t] = t;
  const d2 = linkDist * linkDist;
  for (let t = 0; t < n; t++) {
    const cx = Math.floor(centroids[t * 3] / linkDist), cy = Math.floor(centroids[t * 3 + 1] / linkDist), cz = Math.floor(centroids[t * 3 + 2] / linkDist);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const bucket = cell.get(key(cx + i, cy + j, cz + k));
      if (!bucket) continue;
      for (const u of bucket) {
        if (u <= t) continue;
        const dx = centroids[t * 3] - centroids[u * 3], dy = centroids[t * 3 + 1] - centroids[u * 3 + 1], dz = centroids[t * 3 + 2] - centroids[u * 3 + 2];
        if (dx * dx + dy * dy + dz * dz <= d2) union(t, u);
      }
    }
  }
  const remap = new Map();
  const roots = new Int32Array(n);
  for (let t = 0; t < n; t++) roots[t] = find(t); // 先取全部根，再重映射（直接边 find 边覆写 label 会污染父链）
  for (let t = 0; t < n; t++) {
    if (!remap.has(roots[t])) remap.set(roots[t], remap.size);
    label[t] = remap.get(roots[t]);
  }
  return label;
}
// 匾面文字板的朝向（局部坐标）：文字板是从挂装面向外挤出的薄盒，薄轴 = 包围盒最短边；
// 文字面在外伸一侧（本资产组匾额板全部从 z≈0 挂装面向 +薄轴 挤出，如 yimen 板 z∈[0, 0.10]）。
// 返回带符号的单位轴向量；配合节点世界变换得到世界朝向，用于「背向相机的匾面不建保留区」。
export function plaqueFaceAxis(lo, hi) {
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const ax = ext[0] < ext[1] ? (ext[0] < ext[2] ? 0 : 2) : (ext[1] < ext[2] ? 1 : 2);
  const dir = [0, 0, 0];
  dir[ax] = (lo[ax] + hi[ax]) / 2 >= 0 ? 1 : -1;
  return dir;
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
// opts: { occluders, cam, tourActive, reserved, playerRect } —— R1/T2 遮挡剔除与导览机位距离上限；
//   wave13-tourfix U2：reserved = 匾额文字区的屏幕矩形集（main.js 从 temple GLB plaque-face* 网格
//   收集世界盒后逐帧投影），与保留区相交的 chip 一律隐藏——匾额文字不许被任何 chip 盖住
//   （巡检报告第 16 条：山门/仪门 chip 压匾；修复后前院/仪门戏楼 chip 顶替占位同罪，一并按此拦）。
//   playtest-remnants 20261002 工单 A：playerRect = 玩家/坐骑剪影的屏幕矩形（main.js 由控制器脚点 +
//   一次性缓存的角色剪影尺寸投影 8 角得来），游玩/取景画面里压在主角身上的 chip 一律隐藏
//   （BUG-PLAYTEST-007：区域级标签糊在猫头）；与匾额区同口径——优先级无关，不让位。
// 处理顺序 = prio 升序（region/landmark 先占位）；与已放置矩形相交的后到者隐藏；
// 非区域标签超出 CAP 时按 (prio, 距离) 保留前 CAP 个。
// 返回 {hidden, overlaps, occludedHidden, occludedGhost, distCapHidden, reservedHidden, playerHidden, maxVisibleDist}。
export function dedupeLabels(items, w, h, facilityCap = FACILITY_CAP, opts = {}) {
  const { occluders, cam, tourActive, reserved, playerRect } = opts;
  let occludedHidden = 0, occludedGhost = 0, distCapHidden = 0, reservedHidden = 0, playerHidden = 0, maxVisibleDist = 0;
  const kept = [];
  for (const it of items) {
    // R1：导览机位下距离上限 120 m
    if (tourActive && it.dist > TOUR_MAX_DIST) {
      it.el.style.visibility = 'hidden';
      it.el.style.opacity = '';
      distCapHidden++;
      continue;
    }
    // 工单 A：压玩家/坐骑剪影的 chip 一律隐藏（优先级无关）
    if (playerRect) {
      const r = rectOf(it);
      if (intersects(r, playerRect)) {
        it.el.style.visibility = 'hidden';
        it.el.style.opacity = '';
        playerHidden++;
        continue;
      }
    }
    // wave13-tourfix U2：压匾额文字区的 chip 一律隐藏（优先级无关——匾额不是 chip，不让位）
    if (reserved && reserved.length) {
      const r = rectOf(it);
      if (reserved.some(q => intersects(r, q))) {
        it.el.style.visibility = 'hidden';
        it.el.style.opacity = '';
        reservedHidden++;
        continue;
      }
    }
    // R1：视线被碰撞盒挡住 → 隐藏；区域级/地标（prio ≤ 1，含 GOAL fallback 受保护地标
    // 三穗堂/老城隍庙/华宝楼——华宝楼同时是 REGION_LABELS，prio=0）改半透明保留
    if (occluders && occluders.length && cam && it.wpos) {
      const blocker = segBlockedByOccluders(occluders, cam, it.wpos);
      if (blocker) {
        if (it.prio <= 1) { it.el.style.opacity = GHOST_OPACITY; occludedGhost++; }
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
  return { hidden, overlaps, occludedHidden, occludedGhost, distCapHidden, reservedHidden, playerHidden, maxVisibleDist: +maxVisibleDist.toFixed(1) };
}
export const FACILITY_LABEL_CAP = FACILITY_CAP;
export const TOUR_LABEL_MAX_DIST = TOUR_MAX_DIST;
