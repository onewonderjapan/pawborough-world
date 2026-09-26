// 外围老城厢套件楼两两互穿检测（wave9-outerpolish，2026-09-26）。
// 读最终运行时件 OUT_DIR/zone-outer.glb（Blender 导出的原始件），逐对查套件楼之间的三角相交：
//   - 候选对：layout footprint 包围盒相距 ≤ 1.5 m（屋檐 0.35 + 披檐 0.9 的外挑上限之内）的两栋套件楼；
//   - 三角分类（只看几何，从 layout 现算）：竖直（|n_y| < 0.1）且质心距本栋 footprint 边 ≤ 6 cm、或距与本栋重叠的别栋 footprint 边 ≤ 6 cm
//     （被包含楼的院落墙）→ 墙；其余（屋面、檐底、封檐、屋脊、老虎窗、披檐、晒台）→ 屋面类；
//   - 相交：两三角严格互跨对方平面（容差 5 mm），交线段长度 > 1 cm 才计；共面、只贴边 / 贴点不计。
// 通过条件：墙三角参与的相交对数 = 0；屋面类×屋面类相交长度逐对为 0，
//   残留对必须在 modules/outer-kit/clash-residuals.json 里写明原因（没写原因的残留 = 失败）。
// 报告：REPORT=<json> 写逐对明细（before / after 对照用）。
// 用法：OUT_DIR=out-zone node tests/outer-kit-clash-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polySymDiffArea, polyArea as libPolyArea, polyIntersectionArea } from '../src/lib.mjs';
import { glbEntries } from '../modules/outer-kit/glb-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const EPS = 0.005, MINLEN = 0.01, WALL_TOL = 0.06, PAIR_MARGIN = 1.5;
let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const byId = new Map(layout.objects.map(o => [o.id, o]));
const outerIds = layout.objects.filter(o => o.kind === 'outerBuilding' && o.zone === 'outer').map(o => o.id);
const huxin = byId.get('huxin-ting');
const hArea = huxin ? Math.abs(libPolyArea(huxin.geometry.footprint)) : 0;
const dupIds = new Set(huxin ? outerIds.filter(id => polySymDiffArea(huxin.geometry.footprint, byId.get(id).geometry.footprint) / hArea <= 0.05) : []);
const KIT_IDS = outerIds.filter(id => !dupIds.has(id));
const ringOf = (fp) => { const r = fp.map(p => [p[0], p[1]]); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop(); return r; };
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const boundaryDist = (p, r) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length])); return d; };
const B = new Map();
for (const id of KIT_IDS) {
  const r = ringOf(byId.get(id).geometry.footprint);
  const xs = r.map(p => p[0]), zs = r.map(p => p[1]);
  B.set(id, { id, r, bb: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] });
}
const near = (a, b, m) => !(a.bb[0] > b.bb[1] + m || b.bb[0] > a.bb[1] + m || a.bb[2] > b.bb[3] + m || b.bb[2] > a.bb[3] + m);
// footprint 重叠（layout 数据：被包含楼等）
const overlapsOf = new Map(KIT_IDS.map(id => [id, []]));
for (let i = 0; i < KIT_IDS.length; i++) for (let j = i + 1; j < KIT_IDS.length; j++) {
  const a = B.get(KIT_IDS[i]), b = B.get(KIT_IDS[j]);
  if (!near(a, b, 0) || polyIntersectionArea(a.r, b.r) < 0.01) continue;
  overlapsOf.get(a.id).push(b.id); overlapsOf.get(b.id).push(a.id);
}

// ---------- 产物 ----------
const glbPath = path.join(OUT, 'zone-outer.glb');
if (!fs.existsSync(glbPath)) { console.log('FAIL no', glbPath); process.exit(1); }
const { entries } = glbEntries(glbPath);
const kit = new Map();
for (const e of entries) if (e.extras.outerKit && B.has(e.id)) kit.set(e.id, e);
ok(`套件网格 ${kit.size} 个 = 套件范围 ${KIT_IDS.length} 栋`, kit.size === KIT_IDS.length);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function prep(e) {
  const me = B.get(e.id), ov = overlapsOf.get(e.id).map(id => B.get(id).r);
  return e.tris.map(t => {
    const [a, b, c] = t.v;
    let n = crs(sub(b, a), sub(c, a));
    const nl = Math.hypot(...n);
    if (nl < 1e-12) return null;
    n = n.map(x => x / nl);
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
    const vertical = Math.abs(n[1]) < 0.1;
    const wall = vertical && (boundaryDist(cen, me.r) <= WALL_TOL || ov.some(r => boundaryDist(cen, r) <= WALL_TOL));
    const lo = [0, 1, 2].map(k => Math.min(a[k], b[k], c[k])), hi = [0, 1, 2].map(k => Math.max(a[k], b[k], c[k]));
    return { v: t.v, n, d: -dot(n, a), wall, lo, hi };
  }).filter(Boolean);
}
// 三角 T 与平面 (n,d) 的交段端点（T 严格跨平面时）
function planeCut(T, n, d) {
  const s = T.v.map(p => dot(n, p) + d);
  if (!(s.some(x => x > EPS) && s.some(x => x < -EPS))) return null;
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, si = Math.abs(s[i]) <= EPS ? 0 : s[i], sj = Math.abs(s[j]) <= EPS ? 0 : s[j];
    if (si === 0) pts.push(T.v[i]);
    if (si * sj < 0) { const f = si / (si - sj); pts.push([0, 1, 2].map(k => T.v[i][k] + (T.v[j][k] - T.v[i][k]) * f)); }
  }
  return pts.length >= 2 ? pts : null;
}
function triTriLen(A, Bt) {
  for (let k = 0; k < 3; k++) if (A.lo[k] > Bt.hi[k] + EPS || Bt.lo[k] > A.hi[k] + EPS) return 0;
  const cA = planeCut(A, Bt.n, Bt.d); if (!cA) return 0;
  const cB = planeCut(Bt, A.n, A.d); if (!cB) return 0;
  let D = crs(A.n, Bt.n); const dl = Math.hypot(...D);
  if (dl < 1e-6) return 0;
  D = D.map(x => x / dl);
  const ia = cA.map(p => dot(D, p)), ib = cB.map(p => dot(D, p));
  const len = Math.min(Math.max(...ia), Math.max(...ib)) - Math.max(Math.min(...ia), Math.min(...ib));
  return len > MINLEN ? len : 0;
}

const prepared = new Map([...kit].map(([id, e]) => [id, prep(e)]));
const pairs = [];
let nPairs = 0;
for (let i = 0; i < KIT_IDS.length; i++) for (let j = i + 1; j < KIT_IDS.length; j++) {
  const a = B.get(KIT_IDS[i]), b = B.get(KIT_IDS[j]);
  if (!near(a, b, PAIR_MARGIN) || !prepared.has(a.id) || !prepared.has(b.id)) continue;
  nPairs++;
  const TA = prepared.get(a.id), TB = prepared.get(b.id);
  const rec = { a: a.id, b: b.id, wallHits: 0, wallLen: 0, roofHits: 0, roofLen: 0 };
  for (const x of TA) for (const y of TB) {
    const L = triTriLen(x, y);
    if (!L) continue;
    if (x.wall || y.wall) { rec.wallHits++; rec.wallLen += L; } else { rec.roofHits++; rec.roofLen += L; }
  }
  if (rec.wallHits || rec.roofHits) pairs.push({ ...rec, wallLen: +rec.wallLen.toFixed(3), roofLen: +rec.roofLen.toFixed(3) });
}
pairs.sort((p, q) => (q.wallLen + q.roofLen) - (p.wallLen + p.roofLen));
const resFile = path.join(ROOT, 'modules', 'outer-kit', 'clash-residuals.json');
const residuals = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')).pairs || {} : {};
const wallHits = pairs.reduce((s, p) => s + p.wallHits, 0), wallLen = pairs.reduce((s, p) => s + p.wallLen, 0);
const roofPairs = pairs.filter(p => p.roofLen > 0), roofLen = roofPairs.reduce((s, p) => s + p.roofLen, 0);
ok(`墙三角相交 ${wallHits} 对（${pairs.filter(p => p.wallHits).length} 栋对，交线 ${wallLen.toFixed(2)} m）= 0`, wallHits === 0);
const unexplained = roofPairs.filter(p => !residuals[`${p.a}|${p.b}`] && !residuals[`${p.b}|${p.a}`]);
ok(`屋面互穿 ${roofPairs.length} 栋对（交线 ${roofLen.toFixed(2)} m），未写原因的残留 ${unexplained.length} 对`, unexplained.length === 0);
for (const p of unexplained.slice(0, 12)) console.log(`  roof ${p.a} × ${p.b}: ${p.roofLen} m (${p.roofHits} tri pairs)`);
for (const p of pairs.filter(q => q.wallHits).slice(0, 12)) console.log(`  wall ${p.a} × ${p.b}: ${p.wallHits} tri pairs, ${p.wallLen} m`);
const anren = ['bld-858807472', 'bld-858807473', 'bld-858807474', 'bld-858807475'];
const anrenPairs = pairs.filter(p => anren.includes(p.a) && anren.includes(p.b));
console.log(`REPORT candidates ${nPairs} pairs; clashing ${pairs.length}; wall ${wallHits} tri pairs / ${wallLen.toFixed(2)} m; roof ${roofPairs.length} pairs / ${roofLen.toFixed(2)} m; 安仁街 472–475: ${JSON.stringify(anrenPairs)}`);
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ out: OUT, candidates: nPairs, wallTriHits: wallHits, wallLen: +wallLen.toFixed(3), roofPairs: roofPairs.length, roofLen: +roofLen.toFixed(3), residuals, pairs }, null, 1));
console.log(`outer-kit-clash-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
