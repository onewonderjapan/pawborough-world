// 交互决策契约（小吃工单 20261001「小吃与交互」）。E 的 1.8m + 隔墙负例 +
// 暂停/持物门；底部提示状态机。
// Run: node tests/play_interaction.test.mjs
import { PlayGameState, FOODS } from '../scene-authoring/yuyuan-area/web/play/state.js';
import { deriveStallTargets } from '../scene-authoring/yuyuan-area/web/play/stalls.js';
import { canTakeNow, takeFailHint, computeHint, nearestStall, TAKE_RADIUS_M, MOUNT_RADIUS_M } from '../scene-authoring/yuyuan-area/web/play/interaction.js';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const layout = JSON.parse(await readFile(resolve(root, 'scene-authoring/yuyuan-area/out-zone/layout.json'), 'utf8'));
const sockets = JSON.parse(await readFile(resolve(root, 'scene-authoring/yuyuan-area/out-zone/food-sockets.json'), 'utf8'));
const stalls = deriveStallTargets(layout, sockets, FOODS);
const t0 = stalls[0];

// E 的 1.8m 门
{
  const state = new PlayGameState();
  const at = [t0.customerPoint.x, 0.02, t0.customerPoint.z];
  const ok = canTakeNow({ state, feet: at, stalls });
  check('站在顾客点可取', ok.ok === true && ok.foodId === 'xiaolongbao');
  check('E 半径 1.8m 常量', TAKE_RADIUS_M === 1.8 && MOUNT_RADIUS_M === 1.8);

  const far = canTakeNow({ state, feet: [at[0] + 3.0, 0.02, at[2]], stalls });
  check('3m 外拒绝 too-far', far.ok === false && far.reason === 'too-far' && far.dist > TAKE_RADIUS_M);
  check('太远给距离提示', /再走近些/.test(takeFailHint(far) ?? ''), takeFailHint(far));

  // 隔墙负例（LOS 注入；浏览器侧是真实 Rapier 射线）
  const blocked = canTakeNow({ state, feet: at, stalls, losCheck: () => false });
  check('隔墙拒绝', blocked.ok === false && blocked.reason === 'blocked');
  check('隔墙给绕行提示', /遮挡/.test(takeFailHint(blocked) ?? ''));

  state.take('xiaolongbao');
  const holding = canTakeNow({ state, feet: at, stalls });
  check('手里有食物不能重复领取', holding.reason === 'holding' && /吃完再拿/.test(takeFailHint(holding) ?? ''));

  const paused = new PlayGameState();
  paused.paused = true;
  const pgate = canTakeNow({ state: paused, feet: at, stalls });
  check('暂停不能取', pgate.ok === false && pgate.reason === 'paused' && /暂停/.test(takeFailHint(pgate) ?? ''));
}

// 底部提示状态机
{
  const state = new PlayGameState();
  state.playing = true;
  const at = [t0.customerPoint.x, 0.02, t0.customerPoint.z];
  check('近摊位提示取餐', /E 取一份小笼包/.test(computeHint({ state, feet: at, stalls }) ?? ''));
  check('中距离提示摊名与距离', /走近蒸煮小摊/.test(computeHint({ state, feet: [at[0] + 3, 0, at[2]], stalls }) ?? ''));
  check('远处不啰嗦', computeHint({ state, feet: [0, 0, 0], stalls }) === null);

  state.take('xiaolongbao');
  check('持物提示开吃', /F 开吃/.test(computeHint({ state, feet: [0, 0, 0], stalls }) ?? ''));
  state.startEat();
  check('吃中提示可暂停', /正在品尝/.test(computeHint({ state, feet: [0, 0, 0], stalls }) ?? ''));
  state.eatTick(99);
  check('吃完进入下一味导向', state.goal()?.id === 'congyoubing');

  state.selectGoal(0); state.take('xiaolongbao'); state.startEat(); state.eatTick(99);
  state.take('congyoubing'); state.startEat(); state.eatTick(99);
  state.take('youdunzi'); state.startEat(); state.eatTick(99);
  check('三味完成回报', /三味集齐/.test(computeHint({ state, feet: [0, 0, 0], stalls }) ?? ''));

  const st = new PlayGameState(); st.playing = true;
  check('骑车提示操控', /R 下车/.test(computeHint({ state: st, feet: [0, 0, 0], stalls, riding: true }) ?? ''));
  check('堵死提示推行', /下车推行/.test(computeHint({ state: st, feet: [0, 0, 0], stalls, riding: true, blockedRatio: 0.9 }) ?? ''));
  const bikeNear = { dist: 1.2 };
  check('近车提示上车', /R 骑上/.test(computeHint({ state: st, feet: [0, 0, 0], stalls, bike: bikeNear }) ?? ''));
  check('未进 play 无提示', computeHint({ state: new PlayGameState(), feet: [0, 0, 0], stalls }) === null);

  check('nearestStall 返回最近', nearestStall(stalls, [t0.customerPoint.x + 0.5, 0, t0.customerPoint.z]).stall === t0);
}

console.log(failures === 0 ? 'PLAY_INTERACTION PASS' : `PLAY_INTERACTION FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
