// 池带普查库（wave10-pondqa）：九曲桥 / 池岸 / 水面 / 湖心亭周边 / 池带铺装与台阶。
// 几何一律从 baseline/layout.json 重算（水池多边形、桥折线、台阶锚、湖心亭 footprint），
// 被测对象是真实产物（分区 GLB / 站点模块 GLB），不拿产物和自己比。
// 复用 templeqa-lib（射线、三角互穿、焊接连通块、贴图清单）与 smallqa-lib（带层级变换的 GLB 读取）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlbTree } from './smallqa-lib.mjs';
import { rayTri, f3 } from './templeqa-lib.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
export const OBJ = new Map(LAYOUT.objects.map((o) => [o.id, o]));

export const POND_WATER_ID = 'water-62072388';
export const WATER = OBJ.get(POND_WATER_ID);
export const WATER_Y = WATER.height;                          // -0.14（layout 冻结）
export const WATER_POLY = (() => { const p = WATER.geometry.footprint.slice(); if (p.length > 2 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]) p.pop(); return p; })();
export const BRIDGE = OBJ.get('jiuqu-bridge');
export const BRIDGE_LINE = BRIDGE.geometry.polyline;
export const DECK_Y = BRIDGE.deckY ?? 0.55;
export const BRIDGE_W = BRIDGE.width ?? 2.4;
export const STEPS = ['jiuqu-bridge-step-w', 'jiuqu-bridge-step-e'].map((id) => OBJ.get(id));
export const HT = OBJ.get('huxin-ting');
export const HT_POLY = (() => { const p = HT.geometry.footprint.slice(); if (p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]) p.pop(); return p; })();

// ---------- 2D 小工具（地图系 x 东 / z 南） ----------
export function signedArea(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function distToPolyline(p, line, closed = false) {
  let best = Infinity, at = null, seg = -1;
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i++) {
    const a = line[i], b = line[(i + 1) % line.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
    const q = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best) { best = d; at = q; seg = i; }
  }
  return { d: best, at, seg };
}
export function polylineLength(line) { let s = 0; for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return s; }
// 沿折线按弧长取点与切向
export function alongPolyline(line, s) {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + L >= s || i === line.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / L));
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], seg: i - 1 };
    }
    acc += L;
  }
  return null;
}
// 水池边界按固定弧长采样：点 + 外法线（指向岸上）
export function shoreSamples(step = 0.5) {
  const P = WATER_POLY, ccw = signedArea(P) > 0, out = [];
  let acc = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    // 地图系 (x,z)：signedArea>0 时多边形为「x→z」正向绕，外法线 = (d.z, -d.x)
    const n = ccw ? [d[1], -d[0]] : [-d[1], d[0]];
    for (let s = (step - (acc % step)) % step; s < L; s += step) out.push({ p: [a[0] + d[0] * s, a[1] + d[1] * s], n, edge: i, s: +(acc + s).toFixed(2) });
    acc += L;
  }
  return out;
}

// ---------- 世界三角集（分区 GLB 全部读入，按节点名归属 layout id） ----------
// 分区 GLB 的节点名：程序化 = "zone|id|kind|lod"（Blender 导入后可能带 .NNN），站点模块 = "<module>__<mat>" 挂在锚 empty 下。
export function ownerOf(name, anchor) {
  const base = (name || '').replace(/\.\d{3}$/, '');
  if (base.includes('|')) { const p = base.split('|'); return { id: p[1], kind: p[2] || null }; }
  if (anchor) return { id: anchor.replace(/\.\d{3}$/, ''), kind: null };
  const m = base.split('__')[0];
  return { id: m, kind: null };
}

export function loadWorld(outDir, { files = null, anchorRe = /./ } = {}) {
  const man = JSON.parse(fs.readFileSync(path.join(outDir, 'zones-manifest.json'), 'utf8'));
  const list = files || man.zones.map((z) => z.file);
  const tris = [];
  const nodes = [];
  for (const f of list) {
    const t = readGlbTree(path.join(outDir, f), { anchorRe, normLimit: 1e6 });
    for (const n of t.nodes) {
      const own = ownerOf(n.name, n.anchor);
      const rec = { file: f, name: n.name, anchor: n.anchor, id: own.id, kind: own.kind, mat: n.material?.name || '', doubleSided: !!n.material?.doubleSided, P: n.P, N: n.N, T: n.T };
      nodes.push(rec);
    }
  }
  return { manifest: man, nodes };
}

// 竖直射线用 2D 网格索引（xz），只收录 bbox 与 region 相交的三角
export class VGrid {
  constructor(nodes, { cell = 1.0, region = null, filter = null } = {}) {
    this.cell = cell; this.map = new Map(); this.tris = [];
    for (const n of nodes) {
      if (filter && !filter(n)) continue;
      const { P, T } = n;
      for (let t = 0; t < T.length; t += 3) {
        const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]];
        const x0 = Math.min(A[0], B[0], C[0]), x1 = Math.max(A[0], B[0], C[0]), z0 = Math.min(A[2], B[2], C[2]), z1 = Math.max(A[2], B[2], C[2]);
        if (region && (x1 < region[0] || x0 > region[2] || z1 < region[1] || z0 > region[3])) continue;
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nl = Math.hypot(...nr);
        if (nl < 1e-12) continue;
        const i = this.tris.length;
        this.tris.push({ A, B, C, ny: nr[1] / nl, n: nr.map((c) => c / nl), node: n, x0, x1, z0, z1, y0: Math.min(A[1], B[1], C[1]), y1: Math.max(A[1], B[1], C[1]) });
        for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) {
          const k = gx + ',' + gz; let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(i);
        }
      }
    }
  }
  // 竖直线 (x,z) 上所有交点，按 y 从高到低；每项 {y, ny(几何法线 y 分量，>0 朝上), node}
  column(x, z) {
    const a = this.map.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)) || [];
    const out = [];
    for (const i of a) {
      const t = this.tris[i];
      if (x < t.x0 - 1e-9 || x > t.x1 + 1e-9 || z < t.z0 - 1e-9 || z > t.z1 + 1e-9) continue;
      if (Math.abs(t.ny) < 1e-6) continue;
      const s = rayTri([x, 100, z], [0, -1, 0], t.A, t.B, t.C);
      if (s === null) continue;
      out.push({ y: 100 - s, ny: t.ny, node: t.node, tri: t });
    }
    out.sort((p, q) => q.y - p.y);
    return out;
  }
  // 线段附近（xz 包围盒）的所有三角
  near(x0, z0, x1, z1) {
    const set = new Set();
    for (let gx = Math.floor(Math.min(x0, x1) / this.cell); gx <= Math.floor(Math.max(x0, x1) / this.cell); gx++)
      for (let gz = Math.floor(Math.min(z0, z1) / this.cell); gz <= Math.floor(Math.max(z0, z1) / this.cell); gz++)
        for (const i of this.map.get(gx + ',' + gz) || []) set.add(i);
    return [...set].map((i) => this.tris[i]);
  }
}

// 线段 p→q（3D）与三角集合求交（返回最近交点参数 s∈(0,1)）
export function segHit(tris, p, q) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  let best = null;
  for (const t of tris) {
    const s = rayTri(p, d, t.A, t.B, t.C);
    if (s !== null && s > 1e-7 && s < 1 - 1e-7 && (best === null || s < best.s)) best = { s, tri: t };
  }
  return best;
}

export { f3 };
