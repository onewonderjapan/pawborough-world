// 摊位目标派生（小吃工单 20261001）。三处真实摊位的顾客接近点不是手写坐标：
// 全部从 out/layout.json 的 stall.geometry（position/rotY/faces.refPoint）与
// out/food-sockets.json 的 tray worldPosition 派生。若建议点不可达，沿同一
// 既有路侧（faces.refPoint 方向）在 1.2–3.0m 间找备选距离并记录原因。
import { FOODS } from './state.js';

export const CUSTOMER_DIST_M = 2.0;

function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// layout + food-sockets → 三味目标（顺序按 state.FOODS）
export function deriveStallTargets(layout, foodSockets, foods = FOODS) {
  const byId = new Map((layout.objects ?? []).map(o => [o.id, o]));
  const trayOf = new Map();
  for (const s of foodSockets?.sockets ?? []) {
    if (String(s.purpose) === 'food-tray-display') trayOf.set(s.stall, s);
  }
  const out = [];
  for (const food of foods) {
    const stall = byId.get(food.stallId);
    const tray = trayOf.get(food.stallId);
    if (!stall || stall.kind !== 'stall') throw new Error(`stalls: ${food.stallId} missing in layout`);
    if (!tray || !Array.isArray(tray.worldPosition)) throw new Error(`stalls: ${food.stallId} tray socket missing`);
    const [sx, sz] = stall.geometry.position;
    const rotY = stall.geometry.rotY ?? 0;
    const ref = stall.faces?.refPoint;
    if (!Array.isArray(ref) || ref.length !== 2) throw new Error(`stalls: ${food.stallId} faces.refPoint missing`);
    // 顾客点：柜台→refPoint（行人侧）方向、离 counter 约 2m；沿这条线做距离备选
    const dx = ref[0] - sx, dz = ref[1] - sz;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const candidates = [CUSTOMER_DIST_M, 2.6, 1.5, 3.0].map(m => ({
      m, x: sx + ux * m, z: sz + uz * m,
    }));
    out.push({
      foodId: food.id,
      labelZh: food.labelZh,
      stallLabelZh: food.stallLabelZh,
      stallId: food.stallId,
      road: stall.faces?.road ?? null,
      rotY,
      counter: { x: sx, z: sz },
      tray: { x: tray.worldPosition[0], y: tray.worldPosition[1], z: tray.worldPosition[2], rotY: tray.worldRotY ?? rotY },
      faceDir: { x: ux, z: uz },
      refPoint: { x: ref[0], z: ref[1] },
      candidates,
      chosen: 0,
      customerPoint: { x: candidates[0].x, z: candidates[0].z },
      fallbackReason: null,
    });
  }
  return out;
}

// 运行时可达性修正：浏览器/测试侧用真实地面射线与墙碰撞检查候选点；
// blockers(x,z) 返回该点是否不可站立（无地面/墙内）。全败时保留 2.0m 建议点并记录。
export function chooseReachable(target, isBlocked) {
  for (let i = 0; i < target.candidates.length; i++) {
    const c = target.candidates[i];
    if (!isBlocked(c.x, c.z)) {
      target.chosen = i;
      target.customerPoint = { x: c.x, z: c.z };
      if (i > 0) target.fallbackReason = `建议 2.0m 点不可站立，沿路侧改用 ${c.m}m 备选`;
      return target;
    }
  }
  target.fallbackReason = '全部备选点未通过真实地面/碰撞检查，保留 2.0m 建议点';
  return target;
}

// 顾客点 → 世界 Y：由调用方（真实 Rapier 地面射线）注入；这里只做纯几何汇总。
export function stallSummary(targets) {
  return targets.map(t => ({
    foodId: t.foodId, labelZh: t.labelZh, stallId: t.stallId,
    x: t.customerPoint.x, z: t.customerPoint.z,
    trayY: t.tray.y, road: t.road, fallbackReason: t.fallbackReason,
  }));
}

// 与玩家脚点的平面距离（E 的 1.8m 判定用）
export function distanceTo(t, feet) {
  return dist(t.customerPoint.x, t.customerPoint.z, feet[0], feet[2]);
}
