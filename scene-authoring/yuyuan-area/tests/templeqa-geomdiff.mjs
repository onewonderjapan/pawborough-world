// 两份模块 GLB 的逐节点三角集合对比（位置取 1e-4 m，三角内顶点顺序归一但保留绕序）。
// 用法：node tests/templeqa-geomdiff.mjs <a.glb> <b.glb>  → 打印每节点 onlyA / onlyB 三角数；完全一致 exit 0
import * as Q from './templeqa-lib.mjs';
const [fa, fb] = process.argv.slice(2);
const key = (n, t) => {
  const v = [0, 1, 2].map((k) => [0, 1, 2].map((c) => Math.round(n.P[n.T[t * 3 + k] * 3 + c] * 1e4)).join(','));
  const i = v.indexOf([...v].sort()[0]);            // 旋转到最小顶点开头（保绕序）
  return [v[i], v[(i + 1) % 3], v[(i + 2) % 3]].join('|');
};
const bag = (mod) => {
  const m = new Map();
  for (const n of mod.nodes) {
    const b = m.get(n.name) || new Map();
    for (let t = 0; t < n.T.length / 3; t++) { const k = key(n, t); b.set(k, (b.get(k) || 0) + 1); }
    m.set(n.name, b);
  }
  return m;
};
const A = bag(Q.readModule(fa)), B = bag(Q.readModule(fb));
let diff = 0;
const out = {};
for (const name of new Set([...A.keys(), ...B.keys()])) {
  const a = A.get(name) || new Map(), b = B.get(name) || new Map();
  let onlyA = 0, onlyB = 0;
  for (const [k, c] of a) onlyA += Math.max(0, c - (b.get(k) || 0));
  for (const [k, c] of b) onlyB += Math.max(0, c - (a.get(k) || 0));
  if (onlyA || onlyB) { out[name] = { onlyA, onlyB }; diff += onlyA + onlyB; }
}
console.log(JSON.stringify({ a: fa, b: fb, identicalTriangles: diff === 0, nodes: out }));
process.exit(diff ? 1 : 0);
