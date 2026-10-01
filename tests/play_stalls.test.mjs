// 摊位目标派生契约（小吃工单 20261001「小吃与交互」）。用真实 out-zone
// layout.json + food-sockets.json 驱动，证明三处目标不是手写坐标：
//   - stall-5/6/10 与 FOODS 一一对应；tray 来自真实 socket 世界位
//   - 顾客点在 stall 中心 → faces.refPoint（行人侧）方向、默认离 2.0m
//   - chooseReachable 沿同一路侧给备选距离并记录原因；全败保留建议点
// Run: node tests/play_stalls.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStallTargets, chooseReachable, distanceTo, CUSTOMER_DIST_M } from '../scene-authoring/yuyuan-area/web/play/stalls.js';
import { FOODS } from '../scene-authoring/yuyuan-area/web/play/state.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AREA = resolve(root, 'scene-authoring/yuyuan-area');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const layout = JSON.parse(await readFile(resolve(AREA, 'out-zone/layout.json'), 'utf8'));
const sockets = JSON.parse(await readFile(resolve(AREA, 'out-zone/food-sockets.json'), 'utf8'));
const targets = deriveStallTargets(layout, sockets, FOODS);

check('三味目标齐全且顺序与 FOODS 一致',
  targets.length === 3 && targets.every((t, i) => t.foodId === FOODS[i].id && t.stallId === FOODS[i].stallId),
  targets.map(t => t.stallId).join(','));

const trayOf = new Map(sockets.sockets.map(s => [s.id.replace('food-socket-', '').replace('-tray', ''), s]));
for (const t of targets) {
  const stall = layout.objects.find(o => o.id === t.stallId);
  const [sx, sz] = stall.geometry.position;
  const ref = stall.faces.refPoint;
  check(`${t.stallId} counter 来自 layout 真值`, t.counter.x === sx && t.counter.z === sz);
  check(`${t.stallId} tray 来自 food-sockets 真值`,
    t.tray.x === trayOf.get(t.stallId).worldPosition[0]
    && Math.abs(t.tray.y - 1.01) < 1e-6
    && t.tray.z === trayOf.get(t.stallId).worldPosition[2]);

  const dx = ref[0] - sx, dz = ref[1] - sz;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  check(`${t.stallId} 顾客点沿 refPoint（行人侧）方向`,
    Math.abs((t.customerPoint.x - sx) / CUSTOMER_DIST_M - ux) < 1e-9
    && Math.abs((t.customerPoint.z - sz) / CUSTOMER_DIST_M - uz) < 1e-9);
  check(`${t.stallId} 默认顾客点离 counter ${CUSTOMER_DIST_M}m`,
    Math.abs(Math.hypot(t.customerPoint.x - sx, t.customerPoint.z - sz) - CUSTOMER_DIST_M) < 1e-9);

  // E 判定用的距离函数与派生自同一几何
  check(`${t.stallId} distanceTo 自洽`, Math.abs(distanceTo(t, [t.customerPoint.x, 0, t.customerPoint.z])) < 1e-9);
}

// 备选距离沿同一路侧（refPoint 方向），记录原因
{
  const t = targets[0];
  let calls = 0;
  chooseReachable(t, () => (calls++ < 2));   // 前 2 个候选（2.0/2.6）被挡，1.5 可站
  check('chooseReachable 选第一个可站立候选（1.5m 备选）',
    t.chosen === 2 && Math.abs(Math.hypot(t.customerPoint.x - t.counter.x, t.customerPoint.z - t.counter.z) - 1.5) < 1e-9,
    `chosen=${t.chosen}`);
  check('备选原因入档', /2\.0m 点不可站立/.test(t.fallbackReason ?? ''), t.fallbackReason);

  const t2 = targets[1];
  chooseReachable(t2, () => true);   // 全部候选都不可站立
  check('全败保留 2.0m 建议点并记录', t2.chosen === 0
    && Math.abs(Math.hypot(t2.customerPoint.x - t2.counter.x, t2.customerPoint.z - t2.counter.z) - 2.0) < 1e-9
    && /保留 2\.0m 建议点/.test(t2.fallbackReason ?? ''));
}

console.log(failures === 0 ? 'PLAY_STALLS PASS' : `PLAY_STALLS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
