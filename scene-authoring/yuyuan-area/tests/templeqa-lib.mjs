// 庙区模块质量检测库（wave5-templeqa）：只读 resources/temple-v3 的模块 GLB + baseline/layout.json 的实例位姿。
// 模块 GLB 约定：节点名 = <part>__<material>，无节点变换，模块本地 Y-up、+Z 朝南（街），山门门槛 = 原点。
// 实例放置与 scripts/assemble.py place() 同式（独立实现，不读总装产物）：
//   地图 X = x + cos(r)·lx + sin(r)·lz；地图 Z = z − sin(r)·lx + cos(r)·lz；Y 不变。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLE_V3 = path.join(ROOT, 'resources', 'temple-v3');

// 模块 → 文件：从 scripts/assemble.py 的 MODULE_FILE 读（与总装同一份映射）
export function moduleFileMap() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'assemble.py'), 'utf8');
  const m = src.match(/MODULE_FILE\s*=\s*\{([\s\S]*?)\}/);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) out[k] = v;
  return out;
}

export function templeInstances() {
  const MF = moduleFileMap();
  const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
  return L.instances.filter((i) => MF[i.module]).map((i) => ({ ...i, file: MF[i.module] }));
}

// ---------- GLB 读取（扁平模块：节点无变换） ----------
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
export function readGlbRaw(file) {
  const buf = fs.readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl));
  const bin = 28 + jl < buf.length ? buf.subarray(28 + jl, 28 + jl + buf.readUInt32LE(20 + jl)) : null;
  const acc = (ai) => {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
    const Arr = COMP[a.componentType], nc = NC[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || Arr.BYTES_PER_ELEMENT * nc;
    const out = new Float64Array(a.count * nc);
    const dv = new DataView(bin.buffer, bin.byteOffset);
    const rd = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true),
      5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true), 5120: (o) => dv.getInt8(o) }[a.componentType];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) out[i * nc + c] = rd(off + i * stride + c * Arr.BYTES_PER_ELEMENT);
    return out;
  };
  return { json, bin, acc };
}

export function readModule(file) {
  const { json, bin, acc } = readGlbRaw(file);
  const nodes = [];
  for (const n of json.nodes || []) {
    if (n.mesh === undefined) continue;
    if (n.translation || n.rotation || n.scale || n.matrix) throw new Error(`templeqa: node ${n.name} has a transform (flat module GLB expected)`);
    const Ps = [], Ns = [], Ts = [];
    let base = 0;
    const mats = [];
    for (const pr of json.meshes[n.mesh].primitives) {
      const P = acc(pr.attributes.POSITION);
      const N = pr.attributes.NORMAL !== undefined ? acc(pr.attributes.NORMAL) : null;
      const I = pr.indices !== undefined ? acc(pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
      Ps.push(P); Ns.push(N);
      for (let k = 0; k + 2 < I.length; k += 3) Ts.push(base + I[k], base + I[k + 1], base + I[k + 2]);
      base += P.length / 3;
      mats.push(json.materials?.[pr.material] || {});
    }
    const P = new Float64Array(base * 3), N = new Float64Array(base * 3);
    let o = 0;
    Ps.forEach((p, i) => { P.set(p, o); if (Ns[i]) N.set(Ns[i], o); o += p.length; });
    const [part, mat] = (n.name || '').split('__');
    nodes.push({ name: n.name || '', part, mat, P, N, T: Uint32Array.from(Ts), material: mats[0] });
  }
  return { file, json, bin, nodes };
}

// ---------- 小工具 ----------
export const f3 = (v) => +(+v).toFixed(3);
const WELD = 1e-3;
const vkey = (P, i) => Math.round(P[i * 3] / WELD) + ',' + Math.round(P[i * 3 + 1] / WELD) + ',' + Math.round(P[i * 3 + 2] / WELD);

// 节点内按位置焊接（1 mm）的连通块 = 一个构件实体；返回每顶点块号、每三角块号、块列表
export function islands(node) {
  const { P, T } = node;
  const nv = P.length / 3;
  const ids = new Map();
  const vid = new Int32Array(nv);
  for (let i = 0; i < nv; i++) { const k = vkey(P, i); if (!ids.has(k)) ids.set(k, ids.size); vid[i] = ids.get(k); }
  const par = Int32Array.from({ length: ids.size }, (_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < T.length; t += 3) {
    const a = find(vid[T[t]]), b = find(vid[T[t + 1]]), c = find(vid[T[t + 2]]);
    if (a !== b) par[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) par[find(c)] = b2;
  }
  const vIsl = new Int32Array(nv);
  const remap = new Map();
  for (let i = 0; i < nv; i++) { const r = find(vid[i]); if (!remap.has(r)) remap.set(r, remap.size); vIsl[i] = remap.get(r); }
  const tIsl = new Int32Array(T.length / 3);
  for (let t = 0; t < tIsl.length; t++) tIsl[t] = vIsl[T[t * 3]];
  const list = Array.from({ length: remap.size }, () => ({ tris: [], lo: Infinity, hi: -Infinity, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
  for (let i = 0; i < nv; i++) {
    const L = list[vIsl[i]];
    for (let c = 0; c < 3; c++) { L.min[c] = Math.min(L.min[c], P[i * 3 + c]); L.max[c] = Math.max(L.max[c], P[i * 3 + c]); }
  }
  for (const L of list) { L.lo = L.min[1]; L.hi = L.max[1]; }
  for (let t = 0; t < tIsl.length; t++) list[tIsl[t]].tris.push(t);
  return { vIsl, tIsl, list, vid };
}

export function triNormal(P, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
  const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

// Möller–Trumbore：射线 o + s·d 与三角 (A,B,C)，返回 s 或 null
export function rayTri(o, d, A, B, C) {
  const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2];
  const e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = o[0] - A[0], ty = o[1] - A[1], tz = o[2] - A[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// ---------- 1) 非屋面构件穿出屋面（推广 tests/hallkit-roofclip.mjs 的口径到庙区模块） ----------
// 屋面覆盖面 = 材质 gray-pan-tile 节点（瓦面、瓦头、脊、封檐）的非竖直三角（|ny| ≥ 0.2|n|）。
// 非屋面构件 = 其余节点里按 1 mm 焊接的连通块；块底 b = 块内最低点。
// 对块内每个顶点 p：取水平投影包含 p 的覆盖三角里高于 b + 0.05 的（低于构件底的屋面 = 下一层 / 构件坐在屋面上，不是「正上方」），
// 其中最低的 = 正上方屋面；p.y 超出它 > TOL 即违规。
// 根线豁免同 hall-kit：坡面「上沿」（水平边界边、所在三角对顶点更低）0.2 m 内该片不算，同处其他片照常算（盲区同 hall-kit）。
// 与 hall-kit 的差别（写明）：庙区屋面瓦面 / 瓦头 / 脊 / 封檐同在 gray-pan-tile 一个节点，片 = 该节点内焊接连通块；
// 坐在屋脊 / 瓦面上的脊饰（块底高于其正下方屋面 − SEAT）归「屋面上的饰件」单列，不算穿出。
export const CLIP_TOL = 0.01;
export const SEAT = 0.3;
export function isRoofNode(n) { return n.mat === 'gray-pan-tile'; }

function xzGrid(tris, cell) {
  const g = new Map();
  for (const [i, t] of tris.entries()) {
    for (let gx = Math.floor(t.x0 / cell); gx <= Math.floor(t.x1 / cell); gx++)
      for (let gz = Math.floor(t.z0 / cell); gz <= Math.floor(t.z1 / cell); gz++) {
        const k = gx + ',' + gz;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(i);
      }
  }
  return (x, z) => g.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || [];
}

export const ROOT_BAND = 0.2;
export function roofCover(mod) {
  const tris = [];
  const rootEdges = new Map();      // sheet -> [[ax, az, bx, bz]]
  for (const [ni, n] of mod.nodes.entries()) {
    if (!isRoofNode(n)) continue;
    const { P, T } = n;
    const isl = islands(n);
    const sheet = (t) => ni + ':' + isl.tIsl[t];
    // 片上沿（根线）：片内边界边里水平（两端高差 < 0.02）且所在三角对顶点比它低 ≥ 0.02 的边（同 hallkit-roofclip）
    const edgeUse = new Map();
    for (let t = 0; t < T.length / 3; t++) for (let e = 0; e < 3; e++) {
      const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3], c = T[t * 3 + (e + 2) % 3];
      const ka = isl.vid[a], kb = isl.vid[b];
      const k = (ka < kb ? ka + '|' + kb : kb + '|' + ka);
      if (!edgeUse.has(k)) edgeUse.set(k, []);
      edgeUse.get(k).push([t, a, b, c]);
    }
    for (const uses of edgeUse.values()) {
      if (uses.length !== 1) continue;
      const [t, a, b, c] = uses[0];
      const ay = P[a * 3 + 1], by = P[b * 3 + 1], cy = P[c * 3 + 1];
      if (Math.abs(ay - by) >= 0.02 || cy > Math.min(ay, by) - 0.02) continue;
      const L = sheet(t);
      if (!rootEdges.has(L)) rootEdges.set(L, []);
      rootEdges.get(L).push([P[a * 3], P[a * 3 + 2], P[b * 3], P[b * 3 + 2]]);
    }
    for (let t = 0; t < T.length / 3; t++) {
      const nn = triNormal(P, T, t);
      if (Math.abs(nn[1]) < 0.2 * Math.hypot(...nn)) continue;
      const A = [P[T[t * 3] * 3], P[T[t * 3] * 3 + 1], P[T[t * 3] * 3 + 2]];
      const B = [P[T[t * 3 + 1] * 3], P[T[t * 3 + 1] * 3 + 1], P[T[t * 3 + 1] * 3 + 2]];
      const C = [P[T[t * 3 + 2] * 3], P[T[t * 3 + 2] * 3 + 1], P[T[t * 3 + 2] * 3 + 2]];
      const den = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
      if (Math.abs(den) < 1e-12) continue;
      tris.push({ A, B, C, den, sheet: sheet(t), x0: Math.min(A[0], B[0], C[0]), x1: Math.max(A[0], B[0], C[0]), z0: Math.min(A[2], B[2], C[2]), z1: Math.max(A[2], B[2], C[2]) });
    }
  }
  const segD = (x, z, e) => {
    const dx = e[2] - e[0], dz = e[3] - e[1], L2 = dx * dx + dz * dz;
    const k = L2 ? Math.max(0, Math.min(1, ((x - e[0]) * dx + (z - e[1]) * dz) / L2)) : 0;
    return Math.hypot(x - e[0] - k * dx, z - e[1] - k * dz);
  };
  const cand = xzGrid(tris, 0.5);
  const fn = (x, z, rootBand = -1) => {
    const out = [];
    for (const i of cand(x, z)) {
      const t = tris[i];
      if (x < t.x0 - 1e-9 || x > t.x1 + 1e-9 || z < t.z0 - 1e-9 || z > t.z1 + 1e-9) continue;
      const { A, B, C, den } = t;
      const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / den;
      const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const nearRoot = rootBand >= 0 && (rootEdges.get(t.sheet) || []).some((e) => segD(x, z, e) <= rootBand);
      out.push(nearRoot ? { y: l1 * A[1] + l2 * B[1] + l3 * C[1], root: true } : l1 * A[1] + l2 * B[1] + l3 * C[1]);
    }
    return out;
  };
  return fn;
}

export function roofClip(mod, { rootBand = ROOT_BAND } = {}) {
  const hits = roofCover(mod);
  const rows = [];
  let checked = 0, total = 0, rootExempt = 0;
  const seated = [];
  for (const n of mod.nodes) {
    if (isRoofNode(n)) continue;
    const isl = islands(n);
    const { P } = n;
    const per = new Map();       // island -> {worst, at, cover, count}
    const seen = new Set();
    for (let i = 0; i < P.length / 3; i++) {
      const k = vkey(P, i);
      if (seen.has(k)) continue;
      seen.add(k);
      total++;
      const L = isl.list[isl.vIsl[i]];
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const hs = hits(x, z, rootBand);
      const aboveAll = hs.map((h) => (typeof h === 'number' ? h : h.y)).filter((h) => h > L.lo + 0.05);
      if (!aboveAll.length) continue;
      checked++;
      const above = hs.filter((h) => typeof h === 'number' && h > L.lo + 0.05);
      if (!above.length) { rootExempt++; continue; }
      const cover = Math.min(...above);
      const ex = y - cover;
      // 穿透：高于该处最高的覆盖面（瓦面顶）= 从屋面上方看得见；只高于最低面 = 埋在屋面厚度 / 檐底里
      const through = y - Math.max(...above);
      const r = per.get(isl.vIsl[i]) || { worst: -Infinity, count: 0, through: -Infinity, throughCount: 0 };
      if (ex > CLIP_TOL) r.count++;
      if (through > CLIP_TOL) r.throughCount++;
      if (ex > r.worst) { r.worst = ex; r.at = [x, y, z]; r.cover = cover; }
      if (through > r.through) { r.through = through; r.throughAt = [x, y, z]; }
      per.set(isl.vIsl[i], r);
    }
    for (const [ii, r] of per) {
      if (r.worst <= CLIP_TOL) continue;
      const L = isl.list[ii];
      // 块底中心正下方的屋面：块底在屋面以上 SEAT 内 = 坐在屋面上的饰件（脊饰、宝顶），单列
      const cx = (L.min[0] + L.max[0]) / 2, cz = (L.min[2] + L.max[2]) / 2;
      const under = hits(cx, cz).filter((h) => h <= L.lo + SEAT + 1e-6);  // rootBand −1：全部返回数字
      const seatedOnRoof = under.length > 0 && L.lo >= Math.max(...under) - SEAT;
      const rec = { node: n.name, island: ii, tris: L.tris.length, bottomY: f3(L.lo), topY: f3(L.hi),
        bbox: [L.min.map(f3), L.max.map(f3)], maxExcessM: f3(r.worst), vertsOver: r.count, at: r.at.map(f3), roofAtM: f3(r.cover),
        throughM: f3(r.through), vertsThrough: r.throughCount, throughAt: r.throughAt ? r.throughAt.map(f3) : null };
      (seatedOnRoof ? seated : rows).push(rec);
    }
  }
  rows.sort((a, b) => b.maxExcessM - a.maxExcessM);
  return { total, checked, rootExempt, violations: rows, seatedOrnaments: seated };
}

// ---------- 2) 背面朝外 ----------
// (a) 绕序 vs 法线属性：三角几何法线（按绕序叉积）与三顶点 NORMAL 平均的点积 < 0。
//     材质 doubleSided 时 three.js 按 gl_FrontFacing 翻转着色法线 → 这类面从法线一侧看是「背面」，法线被翻进去，着色发黑。
// (b) 闭合连通块（焊接后每条边恰被 2 个三角共用）：从三角形心沿几何法线外移 1 mm 发射线，与同一块的三角求交，
//     交点数为奇 = 法线指向块内部（朝向反）；但沿 −n 同样为奇的面埋在焊成一块的另一个盒子里（内部面），
//     与另一面重合（2 mm 内）的夹层面也算内部面，二者单列 internalCoincidentTris，不算朝向反。块整体有向体积 < 0 = 整块反向。
//     开口块（瓦面、单片板）没有内外之分，(b) 不判，只计 (a)；开口块的朝向由渲染口径（Cycles Backfacing 掩膜）补看。
export function backfaces(mod) {
  const out = [];
  for (const n of mod.nodes) {
    const { P, N, T } = n;
    const nt = T.length / 3;
    let mismatch = 0, mismatchArea = 0, area = 0;
    const isl = islands(n);
    for (let t = 0; t < nt; t++) {
      const g = triNormal(P, T, t);
      const a2 = Math.hypot(...g);
      area += a2 / 2;
      if (a2 < 1e-12) continue;
      let s = 0;
      for (let k = 0; k < 3; k++) { const v = T[t * 3 + k] * 3; s += g[0] * N[v] + g[1] * N[v + 1] + g[2] * N[v + 2]; }
      if (s < 0) { mismatch++; mismatchArea += a2 / 2; }
    }
    // (b) 闭合块
    let closedIsl = 0, openIsl = 0, invertedIsl = 0, inwardTris = 0, inwardArea = 0, closedTris = 0, internalTris = 0;
    const invertedList = [];
    for (const [ii, L] of isl.list.entries()) {
      const edge = new Map();
      for (const t of L.tris) for (let e = 0; e < 3; e++) {
        const a = isl.vid[T[t * 3 + e]], b = isl.vid[T[t * 3 + (e + 1) % 3]];
        const k = a < b ? a + '|' + b : b + '|' + a;
        edge.set(k, (edge.get(k) || 0) + 1);
      }
      const closed = [...edge.values()].every((c) => c === 2);
      if (!closed) { openIsl++; continue; }
      closedIsl++;
      closedTris += L.tris.length;
      let vol = 0;
      for (const t of L.tris) {
        const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
        vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
      }
      if (Math.abs(vol) < 1e-9) continue;
      let inw = 0, inwA = 0, internal = 0;
      const tri = (t) => [0, 1, 2].map((k) => [P[T[t * 3 + k] * 3], P[T[t * 3 + k] * 3 + 1], P[T[t * 3 + k] * 3 + 2]]);
      for (const t of L.tris) {
        const g = triNormal(P, T, t);
        const gl = Math.hypot(...g);
        if (gl < 1e-12) continue;
        const d = g.map((c) => c / gl);
        const [A, B, C] = tri(t);
        const o = [0, 1, 2].map((c) => (A[c] + B[c] + C[c]) / 3 + d[c] * 1e-3);
        let cnt = 0, coincident = false;
        for (const u of L.tris) {
          if (u === t) continue;
          const [A2, B2, C2] = tri(u);
          const s = rayTri(o, d, A2, B2, C2);
          if (s !== null && s > 1e-6) { cnt++; if (s < 2e-3) coincident = true; }
        }
        // 与另一块的面重合（两盒焊成一块时夹在中间的那对面）= 内部隐藏面，不判朝向
        if (coincident) { internal++; continue; }
        if (cnt % 2 === 1) {
          // 反向再测一次：沿 −n 也在体内（奇）= 面埋在焊在一起的另一个盒子里（内部面），不是反面
          const o2 = [0, 1, 2].map((c) => (A[c] + B[c] + C[c]) / 3 - d[c] * 1e-3);
          const nd = d.map((c) => -c);
          let cnt2 = 0;
          for (const u of L.tris) {
            if (u === t) continue;
            const [A2, B2, C2] = tri(u);
            const s2 = rayTri(o2, nd, A2, B2, C2);
            if (s2 !== null && s2 > 1e-6) cnt2++;
          }
          if (cnt2 % 2 === 1) { internal++; continue; }
          inw++; inwA += gl / 2;
        }
      }
      if (vol < 0) invertedIsl++;
      inwardTris += inw; inwardArea += inwA; internalTris += internal;
      if (vol < 0 || inw > L.tris.length / 2) invertedList.push({ island: ii, tris: L.tris.length, volume: +vol.toFixed(4), inwardTris: inw, bbox: [L.min.map(f3), L.max.map(f3)] });
    }
    out.push({ node: n.name, tris: nt, doubleSided: !!n.material.doubleSided, areaM2: +area.toFixed(3),
      windingVsNormal: { tris: mismatch, areaM2: +mismatchArea.toFixed(3) },
      closed: { islands: closedIsl, tris: closedTris, invertedIslands: invertedIsl, inwardTris, internalCoincidentTris: internalTris, inwardAreaM2: +inwardArea.toFixed(3), invertedSample: invertedList.slice(0, 8) },
      openIslands: openIsl });
  }
  return out;
}

// ---------- 实例放置 ----------
export function placeFn(inst) {
  const [x, z] = inst.position, r = inst.rotY, c = Math.cos(r), s = Math.sin(r), k = inst.scale || 1;
  return (lx, ly, lz) => [x + (c * lx + s * lz) * k, ly * k, z + (-s * lx + c * lz) * k];
}

export function worldTris(mod, inst, filter = null) {
  const pf = placeFn(inst);
  const out = [];
  for (const n of mod.nodes) {
    if (filter && !filter(n)) continue;
    const { P, T } = n;
    const W = new Float64Array(P.length);
    for (let i = 0; i < P.length / 3; i++) W.set(pf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), i * 3);
    for (let t = 0; t < T.length / 3; t++) {
      const A = [W[T[t * 3] * 3], W[T[t * 3] * 3 + 1], W[T[t * 3] * 3 + 2]];
      const B = [W[T[t * 3 + 1] * 3], W[T[t * 3 + 1] * 3 + 1], W[T[t * 3 + 1] * 3 + 2]];
      const C = [W[T[t * 3 + 2] * 3], W[T[t * 3 + 2] * 3 + 1], W[T[t * 3 + 2] * 3 + 2]];
      out.push({ A, B, C, node: n.name,
        min: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])],
        max: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])] });
    }
  }
  return out;
}

export function bboxOf(tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], t.min[c]); mx[c] = Math.max(mx[c], t.max[c]); }
  return { min: mn, max: mx };
}
export function boxInter(a, b) {
  const mn = [0, 1, 2].map((c) => Math.max(a.min[c], b.min[c])), mx = [0, 1, 2].map((c) => Math.min(a.max[c], b.max[c]));
  if (mx.some((v, c) => v <= mn[c])) return null;
  return { min: mn, max: mx, vol: (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]) };
}

// 三角-三角相交（非共面）：一方的边穿过另一方的面。共面（法线平行且面距 < 1 mm）单列（z-fight 候选）。
function segTri(p, q, A, B, C) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const s = rayTri(p, d, A, B, C);
  return s !== null && s > 1e-7 && s < 1 - 1e-7 ? [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s] : null;
}
const nrm = (A, B, C) => {
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n);
  return l > 1e-12 ? n.map((c) => c / l) : null;
};
export function triTri(t, u) {
  const nt = nrm(t.A, t.B, t.C), nu = nrm(u.A, u.B, u.C);
  if (!nt || !nu) return null;
  const dotn = Math.abs(nt[0] * nu[0] + nt[1] * nu[1] + nt[2] * nu[2]);
  const dist = Math.abs((u.A[0] - t.A[0]) * nt[0] + (u.A[1] - t.A[1]) * nt[1] + (u.A[2] - t.A[2]) * nt[2]);
  if (dotn > 0.9995) {
    // 平行：面距 < 1 mm 且 3D 包围盒重叠 = 共面重叠
    return dist < 1e-3 ? { coplanar: true } : null;
  }
  const pts = [];
  for (const [p, q] of [[t.A, t.B], [t.B, t.C], [t.C, t.A]]) { const x = segTri(p, q, u.A, u.B, u.C); if (x) pts.push(x); }
  for (const [p, q] of [[u.A, u.B], [u.B, u.C], [u.C, u.A]]) { const x = segTri(p, q, t.A, t.B, t.C); if (x) pts.push(x); }
  if (pts.length < 2) return null;
  let L = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) L = Math.max(L, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]));
  if (L < 1e-4) return null;
  return { coplanar: false, len: L, p: pts[0] };
}

// 两组世界三角（已按实例放置）互穿统计：3D 网格加速
export function crossIntersect(TA, TB, cell = 1.0, { minY = -Infinity } = {}) {
  const g = new Map();
  for (const [i, t] of TB.entries()) {
    for (let x = Math.floor(t.min[0] / cell); x <= Math.floor(t.max[0] / cell); x++)
      for (let y = Math.floor(t.min[1] / cell); y <= Math.floor(t.max[1] / cell); y++)
        for (let z = Math.floor(t.min[2] / cell); z <= Math.floor(t.max[2] / cell); z++) {
          const k = x + ',' + y + ',' + z;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(i);
        }
  }
  const pairs = new Map();   // nodeA|nodeB -> {n, len, coplanar, box}
  let n = 0, cop = 0, len = 0;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const t of TA) {
    const cand = new Set();
    for (let x = Math.floor(t.min[0] / cell); x <= Math.floor(t.max[0] / cell); x++)
      for (let y = Math.floor(t.min[1] / cell); y <= Math.floor(t.max[1] / cell); y++)
        for (let z = Math.floor(t.min[2] / cell); z <= Math.floor(t.max[2] / cell); z++)
          for (const j of g.get(x + ',' + y + ',' + z) || []) cand.add(j);
    for (const j of cand) {
      const u = TB[j];
      if (t.max[0] < u.min[0] || u.max[0] < t.min[0] || t.max[1] < u.min[1] || u.max[1] < t.min[1] || t.max[2] < u.min[2] || u.max[2] < t.min[2]) continue;
      const r = triTri(t, u);
      if (!r) continue;
      if (!r.coplanar && r.p[1] < minY) continue;       // 地面以下 / 贴地的交线（台基、地坪入土）不计
      if (r.coplanar && Math.max(t.max[1], u.max[1]) < minY) continue;
      const k = t.node + ' × ' + u.node;
      const rec = pairs.get(k) || { pair: k, crossings: 0, lenM: 0, coplanarTris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      if (r.coplanar) { rec.coplanarTris++; cop++; }
      else {
        rec.crossings++; rec.lenM += r.len; n++; len += r.len;
        for (let c = 0; c < 3; c++) { rec.min[c] = Math.min(rec.min[c], r.p[c]); rec.max[c] = Math.max(rec.max[c], r.p[c]); box.min[c] = Math.min(box.min[c], r.p[c]); box.max[c] = Math.max(box.max[c], r.p[c]); }
      }
      pairs.set(k, rec);
    }
  }
  const list = [...pairs.values()].map((r) => ({ ...r, lenM: f3(r.lenM), min: r.min.map((v) => (isFinite(v) ? f3(v) : null)), max: r.max.map((v) => (isFinite(v) ? f3(v) : null)) }))
    .sort((a, b) => b.lenM - a.lenM || b.coplanarTris - a.coplanarTris);
  return { crossings: n, lenM: f3(len), coplanarTris: cop, box: n ? { min: box.min.map(f3), max: box.max.map(f3) } : null, pairs: list };
}

// ---------- 4) 浮空 / 埋地 ----------
// 构件 = 节点内焊接连通块。浮空：块底 > 地面 + 0.02 且块到模块内其他任何块的最近距离 > GAP（0.02 m）——
// 既不落地也不与任何构件相接。最近距离 = 块的顶点到其他块三角的点-三角距离的最小值（只在块包围盒外扩 GAP 的范围内找）。
// 埋地：块顶 < 地面 − 0.005（整块在地下，看不见的废面）；以及块底 < −0.3（深埋，写数字不判错）。
export const GAP = 0.02;
function ptTriDist2(p, A, B, C) {
  // Ericson closest point on triangle
  const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], ap = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const D = (q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  if (d1 <= 0 && d2 <= 0) return D(A);
  const bp = [p[0] - B[0], p[1] - B[1], p[2] - B[2]];
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return D(B);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return D([A[0] + ab[0] * v, A[1] + ab[1] * v, A[2] + ab[2] * v]); }
  const cp = [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return D(C);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return D([A[0] + ac[0] * w, A[1] + ac[1] * w, A[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return D([B[0] + (C[0] - B[0]) * w, B[1] + (C[1] - B[1]) * w, B[2] + (C[2] - B[2]) * w]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return D([A[0] + ab[0] * v + ac[0] * w, A[1] + ab[1] * v + ac[1] * w, A[2] + ab[2] * v + ac[2] * w]);
}

export function floatBury(mod, groundY = 0) {
  // 全模块三角 + 块号
  const all = [];
  const blocks = [];
  for (const n of mod.nodes) {
    const isl = islands(n);
    const base = blocks.length;
    for (const L of isl.list) blocks.push({ node: n.name, lo: L.lo, hi: L.hi, min: L.min, max: L.max, tris: L.tris.length, verts: [] });
    const { P, T } = n;
    for (let i = 0; i < P.length / 3; i++) blocks[base + isl.vIsl[i]].verts.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    for (let t = 0; t < T.length / 3; t++) {
      const V = [0, 1, 2].map((k) => [P[T[t * 3 + k] * 3], P[T[t * 3 + k] * 3 + 1], P[T[t * 3 + k] * 3 + 2]]);
      all.push({ A: V[0], B: V[1], C: V[2], blk: base + isl.tIsl[t],
        min: [0, 1, 2].map((c) => Math.min(V[0][c], V[1][c], V[2][c])), max: [0, 1, 2].map((c) => Math.max(V[0][c], V[1][c], V[2][c])) });
    }
  }
  const cell = 1.0, g = new Map();
  for (const [i, t] of all.entries())
    for (let x = Math.floor((t.min[0] - GAP) / cell); x <= Math.floor((t.max[0] + GAP) / cell); x++)
      for (let y = Math.floor((t.min[1] - GAP) / cell); y <= Math.floor((t.max[1] + GAP) / cell); y++)
        for (let z = Math.floor((t.min[2] - GAP) / cell); z <= Math.floor((t.max[2] + GAP) / cell); z++) {
          const k = x + ',' + y + ',' + z;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(i);
        }
  const floating = [], buried = [], deep = [];
  for (const [bi, b] of blocks.entries()) {
    if (b.hi < groundY - 0.005) { buried.push({ node: b.node, tris: b.tris, topY: f3(b.hi), bbox: [b.min.map(f3), b.max.map(f3)] }); continue; }
    if (b.lo < groundY - 0.3) deep.push({ node: b.node, tris: b.tris, bottomY: f3(b.lo) });
    if (b.lo <= groundY + GAP) continue;          // 落地
    let best = Infinity;
    for (const p of b.verts) {
      const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell) + ',' + Math.floor(p[2] / cell);
      for (const i of g.get(k) || []) {
        const t = all[i];
        if (t.blk === bi) continue;
        if (p[0] < t.min[0] - GAP || p[0] > t.max[0] + GAP || p[1] < t.min[1] - GAP || p[1] > t.max[1] + GAP || p[2] < t.min[2] - GAP || p[2] > t.max[2] + GAP) continue;
        best = Math.min(best, ptTriDist2(p, t.A, t.B, t.C));
        if (best <= 1e-8) break;
      }
      if (best <= 1e-8) break;
    }
    const d = Math.sqrt(best);
    if (d <= GAP) continue;
    // 顶点离别的面都远：再查是否与别的块三角相交（端头插进柱 / 墙里 = 嵌入，不算浮空）
    let embedded = false;
    const mine = all.filter((t) => t.blk === bi);
    for (const t of mine) {
      const cand = new Set();
      for (let x = Math.floor(t.min[0] / cell); x <= Math.floor(t.max[0] / cell) && !embedded; x++)
        for (let y = Math.floor(t.min[1] / cell); y <= Math.floor(t.max[1] / cell); y++)
          for (let z = Math.floor(t.min[2] / cell); z <= Math.floor(t.max[2] / cell); z++)
            for (const i of g.get(x + ',' + y + ',' + z) || []) if (all[i].blk !== bi) cand.add(i);
      for (const i of cand) {
        const u = all[i];
        if (t.max[0] < u.min[0] || u.max[0] < t.min[0] || t.max[1] < u.min[1] || u.max[1] < t.min[1] || t.max[2] < u.min[2] || u.max[2] < t.min[2]) continue;
        const r = triTri(t, u);
        if (r && !r.coplanar) { embedded = true; break; }
      }
      if (embedded) break;
    }
    if (!embedded) floating.push({ node: b.node, tris: b.tris, bottomY: f3(b.lo), nearestM: isFinite(d) ? f3(d) : null, bbox: [b.min.map(f3), b.max.map(f3)] });
  }
  return { blocks: blocks.length, floating, buried, deep };
}

// ---------- 5) 贴图：名字（去 .NNN）+ 尺寸 + 内容 sha ----------
export function imageDimsOf(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}
export function imagesOf(file) {
  const { json, bin } = readGlbRaw(file);
  return (json.images || []).map((im, idx) => {
    const bv = json.bufferViews[im.bufferView];
    const bytes = Buffer.from(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
    const dims = imageDimsOf(bytes);
    // 用它的材质
    const users = [];
    for (const m of json.materials || []) {
      const texIdx = [m.pbrMetallicRoughness?.baseColorTexture?.index, m.normalTexture?.index, m.pbrMetallicRoughness?.metallicRoughnessTexture?.index, m.occlusionTexture?.index, m.emissiveTexture?.index];
      const slots = ['baseColor', 'normal', 'metallicRoughness', 'occlusion', 'emissive'];
      texIdx.forEach((ti, s) => { if (ti !== undefined && json.textures[ti].source === idx) users.push(m.name + ':' + slots[s]); });
    }
    return { idx, name: im.name || '', key: (im.name || '').replace(/\.\d{3}$/, ''), dims, sha: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, users };
  });
}
