// 交互决策核心（小吃工单 20261001）。DOM-free：E 取食 / F 进食 / R 上下车的
// 资格判定与底部提示文案都在这里（状态来自 state.js，几何来自 stalls.js），
// 浏览器只执行（附加模型/物理射线），节点测试直接驱动。
import { distanceTo } from './stalls.js';

export const TAKE_RADIUS_M = 1.8;      // E 的 1.8m
export const MOUNT_RADIUS_M = 1.8;     // R 上车的 1.8m
const NEAR_HINT_M = 5.0;               // 底部提示的摊位感知半径

// 最近的可交互摊位（含平面距离）
export function nearestStall(stalls, feet) {
  let best = null, bestD = Infinity;
  for (const s of stalls) {
    const d = distanceTo(s, feet);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? { stall: best, dist: bestD } : null;
}

// E 的完整资格判定。losOk：浏览器注入的真实射线结果（无墙遮挡才 true）。
export function canTakeNow({ state, feet, stalls, losCheck = null }) {
  const gate = state.canTake({});
  if (!gate.ok) return gate;
  const near = nearestStall(stalls, feet);
  if (!near) return { ok: false, reason: 'no-stall' };
  if (near.dist > TAKE_RADIUS_M) return { ok: false, reason: 'too-far', dist: near.dist, stall: near.stall };
  if (losCheck && !losCheck(near.stall)) return { ok: false, reason: 'blocked', stall: near.stall };
  return { ok: true, reason: null, stall: near.stall, foodId: near.stall.foodId };
}

// 底部动态提示（每帧推给 HUD；返回 null = 不显示）
export function computeHint({ state, feet, stalls, bike, riding = false, blockedRatio = 0 } = {}) {
  if (!state.playing) return null;
  if (state.complete) {
    if (riding) return '三味集齐！骑车再兜一圈吧 · R 下车';
    if (bike && bike.dist <= MOUNT_RADIUS_M) return '三味集齐！R 骑车再兜一圈';
    return '三味集齐！这条街你吃遍了';
  }
  if (riding) {
    if (blockedRatio > 0.6) return '前方过不去（窄路/台阶）· 减速或 R 下车推行';
    return 'W 加速 · A/D 转向 · S/空格 刹车 · R 下车';
  }
  if (state.busyEating) return `正在品尝${eatingLabel(state)}…（P 暂停可冻结）`;
  if (state.heldItem) return `手上有${heldLabel(state)} · F 开吃`;
  const near = nearestStall(stalls, feet);
  if (near && near.dist <= TAKE_RADIUS_M) return `E 取一份${near.stall.labelZh}（免费试吃）`;
  if (near && near.dist <= NEAR_HINT_M) return `走近${near.stall.stallLabelZh}（${near.dist.toFixed(1)}m）可取${near.stall.labelZh}`;
  if (bike && bike.dist <= MOUNT_RADIUS_M) return 'R 骑上共享自行车';
  return null;
}

function eatingLabel(state) { return state.foods.find(f => f.id === state.eating?.foodId)?.labelZh ?? '小吃'; }
function heldLabel(state) { return state.foods.find(f => f.id === state.heldItem)?.labelZh ?? '小吃'; }

// E 按下时的距离提示（太远给距离提示）
export function takeFailHint(result) {
  if (!result || result.ok) return null;
  if (result.reason === 'too-far') return `再走近些：距${result.stall.labelZh}摊约 ${result.dist.toFixed(1)} 米`;
  if (result.reason === 'blocked') return '中间有遮挡，换个角度走近摊位';
  if (result.reason === 'holding') return '手上已有小吃，F 吃完再拿';
  if (result.reason === 'eating') return '先吃完手里的';
  if (result.reason === 'paused') return '已暂停，继续后才能取餐';
  return null;
}
