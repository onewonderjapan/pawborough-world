// 通用模块普查库（wave8-smallqa）：亭子套件 modules/pavilion-kit + 摊位套件 modules/bazaar-stalls。
// 与 templeqa-lib 的差别：这里的模块/分区 GLB 带节点层级与变换（亭 root→body/roof/rail、分区锚 empty→网格），
// 所以自带「烘焙世界矩阵」的 GLB 读取；纯几何检查（焊接、射线、三角互穿、贴图清单）直接复用 templeqa-lib。
// 摆放重算口径（不读总装产物，位置一律从 baseline/layout.json + 模块 records 重算，同 COMMON 验收 5）：
//   亭   = assemble.py：layout footprint 质心 + rotY=atan2(facade.dir.x, facade.dir.z)；
//   摊/凳 = modules/bazaar-stalls/records/placements.json 的 position/rotY（参数文件即权威）；
//   檐棚 = assemble.py 口径：records/awning-placements.json 的 edge，外法线按 layout footprint 绕向从边向量重算
//          （records 里的 dir/outward/rotY 是转过 90° 的旧值，不用），rotY=atan2(ox,oz)，position=边中点。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readGlbRaw, imagesOf, islands, triNormal, CLIP_TOL, SEAT, f3 } from './templeqa-lib.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LAYOUT = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));

// ---------- GLB 层级读取：每节点烘焙到 GLB 根系（Y-up） ----------
function matMul(a, b) {          // glTF 列主序 4x4：a@b
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const IDENT = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function localMatrix(n) {
  if (n.matrix) return Float64Array.from(n.matrix);
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = (2 * (x * y + z * w)) * s[0]; m[2] = (2 * (x * z - y * w)) * s[0];
  m[4] = (2 * (x * y - z * w)) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = (2 * (y * z + x * w)) * s[1];
  m[8] = (2 * (x * z + y * w)) * s[2]; m[9] = (2 * (y * z - x * w)) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accOf(json, bin, ai) {
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
}

// 读 GLB：返回 { file, json, nodes, extent }。P/N 已烘焙到根坐标系。
// anchorRe：每个网格节点沿祖先找第一个名字匹配 anchorRe 的空节点，记到 node.anchor（分区件按实例锚分组用）。
// normLimit：烘焙后最大绝对坐标超过它就报错（防误读异坐标系文件；分区件传 1e6）。
export function readGlbTree(file, { anchorRe = null, normLimit = 1e4 } = {}) {
  const { json, bin } = readGlbRaw(file);
  const nodes = json.nodes || [];
  const parent = new Map();
  const walk = (i) => { for (const c of nodes[i].children || []) { parent.set(c, i); walk(c); } };
  (json.scenes?.[json.scene || 0]?.children || nodes.map((_, i) => i)).forEach(walk);
  const world = new Map();
  const wm = (i) => {
    if (world.has(i)) return world.get(i);
    const m = matMul(parent.has(i) ? wm(parent.get(i)) : IDENT, localMatrix(nodes[i]));
    world.set(i, m);
    return m;
  };
  const anchorOf = new Map();
  if (anchorRe) {
    for (const [i, n] of nodes.entries()) {
      let cur = i;
      while (parent.has(cur)) {
        cur = parent.get(cur);
        if (nodes[cur].mesh === undefined && anchorRe.test(nodes[cur].name || '')) { anchorOf.set(i, nodes[cur].name); break; }
      }
    }
  }
  const out = [];
  let ext = 0;
  for (const [i, n] of nodes.entries()) {
    if (n.mesh === undefined) continue;
    const M = wm(i);
    const r = [[M[0], M[4], M[8]], [M[1], M[5], M[9]], [M[2], M[6], M[10]]];
    const det = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
    const sign = det >= 0 ? 1 : -1;
    // 法线 = 上 3x3 的代数余子式转置（不依赖均匀缩放；此处变换只有旋转/平移/整体缩放，够用）
    const nrm = [
      [r[1][1] * r[2][2] - r[1][2] * r[2][1], r[1][2] * r[2][0] - r[1][0] * r[2][2], r[1][0] * r[2][1] - r[1][1] * r[2][0]],
      [r[2][1] * r[0][2] - r[2][2] * r[0][1], r[2][2] * r[0][0] - r[2][0] * r[0][2], r[2][0] * r[0][1] - r[2][1] * r[0][0]],
      [r[0][1] * r[1][2] - r[0][2] * r[1][1], r[0][2] * r[1][0] - r[0][0] * r[1][2], r[0][0] * r[1][1] - r[0][1] * r[1][0]],
    ].map((row) => row.map((v) => v * sign));
    const Ps = [], Ns = [], Ts = [];
    let base = 0;
    const mats = [];
    for (const pr of json.meshes[n.mesh].primitives) {
      const P = accOf(json, bin, pr.attributes.POSITION);
      const N = pr.attributes.NORMAL !== undefined ? accOf(json, bin, pr.attributes.NORMAL) : null;
      const I = pr.indices !== undefined ? accOf(json, bin, pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, k) => k);
      for (let v = 0; v < P.length / 3; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        P[v * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
        P[v * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        P[v * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (N) {
          const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
          N[v * 3] = nrm[0][0] * a + nrm[0][1] * b + nrm[0][2] * c;
          N[v * 3 + 1] = nrm[1][0] * a + nrm[1][1] * b + nrm[1][2] * c;
          N[v * 3 + 2] = nrm[2][0] * a + nrm[2][1] * b + nrm[2][2] * c;
        }
        if (P[v * 3] > ext) ext = P[v * 3]; if (-P[v * 3] > ext) ext = -P[v * 3];
        if (P[v * 3 + 1] > ext) ext = P[v * 3 + 1]; if (-P[v * 3 + 1] > ext) ext = -P[v * 3 + 1];
        if (P[v * 3 + 2] > ext) ext = P[v * 3 + 2]; if (-P[v * 3 + 2] > ext) ext = -P[v * 3 + 2];
      }
      Ps.push(P); Ns.push(N);
      for (let k = 0; k + 2 < I.length; k += 3) Ts.push(base + I[k], base + I[k + 1], base + I[k + 2]);
      base += P.length / 3;
      mats.push(json.materials?.[pr.material] || {});
    }
    const P = new Float64Array(base * 3), N = new Float64Array(base * 3);
    let o = 0;
    Ps.forEach((p, k) => { P.set(p, o); if (Ns[k]) N.set(Ns[k], o); o += p.length; });
    const [part, mat] = (n.name || '').split('__');
    out.push({ name: n.name || '', anchor: anchorOf.get(i) || null, part, mat, P, N, T: Uint32Array.from(Ts), material: mats[0] });
  }
  if (ext > normLimit) throw new Error(`smallqa: ${path.basename(file)} root-space extent ${ext.toFixed(1)} > ${normLimit} (坐标系不对?)`);
  return { file, json, nodes: out, extent: ext };
}

// 分区 GLB 按实例锚分组：Map<锚名|null, node[]>
export function zoneGroups(zoneFile, anchorRe) {
  const t = readGlbTree(zoneFile, { anchorRe, normLimit: 1e6 });
  const groups = new Map();
  for (const n of t.nodes) {
    const k = n.anchor || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  return { tree: t, groups };
}

// ---------- 摆放重算 ----------
export const PAVILION_IDS = ['bld-428179924', 'bld-428186467', 'bld-428196085', 'bld-428196091', 'bld-428196098'];
export function pavilionInstances() {
  const L = LAYOUT();
  const byId = new Map(L.objects.map((o) => [o.id, o]));
  return PAVILION_IDS.map((pid) => {
    const o = byId.get(pid);
    if (!o) throw new Error('smallqa: layout missing pavilion ' + pid);
    let fp = o.geometry.footprint;
    if (fp[0][0] === fp[fp.length - 1][0] && fp[0][1] === fp[fp.length - 1][1]) fp = fp.slice(0, -1);
    const cx = fp.reduce((s, q) => s + q[0], 0) / fp.length, cz = fp.reduce((s, q) => s + q[1], 0) / fp.length;
    const d = o.facade.dir;
    return { id: pid, zh: o.zh || pid, position: [cx, cz], rotY: Math.atan2(d[0], d[1]), dir: d };
  });
}

export function stallInstances() {
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'bazaar-stalls', 'records', 'placements.json'), 'utf8'));
  return [...rec.stalls, ...rec.benches].map((it) => ({ id: it.id, kind: it.kind, type: it.type || '', module: it.module, position: it.position, rotY: it.rotY }));
}

// 檐棚：外法线从 layout footprint 重算（assemble.py 同式，独立实现）
export function awningInstances() {
  const L = LAYOUT();
  const byId = new Map(L.objects.map((o) => [o.id, o]));
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'bazaar-stalls', 'records', 'awning-placements.json'), 'utf8'));
  return rec.edges.map((e) => {
    let fp = byId.get(e.blockId)?.geometry.footprint;
    if (!fp) throw new Error('smallqa: layout missing awning block ' + e.blockId);
    if (fp[0][0] === fp[fp.length - 1][0] && fp[0][1] === fp[fp.length - 1][1]) fp = fp.slice(0, -1);
    const area2 = fp.reduce((s, p, i) => s + p[0] * fp[(i + 1) % fp.length][1] - fp[(i + 1) % fp.length][0] * p[1], 0);
    const [[ax, az], [bx, bz]] = e.edge;
    const ex = bx - ax, ez = bz - az, n = Math.hypot(ex, ez);
    const ox = area2 > 0 ? ez / n : -ez / n, oz = area2 > 0 ? -ex / n : ex / n;
    return { id: `awning-${e.blockId}-${e.edgeIndex}`, blockId: e.blockId, module: e.module, edge: e.edge,
      position: [(ax + bx) / 2, (az + bz) / 2], rotY: Math.atan2(ox, oz), outward: [ox, oz], street: e.street };
  });
}

// 实例位姿 → 世界：map(X,Z) + 高度 Y（Blender Z-yaw 的等价式，同 templeqa placeFn）
export function worldMatrix(inst) {
  const [x, z] = inst.position, r = inst.rotY, c = Math.cos(r), s = Math.sin(r), k = inst.scale || 1;
  return (lx, ly, lz) => [x + (c * lx + s * lz) * k, ly * k, z + (-s * lx + c * lz) * k];
}
export function bakeWorld(nodes, inst) {
  const pf = worldMatrix(inst);
  return nodes.map((n) => {
    const P = new Float64Array(n.P.length);
    for (let i = 0; i < n.P.length / 3; i++) P.set(pf(n.P[i * 3], n.P[i * 3 + 1], n.P[i * 3 + 2]), i * 3);
    return { ...n, P };
  });
}

// ---------- 屋面覆盖 / 穿出（roofClip 的参数化版：isRoof 由调用者按套件给） ----------
// 口径同 templeqa-lib.roofCover/roofClip：覆盖面 = 屋面节点的非竖直三角（|ny| ≥ 0.2|n|），
// 片上沿（根线）0.2 m 豁免；坐在屋面上的饰件（块底在屋面 SEAT=0.3 内）单列不算穿出。
export function roofCoverPred(mod, isRoof) {
  const tris = [];
  const rootEdges = new Map();
  for (const [ni, n] of mod.nodes.entries()) {
    if (!isRoof(n)) continue;
    const { P, T } = n;
    const isl = islands(n);
    const sheet = (t) => ni + ':' + isl.tIsl[t];
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
  const g = new Map();
  for (const [i, t] of tris.entries()) {
    for (let gx = Math.floor(t.x0 / 0.5); gx <= Math.floor(t.x1 / 0.5); gx++)
      for (let gz = Math.floor(t.z0 / 0.5); gz <= Math.floor(t.z1 / 0.5); gz++) {
        const k = gx + ',' + gz;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(i);
      }
  }
  return (x, z, rootBand = -1) => {
    const out = [];
    for (const i of g.get(Math.floor(x / 0.5) + ',' + Math.floor(z / 0.5)) || []) {
      const t = tris[i];
      if (x < t.x0 - 1e-9 || x > t.x1 + 1e-9 || z < t.z0 - 1e-9 || z > t.z1 + 1e-9) continue;
      const { A, B, C, den } = t;
      const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / den;
      const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const y = l1 * A[1] + l2 * B[1] + l3 * C[1];
      out.push(rootBand >= 0 && (rootEdges.get(t.sheet) || []).some((e) => segD(x, z, e) <= rootBand) ? { y, root: true } : y);
    }
    return out;
  };
}

export function roofClipPred(mod, isRoof, { rootBand = 0.2, tol = CLIP_TOL } = {}) {
  const hits = roofCoverPred(mod, isRoof);
  const rows = [], seated = [];
  for (const n of mod.nodes) {
    if (isRoof(n)) continue;
    const isl = islands(n);
    const { P } = n;
    const per = new Map();
    const seen = new Set();
    for (let i = 0; i < P.length / 3; i++) {
      const k = Math.round(P[i * 3] / 1e-3) + ',' + Math.round(P[i * 3 + 1] / 1e-3) + ',' + Math.round(P[i * 3 + 2] / 1e-3);
      if (seen.has(k)) continue;
      seen.add(k);
      const L = isl.list[isl.vIsl[i]];
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const hs = hits(x, z, rootBand);
      const aboveAll = hs.map((h) => (typeof h === 'number' ? h : h.y)).filter((h) => h > L.lo + 0.05);
      if (!aboveAll.length) continue;
      const above = hs.filter((h) => typeof h === 'number' && h > L.lo + 0.05);
      if (!above.length) continue;
      const cover = Math.min(...above);
      const ex = y - cover;
      const through = y - Math.max(...above);
      const r = per.get(isl.vIsl[i]) || { worst: -Infinity, count: 0, through: -Infinity, throughCount: 0 };
      if (ex > tol) r.count++;
      if (through > tol) r.throughCount++;
      if (ex > r.worst) { r.worst = ex; r.at = [x, y, z]; r.cover = cover; }
      if (through > r.through) { r.through = through; r.throughAt = [x, y, z]; }
      per.set(isl.vIsl[i], r);
    }
    for (const [ii, r] of per) {
      if (r.worst <= tol) continue;
      const L = isl.list[ii];
      const cx = (L.min[0] + L.max[0]) / 2, cz = (L.min[2] + L.max[2]) / 2;
      const under = hits(cx, cz).filter((h) => h <= L.lo + SEAT + 1e-6);
      const seatedOnRoof = under.length > 0 && L.lo >= Math.max(...under) - SEAT;
      const rec = { node: n.name, island: ii, tris: L.tris.length, bottomY: f3(L.lo), topY: f3(L.hi),
        maxExcessM: f3(r.worst), vertsOver: r.count, at: r.at.map(f3), roofAtM: f3(r.cover),
        throughM: f3(r.through), vertsThrough: r.throughCount };
      (seatedOnRoof ? seated : rows).push(rec);
    }
  }
  rows.sort((a, b) => b.maxExcessM - a.maxExcessM);
  return { violations: rows, seatedOrnaments: seated };
}

// 点-三角距离²（Ericson）；templeqa-lib 未导出，这里内联同式
function ptTriDist2(p, A, B, C) {
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

// ---------- 浮空 / 埋地（摊亭版） ----------
import { rayTri, triTri } from './templeqa-lib.mjs';
// templeqa floatBury 的「浮空」= 块顶点 2 cm 内无邻块且不嵌入。摊/凳的台面板整面坐在柜体上但四角悬挑，
// 顶点全在支撑面外 → 误报；挂落是悬挂件，靠顶边挂在额枋下。这里改为三路判支撑，任一成立即不浮：
//   a) 任意顶点到别的块三角最近距离 ≤ gap（顶边挂接、端头搭接都在这一路）；
//   b) 任意三角面心沿 −Y / +Y 打 gap 短射线命中别的块（面-面贴合、顶点悬挑的台面板走这一路）；
//   c) 与别的块三角相交（嵌入）。
export function floatBurySupported(mod, { groundY = 0, gap = 0.02 } = {}) {
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
    for (let x = Math.floor((t.min[0] - gap) / cell); x <= Math.floor((t.max[0] + gap) / cell); x++)
      for (let y = Math.floor((t.min[1] - gap) / cell); y <= Math.floor((t.max[1] + gap) / cell); y++)
        for (let z = Math.floor((t.min[2] - gap) / cell); z <= Math.floor((t.max[2] + gap) / cell); z++) {
          const k = x + ',' + y + ',' + z;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(i);
        }
  const near = (p) => {
    const out = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const i of g.get((Math.floor(p[0] / cell) + dx) + ',' + (Math.floor(p[1] / cell) + dy) + ',' + (Math.floor(p[2] / cell) + dz)) || []) out.add(i);
    return out;
  };
  const floating = [], buried = [], deep = [];
  for (const [bi, b] of blocks.entries()) {
    if (b.hi < groundY - 0.005) { buried.push({ node: b.node, tris: b.tris, topY: f3(b.hi), bbox: [b.min.map(f3), b.max.map(f3)] }); continue; }
    if (b.lo < groundY - 0.3) deep.push({ node: b.node, tris: b.tris, bottomY: f3(b.lo) });
    if (b.lo <= groundY + gap) continue;          // 落地
    let best = Infinity;
    for (const p of b.verts) {
      for (const i of near(p)) {
        const t = all[i];
        if (t.blk === bi) continue;
        if (p[0] < t.min[0] - gap || p[0] > t.max[0] + gap || p[1] < t.min[1] - gap || p[1] > t.max[1] + gap || p[2] < t.min[2] - gap || p[2] > t.max[2] + gap) continue;
        best = Math.min(best, ptTriDist2(p, t.A, t.B, t.C));
        if (best <= 1e-8) break;
      }
      if (best <= 1e-8) break;
    }
    let supported = best <= gap * gap;
    if (!supported) {
      for (const t of all) {
        if (t.blk !== bi) continue;
        const c = [(t.A[0] + t.B[0] + t.C[0]) / 3, (t.A[1] + t.B[1] + t.C[1]) / 3 + 1e-3, (t.A[2] + t.B[2] + t.C[2]) / 3];
        for (const dir of [[0, -1, 0], [0, 1, 0]]) {
          for (const i of near(c)) {
            const u = all[i];
            if (u.blk === bi) continue;
            const h = rayTri(c, dir, u.A, u.B, u.C);
            if (h !== null && h > -1e-4 && h <= gap + 2e-3) { supported = true; break; }
          }
          if (supported) break;
        }
        if (supported) break;
      }
    }
    if (supported) continue;
    // 嵌入：与别的块三角相交
    let embedded = false;
    for (const t of all) {
      if (t.blk !== bi) continue;
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
    if (!embedded) floating.push({ node: b.node, tris: b.tris, bottomY: f3(b.lo), nearestM: isFinite(best) ? f3(Math.sqrt(best)) : null, bbox: [b.min.map(f3), b.max.map(f3)] });
  }
  return { blocks: blocks.length, floating, buried, deep };
}
// ---------- PNG 解码（8-bit 非隔行 RGBA/RGB/灰度/索引+alpha）：挂落贴图明度检查用 ----------
export function decodePng(bytes) {
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) return null;
  let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off), type = bytes.toString('ascii', off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (depth !== 8 || interlace !== 0) return null;
  const chIn = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!chIn) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * chIn;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const p = y * (stride + 1);
    const ft = raw[p];
    const line = Buffer.from(raw.subarray(p + 1, p + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= chIn ? line[i - chIn] : 0, b = prev[i], c = i >= chIn ? prev[i - chIn] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 0xff;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      let r, g, b2, al = 255;
      if (color === 6) { r = line[x * 4]; g = line[x * 4 + 1]; b2 = line[x * 4 + 2]; al = line[x * 4 + 3]; }
      else if (color === 2) { r = line[x * 3]; g = line[x * 3 + 1]; b2 = line[x * 3 + 2]; }
      else if (color === 0) { r = g = b2 = line[x]; }
      else if (color === 4) { r = g = b2 = line[x * 2]; al = line[x * 2 + 1]; }
      else { const idx = line[x]; r = plte[idx * 3]; g = plte[idx * 3 + 1]; b2 = plte[idx * 3 + 2]; if (trns && idx < trns.length) al = trns[idx]; }
      out[(y * w + x) * 4] = r; out[(y * w + x) * 4 + 1] = g; out[(y * w + x) * 4 + 2] = b2; out[(y * w + x) * 4 + 3] = al;
    }
  }
  return { w, h, rgba: out };
}

// 挂落 / 立面明度（hall-kit 检色口径的贴图层版本）：baseColor 贴图 alpha>127 的像素，
// 显示空间 sRGB（解码值 /255）平均色 R>G、R>B、HSV 明度 max(R,G,B) ≥ 0.22。
// hall-kit 原口径在渲染像面区域上检色；这里是同一阈值的贴图层近似（贴图即格心最终颜色来源），差异写进结果。
export function latticeLuma(file, { matRe = /hanglo|lattice|latt/i } = {}) {
  const { json, bin } = readGlbRaw(file);
  const out = [];
  for (const m of json.materials || []) {
    const nm = m.name || '';
    if (!matRe.test(nm)) continue;
    const ti = m.pbrMetallicRoughness?.baseColorTexture?.index;
    if (ti === undefined) { out.push({ material: nm, note: 'no baseColorTexture' }); continue; }
    const im = (json.images || [])[json.textures[ti].source];
    const bv = json.bufferViews[im.bufferView];
    const bytes = Buffer.from(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
    const png = decodePng(bytes);
    if (!png) { out.push({ material: nm, note: 'not decodable PNG' }); continue; }
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < png.w * png.h; i++) {
      if (png.rgba[i * 4 + 3] <= 127) continue;
      n++; sr += png.rgba[i * 4] / 255; sg += png.rgba[i * 4 + 1] / 255; sb += png.rgba[i * 4 + 2] / 255;
    }
    if (!n) { out.push({ material: nm, note: 'no opaque pixels' }); continue; }
    const R = sr / n, G = sg / n, B = sb / n;
    out.push({ material: nm, dims: [png.w, png.h], opaquePx: n, avg: { R: +R.toFixed(4), G: +G.toFixed(4), B: +B.toFixed(4) }, hsvV: +Math.max(R, G, B).toFixed(4), pass: R > G && R > B && Math.max(R, G, B) >= 0.22 });
  }
  return out;
}

export { imagesOf };
