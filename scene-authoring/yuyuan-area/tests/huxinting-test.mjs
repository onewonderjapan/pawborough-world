// 湖心亭站点模块测试（WP9；默认开启，2026-09-25 机主定；HUXINTING=0 时跳过。模块 GLB 由 rebuild-review.sh 生成到 OUT_DIR）。
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
// HUXINTING_GLB：只换被测模块 GLB（在旧产物上先跑出失败用），总装 / 分区产物仍读 OUT_DIR
const GLB_PATH = process.env.HUXINTING_GLB ? path.resolve(process.env.HUXINTING_GLB) : path.join(OUT, 'huxin-ting.glb');
const HUXINTING = process.env.HUXINTING !== '0';   // 默认开启，同 ROCKERY_KIT / FANGBANG
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
  fail++; failures.push('huxin-ting.glb missing');
  console.log(`FAIL huxin-ting.glb 不存在于 ${OUT}（湖心亭模块默认开启，要求已构建：OUT_DIR=<同> blender -b -t 4 --python modules/huxinting/build.py；或 HUXINTING=0）`);
  console.log(`RESULT pass=${pass} fail=${fail}`);
  process.exit(1);
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
// 承台外伸（wave10-pondqa 改口径，主控 2026-09-27 定 #1 选项 2）：
// R2 的桥接口是「承台边到桥中线 ≤0.3 m」——桥中线不是桥面边，桥面半宽 1.2 m，按这个口径承台、抱厦、西端外廊都压在桥面上
// （抱厦墙离桥中线 0.28 m、桥栏穿墙、承台与桥面共面 18 m²）。改为量到桥面边线：承台不得进入桥面（到桥中线 ≥ 半宽 1.2），
// 临桥边离桥面边 ≤0.30 m（接得上）。各边外伸 = 设计值（三面 1.3 / 临桥 2.3）与「让桥上限」的小者；
// 让桥上限在这里从 layout 独立重算（只伸这一边的矩形到每跨桥中线距离 ≥ 1.2 + 0.02 的最大外伸，二分）。
const DESIGN_EXT = { w: 1.3, e: 1.3, s: 1.3, b: 2.3 };
const BR = LAYOUT.objects.find((o) => o.id === 'jiuqu-bridge');
const BR_LINE = BR.geometry.polyline;
const BR_HALF = (BR.width ?? 2.4) / 2;
const BR_LOC = BR_LINE.map(loc);
function segSegDist(p1, p2, q1, q2) {
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  if (cr(q1, q2, p1) * cr(q1, q2, p2) < 0 && cr(p1, p2, q1) * cr(p1, p2, q2) < 0) return 0;
  return Math.min(distPointSeg(p1[0], p1[1], q1, q2), distPointSeg(p2[0], p2[1], q1, q2), distPointSeg(q1[0], q1[1], p1, p2), distPointSeg(q2[0], q2[1], p1, p2));
}
function rectClear([u0, v0, u1, v1]) {
  const R = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  let best = Infinity;
  for (let i = 0; i + 1 < BR_LOC.length; i++) {
    const a = BR_LOC[i], b = BR_LOC[i + 1];
    if ([a, b].some((p) => p[0] >= u0 && p[0] <= u1 && p[1] >= v0 && p[1] <= v1)) return 0;
    for (let k = 0; k < 4; k++) best = Math.min(best, segSegDist(R[k], R[(k + 1) % 4], a, b));
  }
  return best;
}
const rectOf = (x) => [-(U0 + x.w), -(V0 + x.s), U0 + x.e, V0 + x.b];
const EXPECT_EXT = {};
for (const sd of ['w', 'e', 's', 'b']) {
  const one = { w: 0, e: 0, s: 0, b: 0 };
  one[sd] = DESIGN_EXT[sd];
  if (rectClear(rectOf(one)) >= BR_HALF + 0.02) { EXPECT_EXT[sd] = DESIGN_EXT[sd]; continue; }
  let lo = 0, hi = DESIGN_EXT[sd];
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; one[sd] = mid; if (rectClear(rectOf(one)) >= BR_HALF + 0.02) lo = mid; else hi = mid; }
  EXPECT_EXT[sd] = lo;
}
const DECK_POLY = [
  [-(U0 + EXPECT_EXT.w), -(V0 + EXPECT_EXT.s)], [U0 + EXPECT_EXT.e, -(V0 + EXPECT_EXT.s)],
  [U0 + EXPECT_EXT.e, V0 + EXPECT_EXT.b], [-(U0 + EXPECT_EXT.w), V0 + EXPECT_EXT.b],
];

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
    const ex = EXPECT_EXT;
    ok(`承台外包 = footprint 外扩（西 ${ex.w.toFixed(2)} / 东 ${ex.e.toFixed(2)} / 北 ${ex.s.toFixed(2)} / 桥侧 ${ex.b.toFixed(2)}，设计值与让桥上限的小者）（实测 u ${uMin.toFixed(2)}..${uMax.toFixed(2)} v ${vMin.toFixed(2)}..${vMax.toFixed(2)}）`,
      Math.abs(uMin + U0 + ex.w) <= 0.02 && Math.abs(uMax - U0 - ex.e) <= 0.02 &&
      Math.abs(vMin + V0 + ex.s) <= 0.02 && Math.abs(vMax - V0 - ex.b) <= 0.02,
      `期望 u ${(-(U0 + ex.w)).toFixed(2)}..${(U0 + ex.e).toFixed(2)} v ${(-(V0 + ex.s)).toFixed(2)}..${(V0 + ex.b).toFixed(2)}`);
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

// ---------------- 2) 九曲桥接口（wave10-pondqa 改口径）：量到桥面边线，不量到桥中线 ----------------
// 为什么改：R2 断言「承台边到桥中线 ≤0.3 m」，桥面半宽 1.2 m，满足它就意味着承台伸进桥面 0.9 m 以上——
// 抱厦和西端外廊正是这样立到了桥面上。现在：承台 / 湖心亭任何构件不进入桥面（到桥中线 ≥ 1.2），
// 临桥边离桥面边 ≤0.30 m（桥栏在抱厦正面开口，承台接得上）；另查桥栏以下 / 行走净空内没有湖心亭构件。
{
  // layout 口径：按让桥规则重算的承台多边形
  const clearL = rectClear([DECK_POLY[0][0], DECK_POLY[0][1], DECK_POLY[2][0], DECK_POLY[2][1]]);
  ok(`桥接口(layout 口径)：重算承台到桥中线 ${clearL.toFixed(3)} m ≥ 桥面半宽 ${BR_HALF}（不进桥面）`, clearL >= BR_HALF);
  // 临桥边（v 最大边）上、抱厦正面范围内（|u| ≤ 2.2）离桥面边的距离
  const edgeGapAt = (u, v) => Math.min(...BR_LOC.slice(1).map((b, i) => distPointSeg(u, v, BR_LOC[i], b))) - BR_HALF;
  const gapsL = [-2.2, -1, 0, 1, 2.2].map((u) => edgeGapAt(u, DECK_POLY[2][1]));
  ok(`桥接口(layout 口径)：临桥边离桥面边 ${Math.min(...gapsL).toFixed(3)}..${Math.max(...gapsL).toFixed(3)} m 在 [0, 0.30]（抱厦正面 |u|≤2.2）`,
    Math.min(...gapsL) >= 0 && Math.max(...gapsL) <= 0.30);

  // 产物口径：GLB 承台网格
  const deck = partVertsLocal('huxin-ting__deck');
  const minD = Math.min(...deck.map((q) => Math.min(...BR_LOC.slice(1).map((b, i) => distPointSeg(q[0], q[1], BR_LOC[i], b)))));
  ok(`桥接口(GLB 口径)：承台网格到桥中线最近 ${minD.toFixed(3)} m ≥ ${BR_HALF}（不进桥面）`, minD >= BR_HALF - 0.005);
  // 承台是矩形棱柱：临桥边 = v 最大的顶点所在边，沿它在抱厦正面范围 |u| ≤ 2.2 取样
  const vEdge = Math.max(...deck.map((q) => q[1]));
  const gapsG = vEdge > V0 + 0.5 ? [-2.2, -1, 0, 1, 2.2].map((u) => edgeGapAt(u, vEdge)) : [];
  ok(`桥接口(GLB 口径)：承台临桥边离桥面边 ${gapsG.length ? Math.min(...gapsG).toFixed(3) + '..' + Math.max(...gapsG).toFixed(3) : 'n/a'} m 在 [0, 0.30]`, gapsG.length > 0 && Math.min(...gapsG) >= -0.005 && Math.max(...gapsG) <= 0.30);

  // 全模块：桥栏顶（桥面 + 1.23，碰撞栏杆盒顶）以下，湖心亭构件到桥中线 ≥ 1.2；桥面 + 2.2 以下，不进桥栏内皮线（中线 ± 0.9）
  const deckY = BR.deckY ?? 0.55;
  let lowIn = 0, headIn = 0; const lowWorst = [], headWorst = [];
  for (const nm of allParts) {
    for (const q of parts.get(nm).verts.map(toLocal)) {
      const d = Math.min(...BR_LOC.slice(1).map((b, i) => distPointSeg(q[0], q[1], BR_LOC[i], b)));
      if (q[2] < deckY + 1.23 && q[2] > -0.1 && d < BR_HALF - 0.005) { lowIn++; if (lowWorst.length < 3) lowWorst.push(`${nm}@${d.toFixed(2)}`); }
      if (q[2] < deckY + 2.2 && q[2] > -0.1 && d < BR_HALF - 0.30) { headIn++; if (headWorst.length < 3) headWorst.push(`${nm}@${d.toFixed(2)}`); }
    }
  }
  ok(`桥栏顶以下湖心亭构件不进桥面（顶点 ${lowIn}）`, lowIn === 0, lowWorst.join(','));
  ok(`桥面 +2.2 m 以下湖心亭构件不进桥栏内的行走带（顶点 ${headIn}）`, headIn === 0, headWorst.join(','));
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
// 灰瓦按灰做（0010 lead QC：推理图偏蓝不照抄）。M1（wave13-matdetail）后瓦色承载：瓦面 = ht-tile-tex
// 贴图（factor 白）、瓦垄 = ht-tile-grey × COLOR_0 顶点色（factor 白缺省），材质 baseColorFactor 不再写色值；
// 中性灰判据移到 ①瓦垄 COLOR_0 均值 ②瓦纹贴图 PNG 亮像素均值（同判 |r-g|、|g-b| ≤ 0.03）。
{
  const mat = gltf.materials.find((m) => m.name === 'ht-tile-grey');
  ok('灰瓦材质存在（ht-tile-grey）', !!mat);
  // COLOR_0 走现成 accessor()（导出实测 FLOAT VEC3 / 或 BYTE_COLOR unorm），均值判中性灰
  const color0Means = [];
  for (const n of gltf.nodes) {
    if (n.mesh === undefined) continue;
    const mesh = gltf.meshes[n.mesh];
    if (!/-wa$/.test(mesh.name || '') || /-bofeng-/.test(mesh.name || '')) continue;
    for (const prim of mesh.primitives) {
      const ai = prim.attributes.COLOR_0;
      if (ai === undefined) continue;
      const a = gltf.accessors[ai];
      const vals = accessor(ai);
      const k = a.normalized ? 1 / 255 : 1;
      let r = 0, g = 0, b = 0;
      for (const c of vals) { r += c[0] * k; g += c[1] * k; b += c[2] * k; }
      color0Means.push([r / vals.length, g / vals.length, b / vals.length]);
    }
  }
  const cm = color0Means.reduce((s, c) => [s[0] + c[0] / color0Means.length, s[1] + c[1] / color0Means.length, s[2] + c[2] / color0Means.length], [0, 0, 0]);
  ok(`瓦垄 COLOR_0 均值为中性灰（rgb ${cm.map((v) => v.toFixed(2)).join(',')}，|r-g|、|g-b| ≤ 0.03，网格 ${color0Means.length}）`,
    color0Means.length > 0 && Math.abs(cm[0] - cm[1]) <= 0.03 && Math.abs(cm[1] - cm[2]) <= 0.03);
  // 瓦纹贴图均值（ht-tile-tex baseColorTexture，128×128 RGBA）同为中性灰
  const texMat = gltf.materials.find((m) => m.name === 'ht-tile-tex');
  ok('瓦纹贴图材质存在（ht-tile-tex）', !!texMat);
  if (texMat) {
    const img = gltf.images[gltf.textures[texMat.pbrMetallicRoughness.baseColorTexture.index].source];
    const bv = gltf.bufferViews[img.bufferView];
    const ib = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const dec = await import('node:zlib').then((z) => z.inflateSync);
    // PNG 手工解码最小 IHDR/IDAT（truecolor RGB 8bit，无隔行）——导出器写的是无调色板 RGBA/RGB
    let off = 8, w = 0, h = 0, depth = 0, ctype = 0; const idat = [];
    while (off < ib.length) {
      const len = ib.readUInt32BE(off), type = ib.toString('ascii', off + 4, off + 8);
      if (type === 'IHDR') { w = ib.readUInt32BE(off + 8); h = ib.readUInt32BE(off + 12); depth = ib[off + 16]; ctype = ib[off + 17]; }
      if (type === 'IDAT') idat.push(ib.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = Buffer.concat(idat);
    const bpp = ctype === 6 ? 4 : 3;
    const rowLen = w * bpp;
    const up = Buffer.alloc(h * rowLen);
    let rp = 0;
    for (let y = 0; y < h; y++) {
      const f = raw[rp++]; const row = raw.subarray(rp, rp + rowLen); rp += rowLen;
      const prev = y ? up.subarray((y - 1) * rowLen, y * rowLen) : Buffer.alloc(rowLen);
      const cur = up.subarray(y * rowLen, (y + 1) * rowLen);
      for (let x = 0; x < rowLen; x++) {
        const a2 = x >= bpp ? cur[x - bpp] : 0, b2 = prev[x], c2 = x >= bpp ? prev[x - bpp] : 0;
        let v = row[x];
        if (f === 1) v += a2; else if (f === 2) v += b2; else if (f === 3) v += (a2 + b2) >> 1;
        else if (f === 4) { const pp = a2 + b2 - c2, pa = Math.abs(pp - a2), pb = Math.abs(pp - b2), pc = Math.abs(pp - c2); v += (pa <= pb && pa <= pc) ? a2 : (pb <= pc ? b2 : c2); }
        cur[x] = v & 255;
      }
    }
    let r = 0, g = 0, b = 0, n2 = 0;
    for (let i = 0; i < up.length; i += bpp) { r += up[i]; g += up[i + 1]; b += up[i + 2]; n2++; }
    const tm = [r / n2 / 255, g / n2 / 255, b / n2 / 255];
    ok(`瓦纹贴图 ${w}×${h} 均值为中性灰（rgb ${tm.map((v) => v.toFixed(2)).join(',')}，|r-g|、|g-b| ≤ 0.03）`,
      w === 128 && Math.abs(tm[0] - tm[1]) <= 0.03 && Math.abs(tm[1] - tm[2]) <= 0.03);
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

// ---------------- 5) 模块开启时：总装 pond.glb 有 huxin-ting 锚且位姿=重算值 ----------------
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
  // M1：瓦面统一 ht-tile-tex 贴图材质（factor 白，中性灰由「瓦纹贴图均值为中性灰」断言；瓦垄顶点色另断言）
  const grey = tileMats.length === 1 && (() => {
    const m = tileMats[0];
    if (!m.pbrMetallicRoughness.baseColorTexture) return false;
    const c = m.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1, 1];
    return Math.abs(c[0] - c[1]) <= 0.03 && Math.abs(c[1] - c[2]) <= 0.03;
  })();
  ok(`瓦面 ${tileParts.length} 件全部用同一瓦纹贴图材质（${tileMats.map((m) => m.name).join(',')}）`, tileParts.length >= 8 && grey);
}

// ---------------- 7b) 拉伸体封顶（R1 施工中发现：round-0 prism() 两个端面都建在底环上，顶面缺失） ----------------
// 承台 / 石桩 / 柱 / 枋 / 楼板 / 墙体 / 栏杆：最高处必须有朝上的面（glTF 逆时针为正面）。
{
  const solids = allParts.filter((n) => /__(deck|pile-|gcol-|pcol-|lintel-|floor2|body\d|tower\d|porch-floor|pwall-|pframe-|plaque|dado-|.*-rail-|.*-pick-)/.test(n));
  const open = [];
  for (const nm of solids) {
    const p = parts.get(nm);
    const yMax = Math.max(...p.verts.map((v) => v[1]));
    const capped = p.tris.some(([a, b, c]) => {
      const A = p.verts[a], B = p.verts[b], C = p.verts[c];
      if (![A, B, C].every((v) => Math.abs(v[1] - yMax) <= 1e-4)) return false;
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);   // (B-A)x(C-A) 的 y 分量
      return ny > 0;
    });
    if (!capped) open.push(nm);
  }
  ok(`拉伸体 ${solids.length} 件全部有朝上顶面（缺顶 ${open.length}）`, solids.length > 100 && open.length === 0, open.slice(0, 4).join(','));
}

// ---------------- 8) R1-3 格心窗：框料几何 + 复用 hall-kit 格心 alpha 贴图 ----------------
{
  const LAT_SRC = path.join(ROOT, 'modules', 'hall-kit', 'textures', 'lattice-core-alpha.png');
  const srcBuf = fs.readFileSync(LAT_SRC);
  const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
  const texMats = gltf.materials.filter((m) => m.pbrMetallicRoughness?.baseColorTexture);
  const latMat = texMats.find((m) => /lattice/.test(m.name));
  ok(`格心材质存在（带贴图材质：${texMats.map((m) => m.name).join(',') || '无'}）`, !!latMat);
  if (latMat) {
    ok(`格心材质 alphaMode MASK / cutoff 0.5（实测 ${latMat.alphaMode}/${latMat.alphaCutoff}）`, latMat.alphaMode === 'MASK' && latMat.alphaCutoff === 0.5);
    const img = gltf.images[gltf.textures[latMat.pbrMetallicRoughness.baseColorTexture.index].source];
    const bv = gltf.bufferViews[img.bufferView];
    const ib = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const [w, h] = pngSize(ib), [sw, sh] = pngSize(srcBuf);
    // assemble / export-zones 按「名称去 .NNN + 尺寸」合并贴图：同名同尺寸才能与仰山堂 / 三穗堂的格心图合并
    ok(`格心贴图与 hall-kit 同名同尺寸（name ${img.name} ${img.mimeType} ${w}×${h}，源 lattice-core-alpha ${sw}×${sh}）`,
      img.name === 'lattice-core-alpha' && img.mimeType === 'image/png' && w === sw && h === sh);
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    ok('格心贴图字节 = modules/hall-kit/textures/lattice-core-alpha.png（复用，不另画）', sha(ib) === sha(srcBuf));
    // M1：格心贴图 + 瓦纹贴图共 2 张（瓦纹贴图断言在瓦色段）
    ok(`GLB 只含格心 + 瓦纹这 2 张贴图（实测 ${(gltf.images || []).length}）`,
      (gltf.images || []).length === 2 && (gltf.images || []).some((im) => im.name === 'lattice-core-alpha') && (gltf.images || []).some((im) => im.name === 'ht-tile-tex'));
    // 格心面：有 UV，1 UV = 1 m（hall-kit cellM 0.125 = 8 格 / 米）
    let area = 0, worst = 0, noUv = 0, prims = 0;
    for (const n of gltf.nodes) {
      if (n.mesh === undefined) continue;
      for (const prim of gltf.meshes[n.mesh].primitives) {
        if (gltf.materials[prim.material] !== latMat) continue;
        prims++;
        if (prim.attributes.TEXCOORD_0 === undefined) { noUv++; continue; }
        const P = accessor(prim.attributes.POSITION), T = accessor(prim.attributes.TEXCOORD_0), I = accessor(prim.indices);
        for (let i = 0; i < I.length; i += 3) {
          const [a, b, c] = [I[i], I[i + 1], I[i + 2]];
          for (const [x, y] of [[a, b], [b, c], [c, a]]) {
            const dw = Math.hypot(P[x][0] - P[y][0], P[x][1] - P[y][1], P[x][2] - P[y][2]);
            const du = Math.hypot(T[x][0] - T[y][0], T[x][1] - T[y][1]);
            if (dw > 0.05) worst = Math.max(worst, Math.abs(du / dw - 1));
          }
          const e1 = P[b].map((v, k) => v - P[a][k]), e2 = P[c].map((v, k) => v - P[a][k]);
          area += 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        }
      }
    }
    ok(`格心面 UV 每米 1 周期（8 格 / 米），最大偏差 ${(worst * 100).toFixed(1)}% ≤ 2%（图元 ${prims}，无 UV ${noUv}）`, prims > 0 && noUv === 0 && worst <= 0.02);
    ok(`格心总面积 ${area.toFixed(1)} m² ≥ 40（主楼两层 + 塔亭三层 + 抱厦窗门）`, area >= 40);
  }
  const frames = allParts.filter((n) => /__win-.*-frame$/.test(n));
  const frameTris = frames.reduce((s, n) => s + parts.get(n).tris.length, 0);
  const frameMats = [...new Set(frames.flatMap(matsOfPart))];
  ok(`格扇框料几何 ${frames.length} 件 / ${frameTris} 三角，材质 = sRGB #6a2e22（${frameMats.map((m) => m.name).join(',') || '无'}）`,
    frames.length >= 3 && frameTris >= 1000 && frameMats.length > 0 && frameMats.every(isWood));
  // round-0 做法「暗色窗底 + 3 根竖棂」不得残留
  const strips = allParts.filter((n) => /-m\d+-\d+-\d+$/.test(n));
  const darkWin = allParts.filter((n) => /__(w1|w2|tw\d|pwin|pdoor)/.test(n));
  ok(`无竖条窗残留（竖棂件 ${strips.length}、旧暗色窗底件 ${darkWin.length}）`, strips.length === 0 && darkWin.length === 0);
}

// ---------------- 9) 模块开启时：没有别的已渲染对象与湖心亭 footprint 重合 ----------------
// 口径：对称差面积 ≤ 5% 湖心亭 footprint 面积即「重合」。这里用 0.05 m 网格采样独立估算
// （build-scene 用凸分解 + 多边形裁剪精确求，两套方法互不引用）。
// 例：bld-228035340（outerBuilding，同一 OSM way 228035340）若照常渲染，会在浏览器里把湖心亭一层包成 5 m 米色体块。
if (HUXINTING) {
  const inPoly = (x, z, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const H = HT.geometry.footprint;
  const hx = H.map((p) => p[0]), hz = H.map((p) => p[1]);
  const STEP = 0.05, cell = STEP * STEP;
  let hArea = 0;
  for (let x = Math.min(...hx) + STEP / 2; x < Math.max(...hx); x += STEP)
    for (let z = Math.min(...hz) + STEP / 2; z < Math.max(...hz); z += STEP) if (inPoly(x, z, H)) hArea += cell;
  const coincide = [];
  for (const o of LAYOUT.objects) {
    const fp = o.geometry && o.geometry.footprint;
    if (o.id === 'huxin-ting' || o.skipRender || !fp || fp.length < 3) continue;
    const ox = fp.map((p) => p[0]), oz = fp.map((p) => p[1]);
    if (Math.max(...ox) < Math.min(...hx) || Math.min(...ox) > Math.max(...hx) || Math.max(...oz) < Math.min(...hz) || Math.min(...oz) > Math.max(...hz)) continue;
    let sym = 0;
    for (let x = Math.min(...hx, ...ox) + STEP / 2; x < Math.max(...hx, ...ox); x += STEP)
      for (let z = Math.min(...hz, ...oz) + STEP / 2; z < Math.max(...hz, ...oz); z += STEP) if (inPoly(x, z, H) !== inPoly(x, z, fp)) sym += cell;
    if (sym <= 0.05 * hArea) coincide.push({ id: o.id, kind: o.kind, ratio: sym / hArea });
  }
  console.log(`  footprint 重合（layout，网格估算，湖心亭 ${hArea.toFixed(1)} m²）：${JSON.stringify(coincide.map((c) => [c.id, c.kind, +c.ratio.toFixed(4)]))}`);
  // 这些对象不得出现在任何导出 GLB（程序化分区 / 总装 / 运行时分区）里
  const glbs = fs.readdirSync(OUT).filter((f) => /^(procedural-.*|scene-areas|zone-[a-z0-9-]+)\.glb$/.test(f));
  const rendered = [];
  for (const f of glbs) {
    const b = fs.readFileSync(path.join(OUT, f));
    const names = (JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')).nodes || []).map((n) => n.name || '');
    for (const c of coincide) for (const nm of names) if (nm.includes(`|${c.id}|`) || nm === c.id) rendered.push(`${f}:${nm}`);
  }
  ok(`湖心亭模块开启：没有别的已渲染对象与湖心亭 footprint 重合（重合 ${coincide.length} 件，在 ${glbs.length} 个 GLB 中渲染 ${rendered.length} 处）`,
    rendered.length === 0, rendered.slice(0, 4).join(','));
  const ps = fs.existsSync(path.join(OUT, 'procedural-stats.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8')) : { deferred: [] };
  const dup = new Set(ps.deferred.filter((d) => d.why === 'duplicate-footprint-of-huxin-ting').map((d) => d.id));
  const want = new Set(coincide.map((c) => c.id));
  ok(`build-scene deferred[] 以 'duplicate-footprint-of-huxin-ting' 记下的 = layout 重算的重合件（记 ${[...dup].join(',') || '无'}；应 ${[...want].join(',') || '无'}）`,
    dup.size === want.size && [...want].every((id) => dup.has(id)));
}

// ---------------- 10) R2-1 瓦垄（主控 R2 2026-09-25：「瓦面是平的」，GLB 实测） ----------------
// 瓦面 = 灰瓦材质、名以 -lower / -upper-s|n / -cone / -tile 结尾的 eave_kit 屋面件（主楼、抱厦、塔亭攒尖与两道腰檐）。
// 每块瓦面必须有同名 -wa 垄条件，材质 = 同一灰瓦；按位置焊接（1e-4 m）分连通块 = 一条垄。
//   垄距估算 = 瓦面面积 / Σ 垄长（垄长取连通块最远两点距离，弦长 ≤ 弧长，估算偏大 = 偏严）≤ 0.45 m；
//   垄高 = 连通块顶点到瓦面三角网的最大距离：全部垄的中位数 0.04–0.12 m，且任何垄顶点离瓦面 ≤ 0.12 m（不漂浮）。
function ptTriDist(p, a, b, c) {
  const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(...sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v])); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(...sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w])); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Math.hypot(...sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]));
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return Math.hypot(...sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}
const triArea = (A, B, C) => {
  const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  return 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
};
function components(p) {
  // 按位置焊接后的连通块（flat 着色导出会按面拆顶点，索引不能直接用）
  const key = (v) => v.map((x) => Math.round(x * 1e4)).join(',');
  const id = new Map(), parent = [];
  const vid = p.verts.map((v) => { const k = key(v); if (!id.has(k)) { id.set(k, parent.length); parent.push(parent.length); } return id.get(k); });
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const [a, b, c] of p.tris) { const ra = find(vid[a]); parent[find(vid[b])] = ra; parent[find(vid[c])] = ra; }
  const groups = new Map();
  p.verts.forEach((v, i) => { const r = find(vid[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(v); });
  return [...groups.values()];
}
{
  // M1：瓦面材质 = ht-tile-tex（瓦纹贴图；瓦垄 -wa 仍为 ht-tile-grey × 顶点色），撒头 satou 纳入瓦面件口径
  const tileMat = gltf.materials.find((m) => m.name === 'ht-tile-tex');
  const tileGreyMat = gltf.materials.find((m) => m.name === 'ht-tile-grey');
  const surfaces = allParts.filter((n) => /-(lower|upper-[sn]|cone|tile|satou-[we])$/.test(n) && matsOfPart(n).every((m) => m === tileMat));
  ok(`瓦面件 ${surfaces.length} 块（主楼下檐 + 上段两坡、抱厦下檐 + 上段两坡、塔亭攒尖 + 两道腰檐 = 9 + 撒头 4 = 13）`, surfaces.length === 13, surfaces.join(','));
  const heights = [];
  let floatMax = 0;
  const wrongMat = [];
  for (const s of surfaces) {
    const S = parts.get(s);
    const area = S.tris.reduce((acc, [a, b, c]) => acc + triArea(S.verts[a], S.verts[b], S.verts[c]), 0);
    const tag = s.replace('huxin-ting__', '');
    const rp = parts.get(`${s}-wa`);
    if (!rp) { ok(`${tag} 有瓦垄件 -wa（瓦面 ${area.toFixed(1)} m²）`, false, '无 -wa 件：瓦面是平的'); continue; }
    if (!matsOfPart(`${s}-wa`).every((m) => m === tileGreyMat)) wrongMat.push(tag);
    const comps = components(rp);
    const STris = S.tris.map(([a, b, c]) => [S.verts[a], S.verts[b], S.verts[c]]);
    let len = 0;
    for (const vs of comps) {
      let far = 0;
      for (let i = 0; i < vs.length; i += 3) for (let j = i + 1; j < vs.length; j += 3) far = Math.max(far, Math.hypot(vs[i][0] - vs[j][0], vs[i][1] - vs[j][1], vs[i][2] - vs[j][2]));
      len += far;
      let hMax = 0;
      for (const v of vs) {
        let d = Infinity;
        for (const [A, B, C] of STris) { d = Math.min(d, ptTriDist(v, A, B, C)); if (d < 1e-3) break; }
        hMax = Math.max(hMax, d);
      }
      heights.push(hMax);
      floatMax = Math.max(floatMax, hMax);
    }
    const pitch = len > 0 ? area / len : Infinity;
    ok(`${tag} 瓦垄 ${comps.length} 条，垄距估算 ${pitch.toFixed(3)} m ≤ 0.45（瓦面 ${area.toFixed(1)} m² / 垄长 ${len.toFixed(1)} m）`, pitch <= 0.45);
  }
  heights.sort((x, y) => x - y);
  const med = heights.length ? heights[heights.length >> 1] : 0;
  ok(`瓦垄高中位数 ${med.toFixed(3)} m ∈ [0.04, 0.12]（${heights.length} 条）`, heights.length > 0 && med >= 0.04 && med <= 0.12);
  ok(`瓦垄顶点离瓦面最大 ${floatMax.toFixed(3)} m ≤ 0.12（垄贴瓦面、不漂浮）`, heights.length > 0 && floatMax <= 0.12);
  ok(`瓦垄材质 = 同一灰瓦 ht-tile-grey（不符 ${wrongMat.length}）`, heights.length > 0 && wrongMat.length === 0, wrongMat.join(','));
}

// ---------------- 11) R2-2 白色裙墙（主控 R2：「一层窗下缺白色槛墙 / 裙板」，GLB 实测） ----------------
// 一层外露立面逐面水平射线（本地系，从立面外 4 m 射向墙）：外廊栏杆 / 望柱 / 廊柱 / 额枋在墙前，不计入（射线穿过）。
//   ① 覆盖：台面上 0.30 与 0.80 m 两个高度，每 0.25 m 一条，首个命中面材质 = ht-plaster-white 的比例 ≥ 0.9；
//   ② 贴窗：首命中为白墙的采样列向上每 0.01 m 扫，白墙顶 = 最后一个命中白墙的高度；该面一层窗下沿 = 同一立面
//      （白墙外皮 ±0.35 m 内、采样段横向 ±0.3 m 内）窗框件（__win-*-frame）顶点最低高度；窗下沿 − 白墙顶的中位数 ≤ 0.03 m（窗直接坐在裙墙上）。
// 立面划分（本地系，U0/V0 由 layout 重算）：主楼南 / 北（抱厦让位）/ 西；塔亭一层东 / 南 / 北；抱厦前檐窗下（中间入口让开）。
// 塔亭宽 4.2 / 抱厦半宽 2.2 / 进深 2.2 与 build.py 一致的设计值（同承台外伸常量的重算口径）。
{
  const TOWER_W = 4.2, TOWER_HALF = 2.1, PORCH_HALF = 2.2, PORCH_DEPTH = 2.2;
  const UE = U0 - TOWER_W;
  const skip = /-(rail|pick)-|__gcol-|__pcol-|__lintel-/;
  const T = [];
  for (const [nm, p] of parts) {
    if (skip.test(nm)) continue;
    const L = p.verts.map(toLocal);
    for (const [a, b, c, prim] of p.tris) T.push({ A: L[a], B: L[b], C: L[c], mat: gltf.materials[prim.material]?.name, nm });
  }
  const white = (h) => h && h.mat === 'ht-plaster-white';
  // 射线：axis 0 = 沿 u，1 = 沿 v；sgn = ±1
  function cast(tris, o, axis, sgn) {
    const d = axis === 0 ? [sgn, 0, 0] : [0, sgn, 0];
    let best = null, bt = Infinity;
    for (const t of tris) {
      const e1 = [t.B[0] - t.A[0], t.B[1] - t.A[1], t.B[2] - t.A[2]], e2 = [t.C[0] - t.A[0], t.C[1] - t.A[1], t.C[2] - t.A[2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - t.A[0], o[1] - t.A[1], o[2] - t.A[2]];
      const uu = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
      if (uu < 0 || uu > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
      if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
      if (tt > 1e-6 && tt < bt) { bt = tt; best = t; }
    }
    return best ? { ...best, t: bt, at: axis === 0 ? o[0] + sgn * bt : o[1] + sgn * bt } : null;
  }
  const P = PLATFORM_Y;
  const facades = [
    { tag: '主楼南', axis: 1, sgn: 1, from: -(V0 + 4), spans: [[-U0 + 0.4, UE - 0.3]] },
    { tag: '主楼北（抱厦让位）', axis: 1, sgn: -1, from: V0 + 4, spans: [[-U0 + 0.4, -PORCH_HALF - 0.2], [PORCH_HALF + 0.2, UE - 0.3]] },
    { tag: '主楼西', axis: 0, sgn: 1, from: -(U0 + 4), spans: [[-V0 + 0.4, V0 - 0.4]] },
    { tag: '塔亭东', axis: 0, sgn: -1, from: U0 + 4, spans: [[-TOWER_HALF + 0.3, TOWER_HALF - 0.3]] },
    { tag: '塔亭南', axis: 1, sgn: 1, from: -(V0 + 4), spans: [[UE + 0.5, U0 - 0.3]] },
    { tag: '塔亭北', axis: 1, sgn: -1, from: V0 + 4, spans: [[UE + 0.5, U0 - 0.3]] },
    // wave11-huxwalk：门口加宽到前檐柱内皮 ±0.66（主控 2026-09-27 选项 1），窗下裙墙只在柱外侧，采样段让开门口与柱（|u| ≥ 0.9）
    { tag: '抱厦前檐窗下', axis: 1, sgn: -1, from: V0 + PORCH_DEPTH + 4, spans: [[-1.9, -0.9], [0.9, 1.9]] },
  ];
  const frameVerts = [...parts.keys()].filter((n) => /__win-(main|tower|porch)-frame$/.test(n)).flatMap((n) => parts.get(n).verts.map(toLocal));
  for (const f of facades) {
    const lat = f.axis === 0 ? 1 : 0;              // 沿立面的横向坐标
    const ss = [];
    for (const [s0, s1] of f.spans) for (let s = s0; s <= s1 + 1e-9; s += 0.25) ss.push(s);
    const lo = Math.min(...f.spans.flat()) - 0.3, hi = Math.max(...f.spans.flat()) + 0.3;
    const tris = T.filter((t) => {
      const l = [t.A[lat], t.B[lat], t.C[lat]], h = [t.A[2], t.B[2], t.C[2]];
      return Math.max(...l) >= lo && Math.min(...l) <= hi && Math.max(...h) >= P + 0.2 && Math.min(...h) <= P + 1.6;
    });
    const O = (s, h) => (f.axis === 0 ? [f.from, s, h] : [s, f.from, h]);
    let hitW = 0, n = 0;
    const faceAt = [];
    const tops = [];
    for (const s of ss) {
      for (const dh of [0.30, 0.80]) {
        const r = cast(tris, O(s, P + dh), f.axis, f.sgn);
        n++;
        if (white(r)) { hitW++; if (dh === 0.30) faceAt.push(r.at); }
      }
      const r0 = cast(tris, O(s, P + 0.30), f.axis, f.sgn);
      if (!white(r0)) continue;
      let top = P + 0.30;
      for (let h = P + 0.31; h <= P + 1.6; h += 0.01) {
        if (!white(cast(tris, O(s, h), f.axis, f.sgn))) break;
        top = h;
      }
      tops.push(top);
    }
    const frac = n ? hitW / n : 0;
    ok(`白色裙墙 ${f.tag}：台面上 0.30 / 0.80 m 射线首命中白墙 ${hitW}/${n} = ${(frac * 100).toFixed(0)}% ≥ 90%`, frac >= 0.9);
    let sill = NaN, gap = NaN;
    if (faceAt.length && tops.length) {
      faceAt.sort((a, b) => a - b);
      const plane = faceAt[faceAt.length >> 1];
      const cand = frameVerts.filter((q) => Math.abs(q[f.axis] - plane) <= 0.35 && f.spans.some(([s0, s1]) => q[lat] >= s0 - 0.3 && q[lat] <= s1 + 0.3) && q[2] >= P + 0.5 && q[2] <= P + 2.0);
      if (cand.length) sill = Math.min(...cand.map((q) => q[2]));
      const gaps = tops.map((t) => sill - t).sort((a, b) => a - b);
      gap = gaps[gaps.length >> 1];
    }
    ok(`白色裙墙 ${f.tag}：裙墙顶贴一层窗下沿（窗下沿 ${Number.isFinite(sill) ? sill.toFixed(3) : '无'}，差值中位数 ${Number.isFinite(gap) ? gap.toFixed(3) : '无'} m ≤ 0.03）`,
      Number.isFinite(gap) && gap <= 0.03 && gap >= -0.03);
  }
}

// ---------------- 12) R2-3 水中立柱（主控 R2：「整座亭子架在水里的石柱上，台面下能看到柱列和水面」，GLB 实测） ----------------
// 水面 = layout 中覆盖湖心亭形心的 water 对象 height（运行时 build-scene 同值出水面）。承台顶冻结 0.55，与水面之间共 0.69 m。
//   ① 板下净空（承台网格最低点 − 水面）≥ 0.50 m：参照 0010-G01 目测净空约 0.6 m、板厚约 0.3 m，两者在 0.69 m 内放不下，
//      优先净空（阈值为本工单自定，R1 为 0.44）；
//   ② 桩顶顶住板底（|桩顶 − 板底| ≤ 0.02）、桩脚入水（桩底 < 水面）；
//   ③ 承台四边各有一排边桩：离该边最近的桩外皮到板边 ≤ 0.25 m（从外面看得到，不缩在板下阴影里）；
//      该排沿边中距 ≤ 3.0 m，两端桩中心离角 ≤ 0.6 m；
//   ④ 台面下水平射线（净空中高，四边外 3 m 垂直射入，每 0.25 m 一条）：首命中为桩的 ≥ 10%，射入板下 ≥ 1.0 m 仍未命中的 ≥ 50%
//      （柱列之间看得到水面）。
{
  const inPolyXZ = (x, z, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const water = LAYOUT.objects.find((o) => o.kind === 'water' && o.geometry?.footprint && inPolyXZ(CX, CZ, o.geometry.footprint));
  ok(`湖心亭形心落在 layout 水面对象内（${water ? `${water.id} height ${water.height}` : '无'}）`, !!water);
  const WY = water ? water.height : NaN;
  const deck = partVertsLocal('huxin-ting__deck');
  const deckBot = Math.min(...deck.map((q) => q[2]));
  ok(`板下净空 ${(deckBot - WY).toFixed(3)} m ≥ 0.50（承台底 ${deckBot.toFixed(3)} / 水面 ${WY}）`, deckBot - WY >= 0.5);
  const piles = allParts.filter((n) => n.includes('__pile-')).map((n) => {
    const L = partVertsLocal(n);
    const us = L.map((q) => q[0]), vs = L.map((q) => q[1]), hs = L.map((q) => q[2]);
    return { n, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), top: Math.max(...hs), bot: Math.min(...hs),
      cu: (Math.min(...us) + Math.max(...us)) / 2, cv: (Math.min(...vs) + Math.max(...vs)) / 2 };
  });
  const topErr = Math.max(...piles.map((p) => Math.abs(p.top - deckBot)));
  ok(`桩 ${piles.length} 根，桩顶顶住板底（最大偏差 ${topErr.toFixed(3)} m ≤ 0.02），桩脚入水（最高桩底 ${Math.max(...piles.map((p) => p.bot)).toFixed(2)} < ${WY}）`,
    piles.length >= 8 && topErr <= 0.02 && piles.every((p) => p.bot < WY));
  const du0 = -(U0 + EXPECT_EXT.w), du1 = U0 + EXPECT_EXT.e, dv0 = -(V0 + EXPECT_EXT.s), dv1 = V0 + EXPECT_EXT.b;
  const sides = [
    { tag: '西', edge: (p) => p.u0 - du0, along: (p) => p.cv, a: dv0, b: dv1 },
    { tag: '东', edge: (p) => du1 - p.u1, along: (p) => p.cv, a: dv0, b: dv1 },
    { tag: '南', edge: (p) => p.v0 - dv0, along: (p) => p.cu, a: du0, b: du1 },
    { tag: '北（临桥）', edge: (p) => dv1 - p.v1, along: (p) => p.cu, a: du0, b: du1 },
  ];
  for (const sd of sides) {
    const dmin = Math.min(...piles.map(sd.edge));
    const row = piles.filter((p) => sd.edge(p) <= dmin + 0.05).map(sd.along).sort((x, y) => x - y);
    let gap = 0;
    for (let i = 1; i < row.length; i++) gap = Math.max(gap, row[i] - row[i - 1]);
    const endOff = row.length ? Math.max(row[0] - sd.a, sd.b - row[row.length - 1]) : Infinity;
    ok(`承台${sd.tag}边桩排：外皮距板边 ${dmin.toFixed(3)} m ≤ 0.25，${row.length} 根中距最大 ${gap.toFixed(2)} m ≤ 3.0，端桩离角 ${endOff.toFixed(2)} m ≤ 0.6`,
      dmin <= 0.25 && row.length >= 2 && gap <= 3.0 && endOff <= 0.6);
  }
  // ④ 板下水平射线：只对桩与承台求交（其余构件都在台面以上）
  const T = [];
  for (const n of [...piles.map((p) => p.n), 'huxin-ting__deck']) {
    const p = parts.get(n), L = p.verts.map(toLocal);
    for (const [a, b, c] of p.tris) T.push({ A: L[a], B: L[b], C: L[c], pile: n !== 'huxin-ting__deck' });
  }
  const hMid = (deckBot + WY) / 2;
  let nRay = 0, nPile = 0, nDeep = 0;
  const rays = [];
  for (let v = dv0 + 0.1; v <= dv1 - 0.1; v += 0.25) { rays.push([[du0 - 3, v, hMid], [1, 0, 0], 3]); rays.push([[du1 + 3, v, hMid], [-1, 0, 0], 3]); }
  for (let u = du0 + 0.1; u <= du1 - 0.1; u += 0.25) { rays.push([[u, dv0 - 3, hMid], [0, 1, 0], 3]); rays.push([[u, dv1 + 3, hMid], [0, -1, 0], 3]); }
  for (const [o, d, off] of rays) {
    let bt = Infinity, bp = false;
    for (const t of T) {
      const e1 = [t.B[0] - t.A[0], t.B[1] - t.A[1], t.B[2] - t.A[2]], e2 = [t.C[0] - t.A[0], t.C[1] - t.A[1], t.C[2] - t.A[2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - t.A[0], o[1] - t.A[1], o[2] - t.A[2]];
      const uu = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
      if (uu < 0 || uu > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
      if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
      if (tt > 1e-6 && tt < bt) { bt = tt; bp = t.pile; }
    }
    nRay++;
    if (bt < Infinity && bp) nPile++;
    if (bt - off >= 1.0) nDeep++;
  }
  ok(`板下射线（h ${hMid.toFixed(2)}，${nRay} 条）：首命中为桩 ${(100 * nPile / nRay).toFixed(0)}% ≥ 10%，射入板下 ≥ 1 m 未命中 ${(100 * nDeep / nRay).toFixed(0)}% ≥ 50%`,
    nPile / nRay >= 0.1 && nDeep / nRay >= 0.5);
}

// ---------------- 13) R2-1b 屋面正反面（运行时 web/main.js 对无贴图材质强制 FrontSide，背面被剔除） ----------------
// 瓦面类件（-lower / -upper-s|n / -cone / -tile / -satou-*）的三角面几何法线（glTF 逆时针为正面）竖直分量必须 ≥ 0，
// 檐底 -soffit 必须 ≤ 0：否则从下往上看檐底被剔掉、从上往下看腰檐瓦面被剔掉，屋面透空并透出瓦垄侧面。
{
  const bad = {};
  for (const [nm, p] of parts) {
    const want = /-soffit$/.test(nm) ? -1 : (/-(lower|upper-[sn]|cone|tile|satou-[we])$/.test(nm) ? 1 : 0);
    if (!want) continue;
    for (const [a, b, c] of p.tris) {
      const A = p.verts[a], B = p.verts[b], C = p.verts[c];
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
      if (ny * want < -1e-9) bad[nm] = (bad[nm] || 0) + 1;
    }
  }
  const n = Object.values(bad).reduce((s, x) => s + x, 0);
  ok(`瓦面朝上 / 檐底朝下（反向三角 ${n}：${Object.entries(bad).map(([k, v]) => `${k.replace('huxin-ting__', '')} ${v}`).join(', ') || '无'}）`, n === 0);
}

// ---------------- 14) wave11-huxwalk 抱厦门口可走（主控 2026-09-27 选项 1：从九曲桥走进抱厦，GLB 实测） ----------------
// 步行胶囊直径 0.70（WalkController 半径 0.35）。
//   ① 门口净宽：局部 v ∈ [V0+0.95, V0+1.30]（前檐柱 / 窗下裙墙 / 前檐窗所在带）× 高 台面上 0.3–1.7 m，从 u=0 向 ±u 水平射线，
//      两侧首中距离之和的最小值 ≥ 0.90 m（原门口 0.60 m）；
//   ② 门槛：|u| ≤ 0.5、v 从 V0+1.0 到承台临桥边前 0.02 m，自台面上 0.5 m 下行射线首中必须是抱厦地面（porch-floor，顶 0.57），
//      即抱厦地面连到承台临桥边（原地面止于前檐柱外皮，前面 0.11 m 是承台面 0.55）。承台临桥边 = 局部 v 最大的 deck 顶点。
{
  const T = [];
  for (const [nm, p] of parts) {
    const L = p.verts.map(toLocal);
    for (const [a, b, c] of p.tris) T.push({ A: L[a], B: L[b], C: L[c], nm });
  }
  function ray(o, d) {
    let best = null;
    for (const t of T) {
      const e1 = [t.B[0] - t.A[0], t.B[1] - t.A[1], t.B[2] - t.A[2]], e2 = [t.C[0] - t.A[0], t.C[1] - t.A[1], t.C[2] - t.A[2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - t.A[0], o[1] - t.A[1], o[2] - t.A[2]];
      const uu = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
      if (uu < 0 || uu > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
      if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
      if (tt > 1e-6 && (!best || tt < best.t)) best = { t: tt, nm: t.nm };
    }
    return best;
  }
  let minClear = Infinity, at = null;
  for (let v = V0 + 0.95; v <= V0 + 1.30 + 1e-9; v += 0.05) for (let h = PLATFORM_Y + 0.3; h <= PLATFORM_Y + 1.7 + 1e-9; h += 0.2) {
    const r = ray([0, v, h], [1, 0, 0]), l = ray([0, v, h], [-1, 0, 0]);
    const w = (r ? r.t : 9) + (l ? l.t : 9);
    if (w < minClear) { minClear = w; at = `v=V0+${(v - V0).toFixed(2)} h=${h.toFixed(2)} ${l ? l.nm.replace('huxin-ting__', '') : '-'}|${r ? r.nm.replace('huxin-ting__', '') : '-'}`; }
  }
  ok(`抱厦门口净宽 ${minClear.toFixed(3)} m ≥ 0.90（步行胶囊 0.70；最窄处 ${at}）`, minClear >= 0.90);
  const deckV = partVertsLocal('huxin-ting__deck');
  const edgeV = deckV ? Math.max(...deckV.map((q) => q[1])) : NaN;
  let bad = 0, n = 0;
  const badAt = [];
  for (let u = -0.5; u <= 0.5 + 1e-9; u += 0.1) for (let v = V0 + 1.0; v <= edgeV - 0.02 + 1e-9; v += 0.02) {
    const hit = ray([u, v, PLATFORM_Y + 0.5], [0, 0, -1]);
    n++;
    if (!hit || hit.nm !== 'huxin-ting__porch-floor') { bad++; if (badAt.length < 3) badAt.push(`v=V0+${(v - V0).toFixed(2)}:${hit ? hit.nm.replace('huxin-ting__', '') : 'miss'}`); }
  }
  ok(`抱厦门槛：|u|≤0.5 从门内到承台临桥边（V0+${(edgeV - V0).toFixed(3)}）下行射线 ${n} 条首中抱厦地面，不是的 ${bad} 条（应 0）`, n > 0 && bad === 0, badAt.join(' '));
}

console.log(`RESULT pass=${pass} fail=${fail} skipped=${skipped}`);
if (fail) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
