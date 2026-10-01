// 小地图核心契约（小吃工单 20261001「HUD与地图」）。纯函数，用真实
// out-zone/layout.json 驱动：
//   - 底图几何来自真实 layout（道路/建筑footprint/水面/广场），无灰空圈占位
//   - 投影：世界 x 向东 = 图右，世界 z 向南 = 图下；附近窗 80m；全图 fit bounds
//   - 玩家箭头方向 = controller yaw（forward = (-sin,-cos)）
//   - 屏外目标钳边且 inside=false（只导向）
// Run: node tests/play_map.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMapGeometry, makeNearView, makeFullView, project, projectClamped, playerArrow, NEAR_RANGE_M } from '../scene-authoring/yuyuan-area/web/play/map-core.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const layout = JSON.parse(await readFile(resolve(root, 'scene-authoring/yuyuan-area/out-zone/layout.json'), 'utf8'));
const geom = collectMapGeometry(layout);

check('底图有真实道路', geom.roads.length >= 100, `roads=${geom.roads.length}`);
check('底图有真实建筑footprint', geom.blocks.length >= 100, `blocks=${geom.blocks.length}`);
check('bounds 来自 layout.meta', JSON.stringify(geom.bounds) === JSON.stringify(layout.meta.bounds));

// 坐标约定：x 东 → 图右；z 南 → 图下
{
  const view = makeNearView([0, 0, 0], 210, NEAR_RANGE_M);
  const [ex] = project(view, 10, 0);           // 东移 → px 增
  const [_, sy] = project(view, 0, 10);        // 南移 → py 增
  check('世界 x 向东 = 图面向右', ex > 105, `px=${ex.toFixed(1)}`);
  check('世界 z 向南 = 图面向下', sy > 105, `py=${sy.toFixed(1)}`);
  check('附近窗宽 80m：80m 处贴画缘', Math.abs(project(view, 40, 0)[0] - 210) < 1e-6);
}

// 全图：bounds 完整可见
{
  const view = makeFullView(geom.bounds, 210);
  const [x0, y0] = project(view, geom.bounds[0], geom.bounds[1]);
  const [x1, y1] = project(view, geom.bounds[2], geom.bounds[3]);
  check('全图四至都在画布内', x0 >= 0 && y0 >= 0 && x1 <= 210 && y1 <= 210,
    `(${x0.toFixed(0)},${y0.toFixed(0)})-(${x1.toFixed(0)},${y1.toFixed(0)})`);
}

// 玩家箭头：yaw=0 前进 = 世界 -Z = 图面向上
{
  const view = makeNearView([0, 0, 0], 210);
  const arrow = playerArrow(view, [0, 0, 0], 0);
  check('yaw=0 箭头尖朝图面上方（-Z 前进）', arrow[0][1] < 105 && Math.abs(arrow[0][0] - 105) < 1e-6,
    `tip=(${arrow[0][0].toFixed(1)},${arrow[0][1].toFixed(1)})`);
}

// 屏外目标钳边
{
  const view = makeNearView([0, 0, 0], 210);
  const p = projectClamped(view, 500, 0);
  check('屏外目标钳到窗缘且 inside=false', p.inside === false && p.x <= 200 && p.y <= 200);
  const q = projectClamped(view, 10, 0);
  check('窗内目标 inside=true 不动', q.inside === true);
}

// 非法输入直接抛错（不给 NaN 静默传播）
{
  let threw = false;
  try { collectMapGeometry({ meta: {} }); } catch { threw = true; }
  check('layout 无 bounds 抛错', threw);
  threw = false;
  try { makeNearView([NaN, 0, 0], 210); } catch { threw = true; }
  check('非法 feet 抛错', threw);
}

console.log(failures === 0 ? 'PLAY_MAP PASS' : `PLAY_MAP FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
