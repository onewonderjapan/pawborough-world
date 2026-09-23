// C：商业区审计 + food_socket 清单导出。
// 1) facadeBay 逐个核验：真贴父建筑临街边、不被其它建筑轮廓埋没、不在水里、街段归属成立；
//    只能由大楼临街面形成的街段如实记录（不再摆店屋）。
// 2) 摊位 43 / 座凳 8 分列与组团核对。
// 3) food-sockets.json：ID/父摊位/世界姿态/台面高/可用尺寸/用途标签（对接预留，未接入食品模型）。
// 输出 out-v2/commerce-audit.json 与 out-v2/food-sockets.json；发现假门面 exit 1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInPoly, dist2d, distToPolyline, distToSeg } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));

const buildings = layout.objects.filter(o => ['bazaarBlock', 'outerBuilding'].includes(o.kind) && o.geometry.footprint)
  .map(o => ({ id: o.id, name: o.name, fp: o.geometry.footprint, frontEdges: o.frontEdges || null }));
const waters = layout.objects.filter(o => o.kind === 'water').map(o => o.geometry.footprint);
const bays = layout.objects.filter(o => o.kind === 'facadeBay');
const shopAnchors = layout.objects.filter(o => o.kind === 'shopAnchor');
const stalls = layout.objects.filter(o => o.kind === 'stall');
const benches = layout.objects.filter(o => o.kind === 'bench');

const fakeBays = [];
const bayAudit = bays.map(b => {
  const [x, z] = b.geometry.position;
  const parent = buildings.find(bd => bd.id === b.parentBuilding);
  const inWater = waters.some(w => pointInPoly([x, z], w));
  // 是否嵌在别的建筑轮廓内部（贴背墙/被吞没）
  const hostBuilding = buildings.find(bd => pointInPoly([x, z], bd.fp));
  const embedded = hostBuilding && hostBuilding.id !== b.parentBuilding;
  // 与父建筑临街边的贴附：距父轮廓边的距离（应 ≤2m，bays 悬挑 0.16m 放在边外侧）
  let edgeDist = null;
  if (parent) {
    edgeDist = Math.min(...edgeLoop(parent.fp).map(([a, b2]) => distToSeg([x, z], a, b2)));
  }
  const ok = !!parent && !inWater && !embedded && edgeDist !== null && edgeDist <= 2.0;
  if (!ok) fakeBays.push({ id: b.id, parent: b.parentBuilding, inWater, embedded, edgeDist, host: hostBuilding ? hostBuilding.id : null });
  return { id: b.id, parent: b.parentBuilding, street: b.street || null, trade: b.trade, visible: ok, edgeDistM: edgeDist === null ? null : +edgeDist.toFixed(2) };
});
function* edges(fp) { for (let i = 0; i < fp.length; i++) yield [fp[i], fp[(i + 1) % fp.length]]; }
function edgeLoop(fp) { return [...edges(fp)]; }

// 街段汇总：每条街的 bay 数 + 父楼；该街是否已有店屋实例（若门面全由大楼形成则记录不摆店屋）
const byStreet = {};
for (const b of bayAudit) {
  const k = b.street || '(未归属)';
  (byStreet[k] ||= { street: k, bays: 0, parents: new Set(), visibleBays: 0 });
  byStreet[k].bays++;
  if (b.visible) byStreet[k].visibleBays++;
  if (b.parent) byStreet[k].parents.add(b.parent);
}
const shopUnitsByZoneStreet = {};
for (const a of shopAnchors) {
  const k = a.rowStreet || 'footprint-fitted';
  (shopUnitsByZoneStreet[k] ||= 0);
  shopUnitsByZoneStreet[k]++;
}
const streetSummaries = Object.values(byStreet).map(s => {
  const shopUnitsNear = shopAnchors.filter(a => a.rowStreet === s.street).length;
  return {
    street: s.street, bays: s.bays, visibleBays: s.visibleBays,
    parentBlocks: [...s.parents],
    shopUnitsOnSameStreet: shopUnitsNear,
    note: shopUnitsNear === 0 ? '该段门面由商城大楼临街面形成——不再摆店屋（如计划B要求如实记录）' : null,
  };
});

// 摊位/座凳
const stallAudit = {
  stalls: stalls.length, benches: benches.length,
  stallsWithFoodSockets: stalls.length,
  groups: [],
};
{
  // 组团：按摊位间 3.5m 内聚类
  const pos = stalls.map(s => s.geometry.position);
  const used = new Set();
  for (let i = 0; i < pos.length; i++) {
    if (used.has(i)) continue;
    const g = [i]; used.add(i);
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < pos.length; j++) {
        if (used.has(j)) continue;
        if (g.some(k => dist2d(pos[k], pos[j]) < 3.5)) { g.push(j); used.add(j); grew = true; }
      }
    }
    stallAudit.groups.push({ size: g.length, memberIds: g.map(k => stalls[k].id) });
  }
  stallAudit.groups.sort((a, b) => b.size - a.size);
}

// ---- G3 摊位放置校验：通路走廊 / 建筑净距 / 店面出入口 / 面向人流（设计弧点）----
const roadsAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'inputs', 'map-data.json'), 'utf8')).roads
  .filter(r => (r.priority ?? -1) >= 0);
const bzPoly = layout.zones.bazaar.polygon;
const bldFps = layout.objects.filter(o => ['bazaarBlock', 'outerBuilding'].includes(o.kind) && o.zone === 'bazaar' && o.geometry.footprint).map(o => o.geometry.footprint);
const bayPosList = bays.map(b => b.geometry.position);
const stallViolations = [];
function distToPolyPts(p, pts) {
  let bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSeg(p, pts[i], pts[i + 1]);
    if (d < bd) bd = d;
  }
  return bd;
}
for (const st of stalls) {
  const [x, z] = st.geometry.position;
  for (const r of roadsAll) {
    const margin = distToPolyPts([x, z], r.points) - (r.width || 3.5) / 2;
    if (margin < 1.2) stallViolations.push({ id: st.id, why: 'road-corridor', road: r.name || String(r.id), marginM: +margin.toFixed(2) });
  }
  for (const fp of bldFps) {
    if (pointInPoly([x, z], fp)) stallViolations.push({ id: st.id, why: 'in-building' });
    else if (distToPolyline([x, z], fp) < 1.0) stallViolations.push({ id: st.id, why: 'on-building-edge', dM: +distToPolyline([x, z], fp).toFixed(2) });
  }
  for (const bp of bayPosList) if (dist2d([x, z], bp) < 1.8) stallViolations.push({ id: st.id, why: 'blocks-shop-entrance', dM: +dist2d([x, z], bp).toFixed(2) });
  // 面向人流：rotY +Z 与 指向设计弧点 的方向一致
  if (st.faces && st.faces.refPoint) {
    const sdir = [Math.sin(st.geometry.rotY || 0), Math.cos(st.geometry.rotY || 0)];
    const dx = st.faces.refPoint[0] - x, dz = st.faces.refPoint[1] - z;
    const dl = Math.hypot(dx, dz) || 1;
    const dot = (sdir[0] * dx + sdir[1] * dz) / dl;
    if (dot < 0.9) stallViolations.push({ id: st.id, why: 'not-facing-traffic', dot: +dot.toFixed(3) });
  }
}

// ---- G3 街面连续性：主街+支街 frontage 覆盖率（开间/店屋/摊位均可形成界面）----
const NAMES = ['方浜中路', '旧校场路', '豫园老街', '粮厅路', '九曲桥广场', '中心广场', '黄金广场'];
const streetFrontage = [];
for (const r of roadsAll.filter(r => NAMES.includes(r.name))) {
  const pts = r.points;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += dist2d(pts[i], pts[i + 1]);
  const reach = r.width / 2 + 5;
  const step = 2;
  let covN = 0, totN = 0, gapStart = null, maxGap = 0;
  const gaps = [];
  for (let s2 = 0; s2 <= total; s2 += step) {
    let rem = s2, p = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = dist2d(pts[i], pts[i + 1]);
      if (rem <= L || i === pts.length - 2) { const t = Math.min(1, rem / (L || 1)); p = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; break; }
      rem -= L;
    }
    if (distToPolyline(p, bzPoly) > 18) { // 出核心区即切断 gap 记录（不把区外空白连入 maxGap）
      if (gapStart !== null) { gaps.push([gapStart, s2]); maxGap = Math.max(maxGap, s2 - gapStart); gapStart = null; }
      continue;
    }
    totN++;
    const covered = bays.some(b => dist2d(b.geometry.position, p) < reach)
      || shopAnchors.some(a => a.rowStreet === r.name && dist2d(a.geometry.position, p) < reach - 1)
      || stalls.some(st => dist2d(st.geometry.position, p) < 8);
    if (covered) { covN++; if (gapStart !== null) { gaps.push([gapStart, s2]); maxGap = Math.max(maxGap, s2 - gapStart); gapStart = null; } }
    else if (gapStart === null) gapStart = s2;
  }
  if (gapStart !== null) { gaps.push([gapStart, total]); maxGap = Math.max(maxGap, total - gapStart); }
  if (totN > 0) streetFrontage.push({
    street: r.name, osmWay: r.id, widthM: r.width, sampledM: totN * step,
    coverage: +(covN / totN).toFixed(3), maxGapM: +maxGap.toFixed(0),
    gapsOver15M: gaps.filter(g => g[1] - g[0] > 15).map(g => [g[0], g[1]]),
  });
}

// food sockets（世界姿态 = layout slots 本地偏移经 rotY 变换；本批不接食品模型）
const sockets = [];
for (const st of stalls) {
  const [x, z] = st.geometry.position;
  const rot = st.geometry.rotY || 0;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const world = (lx, ly, lz) => [+(x + lx * cs + lz * sn).toFixed(3), +ly.toFixed(3), +(z - lx * sn + lz * cs).toFixed(3)];
  const slotList = (st.geometry && st.geometry.slots) || [];
  if (!slotList.length) stallViolations.push({ id: st.id, why: 'no-socket-slots' });
  for (const sl of slotList) {
    sockets.push({
      id: `food-socket-${st.id}-${sl.slot}`, stall: st.id, zone: st.zone,
      foodUse: st.foodUse || null, cluster: st.cluster ?? null,
      worldPosition: world(sl.lx, sl.ly, sl.lz), worldRotY: +rot.toFixed(4),
      surfaceHeightM: sl.ly, usableSizeM: sl.sizeM,
      purpose: sl.purpose,
      status: 'reserved — awaiting owner food model catalog; NOT connected this batch',
    });
  }
}
fs.writeFileSync(path.join(OUT, 'food-sockets.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: '对接清单：worldPosition 为 GLB 世界系 (x,y,z)，Y-up；插槽=layout stall.geometry.slots（设计真值），四类用途（蒸煮/篮笼叠、烤制/炉面、饮品/杯架端、点心/展示柜搁板、共用托盘）；机主食品模型接入走 G5，本轮只预留',
  count: sockets.length,
  sockets,
}, null, 1));

const audit = {
  generatedAt: new Date().toISOString(),
  facadeBays: { total: bays.length, visible: bayAudit.filter(b => b.visible).length, fake: fakeBays },
  streets: streetSummaries,
  shopAnchors: { total: shopAnchors.length, byStreet: shopUnitsByZoneStreet },
  stallsAndBenches: { stalls: stalls.length, benches: benches.length, stallGroups: stallAudit.groups.length },
  stallGroups: stallAudit.groups,
  stallPlacement: {
    scheme: (layout.stallPlacement || {}).scheme || 'n/a',
    foodUseCounts: stalls.reduce((m, st) => { m[st.foodUse] = (m[st.foodUse] || 0) + 1; return m; }, {}),
    violations: stallViolations,
  },
  streetFrontage,
  commerceCounts: layout.counts.commerce,
  note: '16 楼壳/175 有效开间/30 店屋实例不合并计数（G3 保持不变）；摊位 43 与座凳 8 分列；组团数沿街重排后如实聚类（9 团，v2 为 8 团）',
};
fs.writeFileSync(path.join(OUT, 'commerce-audit.json'), JSON.stringify(audit, null, 1));
console.log('commerce audit: bays', audit.facadeBays.visible, '/', audit.facadeBays.total,
  'visible | streets', streetSummaries.length, '| stall groups', stallAudit.groups.length,
  '| sockets', sockets.length);
if (fakeBays.length) { console.log('FAKE BAYS:', JSON.stringify(fakeBays, null, 1)); process.exit(1); }
if (stallViolations.length) { console.log('STALL VIOLATIONS:', JSON.stringify(stallViolations, null, 1)); process.exit(1); }
console.log('streetFrontage:', streetFrontage.map(f => `${f.street}/${f.osmWay} ${Math.round(f.coverage * 100)}% maxGap ${f.maxGapM}m`).join(' | '));
