// wave8-smallqa Q2 新检测测试（参数级修复的回归测试）。
// 检两项（都是 2026-09-26 Q1 普查发现、Q2 参数级修复）：
//   1) 长凳成排间距：同 cluster、同 rotY 的相邻长凳沿凳轴间距 ≥ 模块长 1.6 m + 0.05 m 余量
//      （旧产物 0.8 m 半叠——stall-49/50/51 两两咬合 46 交线/5.06 m）。
//   2) 檐棚 × 商城楼构件：任一檐棚布面（awning_cloth）与塔楼套件 GLB 的交线 ≤ 50 条 / 5 m
//      （旧产物 awning-bld-389701812-5 与塔楼灯笼串/牌匾 612 交线 / 51.0 m，2026-09-26 塔楼默认开后出现）。
// 用法：OUT_DIR=out-zone node tests/smallqa-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './smallqa-lib.mjs';
import * as T from './templeqa-lib.mjs';

const ROOT = Q.ROOT;
const OUT_DIR = process.env.OUT_DIR || 'out-zone';
let npass = 0, nfail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { npass++; console.log('PASS', name); }
  else { nfail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
};

// ---------- 1) 长凳成排间距 ----------
{
  const benches = Q.stallInstances().filter((s) => s.kind === 'bench');
  const benchLen = 1.6, margin = 0.05;
  const bad = [];
  for (let a = 0; a < benches.length; a++) for (let b = a + 1; b < benches.length; b++) {
    const A = benches[a], B = benches[b];
    if (A.cluster !== B.cluster) continue;
    if (Math.abs(A.rotY - B.rotY) > 1e-3) continue;
    const dx = B.position[0] - A.position[0], dz = B.position[1] - A.position[1];
    // 沿凳轴（local X → 地图 (cos, -sin)）的投影距离
    const along = dx * Math.cos(A.rotY) - dz * Math.sin(A.rotY);
    const lateral = Math.abs(dx * Math.sin(A.rotY) + dz * Math.cos(A.rotY));
    if (lateral > 0.3) continue;                       // 不同排
    if (Math.abs(along) < benchLen + margin && Math.abs(along) > 1e-6) bad.push({ a: A.id, b: B.id, along: +along.toFixed(3) });
  }
  ok('bench-row-spacing', bad.length === 0, JSON.stringify(bad));
}

// ---------- 2) 檐棚 × 塔楼构件 ----------
{
  const zoneTowers = path.join(ROOT, OUT_DIR, 'zone-bazaar-3.glb');
  if (!fs.existsSync(zoneTowers)) {
    console.log('SKIP awning-tower-clearance -', zoneTowers, 'missing (BAZAAR_TOWERS=0?)');
  } else {
    const towers = Q.readGlbTree(zoneTowers, { anchorRe: /^bld-/, normLimit: 1e6 });
    const towerTris = [];
    for (const n of towers.nodes) for (let t = 0; t < n.T.length / 3; t++) {
      const A = [n.P[n.T[t * 3] * 3], n.P[n.T[t * 3] * 3 + 1], n.P[n.T[t * 3] * 3 + 2]];
      const B = [n.P[n.T[t * 3 + 1] * 3], n.P[n.T[t * 3 + 1] * 3 + 1], n.P[n.T[t * 3 + 1] * 3 + 2]];
      const C = [n.P[n.T[t * 3 + 2] * 3], n.P[n.T[t * 3 + 2] * 3 + 1], n.P[n.T[t * 3 + 2] * 3 + 2]];
      towerTris.push({ A, B, C, node: n.name,
        min: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])],
        max: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])] });
    }
    const g = new Map();
    for (const [i, t] of towerTris.entries())
      for (let x = Math.floor(t.min[0]); x <= Math.floor(t.max[0]); x++)
        for (let y = Math.floor(t.min[1]); y <= Math.floor(t.max[1]); y++)
          for (let z = Math.floor(t.min[2]); z <= Math.floor(t.max[2]); z++) {
            const k = x + ',' + y + ',' + z;
            if (!g.has(k)) g.set(k, []);
            g.get(k).push(i);
          }
    const MAX_CROSS = 50, MAX_LEN = 5.0;
    const bad = [];
    for (const a of Q.awningInstances()) {
      const mod = Q.readGlbTree(path.join(ROOT, 'out-bazaar-stalls', a.module));
      const cloth = Q.bakeWorld(mod.nodes.filter((n) => n.name === 'awning_cloth'), a);
      const tris = [];
      for (const n of cloth) for (let t = 0; t < n.T.length / 3; t++) {
        const A = [n.P[n.T[t * 3] * 3], n.P[n.T[t * 3] * 3 + 1], n.P[n.T[t * 3] * 3 + 2]];
        const B = [n.P[n.T[t * 3 + 1] * 3], n.P[n.T[t * 3 + 1] * 3 + 1], n.P[n.T[t * 3 + 1] * 3 + 2]];
        const C = [n.P[n.T[t * 3 + 2] * 3], n.P[n.T[t * 3 + 2] * 3 + 1], n.P[n.T[t * 3 + 2] * 3 + 2]];
        tris.push({ A, B, C,
          min: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])],
          max: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])] });
      }
      let crossings = 0, len = 0;
      for (const t of tris) {
        const cand = new Set();
        for (let x = Math.floor(t.min[0]); x <= Math.floor(t.max[0]); x++)
          for (let y = Math.floor(t.min[1]); y <= Math.floor(t.max[1]); y++)
            for (let z = Math.floor(t.min[2]); z <= Math.floor(t.max[2]); z++)
              for (const j of g.get(x + ',' + y + ',' + z) || []) cand.add(j);
        for (const j of cand) {
          const u = towerTris[j];
          if (t.max[0] < u.min[0] || u.max[0] < t.min[0] || t.max[1] < u.min[1] || u.max[1] < t.min[1] || t.max[2] < u.min[2] || u.max[2] < t.min[2]) continue;
          const r = T.triTri(t, u);
          if (r && !r.coplanar) { crossings++; len += r.len; }
        }
      }
      if (crossings > MAX_CROSS || len > MAX_LEN) bad.push({ awning: a.id, crossings, lenM: +len.toFixed(2) });
    }
    ok('awning-tower-clearance', bad.length === 0, JSON.stringify(bad));
  }
}

console.log(`smallqa-test: ${npass} pass, ${nfail} fail`);
if (nfail) { console.log('failures:', failures.join(' | ')); process.exit(1); }
