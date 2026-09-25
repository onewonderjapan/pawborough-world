// 山门前广场净空（wave5-fangbangqa F-02，主控 2026-09-26 决定选项 1）：任何外围店屋平面轮廓都不得与山门前广场相交。
// 只读 baseline/layout.json 与店屋模块 measurements.json（不需要产物），前广场独立重算（不读 layout 里的 shanmenForecourt 块）：
//   - 庙墙南开口 = temple-wall 段链的「链端点」（只属于一段的端点）中，分居山门轴两侧、彼此最近的一对；
//   - 纵深 = 自开口两端沿山门门脸方向（rotY，+Z 为门脸）步进 0.02 m，直到进入「方浜中路」路面（到中线距离 ≤ 路宽/2）；
//   - 店屋轮廓 = 模块 measurements.design.frontageM × depthM，原点前墙中点，门脸 +Z、进深 −Z，按 rotY 转。
// 另核对 layout 的 shanmenForecourt 记录与本测试重算的多边形一致（≤ 0.05 m）且 removed 与实际缺席件一致。
// 用法：node tests/shanmen-forecourt-test.mjs [layout.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(AREA, 'baseline', 'layout.json');
const L = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

const byId = new Map(L.objects.map(o => [o.id, o]));
const sm = byId.get('temple-shanmen').geometry;
const f = [Math.sin(sm.rotY), Math.cos(sm.rotY)];
const lat = q => (q[0] - sm.position[0]) * f[1] - (q[1] - sm.position[1]) * f[0];
const key = p => p.map(v => v.toFixed(4)).join(',');
const deg = new Map();
for (const s of byId.get('temple-wall').geometry.segments) for (const p of s) deg.set(key(p), (deg.get(key(p)) || 0) + 1);
const chainEnds = [...new Set(byId.get('temple-wall').geometry.segments.flat().filter(p => deg.get(key(p)) === 1).map(key))].map(k => k.split(',').map(Number));
let A = null, B = null;
for (const p of chainEnds) for (const q of chainEnds) {
  if (lat(p) <= 0 || lat(q) >= 0) continue;
  if (!A || Math.hypot(p[0] - q[0], p[1] - q[1]) < Math.hypot(A[0] - B[0], A[1] - B[1])) { A = p; B = q; }
}
ok(`temple-wall south opening found (${A && A.map(v => v.toFixed(2))} | ${B && B.map(v => v.toFixed(2))})`, !!A && !!B);
const roads = L.objects.filter(o => o.kind === 'road' && o.name === '方浜中路').map(o => o.geometry);
const distSeg = (p, a, b) => {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2));
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vz);
};
const onRoad = p => roads.some(g => g.polyline.some((a, i) => i > 0 && distSeg(p, g.polyline[i - 1], a) <= g.width / 2));
const march = q => { for (let t = 0; t < 60; t += 0.02) if (onRoad([q[0] + f[0] * t, q[1] + f[1] * t])) return t; return null; };
const dA = march(A), dB = march(B);
ok(`forecourt depth to 方浜中路 near edge (${dA?.toFixed(2)} / ${dB?.toFixed(2)} m)`, dA > 1 && dB > 1);
const fc = [A, B, [B[0] + f[0] * dB, B[1] + f[1] * dB], [A[0] + f[0] * dA, A[1] + f[1] * dA]];

const inPoly = (pt, poly) => {
  let c = false;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
    if ((z1 > pt[1]) !== (z2 > pt[1]) && pt[0] < (x2 - x1) * (pt[1] - z1) / (z2 - z1) + x1) c = !c;
  }
  return c;
};
const cross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
const polysHit = (p, q) => p.some(v => inPoly(v, q)) || q.some(v => inPoly(v, p))
  || p.some((a, i) => q.some((c, j) => cross(a, p[(i + 1) % p.length], c, q[(j + 1) % q.length])));

const dims = {};
const dimOf = m => {
  if (!(m in dims)) {
    const f2 = path.join(AREA, 'resources', 'shops', m, 'measurements.json');
    dims[m] = fs.existsSync(f2) ? JSON.parse(fs.readFileSync(f2, 'utf8')).design : null;
  }
  return dims[m];
};
const inst = new Map(L.instances.map(i => [i.id, i]));
const hits = [];
let checked = 0;
for (const o of L.objects.filter(o => o.kind === 'shopAnchor' && o.zone === 'outer')) {
  const i = inst.get(o.id);
  const d = i && dimOf(i.module);
  if (!d) continue;
  checked++;
  const c = Math.cos(o.geometry.rotY), s = Math.sin(o.geometry.rotY), [x, z] = o.geometry.position;
  const fp = [[-d.frontageM / 2, 0], [d.frontageM / 2, 0], [d.frontageM / 2, -d.depthM], [-d.frontageM / 2, -d.depthM]]
    .map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]);
  if (polysHit(fp, fc)) hits.push(o.id);
}
ok(`no outer shop footprint intersects the shanmen forecourt (${checked} outer shops checked; hits: ${hits.join(',') || 'none'})`, checked > 0 && hits.length === 0);
const rec = L.shanmenForecourt;
ok('layout records the forecourt rule and polygon (matches recomputation <= 0.05 m)',
  !!rec && rec.polygon.length === 4 && rec.polygon.every((p, k) => Math.hypot(p[0] - fc[k][0], p[1] - fc[k][1]) <= 0.05),
  rec ? JSON.stringify(rec.polygon) : 'missing shanmenForecourt');
ok('recorded removals are absent from objects/instances/labels',
  !!rec && rec.removed.every(r => !byId.has(r.id) && !inst.has(r.id) && !L.labels.some(l => l.id === r.id)));
ok('counts consistent after removal', L.counts.objects === L.objects.length && L.counts.instances === L.instances.length);
console.log(`shanmen-forecourt-test: ${pass} pass, ${fail} fail (${path.relative(AREA, LAYOUT)})`);
process.exit(fail ? 1 : 0);
