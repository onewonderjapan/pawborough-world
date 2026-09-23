// wave1-walkr1 K1 契约：园林套件碰撞（园廊 3 条 + 复廊 + 听涛阁水廊 / 豫园门楼 / 树 / 摊位长凳）。
// 先于实现编写：在上一版产物（无这些碰撞记录）上必须失败，实现后全绿。
//   1) 每条廊至少 N 个柱子碰撞盒：N = 在 GLB 实际几何里得到确认的期望柱数
//      （期望柱位从 baseline/layout.json 折线 + 各 kit 冻结设计值重算，
//        N 的确认 = out-garden-kits GLB 网格在该柱 ±0.12 m、y 0.1–2.6 有顶点，与
//        modules/corridor-kit/test_corridor_kit.cjs「柱位在场」同判据）；
//      导出的 <oid>:col-* 世界中心必须逐柱对上（±0.2 m）。
//   2) 豫园门楼：两面 Pier 与 inputs/yuyuan-gate-v2.glb 实体一致（±0.25 m），
//      且在门洞深度取 3 个站位、沿通道横向射线测得净宽 ≥ 2.2 m（GOAL 要求）。
//   3) 树：46 棵 garden 树各有 0.4×2.0×0.4 树干盒，位置 = tree-placements（含 9 棵避让移位）。
//   4) 摊位/长凳：每件一个 GLB 包围盒盒（檐棚在身体带以上不建），世界中心/尺寸/朝向对上。
// 用法：OUT_DIR=out-zone node tests/corridor-gate-collision-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';
import { readGlb } from '../../../src/world/glbReader.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const R_BODY = 0.35, BODY = [0.3, 1.9];

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const missing = ['garden', 'bazaar'].filter(z => !fs.existsSync(path.join(OUT, `collision-${z}.json`)));
if (missing.length) {
  console.log(`corridor-gate-collision-test: NOT IMPLEMENTED — missing ${missing.map(z => `collision-${z}.json`).join(', ')} in ${OUT}`);
  process.exit(2);
}

// ---------- 输入 ----------
const layout = JSON.parse(fs.readFileSync(path.join(AREA, 'baseline', 'layout.json'), 'utf8'));
const objOf = Object.fromEntries(layout.objects.map(o => [o.id, o]));
const collision = Object.fromEntries(['garden', 'bazaar'].map(z =>
  [z, JSON.parse(fs.readFileSync(path.join(OUT, `collision-${z}.json`), 'utf8'))]));
const byName = new Map();
for (const z of Object.keys(collision)) for (const c of collision[z].colliders) byName.set(c.name, c);
const worldOf = (c) => { const w = obbToWorld(c); return { ...w, y0: w.center[1] - w.halfExtents[1], y1: w.center[1] + w.halfExtents[1] }; };

// ---------- 几何小工具（与生产实现独立重写） ----------
const dedupe = (pts) => (pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts.map(p => p.slice()));
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const leftNormal = (u) => [u[1], -u[0]];                       // 地图系左法线（东行 -> 北）
const toWorld = (gate, lx, lz) => {                            // place() 位姿：world = pos + R(rotY)·local
  const c = Math.cos(gate.rotY), s = Math.sin(gate.rotY);
  return [gate.position[0] + c * lx + s * lz, gate.position[1] - s * lx + c * lz];
};
function nearestName(names, x, z, pred) {                       // 期望点 -> 最近导出记录（平面距离）
  let best = null, bd = Infinity;
  for (const n of names) {
    const c = byName.get(n); if (!c || (pred && !pred(c))) continue;
    const w = worldOf(c);
    const d = Math.hypot(w.center[0] - x, w.center[2] - z);
    if (d < bd) { bd = d; best = { name: n, w, d }; }
  }
  return best;
}

// ---------- GLB 三角形顶点（世界系） ----------
const glbVerts = {};
function vertsOf(file, namePrefix) {
  const key = `${file}::${namePrefix ?? '*'}`;
  if (!glbVerts[key]) {
    const { meshes } = readGlb(fs.readFileSync(path.join(AREA, file)));
    glbVerts[key] = meshes.flatMap(m => {
      if (namePrefix && !(m.name ?? '').startsWith(namePrefix)) return [];
      const out = [];
      for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      return out;
    });
  }
  return glbVerts[key];
}
const pillarInGlb = (file, x, z) => vertsOf(file).some(v =>
  Math.hypot(v[0] - x, v[2] - z) < 0.12 && v[1] > 0.1 && v[1] < 2.6);

// ---------- 期望柱/美人靠：corridor-kit 三条廊（modules/corridor-kit/build_corridor_kit.py 冻结算法） ----------
const CORR_KIT = {
  'bld-553893874': { glb: 'out-garden-kits/corridor-bld-553893874.glb', width: 2.2, closed: true },
  'bld-428179906': { glb: 'out-garden-kits/ring-corridor-bld-428179906.glb', width: 2.2, closed: true },
  'bld-428179920': { glb: 'out-garden-kits/waterside-gallery-bld-428179920.glb', width: 2.6, closed: false, pavilion: true, pavW: 10.1 },
};
const COL_H = 2.55, FLOOR_T = 0.12, SEAT_H = 0.42, SEAT_T = 0.10, RAIL_TOP = 0.95;
// 美人靠侧（ASSUMPTIONS[0]）：段中点 6m 内有水取水侧；否则闭合环背环外，开放廊背最近厅堂
function railSidesFor(oid, pts, closed) {
  const halls = [], waters = [];
  for (const o of layout.objects) {
    const fp = (o.geometry || {}).footprint;
    if (!fp || o.zone !== 'garden') continue;
    const f = dedupe(fp);
    const centroid = [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length];
    if (['hall', 'tower', 'xuan', 'pavilion', 'waterside', 'stage'].includes(o.kind)) halls.push(centroid);
    else if (o.kind === 'water') waters.push(centroid);
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const n = pts.length, nseg = closed ? n : n - 1, sides = [];
  for (let i = 0; i < nseg; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const u = unit(b[0] - a[0], b[1] - a[1]), nl = leftNormal(u);
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const near = (lst, rng) => {
      let best = null;
      for (const h of lst) {
        const d = Math.hypot(h[0] - mx, h[1] - mz);
        if (d < rng && (best === null || d < best[0]))
          best = [d, nl[0] * (h[0] - mx) + nl[1] * (h[1] - mz) > 0 ? 1 : -1];
      }
      return best;
    };
    const w = near(waters, 6.0), h = near(halls, 40.0);
    if (closed) {
      const outward = nl[0] * (mx - cx) + nl[1] * (mz - cz) > 0 ? 1 : -1;
      sides.push(w && w[1] === outward ? outward : (w === null && (h === null || h[0] > 15.0 || h[1] !== outward) ? outward : null));
    } else {
      sides.push(w ? w[1] : (h ? -h[1] : null));
    }
  }
  return sides;
}
function expectedCorridorKit(oid) {
  const cfg = CORR_KIT[oid];
  const poly = objOf[oid].geometry.polyline;
  let pts;
  if (cfg.pavilion) {                     // 水廊：p1 沿 seg0 反向 pavW/2 起建，seg0 由端亭 massing 覆盖
    const u0 = unit(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]);
    pts = [[poly[1][0] - u0[0] * cfg.pavW / 2, poly[1][1] - u0[1] * cfg.pavW / 2], ...poly.slice(1).map(p => p.slice())];
  } else {
    pts = dedupe(poly);
  }
  const n = pts.length, nseg = cfg.closed ? n : n - 1, coloff = cfg.width / 2 - 0.1;
  const cols = [], rails = [];
  for (let i = 0; i < nseg; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const u = unit(b[0] - a[0], b[1] - a[1]), nl = leftNormal(u);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ns = Math.max(1, Math.round(L / 2.5));
    const ts = cfg.closed ? Array.from({ length: ns }, (_, k) => k / ns) : Array.from({ length: ns + 1 }, (_, k) => k / ns);
    for (const side of [-1, 1]) for (const t of ts)
      cols.push({ x: a[0] + (b[0] - a[0]) * t + side * nl[0] * coloff, z: a[1] + (b[1] - a[1]) * t + side * nl[1] * coloff });
  }
  const turnAt = (i) => {
    if (!cfg.closed && (i <= 0 || i >= n - 1)) return 0;
    const a = pts[(i - 1 + n) % n], b = pts[i % n], c = pts[(i + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) return 0;
    const v1 = unit(b[0] - a[0], b[1] - a[1]), v2 = unit(c[0] - b[0], c[1] - b[1]);
    return Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1]))) * 180 / Math.PI;
  };
  railSidesFor(oid, pts, cfg.closed).forEach((side, i) => {
    if (side === null) return;
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t0 = (cfg.closed || i > 0) && turnAt(i) > 50 ? 1.4 : 0.18;
    const t1 = (cfg.closed || i < n - 1) && turnAt(i + 1) > 50 ? 1.4 : 0.18;
    if (L - t0 - t1 < 0.4) return;
    const u = unit(b[0] - a[0], b[1] - a[1]), nl = leftNormal(u), run = L - t0 - t1, amx = (t0 + L - t1) / 2;
    rails.push({ x: a[0] + u[0] * amx + side * nl[0] * (coloff - 0.08), z: a[1] + u[1] * amx + side * nl[1] * (coloff - 0.08) });
  });
  return { pts, cols, rails, cfg };
}

// ---------- 期望柱/栏/中墙：复廊（modules/double-corridor/build_double_corridor.py + 记录 GLB sha 对应） ----------
const DC_REC = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'double-corridor', 'double-corridor-record.json'), 'utf8'));
function expectedDoubleCorridor() {
  const CL = DC_REC.centreline;
  const FP = dedupe(objOf['bld-428186469'].geometry.polyline);
  const D = { sideOffset: 1.5, colSpacing: 2.5, wallT: 0.24, wallTop: 3.3, floorY: 0.12, railH: 0.45, ridgeY: 3.55, eaveY: 2.85, overhang: 0.5 };
  const offsetPoly = (poly, d) => {
    const n = poly.length;
    const area = poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0) / 2;
    const sgn = area > 0 ? 1 : -1;
    return poly.map((_, i) => {
      const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
      const nrm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [sgn * dz / l, -sgn * dx / l]; };
      const n1 = nrm(p0, p1), n2 = nrm(p1, p2), bx = n1[0] + n2[0], bz = n1[1] + n2[1], bl = Math.hypot(bx, bz);
      const k = d / Math.max(0.35, (bx * n1[0] + bz * n1[1]) / bl);
      return [p1[0] + bx / bl * k, p1[1] + bz / bl * k];
    });
  };
  const inside = (p, poly) => {
    let c = false;
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const distCl = (p) => {
    let m = Infinity;
    for (let i = 0; i + 1 < CL.length; i++) {
      const a = CL[i], b = CL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
      m = Math.min(m, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
    }
    return m;
  };
  const roofY = (p) => D.ridgeY - (D.ridgeY - D.eaveY) * Math.min(distCl(p) / (D.sideOffset + 0.2 + D.overhang), 1.25);
  const offsetLine = (pl, d) => pl.map((p, i) => {
    const dirs = [];
    if (i > 0) dirs.push([p[0] - pl[i - 1][0], p[1] - pl[i - 1][1]]);
    if (i < pl.length - 1) dirs.push([pl[i + 1][0] - p[0], pl[i + 1][1] - p[1]]);
    const ns = dirs.map(([dx, dz]) => [-dz / Math.hypot(dx, dz), dx / Math.hypot(dx, dz)]);
    let nx = 0, nz = 0; for (const q of ns) { nx += q[0]; nz += q[1]; }
    const l = Math.hypot(nx, nz), c = (nx / l) * ns[0][0] + (nz / l) * ns[0][1];
    return [p[0] + nx / l * d / Math.max(c, 0.5), p[1] + nz / l * d / Math.max(c, 0.5)];
  });
  const FPin = offsetPoly(FP, -0.12);
  const cols = [], rails = [], walls = [];
  for (const side of [-1, 1]) {
    const line = offsetLine(CL, side * D.sideOffset), pts = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / D.colSpacing));
      for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    pts.push(line.at(-1));
    const on = pts.filter(p => inside(p, FPin));
    for (const p of on) cols.push({ x: p[0], z: p[1] });
    for (let i = 1; i + 1 < on.length - 1; i++) {   // 首末跨留空（入口）
      const a = on[i], b = on[i + 1];
      rails.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
    }
  }
  for (let i = 0; i + 1 < CL.length; i++) {         // 中墙（漏窗窗台 0.9 m，胶囊不可穿越，整段实体）
    const a = CL[i], b = CL[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    walls.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, len: L + 0.24 });
  }
  return { cols, rails, walls };
}

// ---------- 1) 廊：柱数 ≥ N（GLB 实际几何确认），逐柱/逐栏对上 ----------
const corrNames = [...byName.keys()];
for (const [oid, cfg] of Object.entries(CORR_KIT)) {
  const { cols, rails } = expectedCorridorKit(oid);
  const confirmed = cols.filter(c => pillarInGlb(cfg.glb, c.x, c.z));
  const prefix = `${oid}:col-`;
  const exported = corrNames.filter(n => n.startsWith(prefix));
  ok(`${oid}: GLB 确认柱数 N=${confirmed.length} > 0`, confirmed.length > 0);
  ok(`${oid}: 导出柱盒 ${exported.length} ≥ N=${confirmed.length}`, exported.length >= confirmed.length);
  let worst = 0, miss = 0;
  for (const c of confirmed) {
    const hit = nearestName(corrNames.filter(n => n.startsWith(prefix)), c.x, c.z);
    if (!hit || hit.d > 0.2) miss += 1; else worst = Math.max(worst, hit.d);
  }
  ok(`${oid}: 期望柱逐根对上（±0.2 m）`, miss === 0, `${miss} missing, worst ${worst.toFixed(3)} m`);
  const railNames = corrNames.filter(n => n.startsWith(`${oid}:rail-`));
  ok(`${oid}: 美人靠薄长盒 ${railNames.length} 段 = 期望 ${rails.length}`, railNames.length === rails.length, `exported ${railNames.length}`);
  let railMiss = 0;
  for (const r of rails) {
    const hit = nearestName(railNames, r.x, r.z);
    if (!hit || hit.d > 0.3) railMiss += 1;
  }
  ok(`${oid}: 美人靠逐段对上（±0.3 m）`, railMiss === 0, `${railMiss} missing`);
}
{
  const { cols, rails, walls } = expectedDoubleCorridor();
  const oid = 'bld-428186469', glb = 'out-garden-kits/double-corridor-bld-428186469.glb';
  const confirmed = cols.filter(c => pillarInGlb(glb, c.x, c.z));
  const prefix = `${oid}:col-`;
  const exported = corrNames.filter(n => n.startsWith(prefix));
  ok(`${oid}: GLB 确认柱数 N=${confirmed.length} > 0`, confirmed.length > 0);
  ok(`${oid}: 导出柱盒 ${exported.length} ≥ N=${confirmed.length}`, exported.length >= confirmed.length);
  let miss = 0;
  for (const c of confirmed) {
    const hit = nearestName(corrNames.filter(n => n.startsWith(prefix)), c.x, c.z);
    if (!hit || hit.d > 0.2) miss += 1;
  }
  ok(`${oid}: 期望柱逐根对上（±0.2 m）`, miss === 0, `${miss} missing`);
  const railNames = corrNames.filter(n => n.startsWith(`${oid}:rail-`));
  ok(`${oid}: 栏杆薄长盒 ${railNames.length} 段 = 期望 ${rails.length}`, railNames.length === rails.length, `exported ${railNames.length}`);
  const wallNames = corrNames.filter(n => n.startsWith(`${oid}:wall-`));
  ok(`${oid}: 中墙段 ${wallNames.length} = 期望 ${walls.length}`, wallNames.length === walls.length, `exported ${wallNames.length}`);
}

// ---------- 2) 门楼：Pier 对上 GLB 实体；通道中线两侧射线测净宽 ≥ 2.2 m ----------
{
  const gate = objOf['garden-gate'].geometry;
  // 只取 gate-wall 网格（墙体实体）；gate-door 折扇与 gate-relief/eave/roof 不建碰撞（檐棚同理）
  const verts = vertsOf('inputs/yuyuan-gate-v2.glb', 'gate-wall').filter(v => v[1] > 0.2 && v[1] < 2.5);
  const piers = {};
  for (const [key, sel] of [['pier-w', v => v[0] < -1.0], ['pier-e', v => v[0] > 1.0]]) {
    const xs = verts.filter(sel).map(v => v[0]), zs = verts.filter(sel).map(v => v[2]);
    piers[key] = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }
  for (const [key, p] of Object.entries(piers)) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const [wx, wz] = toWorld(gate, cx, cz);
    const hit = nearestName(corrNames.filter(n => n.startsWith('garden-gate:')), wx, wz);
    ok(`garden-gate ${key} 在场并对上 GLB（±0.25 m）`, !!hit && hit.d <= 0.25, hit ? `nearest ${hit.name} d=${hit.d.toFixed(3)}` : 'absent');
    if (hit) {
      const size = hit.w.halfExtents.map(v => v * 2);
      const ex = [(p.x1 - p.x0), 5.33, (p.z1 - p.z0)];
      ok(`garden-gate ${key} 尺寸对上（±0.3 m）`, Math.abs(size[0] - ex[0]) < 0.3 && Math.abs(size[2] - ex[2]) < 0.3,
        `size ${size.map(v => v.toFixed(2))} vs ${ex.map(v => v.toFixed(2))}`);
    }
  }
  // 通道中线两侧射线：站位取门洞深度三处，世界射线对全部碰撞盒求最近命中
  const boxes = collision.garden.colliders.map(worldOf);
  const rayHit = (ox, oz, dx, dz) => {          // 2D 斜交 OBB slab test，返回最近 t
    let best = Infinity;
    for (const b of boxes) {
      if (b.y1 < BODY[0] || b.y0 > BODY[1]) continue;
      const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
      const px = ox - b.center[0], pz = oz - b.center[2];
      const lox = c * px - s * pz, loz = s * px + c * pz;
      const ldx = c * dx - s * dz, ldz = s * dx + c * dz;
      let t0 = -Infinity, t1 = Infinity;
      for (const [o, d, h] of [[lox, ldx, b.halfExtents[0]], [loz, ldz, b.halfExtents[2]]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(o) > h) { t0 = Infinity; break; } continue; }
        let ta = (-h - o) / d, tb = (h - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 < t1 && t0 > 1e-6) best = Math.min(best, t0);
    }
    return best;
  };
  let minWidth = Infinity, noHit = 0;
  for (const lz of [-2.6, -1.4, -0.2]) {
    const [ox, oz] = toWorld(gate, 0, lz);
    const [dlx, dlz] = toWorldDir(gate, -1, 0), [drx, drz] = toWorldDir(gate, 1, 0);
    const dL = rayHit(ox, oz, dlx, dlz), dR = rayHit(ox, oz, drx, drz);
    if (!Number.isFinite(dL) || !Number.isFinite(dR)) noHit += 1;
    else minWidth = Math.min(minWidth, dL + dR);
  }
  function toWorldDir(g, lx, lz) {
    const c = Math.cos(g.rotY), s = Math.sin(g.rotY);
    return [c * lx + s * lz, -s * lx + c * lz];
  }
  ok(`garden-gate 通道两侧射线都有命中（两侧 Pier 挡位，${noHit} 站无命中）`, noHit === 0);
  ok(`garden-gate 通道净宽 ${minWidth.toFixed(2)} m ≥ 2.2`, minWidth >= 2.2);
}

// ---------- 3) 树：46 棵各一个 0.4×2.0×0.4 树干盒 ----------
{
  const tp = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'tree-kit', 'tree-placements.json'), 'utf8')).placements;
  ok('树 placements 46 棵', tp.length === 46, String(tp.length));
  let miss = 0, badSize = 0;
  for (const t of tp) {
    const c = byName.get(`${t.id}:trunk`);
    if (!c) { miss += 1; continue; }
    const w = worldOf(c);
    if (Math.hypot(w.center[0] - t.position[0], w.center[2] - t.position[1]) > 0.05
      || c.obb.size.some((v, i) => Math.abs(v - [0.4, 2.0, 0.4][i]) > 0.01)) badSize += 1;
  }
  ok('树干盒逐棵在场（位置 ±0.05 m，尺寸 0.4×2.0×0.4）', miss === 0 && badSize === 0, `${miss} missing, ${badSize} mismatched`);
}

// ---------- 4) 摊位/长凳：每件一个 GLB 包围盒盒 ----------
{
  const sp = JSON.parse(fs.readFileSync(path.join(AREA, 'modules', 'bazaar-stalls', 'records', 'placements.json'), 'utf8'));
  const items = [...sp.stalls, ...sp.benches];
  const bboxCache = {};
  const bboxOf = (mod) => {
    if (!bboxCache[mod]) {
      const { meshes } = readGlb(fs.readFileSync(path.join(AREA, 'out-bazaar-stalls', mod)));
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]);
        }
      bboxCache[mod] = { mn, mx };
    }
    return bboxCache[mod];
  };
  let miss = 0, bad = [];
  for (const it of items) {
    const c = byName.get(`${it.id}:body`);
    if (!c) { miss += 1; continue; }
    const { mn, mx } = bboxOf(it.module);
    const w = worldOf(c);
    const [cx, cz] = toWorld({ position: it.position, rotY: it.rotY }, (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2);
    const sizeOk = c.obb.size.every((v, i) => Math.abs(v - (mx[i] - mn[i])) < 0.05);
    const centerOk = Math.hypot(w.center[0] - cx, w.center[1] - (mn[1] + mx[1]) / 2, w.center[2] - cz) < 0.1;
    if (!sizeOk || !centerOk) bad.push(it.id);
  }
  ok(`摊位/长凳盒逐件在场（${items.length} 件，包围盒重算对上）`, miss === 0 && bad.length === 0, `${miss} missing, ${bad.length} mismatched: ${bad.slice(0, 5)}`);
}

console.log(`corridor-gate-collision-test: ${pass} pass, ${fail} fail (OUT=${path.basename(OUT)})`);
process.exit(fail ? 1 : 0);
