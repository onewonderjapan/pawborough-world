// WP13/T1 导览机位：OUT_DIR/tour.json（固定取景机位，非行走）。
// 覆盖：out-zone/nav-gap.json 六锚点（眼高 1.6 m 站立机位，望最近净空地标）+
//   三穗堂 / 九曲桥 / 大假山 / 玉玲珑 / 华宝楼 五个对象取景机位（相机在对象外，眼高 1.6 m 或斜俯视两种）。
// 位置一律从 baseline/layout.json 重算；锚点取 OUT_DIR/nav-gap.json（重建链 check-connectivity 产物）。
// 输出格式与 web/main.js 既有读法一致：{key: {label, zone, p, t, source}}，另附 targetObject 供测试核对（web 端忽略）。
// 用法：OUT_DIR=out-zone node scripts/compute-area-tour.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';
import { makeShotTools } from './shot-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const tools = makeShotTools(layout);
const obj = (id) => layout.objects.find(o => o.id === id);
const closed = (fp) => [...fp, fp[0]];

// ---------- 对象区域（目标容差与视线回撤共用） ----------
function regionOf(id) {
  const o = obj(id);
  if (o.geometry.footprint) return { id, fp: o.geometry.footprint };
  if (o.geometry.polyline) return { id, pl: o.geometry.polyline, halfW: (o.width || 2.4) / 2 };
  if (o.geometry.rocks) return { id, rocks: o.geometry.rocks.map(r => ({ x: r.x, z: r.z, r: r.size / 2, h: r.h })) };
  throw new Error('unsupported object region: ' + id);
}
function regionDist(reg, p) { // 点到对象区域的有向距离（0 = 区域内）
  if (reg.fp) return pointInPoly(p, reg.fp) ? 0 : distToPolyline(p, closed(reg.fp));
  if (reg.pl) return Math.max(0, distToPolyline(p, reg.pl) - reg.halfW);
  return Math.max(0, Math.min(...reg.rocks.map(r => dist2d(p, [r.x, r.z]) - r.r)));
}
function regionCenter(reg) {
  if (reg.fp) return centroid(reg.fp);
  if (reg.pl) return reg.pl[Math.floor(reg.pl.length / 2)];
  const m = reg.rocks.reduce((a, b) => (b.h > a.h || (b.h === a.h && b.r > a.r) ? b : a)); // 主峰：最高，其次最大
  return [m.x, m.z];
}
// 从区域中心向相机方向回撤出的"贴脸但不入内"检查终点（距区域边缘 margin）。
// footprint：取中心→相机线段与边界的第一个交点（正对最近立面），而非质心距离回撤（大体量楼会推出过远）。
function segRayIntersect(o, d, a, b) {
  const r = [d[0] - o[0], d[1] - o[1]], s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - o[0]) * s[1] - (a[1] - o[1]) * s[0]) / den;
  const u = ((a[0] - o[0]) * r[1] - (a[1] - o[1]) * r[0]) / den;
  if (t <= 0 || t >= 1 || u < 0 || u > 1) return null;
  return [o[0] + r[0] * t, o[1] + r[1] * t];
}
function rayEnd2d(reg, target, cam, margin = 1.2) {
  if (reg.fp) {
    let hit = null;
    for (let i = 0; i < reg.fp.length; i++) {
      const p = segRayIntersect(target, cam, reg.fp[i], reg.fp[(i + 1) % reg.fp.length]);
      if (p && (!hit || dist2d(p, target) < hit[2])) hit = [p[0], p[1], dist2d(p, target)];
    }
    if (hit) {
      const dx = cam[0] - target[0], dz = cam[1] - target[1], l = Math.hypot(dx, dz) || 1;
      return [hit[0] + dx / l * margin, hit[1] + dz / l * margin];
    }
  }
  const off = reg.pl ? reg.halfW + margin
    : reg.rocks ? Math.max(...reg.rocks.map(r => r.r)) + margin
    : Math.max(...reg.fp.map(v => dist2d(v, target))) + margin;
  const d = Math.max(1e-6, dist2d(target, cam));
  return [target[0] + (cam[0] - target[0]) / d * off, target[1] + (cam[1] - target[1]) / d * off];
}

// ---------- 锚点所属分区（入内优先，否则取边界最近者；>25 m 归 core） ----------
function zoneOfPoint(p) {
  let best = null, bd = Infinity;
  for (const [name, z] of Object.entries(layout.zones)) {
    const dd = pointInPoly(p, z.polygon) ? 0 : distToPolyline(p, closed(z.polygon));
    if (dd < bd) { bd = dd; best = name; }
  }
  return bd <= 25 ? best : 'core';
}

// ---------- 机位搜索 ----------
// 环绕对象找干净机位：不入建筑/墙（≥2.5 m 净距）、不入水、不入岩石、视线不入建筑内部。
// 通过全部候选里选 "净距 − 角度罚分" 最大者：开阔场优先，同净距下取 preferDir 正面/街面视角。
function orbitCam(reg, { h, dists, ty, preferDir = null, rockMargin = 0 } = {}) {
  const c = regionCenter(reg);
  const rockObs = layout.objects.filter(o => o.kind === 'rockery' && o.geometry.rocks).flatMap(o => o.geometry.rocks);
  let best = null, bestScore = -Infinity;
  for (const R of dists) {
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const p = [c[0] + Math.cos(th) * R, c[1] + Math.sin(th) * R];
      if (!tools.vistaPointClean(p)) continue;
      if (rockMargin && Math.min(...rockObs.map(r => dist2d(p, [r.x, r.z]) - r.size / 2)) < rockMargin) continue;
      if (tools.rayEntersBuilding(p, rayEnd2d(reg, c, p))) continue;
      const w = preferDir ? Math.abs(Math.atan2(Math.sin(th - preferDir[2]), Math.cos(th - preferDir[2]))) * 10 : 0;
      const score = tools.vistaClearance(p) - w;
      if (score > bestScore) { bestScore = score; best = { p, th }; }
    }
  }
  if (!best) return null;
  return { p: [+best.p[0].toFixed(1), h, +best.p[1].toFixed(1)], t: [+c[0].toFixed(1), ty, +c[1].toFixed(1)] };
}
// 街面方向（preferDir 用）：对象中心指向最近道路折线的单位向量
function dirToNearestRoad(c) {
  let bp = null, bd = Infinity;
  for (const r of layout.objects.filter(o => o.kind === 'road' && o.geometry.polyline)) {
    for (const pt of r.geometry.polyline) {
      const dd = dist2d(pt, c);
      if (dd < bd) { bd = dd; bp = pt; }
    }
  }
  const u = [bp[0] - c[0], bp[1] - c[1]];
  const l = Math.hypot(...u) || 1;
  return [u[0] / l, u[1] / l, Math.atan2(u[1], u[0])];
}

const tour = {};
const fail = (k) => { console.error('NO-CAM-FOUND:', k); process.exitCode = 1; };

// ---------- 六锚点：眼高 1.6 m 站立机位 ----------
// 部分锚点（如 old-south/old-north）落在围合建筑 footprint 多边形内（内院无孔洞表达），
// 先挪到 8 m 内最近的净空点再选目标；目标取最近有净空视线的命名地标（≥8 m，防贴脸）；
// 全被挡时退化为"沿最远开阔视线（≤250 m）望向第一个遮挡对象"。
const labeled = new Set(layout.labels.map(l => l.id));
const landmarkIds = layout.objects.filter(o => o.geometry.footprint && labeled.has(o.id) && /^bld-/.test(o.id)).map(o => o.id);
// 只对"建筑"footprint 判净空（广场/水面/道路多边形不算建筑，锚点可站在其上）
const allFps = layout.objects.filter(o => o.geometry && o.geometry.footprint && /^bld-/.test(o.id)).map(o => ({ id: o.id, fp: o.geometry.footprint }));
const inAnyFp = (p) => allFps.find(b => pointInPoly(p, b.fp));
function cleanPointNear(a, maxR = 8) {
  if (!inAnyFp(a)) return a;
  for (let r = 1; r <= maxR; r += 0.5) {
    for (let k = 0; k < 24; k++) {
      const th = (k / 24) * Math.PI * 2;
      const p = [a[0] + Math.cos(th) * r, a[1] + Math.sin(th) * r];
      if (!allFps.some(b => pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 1.0)) return p;
    }
  }
  return null;
}
function anchorView(a) {
  // 取"最远净空地标"：沿街/沿院纵深比贴脸近景好；下限 12 m 防 stares-at-wall
  const cands = landmarkIds
    .map(id => ({ id, reg: regionOf(id), c: regionCenter(regionOf(id)) }))
    .filter(cd => dist2d(cd.c, a) >= 12)
    .sort((x, y) => dist2d(y.c, a) - dist2d(x.c, a))
    .slice(0, 12);
  for (const cd of cands) {
    const end = rayEnd2d(cd.reg, cd.c, a);
    if (!tools.rayEntersBuilding(a, end)) return { end, targetObject: cd.id, how: `望 ${Math.round(dist2d(cd.c, a))} m 净空地标 ${obj(cd.id).name || cd.id}` };
  }
  // 开阔视线兜底：24 方向 × 4–250 m 步进 0.5，优先"最近能望到对象"的方向（净空 ≥12 m）
  const obs = [...tools.blds, ...layout.objects.filter(o => ['wall', 'moonGateWall'].includes(o.kind) && o.geometry?.footprint)
    .map(o => ({ id: o.id, fp: o.geometry.footprint }))];
  let best = null;
  for (let i = 0; i < 24; i++) {
    const th = (i / 24) * Math.PI * 2;
    let lastClean = 4, blocker = null;
    for (let s = 4; s <= 250; s += 0.5) {
      const p = [a[0] + Math.cos(th) * s, a[1] + Math.sin(th) * s];
      const hit = obs.find(b => pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 0.5);
      if (hit) { blocker = hit.id; break; }
      lastClean = s;
    }
    if (!blocker || lastClean < 12) continue;
    if (!best || lastClean < best.s) best = { th, s: lastClean, blocker };
  }
  if (!best || !best.blocker) return null;
  const pb = [a[0] + Math.cos(best.th) * (best.s + 0.6), a[1] + Math.sin(best.th) * (best.s + 0.6)];
  return { end: pb, targetObject: best.blocker, how: `沿 ${best.s.toFixed(0)} m 开阔视线望向 ${obj(best.blocker)?.name || best.blocker}` };
}
for (const key of ['main', 'gold', 'center', 'jiuqu', 'old-south', 'old-north']) {
  const a = nav.anchors[key];
  if (!a) { fail('anchor-' + key); continue; }
  const cam = cleanPointNear(a);
  if (!cam) { fail('anchor-' + key); continue; }
  const v = anchorView(cam);
  if (!v) { fail('anchor-' + key); continue; }
  const nudged = dist2d(cam, a) > 0.5;
  tour['anchor-' + key] = {
    label: `锚点 ${key}`,
    zone: zoneOfPoint(a),
    p: [+cam[0].toFixed(1), 1.6, +cam[1].toFixed(1)],
    t: [+v.end[0].toFixed(1), 2.2, +v.end[1].toFixed(1)],
    targetObject: v.targetObject,
    source: `computed: nav-gap 锚点眼高 1.6 m 站立机位${nudged ? '（锚点入建筑 footprint，外移至最近净空点）' : ''}，${v.how}（baseline/layout.json 重算）`,
  };
}

// ---------- 五对象取景机位 ----------
{
  const reg = regionOf('bld-428179901'); // 三穗堂
  const f = obj('bld-428179901').facade.dir;
  const v = orbitCam(reg, { h: 1.6, dists: [18, 22, 26, 32], ty: 2.2, preferDir: [f[0], f[1], Math.atan2(f[1], f[0])] });
  if (v) tour.sansuitang = { label: '三穗堂', zone: 'garden', ...v, targetObject: reg.id, source: 'computed: 堂前眼高 1.6 m 机位（facade.dir 优先，baseline/layout.json 重算）' };
  else fail('sansuitang');
}
{
  const reg = regionOf('jiuqu-bridge'); // 九曲桥：广场上空斜俯视望桥中段
  const v = orbitCam(reg, { h: 14, dists: [18, 24, 30], ty: 1.5, preferDir: [0, -1, Math.atan2(-1, 0)] });
  if (v) tour['jiuqu-bridge'] = { label: '九曲桥', zone: 'pond', ...v, targetObject: reg.id, source: 'computed: 池带广场上空斜俯视望九曲桥中段（相机不入水不入建筑，baseline/layout.json 重算）' };
  else fail('jiuqu-bridge');
}
{
  const reg = regionOf('rockery-dajiashan'); // 大假山
  const v = orbitCam(reg, { h: 1.6, dists: [18, 24, 30, 36], ty: 4.5, rockMargin: 1.2 });
  if (v) tour.dajiashan = { label: '大假山', zone: 'garden', ...v, targetObject: reg.id, source: 'computed: 山前眼高 1.6 m 仰观机位（不入岩石 1.2 m，baseline/layout.json 重算）' };
  else fail('dajiashan');
}
{
  const reg = regionOf('rockery-yulinglong'); // 玉玲珑
  const v = orbitCam(reg, { h: 1.6, dists: [9, 12, 15, 18], ty: 2.2, rockMargin: 1.2 });
  if (v) tour.yulinglong = { label: '玉玲珑', zone: 'garden', ...v, targetObject: reg.id, source: 'computed: 峰前眼高 1.6 m 近观机位（不入岩石 1.2 m，baseline/layout.json 重算）' };
  else fail('yulinglong');
}
{
  const reg = regionOf('bld-428202599'); // 华宝楼（商城）
  const d = dirToNearestRoad(regionCenter(reg));
  const v = orbitCam(reg, { h: 22, dists: [40, 50, 60, 72], ty: 7, preferDir: d });
  if (v) tour.huabaolou = { label: '华宝楼', zone: 'bazaar', ...v, targetObject: reg.id, source: 'computed: 街面上空斜俯视望楼体（相机不入建筑，baseline/layout.json 重算）' };
  else fail('huabaolou');
}

for (const [k, v] of Object.entries(tour)) console.log(k, `cam(${v.p}) -> tgt(${v.t}) zone=${v.zone} obj=${v.targetObject}`);
if (process.exitCode || Object.keys(tour).length < 11) { console.error('tour incomplete:', Object.keys(tour).length, '/ 11'); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'tour.json'), JSON.stringify(tour, null, 1) + '\n');
console.log('tour.json written:', Object.keys(tour).length, 'views');
