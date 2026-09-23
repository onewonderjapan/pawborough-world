// G2 渲染机位计算：目标节点 + 特征方向 → 通过净距与视线检查的相机坐标。
// 约束：相机点不在任何建筑轮廓/树冠半径/水面内；视线逐米采样不被其他建筑轮廓挡截。
// 用法：node scripts/compute-g2-shots.mjs [OUT_DIR=out-goal-02]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-goal-02');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));

const blds = layout.objects.filter(o => o.geometry && o.geometry.footprint && /^bld-/.test(o.id))
  .map(o => ({ id: o.id, fp: o.geometry.footprint }));
const trees = layout.objects.filter(o => o.kind === 'tree').map(o => o.geometry.position);
const waters = layout.objects.filter(o => o.kind === 'water').map(o => o.geometry.footprint);
const wallSegs = (layout.objects.find(o => o.id === 'garden-wall')?.geometry.segments) || [];
const gate = (layout.objects.find(o => o.id === 'garden-gate') || {}).geometry?.position || null;

const closed = fp => [...fp, fp[0]];
function nearTree(p, r) { return trees.some(t => dist2d(p, t) < r); }
function pointBlocked(p, ignoreIds = []) {
  for (const b of blds) {
    if (ignoreIds.includes(b.id)) continue;
    if (pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 1.2) return true;
  }
  if (nearTree(p, 3.6)) return true;
  for (const w of waters) if (pointInPoly(p, w) || distToPolyline(p, closed(w)) < 1.0) return true;
  return false;
}
function rayBlocked(p, q, ignoreIds = [], ignoreWall = false) {
  const L = dist2d(p, q), n = Math.max(2, Math.ceil(L / 0.8));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (const b of blds) {
      if (ignoreIds.includes(b.id)) continue;
      if (pointInPoly(s, b.fp) || distToPolyline(s, closed(b.fp)) < 1.0) return true;
    }
    // 树冠球体（心高 ~0.65h，半径 3.2）：相机高 4-9m 正穿冠层
    if (nearTree(s, 3.2)) return true;
    if (!ignoreWall) for (const [a, b2] of wallSegs) if (distToSeg2(s, a, b2) < 0.5) return true;
    if (gate && dist2d(s, gate) < 6.5) return true; // 门楼 GLB 实体不穿行
  }
  return false;
}
function distToSeg2(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

// 在 base 方向 ±120° 内每 10° 采样距离 12..26m、高 4..9m，选第一个相机与视线都干净的点
function findCam(target, targetId, baseDir, { dist = 17, h = 6, ignoreWall = false } = {}) {
  for (let da = 0; da <= 12; da++) {
    for (const sgn of da === 0 ? [1] : [1, -1]) {
      const ang = Math.atan2(baseDir[0], baseDir[1]) + sgn * da * Math.PI / 18;
      const dir = [Math.sin(ang), Math.cos(ang)];
      for (const dd of [dist, dist + 4, dist - 3, dist + 8]) {
        for (const hh of [h, h + 1.5, h - 1, h + 3]) {
          const cam = [target[0] + dir[0] * dd, hh, target[1] + dir[1] * dd];
          if (pointBlocked([cam[0], cam[2]], [targetId])) continue;
          if (rayBlocked([cam[0], cam[2]], target, [targetId], ignoreWall)) continue;
          return { p: [+cam[0].toFixed(1), hh, +cam[2].toFixed(1)], t: [+target[0].toFixed(1), 2.6, +target[1].toFixed(1)], angleDeg: sgn * da * 10, dist: dd };
        }
      }
    }
  }
  return null;
}

const named = n => layout.objects.find(o => o.name === n);
const results = {};
for (const n of ['三穗堂', '点春堂', '会景楼', '玉华堂', '打唱台', '得月楼']) {
  const o = named(n);
  const fp = o.geometry.footprint;
  results[n] = findCam(centroid(fp), o.id, o.facade.dir, { dist: 18, h: 6 });
}
// 听涛阁：目标=端头阁（带宽端），朝向取带的西法线（园内侧）
{
  const o = named('听涛阁');
  const line = o.geometry.polyline;
  const end = o.endPavilion.end === 1 ? line[line.length - 1] : line[0];
  const nb = o.endPavilion.end === 1 ? line[line.length - 2] : line[1];
  const dx = end[0] - nb[0], dz = end[1] - nb[1];
  const l = Math.hypot(dx, dz) || 1;
  results['听涛阁'] = findCam([end[0] + dx / l * 1.2, end[1] + dz / l * 1.2], o.id, [-dz / l, dx / l], { dist: 16, h: 7 });
}
// 龙墙漏窗段 + 龙头（目标是墙特征，忽略墙自身挡线）
{
  const wall = layout.objects.find(o => o.id === 'garden-wall');
  const lat = wall.geometry.lattice;
  let run = [];
  for (let i = 0; i < lat.length; i++) {
    const grp = [lat[i]];
    for (let j = i + 1; j < lat.length; j++) {
      if (Math.hypot(lat[j].x - grp[grp.length - 1].x, lat[j].z - grp[grp.length - 1].z) < 7.2) grp.push(lat[j]);
    }
    if (grp.length > run.length) run = grp;
  }
  const mid = run[Math.floor(run.length / 2)];
  // 朝园内的法线：墙方向 (sin,cos) 的法线取指向 garden 质心一侧
  const gz = centroid(layout.zones.garden.polygon);
  const wx = Math.sin(mid.rotY), wz = Math.cos(mid.rotY);
  const n1 = [wz, -wx], n2 = [-wz, wx];
  const probe = [mid.x + n1[0] * 3, mid.z + n1[1] * 3];
  const dir = pointInPoly(probe, layout.zones.garden.polygon) ? n1 : n2;
  results['龙墙漏窗'] = findCam([mid.x, mid.z], 'garden-wall', dir, { dist: 13, h: 4.5, ignoreWall: true });
  const head = layout.objects.find(o => o.id === 'garden-wall-dragonhead').geometry;
  const hx = Math.sin(head.rotY), hz = Math.cos(head.rotY);
  const hdir = pointInPoly([head.x + hz * 3, head.z - hx * 3], layout.zones.garden.polygon) ? [hz, -hx] : [-hz, hx];
  results['龙头'] = findCam([head.x, head.z], 'garden-wall-dragonhead', hdir, { dist: 11, h: 4.2, ignoreWall: true });
}

console.log(JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(OUT, 'g2-shot-cams.json'), JSON.stringify(results, null, 1));
