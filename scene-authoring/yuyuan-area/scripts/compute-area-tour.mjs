// WP13/T1 导览机位：OUT_DIR/tour.json（固定取景机位，非行走）。
// R1 返修版：每个机位必须有明确目标且「看得到目标」——
//   地标机位目标 = 该对象（三穗堂/九曲桥/大假山/玉玲珑/华宝楼）；
//   锚点机位目标 = 沿行进方向的街景（朝向 = commercial-route.json 从该锚点出发的第一段方向），anchor-jiuqu 朝九曲桥；
//   眼高对象机位（三穗堂/大假山/玉玲珑）在目标所在院落一侧（园墙内）、距目标 12–35 m、不隔墙；
//   全部机位过三条硬检查（scripts/tour-visibility.mjs，与 tests/tour-test.mjs 同一套原始运算）：
//     ① 目标包围盒 9 采样点对 collision-*.json 射线遮挡 ≥5 点可见；
//     ② 目标包围盒投影画面面积 ≥8%（fov46 / 1400×900，同 web 相机）；
//     ③ 相机距最近可遮挡碰撞盒（顶 ≥1.6 m）≥1.5 m。
// 覆盖：out-zone/nav-gap.json 六锚点 + 五对象，共 11 机位；位置一律从 baseline/layout.json 重算。
// 输出格式与 web/main.js 既有读法一致：{key: {label, zone, p, t, source}}，另附 targetObject 供测试核对（web 端忽略）。
// 用法：OUT_DIR=out-zone node scripts/compute-area-tour.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';
import { makeShotTools } from './shot-lib.mjs';
import { loadColliders, targetBox, visiblePointCount, screenAreaFrac, nearestColliderDist, streetCorridorBox, streetCorridorAim, polylineNearBox } from './tour-visibility.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const tools = makeShotTools(layout);
const boxes = loadColliders(ROOT, path.basename(OUT));
const obj = (id) => layout.objects.find(o => o.id === id);
const closed = (fp) => [...fp, fp[0]];
const EYE = 1.6;

// ---------- 对象区域（目标容差共用） ----------
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

// ---------- 锚点所属分区（入内优先，否则取边界最近者；>25 m 归 core） ----------
function zoneOfPoint(p) {
  let best = null, bd = Infinity;
  for (const [name, z] of Object.entries(layout.zones)) {
    const dd = pointInPoly(p, z.polygon) ? 0 : distToPolyline(p, closed(z.polygon));
    if (dd < bd) { bd = dd; best = name; }
  }
  return bd <= 25 ? best : 'core';
}

// ---------- R1 三条硬检查（生成器侧验收，规则与 tests/tour-test.mjs 相同） ----------
function passVisibility(cam, look, box) {
  if (visiblePointCount(boxes, cam, box) < 5) return { ok: false, why: '9点可见<5' };
  if (screenAreaFrac(box, cam, look) < 0.08) return { ok: false, why: '投影<8%' };
  const nd = nearestColliderDist(boxes, cam);
  if (nd.dist < 1.5) return { ok: false, why: `距碰撞盒${nd.name}仅${nd.dist.toFixed(2)}m` };
  return { ok: true };
}

// 树冠软规避（碰撞盒不含树；防止三穗堂一类「被树挡大半」复发）：
// 树高 ≥3.5 m 且树干距视线（cam→目标中心 2D 线段）<1.2 m 的候选不取。
const trees = layout.objects.filter(o => o.kind === 'tree' && o.geometry.position && (o.height || 0) >= 3.5)
  .map(o => ({ x: o.geometry.position[0], z: o.geometry.position[1], h: o.height }));
function treeCorridorBlocked(cam2, tgt2) {
  const L = dist2d(cam2, tgt2);
  for (const t of trees) {
    const dx = tgt2[0] - cam2[0], dz = tgt2[1] - cam2[1];
    const s = Math.max(0, Math.min(L, ((t.x - cam2[0]) * dx + (t.z - cam2[1]) * dz) / (L * L || 1)));
    if (dist2d([t.x, t.z], [cam2[0] + dx * s, cam2[1] + dz * s]) < 1.2) return true;
  }
  return false;
}

// 锚点周边净空候选点（≤maxR，不入建筑、离边 ≥1.0 m、不入水，距碰撞盒 ≥1.5 m），按离锚点近者优先
const bldFps = layout.objects.filter(o => o.geometry && o.geometry.footprint && /^bld-/.test(o.id)).map(o => ({ id: o.id, fp: o.geometry.footprint }));
const waters = layout.objects.filter(o => o.kind === 'water').map(o => o.geometry.footprint);
function anchorCamCandidates(a, maxR = 8) {
  const out = [];
  for (let r = 0; r <= maxR; r += 0.5) {
    for (let k = 0; k < 24; k++) {
      const th = (k / 24) * Math.PI * 2;
      const p = [a[0] + Math.cos(th) * r, a[1] + Math.sin(th) * r];
      if (bldFps.some(b => pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 1.0)) continue;
      if (waters.some(w => pointInPoly(p, w))) continue;
      if (nearestColliderDist(boxes, [p[0], EYE, p[1]]).dist < 1.5) continue;
      out.push(p);
    }
    if (out.length >= 40) break; // 近处够用就不再外扩
  }
  return out;
}
// 锚点出发方向组：from=锚点 的路线取第一段方向；to=锚点（终点型锚点）取末段顺势延伸
// （行进方向 = 人沿路线走到锚点后继续前行的方向，回头望是来路门洞/山墙，不是街景）。
// pts = 出发路线折线（供街廊截到第一段拐点前；cont 型无前向折线 → null，保持全长）。
// 逐条试（file 顺序），第一条能让机位过可见性检查的胜出。
function departingDirs(key) {
  const out = [];
  for (const r of routes.filter(r => r.from === key)) { const [a, b] = r.points; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; out.push({ route: `${r.from}->${r.to}`, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], pts: r.points }); }
  for (const r of routes.filter(r => r.to === key)) { const pts = r.points, a = pts[pts.length - 2], b = pts[pts.length - 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; out.push({ route: `cont:${r.from}->${r.to}`, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], pts: null }); }
  return out;
}

// ---------- 环绕对象候选（眼高 12–35 m 或斜俯视），R1 检查全过者按净距+朝向打分 ----------
const rockObs = layout.objects.filter(o => o.kind === 'rockery' && o.geometry.rocks).flatMap(o => o.geometry.rocks);
function orbitCamR1(reg, { h, dists, lookY, preferDir = null, rockMargin = 0, mustZone = null, treeSafe = false } = {}) {
  const c = regionCenter(reg);
  const box = targetBox(obj(reg.id));
  let best = null, bestScore = -Infinity, lastWhy = '';
  for (const R of dists) {
    for (let a = 0; a < 72; a++) {
      const th = (a / 72) * Math.PI * 2;
      const p2 = [c[0] + Math.cos(th) * R, c[1] + Math.sin(th) * R];
      if (mustZone && !pointInPoly(p2, layout.zones[mustZone].polygon)) continue;
      if (!tools.vistaPointClean(p2)) continue;
      if (rockMargin && Math.min(...rockObs.map(r => dist2d(p2, [r.x, r.z]) - r.size / 2)) < rockMargin) continue;
      const cam = [p2[0], h, p2[1]];
      const look = [c[0], lookY, c[1]];
      const v = passVisibility(cam, look, box);
      if (!v.ok) { lastWhy = v.why; continue; }
      if (treeSafe && treeCorridorBlocked(p2, c)) continue;
      const w = preferDir ? Math.abs(Math.atan2(Math.sin(th - preferDir[2]), Math.cos(th - preferDir[2]))) * 8 : 0;
      const score = tools.vistaClearance(p2) - w;
      if (score > bestScore) { bestScore = score; best = { p: cam, t: look }; }
    }
  }
  if (!best) return { cam: null, lastWhy };
  return { cam: { p: [+best.p[0].toFixed(1), +best.p[1].toFixed(1), +best.p[2].toFixed(1)], t: [+best.t[0].toFixed(1), +best.t[1].toFixed(1), +best.t[2].toFixed(1)] }, lastWhy };
}

const tour = {};
const fail = (k, why) => { console.error('NO-CAM-FOUND:', k, why || ''); process.exitCode = 1; };

// ---------- 六锚点：眼高 1.6 m 站立机位，朝向行进方向街景 ----------
// 目标 = 锚点街廊（tour-visibility.streetCorridorBox，沿出发路线第一段拐点前，6–36 m 夹取），
// targetObject 记为 'street:<route>' 供测试按同一冻结源重算同一走廊盒。
// anchor-jiuqu 例外：R1 指定朝九曲桥，targetObject = 'jiuqu-bridge'。
for (const key of ['main', 'gold', 'center', 'jiuqu', 'old-south', 'old-north']) {
  const a = nav.anchors[key];
  if (!a) { fail('anchor-' + key); continue; }
  const cands = anchorCamCandidates(a);
  if (!cands.length) { fail('anchor-' + key, '锚点 8 m 内无净空点'); continue; }
  let done = null;
  if (key === 'jiuqu') {
    const bridge = obj('jiuqu-bridge');
    const box = polylineNearBox(bridge, a); // 桥的锚点近段盒（R=30，全域 AABB 会罩住机位）
    for (const c of cands) {
      for (const pt of bridge.geometry.polyline) {
        if (!box || dist2d(pt, a) > 30) continue;
        const look = [pt[0], 1.5, pt[1]];
        const v = passVisibility([c[0], EYE, c[1]], look, box);
        if (v.ok) { done = { cam: c, look, target: 'jiuqu-bridge', how: '望九曲桥近段（R1 指定朝向）' }; break; }
      }
      if (done) break;
    }
  } else {
    const dirs = departingDirs(key);
    if (!dirs.length) { fail('anchor-' + key, 'commercial-route.json 无出发路线'); continue; }
    outer:
    for (const c of cands) {
      for (const { route, dir, pts } of dirs) {
        const look = streetCorridorAim(a, dir, pts);
        const hd = [look[0] - c[0], look[2] - c[1]];
        const hl = Math.hypot(...hd) || 1;
        const dot = (hd[0] / hl) * dir[0] + (hd[1] / hl) * dir[1];
        if (dot < Math.cos(20 * Math.PI / 180)) continue; // 留 5° 余量于测试的 25°
        const v = passVisibility([c[0], EYE, c[1]], look, streetCorridorBox(a, dir, pts));
        if (v.ok) { done = { cam: c, look, target: 'street:' + route, how: `沿出发方向（${route} 第一段，拐点前走廊）望街景` }; break outer; }
      }
    }
  }
  if (!done) { fail('anchor-' + key, '所有候选机位过不了可见性检查'); continue; }
  const nudged = dist2d(done.cam, a) > 0.5;
  tour['anchor-' + key] = {
    label: `锚点 ${key}`,
    zone: zoneOfPoint(a),
    p: [+done.cam[0].toFixed(1), EYE, +done.cam[1].toFixed(1)],
    t: [+done.look[0].toFixed(1), +done.look[1].toFixed(1), +done.look[2].toFixed(1)],
    targetObject: done.target,
    source: `computed(R1): nav-gap 锚点眼高 1.6 m 站立机位${nudged ? '（外移至净空点）' : ''}，${done.how}（baseline/layout.json + collision-* 重算）`,
  };
}

// ---------- 五对象取景机位 ----------
{
  const reg = regionOf('bld-428179901'); // 三穗堂：园墙内堂前眼高机位，正门朝向优先
  const f = obj('bld-428179901').facade.dir;
  const { cam, lastWhy } = orbitCamR1(reg, { h: EYE, dists: [12, 14, 16, 18, 21, 24, 28, 32, 35], lookY: 2.2, preferDir: [f[0], f[1], Math.atan2(f[1], f[0])], mustZone: 'garden', treeSafe: true });
  if (cam) tour.sansuitang = { label: '三穗堂', zone: 'garden', ...cam, targetObject: reg.id, source: 'computed(R1): 堂前园内眼高 1.6 m 机位（facade.dir 优先、树冠规避，12–35 m，baseline/layout.json + collision-* 重算）' };
  else fail('sansuitang', lastWhy);
}
{
  const reg = regionOf('jiuqu-bridge'); // 九曲桥：池带上空斜俯视望全桥
  const { cam, lastWhy } = orbitCamR1(reg, { h: 14, dists: [18, 22, 26, 30], lookY: 1.2, preferDir: [0, -1, Math.atan2(-1, 0)] });
  if (cam) tour['jiuqu-bridge'] = { label: '九曲桥', zone: 'pond', ...cam, targetObject: reg.id, source: 'computed(R1): 池带广场上空斜俯视望九曲桥（相机不入水不入建筑，baseline/layout.json + collision-* 重算）' };
  else fail('jiuqu-bridge', lastWhy);
}
{
  const reg = regionOf('rockery-dajiashan'); // 大假山：园墙内山前眼高仰观
  const { cam, lastWhy } = orbitCamR1(reg, { h: EYE, dists: [12, 15, 18, 22, 26, 30, 35], lookY: 4.5, rockMargin: 1.2, mustZone: 'garden' });
  if (cam) tour.dajiashan = { label: '大假山', zone: 'garden', ...cam, targetObject: reg.id, source: 'computed(R1): 园内山前眼高 1.6 m 仰观机位（不入岩石 1.2 m，12–35 m，baseline/layout.json + collision-* 重算）' };
  else fail('dajiashan', lastWhy);
}
{
  const reg = regionOf('rockery-yulinglong'); // 玉玲珑：园墙内峰前眼高近观
  const { cam, lastWhy } = orbitCamR1(reg, { h: EYE, dists: [12, 14, 16, 18, 22, 26, 30, 35], lookY: 2.2, rockMargin: 1.2, mustZone: 'garden' });
  if (cam) tour.yulinglong = { label: '玉玲珑', zone: 'garden', ...cam, targetObject: reg.id, source: 'computed(R1): 园内峰前眼高 1.6 m 近观机位（不入岩石 1.2 m，12–35 m，baseline/layout.json + collision-* 重算）' };
  else fail('yulinglong', lastWhy);
}
{
  const reg = regionOf('bld-428202599'); // 华宝楼（商城）：街面上空斜俯视望楼体
  let bp = null, bd = Infinity; // 街面方向：对象中心指向最近道路折线
  for (const r of layout.objects.filter(o => o.kind === 'road' && o.geometry.polyline)) {
    for (const pt of r.geometry.polyline) {
      const dd = dist2d(pt, regionCenter(reg));
      if (dd < bd) { bd = dd; bp = pt; }
    }
  }
  const u = [bp[0] - regionCenter(reg)[0], bp[1] - regionCenter(reg)[1]];
  const l = Math.hypot(...u) || 1;
  const { cam, lastWhy } = orbitCamR1(reg, { h: 22, dists: [40, 50, 60, 72], lookY: 7, preferDir: [u[0] / l, u[1] / l, Math.atan2(u[1], u[0])] });
  if (cam) tour.huabaolou = { label: '华宝楼', zone: 'bazaar', ...cam, targetObject: reg.id, source: 'computed(R1): 街面上空斜俯视望楼体（相机不入建筑，baseline/layout.json + collision-* 重算）' };
  else fail('huabaolou', lastWhy);
}

for (const [k, v] of Object.entries(tour)) console.log(k, `cam(${v.p}) -> tgt(${v.t}) zone=${v.zone} obj=${v.targetObject}`);
if (process.exitCode || Object.keys(tour).length < 11) { console.error('tour incomplete:', Object.keys(tour).length, '/ 11'); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'tour.json'), JSON.stringify(tour, null, 1) + '\n');
console.log('tour.json written:', Object.keys(tour).length, 'views');
