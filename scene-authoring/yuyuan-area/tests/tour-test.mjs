// WP13/T1 tour.json 几何契约测试（对照冻结源 baseline/layout.json 重算校验，不拿产物自比）。
// 断言：
//  1) 覆盖 ≥11 机位：nav-gap 六锚点 + 三穗堂/九曲桥/大假山/玉玲珑/华宝楼；
//  2) 机位不入任何建筑 footprint（且距建筑边 ≥0.8 m 走廊净距）；
//  3) 目标点落在 targetObject 区域内或其 3 m 缓冲内；
//  4) 锚点机位 ≤8 m 于 nav-gap 锚点、眼高 1.6 m；对象机位为眼高 1.6 m 或斜俯视（h≥8）两种之一；
//  5) R1：每个机位看得到目标 —— 包围盒 9 采样点（中心+8角）对 collision-*.json 射线遮挡 ≥5 点可见；
//  6) R1：目标包围盒投影到画面（fov46/1400×900，同 web 相机）面积 ≥8%；
//  7) R1：相机到最近可遮挡碰撞盒（顶 ≥1.6 m）≥1.5 m，不贴墙；
//  8) R1：眼高对象机位距目标区域中心 12–35 m 且与目标同分区（不得隔墙外拍园内景）；
//  9) R1：锚点机位朝向 = commercial-route.json 从该锚点出发第一段方向（≤25°）；anchor-jiuqu 目标为九曲桥。
// 用法：OUT_DIR=out-zone node tests/tour-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d, anchorBehindSharedEdge, rearWallFace } from '../src/lib.mjs';
import { loadColliders, targetBox, visiblePointCount, screenAreaFrac, nearestColliderDist, streetCorridorBox, boxDist2d, polylineNearBox } from '../scripts/tour-visibility.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const layoutObj = (id) => layout.objects.find(x => x.id === id);
const navPath = path.join(OUT, 'nav-gap.json');
const tourPath = path.join(OUT, 'tour.json');
const closed = (fp) => [...fp, fp[0]];
let fails = 0;
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); fails++; } };

check(fs.existsSync(navPath), `nav-gap.json 不存在（${navPath}）— 需先跑重建链`);
const nav = fs.existsSync(navPath) ? JSON.parse(fs.readFileSync(navPath, 'utf8')) : { anchors: {} };
if (!fs.existsSync(tourPath)) { console.error('FAIL: tour.json 不存在（' + tourPath + '）— 先跑 scripts/compute-area-tour.mjs'); process.exit(1); }
const tour = JSON.parse(fs.readFileSync(tourPath, 'utf8'));
// commercial-route.json（冻结链产物）：锚点街景机位的方向声明在此核对
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
// 'street:A->B' = 路线 A→B 第一段方向；'street:cont:A->B' = 终点型锚点的末段顺势延伸方向
function anchorRouteDir(tag, allRoutes) {
  const spec = String(tag).slice('street:'.length);
  const cont = spec.startsWith('cont:');
  const [from, to] = (cont ? spec.slice(5) : spec).split('->');
  const r = allRoutes.find(x => x.from === from && x.to === to);
  if (!r) return null;
  if (!cont) { const [a, b] = r.points; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
  const pts = r.points, a = pts[pts.length - 2], b = pts[pts.length - 1];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}
// 出发路线折线（from 型；cont 型无前向折线 → null，走廊保持全长）。与生成器同一冻结源。
function anchorRoutePts(tag, allRoutes) {
  const spec = String(tag).slice('street:'.length);
  if (spec.startsWith('cont:')) return null;
  const [from, to] = spec.split('->');
  const r = allRoutes.find(x => x.from === from && x.to === to);
  return r ? r.points : null;
}

// 区域距离（<0 或 0 = 区域内）：footprint / 折线(半宽) / 岩石圆盘
function regionOf(id) {
  const o = layout.objects.find(x => x.id === id);
  if (!o) return null;
  if (o.geometry.footprint) return { id, fp: o.geometry.footprint };
  if (o.geometry.polyline) return { id, pl: o.geometry.polyline, halfW: (o.width || 2.4) / 2 };
  if (o.geometry.rocks) return { id, rocks: o.geometry.rocks.map(r => ({ x: r.x, z: r.z, r: r.size / 2, h: r.h })) };
  return null;
}
function regionDist(reg, p) {
  if (reg.fp) return pointInPoly(p, reg.fp) ? 0 : distToPolyline(p, closed(reg.fp));
  if (reg.pl) return Math.max(0, distToPolyline(p, reg.pl) - reg.halfW);
  return Math.max(0, Math.min(...reg.rocks.map(r => dist2d(p, [r.x, r.z]) - r.r)));
}
// 区域中心（与生成器同规则：footprint 质心 / 折线中点 / 岩石主峰）
function regionCenter(reg) {
  if (reg.fp) return centroid(reg.fp);
  if (reg.pl) return reg.pl[Math.floor(reg.pl.length / 2)];
  const m = reg.rocks.reduce((a, b) => (b.h > a.h || (b.h === a.h && b.r > a.r) ? b : a));
  return [m.x, m.z];
}

const blds = layout.objects.filter(o => o.geometry && o.geometry.footprint && /^bld-/.test(o.id))
  .map(o => ({ id: o.id, fp: o.geometry.footprint }));
const camClearance = (p) => {
  let d = Infinity;
  for (const b of blds) {
    if (pointInPoly(p, b.fp)) return { inFp: b.id, d: 0 };
    d = Math.min(d, distToPolyline(p, closed(b.fp)));
  }
  return { inFp: null, d };
};

// 1) 覆盖
check(Object.keys(tour).length >= 11, `机位数 ${Object.keys(tour).length} < 11`);
const anchors = ['main', 'gold', 'center', 'jiuqu', 'old-south', 'old-north'];
for (const k of anchors) check(!!tour['anchor-' + k], `缺锚点机位 anchor-${k}`);
for (const k of ['sansuitang', 'jiuqu-bridge', 'dajiashan', 'yulinglong', 'huabaolou']) check(!!tour[k], `缺对象机位 ${k}`);

const zoneNames = new Set([...Object.keys(layout.zones), 'core']);
for (const [key, v] of Object.entries(tour)) {
  check(v && Array.isArray(v.p) && v.p.length === 3 && Array.isArray(v.t) && v.t.length === 3, `${key} 缺 p/t`);
  if (!v?.p?.length) continue;
  const cam2 = [v.p[0], v.p[2]];
  const t2 = [v.t[0], v.t[2]];
  // 2) 机位不入建筑 footprint 且 ≥0.8 m 净距
  const cc = camClearance(cam2);
  check(!cc.inFp, `${key} 机位落在建筑 ${cc.inFp} footprint 内 (${cam2.map(x => x.toFixed(1))})`);
  check(cc.d >= 0.8, `${key} 机位距建筑边 ${cc.d.toFixed(2)} m < 0.8 m`);
  // 3) 目标点在目标区域 3 m 缓冲内 —— 对象机位 = layout 对象区域；
  //    锚点街景机位（targetObject = 'street:<route>'）= 锚点街廊（沿出发路线第一段拐点前，6–36 m 夹取，冻结源重算）；
  //    anchor-jiuqu = 九曲桥锚点近段盒（折线 30 m 内点，冻结源重算）
  if (key === 'anchor-jiuqu' && v.targetObject === 'jiuqu-bridge') {
    const box = polylineNearBox(layoutObj('jiuqu-bridge'), nav.anchors.jiuqu);
    check(!!box, 'anchor-jiuqu 桥近段盒无法重算');
    if (box) check(boxDist2d(box, t2) <= 3, `anchor-jiuqu 目标点距桥近段盒 ${boxDist2d(box, t2).toFixed(1)} m > 3 m`);
  } else if (String(v.targetObject).startsWith('street:')) {
    const aKey = key.slice('anchor-'.length);
    const a = nav.anchors && nav.anchors[aKey];
    check(!!a, `${key} nav-gap 无锚点 ${aKey}`);
    if (a) {
      const box = streetCorridorBox(a, anchorRouteDir(v.targetObject, routes), anchorRoutePts(v.targetObject, routes));
      const d = boxDist2d(box, t2);
      check(d <= 3, `${key} 目标点距锚点街廊 ${d.toFixed(1)} m > 3 m`);
    }
  } else {
    const reg = regionOf(v.targetObject);
    check(reg, `${key} targetObject ${v.targetObject} 不在 baseline/layout.json`);
    if (reg) check(regionDist(reg, t2) <= 3, `${key} 目标点距 ${v.targetObject} 区域 ${regionDist(reg, t2).toFixed(1)} m > 3 m`);
  }
  // 4) 机位模式：锚点=眼高 1.6 m 且 ≤8 m 于 nav-gap 锚点；对象=眼高 1.6 m 或斜俯视 h≥8
  if (key.startsWith('anchor-')) {
    const aKey = key.slice('anchor-'.length);
    const a = nav.anchors && nav.anchors[aKey];
    check(!!a, `${key} 在 nav-gap.json 无对应锚点`);
    if (a) check(dist2d(cam2, a) <= 8, `${key} 机位距锚点 ${dist2d(cam2, a).toFixed(1)} m > 8 m`);
    check(Math.abs(v.p[1] - 1.6) < 0.01, `${key} 眼高 ${v.p[1]} ≠ 1.6`);
  } else {
    check(Math.abs(v.p[1] - 1.6) < 0.01 || v.p[1] >= 8, `${key} 机位高 ${v.p[1]} 既非眼高 1.6 也非斜俯视(≥8)`);
  }
  check(zoneNames.has(v.zone), `${key} zone ${v.zone} 非法`);
}

console.log(`tour-test: ${Object.keys(tour).length} views checked`);
if (fails) { console.error(`tour-test: ${fails} fail`); process.exit(1); }

// ---------- R1 新断言：机位必须「看得到目标」 ----------
// 碰撞盒来自管线产物 collision-*.json（重建链 export-collision 生成），
// 目标包围盒从冻结源 baseline/layout.json 重算 —— 均不依赖 tour.json 自身。
const boxes = loadColliders(ROOT, path.relative(ROOT, OUT).split(path.sep).pop());
const IN_GARDEN_EYE_CAMS = ['sansuitang', 'dajiashan', 'yulinglong']; // 园墙内对象：机位必须同院落
let r1fails = 0;
const r1check = (ok, msg) => { if (!ok) { console.error('FAIL(R1):', msg); r1fails++; } };
for (const [key, v] of Object.entries(tour)) {
  const cam = v.p, tgt = v.t;
  // 目标盒：锚点街景机位 = 锚点街廊（冻结源重算）；anchor-jiuqu = 桥近段盒；其余 = layout 对象包围盒
  const isStreet = String(v.targetObject).startsWith('street:');
  const box = key === 'anchor-jiuqu' && v.targetObject === 'jiuqu-bridge'
    ? polylineNearBox(layoutObj('jiuqu-bridge'), nav.anchors.jiuqu)
    : isStreet
      ? streetCorridorBox(nav.anchors[key.slice('anchor-'.length)], anchorRouteDir(v.targetObject, routes), anchorRoutePts(v.targetObject, routes))
      : targetBox(layoutObj(v.targetObject));
  check(!!box && !!(box.min || box.center), `${key} 目标盒无法从冻结源重算（${v.targetObject}）`);
  if (!box || !(box.min || box.center)) continue;
  // 5) 9 点可见 ≥5
  const vis = visiblePointCount(boxes, cam, box);
  r1check(vis >= 5, `${key} 目标包围盒 9 点仅 ${vis} 点可见（<5，视线被碰撞盒挡）`);
  // 6) 画面投影面积 ≥8%
  const frac = screenAreaFrac(box, cam, tgt);
  r1check(frac >= 0.08, `${key} 目标投影占画面 ${(frac * 100).toFixed(1)}% < 8%`);
  // 7) 相机距最近可遮挡碰撞盒 ≥1.5 m
  const nd = nearestColliderDist(boxes, cam);
  r1check(nd.dist >= 1.5, `${key} 相机距碰撞盒 ${nd.name} 仅 ${nd.dist.toFixed(2)} m < 1.5 m`);
  // 8) 眼高对象机位：12–35 m 于目标区域中心，且机位在目标所属分区内（不隔墙）
  if (IN_GARDEN_EYE_CAMS.includes(key)) {
    const o = layoutObj(v.targetObject);
    const reg = regionOf(v.targetObject);
    const c = regionCenter(reg);
    const dc = dist2d([cam[0], cam[2]], c);
    r1check(dc >= 12 && dc <= 35, `${key} 机位距目标中心 ${dc.toFixed(1)} m 不在 12–35 m`);
    r1check(pointInPoly([cam[0], cam[2]], layout.zones[o.zone].polygon), `${key} 机位在 ${o.zone} 分区外（隔墙外拍）`);
  }
  // 9) 锚点朝向：行进方向街景（方向取 targetObject 声明的路线，从冻结源重算）；jiuqu 锚点朝九曲桥
  if (key.startsWith('anchor-')) {
    const aKey = key.slice('anchor-'.length);
    if (aKey === 'jiuqu') {
      r1check(v.targetObject === 'jiuqu-bridge', `anchor-jiuqu 目标为 ${v.targetObject} ≠ jiuqu-bridge（必须朝九曲桥）`);
    } else {
      const spec = String(v.targetObject);
      r1check(spec.startsWith('street:'), `anchor-${aKey} targetObject ${spec} 非街景目标（street:<route>）`);
      const dir = spec.startsWith('street:') ? anchorRouteDir(spec, routes) : null;
      r1check(!!dir, `anchor-${aKey} 声明的路线 ${spec} 在 commercial-route.json 不存在`);
      if (dir) {
        const cont = spec.startsWith('street:cont:');
        const [from, to] = (cont ? spec.slice('street:cont:'.length) : spec.slice('street:'.length)).split('->');
        r1check(cont ? to === aKey : from === aKey, `anchor-${aKey} 声明的路线 ${spec} 并非从该锚点出发`);
        const hd = [tgt[0] - cam[0], tgt[2] - cam[2]];
        const hl = Math.hypot(...hd) || 1;
        const dot = Math.max(-1, Math.min(1, (hd[0] / hl) * dir[0] + (hd[1] / hl) * dir[1]));
        const deg = Math.acos(dot) * 180 / Math.PI;
        r1check(deg <= 25, `anchor-${aKey} 朝向偏离出发方向 ${deg.toFixed(1)}° > 25°`);
      }
    }
  }
}
// 10) 三穗堂机位（wave2-sansuitang S3）：南侧院落眼高 1.6 m 正对格扇立面 —— 机位在 facade.dir 一侧、
//     偏立面轴 ≤ 20°、距模块锚点 12–25 m（锚点从冻结源 + 模块 collision.json 按 assemble 同一规则重算）。
//     立面朝南是主控覆盖（常识判断，未核实）；本断言只核对机位与 layout facade.dir 的几何关系。
if (tour.sansuitang) {
  const o = layoutObj('bld-428179901');
  const { backZ, backHalfX } = rearWallFace(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'sansuitang', 'collision.json'), 'utf8')));
  const anc = anchorBehindSharedEdge(o.geometry.footprint, layoutObj('bld-428179902').geometry.footprint, o.facade.dir, backZ, backHalfX).anchor;
  const v = tour.sansuitang, d = [v.p[0] - anc[0], v.p[2] - anc[1]], R = Math.hypot(...d);
  const fl = Math.hypot(...o.facade.dir);
  const off = Math.acos(Math.max(-1, Math.min(1, (d[0] * o.facade.dir[0] + d[1] * o.facade.dir[1]) / (R * fl)))) * 180 / Math.PI;
  r1check(Math.abs(v.p[1] - 1.6) < 0.01, `sansuitang 机位高 ${v.p[1]} ≠ 眼高 1.6`);
  r1check(off <= 20, `sansuitang 机位偏立面轴 ${off.toFixed(1)}° > 20°`);
  r1check(R >= 12 && R <= 25, `sansuitang 机位距锚点 ${R.toFixed(1)} m 不在 12–25 m`);
  const lk = [v.t[0] - v.p[0], v.t[2] - v.p[2]], ll = Math.hypot(...lk);
  const faceOff = Math.acos(Math.max(-1, Math.min(1, -(lk[0] * o.facade.dir[0] + lk[1] * o.facade.dir[1]) / (ll * fl)))) * 180 / Math.PI;
  r1check(faceOff <= 30, `sansuitang 视线与立面法线反向夹角 ${faceOff.toFixed(1)}° > 30°（没有正对立面）`);
  console.log(`tour-test(sansuitang): 偏立面轴 ${off.toFixed(1)}°，距锚点 ${R.toFixed(1)} m，h ${v.p[1]}，视线对立面法线 ${faceOff.toFixed(1)}°`);
}
console.log(`tour-test(R1): visibility/projection/clearance checked on ${Object.keys(tour).length} views`);
if (r1fails) { console.error(`tour-test(R1): ${r1fails} fail`); process.exit(1); }
console.log('tour-test: all pass (R1 included)');
