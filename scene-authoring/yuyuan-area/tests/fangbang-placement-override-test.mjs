// 方浜放置覆盖的两端一致性（wave10-streetfix R5；astra R4 终审必修项）。
//
// 背景：全域为避开 S05 需要把 S04-restaurant-b 平移 [+0.1236,0,−0.4845]（wave5 F-09）。这个平移只允许写在
// 全域制作侧的 baseline/fangbang-placement-overrides.json；仓库根 world/fangbang-temple-v7 是原 Three.js
// 客户端（src/world/WorldLoader.js）的共享数据集——它渲染 manifest.worldAssembly 整装 GLB，不按 instances 重放
// 店屋，只按 collision-world.json 建碰撞，所以共享数据集改位置 = 原客户端模型与碰撞错位。
//
// A) 原客户端一致性（只读仓库根源数据 + 整装 GLB 字节，与全域产物无关）：
//    对整装 GLB 里有 `<id>__N` 节点的每个 v7 实例：
//      A1 instances.json positionGlb / rotationYRad == GLB 节点平移 / 偏航（1e-3 m / 1e-3 rad）；
//      A2 该实例每条 collision-world 记录 obb.pos == GLB 节点平移（0.01 m）、theta == 偏航；
//      A3 该实例每条记录的 obbToWorld() 中心落在其 GLB 网格世界包围盒内（外扩 0.05 m；GLB 顶点逐个解析）。
// B) 全域产物对齐（OUT_DIR；FANGBANG=0 时跳过）：
//      B1 覆盖实例的全域节点世界位置 == v7 源位置 + translateGlb + 地图平移 (53.5,−17.4)（1e-3，期望值取源数据）；
//      B2 每个 fangbang-* 实例节点（extras.v7id）与 collision-fangbang.json 同名记录：obb.pos == 节点平移（0.01 m）、
//         theta == 节点偏航，记录条数 == v7 源记录条数（覆盖实例）；
//      B3 覆盖实例的每条碰撞 OBB 中心落在其全域模型网格世界包围盒内（外扩 0.05 m）。
// 用法：OUT_DIR=out-zone node tests/fangbang-placement-override-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';
import { readGlb } from '../../../src/world/glbReader.js';
import { loadOverrides } from '../scripts/fangbang-overrides.mjs';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AREA, '..', '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const FB7 = path.join(REPO, 'world', 'fangbang-temple-v7');
const OFF = [53.5, -17.4];
const POS_TOL = 1e-3, REC_TOL = 0.01, YAW_TOL = 1e-3, BOX_TOL = 0.05;

let pass = 0, fail = 0;
const ok = (msg, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg, detail); }
};
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const f4 = v => v.map(x => +x.toFixed(4));

// ---------- GLB：节点世界矩阵 + 子树网格顶点世界包围盒（独立于产物生成代码） ----------
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // 列主序：列 j = R 的第 j 列 × s_j
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, (2 * (qx * qy + qz * qw)) * sx, (2 * (qx * qz - qy * qw)) * sx, 0,
    (2 * (qx * qy - qz * qw)) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, (2 * (qy * qz + qx * qw)) * sy, 0,
    (2 * (qx * qz + qy * qw)) * sz, (2 * (qy * qz - qx * qw)) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    x, y, z, 1,
  ];
}
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
const xf = (m, p) => [0, 1, 2].map(k => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
const yawOf = m => Math.atan2(m[8], m[10]);   // 世界 +Z 列 (sinθ,·,cosθ) → 绕 +Y 偏航（与 obbToWorld 同向）

function loadGlbGraph(file) {
  const { gltf, bin } = readGlb(fs.readFileSync(file));
  const parent = new Map();
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const W = new Map();
  const world = i => {
    if (!W.has(i)) W.set(i, parent.has(i) ? mul(world(parent.get(i)), trs(gltf.nodes[i])) : trs(gltf.nodes[i]));
    return W.get(i);
  };
  const positions = ai => {
    const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || a.type !== 'VEC3') throw new Error(`${file}: POSITION accessor ${ai} is not float VEC3`);
    const stride = (bv.byteStride ?? 12) / 4;
    const f = new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), (a.count - 1) * stride + 3);
    return { f, stride, count: a.count };
  };
  // nodeIdxs 子树内全部网格顶点的世界包围盒
  const aabb = nodeIdxs => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const stack = [...nodeIdxs];
    let verts = 0;
    while (stack.length) {
      const i = stack.pop(), n = gltf.nodes[i];
      stack.push(...(n.children ?? []));
      if (n.mesh === undefined) continue;
      const m = world(i);
      for (const pr of gltf.meshes[n.mesh].primitives) {
        const { f, stride, count } = positions(pr.attributes.POSITION);
        for (let v = 0; v < count; v++) {
          const p = xf(m, [f[v * stride], f[v * stride + 1], f[v * stride + 2]]);
          for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
          verts++;
        }
      }
    }
    return { lo, hi, verts };
  };
  return { gltf, world, aabb };
}
const inBox = (c, b) => [0, 1, 2].every(k => c[k] >= b.lo[k] - BOX_TOL && c[k] <= b.hi[k] + BOX_TOL);

// ======================= A) 原客户端共享数据集 =======================
console.log('A) 原客户端 world/fangbang-temple-v7：instances / collision-world vs 整装 GLB');
const instDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'instances.json'), 'utf8'));
const colDoc = JSON.parse(fs.readFileSync(path.join(FB7, 'collision-world.json'), 'utf8'));
const man7 = JSON.parse(fs.readFileSync(path.join(FB7, 'review-manifest.json'), 'utf8'));
const asmPath = path.join(REPO, man7.worldAssembly.path.replace(/^\.\//, ''));
ok(`整装 GLB 存在且字节数 == manifest（${man7.worldAssembly.path}）`,
  fs.existsSync(asmPath) && fs.statSync(asmPath).size === man7.worldAssembly.bytes,
  fs.existsSync(asmPath) ? `bytes ${fs.statSync(asmPath).size} != ${man7.worldAssembly.bytes}` : 'missing');
const overrides = loadOverrides();
const overrideIds = new Set(overrides.map(o => o.id));
const recsOf = (doc, id) => doc.colliders.filter(r => r.name.split(':')[0] === id);
if (fs.existsSync(asmPath)) {
  const G = loadGlbGraph(asmPath);
  const byId = new Map();
  G.gltf.nodes.forEach((n, i) => {
    const m = /^(.+)__\d+$/.exec(n.name ?? '');
    if (m) { if (!byId.has(m[1])) byId.set(m[1], []); byId.get(m[1]).push(i); }
  });
  const covered = instDoc.instances.filter(i => byId.has(i.id));
  ok(`整装 GLB 实例节点组全部对应 v7 实例（${byId.size} 组）`, covered.length === byId.size && byId.size > 0,
    [...byId.keys()].filter(k => !instDoc.instances.some(i => i.id === k)).join(','));
  for (const id of overrideIds) ok(`覆盖实例 ${id} 在整装 GLB 中（原客户端按整装渲染它）`, byId.has(id));
  let a1Bad = [], a2Bad = [], a3Bad = [], nRec = 0;
  for (const it of covered) {
    const idxs = byId.get(it.id);
    const mats = idxs.map(i => G.world(i));
    const t = [mats[0][12], mats[0][13], mats[0][14]], yaw = yawOf(mats[0]);
    const sameNodes = mats.every(m => Math.hypot(m[12] - t[0], m[13] - t[1], m[14] - t[2]) < 1e-6);
    const dPos = Math.hypot(it.positionGlb[0] - t[0], it.positionGlb[1] - t[1], it.positionGlb[2] - t[2]);
    if (!sameNodes || dPos > POS_TOL || angDiff(it.rotationYRad, yaw) > YAW_TOL)
      a1Bad.push(`${it.id} inst ${it.positionGlb} vs glb ${f4(t)} (Δ${dPos.toFixed(4)} m, Δyaw ${angDiff(it.rotationYRad, yaw).toFixed(4)})`);
    const box = G.aabb(idxs);
    for (const r of recsOf(colDoc, it.id)) {
      nRec++;
      if (r.obb) {
        const d = Math.hypot(r.obb.pos[0] - t[0], (r.obb.pos[1] ?? 0) - t[1], r.obb.pos[2] - t[2]);
        if (d > REC_TOL || angDiff(r.obb.theta, yaw) > YAW_TOL) a2Bad.push(`${r.name} obb.pos ${r.obb.pos} vs glb ${f4(t)} (Δ${d.toFixed(4)} m)`);
      }
      const c = obbToWorld(r).center;
      if (!inBox(c, box)) a3Bad.push(`${r.name} center ${f4(c)} ∉ glb aabb ${f4(box.lo)}…${f4(box.hi)}`);
    }
  }
  console.log(`  (A 覆盖 ${covered.length} 个实例、${nRec} 条碰撞记录：${covered.map(i => i.id).join(', ')})`);
  ok(`A1 instances.json 位置/偏航 == 整装 GLB 节点（${covered.length} 实例，≤${POS_TOL} m）`, !a1Bad.length, a1Bad.join('; '));
  ok(`A2 collision-world obb.pos/theta == 整装 GLB 节点（${nRec} 记录，≤${REC_TOL} m）`, !a2Bad.length, `${a2Bad.length} bad: ${a2Bad.slice(0, 4).join('; ')}`);
  ok(`A3 collision-world OBB 中心 ∈ 整装 GLB 网格包围盒（外扩 ${BOX_TOL} m）`, !a3Bad.length, `${a3Bad.length} bad: ${a3Bad.slice(0, 4).join('; ')}`);
}

// ======================= B) 全域产物 =======================
console.log(`B) 全域产物 ${path.relative(AREA, OUT)}：覆盖实例模型与碰撞对齐`);
if (process.env.FANGBANG === '0') {
  console.log('  SKIP B（FANGBANG=0：方浜分区未构建）');
} else {
  const zoneFiles = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => /^zone-fangbang(-\d+)?\.glb$/.test(f)).sort() : [];
  const colFile = path.join(OUT, 'collision-fangbang.json');
  ok('全域产物 zone-fangbang-*.glb 与 collision-fangbang.json 存在', zoneFiles.length > 0 && fs.existsSync(colFile), `zone files ${zoneFiles.length}`);
  if (zoneFiles.length && fs.existsSync(colFile)) {
    const fbCol = JSON.parse(fs.readFileSync(colFile, 'utf8'));
    const src = new Map(instDoc.instances.map(i => [i.id, i]));
    const anchors = new Map();   // v7id -> { G, idx }
    for (const f of zoneFiles) {
      const G = loadGlbGraph(path.join(OUT, f));
      G.gltf.nodes.forEach((n, i) => { const v = n.extras?.v7id; if (v && n.name === `fangbang-${v}`) anchors.set(v, { G, idx: i, file: f }); });
    }
    // B1：覆盖实例位置 = 源 + 覆盖 + 地图平移
    for (const ov of overrides) {
      const a = anchors.get(ov.id), s = src.get(ov.id);
      if (!a) { ok(`B1 ${ov.id} 在全域方浜分区中放置`, false, 'node fangbang-' + ov.id + ' missing'); continue; }
      const m = a.G.world(a.idx), t = [m[12], m[13], m[14]];
      const exp = [s.positionGlb[0] + ov.translateGlb[0] + OFF[0], s.positionGlb[1] + ov.translateGlb[1], s.positionGlb[2] + ov.translateGlb[2] + OFF[1]];
      const d = Math.hypot(t[0] - exp[0], t[1] - exp[1], t[2] - exp[2]);
      ok(`B1 ${ov.id} 全域节点 ${f4(t)} == v7 源 ${s.positionGlb} + 覆盖 ${ov.translateGlb} + (53.5,−17.4) = ${f4(exp)}（Δ${d.toExponential(2)}）`,
        d <= POS_TOL && angDiff(yawOf(m), s.rotationYRad) <= YAW_TOL);
    }
    // B2：所有 fangbang 实例节点 vs 同名碰撞记录
    let b2Bad = [], nB2 = 0;
    for (const [v7id, a] of anchors) {
      const m = a.G.world(a.idx), t = [m[12], m[13], m[14]], yaw = yawOf(m);
      for (const r of fbCol.colliders.filter(r => r.name.split(':')[0] === `fangbang-${v7id}` && r.obb)) {
        if (!recsOf(colDoc, v7id).length) continue;   // sidecar / 补齐件另有测试（fangbang-test W4/W6）
        const srcRec = recsOf(colDoc, v7id).find(q => q.name === r.name.replace(/^fangbang-/, ''));
        const srcRel = srcRec?.obb ? [srcRec.obb.pos[0] - src.get(v7id).positionGlb[0], srcRec.obb.pos[2] - src.get(v7id).positionGlb[2]] : [0, 0];
        if (Math.hypot(...srcRel) > REC_TOL) continue;   // 源记录本身按部件定位（非实例原点），不适用 pos==节点
        nB2++;
        const d = Math.hypot(r.obb.pos[0] - t[0], (r.obb.pos[1] ?? 0) - t[1], r.obb.pos[2] - t[2]);
        if (d > REC_TOL || angDiff(r.obb.theta, yaw) > YAW_TOL) b2Bad.push(`${r.name} pos ${r.obb.pos} vs node ${f4(t)} (Δ${d.toFixed(4)})`);
      }
    }
    ok(`B2 全域 fangbang 实例节点 == collision-fangbang 同名记录 obb.pos/theta（${anchors.size} 节点，${nB2} 记录，≤${REC_TOL} m）`,
      !b2Bad.length && nB2 > 0, `${b2Bad.length} bad: ${b2Bad.slice(0, 4).join('; ')}`);
    // B3：覆盖实例碰撞 OBB 中心 ∈ 全域模型网格包围盒；记录数 == v7 源
    for (const ov of overrides) {
      const a = anchors.get(ov.id);
      if (!a) continue;
      const box = a.G.aabb([a.idx]);
      const recs = fbCol.colliders.filter(r => r.name.split(':')[0] === `fangbang-${ov.id}`);
      ok(`B3 ${ov.id} collision-fangbang 记录数 ${recs.length} == v7 源 ${recsOf(colDoc, ov.id).length}`, recs.length === recsOf(colDoc, ov.id).length && recs.length > 0);
      const bad = recs.filter(r => !inBox(obbToWorld(r).center, box)).map(r => `${r.name} ${f4(obbToWorld(r).center)}`);
      ok(`B3 ${ov.id} 碰撞 OBB 中心 ∈ 全域模型网格包围盒 ${f4(box.lo)}…${f4(box.hi)}（${box.verts} 顶点，外扩 ${BOX_TOL} m）`, !bad.length, bad.join('; '));
    }
  }
}

console.log(`fangbang-placement-override-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
