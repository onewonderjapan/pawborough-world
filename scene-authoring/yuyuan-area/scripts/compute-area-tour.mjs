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
import { centroid, distToPolyline, pointInPoly, dist2d, anchorBehindSharedEdge, rearWallFace } from '../src/lib.mjs';
import { makeShotTools } from './shot-lib.mjs';
import { loadColliders, targetBox, visiblePointCount, screenAreaFrac, nearestColliderDist, streetCorridorBox, streetCorridorAim, polylineNearBox, VIEW,
  streetFacadeBand, makeStreetViewScene, passageCeilings, passageMasses, streetViewProxy, STREET_VIEW } from './tour-visibility.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const tools = makeShotTools(layout);
const boxes = loadColliders(ROOT, path.basename(OUT));
// wave4-touranchor：锚点街景画面几何代理的场景（碰撞盒 + 无碰撞建筑棱柱 + 店屋实例 + 通道顶棚/楼身；管线产物 OUT/layout.json 提供通道）
const outLayout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const svScene = makeStreetViewScene(boxes, layout, { areaRoot: ROOT, ceilings: passageCeilings(outLayout), masses: passageMasses(outLayout) });
// 生成器选位门槛 = 渲染门槛再留余量（代理与渲染的差：目标 p5 −3.9 点、天空 p95 +0.9 点，见 wave4-touranchor RESULT）
const SV_GEN = { minTarget: STREET_VIEW.MIN_TARGET + 0.05, maxSky: STREET_VIEW.MAX_SKY - 0.05, maxNear: STREET_VIEW.MAX_NEAR_COMPONENT - 0.05 };
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
    // M3：不再在 40 个候选处提前收网 —— 旧上限会在路线方向变化（如 gold 广场口的
    // 蚀刻栅格边界抖动）时把 5–8 m 处唯一能过可见性检查的候选挡在列表外。
    // 迭代顺序仍是按环由近到远，第一个过检者优先，成本只是几毫秒的射线检查。
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
// M2：树干不入画 —— 树干段（0–2.5 m）投影进画面（fov46 / 1400×900，同 web 相机）的候选不要。
// 与 treeCorridorBlocked（视线走廊）互补：这条按真实画面投影判，斜俯视/眼高都适用。
function trunkInFrame(cam, look, c) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[1], a[0] * b[1] - a[1] * b[0]];
  const f3 = norm(sub(look, cam));
  const r3 = norm(cross(f3, [0, 1, 0]));
  if (!isFinite(r3[0])) return false;
  const u3 = cross(r3, f3);
  const tanY = Math.tan((VIEW.fovDeg / 2) * Math.PI / 180), tanX = tanY * (VIEW.width / VIEW.height);
  for (const t of trees) {
    for (const yy of [0.3, 1.2, 2.4]) {
      const d = sub([t.x, yy, t.z], cam);
      const z = d[0] * f3[0] + d[1] * f3[1] + d[2] * f3[2];
      if (z < 0.1) continue;
      const nx = (d[0] * r3[0] + d[1] * r3[1] + d[2] * r3[2]) / (z * tanX);
      const ny = (d[0] * u3[0] + d[1] * u3[1] + d[2] * u3[2]) / (z * tanY);
      if (Math.abs(nx) < 1 && Math.abs(ny) < 1) return true;
    }
  }
  return false;
}
function orbitCamR1(reg, { h, dists, lookY, preferDir = null, rockMargin = 0, mustZone = null, treeSafe = false, dirWindow = null, trunkFree = false, skipVistaClean = false } = {}) {
  const c = regionCenter(reg);
  const box = targetBox(obj(reg.id));
  let best = null, bestScore = -Infinity, lastWhy = '';
  for (const R of dists) {
    for (let a = 0; a < 72; a++) {
      const th = (a / 72) * Math.PI * 2;
      if (dirWindow) { // M2：硬角度窗 —— 只取立面朝向一侧（facade.dir），山墙方位直接排除
        const off = Math.abs(Math.atan2(Math.sin(th - dirWindow.th), Math.cos(th - dirWindow.th)));
        if (off > dirWindow.maxDeg * Math.PI / 180) continue;
      }
      const p2 = [c[0] + Math.cos(th) * R, c[1] + Math.sin(th) * R];
      if (mustZone && !pointInPoly(p2, layout.zones[mustZone].polygon)) continue;
      // skipVistaClean：高机位（h≥8 斜俯视）从水面上空取景的先例是 jiuqu-bridge 机位（池带上空 h14）。
      // 「不入水」在斜俯视意义下只剩着水画面问题，tour-test 也无此断言；三穗堂立面窗内
      // 净空点全部被前景树干占据（见 artifacts/m2/RESULT 的排查），此处按 M2 目标放开。
      if (!skipVistaClean && !tools.vistaPointClean(p2)) continue;
      if (rockMargin && Math.min(...rockObs.map(r => dist2d(p2, [r.x, r.z]) - r.size / 2)) < rockMargin) continue;
      const cam = [p2[0], h, p2[1]];
      const look = [c[0], lookY, c[1]];
      const v = passVisibility(cam, look, box);
      if (!v.ok) { lastWhy = v.why; continue; }
      if (treeSafe && treeCorridorBlocked(p2, c)) continue;
      if (trunkFree && trunkInFrame(cam, look, c)) { lastWhy = '树干入画'; continue; }
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
    // wave4-touranchor：R1 三条硬检查之外，再过街景画面代理（街面 + 两侧 6 m 立面 ≥ 30%、天空 ≤ 30%、下 1/3 近景墙 < 35%）；
    // 候选顺序不变（由近到远、路线按文件顺序），第一个全过者胜出。全部不过时取代理最好的一个并 WARN（tour-render-check 会判）。
    let best = null;
    outer:
    for (const c of cands) {
      for (const { route, dir, pts } of dirs) {
        const look = streetCorridorAim(a, dir, pts);
        const hd = [look[0] - c[0], look[2] - c[1]];
        const hl = Math.hypot(...hd) || 1;
        const dot = (hd[0] / hl) * dir[0] + (hd[1] / hl) * dir[1];
        if (dot < Math.cos(20 * Math.PI / 180)) continue; // 留 5° 余量于测试的 25°
        const corr = streetCorridorBox(a, dir, pts);
        const v = passVisibility([c[0], EYE, c[1]], look, corr);
        if (!v.ok) continue;
        const sv = streetViewProxy(svScene, [c[0], EYE, c[1]], look, corr, streetFacadeBand(a, dir, pts));
        const cand = { cam: c, look, target: 'street:' + route, sv, how: `沿出发方向（${route} 第一段，拐点前走廊）望街景` };
        if (sv.target >= SV_GEN.minTarget && sv.sky <= SV_GEN.maxSky && sv.nearMax < SV_GEN.maxNear) { done = cand; break outer; }
        const score = Math.min(sv.target - SV_GEN.minTarget, SV_GEN.maxSky - sv.sky, SV_GEN.maxNear - sv.nearMax);
        if (!best || score > best.score) best = { ...cand, score };
      }
    }
    if (!done && best) {
      console.warn(`WARN anchor-${key}: 没有候选同时过街景代理门槛，取代理最好的一个（目标 ${(best.sv.target * 100).toFixed(1)}%、天空 ${(best.sv.sky * 100).toFixed(1)}%、近景 ${(best.sv.nearMax * 100).toFixed(1)}%）`);
      done = best;
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
    source: `computed(R1${done.sv ? '+wave4 街景代理' : ''}): nav-gap 锚点眼高 1.6 m 站立机位${nudged ? '（外移至净空点）' : ''}，${done.how}（baseline/layout.json + collision-* 重算）`,
  };
  if (done.sv) tour['anchor-' + key].streetViewProxy = { target: +done.sv.target.toFixed(3), sky: +done.sv.sky.toFixed(3), soffit: +done.sv.soffit.toFixed(3), nearMax: +done.sv.nearMax.toFixed(3) };
}

// ---------- 五对象取景机位 ----------
{
  // 三穗堂（wave2-sansuitang S3）：南侧入口院落眼高 1.6 m 正对格扇立面（立面朝南为主控覆盖，常识判断未核实）。
  // 机位中心 = 模块锚点（与 assemble / export-collision 同一规则：footprint 最小面积外接矩形中心 + 沿 facade.dir
  // 使后墙外皮不越过与仰山堂共用边线的最小平移）；机位在 facade.dir 一侧、偏立面轴 ≤ 20°、距锚点 12–25 m，
  // 园墙内（garden 分区）、不入水、不入建筑 footprint 且离边 ≥ 0.8 m、R1 三条硬检查全过，
  // 且没有树挡在格扇立面前：树（≥3.5 m）干到「机位—格扇墙两端」三角形的平面距离 ≥ 2.5 m（树冠余量）。
  // （院里的树可以在画面边上；M2 的「树干整幅不入画」在南院眼高下无解——gtree-9 就在院子西侧。）
  // 注视点 = 锚点沿 facade.dir 前移到格扇墙带（本地 z = 格扇墙 hall-wall 线 ~+4.3 m）、y = 2.4 m。
  // 眼高无解才退斜俯视（h 8–12，同一角度/距离窗）。
  const o = obj('bld-428179901');
  const reg = regionOf(o.id);
  const box = targetBox(o);
  const sstColl = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'sansuitang', 'collision.json'), 'utf8'));
  const { backZ, backHalfX } = rearWallFace(sstColl);
  const anc = anchorBehindSharedEdge(o.geometry.footprint, obj('bld-428179902').geometry.footprint, o.facade.dir, backZ, backHalfX).anchor;
  const fl = Math.hypot(...o.facade.dir), f = [o.facade.dir[0] / fl, o.facade.dir[1] / fl];
  const doorLine = Math.max(...sstColl.colliders.filter(c => c.name === 'door-leaf').map(c => c.center[2]));
  const look = [anc[0] + f[0] * doorLine, 2.4, anc[1] + f[1] * doorLine];
  const bldsNear = bldFps;
  const rgt = [f[1], -f[0]], halfW = backHalfX;
  const FA = [look[0] + rgt[0] * halfW, look[2] + rgt[1] * halfW], FB = [look[0] - rgt[0] * halfW, look[2] - rgt[1] * halfW];
  const triDist = (q, a, b, c) => {
    const sg = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const d1 = sg(q, a, b), d2 = sg(q, b, c), d3 = sg(q, c, a);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0;
    return Math.min(distToPolyline(q, [a, b]), distToPolyline(q, [b, c]), distToPolyline(q, [c, a]));
  };
  const treeBeforeFacade = (p2) => trees.some(t => triDist([t.x, t.z], p2, FA, FB) < 2.5);
  const cands = [];
  for (const h of [EYE, 8, 10, 12]) {
    for (let R = 12; R <= 25; R += 0.5) {
      for (let offDeg = -20; offDeg <= 20; offDeg += 2) {
        const th = offDeg * Math.PI / 180;
        const dir = [f[0] * Math.cos(th) - f[1] * Math.sin(th), f[0] * Math.sin(th) + f[1] * Math.cos(th)];
        const p2 = [anc[0] + dir[0] * R, anc[1] + dir[1] * R];
        if (!pointInPoly(p2, layout.zones.garden.polygon)) continue;
        if (waters.some(w => pointInPoly(p2, w))) continue;
        if (bldsNear.some(b => pointInPoly(p2, b.fp) || distToPolyline(p2, closed(b.fp)) < 0.8)) continue;
        if (Math.min(...rockObs.map(r => dist2d(p2, [r.x, r.z]) - r.size / 2)) < 1.2) continue;
        const cam = [p2[0], h, p2[1]];
        const v = passVisibility(cam, look, box);
        if (!v.ok) continue;
        if (treeBeforeFacade(p2)) continue;
        // 打分：偏轴越小越好，距离靠近 16 m 越好；眼高优先（h 分层遍历，眼高有解即停）
        cands.push({ p: cam, off: Math.abs(offDeg), R, score: -Math.abs(offDeg) * 0.5 - Math.abs(R - 16) });
      }
    }
    if (cands.length) break;
  }
  if (cands.length) {
    cands.sort((a2, b2) => b2.score - a2.score);
    const c = cands[0];
    const form = c.p[1] === EYE ? '眼高 1.6 m' : `斜俯视 h${c.p[1]}（眼高无解，退）`;
    tour.sansuitang = { label: '三穗堂', zone: 'garden', p: c.p.map(x => +x.toFixed(1)), t: look.map(x => +x.toFixed(1)), targetObject: reg.id,
      source: `computed(R1+wave2 S3): 南侧院落${form}正对格扇立面（偏立面轴 ${c.off}°、距锚点 ${c.R} m；锚点=外接矩形中心+共用边平移；立面朝南为常识判断未核实；baseline/layout.json + collision-* 重算）` };
    console.log(`sansuitang candidates ${cands.length}, chosen off=${c.off}° R=${c.R} h=${c.p[1]}`);
  } else fail('sansuitang', '南院 12–25 m、±20° 窗内无机位过 R1 + 立面前无树');
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
