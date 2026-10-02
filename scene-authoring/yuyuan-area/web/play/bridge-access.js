// 桥头通行补丁（playtest-remnants 20261002 工单 A）——九曲桥 street→bridge 可达性。
//
// 诊断结论（对 out-zone 真实布局/碰撞 + 真实 WalkController 复现，见 outbox ROOT-CAUSE.md）：
// 地面抽取与踏步本身正确（踏面 0.04→0.55 每级 0.1275 ≤ autostep 0.15），西南岸道正面上桥
// 双向可行；报告的三处缺陷都在碰撞/引导侧：
//   1) 水面护栏在桥跨水开口（water 环边，设计上无护栏）相邻处的端帽压进桥头 —— 胶囊
//      (r0.28+半厚0.1) 需 0.38 m 净距，端帽距可见桥面起点仅 0.30 m，站上桥头即撞隐形墙；
//   2) 台阶北/东北面是 0.51 m 直立面（高于 autostep，属"正确的墙"），自然走近方向无可爬线；
//   3) 跨水开口段的岸线除桥口外无护栏，沿岸南下有落水凹口。
//
// 全部从当前 layout + collision 记录推导（不发明坐标；不改 GLB / 碰撞产物 / 池体 / 桥本体）：
//   trims —— 与桥面落点相邻的护栏端帽沿自身轴线缩短 CAP_RETREAT_M；
//   lips  —— 跨水开口在水面侧补 water-guard 同高同厚的隐形唇墙，只留桥口
//            （桥半宽+胶囊半径+余量），落水防护不弱于原链；
//   steps —— 西桥头按既有 layout steps 记录同规格（级数/踏面高/顶高）补一小段可爬踏步，
//            渲染与碰撞同尺寸；顶面抬高 STEP_LIFT_M 消与既有桥面的共面闪烁。
// DOM-free：planBridgeAccess / applyAccessPhysics 可被 node 测试直驱（tests/play_bridge_access.test.mjs）。
// 渲染只在 applyAccessVisuals（浏览器 walk.js 桥钩子调用，try/catch 非致命）。

// 与 scripts/export-collision.mjs 水面护栏同规格（GUARD_H / GUARD_THICK）。
export const GUARD_H = 1.2;
export const GUARD_THICK = 0.2;
// 端帽回退：胶囊半径 + 护栏半厚 + 0.10 余量 → 桥头站立/通过不再相交（实测 0.49 m 净距）。
export const CAP_RETREAT_M = 0.48;
// 端帽只有临近桥面落点才回退：端帽到桥折线最近距离阈值。
export const LANDING_NEAR_M = 2.5;
// 桥口半宽 = 桥半宽 + 胶囊半径 + 0.12；唇墙只封开口内其余段。
export const MOUTH_MARGIN_M = 0.12;
// 踏步 slab：厚 0.14 的开放式踏面板（既有台阶体北缘是斜面，实心盒会吞掉既有踏步端头）。
export const STEP_LIFT_M = 0.005;   // 顶面相对既有面抬高量（消共面闪烁；snapToGround 平滑）
export const STEP_TREAD_M = 0.32;   // 踏面进深（既有记录无此字段，取 ≥ 胶囊半径的通行值）
export const STEP_WIDTH_M = 1.6;    // 踏步宽（凹口净宽内；≥2×胶囊直径）
export const STEP_SLAB_M = 0.14;    // slab 厚度（含 5mm 抬升）
export const STEP_AXIS_SHIFT_M = -0.9; // 沿桥轴平移：贴既有台阶体北面、避开水线拐点

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 2D 线段严格相交（共端点/共线不算），返回交点或 null（export-collision.mjs 同判据量级）。
export function segsCross2D(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const t = cross(sub(c, a), s) / denom, u = cross(sub(c, a), r) / denom;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return add(a, scale(r, t));
}
export function distToPolyline(p, poly) {
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], ab = sub(poly[i + 1], a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
    best = Math.min(best, dist2D(p, add(a, scale(ab, t))));
  }
  return best;
}

// ---------- 规划（pure） ----------
// layout: layout.json 对象；collisionZones: [{ zone, records }]；capsuleRadius: play 胶囊半径。
export function planBridgeAccess({ layout, collisionZones, capsuleRadius = 0.28 }) {
  const notes = [];
  const empty = { trims: [], lips: [], steps: null, notes };
  const bridge = (layout.objects || []).find((o) => o.kind === 'zigzagBridge' && Array.isArray(o.geometry?.polyline));
  if (!bridge) { notes.push('no zigzagBridge in layout'); return empty; }
  const BR = bridge.geometry.polyline;
  const bridgeHalf = (Number(bridge.width) || 2.4) / 2;
  const mouthHalf = bridgeHalf + capsuleRadius + MOUTH_MARGIN_M;

  const guardsByName = new Map();
  for (const z of collisionZones || []) {
    for (const rec of z.records || []) {
      if (rec && rec.module === 'water-guard' && /^water-[^:]+:edge-\d+$/.test(rec.name || '')) {
        guardsByName.set(rec.name, { zone: z.zone, rec });
      }
    }
  }
  const waters = (layout.objects || []).filter((o) => o.kind === 'water' && Array.isArray(o.geometry?.footprint) && o.geometry.footprint.length >= 3);

  const trims = [], lips = [];
  for (const water of waters) {
    const ring = water.geometry.footprint.slice();
    if (ring.length >= 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    if (ring.length < 3) continue;
    // 桥穿过该水面的环边 = 设计开口（export-collision.mjs 同判据：桥折线与环边严格相交）
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      let crossing = null;
      for (let j = 0; j + 1 < BR.length && !crossing; j++) crossing = segsCross2D(a, b, BR[j], BR[j + 1]);
      if (!crossing) continue;
      const u = norm(sub(b, a));
      const edgeLen = dist2D(a, b);
      const sX = Math.max(0, Math.min(edgeLen, (crossing[0] - a[0]) * u[0] + (crossing[1] - a[1]) * u[1]));
      // 唇墙：水体形心一侧为水面侧，外偏半厚+2cm（陆地侧 face 贴水线，岸道不被侵占）
      let cx = 0, cz = 0;
      for (const p of ring) { cx += p[0]; cz += p[1]; }
      const toC = sub([cx / ring.length, cz / ring.length], a);
      const side = cross(u, toC) > 0 ? 1 : -1;
      const nLip = scale([u[1], -u[0]], -side);
      const off = GUARD_THICK / 2 + 0.02;
      const zone = zoneOfWater(guardsByName, water.id);
      for (const [s0, s1] of [[0, Math.min(edgeLen, sX - mouthHalf)], [Math.max(0, sX + mouthHalf), edgeLen]]) {
        if (s1 - s0 < 0.35) continue;
        const p0 = add(add(a, scale(u, s0)), scale(nLip, off));
        const p1 = add(add(a, scale(u, s1)), scale(nLip, off));
        lips.push({ water: water.id, zone, name: `water-${water.id}:bridge-access-lip-${lips.length}`, a: p0, b: p1, heightM: GUARD_H, thickM: GUARD_THICK });
        notes.push(`lip on ${water.id} edge-${i}: [${p0.map(v => +v.toFixed(2))}]→[${p1.map(v => +v.toFixed(2))}]`);
      }
      // 端帽回退：开口相邻环边若有护栏且共享顶点临近桥面落点
      for (const nb of [(i - 1 + ring.length) % ring.length, (i + 1) % ring.length]) {
        const shared = nb === (i - 1 + ring.length) % ring.length ? a : b;
        if (distToPolyline(shared, BR) > LANDING_NEAR_M) continue;
        const guard = guardsByName.get(`water-${water.id}:edge-${nb}`);
        if (!guard) { notes.push(`${water.id} edge-${nb}: no guard record (already an opening)`); continue; }
        const fa = ring[nb], fb = ring[(nb + 1) % ring.length];
        const far = dist2D(fa, shared) < dist2D(fb, shared) ? fb : fa;
        const newEnd = sub(shared, scale(norm(sub(shared, far)), CAP_RETREAT_M));
        trims.push({ water: water.id, zone: guard.zone, name: guard.rec.name, keep: far, drop: shared, newEnd, retreatM: CAP_RETREAT_M });
        notes.push(`trim ${guard.rec.name}: end (${shared[0].toFixed(2)},${shared[1].toFixed(2)}) retreats ${CAP_RETREAT_M} m from the bridge landing`);
      }
    }
  }

  const steps = planLandingSteps({ layout, bridge, BR, bridgeHalf });
  return { trims, lips, steps, notes };
}

function zoneOfWater(guardsByName, waterId) {
  const prefix = `water-${waterId}:`;
  for (const [, g] of guardsByName) if (g.rec.name.startsWith(prefix)) return g.zone;
  return null;
}

// 西桥头凹口踏步（工单允许的"小段叠加通行几何，同尺寸渲染+碰撞"）：
// 位置 = 桥起点 P0 + 陆侧法线 N × [桥半宽, 桥半宽+run]，沿桥轴平移 STEP_AXIS_SHIFT_M。
// 级数/踏面高/顶高取自 layout 既有 jiuqu-bridge-step-w 记录；climb 方向 = -N（从凹口走向桥面）。
export function planLandingSteps({ layout, bridge, BR, bridgeHalf }) {
  const stepRec = (layout.objects || []).find((o) => o.id === 'jiuqu-bridge-step-w');
  const p0 = BR[0], p1 = BR[1] || BR[0];
  const D = norm(sub(p1, p0));
  let N = [D[1], -D[0]];
  const water = (layout.objects || []).find((o) => o.kind === 'water' && Array.isArray(o.geometry?.footprint));
  if (water) {
    let cx = 0, cz = 0;
    for (const p of water.geometry.footprint) { cx += p[0]; cz += p[1]; }
    const c = [cx / water.geometry.footprint.length, cz / water.geometry.footprint.length];
    const dPos = dist2D(add(p0, scale(N, bridgeHalf + 1)), c);
    const dNeg = dist2D(add(p0, scale([-N[0], -N[1]], bridgeHalf + 1)), c);
    if (dNeg > dPos) N = [-N[0], -N[1]];   // N 指向离水体形心更远的一侧 = 陆侧
  }
  const bottomY = Number(stepRec?.geometry?.bottomY ?? 0.04);
  const topY = Number(stepRec?.geometry?.topY ?? bridge.deckY ?? 0.55);
  const stepCount = Math.max(2, Number(stepRec?.geometry?.stepCount ?? 4));
  const rise = (topY - bottomY) / stepCount;
  const run = STEP_TREAD_M * stepCount;
  const at = (alongD, alongN) => add(add(p0, scale(D, alongD + STEP_AXIS_SHIFT_M)), scale(N, alongN));
  const boxes = [];
  for (let k = 0; k < stepCount; k++) {   // k=0 最贴桥面（最高），k=stepCount-1 在凹口内（最矮）
    const n0 = bridgeHalf + k * STEP_TREAD_M, n1 = n0 + STEP_TREAD_M;
    const top = topY - k * rise + STEP_LIFT_M;
    // 旋转矩形的四个世界角（不是外接 AABB —— 相邻 AABB 的重叠边缘会形成幻影墙楔住胶囊）
    const c0 = at(-STEP_WIDTH_M / 2, n0), c1 = at(STEP_WIDTH_M / 2, n0);
    const c2 = at(STEP_WIDTH_M / 2, n1), c3 = at(-STEP_WIDTH_M / 2, n1);
    boxes.push({
      corners: [c0, c1, c2, c3],
      y0: top - STEP_SLAB_M, y1: top, top,
    });
  }
  return { bridge: bridge.id, stepCount, topY: topY + STEP_LIFT_M, rise, climb: scale(N, -1), boxes, source: stepRec?.id || null };
}

// ---------- 桥面伸缩缝探测（pure：probe 由调用方注入，浏览器=物理世界射线，测试=同一实现） ----------
// 桥面与湖心亭抱厦地面之间有 0.02 m 设计伸缩缝（huxinting build.py「让桥缝」），缝在地面三角网里
// 是直落 -0.4 的空槽：play 胶囊(r0.28)支撑探测过缝即 unsupported 卡死（viewer r0.35 跨得过去，
// 所以旧 walkin 检查没暴露）。桥折线在抱厦前偏出门口线（pt9 u=0.59），所以探测路径 = 桥折线
// + 门口进出线（porchApproachPath：桥折线∩抱厦纵轴线 → 门前点 → 抱厦内点，与
// tests/huxinting-walkin-check.mjs 同法从 layout 重算）。探出「两侧同轴都是可走高度、唯缝处塌陷」
// 的窄段，每段补一条与桥面同高的薄地面板（可站立，渲染为石缝条）。
export function porchApproachPath(layout) {
  const bridge = (layout.objects || []).find((o) => o.kind === 'zigzagBridge' && Array.isArray(o.geometry?.polyline));
  const ht = (layout.objects || []).find((o) => o.id === 'huxin-ting' && Array.isArray(o.geometry?.footprint));
  if (!bridge || !ht) return null;
  let FP = ht.geometry.footprint.slice();
  if (FP.length >= 3 && FP[0][0] === FP.at(-1)[0] && FP[0][1] === FP.at(-1)[1]) FP.pop();
  if (FP.length < 3) return null;
  let A2 = 0, cxs = 0, czs = 0;
  for (let i = 0; i < FP.length; i++) {
    const [x0, z0] = FP[i], [x1, z1] = FP[(i + 1) % FP.length];
    const cr = x0 * z1 - x1 * z0;
    A2 += cr; cxs += (x0 + x1) * cr; czs += (z0 + z1) * cr;
  }
  const CX = cxs / (3 * A2), CZ = czs / (3 * A2);
  let best = null;
  for (let i = 0; i < FP.length; i++) {
    const a = FP[i], b = FP[(i + 1) % FP.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || L > best[0]) best = [L, a, b];
  }
  let UX = (best[2][0] - best[1][0]) / best[0], UZ = (best[2][1] - best[1][1]) / best[0];
  if (UX < 0) { UX = -UX; UZ = -UZ; }
  const VX = UZ, VZ = -UX;
  const toLocal = (x, z) => [(x - CX) * UX + (z - CZ) * UZ, (x - CX) * VX + (z - CZ) * VZ];
  const toWorld = (u, v) => [CX + u * UX + v * VX, CZ + u * UZ + v * VZ];
  const LV = FP.map((p) => toLocal(p[0], p[1])[1]);
  const V0 = (Math.max(...LV) - Math.min(...LV)) / 2;
  const BR = bridge.geometry.polyline;
  const BL = BR.map((p) => toLocal(p[0], p[1]));
  let hit = null;
  for (let i = 0; i + 1 < BL.length; i++) {
    const [ua, va] = BL[i], [ub, vb] = BL[i + 1];
    if ((ua > 0) === (ub > 0) || ua === ub) continue;
    const t = ua / (ua - ub);
    const v = va + (vb - va) * t;
    if (v > V0 && (!hit || v < hit.v)) hit = { i, t, v };
  }
  if (!hit) return null;
  const cum = [0];
  for (let i = 1; i < BR.length; i++) cum.push(cum[i - 1] + Math.hypot(BR[i][0] - BR[i - 1][0], BR[i][1] - BR[i - 1][1]));
  const sHit = cum[hit.i] + hit.t * (cum[hit.i + 1] - cum[hit.i]);
  let i = 0;
  while (i + 2 < cum.length && cum[i + 1] < sHit) i++;
  const t = (sHit - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
  const B0 = [BR[i][0] + (BR[i + 1][0] - BR[i][0]) * t, BR[i][1] + (BR[i + 1][1] - BR[i][1]) * t];
  const I0 = toWorld(0, V0 + 0.62);
  return { B0, I0, path: [B0, I0] };
}

export function planSeamBridges({ paths, probe, deckY = 0.55, halfWidth = 0.75, sampleStep = 0.02, dipBelow = 0.45, solidY = deckY - 0.05 }) {
  const slabs = [];
  const lineList = (paths || []).filter((p) => Array.isArray(p) && p.length >= 2);
  if (!lineList.length || typeof probe !== 'function') return { slabs };
  for (const poly of lineList) {
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    const at = (s) => {
      let i = 0;
      while (i + 2 < cum.length && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
      return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t];
    };
    const isDip = (x, z) => { const g = probe(x, z); return g === null || g < dipBelow; };
    const isWalkLevel = (x, z) => { const g = probe(x, z); return g !== null && Math.abs(g - deckY) <= 0.06; };
    const total = cum.at(-1);
    const seams = [];
    for (let s = 0; s <= total; s += sampleStep) {
      const [x, z] = at(s);
      if (!isDip(x, z)) continue;
      // 缝判定：沿轴两侧 0.35 m 内都是可走高度（排除水面/缺桥段）
      const [xa, za] = at(Math.max(0, s - 0.35));
      const [xb, zb] = at(Math.min(total, s + 0.35));
      if (isWalkLevel(xa, za) && isWalkLevel(xb, zb)) seams.push(s);
    }
    // 合并连续缝段 → 薄板
    let runStart = null, prev = null;
    const flush = (end) => {
      if (runStart === null) return;
      const a = runStart - 0.08, b = end + 0.08;
      if (b - a <= 0.5) {   // 缝 ≤ 0.5 m 才补（长缺段不是缝，宁可留空）
        const midS = Math.max(0, Math.min(total, (a + b) / 2));
        const [x0, z0] = at(midS);
        const [x1, z1] = at(Math.min(total, midS + 0.05));
        const d = norm([x1 - x0, z1 - z0]);
        const px = -d[1], pz = d[0];
        const len = (b - a) / 2;
        const c0 = [x0 + px * halfWidth - d[0] * len, z0 + pz * halfWidth - d[1] * len];
        const c1 = [x0 - px * halfWidth - d[0] * len, z0 - pz * halfWidth - d[1] * len];
        const c2 = [x0 - px * halfWidth + d[0] * len, z0 - pz * halfWidth + d[1] * len];
        const c3 = [x0 + px * halfWidth + d[0] * len, z0 + pz * halfWidth + d[1] * len];
        slabs.push({ corners: [c0, c1, c2, c3], y0: solidY - 0.03, y1: deckY + 0.005, seam: [a, b] });
      }
      runStart = null;
    };
    for (const s2 of seams) {
      if (runStart === null) runStart = s2;
      else if (s2 - prev > sampleStep * 1.5) { flush(prev); runStart = s2; }
      prev = s2;
    }
    flush(prev ?? runStart);
  }
  return { slabs };
}

// ---------- 物理应用（无 DOM/three；node 测试直驱同一份代码） ----------
// trims：按记录名移除原护栏 collider+body，用缩短后的同名记录重建（obbToWorld 同一通道）；
// lips：water-guard 同型记录新增长盒；steps + seam slabs：棱柱 → trimesh 地面，登记进
// zonePhysics.groundColliders（支撑查询只认已登记地面 —— 踏步/缝板必须可站立，
// 见 WalkController/feetSupported 的 groundColliders 过滤）。
export function applyAccessPhysics(RAPIER, physics, plan, zonePhysics = null) {
  const applied = { trimmed: [], lipsAdded: 0, stepsCollider: null, seamSlabs: 0 };
  if (!physics || !plan) return applied;
  const world = physics.world;
  const findEntry = (name) => (physics.colliders || []).find((c) => c.record?.name === name) || null;

  for (const t of plan.trims || []) {
    const entry = findEntry(t.name);
    if (!entry) continue;
    const src = entry.record;
    // 环边护栏记录形如 export-collision.mjs edgeWall：长轴 local z，theta 使 local z → (sinθ, cosθ)。
    const dir = norm(sub(t.newEnd, t.keep));
    const len = dist2D(t.newEnd, t.keep);
    if (len < 0.8) continue;   // 回退后过短则放弃该条（保持原护栏，宁可墙不可洞）
    const mid = [(t.newEnd[0] + t.keep[0]) / 2, (t.newEnd[1] + t.keep[1]) / 2];
    const h = src.obb?.size?.[1] ?? GUARD_H;
    const record = {
      name: t.name, module: src.module || 'water-guard', type: 'box',
      obb: { pos: [mid[0], 0, mid[1]], theta: Math.atan2(dir[0], dir[1]), center: [0, h / 2, 0], size: [GUARD_THICK, h, len] },
    };
    removeEntry(world, physics, entry);
    const added = addWallCollider(RAPIER, world, record);
    physics.colliders.push(added);
    applied.trimmed.push(t.name);
  }

  for (const lip of plan.lips || []) {
    if (findEntry(lip.name)) continue;
    const dir = norm(sub(lip.b, lip.a));
    const len = dist2D(lip.a, lip.b);
    const mid = [(lip.a[0] + lip.b[0]) / 2, (lip.a[1] + lip.b[1]) / 2];
    const record = {
      name: lip.name, module: 'water-guard', type: 'box',
      obb: { pos: [mid[0], 0, mid[1]], theta: Math.atan2(dir[0], dir[1]), center: [0, lip.heightM / 2, 0], size: [lip.thickM, lip.heightM, len] },
    };
    const added = addWallCollider(RAPIER, world, record);
    physics.colliders.push(added);
    physics.wallCount += 1;
    applied.lipsAdded += 1;
  }

  const steps = plan.steps;
  const slabBoxes = [
    ...(steps?.boxes || []),
    ...(plan.seamSlabs || []).map((s) => ({ corners: s.corners, y0: s.y0, y1: s.y1 })),
  ];
  if (slabBoxes.length && !(zonePhysics && zonePhysics.events?.some((e) => e.state === 'bridge-access-steps'))) {
    const { positions, indices, triCount } = boxesToTrimesh(slabBoxes);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)), body);
    if (zonePhysics) {
      zonePhysics.groundColliders.push(collider);
      zonePhysics.events.push({ zone: steps?.bridge || 'pond', state: 'bridge-access-steps', tris: triCount });
    }
    physics.groundTriangleCount += triCount;
    applied.stepsCollider = collider.handle;
    applied.seamSlabs = (plan.seamSlabs || []).length;
  }

  world.step();   // 与 AreaWalkPhysics.loadZone 同：新增 collider 后 prime broad-phase
  return applied;
}

function removeEntry(world, physics, entry) {
  if (entry.collider) world.removeCollider(entry.collider, false);
  if (entry.body) world.removeRigidBody(entry.body);
  const i = physics.colliders.indexOf(entry);
  if (i >= 0) physics.colliders.splice(i, 1);
}

// 与 src/world/physics.js addWallCollider 相同的记录→collider 通道（避免跨目录循环依赖，这里内联同式）。
function addWallCollider(RAPIER, world, record) {
  const { pos, theta, center, size } = record.obb;
  const c = Math.cos(theta), s = Math.sin(theta);
  const wx = pos[0] + c * center[0] + s * center[2];
  const wz = pos[2] - s * center[0] + c * center[2];
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(wx, center[1] + (pos[1] ?? 0), wz));
  const desc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
    .setRotation({ w: Math.cos(theta / 2), x: 0, y: Math.sin(theta / 2), z: 0 });
  const collider = world.createCollider(desc, body);
  return { collider, body, handle: collider.handle, record };
}

function boxesToTrimesh(boxes) {
  const positions = [], indices = [];
  let v = 0;
  for (const b of boxes) {
    // 旋转矩形棱柱：底/顶各 4 角（顶面 CCW 自上视），碰撞与渲染同一份几何
    const [q0, q1, q2, q3] = b.corners;
    const t = (q) => positions.push(q[0], b.y1, q[1]);
    const d = (q) => positions.push(q[0], b.y0, q[1]);
    t(q0); t(q1); t(q2); t(q3);
    d(q0); d(q1); d(q2); d(q3);
    const quad = (a, b2, c, d2) => indices.push(v + a, v + b2, v + c, v + a, v + c, v + d2);
    quad(0, 1, 2, 3);   // top
    quad(7, 6, 5, 4);   // bottom
    quad(4, 5, 1, 0);   // side q0-q1
    quad(5, 6, 2, 1);   // side q1-q2
    quad(6, 7, 3, 2);   // side q2-q3
    quad(7, 4, 0, 3);   // side q3-q0
    v += 8;
  }
  return { positions, indices, triCount: indices.length / 3 };
}

// ---------- 渲染（浏览器钩子用；与碰撞完全同一份棱柱几何） ----------
export function applyAccessVisuals(THREE, scene, plan) {
  if (scene.getObjectByName('bridge-access-steps')) return null;
  const steps = plan?.steps;
  const slabBoxes = [
    ...(steps?.boxes || []),
    ...(plan?.seamSlabs || []).map((s) => ({ corners: s.corners, y0: s.y0, y1: s.y1 })),
  ];
  if (!slabBoxes.length) return null;
  const { positions, indices } = boxesToTrimesh(slabBoxes);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8f8779, roughness: 0.94, metalness: 0.02 }));
  mesh.name = 'bridge-access-steps';
  const grp = new THREE.Group();
  grp.name = 'bridge-access-steps-group';
  grp.add(mesh);
  scene.add(grp);
  return grp;
}
