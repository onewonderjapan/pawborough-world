// wave5-shots2 附带修复：庙区 temple-v3 碰撞记录的落位（collision-temple.json）必须与 assemble 摆放模块的位置一致。
// 数据源（冻结源，不拿产物和自己比）：
//   resources/temple-v3/collision-world.json —— 记录是 temple-axis-v3 数据集「世界」坐标（每条 obb.pos 已含所属实例
//     的 positionGlb；instances[] 给出每个模块在数据集里的 positionGlb / rotationYRad）；
//   baseline/layout.json instances —— assemble.py 按它摆放各模块 GLB（模块本地系 → layout position / rotY）。
// 正确落位：world = A_i + R(rotA_i)·R(−r0_i)·(p − g_i)，theta' = theta − r0_i + rotA_i
//   （A_i/rotA_i = layout 实例，g_i/r0_i = 数据集实例；p = 记录 obb.pos）。
// 修复前 export-collision 用 A_i + R(rotA_i)·p（把 g_i 叠了两次）：仪门/大殿/后殿/配殿/廊庑/戏台/庙树的碰撞盒
// 离渲染几何 20–74 m（山门 / 前院 / 大殿院 / 后院穿廊 g = 0，不受影响）。
// 断言：
//  1) collision-temple.json 里每条 temple-v3 记录的 obb.pos / theta 与上式一致（≤ 0.01 m / 1e-4 rad）；
//  2) g ≠ 0 的模块（非数据集原点模块）记录中心的平均值离 layout 实例锚 ≤ 10 m（模块碰撞落在模块自己身上）。
// 用法：OUT_DIR=out-zone node tests/temple-collision-placement-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

const v3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'temple-v3', 'collision-world.json'), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const coll = JSON.parse(fs.readFileSync(path.join(OUT, 'collision-temple.json'), 'utf8'));
const dsInst = Object.fromEntries(v3.instances.map(i => [i.id, i]));
const layInst = Object.fromEntries(layout.instances.map(i => [i.id, i]));
// 记录前缀 → layout 实例 id：数据集实例 module 名与 layout 实例 id 同源（temple-<id>；entrycourt 的记录前缀是 court）
const layoutIdOf = (prefix) => (prefix === 'court' ? 'temple-entrycourt' : `temple-${prefix}`);
const dsIdOf = (prefix) => (prefix === 'court' ? 'entrycourt' : prefix);
// 同名记录（左右对称件同名，如 wing-wall-body）按出现顺序一一对应
const byName = new Map();
for (const r of coll.colliders) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }
const rot = (a, x, z) => [Math.cos(a) * x + Math.sin(a) * z, -Math.sin(a) * x + Math.cos(a) * z];

const perModule = {};
let checked = 0, worst = 0;
for (const rec of v3.colliders) {
  const prefix = rec.name.split(':')[0];
  const li = layInst[layoutIdOf(prefix)], di = dsInst[dsIdOf(prefix)];
  ok(!!li && !!di, `${rec.name}: 找不到 layout 实例 ${layoutIdOf(prefix)} 或数据集实例 ${dsIdOf(prefix)}`);
  if (!li || !di) continue;
  const g = di.positionGlb, r0 = di.rotationYRad || 0;
  const loc = rot(-r0, rec.obb.pos[0] - g[0], rec.obb.pos[2] - g[2]);
  const w = rot(li.rotY, loc[0], loc[1]);
  const exp = [li.position[0] + w[0], li.position[1] + w[1]];
  const got = (byName.get(`${li.id}:${rec.name}`) || []).shift();
  ok(!!got, `collision-temple.json 缺 ${li.id}:${rec.name}`);
  if (!got) continue;
  const d = Math.hypot(got.obb.pos[0] - exp[0], got.obb.pos[2] - exp[1]);
  const dth = Math.abs(Math.atan2(Math.sin(got.obb.theta - (rec.obb.theta - r0 + li.rotY)), Math.cos(got.obb.theta - (rec.obb.theta - r0 + li.rotY))));
  worst = Math.max(worst, d);
  checked++;
  ok(d <= 0.01, `${li.id}:${rec.name} 落位偏 ${d.toFixed(2)} m（期望 (${exp[0].toFixed(2)}, ${exp[1].toFixed(2)})）`);
  ok(dth <= 1e-4, `${li.id}:${rec.name} 朝向偏 ${dth.toFixed(4)} rad`);
  if (g[0] !== 0 || g[2] !== 0) {
    const m = perModule[li.id] || (perModule[li.id] = { n: 0, x: 0, z: 0, anchor: li.position });
    m.n++; m.x += got.obb.pos[0]; m.z += got.obb.pos[2];
  }
}
for (const [id, m] of Object.entries(perModule)) {
  const d = Math.hypot(m.x / m.n - m.anchor[0], m.z / m.n - m.anchor[1]);
  ok(d <= 10, `${id} 碰撞记录中心离 layout 实例锚 ${d.toFixed(1)} m > 10（碰撞没落在模块上）`);
}
console.log(`temple-collision-placement-test: ${pass} pass, ${fail} fail (records ${checked}, worst offset ${worst.toFixed(2)} m, positioned modules ${Object.keys(perModule).length})`);
process.exit(fail ? 1 : 0);
