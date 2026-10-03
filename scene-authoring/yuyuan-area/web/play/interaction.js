// 交互决策核心（小吃工单 20261001）。DOM-free：E 取食 / F 进食 / R 上下车的
// 资格判定与底部提示文案都在这里（状态来自 state.js，几何来自 stalls.js），
// 浏览器只执行（附加模型/物理射线），节点测试直接驱动。
import { distanceTo } from './stalls.js';

export const TAKE_RADIUS_M = 1.8;      // E 的 1.8m
export const MOUNT_RADIUS_M = 1.8;     // R 上车的 1.8m
const NEAR_HINT_M = 5.0;               // 底部提示的摊位感知半径

// PLAY-05 修复：食物名一律 foodId→state.foods 权威解析。推车摊的运行时目标
// 会展开 vendor 字段，stall.labelZh 是摊名（如「肠粉摊」）而不是食物名，
// 绝不当食物用；摊位感知名允许用摊名，但两级回退后绝不出现 undefined。
export function foodLabelOf(state, stall) {
  const id = stall?.foodId;
  const food = id != null && state?.foods ? state.foods.find((f) => f?.id === id) : null;
  return food?.labelZh ?? food?.name ?? '小吃';
}
export function stallNameOf(stall) {
  if (typeof stall?.stallLabelZh === 'string' && stall.stallLabelZh) return stall.stallLabelZh;
  if (typeof stall?.labelZh === 'string' && stall.labelZh) return stall.labelZh; // 推车摊：vendor 名即摊位名
  return '街边食摊';
}

// 最近的可交互摊位（含平面距离）
export function nearestStall(stalls, feet) {
  let best = null, bestD = Infinity;
  for (const s of stalls) {
    if(s.enabled===false||!s.customerPoint)continue;
    const d = distanceTo(s, feet);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? { stall: best, dist: bestD } : null;
}

// E 的完整资格判定。losOk：浏览器注入的真实射线结果（无墙遮挡才 true）。
// 结果附带已解析的 foodLabel/stallName，供 takeFailHint 生成无 undefined 文案。
export function canTakeNow({ state, feet, stalls, losCheck = null }) {
  const gate = state.canTake({});
  if (!gate.ok) return gate;
  const near = nearestStall(stalls, feet);
  if (!near) return { ok: false, reason: 'no-stall' };
  if (near.dist > TAKE_RADIUS_M) {
    return { ok: false, reason: 'too-far', dist: near.dist, stall: near.stall,
      foodLabel: foodLabelOf(state, near.stall), stallName: stallNameOf(near.stall) };
  }
  if (losCheck && !losCheck(near.stall)) return { ok: false, reason: 'blocked', stall: near.stall };
  return { ok: true, reason: null, stall: near.stall, foodId: near.stall.foodId,
    foodLabel: foodLabelOf(state, near.stall), stallName: stallNameOf(near.stall) };
}

// 底部动态提示（每帧推给 HUD；返回 null = 不显示）。
// 单一主要动作提示：取餐/持物/进食/骑车各状态互斥，一次只返回一条。
export function computeHint({ state, feet, stalls, bike, riding = false, blockedRatio = 0, turnBlocked = false, aheadBlocked = false, unsupported = false } = {}) {
  if (!state.playing) return null;
  if (state.complete) {
    const finish = `已尝齐 ${state.requiredFoodIds.size} 味！`;
    if (riding) return `${finish}骑车再兜一圈吧 · R 下车`;
    if (bike && bike.dist <= MOUNT_RADIUS_M) return `${finish}R 骑车再兜一圈`;
    return `${finish}这条街你吃遍了`;
  }
  if (riding) {
    if (aheadBlocked) return '前方没有路面或台阶太高 · 已停稳，可倒车绕行或 R 下车';
    if (turnBlocked) return '旁边太近转不过去 · 直行拉开距离再转向';
    if (blockedRatio > 0.6) return '前方过不去（窄路/台阶）· 减速或 R 下车推行';
    return 'W 加速 · S 刹停后倒车 · Space 刹车 · A/D 转向 · R 下车 · 鼠标自由看';
  }
  if (state.busyEating) return `正在品尝${eatingLabel(state)}… · P 暂停`;
  if (unsupported) return '前方没有可走的路面 · 请沿路绕行';
  if (state.heldItem) return `手上有${heldLabel(state)} · F 开吃`;
  const near = nearestStall(stalls, feet);
  if (near && near.dist <= TAKE_RADIUS_M) return `E 取一份${foodLabelOf(state, near.stall)}（免费试吃）`;
  if (near && near.dist <= NEAR_HINT_M) return `走近${stallNameOf(near.stall)}（${near.dist.toFixed(1)}m）可取${foodLabelOf(state, near.stall)}`;
  if (bike && bike.dist <= MOUNT_RADIUS_M) return 'R 骑上共享自行车';
  return null;
}

function eatingLabel(state) { return state.foods.find(f => f.id === state.eating?.foodId)?.labelZh ?? '小吃'; }
function heldLabel(state) { return state.foods.find(f => f.id === state.heldItem)?.labelZh ?? '小吃'; }

// E 按下时的距离提示（太远给距离提示）
export function takeFailHint(result) {
  if (!result || result.ok) return null;
  if (result.reason === 'too-far') return `再走近些：距${result.stallName ?? stallNameOf(result.stall)}约 ${result.dist.toFixed(1)} 米`;
  if (result.reason === 'blocked') return '中间有遮挡，换个角度走近摊位';
  if (result.reason === 'holding') return '手上已有小吃，F 吃完再拿';
  if (result.reason === 'eating') return '先吃完手里的';
  if (result.reason === 'paused') return '已暂停，继续后才能取餐';
  return null;
}
