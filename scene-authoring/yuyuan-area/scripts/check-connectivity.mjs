// G1 v3 连通检查：实际通路带宽、严格接口连续、桥岸/高差过渡硬校验。
// v2 复检暴露的宽松点全部收紧：
//   - 通路不再只查中心线无碰撞：按 0.5m 采样实测中心线净距，净距×2=实际可通行宽，
//     对目标宽（园路 1.5m / 商业 3.0m / 庙轴 3.0m）分级；<0.9m 为硬违规。
//   - 接续段取消 <6m 间隙容忍：同高铺面接口要求间隙 ≤0.1m 且高差 ≤0.02m，
//     否则必须有台阶/桥件覆盖（"隐藏恢复"式的跳跃 PASS 不再成立）。
//   - 落水采样必须被桥走廊覆盖，且桥两端着岸、端部接实铺面、高差>0.1m 处有台阶过渡；
//     routeConstraint 不再自动豁免——存在受限段则整体状态为 partial 如实呈现。
//   - R2 街宽按实测净距与设计宽取小；OSM 源图重叠（建筑/墙压路带）如实测值单列源冲突。
//   - R3 在庙区刚体调整采用后的位姿上复检：墙开口、轴线净距、山门临路。
// 硬违规 exit 1。输出 out-v3 -> OUT_DIR/connectivity.json。
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInPoly, dist2d, distToPolyline, distToSeg, centroid } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const byId = new Map(layout.objects.map(o => [o.id, o]));
const audit = layout.gardenRouteAudit || { segments: [] };
const reg = layout.templeRegistration || null;

const hardViolations = [];
const water = layout.objects.filter(o => o.kind === 'water' && o.geometry.footprint)
  .map(o => ({ id: o.id, fp: o.geometry.footprint }));
const buildings = layout.objects.filter(o =>
  ['outerBuilding', 'bazaarBlock', 'tower', 'hall', 'pavilion', 'xuan', 'waterside', 'stage'].includes(o.kind) && o.geometry.footprint)
  .flatMap(o => (o.geometry.groundFootprints||[o.geometry.footprint]).map(fp=>({id:o.id,name:o.name,fp})));
const wallSegs = layout.objects.filter(o => o.kind === 'wall' && o.geometry.segments)
  .flatMap(o => o.geometry.segments.map((s, i) => ({ wall: o.id, seg: s })));
const bridges = layout.objects.filter(o => ['bridge', 'zigzagBridge'].includes(o.kind))
  .map(o => ({ id: o.id, pts: o.geometry.polyline, w: o.width || 2.2, deckY: o.deckY || 0.5 }));
const stepsObjs = layout.objects.filter(o => o.kind === 'steps' && o.geometry.position);
const routeConstraints = layout.objects.filter(o => o.kind === 'routeConstraint');

const bridgeCover = (p) => bridges.some(br => distToPolyline(p, br.pts) <= br.w / 2 + 0.4);
// 采样点处通行净距：建筑+墙+水面（桥面走廊上的水面不算阻碍）
const clearanceAt = (p, excludeIds = new Set()) => {
  let d = Infinity, obj = null, kind = null;
  const inWater = water.some(w => pointInPoly(p, w.fp));
  const covered = inWater && bridgeCover(p);
  if (inWater && !covered) { return { d: 0, obj: water.find(w => pointInPoly(p, w.fp)).id, kind: 'water-unbridged' }; }
  if (!covered) {
    for (const w of water) {
      const dd = pointInPoly(p, w.fp) ? 0 : distToPolyline(p, [...w.fp, w.fp[0]]);
      if (dd < d) { d = dd; obj = w.id; kind = 'water'; }
    }
  }
  for (const b of buildings) {
    if (excludeIds.has(b.id)) continue;
    const dd = pointInPoly(p, b.fp) ? 0 : distToPolyline(p, [...b.fp, b.fp[0]]);
    if (dd < d) { d = dd; obj = b.id; kind = 'building'; }
  }
  for (const w of wallSegs) {
    const dd = distToSeg(p, w.seg[0], w.seg[1]);
    if (dd < d) { d = dd; obj = w.wall; kind = 'wall'; }
  }
  return { d, obj, kind };
};
const transitionAt = (p, yA, yB) => stepsObjs.some(s => {
  const [sx, sz] = s.geometry.position;
  if (Math.hypot(sx - p[0], sz - p[1]) > 2.2) return false;
  const lo = Math.min(s.geometry.bottomY, s.geometry.topY) - 0.08;
  const hi = Math.max(s.geometry.bottomY, s.geometry.topY) + 0.08;
  return lo <= Math.min(yA, yB) && hi >= Math.max(yA, yB);
});
const segSamples = function* (pts, step) {
  for (let i = 0; i < pts.length - 1; i++) {
    const L = dist2d(pts[i], pts[i + 1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
      yield [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n];
    }
  }
};

// ---------- R1 豫园巡看线（v3 A* 路由后的实际折线） ----------
const r1 = {
  route: 'R1 豫园门楼→三穗堂→大假山/中部池路→玉华堂/内园',
  targetWidthM: 1.5, designPathWidthM: 2.0, segments: [], narrowSections: [], status: null,
};
const r1Chain = ['path-gate-sansuitang', ...layout.objects.filter(o => o.id.startsWith('gpath-')).map(o => o.id).sort((a, b) => +a.slice(6) - +b.slice(6))];
let prevEnd = null, prevY = null, prevId = null;
let r1Narrow = 0, r1Blocked = 0;
for (const id of r1Chain) {
  const o = byId.get(id);
  if (!o) continue;
  const pts = o.geometry.polyline;
  const auditSeg = audit.segments.find(s => s.segment === id) || {};
  const allowIds = new Set(auditSeg.allowIds || []);
  let minC = Infinity, pinch = null, pinchKind = null, waterSamples = 0, uncoveredWater = 0, samples = 0, throughBuilding = null;
  for (const p of segSamples(pts, 0.5)) {
    samples++;
    const { d, obj, kind } = clearanceAt(p, allowIds);
    if (kind === 'water-unbridged') uncoveredWater++;
    if (kind === 'water' && d === 0) waterSamples++;
    if (kind === 'building' && d === 0 && !throughBuilding) throughBuilding = obj;
    if (d < minC) { minC = d; pinch = obj; pinchKind = kind; }
  }
  const clearWidthM = +(2 * minC).toFixed(2);
  const effectiveWidthM = +Math.min(clearWidthM, o.width || 2).toFixed(2);
  if (throughBuilding) hardViolations.push(`R1 ${id}: 路线中途进入非端点建筑 ${throughBuilding}`);
  if (uncoveredWater > 0) hardViolations.push(`R1 ${id}: ${uncoveredWater} 个采样点落水且无桥覆盖`);
  let classification = 'ok';
  if (effectiveWidthM < 0.9) { classification = 'blocked'; r1Blocked++; hardViolations.push(`R1 ${id}: 实际可通行宽 ${effectiveWidthM}m < 0.9m（卡点 ${pinch}/${pinchKind}）`); }
  else if (effectiveWidthM < 1.5) { classification = 'narrow'; r1Narrow++; r1.narrowSections.push({ segment: id, effectiveWidthM, clearWidthM, pinch, pinchKind, reason: pinchKind === 'water' ? 'mapped water bank' : pinchKind === 'wall' ? 'design wall alignment' : 'source building spacing (OSM footprints)' }); }
  // 严格接口：同高 ≤0.1m；不满足须有台阶/桥过渡
  let continuity = null;
  if (prevEnd) {
    const gap = dist2d(prevEnd, pts[0]);
    const dy = Math.abs((o.height ?? 0.05) - prevY);
    if (gap <= 0.1 && dy <= 0.02) continuity = { to: prevId, gapM: +gap.toFixed(2), heightDiffM: +dy.toFixed(2), ok: true };
    else if (transitionAt(pts[0], o.height ?? 0.05, prevY)) continuity = { to: prevId, gapM: +gap.toFixed(2), heightDiffM: +dy.toFixed(2), ok: true, via: 'steps' };
    else { continuity = { to: prevId, gapM: +gap.toFixed(2), heightDiffM: +dy.toFixed(2), ok: false }; hardViolations.push(`R1 ${id}: 与 ${prevId} 接口间隙 ${gap.toFixed(2)}m / 高差 ${dy.toFixed(2)}m 且无过渡件`); }
  }
  r1.segments.push({
    id, lengthM: +pts.reduce((s, p, i) => (i ? s + dist2d(pts[i - 1], p) : 0), 0).toFixed(1),
    designWidthM: o.width, baseY: o.height ?? 0.05, effectiveWidthM, clearWidthM,
    minClearanceM: +minC.toFixed(2), pinchObstacle: pinch, pinchKind,
    waterSamples, samples, classification, continuity,
    routeMarginM: auditSeg.marginUsedM ?? null, routeStatus: auditSeg.status || null,
  });
  prevEnd = pts[pts.length - 1]; prevY = o.height ?? 0.05; prevId = id;
}
r1.status = r1Blocked || r1.segments.some(s => s.routeStatus === 'unresolved-constraint') ? 'fail-or-constrained'
  : r1Narrow > 0 ? 'pass-with-narrow-sections' : 'pass';

// R2 must have a physical swept route. No fallback to arbitrary plazas or graph reachability.
try { execFileSync('python3',['-X','utf8',path.join(ROOT,'scripts/check-commercial-route.py')],{env:process.env,stdio:'pipe'}); }
catch(e) { hardViolations.push('R2: 3m swept route verification failed'); }
const commercialFile=path.join(OUT,'commercial-route.json');
const physical=fs.existsSync(commercialFile)?JSON.parse(fs.readFileSync(commercialFile,'utf8')):{pass:false,routes:[],errors:['missing route evidence']};
const r2={route:'R2 主街/两广场/楼下老街/九曲桥广场',targetWidthM:3,status:physical.pass?'pass':'fail',connectedStartToEnd:physical.pass,
 segments:physical.routes,sourceWidthConflicts:[],method:physical.method,errors:physical.errors};
if(!physical.pass)hardViolations.push(...physical.errors);

// ---------- R3 庙区轴线（刚体调整采用后的位姿复检） ----------
const tInst = Object.fromEntries(['shanmen', 'yimen', 'dadian', 'houdian'].map(a => [a, layout.instances.find(i => i.id === `temple-${a}`)]));
const r3 = {
  route: 'R3 城隍庙山门→仪门→大殿院→后院',
  targetWidthM: 3.0, segments: [], entrance: null, status: null,
};
const templeWall = byId.get('temple-wall');
const templeWallSegs = templeWall ? templeWall.geometry.segments : [];
function segSeg(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
const seq = [['山门', tInst.shanmen], ['仪门', tInst.yimen], ['大殿庭院', tInst.dadian], ['后殿/后院', tInst.houdian]];
for (let i = 0; i < seq.length - 1; i++) {
  const [na, A] = seq[i], [nb, B] = seq[i + 1];
  if (!A || !B) continue;
  const line = [A.position, B.position];
  let minC = Infinity, pinch = null;
  for (const p of segSamples(line, 0.5)) {
    const { d, obj } = clearanceAt(p);
    if (d < minC) { minC = d; pinch = obj; }
  }
  const clearWidthM = +(2 * minC).toFixed(2);
  const crossesWall = templeWallSegs.some(([w1, w2]) => segSeg(line[0], line[1], w1, w2));
  if (crossesWall) hardViolations.push(`R3 轴线 ${na}→${nb} 与院墙段相交（墙开口未覆盖）`);
  if (clearWidthM < 0.9) hardViolations.push(`R3 轴线 ${na}→${nb} 实际可通行宽 ${clearWidthM}m < 0.9m`);
  r3.segments.push({
    from: na, to: nb, lengthM: +dist2d(A.position, B.position).toFixed(1),
    baseY: 0.0, clearWidthM, minClearanceM: +minC.toFixed(2), pinchObstacle: pinch,
    classification: clearWidthM >= 3.0 ? 'ok' : clearWidthM >= 0.9 ? 'narrow' : 'blocked',
    wallCrossing: crossesWall,
    pose: reg ? `templeRegistration.adopted=${reg.adopted ? reg.adopted.name : 'n/a'}` : 'unregistered',
  });
}
{
  const sm = tInst.shanmen ? tInst.shanmen.position : null;
  if (sm) {
    let wallD = Infinity;
    for (const [w1, w2] of templeWallSegs) wallD = Math.min(wallD, distToSeg(sm, w1, w2));
    let roadD = Infinity, roadName = null;
    for (const o of layout.objects) {
      if (o.kind !== 'road' || !o.geometry.polyline) continue;
      const d = distToPolyline(sm, o.geometry.polyline);
      if (d < roadD) { roadD = d; roadName = o.name || o.id; }
    }
    r3.entrance = {
      shanmenPosition: sm.map(v => +v.toFixed(1)),
      nearestWallSegmentM: +wallD.toFixed(1),
      wallOpenNearAxis: wallD >= 1.0,
      wallOpenRule: 'nearest wall segment >=1.0m from the shanmen point = a >=2m opening spans the axis (opening is cut by the layout at the rigid-fit-adjusted shanmen axis)',
      approachRoad: roadName, approachRoadDistM: +roadD.toFixed(1),
      note: '墙开口锚随刚体调整联动（layout temple-wall 以调整后山门轴为开口中心）；临路距离为山门到最近道路折线',
    };
    if (wallD < 1.0) hardViolations.push(`R3: 山门位距最近院墙段仅 ${wallD.toFixed(1)}m，南轴开口缺失/被堵`);
  }
}
r3.status = r3.segments.every(s => s.classification !== 'blocked') && r3.entrance && r3.entrance.wallOpenNearAxis ? 'pass' : 'fail';

// ---------- 桥梁：着岸 + 端部接实铺面 + 高差过渡 ----------
const walkSurfaces = layout.objects.filter(o =>
  (['path', 'paving', 'road'].includes(o.kind) && o.geometry.polyline) ||
  (o.kind === 'plaza' && o.geometry.footprint));
const surfaceNear = (p) => {
  let best = null, bd = Infinity;
  for (const o of walkSurfaces) {
    const line = o.geometry.polyline || [...o.geometry.footprint, o.geometry.footprint[0]];
    const d = distToPolyline(p, line);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { obj: best.id, kind: best.kind, distM: +bd.toFixed(1), y: best.height ?? (best.kind === 'plaza' ? 0.04 : 0.02) } : null;
};
const bridgeChecks = bridges.map(br => {
  const ends = [br.pts[0], br.pts[br.pts.length - 1]].map((p, i) => {
    const surf = surfaceNear(p);
    const land = !water.some(w => pointInPoly(p, w.fp));
    const heightDiffM = surf ? +(br.deckY - surf.y).toFixed(2) : null;
    let transition = 'no-surface';
    if (surf) transition = Math.abs(heightDiffM) <= 0.1 ? 'level'
      : (stepsObjs.some(s => {
        const [sx, sz] = s.geometry.position;
        if (Math.hypot(sx - p[0], sz - p[1]) > 2.2) return false;
        const lo = Math.min(s.geometry.bottomY, s.geometry.topY) - 0.08;
        const hi = Math.max(s.geometry.bottomY, s.geometry.topY) + 0.08;
        return lo <= Math.min(br.deckY, surf.y) && hi >= Math.max(br.deckY, surf.y);
      }) ? 'steps' : 'MISSING');
    if (!land) hardViolations.push(`桥 ${br.id} ${i === 0 ? '起点' : '终点'} 未着岸`);
    if (!surf || surf.distM > 3) hardViolations.push(`桥 ${br.id} ${i === 0 ? '起点' : '终点'} 未接实铺面（最近步行面 ${surf ? surf.distM + 'm' : '无'}）`);
    if (transition === 'MISSING') hardViolations.push(`桥 ${br.id} ${i === 0 ? '起点' : '终点'} 高差 ${heightDiffM}m 无台阶过渡`);
    return { end: i === 0 ? 'start' : 'end', onLand: land, surface: surf, heightDiffM, transition };
  });
  return { id: br.id, deckY: br.deckY, ends };
});

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'Review repair: R2 exact swept-area verification; R1/R3 retained geometry checks. 原 G1 v3 连通检查：带宽实测（中心线净距×2 对目标宽）、同高接口 ≤0.1m、落水必桥覆盖、桥端着岸接面高差过渡；平面/几何级，不接 Rapier，非人工试玩',
  widthTargets: { gardenPathM: 1.5, commercialWalkM: 3.0, templeAxisM: 3.0 },
  blockedThresholdM: 0.9,
  routes: [r1, r2, r3],
  bridges: bridgeChecks,
  routeConstraints: routeConstraints.map(o => ({ id: o.id, segmentRef: o.segmentRef, reason: o.reason })),
  gardenRouteAudit: audit,
  templeRegistration: reg ? {
    adopted: reg.adopted, meanResidualM: reg.meanResidualM, rawMeanCentroidDeltaM: reg.rawMeanCentroidDeltaM,
    unresolved: reg.unresolved, moduleRoadClearanceMinM: Math.min(...reg.moduleRoadClearance.map(m => m.clearToPublicRoadM)),
  } : null,
  hardViolations,
};
fs.writeFileSync(path.join(OUT, 'connectivity.json'), JSON.stringify(report, null, 1));
console.log('connectivity v3:', hardViolations.length ? 'VIOLATIONS' : 'OK');
console.log('  R1:', r1.status, '| segments', r1.segments.length, '| narrow', r1Narrow,
  '| widths', r1.segments.map(s => `${s.id}:${s.effectiveWidthM}${s.classification === 'ok' ? '' : '*'}`).join(' '));
console.log('  R2:',r2.status,'| verified swept routes',r2.segments.length);
console.log('  R3:', r3.status, '| segments', r3.segments.length, '| entrance', r3.entrance ? `wall ${r3.entrance.nearestWallSegmentM}m / road ${r3.entrance.approachRoadDistM}m` : 'n/a',
  reg ? `| temple pose: ${reg.adopted.name} (mean residual ${reg.meanResidualM}m, was ${reg.rawMeanCentroidDeltaM}m raw)` : '');
console.log('  bridges:', bridgeChecks.map(b => `${b.id}[${b.ends.map(e => e.transition).join(',')}]`).join(' '));
if (routeConstraints.length) console.log('  routeConstraints (partial):', routeConstraints.map(o => o.segmentRef).join(', '));
for (const v of hardViolations) console.log('  -', v);
if (hardViolations.length) process.exit(1);
