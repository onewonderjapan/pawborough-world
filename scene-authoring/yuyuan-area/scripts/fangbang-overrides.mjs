// 全域制作侧的方浜 v7 放置覆盖（Node 读取端；Python 读取端 = scripts/fangbang_overrides.py）。
// 覆盖数据只定义在 baseline/fangbang-placement-overrides.json 一处；两端按同一规则应用：
//   实例 positionGlb += translateGlb；名称前缀 `<id>:` 的碰撞记录 obb.pos（或 min/max）+= translateGlb；
//   结果取 4 位小数；应用前校验实例原位置 == expectBasePositionGlb（容差 1e-4）。
// 「取 4 位小数」的共享规则（wave12-debt D5，两端逐字一致，勿单边改写）：
//   四舍五入到 1e-4、半数远离零 = sign(x) * floor(|x| * 1e4 + 0.5) / 1e4 —— 与 Python 端
//   scripts/fangbang_overrides.py 的 _round4_half_up 同一公式、同一 double 运算序（先乘、加 0.5、
//   取 floor、再除回），IEEE 754 基本运算确定，两端逐位相等。不用 toFixed()：它与 Python round()
//   在 0.03125 这类二进精确半数上分歧（0.0313 vs 0.0312）。契约测试：tests/fangbang-rounding-contract-test.mjs。
// 仓库根 world/fangbang-temple-v7/{instances,collision-world}.json 是原客户端共享数据集，不在那里改位置。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AREA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OVERRIDES_PATH = path.join(AREA_ROOT, 'baseline', 'fangbang-placement-overrides.json');
const TOL = 1e-4;

export function loadOverrides(file = OVERRIDES_PATH) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.schema !== 'pawborough.fangbang-placement-overrides/1') throw new Error(`${file}: unexpected schema ${doc.schema}`);
  return doc.overrides;
}

// 四舍五入到 1e-4、半数远离零（共享规则见文件头；与 fangbang_overrides.py 同一 double 运算序）
export const round4HalfUp = (x) => (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) * 10000 + 0.5) / 10000;
export const add = (v, d) => [0, 1, 2].map(k => (d[k] ? round4HalfUp(v[k] + d[k]) : v[k]));

// 原地修改 instDoc.instances / colDoc.colliders，返回应用记录。
export function applyOverrides(instDoc, colDoc, overrides) {
  const applied = [];
  for (const ov of overrides) {
    const d = ov.translateGlb;
    const inst = instDoc.instances.find(i => i.id === ov.id);
    if (!inst) throw new Error(`fangbang override: instance ${ov.id} not in v7 instances.json`);
    const base = inst.positionGlb, exp = ov.expectBasePositionGlb;
    if ([0, 1, 2].some(k => Math.abs(base[k] - exp[k]) > TOL))
      throw new Error(`fangbang override ${ov.id}: v7 base position ${base} != expectBasePositionGlb ${exp} (shared dataset changed? re-derive the override instead of stacking it)`);
    inst.positionGlb = add(base, d);
    let n = 0;
    for (const r of colDoc.colliders) {
      if (r.name.split(':')[0] !== ov.id) continue;
      if (r.obb) r.obb.pos = add([r.obb.pos[0], r.obb.pos[1] ?? 0, r.obb.pos[2]], d);
      if (Array.isArray(r.min) && Array.isArray(r.max)) { r.min = add(r.min, d); r.max = add(r.max, d); }
      n++;
    }
    if (!n) throw new Error(`fangbang override ${ov.id}: no collision-world records named "${ov.id}:*"`);
    applied.push({ id: ov.id, translateGlb: d, positionGlb: inst.positionGlb, colliders: n });
  }
  return applied;
}

// 读 v7 instances / collision-world 并应用全域放置覆盖。
export function loadV7WithOverrides(repo) {
  const fb7 = path.join(repo, 'world', 'fangbang-temple-v7');
  const instDoc = JSON.parse(fs.readFileSync(path.join(fb7, 'instances.json'), 'utf8'));
  const colDoc = JSON.parse(fs.readFileSync(path.join(fb7, 'collision-world.json'), 'utf8'));
  const applied = applyOverrides(instDoc, colDoc, loadOverrides());
  return { instDoc, colDoc, applied };
}
