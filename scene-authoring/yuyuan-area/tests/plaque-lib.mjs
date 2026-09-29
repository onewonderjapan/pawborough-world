// wave13-plaquefix：商城楼立面面板朝向 / 大匾定位的共用真相（tests/plaque-facing-test.mjs 静态、tests/plaque-browser-check.mjs 浏览器共用）。
// 真相来源都不经生成器输出：外侧方向 = baseline/layout.json footprint（地图 x,z = glTF x,z）；大匾尺寸 = bazaar-tower-kit params features.plaques；
// 大匾位置 = assemble 产物 raw 分区 GLB（cm 由此压缩，查看器吃 cm —— 浏览器检查查的是查看器，不是 raw 本身）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KIT = path.join(ROOT, 'modules', 'bazaar-tower-kit');
export const PANEL_MATS = new Set(['btk-dark', 'btk-gild', 'btk-signred', 'btk-shopback', 'btk-glass']);
export const baseMat = (n) => String(n || '').replace(/\.\d{3}$/, '');

// ---------- GLB 读取（raw 分区件，无压缩扩展） ----------
export function readGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bo = 20 + jl;
  const bin = b.subarray(bo + 8, bo + 8 + b.readUInt32LE(bo));
  if ((json.extensionsUsed || []).includes('EXT_meshopt_compression')) throw new Error(p + ': compressed (expected raw zone GLB)');
  return { json, bin };
}
const COMP = { 5126: [4, 'readFloatLE'], 5125: [4, 'readUInt32LE'], 5123: [2, 'readUInt16LE'], 5121: [1, 'readUInt8'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor({ json, bin }, i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
  const [sz, fn] = COMP[a.componentType], nc = NCOMP[a.type];
  const stride = bv.byteStride || sz * nc, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let k = 0; k < a.count; k++) { const v = []; for (let c = 0; c < nc; c++) v.push(bin[fn](base + k * stride + c * sz)); out.push(v); }
  return out;
}
// 4x4 列主序矩阵
const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
function localMat(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], t = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1];
}
const xfP = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const xfD = (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------- footprint（地图 x,z）外法线 ----------
function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function footprintEdges(fp) {
  const out = [];
  for (let i = 0; i + 1 < fp.length; i++) {
    const a = fp[i], b = fp[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.3) continue;
    let n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (inPoly([mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05], fp)) n = [-n[0], -n[1]];
    out.push({ a, b, L, n });
  }
  return out;
}
function segDist(p, e) {
  const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dz) / (e.L * e.L)));
  return Math.hypot(p[0] - (e.a[0] + dx * t), p[1] - (e.a[1] + dz * t));
}
// 与面平行（|cos| ≥ 0.9）的最近 footprint 边的外法线（glTF 向量 [nx,0,nz]）；找不到平行边返回 null
export function outwardFor(cen, triN, eds) {
  let best = null, bd = Infinity;
  for (const e of eds) {
    if (Math.abs(e.n[0] * triN[0] + e.n[1] * triN[2]) < 0.9) continue;
    const d = segDist([cen[0], cen[2]], e);
    if (d < bd) { bd = d; best = e; }
  }
  return best ? { n: [best.n[0], 0, best.n[1]], dist: bd } : null;
}

export function triInfo(t) {
  const c = cross(sub(t.P[1], t.P[0]), sub(t.P[2], t.P[0]));
  return { area: len(c) / 2, n: unit(c), cen: [0, 1, 2].map(k => (t.P[0][k] + t.P[1][k] + t.P[2][k]) / 3) };
}

export function loadInputs(OUT) {
  const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
  const FP = new Map(layout.objects.filter(o => o.geometry && o.geometry.footprint).map(o => [o.id, o.geometry.footprint]));
  const ids = JSON.parse(fs.readFileSync(path.join(KIT, 'ids.json'), 'utf8'));
  const params = new Map(ids.ids.map(id => [id, JSON.parse(fs.readFileSync(path.join(KIT, ids.params[id]), 'utf8'))]));
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
  const files = manifest.zones.filter(z => z.id === 'bazaar' && z.file).map(z => path.join(OUT, z.file));
  return { FP, ids, params, files };
}

// 每楼：锚节点（楼 id）下 plaques__* / shopfront__* 子节点里 PANEL_MATS 材质的世界三角
export function panelTriangles(files, idList) {
  const towers = new Map();   // id -> [{node, mat, P:[a,b,c], vn}]
  for (const f of files) {
    const g = readGlb(f), J = g.json;
    const parent = new Map();
    (J.nodes || []).forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
    const world = new Map();
    const W = (i) => { if (world.has(i)) return world.get(i); const m = parent.has(i) ? mul(W(parent.get(i)), localMat(J.nodes[i])) : localMat(J.nodes[i]); world.set(i, m); return m; };
    J.nodes.forEach((n, i) => {
      if (n.mesh === undefined || !/^(plaques|shopfront)__/.test(n.name || '')) return;
      let a = parent.get(i); while (a !== undefined && !idList.includes(J.nodes[a].name)) a = parent.get(a);
      if (a === undefined) return;
      const bid = J.nodes[a].name, M = W(i);
      const list = towers.get(bid) || []; towers.set(bid, list);
      for (const pr of J.meshes[n.mesh].primitives) {
        const mat = baseMat(J.materials[pr.material]?.name);
        if (!PANEL_MATS.has(mat)) continue;
        const P = accessor(g, pr.attributes.POSITION).map(p => xfP(M, p));
        const N = pr.attributes.NORMAL !== undefined ? accessor(g, pr.attributes.NORMAL).map(d => unit(xfD(M, d))) : null;
        const I = pr.indices !== undefined ? accessor(g, pr.indices).map(v => v[0]) : P.map((_, k) => k);
        for (let k = 0; k < I.length; k += 3) {
          const t = [I[k], I[k + 1], I[k + 2]];
          list.push({ node: n.name, mat, P: t.map(q => P[q]), vn: N ? unit(t.map(q => N[q]).reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0])) : null });
        }
      }
    });
  }
  return towers;
}

// features.plaques 大匾：板（btk-dark，w·h/2 两三角）与金框（btk-gild）；center / 绕序法线 / footprint 外法线
export function bigPlaques({ FP, ids, params }, towers) {
  const out = [];
  for (const id of ids.ids) {
    const pr = params.get(id), pls = pr.features?.plaques || [];
    if (!pls.length) continue;
    const eds = footprintEdges(FP.get(id));
    const tris = (towers.get(id) || []).map(t => ({ ...t, ...triInfo(t) }));
    pls.forEach((pq, k) => {
      const b = pq.borderM ?? 0.09;
      const parts = {};
      for (const [what, mat, area] of [['board', 'btk-dark', pq.wM * pq.hM / 2], ['frame', 'btk-gild', (pq.wM + 2 * b) * (pq.hM + 2 * b) / 2]]) {
        const hit = tris.filter(t => /^plaques__/.test(t.node) && t.mat === mat && Math.abs(t.area - area) < 0.01);
        if (!hit.length) { parts[what] = { n: 0 }; continue; }
        const cen = [0, 1, 2].map(q => hit.reduce((s, t) => s + t.cen[q], 0) / hit.length);
        const o = outwardFor(cen, hit[0].n, eds);
        parts[what] = {
          n: hit.length, center: cen, windingN: hit[0].n, outward: o && o.n, edgeDist: o && o.dist,
          cosOut: o ? Math.min(...hit.map(t => dot(t.n, o.n))) : NaN,
          cosVn: Math.min(...hit.map(t => (t.vn ? dot(t.n, t.vn) : NaN))),
        };
      }
      out.push({ id, name: pr.name || '', index: k, storey: pq.storey, wM: pq.wM, hM: pq.hM, ...parts });
    });
  }
  return out;
}
