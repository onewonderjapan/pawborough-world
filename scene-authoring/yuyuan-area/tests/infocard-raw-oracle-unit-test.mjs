// wave12-debt D3：infocard-raw-oracle 歧义检查收紧的内存回归用例（不依赖任何构建产物、不起浏览器）。
//
// 审查背景（wave11-infocard R4 可选 3）：matchTriangle 旧版只比 best/second 两名——
//   ① 两个同 id 不同 module 的面相距 3 cm、命中三角形偏 2 cm（都在 6 cm 容差内、得分差远大于 1e-4）
//     时，旧版静默映射到得分最低者（可能是错误 module），ambiguous=false；
//   ② 三个完全重合节点 module 为 A/A/B 时，旧版只比较前两名（A 对 A），第三名 B 永远不被核对。
// 新契约：容差内全部候选的 (layout id, module) 必须一致，不一致即 ambiguous（expect() 报 error）；
// 结果记录匹配误差（score）与候选间距（gap = 第二名得分 − best 得分，null = 容差内无第二名）。
//
// 红绿对照：旧实现两用例均不报歧义（本测试 FAIL，日志在工单包 artifacts/d3/RED-*.log）；
// 新实现两用例均报歧义且记录误差/间距（GREEN）。期望（必须报歧义）由用例几何独立构造得出，
// 不从被测 matchTriangle 的输出反推。
import { RawGlbIndex } from './infocard-raw-oracle.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => { if (cond) { console.log('PASS', msg); } else { fails++; console.error('FAIL', msg); } };

// 内存索引：不读任何 GLB——只填 matchTriangle/chain 用到的 this.prims 与 this.glb。
// 每个 prim 一颗三角形；glb 节点带 extras { id, module } 供父链解析身份。
function memIndex(tris) {
  // tris: [{ verts: [[x,y,z]×3], id, module }]
  const idx = Object.create(RawGlbIndex.prototype);
  idx.prims = [];
  idx.glb = {};
  const file = 'mem.glb';
  const nodes = tris.map(t => ({ name: `zone|${t.id}|mesh|lod0`, extras: { id: t.id, module: t.module }, mesh: t.meshIdx }));
  const par = new Array(nodes.length).fill(null);
  idx.glb[file] = { nodes, par };
  for (const t of tris) {
    const wpos = new Float32Array(t.verts.flat());
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const v of t.verts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
    idx.prims.push({ file, node: t.node, name: nodes[t.node].name, wpos, idx: new Uint32Array([0, 1, 2]), min, max });
  }
  return idx;
}

// ---------- 用例①：同 id 不同 module 的两面相距 3 cm，命中偏 2 cm ----------
{
  const base = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const off = (dz) => base.map(v => [v[0], v[1], v[2] + dz]);
  const idx = memIndex([
    { verts: off(0.00), id: 'shop-1', module: 'moduleA', node: 0 },   // 面 A（真身）
    { verts: off(0.03), id: 'shop-1', module: 'moduleB', node: 1 },   // 面 B：3 cm 外、同 id 不同 module
  ]);
  const hitTri = off(0.02);                                            // 测得三角形偏 2 cm（容差内）
  const m = idx.matchTriangle(hitTri, [0.3, 0.3, 0.02]);
  ok(!!m, 'case1: matchTriangle 有候选', m && m.score);
  ok(m && m.ambiguous === true,
    'case1: 容差内两个不同 module 的候选必须报 ambiguous（旧版静默选 moduleB 且 ambiguous=false）',
    m && { best: `${m.file}#${m.node}`, module: m.module, ambiguous: m.ambiguous, score: m.score, gap: m.gap });
  ok(m && typeof m.score === 'number' && m.score > 0, 'case1: 记录匹配误差 score（=2 cm 偏移量级）', m && m.score);
  ok(m && m.gap !== undefined, 'case1: 记录候选间距 gap（第二名得分 − best 得分）', m && m.gap);
  const e = idx.expect([{ uuid: 'u1', visible: true, threeId: 'shop-1', roof: false, dist: 1, point: [0.3, 0.3, 0.02], tri: hitTri }]);
  ok(!!e.error, 'case1: expect() 对身份不一致的容差内候选报 error（旧版无 error、module=moduleB）', e.error);
}

// ---------- 用例②：三个完全重合节点 module = A/A/B ----------
{
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const idx = memIndex([
    { verts, id: 'hall-1', module: 'A', node: 0 },
    { verts, id: 'hall-1', module: 'A', node: 1 },
    { verts, id: 'hall-1', module: 'B', node: 2 },                     // 第三名 B：旧版只比前两名，永远漏检
  ]);
  const m = idx.matchTriangle(verts, [0.3, 0.3, 0]);
  ok(!!m, 'case2: matchTriangle 有候选', m && m.score);
  ok(m && m.ambiguous === true,
    'case2: 容差内候选身份含 A/A/B，必须报 ambiguous（旧版 best/second 都落在 A 上、不报）',
    m && { ambiguous: m.ambiguous, nCandidates: m.nCandidates });
  const e = idx.expect([{ uuid: 'u2', visible: true, threeId: 'hall-1', roof: false, dist: 1, point: [0.3, 0.3, 0], tri: verts }]);
  ok(!!e.error, 'case2: expect() 对 A/A/B 报 error（旧版无 error）', e.error);
}

// ---------- 基线：单一候选（无干扰）不受影响 ----------
{
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const idx = memIndex([{ verts, id: 'solo-1', module: 'M', node: 0 }]);
  const m = idx.matchTriangle(verts.map(v => [v[0], v[1], v[2] + 0.01]), [0.3, 0.3, 0.01]);
  ok(!!m && m.ambiguous === false && m.id === 'solo-1' && m.module === 'M',
    'baseline: 单候选正常映射、不误报歧义', m && { id: m.id, module: m.module, ambiguous: m.ambiguous });
  ok(m && m.score > 0.009 && m.score < 0.011, 'baseline: 匹配误差 = 实际偏移（1 cm）', m && m.score);
  ok(m && m.gap === null, 'baseline: 容差内无第二名时 gap=null', m && m.gap);
}

if (fails) { console.error(`infocard-raw-oracle-unit: ${fails} fail`); process.exit(1); }
console.log('infocard-raw-oracle-unit: all pass');
