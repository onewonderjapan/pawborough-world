// 三穗堂 × 仰山堂 贴合闸门（wave2-sansuitang S2，主控 2026-09-25 定）。只量总装产物 OUT_DIR/garden.glb 的实际几何，
// footprint 只从 baseline/layout.json 取；默认构建（仰山堂 = 程序化占位）与 HALL_KIT=1（仰山堂 = hall-kit 模块）都适用。
//   (a) 三穗堂墙体 / 台基 / 柱枋（网格件前缀 hall-wall / hall-base / hall-frame）全部顶点在 footprint 外扩 0.3 m 内；
//   (b) 两座楼的墙体 / 台基 / 柱 / 体块（非屋面件）之间 0 对三角形相交；
//   (c) 牵涉屋面 / 檐口件（三穗堂 hall-roof*、hall-kit hall-roof*、程序化 |roofpart）的三角形相交逐对报告（数量 + 位置），目标 0；
//       若 >0，另报共用边上两座楼屋面的实测高度（竖直射线命中的最低 / 最高屋面 y）。
// 分件规则只看网格件名，不看模块自报尺寸。
// 用法：OUT_DIR=out-zone [HALL_KIT=1] node tests/sansuitang-fit-test.mjs（REPORT=<json> 另写报告）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInPoly, distToPolyline } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const SST_ID = 'bld-428179901', YS_ID = 'bld-428179902';
const MARGIN = 0.3;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}
if (!fs.existsSync(path.join(OUT, 'garden.glb'))) {
  console.log(`no garden.glb in ${OUT} — skipping`);
  process.exit(0);
}

// ---------- GLB 解析（节点世界矩阵 + 子树顶点收集） ----------
function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen));
  let bin = null;
  if (28 + jsonLen < buf.length) {
    const binLen = buf.readUInt32LE(20 + jsonLen);
    bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  }
  const comp = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function accessor(ai) {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const [bsize, Arr] = comp[a.componentType];
    const nc = ncomp[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || bsize * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) {
      const o = off + i * stride;
      out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + o, nc)));
    }
    return out;
  }
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    // 标准 glTF 列向量旋转矩阵（m02=2(xz+yw)，勿转置——转置会把纯 Y 旋转变成反向）
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function mulVec(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  const nodesByName = new Map((json.nodes || []).map((n, i) => [n.name || `node${i}`, { n, i }]));
  const parentOf = new Map();
  for (const [i, n] of (json.nodes || []).entries()) for (const c of n.children || []) parentOf.set(c, i);
  const triTotal = (json.meshes || []).reduce((s, m) => s + m.primitives.reduce((t, p) => t + Math.floor(json.accessors[p.indices].count / 3), 0), 0);
  function worldMatrixOf(ni) {
    let m = null, cur = ni;
    while (cur !== undefined) { m = m ? mul4(nodeMatrix(json.nodes[cur]), m) : nodeMatrix(json.nodes[cur]); cur = parentOf.get(cur); }
    return m || nodeMatrix(json.nodes[ni]);
  }
  function subtreeVerts(rootName, maxY = 1e9) {
    const entry = nodesByName.get(rootName);
    if (!entry) return null;
    const verts = [];
    const w = (ni, pm) => {
      const n = json.nodes[ni];
      // 根节点取完整世界矩阵（含祖先链），子节点本地合成，不重复乘根矩阵
      const m = pm ? mul4(pm, nodeMatrix(n)) : worldMatrixOf(ni);
      if (n.mesh !== undefined) {
        for (const p of json.meshes[n.mesh].primitives) {
          for (const v of accessor(p.attributes.POSITION)) {
            const wv = mulVec(m, v);
            if (wv[1] <= maxY) verts.push(wv);
          }
        }
      }
      for (const c of n.children || []) w(c, m);
    };
    w(entry.i, null);
    return verts;
  }
  // 子树逐网格件：世界坐标顶点 + 三角形索引（fit 检查用）
  function subtreeParts(rootName) {
    const entry = nodesByName.get(rootName);
    if (!entry) return null;
    const parts = [];
    const w = (ni, pm) => {
      const n = json.nodes[ni];
      const m = pm ? mul4(pm, nodeMatrix(n)) : worldMatrixOf(ni);
      if (n.mesh !== undefined) {
        const verts = [], tris = [];
        for (const p of json.meshes[n.mesh].primitives) {
          const base = verts.length;
          for (const v of accessor(p.attributes.POSITION)) verts.push(mulVec(m, v));
          const idx = accessor(p.indices).map((x) => x[0]);
          for (let k = 0; k + 2 < idx.length; k += 3) tris.push([base + idx[k], base + idx[k + 1], base + idx[k + 2]]);
        }
        parts.push({ name: n.name || String(ni), verts, tris });
      }
      for (const c of n.children || []) w(c, m);
    };
    w(entry.i, null);
    return parts;
  }
  return { json, nodesByName, subtreeVerts, subtreeParts, triTotal, materials: json.materials || [] };
}


const garden = parseGlb(path.join(OUT, 'garden.glb'));
const ring = (f) => (f[0][0] === f[f.length - 1][0] && f[0][1] === f[f.length - 1][1] ? f.slice(0, -1) : f);
const sObj = LAYOUT.objects.find((o) => o.id === SST_ID), yObj = LAYOUT.objects.find((o) => o.id === YS_ID);
const sfp = ring(sObj.geometry.footprint), yfp = ring(yObj.geometry.footprint);

const sParts = garden.subtreeParts(SST_ID);
if (!sParts) { console.log('FAIL garden.glb 无三穗堂模块节点', SST_ID, '（需 SANSUITANG=1 构建）'); process.exit(1); }
let yParts = garden.subtreeParts(YS_ID); // HALL_KIT=1：实例节点
let ysMode = 'hall-kit';
if (!yParts) {
  ysMode = 'procedural';
  yParts = [...(garden.subtreeParts(`garden|${YS_ID}|hall|L1`) || []).map((p) => ({ ...p, name: 'L1:' + p.name })),
    ...(garden.subtreeParts(`garden|${YS_ID}|hall|L1|roofpart`) || []).map((p) => ({ ...p, name: 'roofpart:' + p.name }))];
}
ok(`仰山堂几何存在（${ysMode}，${yParts.length} 件）`, yParts.length > 0);
const isRoof = (name) => /^hall-roof/.test(name) || /^roofpart:/.test(name);
const partClass = (name) => (isRoof(name) ? 'roof' : 'body');
console.log(`仰山堂 = ${ysMode}；三穗堂 ${sParts.length} 件（屋面 ${sParts.filter((p) => isRoof(p.name)).length}），仰山堂 ${yParts.length} 件（屋面 ${yParts.filter((p) => isRoof(p.name)).length}）`);

// ---------- (a) 三穗堂墙体 / 台基 / 柱枋 在 footprint + 0.3 m 内 ----------
const closed = [...sfp, sfp[0]];
const fitParts = [];
for (const p of sParts.filter((q) => /^hall-(wall|base|frame)/.test(q.name))) {
  let maxEx = 0, n = 0, where = null;
  for (const v of p.verts) {
    if (pointInPoly([v[0], v[2]], sfp)) continue;
    const e = distToPolyline([v[0], v[2]], closed) - MARGIN;
    if (e > 1e-3) { n++; if (e > maxEx) { maxEx = e; where = v; } }
  }
  fitParts.push({ part: p.name, vertsOutside: n, maxBeyondM: +maxEx.toFixed(3), worst: where && where.map((x) => +x.toFixed(2)) });
  ok(`(a) ${p.name} 在 footprint+${MARGIN} m 内（超出 ${maxEx.toFixed(2)} m，${n} 顶点）`, n === 0, where ? `worst=(${where.map((x) => x.toFixed(2))})` : '');
}

// ---------- 三角形相交（双向：边对三角形） ----------
function segTri(p0, p1, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < 1e-12) return false;
  const f = 1 / det, s = [p0[0] - a[0], p0[1] - a[1], p0[2] - a[2]];
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 0 || u > 1) return false;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]); if (v < 0 || u + v > 1) return false;
  const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
  return t > 1e-6 && t < 1 - 1e-6;
}
const triList = (parts) => parts.flatMap((p) => p.tris.map((t) => {
  const P = t.map((i) => p.verts[i]);
  return { part: p.name, cls: partClass(p.name), P, lo: [0, 1, 2].map((k) => Math.min(P[0][k], P[1][k], P[2][k])), hi: [0, 1, 2].map((k) => Math.max(P[0][k], P[1][k], P[2][k])) };
}));
const sT = triList(sParts), yT = triList(yParts);
const hits = { body: [], roof: [] };
for (const B of yT) for (const A of sT) {
  if (A.lo[0] > B.hi[0] || A.hi[0] < B.lo[0] || A.lo[1] > B.hi[1] || A.hi[1] < B.lo[1] || A.lo[2] > B.hi[2] || A.hi[2] < B.lo[2]) continue;
  const [a0, a1, a2] = A.P, [b0, b1, b2] = B.P;
  if (segTri(a0, a1, b0, b1, b2) || segTri(a1, a2, b0, b1, b2) || segTri(a2, a0, b0, b1, b2)
    || segTri(b0, b1, a0, a1, a2) || segTri(b1, b2, a0, a1, a2) || segTri(b2, b0, a0, a1, a2)) {
    hits[A.cls === 'body' && B.cls === 'body' ? 'body' : 'roof'].push({ s: A.part, y: B.part, P: A.P });
  }
}
function summarize(list) {
  const byPair = {};
  const bb = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  for (const h of list) {
    const k = `${h.s} × ${h.y}`; byPair[k] = (byPair[k] || 0) + 1;
    for (const P of h.P) ['x', 'y', 'z'].forEach((ax, i) => { bb[ax][0] = Math.min(bb[ax][0], P[i]); bb[ax][1] = Math.max(bb[ax][1], P[i]); });
  }
  return { pairs: list.length, byPair, region: list.length ? Object.fromEntries(Object.entries(bb).map(([k, v]) => [k, v.map((t) => +t.toFixed(2))])) : null };
}
const bodyHits = summarize(hits.body), roofHits = summarize(hits.roof);
console.log('(b) body×body', JSON.stringify(bodyHits));
console.log('(c) roof/eave', JSON.stringify(roofHits));
ok(`(b) 墙体/台基/柱/体块 0 对三角形相交（${bodyHits.pairs}）`, bodyHits.pairs === 0, JSON.stringify(bodyHits.byPair));
ok(`(c) 屋面/檐口 0 对三角形相交（${roofHits.pairs}）`, roofHits.pairs === 0, JSON.stringify(roofHits.byPair));

// ---------- (c) 附：共用边上两座楼屋面实测高度 ----------
function sharedEdges() {
  const yc = [...yfp, yfp[0]];
  const out = [];
  for (let i = 0; i < sfp.length; i++) {
    const a = sfp[i], b = sfp[(i + 1) % sfp.length];
    if (distToPolyline(a, yc) < 0.05 && distToPolyline(b, yc) < 0.05) out.push([a, b]);
  }
  return out;
}
function rayY(tris, x, z) { // 竖直线 (x, z) 与三角形的全部交点 y
  const ys = [];
  for (const T of tris) {
    if (x < T.lo[0] || x > T.hi[0] || z < T.lo[2] || z > T.hi[2]) continue;
    const [a, b, c] = T.P;
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    ys.push(l1 * a[1] + l2 * b[1] + l3 * c[1]);
  }
  return ys;
}
const edges = sharedEdges();
const eaveAtShared = [];
for (const [a, b] of edges) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let s = 0.25; s < L; s += 0.5) {
    const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L;
    const sy = rayY(sT.filter((t) => t.cls === 'roof'), x, z), yy = rayY(yT.filter((t) => t.cls === 'roof'), x, z);
    eaveAtShared.push({ at: [+x.toFixed(2), +z.toFixed(2)], sansuitangRoofY: sy.length ? [+Math.min(...sy).toFixed(2), +Math.max(...sy).toFixed(2)] : null, yangshantangRoofY: yy.length ? [+Math.min(...yy).toFixed(2), +Math.max(...yy).toFixed(2)] : null });
  }
}
const rng = (k) => { const v = eaveAtShared.map((e) => e[k]).filter(Boolean); return v.length ? [Math.min(...v.map((r) => r[0])), Math.max(...v.map((r) => r[1]))] : null; };
console.log(`共用边 ${edges.length} 段；屋面在共用边上的实测 y：三穗堂 ${JSON.stringify(rng('sansuitangRoofY'))}，仰山堂 ${JSON.stringify(rng('yangshantangRoofY'))}`);

if (process.env.REPORT) {
  fs.writeFileSync(process.env.REPORT, JSON.stringify({ out: OUT, yangshantang: ysMode, pass, fail, failures,
    a_footprintFit: fitParts, b_bodyIntersections: bodyHits, c_roofIntersections: roofHits,
    sharedEdges: edges, roofYAtSharedEdge: { sansuitang: rng('sansuitangRoofY'), yangshantang: rng('yangshantangRoofY'), samples: eaveAtShared } }, null, 1));
}
console.log(`\nsansuitang-fit-test: ${pass} pass, ${fail} fail (仰山堂=${ysMode}, OUT=${path.basename(OUT)})`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
