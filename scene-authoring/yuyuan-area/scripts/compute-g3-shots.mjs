// G3 渲染机位计算：街面人眼高度（1.6-2.2m），沿商业街/摊位组团取景。
// 约束：相机点不在建筑轮廓/水面内、与建筑≥0.8m；视线逐米采样不被建筑挡截（走廊内两侧建筑合法，只挡横穿）。
// 用法：node scripts/compute-g3-shots.mjs [OUT_DIR=out-goal-03]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-goal-03');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'inputs', 'map-data.json'), 'utf8'));

const blds = layout.objects.filter(o => o.geometry && o.geometry.footprint && /^bld-/.test(o.id))
  .map(o => ({ id: o.id, fp: o.geometry.footprint }));
const waters = layout.objects.filter(o => o.kind === 'water').map(o => o.geometry.footprint);
const closed = fp => [...fp, fp[0]];
function pointBlocked(p, ignoreIds = []) {
  for (const b of blds) {
    if (ignoreIds.includes(b.id)) continue;
    if (pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 0.8) return true;
  }
  for (const w of waters) if (pointInPoly(p, w) || distToPolyline(p, closed(w)) < 0.6) return true;
  return false;
}
function rayBlocked(p, q, ignoreIds = []) {
  const L = dist2d(p, q), n = Math.max(2, Math.ceil(L / 0.5));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (const b of blds) {
      if (ignoreIds.includes(b.id)) continue;
      if (pointInPoly(s, b.fp) || distToPolyline(s, closed(b.fp)) < 0.5) return true;
    }
  }
  return false;
}
const dist2dLocal = dist2d;

// 沿街机位：路弧长 sCam 处高 hCam，看向弧长 sTarget 处（同一街）；在 ±slid 范围内找干净点
function streetCam(road, sCam, sTarget, { h = 1.7, lateral = 0, slid = 8, latT = 0 } = {}) {
  const total = (() => { let t = 0; for (let i = 0; i < road.points.length - 1; i++) t += dist2d(road.points[i], road.points[i + 1]); return t; })();
  const at = (s) => {
    s = Math.max(0.5, Math.min(total - 0.5, s));
    let acc = 0;
    for (let i = 0; i < road.points.length - 1; i++) {
      const L = dist2d(road.points[i], road.points[i + 1]);
      if (s <= acc + L || i === road.points.length - 2) {
        const t = (s - acc) / (L || 1);
        const p = [road.points[i][0] + (road.points[i + 1][0] - road.points[i][0]) * t, road.points[i][1] + (road.points[i + 1][1] - road.points[i][1]) * t];
        const u = [(road.points[i + 1][0] - road.points[i][0]) / (L || 1), (road.points[i + 1][1] - road.points[i][1]) / (L || 1)];
        return { p, u, n: [-u[1], u[0]] };
      }
      acc += L;
    }
    return null;
  };
  const tgt = at(sTarget);
  for (let d = 0; d <= slid; d += 1) {
    for (const sgn of d === 0 ? [1] : [1, -1]) {
      const cam0 = at(sCam + sgn * d);
      if (!cam0 || !tgt) continue;
      for (const lat of [0, lateral, -lateral, lateral * 2, -lateral * 2]) {
        const c = [cam0.p[0] + cam0.n[0] * lat, h, cam0.p[1] + cam0.n[1] * lat];
        if (pointBlocked([c[0], c[2]])) continue;
        const tp = [tgt.p[0] + tgt.n[0] * latT, tgt.p[1] + tgt.n[1] * latT];
        if (rayBlocked([c[0], c[2]], tp)) continue;
        return { p: [+c[0].toFixed(1), h, +c[2].toFixed(1)], t: [+tp[0].toFixed(1), 1.5, +tp[1].toFixed(1)] };
      }
    }
  }
  return null;
}
// 组团机位：看向组团质心，相机在路对侧/沿街后退处
function clusterCam(clusterId, { h = 1.7, dist = 11 } = {}) {
  const members = layout.objects.filter(o => o.kind === 'stall' && o.cluster === clusterId);
  if (!members.length) return null;
  const c = centroid(members.map(m => m.geometry.position));
  const roadId = members[0].faces.roadOsm;
  const road = map.roads.find(r => r.id === roadId);
  const rp = members[0].faces.refPoint;
  const back = [c[0] - (rp[0] - c[0]), c[1] - (rp[1] - c[1])]; // 路对侧方向
  const bl = Math.hypot(back[0] - c[0], back[1] - c[1]) || 1;
  const dir = [(back[0] - c[0]) / bl, (back[1] - c[1]) / bl];
  for (const dd of [dist, dist + 3, dist - 2, dist + 6, dist + 10]) {
    for (const sw of [-3, -1.5, 0, 1.5, 3, 5, -5, 7, -7]) { // 沿街向滑动
      const px = c[0] + dir[0] * dd + -dir[1] * sw, pz = c[1] + dir[1] * dd + dir[0] * sw;
      if (pointBlocked([px, pz])) continue;
      if (rayBlocked([px, pz], c)) continue;
      return { p: [+px.toFixed(1), h, +pz.toFixed(1)], t: [+c[0].toFixed(1), 1.3, +c[1].toFixed(1)] };
    }
  }
  return null;
}

const roadBy = (id) => map.roads.find(r => r.id === id);
const results = {};
// 主街两端：方浜中路商业段（way 238219462，核心段弧 0-112）西端与东端，沿街互望
// n+ 指向商城侧（南侧）；目标加 latT 偏向门面与摊位，不取空路轴
results['31-fangbang-west-end'] = streetCam(roadBy(238219462), 6, 55, { h: 1.7, lateral: 0, latT: 4 });
results['32-fangbang-east-end'] = streetCam(roadBy(238219462), 106, 50, { h: 1.7, lateral: 1.5, latT: 4 });
// 支街交叉口：旧校场路北端 × 方浜中路（弧 ~296 处望向北端路口）
results['33-jiuchang-fangbang-cross'] = streetCam(roadBy(33683251), 262, 299, { h: 1.7, lateral: -2, latT: -1 });
// 豫园老街沿轴机位不可行：OSM 路线整段嵌在 bld-553893884 内、走廊被两侧楼块多边形吞没（源图冲突，G1 同类如实记录）；
// 其界面连续性由 streetFrontage 100% 覆盖与 bazaar 斜览图佐证，此处不摆拍。
// 支街连续界面：旧校场路中段（组团 5/6 之间的连排开间+摊位）
results['34-jiuchang-mid-blocks'] = streetCam(roadBy(33683251), 130, 70, { h: 1.8, lateral: 0 });
// 广场摊位群：九曲桥广场北段组团 8 + 湖心亭西组团 9
results['35-jiuqu-plaza-stalls'] = clusterCam(8, { h: 1.7, dist: 10 });
results['36-jiuqu-lakeside-stalls'] = clusterCam(9, { h: 1.6, dist: 8 });
// 旧校场路南端组团 7
results['37-jiuchang-south-stalls'] = clusterCam(7, { h: 1.7, dist: 9 });

for (const [k, v] of Object.entries(results)) {
  console.log(k, v ? `cam(${v.p}) -> tgt(${v.t})` : 'NO-CAM-FOUND');
}
fs.writeFileSync(path.join(OUT, 'g3-shot-cams.json'), JSON.stringify(results, null, 1));
const missing = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error('missing cams:', missing.join(', ')); process.exit(1); }
