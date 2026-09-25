// 由普查 JSON 生成问题近景机位（地图坐标 Y-up），给 scripts/templeqa-render.py --cams 用。
// 屋面穿出：看点 = 最大超出顶点；机位 = 看点沿「模块包围盒中心 → 看点」水平方向外移 5 m、抬高 2.5 m。
// 互穿：看点 = 相交段包围盒中心；机位同式（以两实例中较小者的中心为内）。
// 用法：node tests/templeqa-closeups.mjs <survey-roof.json> <survey-inter.json> <out-cams.json> [--max 3]
import fs from 'node:fs';
import * as Q from './templeqa-lib.mjs';

const [roofJ, interJ, outJ] = process.argv.slice(2);
const MAX = process.argv.includes('--max') ? +process.argv[process.argv.indexOf('--max') + 1] : 3;
const insts = Q.templeInstances();
const first = (file) => insts.find((i) => i.file === file);
const cams = [];
const mk = (name, inst, at, ctr, dist = 5, up = 2.5, lens = 30) => {
  const pf = Q.placeFn(inst);
  const A = pf(...at), C = pf(ctr[0], at[1], ctr[2]);
  let dx = A[0] - C[0], dz = A[2] - C[2];
  const L = Math.hypot(dx, dz) || 1;
  dx /= L; dz /= L;
  cams.push({ name, inst: inst.id, pos: [A[0] + dx * dist, A[1] + up, A[2] + dz * dist].map(Q.f3), tgt: A.map(Q.f3), lens });
};
if (roofJ) {
  const R = JSON.parse(fs.readFileSync(roofJ, 'utf8'));
  for (const [file, r] of Object.entries(R.modules)) {
    if (!r.roofClip) continue;
    const inst = first(file);
    const bb = Q.readModule(Q.TEMPLE_V3 + '/' + file).nodes.reduce((b, n) => { for (let i = 0; i < n.P.length; i += 3) for (let c = 0; c < 3; c++) { b[0][c] = Math.min(b[0][c], n.P[i + c]); b[1][c] = Math.max(b[1][c], n.P[i + c]); } return b; }, [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]);
    const ctr = [0, 1, 2].map((c) => (bb[0][c] + bb[1][c]) / 2);
    const seen = new Set();
    let k = 0;
    for (const v of r.roofClip.list) {
      const sig = v.node + '|' + Math.abs(v.at[0]).toFixed(1) + '|' + v.at[1].toFixed(1) + '|' + v.at[2].toFixed(1);
      if (seen.has(sig)) continue;       // 左右镜像只取一侧
      seen.add(sig);
      if (k >= MAX) break;
      mk(`clip-${file.replace('.glb', '')}-${++k}`, inst, v.at, ctr);
    }
  }
}
if (interJ) {
  const I = JSON.parse(fs.readFileSync(interJ, 'utf8'));
  for (const r of I.interpenetration) {
    if (!r.crossings || !r.box) continue;
    const ia = insts.find((i) => i.id === r.a), ib = insts.find((i) => i.id === r.b);
    // 相交段最长的节点对的范围中心
    const p = r.pairs.find((x) => x.crossings > 0);
    const at = [0, 1, 2].map((c) => (p.min[c] + p.max[c]) / 2);
    // 以 b 实例中心为内（世界坐标直接给）
    const cams0 = cams.length;
    const ctrW = [ib.position[0], at[1], ib.position[1]];
    let dx = at[0] - ctrW[0], dz = at[2] - ctrW[2];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    cams.push({ name: `inter-${r.a}-x-${r.b}`, inst: r.a + ',' + r.b, pos: [at[0] + dx * 6, at[1] + 3, at[2] + dz * 6].map(Q.f3), tgt: at.map(Q.f3), lens: 28, pair: p.pair });
    void cams0; void ia;
  }
}
fs.writeFileSync(outJ, JSON.stringify(cams, null, 1));
console.log('cams', cams.length);
