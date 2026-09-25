// 厅堂套件「非屋面构件穿出屋面」检测（wave4-roofclip R1）。
// 规则：任何非屋面部件（台基、柱、额枋、平座楼板、墙、勒脚、半窗、栏杆、格扇、斗拱……）的顶点，
// 都不许高于其正上方的屋面瓦面 / 檐底，容差 0.01 m；不在任何屋面投影下的顶点不检。
//
// 实现（只读模块 GLB，节点名 = <part>__<material>，模块本地坐标 Y-up）：
//  - 屋面覆盖面 = part 为 hall-roof 的三角（瓦面、瓦头、封檐板、檐底、脊），去掉近竖直面（|ny| < 0.2|n|）。
//    hall-roof 里白墙材质的件（硬山山墙封顶三角、段端端板、歇山山花）是封口墙，不是覆盖面，不入。
//  - 覆盖面按「片」分组：同一节点内按位置焊接（1 mm）求连通块（瓦面、檐底、腰檐瓦面、腰檐檐底……各自一片）。
//  - 每个非屋面顶点 p（所在连通块 = 一个构件实体，底 = 块内最低点 b）：取水平投影包含 p 的覆盖三角里
//    高于 b + 0.05 的（低于构件底的屋面属于下一层，例如二层墙脚下的腰檐）；「根部相接」的不算（见下）；
//    其中最低的高度 = 正上方的屋面 / 檐底。p.y 超出它 > 0.01 m 即违规。
//  - 根部相接：一片坡面的上沿（腰檐瓦面根线、檐底回墙线）按设计插在承托它的墙 / 柱里，墙身、柱身穿过这片的
//    根部是正常构造（底层墙顶、底层柱顶在腰檐根部之内）。判定：p 离该片「上沿」水平距离 ≤ ROOT_BAND
//    （0.2 m ≥ 柱半径 0.17 / 半墙厚 0.12 + 勒脚 0.03）时，该片不算 p 的覆盖面；同一处的其他片（例如檐底根部
//    上方的瓦面）照常算。上沿 = 本片边界边里水平（两端高差 < 0.02）且所在三角对顶点比它低 ≥ 0.02 的边。
//    盲区（写明）：离某片根线 0.2 m 以内只由其他片把关。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOL = 0.01;
export const ROOT_BAND = 0.2;
const WELD = 1e-3;

// part × material → 构件类别（报告用）
export function classOf(node) {
  const [part, mat] = node.split('__');
  const T = {
    'hall-base': '台基/踏步/地面',
    'hall-bracket': '斗拱',
    'hall-frame': mat === 'hk-dark-timber' ? '额枋' : '柱/平座楼板',
    'hall-facade': mat === 'hk-timber-darkred' ? '格扇框' : '格扇格心',
    'hall-wall': mat === 'hk-white-wall' ? '墙' : mat === 'hk-plinth-brick' ? '勒脚'
      : mat === 'hk-timber-darkred' ? '半窗框/栏杆' : '半窗格心/栏杆心',
  };
  return T[part] || part;
}

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl));
  const bl = buf.readUInt32LE(20 + jl);
  const bin = buf.subarray(28 + jl, 28 + jl + bl);
  const acc = (ai) => {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
    const nc = { SCALAR: 1, VEC3: 3 }[a.type];
    const Arr = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array, 5121: Uint8Array }[a.componentType];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || Arr.BYTES_PER_ELEMENT * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + off + i * stride, nc)));
    return out;
  };
  const nodes = [];
  for (const n of json.nodes || []) {
    if (n.mesh === undefined) continue;
    if (n.translation || n.rotation || n.scale || n.matrix) throw new Error(`hallkit-roofclip: node ${n.name} has a transform (module GLB expected flat)`);
    const P = [], T = [];
    for (const pr of json.meshes[n.mesh].primitives) {
      const base = P.length;
      const pos = acc(pr.attributes.POSITION);
      P.push(...pos);
      const I = pr.indices !== undefined ? acc(pr.indices).map((x) => x[0]) : pos.map((_, i) => i);
      for (let k = 0; k + 2 < I.length; k += 3) T.push([base + I[k], base + I[k + 1], base + I[k + 2]]);
    }
    nodes.push({ name: n.name || '', P, T });
  }
  return nodes;
}

const key = (p) => p.map((c) => Math.round(c / WELD)).join(',');

function unionFind(n) {
  const par = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  return { find, union: (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; } };
}

// 顶点按位置焊接后的连通块：返回每个顶点的块号
function islands(P, T) {
  const ids = new Map();
  const vid = P.map((p) => { const k = key(p); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); });
  const uf = unionFind(ids.size);
  for (const [a, b, c] of T) { uf.union(vid[a], vid[b]); uf.union(vid[b], vid[c]); }
  return P.map((_, i) => uf.find(vid[i]));
}

export function roofClip(file, { rootBand = ROOT_BAND } = {}) {
  const nodes = readGlb(file);
  // ---- 屋面覆盖面 + 层 ----
  const RP = [], RT = [], sheetOf = [];
  for (const [ni, n] of nodes.entries()) {
    if (!n.name.startsWith('hall-roof') || n.name.endsWith('__hk-white-wall')) continue;
    const base = RP.length;
    RP.push(...n.P);
    for (const t of n.T) RT.push(t.map((i) => base + i));
    for (const s of islands(n.P, n.T)) sheetOf.push(ni + ':' + s);   // 片 = 节点内连通块（瓦面 / 檐底 / 腰檐瓦面各自一片）
  }
  // 各片上沿（根线）：本片边界边里水平、且所在三角对顶点比它低 ≥ 0.02 的边（腰檐瓦面 / 檐底插在墙里的那条边）
  const edgeUse = new Map();
  const vkey = RP.map(key);
  for (const [ti, t] of RT.entries()) for (let e = 0; e < 3; e++) {
    const a = t[e], b = t[(e + 1) % 3];
    const k = sheetOf[a] + '#' + (vkey[a] < vkey[b] ? vkey[a] + '|' + vkey[b] : vkey[b] + '|' + vkey[a]);
    if (!edgeUse.has(k)) edgeUse.set(k, []);
    edgeUse.get(k).push([ti, a, b, t[(e + 2) % 3]]);
  }
  const rootEdges = new Map();                // sheet → [[ax, az, bx, bz, y]]
  for (const uses of edgeUse.values()) {
    if (uses.length !== 1) continue;
    const [, a, b, c] = uses[0];
    const A = RP[a], B = RP[b], C = RP[c];
    if (Math.abs(A[1] - B[1]) >= 0.02) continue;
    if (C[1] > Math.min(A[1], B[1]) - 0.02) continue;
    const L = sheetOf[a];
    if (!rootEdges.has(L)) rootEdges.set(L, []);
    rootEdges.get(L).push([A[0], A[2], B[0], B[2], Math.max(A[1], B[1])]);
  }
  const segD = (x, z, e) => {
    const dx = e[2] - e[0], dz = e[3] - e[1], L2 = dx * dx + dz * dz;
    const k = L2 ? Math.max(0, Math.min(1, ((x - e[0]) * dx + (z - e[1]) * dz) / L2)) : 0;
    return Math.hypot(x - e[0] - k * dx, z - e[1] - k * dz);
  };
  // 覆盖三角（去近竖直面），带 XZ 包围盒加速
  const tris = [];
  for (const t of RT) {
    const [A, B, C] = t.map((i) => RP[i]);
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.abs(n[1]) < 0.2 * Math.hypot(...n)) continue;
    const den = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
    if (Math.abs(den) < 1e-12) continue;
    tris.push({ A, B, C, den, sheet: sheetOf[t[0]],
      x0: Math.min(A[0], B[0], C[0]), x1: Math.max(A[0], B[0], C[0]), z0: Math.min(A[2], B[2], C[2]), z1: Math.max(A[2], B[2], C[2]) });
  }
  const hitsAt = (x, z) => {
    const out = [];
    for (const t of tris) {
      if (x < t.x0 - 1e-9 || x > t.x1 + 1e-9 || z < t.z0 - 1e-9 || z > t.z1 + 1e-9) continue;
      const { A, B, C, den } = t;
      const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / den;
      const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      out.push({ y: l1 * A[1] + l2 * B[1] + l3 * C[1], sheet: t.sheet });
    }
    return out;
  };
  // ---- 非屋面构件逐顶点 ----
  const byClass = {};
  let checked = 0, total = 0, rootExempt = 0;
  for (const n of nodes) {
    if (n.name.startsWith('hall-roof')) continue;
    const isl = islands(n.P, n.T);
    const lo = new Map(), hi = new Map();
    n.P.forEach((p, i) => {
      lo.set(isl[i], Math.min(lo.get(isl[i]) ?? Infinity, p[1]));
      hi.set(isl[i], Math.max(hi.get(isl[i]) ?? -Infinity, p[1]));
    });
    const seen = new Set();
    for (const [i, p] of n.P.entries()) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      total++;
      const b = lo.get(isl[i]), top = hi.get(isl[i]);
      let cover = Infinity, any = false;
      for (const h of hitsAt(p[0], p[2])) {
        if (h.y <= b + 0.05) continue;                  // 构件底之下的屋面（下一层 / 腰檐）不是它的「正上方」
        any = true;
        const re = rootEdges.get(h.sheet) || [];
        const nearRoot = re.some((e) => segD(p[0], p[2], e) <= rootBand);
        if (nearRoot) { rootExempt++; continue; }
        cover = Math.min(cover, h.y);
      }
      if (!any) continue;
      checked++;
      if (cover === Infinity) continue;
      const ex = p[1] - cover;
      const cls = classOf(n.name);
      const c = (byClass[n.name] ||= { node: n.name, class: cls, worst: -Infinity, at: null, count: 0 });
      if (ex > TOL) c.count++;
      if (ex > c.worst) { c.worst = ex; c.at = [p[0], p[1], p[2]]; c.cover = cover; }
    }
  }
  const rows = Object.values(byClass).sort((a, b) => b.worst - a.worst);
  const violations = rows.filter((r) => r.worst > TOL);
  return { total, checked, rootExempt, rows, violations, worst: rows.length ? rows[0].worst : -Infinity };
}

// CLI：node tests/hallkit-roofclip.mjs <gen-dir 含 hallkit-<id>/model.glb> [--ids a,b] [--json out.json]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const dir = path.resolve(args[0] || path.join(ROOT, 'out-garden-kits'));
  const idsArg = args.indexOf('--ids') >= 0 ? args[args.indexOf('--ids') + 1].split(',') : null;
  const jsonOut = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;
  const IDS = idsArg || JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'hall-kit', 'ids.json'), 'utf8')).ids;
  const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
  const out = [];
  for (const id of IDS) {
    const o = LAYOUT.objects.find((q) => q.id === id) || {};
    const r = roofClip(path.join(dir, 'hallkit-' + id, 'model.glb'), process.env.ROOFCLIP_NO_ROOT ? { rootBand: -1 } : {});
    const f3 = (v) => +v.toFixed(3);
    out.push({ id, name: o.name || null, kind: o.kind, checked: r.checked, total: r.total, rootExempt: r.rootExempt, worstM: f3(r.worst),
      violations: r.violations.map((v) => ({ node: v.node, class: v.class, maxExcessM: f3(v.worst), vertsOver: v.count,
        at: v.at.map(f3), roofAtM: f3(v.cover) })) });
    console.log(`${r.violations.length ? 'VIOL' : 'ok  '} ${id} ${o.name || ''} worst ${r.worst.toFixed(3)} checked ${r.checked}/${r.total} rootExempt ${r.rootExempt}` +
      r.violations.map((v) => `\n     ${v.node} (${v.class}) +${v.worst.toFixed(3)} m ×${v.count} at (${v.at.map((c) => c.toFixed(2)).join(', ')}) roof ${v.cover.toFixed(2)}`).join(''));
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  process.exit(out.some((r) => r.violations.length) ? 1 : 0);
}
