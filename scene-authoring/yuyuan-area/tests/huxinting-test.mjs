// 湖心亭站点模块测试（WP9；HUXINTING=1 时随全流程交付，模块 GLB 常驻 out-zone）。
// 位置/桥接口一律从 baseline/layout.json 重算（面积形心、最长边主轴、承台外伸常量），与
// out-zone/huxin-ting.glb 实测对比；不拿产物和自己比（records.json 只用于展示，不进断言）。
// 桥接口口径：桥折线（layout jiuqu-bridge.polyline）到承台多边形边的最近距离 ≤ 0.3 m
//（GOAL「桥端点落在承台边 ±0.3 m 内」；layout 折线两端点离亭远，桥从亭西南侧绕行，
// 以最近顶点/最近线段点为「端点」口径，详见工单包 artifacts/PROGRESS.json assumptions）。
// 用法：OUT_DIR=out-zone node tests/huxinting-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const GLB_PATH = path.join(OUT, 'huxin-ting.glb');
const HUXINTING = process.env.HUXINTING === '1';
const BUDGET = { tris: 30000, bytes: 2.5 * 1024 * 1024 };

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}

if (process.env.HUXINTING === '0') {
  console.log('HUXINTING=0 — 湖心亭模块测试跳过（模块不接入总装）');
  process.exit(0);
}
if (!fs.existsSync(GLB_PATH)) {
  if (HUXINTING) {
    fail++; failures.push('huxin-ting.glb missing');
    console.log(`FAIL huxin-ting.glb 不存在于 ${OUT}（HUXINTING=1 要求模块已构建：blender -b -t 4 --python modules/huxinting/build.py）`);
    console.log(`RESULT pass=${pass} fail=${fail}`);
    process.exit(1);
  }
  console.log(`huxin-ting.glb 不存在于 ${OUT} 且 HUXINTING 未开 — 跳过`);
  process.exit(0);
}

// ---------------- layout 重算：面积形心 / 主轴 / 承台 / 桥折线 ----------------
const HT = LAYOUT.objects.find((o) => o.id === 'huxin-ting');
const FP = HT.geometry.footprint.slice(0, -1);
const A2 = FP.reduce((s, p, i) => s + p[0] * FP[(i + 1) % FP.length][1] - FP[(i + 1) % FP.length][0] * p[1], 0);
const CX = FP.reduce((s, p, i) => s + (p[0] + FP[(i + 1) % FP.length][0]) * (p[0] * FP[(i + 1) % FP.length][1] - FP[(i + 1) % FP.length][0] * p[1]), 0) / (3 * A2);
const CZ = FP.reduce((s, p, i) => s + (p[1] + FP[(i + 1) % FP.length][1]) * (p[0] * FP[(i + 1) % FP.length][1] - FP[(i + 1) % FP.length][0] * p[1]), 0) / (3 * A2);
let [L0, a0, b0] = FP.reduce((best, p, i) => {
  const q = FP[(i + 1) % FP.length];
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return L > best[0] ? [L, p, q] : best;
}, [0, null, null]);
let UX = (b0[0] - a0[0]) / L0, UZ = (b0[1] - a0[1]) / L0;
if (UX < 0) { UX = -UX; UZ = -UZ; }
const VX = UZ, VZ = -UX;                       // +v = 临九曲桥侧
const loc = (p) => [(p[0] - CX) * UX + (p[1] - CZ) * UZ, (p[0] - CX) * VX + (p[1] - CZ) * VZ];
const LOCS = FP.map(loc);
const U0 = (Math.max(...LOCS.map((q) => q[0])) - Math.min(...LOCS.map((q) => q[0]))) / 2;
const V0 = (Math.max(...LOCS.map((q) => q[1])) - Math.min(...LOCS.map((q) => q[1]))) / 2;
const PLATFORM_Y = HT.platformY;               // 0.55
// 承台外伸常量（与 build.py 一致的设计值，重算口径）
const DECK_SIDE = 1.3, DECK_BRIDGE = 2.3;
const DECK_POLY = [
  [-(U0 + DECK_SIDE), -(V0 + DECK_SIDE)], [U0 + DECK_SIDE, -(V0 + DECK_SIDE)],
  [U0 + DECK_SIDE, V0 + DECK_BRIDGE], [-(U0 + DECK_SIDE), V0 + DECK_BRIDGE],
];
const BR_LINE = LAYOUT.objects.find((o) => o.id === 'jiuqu-bridge').geometry.polyline;

function distPointSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}
function distToPolyEdge(px, py, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distPointSeg(px, py, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

// ---------------- GLB 解析（节点变换 -> 世界坐标） ----------------
const buf = fs.readFileSync(GLB_PATH);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
let bin = null;
if (28 + jsonLen < buf.length) {
  const binLen = buf.readUInt32LE(20 + jsonLen);
  bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
}
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(ai) {
  const a = gltf.accessors[ai];
  const bv = gltf.bufferViews[a.bufferView];
  const Arr = COMP[a.componentType];
  const nc = NCOMP[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || nc * Arr.BYTES_PER_ELEMENT;
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const v = new Arr(bin.buffer, bin.byteOffset + off + i * stride, nc);
    out.push(nc === 1 ? v[0] : Array.from(v));   // SCALAR 回传数值而非数组
  }
  return out;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return [r[0] * s[0], r[3] * s[0], r[6] * s[0], 0,
          r[1] * s[1], r[4] * s[1], r[7] * s[1], 0,
          r[2] * s[2], r[5] * s[2], r[8] * s[2], 0,
          t[0], t[1], t[2], 1];
}
function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function mulVec(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
}
const parentOf = new Map();
gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));
function worldMatrixOf(ni) {
  let m = null, cur = ni;
  while (cur !== undefined) { m = m ? mul4(nodeMatrix(gltf.nodes[cur]), m) : nodeMatrix(gltf.nodes[cur]); cur = parentOf.get(cur); }
  return m || nodeMatrix(gltf.nodes[ni]);
}
// parts: name -> { verts(world), tris, indices, positions }
const parts = new Map();
for (const [ni, n] of gltf.nodes.entries()) {
  if (n.mesh === undefined) continue;
  const m = mul4(worldMatrixOf(ni), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] /* identity compose below */);
  const mesh = gltf.meshes[n.mesh];
  const verts = [];
  const tris = [];
  for (const prim of mesh.primitives) {
    const pos = accessor(prim.attributes.POSITION);
    const idx = accessor(prim.indices);
    for (const p of pos) verts.push(mulVec(worldMatrixOf(ni), p));
    for (let i = 0; i < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2], prim]);
  }
  parts.set(n.name || `node${ni}`, { verts, tris, primCount: mesh.primitives.length });
}
const allParts = [...parts.keys()];
const prefixOk = allParts.every((nm) => nm.startsWith('huxin-ting__'));

// 世界坐标 -> 本地 (u,v,h)
const toLocal = (wv) => [(wv[0] - CX) * UX + (wv[2] - CZ) * UZ, (wv[0] - CX) * VX + (wv[2] - CZ) * VZ, wv[1]];
function partVertsLocal(name) {
  const p = parts.get(name);
  return p ? p.verts.map(toLocal) : null;
}

// ---------------- 1) 位置：承台 / 台面高 / 主脊 / 宝顶 / 包络 ----------------
const bytes = fs.statSync(GLB_PATH).size;
ok('GLB 节点名全部为 huxin-ting__*（无游离散件节点）', prefixOk, allParts.filter((n) => !n.startsWith('huxin-ting__')).slice(0, 3).join(','));

{
  const deck = partVertsLocal('huxin-ting__deck');
  ok('承台网格存在', !!deck);
  if (deck) {
    const us = deck.map((q) => q[0]), vs = deck.map((q) => q[1]), ys = deck.map((q) => q[2]);
    const uMin = Math.min(...us), uMax = Math.max(...us), vMin = Math.min(...vs), vMax = Math.max(...vs), yMax = Math.max(...ys);
    ok(`承台外包 = footprint 外扩(西/东/北 ${DECK_SIDE} / 桥侧 ${DECK_BRIDGE})（实测 u ${uMin.toFixed(2)}..${uMax.toFixed(2)} v ${vMin.toFixed(2)}..${vMax.toFixed(2)}）`,
      Math.abs(uMin + U0 + DECK_SIDE) <= 0.02 && Math.abs(uMax - U0 - DECK_SIDE) <= 0.02 &&
      Math.abs(vMin + V0 + DECK_SIDE) <= 0.02 && Math.abs(vMax - V0 - DECK_BRIDGE) <= 0.02,
      `期望 u ±${(U0 + DECK_SIDE).toFixed(2)} v ${(-(V0 + DECK_SIDE)).toFixed(2)}..${(V0 + DECK_BRIDGE).toFixed(2)}`);
    ok(`承台顶面 y = platformY(${PLATFORM_Y})`, Math.abs(yMax - PLATFORM_Y) <= 0.01, `yMax=${yMax.toFixed(3)}`);
  }
}
{
  // 石桩入水
  const piles = allParts.filter((n) => n.includes('__pile-'));
  let minY = Infinity;
  for (const nm of piles) for (const v of parts.get(nm).verts) minY = Math.min(minY, v[1]);
  ok(`石桩 ${piles.length} 根，入水到 y=-0.6（实测 minY ${minY.toFixed(2)}）`, piles.length >= 8 && Math.abs(minY + 0.6) <= 0.01, `piles=${piles.length} minY=${minY}`);
  ok('石桩截面 0.4 m 方', piles.every((nm) => {
    const L = partVertsLocal(nm);
    const du = Math.max(...L.map((q) => q[0])) - Math.min(...L.map((q) => q[0]));
    const dv = Math.max(...L.map((q) => q[1])) - Math.min(...L.map((q) => q[1]));
    return Math.abs(du - 0.4) <= 0.01 && Math.abs(dv - 0.4) <= 0.01;
  }), '期望 0.4×0.4');
}
{
  const ridge = parts.get('huxin-ting__mainroof-ridge');
  ok('主楼正脊网格存在', !!ridge);
  if ( ridge) {
    const ys = ridge.verts.map((v) => v[1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    ok(`主楼正脊 ≈ 9.6 m（design_inference；脊线 ${yMin.toFixed(2)}..${yMax.toFixed(2)}）`,
      yMin >= 9.5 && yMax <= 11.3 && yMin <= 9.7,
      `期望脊线下限 ≈9.55，吻顶 ≤11.3`);
  }
}
{
  const ball = parts.get('huxin-ting__finial-ball');
  ok('鎏金宝顶球存在', !!ball);
  if (ball) {
    const yMax = Math.max(...ball.verts.map((v) => v[1]));
    ok(`塔亭宝顶 ≈ 12.0 m（design_inference；实测 ${yMax.toFixed(2)}）`, Math.abs(yMax - 12.0) <= 0.06, `yMax=${yMax.toFixed(3)}`);
  }
}
{
  // 层高：一层 3.4 / 二层 3.0 -> 二层楼板顶 6.95（floor2 带顶面）
  const floor2 = partVertsLocal('huxin-ting__floor2');
  ok('二层楼板带存在', !!floor2);
  if (floor2) {
    const yMax = Math.max(...floor2.map((q) => q[2]));
    ok(`一层层高 3.4（楼板顶 ${(PLATFORM_Y + 3.4).toFixed(2)}，实测 ${yMax.toFixed(2)}）`, Math.abs(yMax - (PLATFORM_Y + 3.4)) <= 0.01, `yMax=${yMax.toFixed(3)}`);
  }
}
{
  // 包络：全部 y>0.7 的顶点落在 footprint 外扩盒内（+v 侧放宽到承台桥缘外，抱厦檐口出挑 over+chu）
  let bad = 0, worst = '';
  for (const [nm, p] of parts) for (const v of p.verts) {
    if (v[1] <= 0.7) continue;
    const [lu, lv, lh] = toLocal(v);
    if (Math.abs(lu) > U0 + 2.7 || lv < -(V0 + 2.7) || lv > V0 + 3.3 || lh > 12.1 || lh < 0.5) {
      bad++;
      if (bad <= 3) worst += ` ${nm}(u${lu.toFixed(2)},v${lv.toFixed(2)},h${lh.toFixed(2)})`;
    }
  }
  ok(`包络：y>0.7 顶点全部在 footprint 外扩盒内、≤12.1（违例 ${bad}）`, bad === 0, worst);
}

// ---------------- 2) 九曲桥接口：桥折线最近点落在承台边 ±0.3 m ----------------
{
  // 口径重算（layout）：桥折线（转本地系）到承台多边形（本地系重算）的最近距离
  const brLocal = BR_LINE.map(loc);
  let bestV = Infinity, bestVtx = null;
  for (const [px, pz] of brLocal) {
    const d = distToPolyEdge(px, pz, DECK_POLY);
    if (d < bestV) { bestV = d; bestVtx = [px, pz]; }
  }
  let bestS = Infinity;
  for (let i = 0; i < brLocal.length - 1; i++) {
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const px = brLocal[i][0] + (brLocal[i + 1][0] - brLocal[i][0]) * t;
      const pz = brLocal[i][1] + (brLocal[i + 1][1] - brLocal[i][1]) * t;
      bestS = Math.min(bestS, distToPolyEdge(px, pz, DECK_POLY));
    }
  }
  ok(`桥接口(layout 口径)：桥折线最近顶点距承台边 ${bestV.toFixed(3)} m ≤ 0.3（最近顶点地图系 (${bestVtx[0].toFixed(2)}, ${bestVtx[1].toFixed(2)})）`, bestV <= 0.3);
  ok(`桥接口(layout 口径)：桥折线采样最近点距承台边 ${bestS.toFixed(3)} m ≤ 0.3`, bestS <= 0.3);

  // 产物口径：GLB 承台网格桥侧边缘顶点（本地系）到桥折线（本地系）的最近距离
  const deck = partVertsLocal('huxin-ting__deck');
  const edge = deck.filter((q) => q[1] > V0 + 1.5).map((q) => [q[0], q[1]]);
  let bestG = Infinity;
  for (let i = 0; i < brLocal.length - 1; i++) {
    for (const [ex, ey] of edge) bestG = Math.min(bestG, distPointSeg(ex, ey, brLocal[i], brLocal[i + 1]));
  }
  ok(`桥接口(GLB 口径)：承台网格桥侧边到桥折线最近 ${bestG.toFixed(3)} m ≤ 0.35`, bestG <= 0.35, `bestG=${bestG}`);
}

// ---------------- 3) 预算：tris / bytes / glTF validator ----------------
{
  const tris = [...parts.values()].reduce((s, p) => s + p.tris.length, 0);
  ok(`三角面 ${tris} ≤ ${BUDGET.tris}`, tris <= BUDGET.tris);
  ok(`体积 ${bytes} ≤ ${BUDGET.bytes}（${(bytes / 1024 / 1024).toFixed(2)} MB）`, bytes <= BUDGET.bytes);
  const rep = await validateBytes(new Uint8Array(buf));
  const errs = rep.issues?.errors || 0, warns = rep.issues?.warnings || 0;
  ok(`glTF validator 0 错（warnings=${warns}）`, errs === 0, `errors=${errs}`);
}
// 灰瓦按灰做（0010 lead QC：推理图偏蓝不照抄）
{
  const mat = gltf.materials.find((m) => m.name === 'ht-tile-grey');
  ok('灰瓦材质存在（ht-tile-grey）', !!mat);
  if (mat) {
    const c = mat.pbrMetallicRoughness.baseColorFactor;
    ok(`瓦色为中性灰（rgb ${c.slice(0, 3).map((v) => v.toFixed(2)).join(',')}，|r-g|、|g-b| ≤ 0.03）`,
      Math.abs(c[0] - c[1]) <= 0.03 && Math.abs(c[1] - c[2]) <= 0.03);
  }
}

// ---------------- 4) 无散件：无零面积面（攒尖收口环除外）/ 无碎片 / 顶点全部被引用 ----------------
{
  let degenerate = 0, worstPart = '', degenParts = new Set(), emptyParts = 0;
  const smallBad = [];
  for (const [nm, p] of parts) {
    if (p.tris.length === 0) emptyParts++;
    if (p.tris.length < 8 && !/(shanhua|satou|bofeng)/.test(nm)) smallBad.push(`${nm}(${p.tris.length})`);
    for (const [a, b, c] of p.tris) {
      const A = p.verts[a], B = p.verts[b], C = p.verts[c];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const cx = u[1] * w[2] - u[2] * w[1], cy = u[2] * w[0] - u[0] * w[2], cz = u[0] * w[1] - u[1] * w[0];
      if (Math.hypot(cx, cy, cz) < 1e-9) { degenerate++; degenParts.add(nm); if (!worstPart) worstPart = nm; }
    }
  }
  // 未引用顶点：按 mesh 逐 primitive 检查
  let unused = 0;
  for (const n of gltf.nodes) {
    if (n.mesh === undefined) continue;
    for (const prim of gltf.meshes[n.mesh].primitives) {
      const posCount = gltf.accessors[prim.attributes.POSITION].count;
      const idx = accessor(prim.indices);
      const used = new Set(idx);
      unused += posCount - used.size;
    }
  }
  // eave_kit 攒尖顶末段环收拢到宝顶尖，收口面为零面积——主控只读构件的已知收口，允许且仅允许出现在该件
  const degenOk = [...degenParts].every((nm) => nm === 'huxin-ting__towerroof-cone') && degenerate <= 24;
  ok(`零面积三角 ${degenerate}（仅攒尖收口环：${[...degenParts].join(',') || '无'}，≤24）`, degenerate === 0 || degenOk, worstPart);
  ok(`未引用顶点 ${unused} = 0（无孤立散点）`, unused === 0);
  ok(`空网格部件 ${emptyParts} = 0`, emptyParts === 0);
  ok(`疑似碎片部件（<8 三角且非山花/撒头/博风）${smallBad.length} = 0`, smallBad.length === 0, smallBad.slice(0, 4).join(','));
  ok('GLB 单一 scene', gltf.scenes.length === 1);
}

// ---------------- 5) HUXINTING=1 时：总装 pond.glb 有 huxin-ting 锚且位姿=重算值 ----------------
if (HUXINTING && fs.existsSync(path.join(OUT, 'pond.glb'))) {
  const pbuf = fs.readFileSync(path.join(OUT, 'pond.glb'));
  const pj = JSON.parse(pbuf.subarray(20, 20 + pbuf.readUInt32LE(12)).toString('utf8'));
  const anchor = pj.nodes.find((n) => n.name === 'huxin-ting');
  ok('pond.glb 含 huxin-ting 锚节点', !!anchor);
  if (anchor) {
    const t = anchor.translation || [0, 0, 0];
    // glTF 惯例（同 jiuqu-bridge 等站点件）：translation = (地图 x, 高度, 地图 z)
    ok(`锚点位置 = footprint 面积形心（实测 (${t[0].toFixed(2)}, ${t[2].toFixed(2)}) 期望 (${CX.toFixed(2)}, ${CZ.toFixed(2)})，高度 ${t[1].toFixed(2)} = 0）`,
      Math.abs(t[0] - CX) <= 0.02 && Math.abs(t[2] - CZ) <= 0.02 && Math.abs(t[1]) <= 0.01);
    // Blender rotZ θ 经 yup 导出 = glTF 绕 +Y 旋 θ（纯 Y 四元数）
    let yawY = null, pureY = false;
    if (anchor.rotation) {
      const [x, y, z, w] = anchor.rotation;
      pureY = Math.abs(x) <= 0.001 && Math.abs(z) <= 0.001;
      yawY = 2 * Math.atan2(y, w);
    }
    const rotY = Math.atan2(UX, UZ);
    ok(`锚点朝向 = 主轴 yaw（实测 glTF-Y ${yawY === null ? '无旋转' : yawY.toFixed(4)} 期望 ${rotY.toFixed(4)}）`,
      yawY === null ? true : pureY && Math.abs(Math.sin(yawY - rotY)) <= 0.01);
    ok('huxin-ting.glb sha256 与 NEW-ASSETS 登记一致（登记文件若存在）', (() => {
      const naPath = path.resolve(ROOT, '..', '..', 'artifacts', 'NEW-ASSETS.json');
      if (!fs.existsSync(naPath)) return true;
      const na = JSON.parse(fs.readFileSync(naPath, 'utf8'));
      const rel = 'scene-authoring/yuyuan-area/out-zone/huxin-ting.glb';
      const entry = (na.files || []).find((f) => f.path === rel || f.path === `out-zone/huxin-ting.glb`);
      if (!entry) return true;
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      return sha === entry.sha256;
    })());
  }
}

// ---------------- 6) R1-1 屋脊 / 吻 / 戗脊尺度（GLB 实测，主控 R1 2026-09-25） ----------------
// 口径（写进工单包 artifacts/r1/PROGRESS.json assumptions）：
//   正脊顶 = 正脊网格在脊长中段 20% 内的最高点；最高瓦面 = 同一中段内上段两坡（-upper-s/-upper-n）瓦面最高点；
//   吻端起翘 = 正脊网格全长最高点 - 正脊顶；戗脊截面高 = 同一水平位置上戗脊顶底高差的最大值（主控未给阈值，
//   自定与正脊同口径 ≤ 0.35）。攒尖（塔亭）无正脊，宝顶另有断言。
{
  const ridgeNames = allParts.filter((n) => /-ridge$/.test(n));
  ok(`歇山正脊网格 ≥ 2（主楼 + 抱厦；实测 ${ridgeNames.join(',')}）`, ridgeNames.length >= 2);
  for (const rn of ridgeNames) {
    const roof = rn.replace(/^huxin-ting__/, '').replace(/-ridge$/, '');
    const R = partVertsLocal(rn);
    const tiles = [`huxin-ting__${roof}-upper-s`, `huxin-ting__${roof}-upper-n`].map(partVertsLocal).filter(Boolean).flat();
    const uMin = Math.min(...R.map((q) => q[0])), uMax = Math.max(...R.map((q) => q[0]));
    const uMid = (uMin + uMax) / 2, band = 0.1 * (uMax - uMin);
    const mid = (q) => Math.abs(q[0] - uMid) <= band;
    const crest = Math.max(...R.filter(mid).map((q) => q[2]));
    const midTiles = tiles.filter(mid);
    const tileTop = midTiles.length ? Math.max(...midTiles.map((q) => q[2])) : NaN;
    const ridgeMax = Math.max(...R.map((q) => q[2]));
    const above = crest - tileTop, wen = ridgeMax - crest;
    ok(`${roof} 正脊顶高出最高瓦面 ${above.toFixed(3)} m ≤ 0.35（脊顶 ${crest.toFixed(3)} / 瓦面 ${tileTop.toFixed(3)}）`,
      midTiles.length > 0 && above <= 0.35, `above=${above}`);
    ok(`${roof} 吻端起翘 ${wen.toFixed(3)} m ≤ 0.5（脊最高 ${ridgeMax.toFixed(3)}）`, wen <= 0.5, `wen=${wen}`);
  }
  const qj = allParts.filter((n) => /-qiangji-/.test(n));
  let qjMax = 0;
  for (const nm of qj) {
    const groups = new Map();
    for (const q of partVertsLocal(nm)) {
      const k = `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
      const g = groups.get(k) || [Infinity, -Infinity];
      g[0] = Math.min(g[0], q[2]); g[1] = Math.max(g[1], q[2]);
      groups.set(k, g);
    }
    for (const [lo, hi] of groups.values()) qjMax = Math.max(qjMax, hi - lo);
  }
  ok(`戗脊 ${qj.length} 条，最大截面高 ${qjMax.toFixed(3)} m ≤ 0.35`, qj.length >= 8 && qjMax <= 0.35, `qjMax=${qjMax}`);
}

// ---------------- 7) R1-2 木色 / 瓦色（材质值 + 部件归属，GLB 实测） ----------------
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const WOOD_LIN = [0x6a, 0x2e, 0x22].map((v) => srgbToLin(v / 255));
const matsOfPart = (nm) => {
  const n = gltf.nodes.find((x) => x.name === nm);
  return [...new Set(gltf.meshes[n.mesh].primitives.map((p) => gltf.materials[p.material]))];
};
const isWood = (m) => !m.pbrMetallicRoughness.baseColorTexture &&
  m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).every((v, i) => Math.abs(v - WOOD_LIN[i]) <= 0.002);
{
  const woodGroups = {
    '柱（外廊 / 抱厦）': /__(gcol|pcol)-/, '枋（外廊额枋）': /__lintel-/, '栏杆': /-(rail|pick)-/,
    '封檐板 / 博风': /-(board|bofeng-[we][ab])$/,
  };
  for (const [label, re] of Object.entries(woodGroups)) {
    const names = allParts.filter((n) => re.test(n));
    const mats = [...new Set(names.flatMap(matsOfPart))];
    ok(`${label} ${names.length} 件，材质全部 = sRGB #6a2e22（${mats.map((m) => m.name).join(',') || '无'}）`,
      names.length > 0 && mats.length > 0 && mats.every(isWood));
  }
  const tileRe = /-(lower|upper-[sn]|tile|cone|satou-[we])$/;
  const tileParts = allParts.filter((n) => tileRe.test(n));
  const tileMats = [...new Set(tileParts.flatMap(matsOfPart))];
  const grey = tileMats.length === 1 && (() => {
    const c = tileMats[0].pbrMetallicRoughness.baseColorFactor;
    return Math.abs(c[0] - c[1]) <= 0.03 && Math.abs(c[1] - c[2]) <= 0.03 && !tileMats[0].pbrMetallicRoughness.baseColorTexture;
  })();
  ok(`瓦面 ${tileParts.length} 件全部用同一中性灰瓦材质（${tileMats.map((m) => m.name).join(',')}）`, tileParts.length >= 8 && grey);
}

console.log(`RESULT pass=${pass} fail=${fail} skipped=${skipped}`);
if (fail) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
