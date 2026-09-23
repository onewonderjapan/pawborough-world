// WP13/T1 tour.json 几何契约测试（对照冻结源 baseline/layout.json 重算校验，不拿产物自比）。
// 断言：
//  1) 覆盖 ≥11 机位：nav-gap 六锚点 + 三穗堂/九曲桥/大假山/玉玲珑/华宝楼；
//  2) 机位不入任何建筑 footprint（且距建筑边 ≥0.8 m 走廊净距）；
//  3) 目标点落在 targetObject 区域内或其 3 m 缓冲内；
//  4) 锚点机位 ≤8 m 于 nav-gap 锚点、眼高 1.6 m；对象机位为眼高 1.6 m 或斜俯视（h≥8）两种之一。
// 用法：OUT_DIR=out-zone node tests/tour-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const navPath = path.join(OUT, 'nav-gap.json');
const tourPath = path.join(OUT, 'tour.json');
const closed = (fp) => [...fp, fp[0]];
let fails = 0;
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); fails++; } };

check(fs.existsSync(navPath), `nav-gap.json 不存在（${navPath}）— 需先跑重建链`);
const nav = fs.existsSync(navPath) ? JSON.parse(fs.readFileSync(navPath, 'utf8')) : { anchors: {} };
if (!fs.existsSync(tourPath)) { console.error('FAIL: tour.json 不存在（' + tourPath + '）— 先跑 scripts/compute-area-tour.mjs'); process.exit(1); }
const tour = JSON.parse(fs.readFileSync(tourPath, 'utf8'));

// 区域距离（<0 或 0 = 区域内）：footprint / 折线(半宽) / 岩石圆盘
function regionOf(id) {
  const o = layout.objects.find(x => x.id === id);
  if (!o) return null;
  if (o.geometry.footprint) return { id, fp: o.geometry.footprint };
  if (o.geometry.polyline) return { id, pl: o.geometry.polyline, halfW: (o.width || 2.4) / 2 };
  if (o.geometry.rocks) return { id, rocks: o.geometry.rocks.map(r => ({ x: r.x, z: r.z, r: r.size / 2 })) };
  return null;
}
function regionDist(reg, p) {
  if (reg.fp) return pointInPoly(p, reg.fp) ? 0 : distToPolyline(p, closed(reg.fp));
  if (reg.pl) return Math.max(0, distToPolyline(p, reg.pl) - reg.halfW);
  return Math.max(0, Math.min(...reg.rocks.map(r => dist2d(p, [r.x, r.z]) - r.r)));
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
  // 3) 目标点在 targetObject 区域 3 m 缓冲内
  const reg = regionOf(v.targetObject);
  check(reg, `${key} targetObject ${v.targetObject} 不在 baseline/layout.json`);
  if (reg) check(regionDist(reg, t2) <= 3, `${key} 目标点距 ${v.targetObject} 区域 ${regionDist(reg, t2).toFixed(1)} m > 3 m`);
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
console.log('tour-test: all pass');
