// 任务A：唯一布局表 layout.json 生成器。
// 输入：../inputs/map-data.json（唯一坐标底图）+ ../inputs/overpass.json（名称/屋式/层数回填）
// 输出：out/layout.json —— 3D 场景、2D 标注图、分区清单、coverage 全部从这里派生。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  bbox, polyArea, centroid, pointInPoly, polyIntersectsPoly, vertsInside,
  dist2d, distToSeg, distToPolyline, principalAxis, offsetPoly,
} from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'inputs');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
fs.mkdirSync(OUT, { recursive: true });

const map = JSON.parse(fs.readFileSync(path.join(IN, 'map-data.json'), 'utf8'));
const ov = JSON.parse(fs.readFileSync(path.join(IN, 'overpass.json'), 'utf8'));
const ORIGIN = map.originWgs84;
const LX = 111320 * Math.cos(ORIGIN[1] * Math.PI / 180);
const LY = 111320;
const project = (p) => [(p.lon - ORIGIN[0]) * LX, -(p.lat - ORIGIN[1]) * LY];

// overpass way 索引：id -> {tags, geo}
const ovWay = new Map();
for (const e of ov.elements) {
  if (e.type === 'way' && Array.isArray(e.geometry)) {
    ovWay.set(e.id, { tags: e.tags || {}, geo: e.geometry.map(project) });
  }
}
const tagsOf = (id) => ovWay.get(id)?.tags || {};
const geoOf = (id) => ovWay.get(id)?.geo || null;

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const zones = {};
for (const f of map.features) zones[f.id] = { name: f.name, polygon: f.points, provenance: `OSM way boundary from map-data features; area anchor only` };
// 水池带（九曲桥/湖心亭水面）：不在任何三区多边形内，按边界独立归区
const pondWater = map.water.find(w => w.id === 62072388);
zones.pond = {
  name: '九曲桥水池带（独立归区）',
  polygon: pondWater.points,
  provenance: 'water way 62072388 footprint; not inside garden/temple/bazaar polygons — independent per source boundary',
};

const objects = [];
const layoutExtras = {}; // 本批新增的结构化对账块（庙区配准/通路审计等）合并进顶层输出

const instances = [];
const labels = [];
const emit = (o) => { objects.push(o); return o; };

// 街道索引（提前定义：墙避让/门面/店屋共用）
const roadPolys = map.roads.filter(r => r.priority >= 0).map(r => r.points);
// 门面/店屋只认真正能形成界面的街：主次干道与有名字的步行街，排除 3.5m 小巷
const FACADE_STREET_NAMES = ['豫园老街', '粮厅路', '九曲桥广场', '中心广场', '黄金广场'];
const facadeRoads = map.roads.filter(r => r.width >= 5 || FACADE_STREET_NAMES.includes(r.name)).map(r => r.points);
let facadeId = 0;
const facadeStats = { bays: 0, shophouses: 0, segments: [] };

// ---------- zone 归属：多边形相交，不只看中心点 ----------
const ZONE_ORDER = ['garden', 'temple', 'bazaar'];
function assignZone(poly) {
  let best = null, bestN = 0;
  for (const z of ZONE_ORDER) {
    const n = vertsInside(poly, zones[z].polygon) + (polyIntersectsPoly(poly, zones[z].polygon) ? 0.5 : 0);
    if (n > bestN) { bestN = n; best = z; }
  }
  return best; // null = 外围
}

// ---------- 地面 ----------
emit({
  id: 'ground', zone: 'outer', kind: 'ground', lod: 'L0', disposition: 'rendered',
  geometry: { bounds: map.bounds }, height: 0,
  sources: { mapData: 'bounds' }, confidence: 'design base plane',
});

// ---------- 道路（155 段全部渲染；广场类闭合作填充） ----------
const PLAZA_NAMES = ['九曲桥广场', '中心广场', '黄金广场'];
let plazaCount = 0;
for (const r of map.roads) {
  // 九曲桥 footway 与桥体重复：由 jiuqu-bridge 专门渲染
  if (r.id === 62072384) {
    emit({
      id: `road-${r.id}`, zone: 'pond', kind: 'road', name: r.name || '九曲桥', lod: '-', disposition: 'merged-into-bridge',
      reason: 'pedestrian way 62072384 duplicates the nine-bend bridge; rendered once as jiuqu-bridge with real zigzag geometry',
      geometry: { polyline: r.points, width: r.width, priority: r.priority }, height: 0.02, skipRender: true,
      sources: { osmWay: r.id }, confidence: 'centerline contemporary',
    });
    continue;
  }
  if (PLAZA_NAMES.includes(r.name) && r.points.length > 2 && polyArea(r.points) > 120) {
    const z = assignZone(r.points) || 'outer';
    emit({
      id: `plaza-${r.id}`, zone: z, kind: 'plaza', name: r.name, lod: z === 'outer' ? 'L0' : 'L1',
      disposition: 'rendered', geometry: { footprint: r.points }, height: 0.04,
      sources: { osmWay: r.id }, confidence: 'contemporary OSM pedestrian polygon',
    });
    plazaCount++;
    continue;
  }
  emit({
    id: `road-${r.id}`, zone: 'outer', kind: 'road', name: r.name || null, lod: 'L0', disposition: 'rendered',
    geometry: { polyline: r.points, width: r.width, priority: r.priority }, height: 0.02,
    sources: { osmWay: r.id, provenance: r.provenance }, confidence: 'centerline contemporary; width design value',
  });
}

// ---------- 水面（14 全渲染；归区按边界） ----------
for (const w of map.water) {
  const c = centroid(w.points);
  let zone = assignZone(w.points);
  if (!zone) zone = w.id === 62072388 ? 'pond' : 'outer';
  emit({
    id: `water-${w.id}`, zone, kind: 'water', name: w.id === 62072388 ? '九曲桥水池' : null, lod: zone === 'outer' ? 'L0' : 'L1',
    disposition: 'rendered', geometry: { footprint: w.points }, height: -0.14,
    sources: { osmWay: w.id }, confidence: 'contemporary OSM polygon',
    inferences: zone === 'pond' ? ['pool placed per its own OSM boundary; outside all three zone polygons'] : [],
  });
}

// ---------- 建筑轮廓归区 ----------
const gardenNamed = {}; // name -> object（后续连线用）
const byZone = { garden: [], temple: [], bazaar: [], outer: [] };
const skipped = [];
for (const b of map.buildings) {
  const t = tagsOf(b.id);
  const zone = assignZone(b.points);
  const entry = { b, t, zone: zone || 'outer' };
  byZone[entry.zone].push(entry);
}

// ---------- 商业街沿街店屋置换（商城相连外围商业街的小轮廓 -> 店屋底模实例） ----------
const SHOP_UNITS = [
  { module: 'shop-01-narrow', w: 5.4, d: 6.4, file: 'shop-01-narrow/model.glb' },
  { module: 'shop-02-double', w: 7.2, d: 6.4, file: 'shop-02-double/model.glb' },
  { module: 'shop-03-threebay', w: 9.6, d: 6.4, file: 'shop-03-threebay/model.glb' },
  { module: 'shop-04-recess', w: 6.4, d: 6.8, file: 'shop-04-recess/model.glb' },
  { module: 'shop-05-corner', w: 7.2, d: 7.2, file: 'shop-05-corner/model.glb' },
  { module: 'shop-06-endcap', w: 6.0, d: 6.4, file: 'shop-06-endcap/model.glb' },
];
const SHOP_ROOT = path.join(ROOT, 'resources/shops');
const SHOP_SHA = Object.fromEntries(SHOP_UNITS.map(u => {
  const m = JSON.parse(fs.readFileSync(path.join(SHOP_ROOT, u.module, 'measurements.json'), 'utf8'));
  return [u.module, { sha256: m.sha256, tris: m.triangles, design: m.design }];
}));
const TRADE = map.tradeCategories;
const PERIMETER_STREETS = map.roads.filter(r => ['旧校场路', '方浜中路', '侯家路', '昼锦路', '福佑路'].includes(r.name));
const replacedIds = new Set();
let replaceSeq = 0;
const replaceStats = [];
for (const st of PERIMETER_STREETS) {
  let made = 0;
  for (const { b, t } of byZone.outer) {
    if (replacedIds.has(b.id)) continue;
    const area = Math.abs(polyArea(b.points));
    if (area > 420) continue;
    // 最长边作临街边
    let bestEdge = null, bestLen = 0;
    for (let i = 0; i < b.points.length; i++) {
      const a = b.points[i], c = b.points[(i + 1) % b.points.length];
      const l = dist2d(a, c);
      if (l > bestLen) { bestLen = l; bestEdge = [a, c]; }
    }
    if (bestLen < 4.5) continue;
    const c0 = centroid(b.points);
    if (distToPolyline(c0, st.points) > 15) continue;
    const [ax, az] = bestEdge[0], [bx2, bz2] = bestEdge[1];
    const ux = (bx2 - ax) / bestLen, uz = (bz2 - az) / bestLen;
    const nx = -uz, nz = ux;
    // 朝街：法线指向道路最近点方向
    let bd = Infinity, bq = null;
    for (let i = 0; i < st.points.length - 1; i++) {
      const A = st.points[i], B = st.points[i + 1];
      const dx = B[0] - A[0], dz = B[1] - A[1];
      const tt = Math.max(0, Math.min(1, ((c0[0] - A[0]) * dx + (c0[1] - A[1]) * dz) / (dx * dx + dz * dz || 1)));
      const q = [A[0] + dx * tt, A[1] + dz * tt];
      const d = dist2d(c0, q);
      if (d < bd) { bd = d; bq = q; }
    }
    if (bd > 12) continue;
    const s = (nx * (bq[0] - c0[0]) + nz * (bq[1] - c0[1])) > 0 ? 1 : -1;
    const face = [s * nx, s * nz];
    const rotY = Math.atan2(face[0], face[1]);
    // 临街边按开间拆分：每间 5.4–9.6m，配最接近的店屋单元
    const nBay = Math.max(1, Math.min(5, Math.round(bestLen / 6.4)));
    const bayW = bestLen / nBay;
    replacedIds.add(b.id);
    for (let k = 0; k < nBay; k++) {
      const t0 = (k + 0.5) * bayW;
      const cx = ax + ux * t0, cz = az + uz * t0;
      let unit = SHOP_UNITS[0];
      for (const u of SHOP_UNITS) if (Math.abs(u.w - bayW) < Math.abs(unit.w - bayW)) unit = u;
      replaceSeq++;
      made++;
      instances.push({
        id: `strow-r${replaceSeq}`, module: unit.module, zone: 'outer', lod: 'L2',
        position: [cx, cz], rotY, rowStreet: st.name, replacesOsm: b.id,
        sourcePath: 'pawborough-shop-base-batch-20260921/workspace/out/' + unit.file,
        sha256: SHOP_SHA[unit.module].sha256, ownerAdopted: false,
        axis: 'GLB Y-up, facade +Z, depth -Z, origin front-wall center bottom; scale 1',
      });
      emit({
        id: `strow-r${replaceSeq}`, zone: 'outer', kind: 'shopAnchor', name: t.name || null, lod: 'L2', disposition: 'reused',
        geometry: { position: [cx, cz], rotY }, rowStreet: st.name, replacesOsm: b.id, bay: `${k + 1}/${nBay}`,
        trade: TRADE[(replaceSeq * 5) % TRADE.length],
        sources: { osmWay: b.id, sha256: SHOP_SHA[unit.module].sha256 },
        confidence: 'footprint contemporary OSM; unit base model read-only reuse',
        inferences: [`OSM edge ${bestLen.toFixed(1)}m split into ${nBay} bays; unit ${unit.module} (${unit.w}m) per bay; no scaling; trade is candidate only`],
      });
    }
  }
  if (made) replaceStats.push({ street: st.name, osmWay: st.id, units: made });
}

// ---------- 方浜中路/东门路提案店排（共用底图的商铺提案点 -> 店屋实例） ----------
// 老总图沿主街留了 26m 无建筑带，店铺以提案点（angle/宽度/深度）给出；此处按提案点位摆放店屋底模。
{
  const inRegion = (p) => p[0] > -270 && p[0] < 45 && p[1] > -260 && p[1] < 32;
  let pseq = 0;
  const pStats = {};
  for (const sp of map.shops) {
    if (!inRegion(sp.point)) continue;
    pseq++;
    const zone = assignZone([[sp.point[0], sp.point[1]]]) || 'outer';
    // 提案 angle 即 facade +Z 朝向（老总图同一轴约定）
    const rotY = sp.angle;
    // 选宽度最接近提案宽度的单元（提案 10.7m -> threebay 9.6 / double 7.2 交替制造节奏）
    const pool = pseq % 3 === 0 ? SHOP_UNITS : SHOP_UNITS.filter(u => u.w <= 9.6);
    let unit = pool[0];
    for (const u of pool) if (Math.abs(u.w - sp.width) < Math.abs(unit.w - sp.width)) unit = u;
    instances.push({
      id: `shoprow-p${sp.id.replace('shop-', '')}`, module: unit.module, zone, lod: 'L2',
      position: [sp.point[0], sp.point[1]], rotY, proposal: sp.id, proposalCategory: sp.category,
      sourcePath: 'pawborough-shop-base-batch-20260921/workspace/out/' + unit.file,
      sha256: SHOP_SHA[unit.module].sha256, ownerAdopted: false,
      axis: 'GLB Y-up, facade +Z, depth -Z, origin front-wall center bottom; scale 1',
    });
    emit({
      id: `shoprow-p${sp.id.replace('shop-', '')}`, zone, kind: 'shopAnchor', name: null, lod: 'L2', disposition: 'reused',
      geometry: { position: [sp.point[0], sp.point[1]], rotY }, proposal: sp.id,
      trade: sp.category,
      sources: { mapDataShops: sp.id }, confidence: 'shop proposal point from shared base map; historicalPositionVerified=false',
      inferences: ['unit fitted to proposal point (design proposal positions along 方浜中路/东门路); no historic shop addresses claimed'],
    });
    pStats[sp.category] = (pStats[sp.category] || 0) + 1;
  }
  facadeStats.proposalRows = { total: pseq, byCategory: pStats };
}

// ---------- 外围 L0 体块（已被店屋置换的轮廓不再出盒） ----------
for (const { b } of byZone.outer) {
  if (replacedIds.has(b.id)) continue;
  emit({
    id: `bld-${b.id}`, zone: 'outer', kind: 'outerBuilding', lod: 'L0', disposition: 'rendered',
    geometry: { footprint: b.points }, height: b.height, levels: b.height ? Math.max(1, Math.round(b.height / 3.2)) : 2,
    sources: { osmWay: b.id }, confidence: b.confidence,
  });
}

// ---------- 豫园：园内设施分类 ----------
// 命名关键词 -> (kind, roofMode, storeys)。全部标注未实测，形制为类别推断。
// G2 七节点证据（references 图库 PARTS.md 豫园表 + generated 施工图 + originals 实拍）：
// feature 只用图库已覆盖的组织特征；覆盖不足的节点只做标注推断的类别样板。
const GARDEN_NODE_EVIDENCE = {
  '三穗堂': {
    refs: { realPhotos: [], generated: ['PBR-SH-0004-G21'], partsRow: '三穗堂（五开间推断）' },
    evidenceType: 'generated-construction-sheet（无单栋实拍；G21 推断）',
    feature: 'doubleEave skirt + fiveBay front colonnade + high plinth + front rail',
    nodeFocus: { doubleEave: true, bayCount: 5, plinth: 0.55, frontRail: true },
  },
  '点春堂': {
    refs: { realPhotos: ['PBR-SH-0004-022'], generated: ['PBR-SH-0004-G18'], partsRow: '点春堂类两层厅（未铭牌确认）' },
    evidenceType: 'photo+generated（类两层厅，未铭牌确认）',
    feature: 'wrap-around ground gallery (colonnade+rail on two longest edges)',
    nodeFocus: { wrapGallery: true },
  },
  '会景楼': {
    refs: { realPhotos: [], generated: [], partsRow: '会景楼/内园静观大厅（覆盖不足）' },
    evidenceType: 'no-coverage → category-inference only（不做确切历史屋式断言）',
    feature: 'two-storey tower template: setback upper + base colonnade + upper lattice band（类别样板，标注推断）',
    nodeFocus: {},
  },
  '玉华堂': {
    refs: { realPhotos: ['PBR-SH-0004-015'], generated: ['PBR-SH-0004-G16'], partsRow: '玉华堂外观（月洞+三曲板桥）' },
    evidenceType: 'photo+generated',
    feature: 'full lattice facade band + moon-gate screen wall（月洞门墙净距校验后放置）',
    nodeFocus: { latticeFacade: true, moonGate: true },
  },
  '打唱台': {
    refs: { realPhotos: [], generated: ['PBR-SH-0004-G20'], partsRow: '打唱台（无精确实拍，推断）' },
    evidenceType: 'generated-construction-sheet（推断）',
    feature: 'raised open stage: corner columns + rail all around + steep hip roof',
    nodeFocus: { openStage: true },
  },
  '听涛阁': {
    refs: { realPhotos: ['PBR-SH-0004-013', 'PBR-SH-0004-014'], generated: ['PBR-SH-0004-G19'], partsRow: '听涛阁（同积玉水廊 G19）' },
    evidenceType: 'photo+generated（积玉水廊端头阁）',
    feature: 'covered water gallery along OSM band + two-storey end pavilion',
    nodeFocus: { endPavilion: true },
  },
  '得月楼': {
    refs: { realPhotos: ['PBR-SH-0004-005'], generated: ['PBR-SH-0004-G14'], partsRow: '得月楼一带' },
    evidenceType: 'photo+generated',
    feature: 'wrap-around upper balcony rail + ground colonnade + full upper lattice band',
    nodeFocus: { wrapBalcony: true },
  },
};

// 入口朝向（facade dir）：临水建筑面向最近园内水面（≤30m）；否则南向（+Z）基准。
// 传统厅堂南向为类别基准，非实测；临水面优先保证临池可见面组织特征。
function gardenFacadeDir(fp, zone, objectsSoFar) {
  const c = centroid(fp);
  let best = null, bestD = 30;
  for (const o of objectsSoFar) {
    if (o.kind !== 'water' || o.zone !== 'garden') continue;
    const ring = [...o.geometry.footprint, o.geometry.footprint[0]];
    const d = distToPolyline(c, ring);
    if (d < bestD) {
      // 最近边界点方向
      let bd = Infinity, bq = null;
      for (let i = 0; i < ring.length - 1; i++) {
        const A = ring[i], B = ring[i + 1];
        const dx = B[0] - A[0], dz = B[1] - A[1];
        const t = Math.max(0, Math.min(1, ((c[0] - A[0]) * dx + (c[1] - A[1]) * dz) / (dx * dx + dz * dz || 1)));
        const q = [A[0] + dx * t, A[1] + dz * t];
        const dd = dist2d(c, q);
        if (dd < bd) { bd = dd; bq = q; }
      }
      const l = Math.hypot(bq[0] - c[0], bq[1] - c[1]) || 1;
      best = { dir: [(bq[0] - c[0]) / l, (bq[1] - c[1]) / l], basis: 'nearest-garden-water' };
      bestD = d;
    }
  }
  return best || { dir: [0, 1], basis: 'south-default (category basis, not survey)' };
}

// 入口朝向显式覆盖表（主控决定；推断规则 gardenFacadeDir 不变，覆盖只在这一处集中登记）。
// 每条用 footprint 上的一段边（起止顶点坐标，可跨中间顶点）定义朝向：
// facade.dir = 该段边弦（起点→终点）的外法线，运行时从 footprint 重算，不写死方向值。
// 被覆盖的推断值留在 facade.inferred 备查。
const FACADE_OVERRIDES = {
  // 三穗堂：入园第一厅坐北朝南，格扇立面朝南侧入口院落。推断规则（最近园池水面）得朝北，
  // 与北侧共边的仰山堂背靠背（wave1-maint M2 排查）。依据为常识判断，库内无可定向照片，未核实。
  'bld-428179901': {
    edge: [[-168.87, -172.06], [-152.49, -176.46]], // 南侧长边（经中间顶点 -160.24,-174.44）
    basis: 'lead-override 2026-09-25: 入园第一厅坐北朝南（常识，未核实）',
  },
};
function facadeOverride(id, fpIn, inferred) {
  const ov = FACADE_OVERRIDES[id];
  if (!ov) return null;
  const closedRing = fpIn.length > 1 && fpIn[0][0] === fpIn[fpIn.length - 1][0] && fpIn[0][1] === fpIn[fpIn.length - 1][1];
  const fp = closedRing ? fpIn.slice(0, -1) : fpIn;
  const idx = (q) => fp.findIndex(p => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6);
  const i0 = idx(ov.edge[0]), i1 = idx(ov.edge[1]);
  if (i0 < 0 || i1 < 0 || i0 === i1) throw new Error(`facade override ${id}: edge vertices not on footprint`);
  const A = fp[i0], B = fp[i1];
  const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
  let n = [-(B[1] - A[1]) / l, (B[0] - A[0]) / l];
  // 外法线 = 背离 footprint 形心的一侧
  const c = centroid(fp), m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  if (n[0] * (c[0] - m[0]) + n[1] * (c[1] - m[1]) > 0) n = [-n[0], -n[1]];
  return { dir: n, basis: ov.basis, edge: ov.edge, inferred };
}

const GARDEN_CLASSES = [
  [/堂$|殿$|静观|学圃/, 'hall', 'gabled', 1],
  [/楼$|阁$|快楼/, 'tower', 'gabled', 2],
  [/亭$/, 'pavilion', 'hip', 1],
  [/轩$|可以观|洞天福地|别有天/, 'xuan', 'hip', 1],
  [/榭$|舫$/, 'waterside', 'gabled', 1],
  [/廊$/, 'corridor', 'gabled', 1],
  [/戏台|打唱台/, 'stage', 'hip', 1],
  [/桥$/, 'bridge', null, 0],
  [/玉玲珑/, 'rockery', null, 0],
];

// 窄带状轮廓（OSM 把 水廊+端头阁 合并成一个 building way）→ 中心线：
// 顶点按主轴投影分 bin，每 bin 取质心；返回 { line, endWidth0, endWidth1, dir }。
function bandCenterline(fp) {
  const pa = principalAxis(fp);
  const proj = fp.map(p => {
    const dx = p[0] - pa.c[0], dz = p[1] - pa.c[1];
    return { t: dx * pa.dir[0] + dz * pa.dir[1], u: -dx * pa.dir[1] + dz * pa.dir[0] };
  });
  const t0 = Math.min(...proj.map(p => p.t)), t1 = Math.max(...proj.map(p => p.t));
  const NB = 7;
  const bins = Array.from({ length: NB }, () => []);
  for (const p of proj) bins[Math.min(NB - 1, Math.max(0, Math.floor((p.t - t0) / ((t1 - t0) / NB || 1))))].push(p);
  const line = bins.filter(bn => bn.length).map(bn => {
    const mt = bn.reduce((s, p) => s + p.t, 0) / bn.length;
    const mu = bn.reduce((s, p) => s + p.u, 0) / bn.length;
    return [pa.c[0] + pa.dir[0] * mt - pa.dir[1] * mu, pa.c[1] + pa.dir[1] * mt + pa.dir[0] * mu];
  });
  const endSpread = (bn) => bn.length ? Math.max(...bn.map(p => p.u)) - Math.min(...bn.map(p => p.u)) : 0;
  return { line, endWidth0: endSpread(bins[0]), endWidth1: endSpread(bins[NB - 1]), dir: pa.dir };
}

for (const { b, t } of byZone.garden) {
  const area = Math.abs(polyArea(b.points));
  const name = t.name || null;
  let kind = null, roofMode = 'gabled', storeys = 1, clsSource = null;
  if (name) {
    for (const [re, k, rm, st] of GARDEN_CLASSES) {
      if (re.test(name)) { kind = k; roofMode = rm; storeys = st; clsSource = 'osm-name-keyword'; break; }
    }
  }
  // G2 显式重归类：OSM way 428179920 标 building=yes + name=听涛阁，但其轮廓是
  // 38.8m×3-4m 的窄带 = 积玉水廊（有顶游廊）+ 端头阁楼；图库 G19/实拍 013/014 支持该解读。
  // tower→watersideGallery 迁移记录在对象 reclassifiedFrom，ID 不变，coverage 按 ID 对账。
  if (name === '听涛阁') { kind = 'watersideGallery'; clsSource = 'reclassified: osm band footprint + PARTS G19'; }
  if (!kind) {
    const pa = principalAxis(b.points);
    if (pa.len / Math.max(1, pa.width) > 3 && area < 200) kind = 'corridor';
    else if (area < 34 && pa.len < 8) kind = 'pavilion';
    else kind = 'hall';
    clsSource = 'morphology-inference';
  }
  if (kind === 'rockery') {
    emit({
      id: `bld-${b.id}`, zone: 'garden', kind: 'rockery', name, lod: 'L1', disposition: 'rendered',
      geometry: { footprint: b.points }, height: 4.6,
      sources: { osmWay: b.id }, confidence: 'position from OSM named way; form is design inference',
      inferences: ['rock cluster form/height design-inferred; OSM tags it building=yes but it is the Jade Rock court'],
      category: 'rockery', classSource: clsSource,
    });
    if (name) { gardenNamed[name] = `bld-${b.id}`; labels.push({ id: `bld-${b.id}`, text: name, x: centroid(b.points)[0], z: centroid(b.points)[1], kind: 'garden' }); }
    continue;
  }
  if (kind === 'bridge') {
    const geo = geoOf(b.id);
    emit({
      id: `bld-${b.id}`, zone: 'garden', kind: 'bridge', name, lod: 'L1', disposition: 'rendered',
      geometry: { polyline: geo && geo.length >= 2 ? geo : b.points }, width: 2.6, deckY: 0.5,
      sources: { osmWay: b.id }, confidence: 'position from OSM way',
      inferences: ['mapped water does not cover this crossing in the simplified dataset; kept at OSM position, span/shape design-inferred'],
      category: 'bridge', classSource: clsSource,
    });
    if (name) { gardenNamed[name] = `bld-${b.id}`; labels.push({ id: `bld-${b.id}`, text: name, x: centroid(b.points)[0], z: centroid(b.points)[1], kind: 'garden' }); }
    continue;
  }
  if (kind === 'watersideGallery') {
    const band = bandCenterline(b.points);
    // 端头阁楼放在带宽较宽的一端（≥5m 才有阁体；两端都窄则按北端处理并记录）
    const wideEnd = band.endWidth1 > band.endWidth0 ? 1 : 0;
    const endW = Math.max(band.endWidth0, band.endWidth1);
    emit({
      id: `bld-${b.id}`, zone: 'garden', kind: 'watersideGallery', name, lod: 'L1', disposition: 'rendered',
      geometry: { polyline: band.line }, width: 2.6, height: 3.1,
      endPavilion: endW >= 5 ? { end: wideEnd, widthM: +endW.toFixed(1), storeys: 2 } : null,
      reclassifiedFrom: { kind: 'tower', from: 'osm-name-keyword (楼$)' },
      reclassReason: 'OSM way footprint is a 38.8m x 3-4m band = covered water gallery (积玉水廊) with the named tower at the wider end; PARTS G19 + real photos 013/014; explicit ID-preserving reclassification',
      sources: { osmWay: b.id }, confidence: 'alignment from OSM band footprint; gallery/end-pavilion form from PARTS G19 (generated sheet + real photos)',
      inferences: ['centerline from 7-bin principal-axis skeleton of the band footprint', 'gallery width/column rhythm design-inferred'],
      category: 'corridor-family', classSource: clsSource,
    });
    if (name) { gardenNamed[name] = `bld-${b.id}`; labels.push({ id: `bld-${b.id}`, text: name, x: centroid(b.points)[0], z: centroid(b.points)[1], kind: 'garden' }); }
    continue;
  }
  if (kind === 'corridor') {
    const geo = geoOf(b.id);
    const path = geo && geo.length >= 2 ? geo : b.points;
    emit({
      id: `bld-${b.id}`, zone: 'garden', kind: 'corridor', name, lod: 'L1', disposition: 'rendered',
      geometry: { polyline: path }, width: name && name.includes('水廊') ? 2.6 : 2.2, height: 3.1,
      sources: { osmWay: b.id }, confidence: 'path from OSM way geometry',
      inferences: ['column rhythm/roof section design-inferred'],
      category: 'corridor', classSource: clsSource,
    });
    if (name) { gardenNamed[name] = `bld-${b.id}`; labels.push({ id: `bld-${b.id}`, text: name, x: centroid(path)[0], z: centroid(path)[1], kind: 'garden' }); }
    continue;
  }
  const storeySource = t['building:levels'] ? 'osm building:levels' : 'class default (unmeasured)';
  const eave = kind === 'tower' ? 5.6 : kind === 'stage' ? 3.2 : kind === 'pavilion' ? 3.0 : 4.0;
  const rise = kind === 'pavilion' ? 2.1 : kind === 'stage' ? 2.4 : 1.9;
  // G2：入口朝向 + 七节点特征（证据见 GARDEN_NODE_EVIDENCE）
  const facadeInferred = gardenFacadeDir(b.points, 'garden', objects);
  const facade = facadeOverride(`bld-${b.id}`, b.points, facadeInferred) || facadeInferred;
  const nodeEv = name ? GARDEN_NODE_EVIDENCE[name] : null;
  const emitB = {
    id: `bld-${b.id}`, zone: 'garden', kind, name, lod: 'L1', disposition: 'rendered',
    geometry: { footprint: b.points }, height: eave, eave, rise, roofMode, storeys, storeySource,
    facade,
    ...(nodeEv ? {
      nodeFocus: nodeEv.nodeFocus,
      nodeEvidence: { refs: nodeEv.refs, evidenceType: nodeEv.evidenceType, feature: nodeEv.feature },
    } : {}),
    sources: { osmWay: b.id, roofShapeTag: t['roof:shape'] || null }, confidence: 'footprint contemporary OSM; form is category inference, not survey',
    inferences: [
      'roof mode from category; OSM roof:shape=' + (t['roof:shape'] || 'none') + ' not survey-verified',
      `facade dir basis: ${facade.basis}`,
      ...(storeys === 2 && !t['building:levels'] ? ['storey count design-inferred from class'] : []),
    ],
    category: kind, classSource: clsSource,
  };
  emit(emitB);
  if (name) { gardenNamed[name] = emitB.id; labels.push({ id: emitB.id, text: name, x: centroid(b.points)[0], z: centroid(b.points)[1], kind: 'garden' }); }
}

// 命名校验：工单点名的设施必须全部在场
const REQUIRED = ['三穗堂', '点春堂', '会景楼', '玉华堂', '打唱台', '听涛阁', '得月楼'];
const missingNames = REQUIRED.filter(n => !gardenNamed[n]);

// ---------- 豫园门楼（已采用 v2，只读引用，design-placement） ----------
const GATE_FILE = path.join(IN, 'yuyuan-gate-v2.glb');
const GATE_SHA = '0251ea21bb18673dd411d83c8537d0f995b9c4e4864bbd515b29066538f368dc';
{
  const sans = byZone.garden.find(x => x.t.name === '三穗堂');
  const target = sans ? centroid(sans.b.points) : [-163, -181];
  const gp = zones.garden.polygon;
  // v3 修正：v2 把门楼放在"距三穗堂最近的边界边中点"，该点落在商城大楼块
  // bld-553893884 的 footprint 内（v3 复检发现门楼嵌在楼里、门路穿楼）。
  // 仍为 design-placement：沿园界每 2m 扫描候选点，要求距任何已渲染建筑轮廓 ≥7m
  // （门楼进深 5.94/2 + 余量），取距三穗堂最近者。
  const bldAllFps = [...byZone.garden, ...byZone.bazaar, ...byZone.outer].map(x => x.b.points);
  const siteClear = (p, m) => {
    for (const fp of bldAllFps) {
      if (pointInPoly(p, fp)) return false;
      if (distToPolyline(p, fp) < m) return false;
    }
    return true;
  };
  let best = null, bestD = Infinity;
  for (let i = 0; i < gp.length; i++) {
    const a = gp[i], bp = gp[(i + 1) % gp.length];
    const L = dist2d(a, bp);
    const n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k <= n; k++) {
      const p = [a[0] + (bp[0] - a[0]) * k / n, a[1] + (bp[1] - a[1]) * k / n];
      if (!siteClear(p, 7)) continue;
      const d = dist2d(p, target);
      if (d < bestD) { bestD = d; best = { pt: p }; }
    }
  }
  if (!best) best = { pt: [-176.1, -182] }; // 兜底：v2 旧落点（不期望触发）
  const gateX = best.pt[0], gateZ = best.pt[1];
  const toTarget = Math.atan2(target[0] - gateX, -(target[1] - gateZ)); // rotY 使 -Z(门洞深向) 指向三穗堂
  const gateRotY = toTarget + Math.PI;
  instances.push({
    id: 'garden-gate', module: 'yuyuan-gate-v2', zone: 'garden', lod: 'L2',
    position: [gateX, gateZ], rotY: gateRotY,
    sourcePath: 'inputs/yuyuan-gate-v2.glb', sha256: GATE_SHA, ownerAdopted: true,
    axis: 'GLB Y-up, facade +Z, depth -Z, origin front-wall center bottom; scale 1',
    size: { w: 11.12, d: 5.94, h: 8.26 },
  });
  emit({
    id: 'garden-gate', zone: 'garden', kind: 'gateAnchor', name: '豫园门楼', lod: 'L2',
    disposition: 'reused', geometry: { position: [gateX, gateZ], rotY: gateRotY },
    sources: { adopted: 'GATE-ADOPTION.json', sha256: GATE_SHA },
    confidence: 'owner-adopted model v2',
    inferences: [
      'placement is design-placement: boundary point nearest 三穗堂 that clears all rendered building footprints by 7m; no surveyed gate position in source data',
      'v3 adjusts the v2 design placement: v2 midpoint fell inside bazaar block bld-553893884 (gate embedded in a building volume; its access path crossed the block)',
    ],
  });
  // 门楼 → 三穗堂 设计补足路径由下方园路 A* 路由器统一生成（v3）。
}

// ---------- 豫园龙墙（设计推断走向）+ 园路 ----------
{
  const gardenFps = byZone.garden.map(x => x.b.points);
  // v3 修复：v2 用 instances[0] 当门楼，但 instances[0] 实为外围店屋实例（strow-r1），
  // 门楼开口从未命中——改按 id 取真实门楼锚。
  const gateInst = instances.find(i => i.id === 'garden-gate');
  const wallRing = offsetPoly(zones.garden.polygon, -2.5);
  const segs = [];
  const keptIdx = [];
  for (let i = 0; i < wallRing.length; i++) {
    const a = wallRing[i], b = wallRing[(i + 1) % wallRing.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // 避让：中点贴近园内建筑、邻区边界、主路或门楼则断开（自然形成门口）
    let blocked = false;
    for (const z of ZONE_ORDER) {
      if (z === 'garden') continue;
      if (pointInPoly(mid, zones[z].polygon) && distToPolyline(mid, zones[z].polygon) < 4) blocked = true;
    }
    for (const fp of gardenFps) if (distToPolyline(mid, fp) < 1.8) blocked = true;
    for (const rp of facadeRoads) if (distToPolyline(mid, rp) < 7) blocked = true;
    if (gateInst && dist2d(mid, gateInst.position) < 9) blocked = true; // 门楼开口
    if (!blocked) { segs.push([a, b]); keptIdx.push(i); }
  }
  // G2 园墙可读性：漏窗（长段中部规则布点）+ 门洞框（单边缺口 1.4–7m 的真门口）
  const lattice = [];
  for (const [a, b] of segs) {
    if (lattice.length >= 26) break;
    const L = dist2d(a, b);
    if (L < 9) continue;
    const n = Math.min(4, Math.floor((L - 4) / 5.5));
    for (let k = 0; k < n; k++) {
      const t = L / 2 + (k - (n - 1) / 2) * 5.5;
      lattice.push({
        x: +(a[0] + (b[0] - a[0]) * t / L).toFixed(2), z: +(a[1] + (b[1] - a[1]) * t / L).toFixed(2),
        rotY: +Math.atan2(b[0] - a[0], b[1] - a[1]).toFixed(3),
      });
    }
  }
  const doorFrames = [];
  for (let k = 0; k < keptIdx.length; k++) {
    const i = keptIdx[k], j = keptIdx[(k + 1) % keptIdx.length];
    if (keptIdx.length > 1 && k === keptIdx.length - 1) break; // 环闭合处不再重复
    if (j !== (i + 2) % wallRing.length) continue; // 缺口>1边=大门楼/街口大开口，不加框
    const p = wallRing[(i + 1) % wallRing.length], q = wallRing[(i + 2) % wallRing.length];
    const gl = dist2d(p, q);
    if (gl < 1.4 || gl > 7) continue;
    doorFrames.push({
      x: +(((p[0] + q[0]) / 2).toFixed(2)), z: +(((p[1] + q[1]) / 2).toFixed(2)),
      rotY: +Math.atan2(q[0] - p[0], q[1] - p[1]).toFixed(3), widthM: +gl.toFixed(1),
    });
  }
  emit({
    id: 'garden-wall', zone: 'garden', kind: 'wall', name: '豫园龙墙（走向示意）', lod: 'L1', disposition: 'rendered',
    geometry: { segments: segs, lattice, doorFrames }, height: 2.9, thickness: 0.45,
    sources: { base: zones.garden.polygon ? 'garden zone boundary' : null }, confidence: 'design-inference',
    inferences: [
      'wall alignment follows garden zone boundary inset 2.5m; openings emerge where buildings/streets meet',
      'G2: lattice windows (漏窗) on long stretches + door frames on single-edge gaps per PARTS 0002-024/0004-G08 wall types; simplified lattice pattern, not carved replica',
    ],
  });
  // G2 龙墙龙头：可辨认低模轮廓（盒组），放在靠门楼最近的墙段端点，不耗整轮雕饰
  if (gateInst) {
    let head = null, headD = Infinity;
    for (const [a, b] of segs) {
      for (const [p, q] of [[a, b], [b, a]]) {
        const d = dist2d(p, gateInst.position);
        if (d < 3 || d > 18) continue;
        if (d < headD) { headD = d; head = { x: +p[0].toFixed(2), z: +p[1].toFixed(2), rotY: +Math.atan2(q[0] - p[0], q[1] - p[1]).toFixed(3) }; }
      }
    }
    if (head) {
      emit({
        id: 'garden-wall-dragonhead', zone: 'garden', kind: 'wallHead', lod: 'L1', disposition: 'rendered',
        geometry: head, scaleHint: 'snout/head/horns box assembly ~1.6m',
        sources: {}, confidence: 'design-inference',
        inferences: ['recognizable low-poly dragon-head silhouette at the wall end near the gate (PARTS 0002-031/032, 0004-G02); box assembly, not carved sculpture'],
      });
    }
  }
  // 内圈院落间设计园路 v3：栅格 A* 路由（本批 G1）。
  // v2 复检问题：单绕行点/单建筑避让让多段中心线贴墙（净距 0.01–0.61m < 半宽 0.75m），
  // 且把 仰山堂→万花楼 误记为"40m 内无干绕行"（该受限记录由 L 形干绕行推翻）。
  // v3：建筑+水面+园墙段=硬障碍，净距分级回退（0.85/0.7/0.55/0.45m），
  //     全干失败才允许在 ≤12m 窄水面跨弦搭最小桥（design-inference）；端点厅堂视为进院可达。
  const gardenWaters = objects.filter(o => o.kind === 'water' && o.zone === 'garden')
    .map(o => ({ id: o.id, fp: o.geometry.footprint }));
  // v3：障碍不限于园内——商城/外围建筑同样挡路（v2 只看园内，门楼路径穿过了
  // 商城大楼块 bld-553893884 而未被察觉）。
  const gardenBlds = [...byZone.garden, ...byZone.bazaar, ...byZone.outer]
    .map(x => ({ id: `bld-${x.b.id}`, name: x.t.name || null, fp: x.b.points }));
  const wallObjG = objects.find(o => o.id === 'garden-wall');
  const routeObstacles = [
    ...gardenBlds.map(b => ({ id: b.id, kind: 'building', fp: b.fp })),
    ...gardenWaters.map(w => ({ id: w.id, kind: 'water', fp: w.fp })),
    ...(wallObjG ? wallObjG.geometry.segments.map((s, i) => ({ id: `garden-wall#${i}`, kind: 'wall', seg: s })) : []),
  ];
  const routeAudit = {
    method: 'grid A* (0.5m cell) over garden zone; hard obstacles = garden buildings + mapped waters + garden wall segments; margin ladder 0.85/0.7/0.55/0.45m; endpoint halls allowed as court approach; bridging fallback only for mapped-water chords <=12m',
    replacesDesign: 'v2 gpath polylines (single-waypoint water detour + single-building kink) — v2 out-v2 outputs untouched',
    widthTargetM: 1.5,
    segments: [],
  };
  const GRID = (() => {
    const bb = bbox(zones.garden.polygon);
    // cell 0.35：栅格量化会蚀掉净距（半对角 0.247m），A*/funnel 按 目标净距+0.3m 膨胀搜索，
    // 由"到障碍距离 1-Lipschitz"保证最终折线连续净距 ≥ 目标净距（measureSeg 精确复测）。
    const pad = 6, cell = 0.35;
    const nx = Math.ceil((bb.w + 2 * pad) / cell), nz = Math.ceil((bb.d + 2 * pad) / cell);
    const x0 = bb.x0 - pad, z0 = bb.z0 - pad;
    const inZone = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        if (pointInPoly([x0 + ix * cell, z0 + iz * cell], zones.garden.polygon)) inZone[iz * nx + ix] = 1;
      }
    }
    const mkField = (obs) => {
      const clr = new Float32Array(nx * nz).fill(99);
      for (const ob of obs) {
        let bx0, bx1, bz0, bz1;
        if (ob.fp) {
          const b2 = bbox(ob.fp);
          bx0 = b2.x0 - 3.5; bx1 = b2.x0 + b2.w + 3.5; bz0 = b2.z0 - 3.5; bz1 = b2.z0 + b2.d + 3.5;
        } else {
          bx0 = Math.min(ob.seg[0][0], ob.seg[1][0]) - 3.5; bx1 = Math.max(ob.seg[0][0], ob.seg[1][0]) + 3.5;
          bz0 = Math.min(ob.seg[0][1], ob.seg[1][1]) - 3.5; bz1 = Math.max(ob.seg[0][1], ob.seg[1][1]) + 3.5;
        }
        const ix0 = Math.max(0, Math.floor((bx0 - x0) / cell)), ix1 = Math.min(nx - 1, Math.ceil((bx1 - x0) / cell));
        const iz0 = Math.max(0, Math.floor((bz0 - z0) / cell)), iz1 = Math.min(nz - 1, Math.ceil((bz1 - z0) / cell));
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) {
            const idx = iz * nx + ix;
            if (!inZone[idx]) continue;
            const p = [x0 + ix * cell, z0 + iz * cell];
            const d = ob.fp ? (pointInPoly(p, ob.fp) ? 0 : distToPolyline(p, [...ob.fp, ob.fp[0]]))
              : distToSeg(p, ob.seg[0], ob.seg[1]);
            if (d < clr[idx]) clr[idx] = d;
          }
        }
      }
      return clr;
    };
    return {
      x0, z0, cell, nx, nz, inZone,
      clr: mkField(routeObstacles),
      mkField,
    };
  })();
  const gridIdx = (p) => {
    const ix = Math.round((p[0] - GRID.x0) / GRID.cell), iz = Math.round((p[1] - GRID.z0) / GRID.cell);
    return ix < 0 || iz < 0 || ix >= GRID.nx || iz >= GRID.nz ? -1 : iz * GRID.nx + ix;
  };
  const pointClear = (p, margin, allowFps, field) => {
    const idx = gridIdx(p);
    if (idx < 0 || !GRID.inZone[idx]) return false;
    if ((field || GRID.clr)[idx] >= margin) return true;
    return allowFps.some(a => pointInPoly(p, a.fp));
  };
  const segClear = (a, b, margin, allowFps, field) => {
    const L = dist2d(a, b), n = Math.max(1, Math.ceil(L / 0.3));
    for (let k = 0; k <= n; k++) {
      if (!pointClear([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], margin, allowFps, field)) return false;
    }
    return true;
  };
  // admitField：准入净距场（每对独立——端点厅堂不算阻挡）；costField：代价净距场（全障碍，
  // 穿行厅堂/贴墙高代价）；widthPref：低净距格按比例加价，避免最小长度路径贴墙。
  const astar = (a, b, margin, allowFps, admitField, costField, widthPref) => {
    const start = gridIdx(a), goal = gridIdx(b);
    if (start < 0 || goal < 0) return null;
    const N = GRID.nx * GRID.nz;
    const g = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heapA = [];
    const hPush = (pr) => { heapA.push(pr); let i = heapA.length - 1; while (i > 0) { const p2 = (i - 1) >> 1; if (heapA[p2][0] <= heapA[i][0]) break; const t = heapA[p2]; heapA[p2] = heapA[i]; heapA[i] = t; i = p2; } };
    const hPop = () => {
      const top = heapA[0], last = heapA.pop();
      if (heapA.length) {
        heapA[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heapA.length && heapA[l][0] < heapA[m][0]) m = l;
          if (r < heapA.length && heapA[r][0] < heapA[m][0]) m = r;
          if (m === i) break;
          const t = heapA[m]; heapA[m] = heapA[i]; heapA[i] = t;
          i = m;
        }
      }
      return top;
    };
    const gx = goal % GRID.nx, gz2 = (goal / GRID.nx) | 0;
    const h = (idx) => Math.hypot(idx % GRID.nx - gx, ((idx / GRID.nx) | 0) - gz2) * GRID.cell;
    const admit = admitField || GRID.clr;
    const cost = costField || GRID.clr;
    const stepMul = (v) => (widthPref ? 1 + 1.6 * Math.max(0, 1.4 - cost[v]) : 1);
    g[start] = 0;
    hPush([h(start), start]);
    while (heapA.length) {
      const u = hPop()[1];
      if (done[u]) continue;
      done[u] = 1;
      if (u === goal) break;
      const ux = u % GRID.nx, uz = (u / GRID.nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const vx = ux + dx, vz = uz + dz;
          if (vx < 0 || vz < 0 || vx >= GRID.nx || vz >= GRID.nz) continue;
          const v = vz * GRID.nx + vx;
          if (done[v] || !GRID.inZone[v]) continue;
          const p = [GRID.x0 + vx * GRID.cell, GRID.z0 + vz * GRID.cell];
          if (admit[v] < margin && !allowFps.some(a2 => pointInPoly(p, a2.fp))) continue;
          const ng = g[u] + (dx && dz ? 1.4142 : 1) * GRID.cell * stepMul(v);
          if (ng < g[v]) { g[v] = ng; from[v] = u; hPush([ng + h(v), v]); }
        }
      }
    }
    if (!Number.isFinite(g[goal])) return null;
    const out = [];
    for (let v = goal; v >= 0; v = from[v]) out.push([GRID.x0 + (v % GRID.nx) * GRID.cell, GRID.z0 + ((v / GRID.nx) | 0) * GRID.cell]);
    return out.reverse();
  };
  const funnel = (raw, margin, allowFps, field) => {
    const out = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !segClear(raw[i], raw[j], margin, allowFps, field)) j--;
      out.push(raw[j]);
      i = j;
    }
    return out;
  };
  const mergeSpans = (spans) => {
    const out = [];
    for (const s of spans) {
      const last = out[out.length - 1];
      if (last && last.waterId === s.waterId && dist2d(last.exit, s.entry) < 2.5) {
        last.exit = s.exit;
        last.spanM = +dist2d(last.entry, s.exit).toFixed(1);
      } else out.push({ ...s });
    }
    return out;
  };
  const waterSpans = (pts) => {
    const spans = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = dist2d(a, b), n = Math.max(1, Math.ceil(L / 0.4));
      let cur = null;
      for (let k = 0; k <= n; k++) {
        const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
        const w = gardenWaters.find(w2 => pointInPoly(p, w2.fp));
        if (w && !cur) cur = { waterId: w.id, entry: p };
        else if (!w && cur) { spans.push({ waterId: cur.waterId, entry: cur.entry, exit: p, spanM: +dist2d(cur.entry, p).toFixed(1) }); cur = null; }
      }
      if (cur) spans.push({ waterId: cur.waterId, entry: cur.entry, exit: b, spanM: +dist2d(cur.entry, b).toFixed(1) });
    }
    return mergeSpans(spans);
  };
  const bridgeLines = []; // 已发射桥（含本段新桥），供水面采样豁免与实测用
  const emitBridgeFor = (segId, span) => {
    const dx = span.exit[0] - span.entry[0], dz = span.exit[1] - span.entry[1];
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    const a = [span.entry[0] - ux * 1.2, span.entry[1] - uz * 1.2];
    const b = [span.exit[0] + ux * 1.2, span.exit[1] + uz * 1.2];
    emit({
      id: `gbridge-${segId}-${span.waterId}`, zone: 'garden', kind: 'bridge', name: null, lod: 'L1', disposition: 'rendered',
      geometry: { polyline: [a, b] }, width: 1.8, deckY: 0.5,
      sources: {}, confidence: 'design-inference',
      inferences: [
        `minimal footbridge where design path ${segId} must cross mapped narrow water ${span.waterId} (chord ${span.spanM}m <= 12m); no dry corridor existed at 0.45m clearance`,
        'bank-to-bank landings extended 1.2m onto shore; water/building outlines untouched; deck 0.5m with landing steps',
      ],
    });
    bridgeLines.push({ id: `gbridge-${segId}-${span.waterId}`, pts: [a, b], w: 1.8 });
    [a, b].forEach((e, k2) => {
      const dir = k2 === 0 ? [-ux, -uz] : [ux, uz];
      emit({
        id: `gbridge-${segId}-${span.waterId}-step-${k2}`, zone: 'garden', kind: 'steps', lod: 'L1', disposition: 'rendered',
        geometry: { position: [e[0] + dir[0] * 0.55, e[1] + dir[1] * 0.55], rotY: Math.atan2(-dir[0], -dir[1]), width: 1.8, bottomY: 0.05, topY: 0.5, stepCount: 3 },
        sources: {}, confidence: 'design-inference',
        inferences: ['deck-to-path height transition (0.5 -> 0.05)'],
      });
    });
  };
  const measureSeg = (pts, allowIds, bridgesLocal) => {
    let minC = Infinity, pinch = null, pinchKind = null;
    const covered = (p) => bridgesLocal.some(br => distToPolyline(p, br.pts) <= br.w / 2 + 0.4);
    const sample = (p) => {
      for (const ob of routeObstacles) {
        if (allowIds.has(ob.id)) continue;
        if (ob.kind === 'water' && covered(p)) continue; // 桥面走廊上的水面不算阻碍
        const d = ob.fp ? (pointInPoly(p, ob.fp) ? 0 : distToPolyline(p, [...ob.fp, ob.fp[0]]))
          : distToSeg(p, ob.seg[0], ob.seg[1]);
        if (d < minC) { minC = d; pinch = ob.id; pinchKind = ob.kind; }
      }
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const L = dist2d(pts[i], pts[i + 1]), n = Math.max(1, Math.ceil(L / 0.4));
      for (let k = 0; k <= n; k++) sample([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]);
    }
    return { minClearanceM: +minC.toFixed(2), clearWidthM: +(2 * minC).toFixed(2), pinchObstacle: pinch, pinchKind };
  };
  // MARGIN_SLACK：栅格量化补偿（cell 0.35 半对角 0.247m），搜索净距 = 目标 + SLACK，
  // 由 1-Lipschitz 保证折线连续净距 ≥ 目标；宽度偏好代价避免最小长度路径贴墙。
  const MARGIN_SLACK = 0.25;
  const MARGINS = [0.85, 0.45];
  const dbg = (msg) => { if (process.env.DEBUG_ROUTE) console.log('[route]', msg); };
  const routePair = (A, B) => {
    const allow = [A, B].filter(s => s && s.fp).map(s => ({ id: s.id, fp: s.fp }));
    const allowIds = new Set(allow.map(a => a.id));
    // 每对独立准入场：端点厅堂不作为阻挡（进院抵达、可贴自身厅墙出厅）；
    // 代价场仍用全障碍 GRID.clr，惩罚穿厅与贴墙。
    const admit = GRID.mkField(routeObstacles.filter(o => !allowIds.has(o.id)));
    dbg(`pair ${A.id}->${B.id} start=${gridIdx(A.pt)} goal=${gridIdx(B.pt)}`);
    for (const margin of MARGINS) {
      const raw = astar(A.pt, B.pt, margin + MARGIN_SLACK, allow, admit, GRID.clr, true);
      dbg(`  margin ${margin}: ${raw ? `found ${raw.length} pts` : 'no path'}`);
      if (raw) return { ok: true, margin, pts: funnel(raw, margin + MARGIN_SLACK, allow, admit), allow };
    }
    // 跨水回退：准入场仅去建筑（水面可跨）；每个跨水弦 ≤12m 才允许最小桥，否则受限
    {
      const margin = 0.45;
      const admitBld = GRID.mkField(routeObstacles.filter(o => o.kind === 'building' && !allowIds.has(o.id)));
      const raw = astar(A.pt, B.pt, margin + MARGIN_SLACK, allow, admitBld, GRID.clr, true);
      dbg(`  water-fallback: ${raw ? `found ${raw.length} pts` : 'no path'}`);
      if (raw) {
        const pts = funnel(raw, margin + MARGIN_SLACK, allow, admitBld);
        const spans = waterSpans(pts);
        if (spans.length && spans.every(s => s.spanM <= 12)) return { ok: true, margin, pts, spans, bridged: true, allow };
        return { ok: false, directSpans: spans, allow };
      }
    }
    return { ok: false, directSpans: [], allow };
  };
  // 停靠点：9 个命名厅堂（footprint + 质心）
  const stopNames = ['三穗堂', '仰山堂', '万花楼', '萃秀堂', '点春堂', '打唱台', '玉华堂', '会景楼', '得月楼'];
  const stopInfo = stopNames.map(nm => {
    const id = gardenNamed[nm];
    const o = objects.find(o2 => o2.id === id);
    return o ? { id, fp: o.geometry.footprint || null, pt: centroid(o.geometry.footprint || o.geometry.polyline) } : null;
  });
  // 门楼 → 三穗堂（v2 的门楼→三穗堂单点绕行废除，统一走路由器）
  {
    const gatePt = gateInst ? gateInst.position : [-176.1, -182.0];
    const r = routePair({ id: 'garden-gate', fp: null, pt: gatePt }, stopInfo[0]);
    const allowIds = new Set(r.allow.map(a => a.id));
    if (r.ok) {
      const m = measureSeg(r.pts, allowIds, bridgeLines);
      emit({
        id: 'path-gate-sansuitang', zone: 'garden', kind: 'path', lod: 'L1', disposition: 'rendered',
        geometry: { polyline: r.pts }, width: 2.6, height: 0.05,
        sources: {}, confidence: 'design-inference',
        inferences: [
          `minimal design link from design-placed gate to 三穗堂 court; v3 A* route at ${r.margin}m clearance, measured walkable width ${m.clearWidthM}m (target 1.5m)`,
        ],
      });
      routeAudit.segments.push({ segment: 'path-gate-sansuitang', from: '豫园门楼', to: '三穗堂', marginUsedM: r.margin, allowIds: [...allowIds], ...m, classification: m.clearWidthM >= 1.5 ? 'ok' : m.clearWidthM >= 0.9 ? 'narrow' : 'blocked', bridgedSpans: [] });
    }
  }
  for (let i = 0; i < stopInfo.length - 1; i++) {
    const A = stopInfo[i], B = stopInfo[i + 1];
    const segId = `gpath-${i}`;
    const r = routePair(A, B);
    const allowIds = new Set(r.allow.map(a => a.id));
    if (r.ok) {
      if (r.bridged) for (const s of r.spans) emitBridgeFor(segId, s);
      const m = measureSeg(r.pts, allowIds, bridgeLines);
      emit({
        id: segId, zone: 'garden', kind: 'path', lod: 'L1', disposition: 'rendered',
        geometry: { polyline: r.pts }, width: 2.0, height: 0.05,
        sources: {}, confidence: 'design-inference',
        inferences: [
          `v3 A* route at ${r.margin}m clearance; measured min centerline clearance ${m.minClearanceM}m (walkable width ${m.clearWidthM}m, target 1.5m)`,
          ...(r.bridged ? [`crosses mapped water only via minimal footbridge: ${r.spans.map(s => `${s.waterId}@${s.spanM}m`).join(', ')}`] : ['fully dry route; water/building outlines untouched']),
        ],
        replacesDesign: 'v2 gpath polyline (single-kink detour)',
      });
      routeAudit.segments.push({
        segment: segId, from: stopNames[i], to: stopNames[i + 1],
        marginUsedM: r.margin, allowIds: [...allowIds], ...m,
        classification: m.clearWidthM >= 1.5 ? 'ok' : m.clearWidthM >= 0.9 ? 'narrow' : 'blocked',
        ...(m.clearWidthM < 1.5 ? { narrowReason: m.pinchKind === 'water' ? 'mapped water bank' : m.pinchKind === 'wall' ? 'design wall alignment' : 'source building spacing (OSM footprints)' } : {}),
        bridgedSpans: r.bridged ? r.spans : [],
      });
    } else {
      // 客观无法解决的详细缺口：干绕行不存在（0.45m 净距下 A* 失败）且可跨弦 >12m 不允许搭桥
      emit({
        id: `route-constraint-${i}`, zone: 'garden', kind: 'routeConstraint', lod: '-', disposition: 'rendered',
        geometry: { polyline: [A.pt, B.pt] }, segmentRef: segId,
        sources: {}, confidence: 'source-data constraint record',
        reason: `no dry route at 0.45m clearance (A* exhausted) and admissible bridge refused (water chords on best building-only route: ${r.directSpans.map(s => `${s.waterId}@${s.spanM}m`).join(', ') || 'none'}; bridging allowed only <=12m) — recorded, water/building outlines untouched`,
      });
      routeAudit.segments.push({ segment: segId, from: stopNames[i], to: stopNames[i + 1], status: 'unresolved-constraint', allowIds: [...allowIds], directWaterSpans: r.directSpans });
    }
  }
  layoutExtras.gardenRouteAudit = routeAudit;
}

// ---------- 玉华堂 月洞门墙（G2；G16 参照；不阻挡园路才放置） ----------
{
  const yh = objects.find(o => o.name === '玉华堂');
  if (yh && yh.nodeFocus && yh.nodeFocus.moonGate) {
    const fp = yh.geometry.footprint;
    const c = centroid(fp);
    const dir = yh.facade.dir;
    const perp = [-dir[1], dir[0]];
    const bb = bbox(fp);
    const off = Math.max(bb.w, bb.d) / 2 + 3.5;
    const pathPolys = objects.filter(o => o.kind === 'path' && o.zone === 'garden').map(o => o.geometry.polyline);
    const otherFps = objects.filter(o => o.zone === 'garden' && o.geometry.footprint && o.id !== yh.id).map(o => o.geometry.footprint);
    const wallObj = objects.find(o => o.id === 'garden-wall');
    const wallSegs = wallObj ? wallObj.geometry.segments : [];
    const waters = objects.filter(o => o.kind === 'water' && o.zone === 'garden').map(o => o.geometry.footprint);
    // 候选：facade 前方基准位 + 沿墙向 ±2.5/5m 滑动；要求距园路 ≥2.2m、建筑 ≥1.2m、园墙 ≥1.5m、水面 ≥2m
    let placed = null, tried = [];
    for (const slide of [0, 2.5, -2.5, 5, -5]) {
      const cx = c[0] + dir[0] * off + perp[0] * slide, cz = c[1] + dir[1] * off + perp[1] * slide;
      const ends = [[cx - perp[0] * 2.3, cz - perp[1] * 2.3], [cx + perp[0] * 2.3, cz + perp[1] * 2.3]];
      let ok = true;
      for (const pl of pathPolys) for (const e of [...ends, [cx, cz]]) if (distToPolyline(e, pl) < 2.2) ok = false;
      for (const f of otherFps) for (const e of [...ends, [cx, cz]]) {
        if (pointInPoly(e, f) || distToPolyline(e, [...f, f[0]]) < 1.2) ok = false;
      }
      for (const s of wallSegs) for (const e of [...ends, [cx, cz]]) if (distToSeg(e, s[0], s[1]) < 1.5) ok = false;
      for (const w of waters) for (const e of [...ends, [cx, cz]]) if (pointInPoly(e, w) || distToPolyline(e, [...w, w[0]]) < 2) ok = false;
      tried.push({ slide, ok });
      if (ok) { placed = { x: +cx.toFixed(2), z: +cz.toFixed(2), rotY: +Math.atan2(perp[0], perp[1]).toFixed(3), slideM: slide }; break; }
    }
    if (placed) {
      emit({
        id: 'yuhuatang-moongate', zone: 'garden', kind: 'moonGateWall', name: '玉华堂月洞门（示意）', lod: 'L1', disposition: 'rendered',
        geometry: { position: [placed.x, placed.z], rotY: placed.rotY }, width: 4.6, height: 2.6, thickness: 0.35, openingR: 1.05,
        sources: {}, confidence: 'design-inference',
        inferences: [
          'freestanding moon-gate screen wall in front of 玉华堂 per PARTS G16 (real photo 0004-015 shows 月洞门 by the hall court)',
          `placed at facade offset ${off.toFixed(1)}m slide ${placed.slideM}m; clearance kept: garden paths >=2.2m, buildings >=1.2m, garden wall >=1.5m, water >=2m — A* garden routes unaffected`,
        ],
      });
      yh.nodeFocus.moonGatePlaced = true;
    }
    layoutExtras.gardenMoonGate = { placed: !!placed, at: placed, candidates: tried, ...(placed ? {} : { reason: 'no candidate cleared all path/building/wall/water clearances; honest skip, no forced placement' }) };
  }
}

// ---------- 豫园假山 ----------
{
  const gardenFps = byZone.garden.map(x => x.b.points);
  const clearOfBuildings = (x, z, m) => {
    for (const fp of gardenFps) {
      if (pointInPoly([x, z], fp)) return false;
      if (distToPolyline([x, z], fp) < m) return false;
    }
    return true;
  };
  const mk = (id, cx, cz, n, spread, hmax, label, minClear = 4) => {
    let s = id.length * 7919;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const rocks = [];
    for (let i = 0; i < n * 3 && rocks.length < n; i++) {
      const x = cx + (rnd() - 0.5) * spread, z = cz + (rnd() - 0.5) * spread * 0.7;
      if (!clearOfBuildings(x, z, minClear)) continue;
      rocks.push({
        x: +x.toFixed(2), z: +z.toFixed(2),
        size: +(1.6 + rnd() * spread * 0.16).toFixed(2), h: +(1.6 + rnd() * rnd() * hmax).toFixed(2), seed: 100 + i,
      });
    }
    emit({
      id, zone: 'garden', kind: 'rockery', name: label, lod: 'L1', disposition: 'rendered',
      geometry: { rocks }, height: hmax,
      sources: {}, confidence: 'design-inference',
      inferences: ['position/extent design-inferred from classical layout relations; not surveyed'],
    });
    labels.push({ id, text: label, x: cx, z: cz, kind: 'garden' });
  };
  // 大假山：池 428179908 北岸高地（设计位置）；望江亭坐落其上，萃秀堂让位
  mk('rockery-dajiashan', -160, -233, 16, 26, 9.5, '大假山（示意）', 4.5);
  // 玉玲珑院：用其 OSM 点位补岩石群（若上面循环未生成对应体）
  const yl = objects.find(o => o.name === '玉玲珑');
  if (!yl) mk('rockery-yulinglong', -88, -131, 5, 8, 4.6, '玉玲珑（示意）');
}

// ---------- 豫园树木（读图用简化体块） ----------
{
  let s = 42;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gb = bbox(zones.garden.polygon);
  let placed = 0, tries = 0;
  const footprints = byZone.garden.map(x => x.b.points);
  while (placed < 46 && tries++ < 600) {
    const x = gb.x0 + rnd() * gb.w, z = gb.z0 + rnd() * gb.d;
    if (!pointInPoly([x, z], zones.garden.polygon)) continue;
    let clear = true;
    for (const fp of footprints) {
      const c = centroid(fp);
      if (dist2d([x, z], c) < 5.2) { clear = false; break; }
    }
    if (!clear) continue;
    if (distToPolyline([x, z], zones.garden.polygon) < 4) continue;
    emit({
      id: `gtree-${placed}`, zone: 'garden', kind: 'tree', lod: 'L1', disposition: 'rendered',
      geometry: { position: [x, z] }, height: 4.5 + rnd() * 3,
      sources: {}, confidence: 'design-inference',
      inferences: ['simplified canopy blocks for map reading; positions avoid named halls'],
    });
    placed++;
  }
}

// ---------- 九曲桥 + 湖心亭（pond 独立归区，真实几何） ----------
{
  const bridge = ovWay.get(62072384);
  if (bridge) {
    emit({
      id: 'jiuqu-bridge', zone: 'pond', kind: 'zigzagBridge', name: '九曲桥', lod: 'L1', disposition: 'rendered',
      geometry: { polyline: bridge.geo }, width: 2.4, deckY: 0.55,
      sources: { osmWay: 62072384 }, confidence: 'centerline from OSM way 62072384',
      inferences: ['deck width/railings design-inferred'],
    });
    labels.push({ id: 'jiuqu-bridge', text: '九曲桥', x: bridge.geo[8][0], z: bridge.geo[8][1], kind: 'pond' });
  }
  const hxt = ovWay.get(228035340);
  if (hxt) {
    emit({
      id: 'huxin-ting', zone: 'pond', kind: 'tower', name: '湖心亭', lod: 'L1', disposition: 'rendered',
      geometry: { footprint: hxt.geo }, height: 4.4, eave: 3.6, rise: 1.9, roofMode: 'hip', storeys: 2,
      platformY: 0.55,
      sources: { osmWay: 228035340 }, confidence: 'footprint from OSM; form category inference',
      inferences: ['storey count/roof design-inferred; teahouse on piles over pond'],
    });
    labels.push({ id: 'huxin-ting', text: '湖心亭', x: centroid(hxt.geo)[0], z: centroid(hxt.geo)[1], kind: 'pond' });
  }
  // 池西联系（v2 改造）：v1 装饰短桥东端落在水面中部（该处池宽约 48m，无着岸依据），
  // 按"桥必须两端着岸"改为西岸滨水步道：自九曲桥西落岸点沿西岸向北，边界外偏 1.5m。
  const pw = pondWater.points;
  const pbb = bbox(pw);
  const pCent = centroid(pw);
  const west = pw.filter(p => p[0] < pCent[0] - pbb.w * 0.25).sort((a, b) => b[1] - a[1]);
  const start = bridge ? bridge.geo[0] : [-176, -110];
  const westPts = [start];
  for (const p of west) {
    if (p[1] > start[1] + 2) continue; // 只取落岸点以北
    const dx = p[0] - pCent[0], dz = p[1] - pCent[1];
    const l = Math.hypot(dx, dz) || 1;
    const q = [p[0] + (dx / l) * 1.5, p[1] + (dz / l) * 1.5];
    if (dist2d(westPts[westPts.length - 1], q) > 3) westPts.push(q);
  }
  emit({
    id: 'pond-west-link', zone: 'pond', kind: 'path', name: '池西滨水步道', lod: 'L1', disposition: 'rendered',
    geometry: { polyline: westPts }, width: 1.8, height: 0.05,
    sources: {}, confidence: 'design-inference',
    replacesDesign: 'pond-west-link (v1 decorative bridge; its east end landed mid-water at the 48m-wide reach)',
    inferences: [
      'v1 bridge replaced by west-bank shore walk: still design-inference, no fabricated water crossing',
      'polyline offsets pond boundary 1.5m onto land; runs from the 九曲桥 west landing to the pond north neck shore',
    ],
  });
  // 桥端高差过渡（v3/G1）：桥面 0.55 vs 岸面 ~0.04，>0.1m 高差须有可见台阶；
  // 连通检查会把"高差无过渡"记硬违规，两端各一组 design-inference 台阶。
  if (bridge) {
    const ends = [[bridge.geo[0], bridge.geo[1], 'w'], [bridge.geo[bridge.geo.length - 1], bridge.geo[bridge.geo.length - 2], 'e']];
    for (const [e, nxt, tag] of ends) {
      const dx = nxt[0] - e[0], dz = nxt[1] - e[1], l = Math.hypot(dx, dz) || 1;
      emit({
        id: `jiuqu-bridge-step-${tag}`, zone: 'pond', kind: 'steps', lod: 'L1', disposition: 'rendered',
        geometry: {
          position: [e[0] - (dx / l) * 0.75, e[1] - (dz / l) * 0.75],
          rotY: Math.atan2(dx, dz), width: 2.4, bottomY: 0.04, topY: 0.55, stepCount: 4,
        },
        sources: {}, confidence: 'design-inference',
        inferences: ['landing steps bridging deck 0.55 to ground ~0.04; visible height transition required by v3 connectivity rule'],
      });
    }
  }
}

// ---------- 城隍庙：既有设计轴（v3 精修件）映射到地图系 ----------
const TEMPLE_V3 = path.join(ROOT, 'resources/temple-v3');
{
  const v3 = JSON.parse(fs.readFileSync(path.join(TEMPLE_V3, 'instances.json'), 'utf8'));
  const SX = -127.817, SZ = 27.057, YAW = 0.16703, WX = 53.5, WZ = -17.4;
  const cs = Math.cos(YAW), sn = Math.sin(YAW);
  const toMap = (lx, lz) => [WX + SX + lx * cs + lz * sn, WZ + SZ - lx * sn + lz * cs];
  const MODULE_FILE = {
    'temple-shanmen': 'temple.glb', 'temple-entry-court-v3': 'entry-court-v3.glb',
    'yimen-pilot': 'yimen.glb', 'yimen-stage': 'yimen-stage.glb', 'dadian-court-v2': 'dadian-court-v2.glb',
    'peidian': 'peidian.glb', 'gallery': 'gallery.glb', 'dadian': 'dadian.glb',
    'court3': 'court3.glb', 'houdian': 'houdian.glb', 'temple-tree-camphor': 'tree-camphor-v2.glb',
  };
  const zh = {
    shanmen: '山门', entrycourt: '前院（香道/宝鼎）', yimen: '仪门', yimenstage: '仪门戏楼',
    dadiancourt: '大殿庭院', 'peidian-w': '西配殿', 'peidian-e': '东配殿',
    'gallery-w': '西廊庑', 'gallery-e': '东廊庑', dadian: '大殿', court3: '后院/穿廊', houdian: '后殿',
  };
  const seen = new Map();
  for (const inst of v3.instances) {
    const file = MODULE_FILE[inst.module];
    if (!file) continue;
    const [mx, mz] = toMap(inst.positionGlb[0], inst.positionGlb[2]);
    const rotY = YAW + (inst.rotationYRad || 0);
    if (!seen.has(file)) {
      const abs = path.join(TEMPLE_V3, file);
      seen.set(file, {
        module: inst.module, file, sha256: sha256(abs), bytes: fs.statSync(abs).size,
        sourcePath: 'pawborough-world-ten-hour-20260921/workspace/world/temple-axis-v3/' + file,
      });
    }
    instances.push({
      id: `temple-${inst.id}`, module: inst.module, file, zone: 'temple', lod: 'L2',
      position: [mx, mz], rotY,
      sourcePath: seen.get(file).sourcePath, sha256: seen.get(file).sha256, ownerAdopted: false,
      axis: 'module local frame (shanmen threshold origin, +Z south) -> map via yaw 0.16703 & shanmen anchor',
    });
    emit({
      id: `temple-${inst.id}`, zone: 'temple', kind: 'templeAnchor', name: zh[inst.id] || inst.id, lod: 'L2',
      disposition: 'reused', geometry: { position: [mx, mz], rotY },
      sources: { osmWay: null, designAxis: 'temple-axis-v3 instances.json', sha256: seen.get(file).sha256 },
      confidence: 'existing refined design (owner pending adoption); positions from assembled v3 axis',
      inferences: ['L2 module embedded read-only; no re-modelling this batch'],
    });
    if (!['gallery-w', 'gallery-e', 'peidian-w', 'peidian-e'].includes(inst.id) && !inst.id.startsWith('tree'))
      labels.push({ id: `temple-${inst.id}`, text: zh[inst.id] || inst.id, x: mx, z: mz, kind: 'temple' });
  }
  // 庙区配准 v3（本批 G1）：OSM 可识别轮廓对应 + 刚体候选比较 + 按授权采用。
  // v2 bug：Kabsch 叉积项反号导致旋转反向（v2 报告的拟合后均值 14.1m 实际比不动的 13.9m 更差，
  // 当时"只报告不移动"歪打正着地避免了采用一个错误拟合）；v3 修正符号、比较候选、按规则采用。
  const glbPlanBounds = (file) => {
    const buf = fs.readFileSync(file);
    const jl = buf.readUInt32LE(12);
    const j = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of j.meshes || []) for (const p of m.primitives || []) {
      const acc = j.accessors[p.attributes.POSITION];
      if (!acc.min || !acc.max) continue;
      x0 = Math.min(x0, acc.min[0]); x1 = Math.max(x1, acc.max[0]);
      z0 = Math.min(z0, acc.min[2]); z1 = Math.max(z1, acc.max[2]);
    }
    return Number.isFinite(x0) ? { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0 } : null;
  };
  const AXIS_ANCHORS = ['shanmen', 'yimen', 'dadian', 'houdian']; // 沿轴次序（v3 local +Z 南北链）
  const anchorInst = Object.fromEntries(AXIS_ANCHORS.map(a => [a, instances.find(i => i.id === `temple-${a}`)]));
  const p0 = anchorInst.shanmen.position, p3 = anchorInst.houdian.position;
  const axLen = dist2d(p0, p3) || 1;
  const axU = [(p3[0] - p0[0]) / axLen, (p3[1] - p0[1]) / axLen];
  const axisProj = (p) => [(p[0] - p0[0]) * axU[0] + (p[1] - p0[1]) * axU[1], -(p[0] - p0[0]) * axU[1] + (p[1] - p0[1]) * axU[0]];
  const anchorT = Object.fromEntries(AXIS_ANCHORS.map(a => [a, axisProj(anchorInst[a].position)[0]]));
  // 每个轮廓：轴向投影 → 沿轴距离最近的锚为候选对应（同类锚取最近者用于拟合）
  const outlines = byZone.temple.map(({ b }) => {
    const c = centroid(b.points);
    const [t, u] = axisProj(c);
    let anchor = null, ad = Infinity;
    for (const a of AXIS_ANCHORS) {
      const d = Math.abs(t - anchorT[a]) + Math.abs(u) * 0.5;
      if (d < ad) { ad = d; anchor = a; }
    }
    return { b, c, t, u, anchor, ad: +ad.toFixed(1) };
  });
  const usedForFit = {};
  for (const o of outlines) {
    if (!usedForFit[o.anchor] || o.ad < usedForFit[o.anchor].ad) usedForFit[o.anchor] = o;
  }
  const fitPairs = AXIS_ANCHORS.filter(a => usedForFit[a]).map(a => [usedForFit[a].c, anchorInst[a].position]);
  // 2D Kabsch（无缩放）：osm→design。叉积项 Σ a×b（v2 反号已修正）。
  const cO = [0, 1].map(k => fitPairs.reduce((s, pr) => s + pr[0][k], 0) / (fitPairs.length || 1));
  const cD = [0, 1].map(k => fitPairs.reduce((s, pr) => s + pr[1][k], 0) / (fitPairs.length || 1));
  const reg = (() => {
    if (fitPairs.length < 2) return { rotation: 0, tx: 0, tz: 0, pairs: fitPairs.length };
    let sxx = 0, sxy = 0;
    for (const [osm, des] of fitPairs) {
      const ax = osm[0] - cO[0], az = osm[1] - cO[1];
      const bx = des[0] - cD[0], bz = des[1] - cD[1];
      sxx += ax * bx + az * bz;
      sxy += ax * bz - az * bx;
    }
    const theta = Math.atan2(sxy, sxx);
    const cs = Math.cos(theta), sn = Math.sin(theta);
    return { rotation: +theta.toFixed(4), tx: +(cD[0] - (cO[0] * cs - cO[1] * sn)).toFixed(2), tz: +(cD[1] - (cO[0] * sn + cO[1] * cs)).toFixed(2), pairs: fitPairs.length };
  })();
  const applyFitF = (f) => {
    const cs = Math.cos(f.rotation), sn = Math.sin(f.rotation);
    return (p) => [p[0] * cs - p[1] * sn + f.tx, p[0] * sn + p[1] * cs + f.tz];
  };
  const invertFitF = (f) => {
    const cs = Math.cos(-f.rotation), sn = Math.sin(-f.rotation);
    return (p) => [p[0] * cs - p[1] * sn - (cs * f.tx - sn * f.tz), p[0] * sn + p[1] * cs - (sn * f.tx + cs * f.tz)];
  };
  // 模块包络角点（当前位姿）+ 影响（对公共道路/庙墙环净距；墙环取完整环=保守下界）
  const templeRing = offsetPoly(zones.temple.polygon, -2.0);
  const moduleCorners = () => instances.filter(i => i.zone === 'temple').map(inst => {
    let bounds = null;
    try { bounds = glbPlanBounds(path.join(TEMPLE_V3, MODULE_FILE[inst.module] || '')); } catch { bounds = null; }
    if (!bounds) return null;
    const hw = bounds.w / 2, hd = bounds.d / 2;
    const cs = Math.cos(inst.rotY), sn = Math.sin(inst.rotY);
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) =>
      [inst.position[0] + lx * cs + lz * sn, inst.position[1] - lx * sn + lz * cs]);
    return { id: inst.id, module: inst.module, planBoundsM: [+bounds.w.toFixed(1), +bounds.d.toFixed(1)], corners };
  }).filter(Boolean);
  const publicRoads = map.roads.filter(rp => !rp.points.some(q => pointInPoly(q, zones.temple.polygon) || distToPolyline(q, zones.temple.polygon) < 6));
  const distToRing = (q) => {
    let d = Infinity;
    for (let i = 0; i < templeRing.length; i++) d = Math.min(d, distToSeg(q, templeRing[i], templeRing[(i + 1) % templeRing.length]));
    return d;
  };
  const impactOf = (f) => {
    const inv = invertFitF(f);
    let roadMin = Infinity, wallMin = Infinity;
    for (const mci of moduleCorners()) {
      for (const rp of publicRoads) for (const c of mci.corners) roadMin = Math.min(roadMin, distToPolyline(inv(c), rp.points));
      if (!mci.module.startsWith('temple-tree')) {
        // PLAN：树不参与庙区配准；树冠贴院墙不作为采用门槛（建筑模块才计墙净距）
        for (const c of mci.corners) wallMin = Math.min(wallMin, distToRing(inv(c)));
      }
    }
    return { minClearToPublicRoadM: +roadMin.toFixed(1), minClearToTempleWallM: +wallMin.toFixed(1) };
  };
  // 候选比较与采用：可行（道路净距≥2m 且庙墙净距≥0.5m）者中取均值残差最小；
  // 差距 <0.5m 视为持平、取更简单候选；全部不可行则不移动并如实记录。
  const candidateDefs = [
    { name: 'no-move', rotation: 0, tx: 0, tz: 0 },
    { name: 'translation-only', rotation: 0, tx: +(cD[0] - cO[0]).toFixed(2), tz: +(cD[1] - cO[1]).toFixed(2) },
    { name: 'rigid-kabsch', rotation: reg.rotation, tx: reg.tx, tz: reg.tz },
  ];
  const candidates = candidateDefs.map(f => {
    const applyF = applyFitF(f);
    const res = fitPairs.map(([osm, des]) => dist2d(applyF(osm), des));
    return {
      name: f.name, rotation: f.rotation, tx: f.tx, tz: f.tz,
      meanResidualM: +(res.reduce((s, v) => s + v, 0) / (res.length || 1)).toFixed(1),
      rmsResidualM: +Math.sqrt(res.reduce((s, v) => s + v * v, 0) / (res.length || 1)).toFixed(1),
      maxResidualM: +Math.max(...res, 0).toFixed(1),
      impact: impactOf(f),
    };
  });
  // 择优用 RMS（Kabsch 最小化的正是 Σd²；v3 初版误用 mean 导致刚体最优反而落选）。
  // 门槛：道路净距 ≥2.0m（含树模块，保守）；墙净距 ≥ max(0.15, no-move −0.3)（不显著恶化，仅建筑模块）。
  const base = candidates[0];
  const wallGate = Math.max(0.15, base.impact.minClearToTempleWallM - 0.3);
  let adopted = base;
  for (const c of candidates.slice(1)) {
    const roadOK = c.impact.minClearToPublicRoadM >= 2.0;
    const wallOK = c.impact.minClearToTempleWallM >= wallGate;
    c.rejectedBecause = roadOK && wallOK ? null : `impact check failed (road ${c.impact.minClearToPublicRoadM}m vs >=2.0: ${roadOK}; wall ${c.impact.minClearToTempleWallM}m vs gate ${wallGate.toFixed(2)}: ${wallOK})`;
    if (roadOK && wallOK && c.rmsResidualM < adopted.rmsResidualM - 0.2) adopted = c;
  }
  for (const c of candidates) c.adopted = c.name === adopted.name;
  // 应用：整组庙区实例/标签做逆刚体变换（design→osm）；整体平移+旋转，尺寸/单件/轴线不变
  const invAdopted = invertFitF(adopted);
  const moved = adopted.name !== 'no-move';
  const anchorOrig = Object.fromEntries(AXIS_ANCHORS.map(a => [a, [...anchorInst[a].position]]));
  if (moved) {
    for (const inst of instances.filter(i => i.zone === 'temple')) {
      const q = invAdopted(inst.position);
      inst.position = [+q[0].toFixed(3), +q[1].toFixed(3)];
      inst.rotY = +(inst.rotY + adopted.rotation).toFixed(5);
      inst.designAdjustment = `whole-cluster rigid fit v3 (${adopted.name}): design moved onto contemporary OSM temple outlines; no scale, module GLBs untouched`;
    }
    for (const L of labels) if (L.kind === 'temple') { const q = invAdopted([L.x, L.z]); L.x = +q[0].toFixed(2); L.z = +q[1].toFixed(2); }
  }
  const applyAdopted = applyFitF(adopted);
  const pairResiduals = fitPairs.map(([osm, des]) => +dist2d(applyAdopted(osm), des).toFixed(1));
  // 庙区边界墙（低环，保留与商业区边界/进出关系）；山门开口锚随刚体调整联动
  const openAnchor = moved ? invAdopted(toMap(0, 6)) : toMap(0, 6);
  const ring = templeRing;
  const segs = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // 山门前（南侧 z 最大段）留开口；避让道路与邻区
    if (dist2d(mid, openAnchor) < 12) continue;
    let blocked = false;
    for (const z of ZONE_ORDER) if (z !== 'temple' && pointInPoly(mid, zones[z].polygon) && distToPolyline(mid, zones[z].polygon) < 3) blocked = true;
    for (const rp of facadeRoads) if (distToPolyline(mid, rp) < 8) blocked = true;
    if (!blocked) segs.push([a, b]);
  }
  emit({
    id: 'temple-wall', zone: 'temple', kind: 'wall', name: '庙区院墙（走向示意）', lod: 'L1', disposition: 'rendered',
    geometry: { segments: segs }, height: 2.6, thickness: 0.4,
    sources: { base: 'temple zone boundary' }, confidence: 'design-inference',
    inferences: [
      'boundary wall follows temple zone polygon inset 2m; south opening at shanmen axis',
      ...(moved ? ['wall ring unchanged (zone boundary is source data); opening anchor follows the rigid-fit-adjusted shanmen axis'] : []),
    ],
  });
  // 模块外包络 vs 邻区公共道路/庙墙净距（采用后位姿；墙净距含树模块仅作记录，门槛只看建筑）
  const moduleRoadCheck = [];
  for (const mci of moduleCorners()) {
    let clear = Infinity, wallClear = Infinity;
    for (const rp of publicRoads) for (const c of mci.corners) clear = Math.min(clear, distToPolyline(c, rp.points));
    for (const c of mci.corners) wallClear = Math.min(wallClear, distToRing(c));
    moduleRoadCheck.push({ id: mci.id, module: mci.module, planBoundsM: mci.planBoundsM, clearToPublicRoadM: +clear.toFixed(1), clearToTempleWallM: +wallClear.toFixed(1), intrusion: clear < 1.0 });
  }
  layoutExtras.templeRegistration = {
    method: 'v3: named/recognizable outline correspondence (axis-order anchors 山门→仪门→大殿→后殿); sign-fixed 2D rigid Kabsch; candidates {no-move, translation-only, rigid-kabsch} compared; adopted candidate applied as whole-cluster rigid design adjustment (no scale, no per-building moves, module GLBs untouched)',
    v2BugFix: 'v2 Kabsch cross-product term had reversed sign — its reported fit rotated the wrong way (post-fit mean 14.1m vs no-move 13.9m); v3 fixes the sign and re-decides',
    authority: 'PLAN G1 authorizes whole-cluster translation/rotation adoption into this package; ownerAdopted stays false (candidate adjustment, not owner adoption)',
    adopted: {
      name: adopted.name, rotation: adopted.rotation, tx: adopted.tx, tz: adopted.tz,
      meanResidualM: adopted.meanResidualM, rmsResidualM: adopted.rmsResidualM, maxResidualM: adopted.maxResidualM,
      impact: adopted.impact, designAdjustmentApplied: moved,
      rule: 'min RMS residual among feasible (road>=2.0m all modules; temple-wall>=no-move-0.3m buildings only); hysteresis 0.2m RMS',
    },
    candidates,
    pairs: Object.entries(usedForFit).map(([a, o]) => ({
      outline: `osmoutline-${o.b.id}`, outlineName: tagsOf(o.b.id).name || null, anchor: a,
      rawCentroidDeltaM: +dist2d(o.c, anchorOrig[a]).toFixed(1),
      residualAfterAdoptionM: +dist2d(applyAdopted(o.c), anchorOrig[a]).toFixed(1),
    })),
    pairResidualsAfterFitM: pairResiduals,
    meanResidualM: +(pairResiduals.reduce((s, v) => s + v, 0) / (pairResiduals.length || 1)).toFixed(1),
    rawMeanCentroidDeltaM: +(fitPairs.reduce((s, pr) => s + dist2d(pr[0], pr[1]), 0) / (fitPairs.length || 1)).toFixed(1),
    unresolved: pairResiduals.some(v => v > 12) ? ['per-building relative shifts between OSM outlines and the rigid design axis remain after the best rigid fit — not removable by whole-cluster alignment; honestly retained, not claimed as accurate restoration'] : [],
    moduleRoadClearance: moduleRoadCheck,
  };
  for (const o of outlines) {
    const { b, c, anchor, t, u } = o;
    const anchorMap = anchorInst[anchor].position;
    emit({
      id: `osmoutline-${b.id}`, zone: 'temple', kind: 'osmTempleOutline', name: tagsOf(b.id).name || null, lod: '-',
      disposition: 'replaced-by-design',
      reason: 'temple zone outlines conflict with the assembled v3 design axis; owner instruction: keep whole cluster on the design axis, no non-uniform stretching of adopted models',
      geometry: { footprint: b.points },
      correspondence: {
        anchorInstance: `temple-${anchor}`, anchorName: zh[anchor] || anchor,
        centroidDeltaM: +dist2d(c, anchorMap).toFixed(1),
        alongAxisM: +(t - anchorT[anchor]).toFixed(1), crossAxisM: +u.toFixed(1),
        usedForFit: !!usedForFit[anchor] && usedForFit[anchor].b.id === b.id,
      },
      sources: { osmWay: b.id }, confidence: 'contemporary OSM outline retained in layout only (not extruded)',
      inferences: ['kept as ground-source record; not rendered as volumes to avoid double buildings'],
    });
    labels.push({ id: `osmoutline-${b.id}`, text: 'OSM轮廓(未拉伸)', x: c[0], z: c[1], kind: 'osm-note', note: true });
  }
  // 庙区剩余建筑（外围到 zone 的其它轮廓已在 outer；此处不再补体）
}

// ---------- 豫园商城：大楼壳 + 开间门面 + 店屋实例 + 摊位 ----------
// （SHOP_UNITS/SHOP_SHA/TRADE 已在文件前部定义）

// 与 facadeRoads 平行的道路元数据（名/ID/宽度），用于门面街段归属记录
const facadeRoadEntries = map.roads.filter(r => r.width >= 5 || FACADE_STREET_NAMES.includes(r.name));

function nearestRoadInfo(edgeMid, list = facadeRoads) {
  let best = null, bd = Infinity, bestIdx = -1;
  for (let i = 0; i < list.length; i++) {
    const rp = list[i];
    const d = distToPolyline(edgeMid, rp);
    if (d < bd) { bd = d; best = rp; bestIdx = i; }
  }
  return { d: bd, road: best, entry: bestIdx >= 0 ? facadeRoadEntries[bestIdx] : null };
}


function emitFacadeBays(bldId, edge, faceDir, shellH, zone, street) {
  const len = dist2d(edge[0], edge[1]);
  if (len < 5) return 0;
  const [ax, az] = edge[0], [bx, bz] = edge[1];
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  const nBay = Math.max(1, Math.round(len / 5.0));
  const bayW = len / nBay;
  // 相邻楼块轮廓（OSM 共墙重叠）：开间落进邻块内部 = 会被邻楼埋没，不是真门面
  const otherFps = byZone.bazaar.filter(x => `bld-${x.b.id}` !== bldId).map(x => x.b.points);
  const buried = (p) => otherFps.some(fp => pointInPoly(p, fp) || distToPolyline(p, fp) < 0.4);
  let made = 0, suppressed = 0;
  for (let i = 0; i < nBay; i++) {
    const t = (i + 0.5) * bayW;
    const cx = ax + ux * t, cz = az + uz * t;
    if (buried([cx, cz])) { suppressed++; facadeId++; continue; }
    emit({
      id: `facade-${facadeId}`, zone, kind: 'facadeBay', lod: 'L1', disposition: 'rendered',
      geometry: { position: [cx, cz], rotY: Math.atan2(faceDir[0], faceDir[1]), width: bayW * 0.94, dir: [faceDir[0], faceDir[1]] },
      height: Math.min(shellH, 4.2), parentBuilding: bldId, street,
      trade: TRADE[facadeId % TRADE.length],
      sources: { parentOsmWay: bldId }, confidence: 'bay rhythm design-inferred on real street-facing edge',
      inferences: ['storefront split/bay width design-inferred; trade is candidate label only, no invented historic shop names'],
    });
    made++;
  }
  if (suppressed) facadeStats.baysSuppressed = (facadeStats.baysSuppressed || 0) + suppressed;
  facadeStats.segments.push({ building: bldId, street: street || null, edgeLenM: +len.toFixed(1), bays: made, suppressed: suppressed || undefined });
  return made;
}

for (const { b, t } of byZone.bazaar) {
  const area = Math.abs(polyArea(b.points));
  const bb = bbox(b.points);
  const name = t.name || null;
  const levels = Math.min(4, Math.max(1, parseInt(t['building:levels'] || '2', 10) || 2));
  const big = area > 400 || Math.max(bb.w, bb.d) > 30;
  if (big) {
    // 大楼壳：屋面模式如实记录来源——OSM 无 roof:shape 不得谎称 mansard
    const roofTag = t['roof:shape'] || null;
    const designRoofMode = roofTag === 'mansard' ? 'mansard' : 'hip';
    const shellH = Math.min(15.5, levels * 3.4);
    // 临街边一次判定：bays 与立面分层共用同一组边（含街名归属）
    const frontEdges = [];
    for (let i = 0; i < b.points.length; i++) {
      const a = b.points[i], c = b.points[(i + 1) % b.points.length];
      const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const info = nearestRoadInfo(mid);
      if (info.d < 13) {
        let dx = c[0] - a[0], dz = c[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        const toRoad = [info.road[0][0] - mid[0], info.road[0][1] - mid[1]];
        const s = (nx * toRoad[0] + nz * toRoad[1]) > 0 ? 1 : -1;
        frontEdges.push({ edge: [a, c], dir: [s * nx, s * nz], lenM: +l.toFixed(1), street: info.entry ? info.entry.name : null, streetOsm: info.entry ? info.entry.id : null });
      }
    }
    emit({
      id: `bld-${b.id}`, zone: 'bazaar', kind: 'bazaarBlock', name, lod: 'L1', disposition: 'rendered',
      geometry: { footprint: b.points }, height: shellH, levels,
      roofMode: designRoofMode, designRoofMode,
      roofShapeSource: roofTag ? `osm roof:shape=${roofTag}` : 'category default hip (OSM roof:shape absent — not claimed as mansard)',
      frontEdges,
      sources: { osmWay: b.id, roofShapeTag: roofTag }, confidence: 'footprint/levels contemporary OSM; form simplified',
      inferences: [
        'big-block shell; storefronts split into bays on street edges (see facade-*)',
        roofTag ? null : 'roof mode is a category default, not an OSM tag',
      ].filter(Boolean),
    });
    if (name) labels.push({ id: `bld-${b.id}`, text: name, x: bb.cx, z: bb.cz, kind: 'bazaar' });
    // 临街边拆门面（同一组 frontEdges）
    let totalBays = 0;
    for (const fe of frontEdges) {
      totalBays += emitFacadeBays(`bld-${b.id}`, fe.edge, fe.dir, shellH, 'bazaar', fe.street);
    }
  } else {
    // 小块：店屋底模实例（贴最长边/最近街）
    let bestEdge = null, bestD = Infinity, bestRoad = null;
    for (let i = 0; i < b.points.length; i++) {
      const a = b.points[i], c = b.points[(i + 1) % b.points.length];
      const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const info = nearestRoadInfo(mid);
      if (info.d < bestD) { bestD = info.d; bestEdge = [a, c]; bestRoad = info.road; }
    }
    if (!bestEdge || bestD > 18 || area > 220) {
      emit({
        id: `bld-${b.id}`, zone: 'bazaar', kind: 'outerBuilding', name, lod: 'L1', disposition: 'rendered',
        geometry: { footprint: b.points }, height: Math.min(12, levels * 3.2),
        sources: { osmWay: b.id }, confidence: 'contemporary footprint; no street frontage resolved',
        inferences: ['kept as simple volume; no facade split (no adjacent street resolved)'],
      });
      continue;
    }
    const [ax, az] = bestEdge[0], [bx2, bz2] = bestEdge[1];
    const len = dist2d(bestEdge[0], bestEdge[1]);
    // 选宽度最接近的单元（不缩放）
    let unit = SHOP_UNITS[0];
    for (const u of SHOP_UNITS) if (Math.abs(u.w - len) < Math.abs(unit.w - len)) unit = u;
    const cx = (ax + bx2) / 2, cz = (az + bz2) / 2;
    const ux = (bx2 - ax) / len, uz = (bz2 - az) / len;
    const nx = -uz, nz = ux;
    const toRoad = [bestRoad[0][0] - cx, bestRoad[0][1] - cz];
    const s = (nx * toRoad[0] + nz * toRoad[1]) > 0 ? 1 : -1;
    // facade +Z：法线朝路 → rotY 使 +Z 指向 s*[nx,nz]
    const face = [s * nx, s * nz];
    const rotY = Math.atan2(face[0], face[1]); // +Z->(sinY,cosY)
    instances.push({
      id: `shopunit-${b.id}`, module: unit.module, zone: 'bazaar', lod: 'L2',
      position: [cx, cz], rotY,
      sourcePath: 'pawborough-shop-base-batch-20260921/workspace/out/' + unit.file,
      sha256: SHOP_SHA[unit.module].sha256, ownerAdopted: false,
      axis: 'GLB Y-up, facade +Z, depth -Z, origin front-wall center bottom; scale 1',
      placedWidthM: +len.toFixed(1), unitWidthM: unit.w,
    });
    facadeStats.shophouses++;
    emit({
      id: `shopunit-${b.id}`, zone: 'bazaar', kind: 'shopAnchor', name, lod: 'L2', disposition: 'reused',
      geometry: { position: [cx, cz], rotY }, parentFootprint: b.points,
      trade: TRADE[(facadeStats.shophouses * 5) % TRADE.length],
      sources: { osmWay: b.id, sha256: SHOP_SHA[unit.module].sha256 },
      confidence: 'footprint from OSM; unit base model from shop-base batch (read-only reuse)',
      inferences: [`OSM edge ${len.toFixed(1)}m fitted with nearest unit ${unit.module} (${unit.w}m); no scaling`],
    });
  }
}

// ---------- 豫园老街 / 粮厅路：店屋底模连续街面（成排，design rows） ----------
{
  const rowStreets = map.roads.filter(r => ['粮厅路'].includes(r.name));
  const bzFps = byZone.bazaar.map(x => x.b.points);
  const bazaarBlocks = objects.filter(o => o.kind === 'bazaarBlock');
  const pattern = ['shop-03-threebay', 'shop-01-narrow', 'shop-02-double', 'shop-04-recess', 'shop-01-narrow', 'shop-06-endcap'];
  const rowStats = [];
  let rowSeq = 0;
  for (const st of rowStreets) {
    let made = 0;
    for (const side of [-1, 1]) {
      let s = 0.5 + (side > 0 ? 0 : 0.45) * st.points.length; // 两排错开
      let i = 0;
      while (s < st.points.length - 0.6) {
        const t = Math.floor(s);
        const a = st.points[t], b = st.points[Math.min(st.points.length - 1, t + 1)];
        const segL = dist2d(a, b) || 1;
        const ux = (b[0] - a[0]) / segL, uz = (b[1] - a[1]) / segL;
        const unit = SHOP_UNITS.find(u => u.module === pattern[i % pattern.length]);
        const step = unit.w + 0.5;
        const frac = s - t;
        const px = a[0] + (b[0] - a[0]) * frac, pz = a[1] + (b[1] - a[1]) * frac;
        const off = st.width / 2 + 2.4;
        const nx = -uz * side, nz = ux * side;
        const cx = px + nx * off, cz = pz + nz * off;
        const rotY = Math.atan2(-nx, -nz); // facade +Z 朝向街道
        let ok = pointInPoly([cx, cz], zones.bazaar.polygon);
        // 与建筑轮廓净距：可贴墙（≥1.1m）但不得压墙
        if (ok) for (const fp of bzFps) {
          if (pointInPoly([cx, cz], fp)) { ok = false; break; }
          if (distToPolyline([cx, cz], fp) < 1.1) { ok = false; break; }
        }
        // 门洞/路口净空：只看真正的街（主次干道/有名步行街），3.5m 小巷不挡店面
        if (ok) for (const rp of facadeRoads) if (rp !== st.points && distToPolyline([cx, cz], rp) < 2.5) { ok = false; break; }
        if (ok) {
          rowSeq++;
          made++;
          instances.push({
            id: `strow-${rowSeq}`, module: unit.module, zone: 'bazaar', lod: 'L2',
            position: [cx, cz], rotY, rowStreet: st.name,
            sourcePath: 'pawborough-shop-base-batch-20260921/workspace/out/' + unit.file,
            sha256: SHOP_SHA[unit.module].sha256, ownerAdopted: false,
            axis: 'GLB Y-up, facade +Z, depth -Z, origin front-wall center bottom; scale 1',
          });
          emit({
            id: `strow-${rowSeq}`, zone: 'bazaar', kind: 'shopAnchor', name: null, lod: 'L2', disposition: 'reused',
            geometry: { position: [cx, cz], rotY }, rowStreet: st.name, trade: TRADE[(rowSeq * 3) % TRADE.length],
            sources: { sha256: SHOP_SHA[unit.module].sha256 }, confidence: 'design-inference row on real pedestrian street',
            inferences: ['shop row placement design-inferred along OSM 豫园老街/粮厅路; no historic shop addresses claimed'],
          });
        }
        s += step / segL;
        i++;
      }
    }
    if (made) rowStats.push({ street: st.name, osmWay: st.id, units: made });
    // 店前连续铺装带（v2：替代逐店叠置垫座，避免同高平面叠放 Z-fighting）：
    // 每侧一条，位于路缘与店前线之间（off = width/2 + 1.2，宽 2.4m，顶面 0.085）
    for (const side of [-1, 1]) {
      const strip = st.points.map((p, pi) => {
        const i0 = Math.max(0, pi - 1), i1 = Math.min(st.points.length - 1, pi + 1);
        let dx = st.points[i1][0] - st.points[i0][0], dz = st.points[i1][1] - st.points[i0][1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l * side, nz = dx / l * side;
        const off = st.width / 2 + 1.2;
        return [p[0] + nx * off, p[1] + nz * off];
      });
      emit({
        id: `paving-${st.id}-${side > 0 ? 'e' : 'w'}`, zone: 'bazaar', kind: 'paving', name: `${st.name}店前铺装`, lod: 'L1', disposition: 'rendered',
        geometry: { polyline: strip }, width: 2.4, height: 0.085,
        sources: {}, confidence: 'design-inference',
        inferences: ['continuous shopfront paving strip replacing per-unit stacked pads; single plane, distinct height from road(0.02)/path(0.05)'],
      });
      facadeStats.paving = (facadeStats.paving || 0) + 1;
    }
  }
  facadeStats.rows = rowStats;
}

// ---------- G3 摊位组团：沿街连续界面 + 面向人流 + 通路净距校验 ----------
// v2 是广场/随机散点摆摊（不朝人流、可能压店面）；G3 改为沿真实街道的固定组团：
// 1) 组团锚定在有 frontage 缺口的街段（连成连续小吃街界面）；2) 摊位立面朝最近道路（人流方向）；
// 3) 三级净距：通行走廊（路缘外 1.3m）/ 建筑轮廓 1.2m / 店门（facadeBay）前 2.0m——出入口可见，通路不被摊棚堵住。
// 4) 四类设计用途（蒸煮/烤制/饮品/点心，仅用途区分，不发明真实商号）决定柜台/展示结构。
{
  const bz = zones.bazaar.polygon;
  const footprints = byZone.bazaar.map(x => x.b.points);
  const waterFps = objects.filter(o => o.kind === 'water').map(o => o.geometry.footprint).filter(Boolean);
  const bayPos = objects.filter(o => o.kind === 'facadeBay').map(o => o.geometry.position);
  const roadsClear = map.roads.filter(r => (r.priority ?? -1) >= 0 && r.points);
  const FOOD_USES = ['蒸煮', '烤制', '饮品', '点心'];
  // 摊位 socket 插槽（设计真值）：本地系 +Z=朝人流，柜台面 0.975。build-scene 据此摆件，audit 据此出 food-sockets.json。
  const STALL_SLOTS = {
    '蒸煮': [
      { slot: 'tray', lx: 0.55, ly: 1.01, lz: 0, sizeM: [0.5, 0.38], purpose: 'food-tray-display' },
      { slot: 'steamer', lx: -0.45, ly: 1.31, lz: 0, sizeM: [0.42, 0.42], purpose: 'steamer-basket-mount' },
    ],
    '烤制': [
      { slot: 'tray', lx: 0.55, ly: 1.01, lz: 0, sizeM: [0.5, 0.38], purpose: 'food-tray-display' },
      { slot: 'grill', lx: -0.45, ly: 1.13, lz: 0, sizeM: [0.5, 0.36], purpose: 'grill-mount' },
    ],
    '饮品': [
      { slot: 'tray', lx: 0.0, ly: 1.01, lz: 0.1, sizeM: [0.55, 0.4], purpose: 'food-tray-display' },
      { slot: 'cup', lx: -0.1, ly: 1.31, lz: -0.25, sizeM: [0.3, 0.3], purpose: 'cup-display' },
    ],
    '点心': [
      { slot: 'tray', lx: 0.55, ly: 1.01, lz: 0, sizeM: [0.5, 0.38], purpose: 'food-tray-display' },
      { slot: 'case', lx: -0.45, ly: 1.16, lz: 0, sizeM: [0.5, 0.32], purpose: 'pastry-case-display' },
    ],
  };
  const TARGET_STALLS = 43, TARGET_BENCHES = 8; // v2 建立的分列口径，本轮保持（组团数因沿街重排可变，audit 如实聚类）
  const CORRIDOR_MARGIN = 1.3, BLD_CLEAR = 1.2, ENTR_CLEAR = 2.0, STALL_GAP = 2.7;

  const roadAt = (road, s) => { // 弧长 -> 点+切向（越出路段返回 null，防止端点堆叠）
    const n = road.points.length;
    let total = 0;
    for (let i = 0; i < n - 1; i++) total += dist2d(road.points[i], road.points[i + 1]);
    if (s < 0 || s > total) return null;
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      const L = dist2d(road.points[i], road.points[i + 1]);
      if (s <= acc + L || i === n - 2) {
        const t = Math.max(0, Math.min(1, (s - acc) / (L || 1)));
        const p = [road.points[i][0] + (road.points[i + 1][0] - road.points[i][0]) * t,
                   road.points[i][1] + (road.points[i + 1][1] - road.points[i][1]) * t];
        const u = [(road.points[i + 1][0] - road.points[i][0]) / (L || 1), (road.points[i + 1][1] - road.points[i][1]) / (L || 1)];
        return { p, u };
      }
      acc += L;
    }
    return null;
  };
  // 摊位落点校验：返回 null=可用，否则拒绝原因（审计用）。
  // 区域：地块多边形内或沿其边界 8m 内的临街空间（老街建筑贴路缘，OSM 地块边界贴建筑背线，店前沿街面在多边形外属常态）
  const stallBlock = (x, z, placed) => {
    if (!pointInPoly([x, z], bz) && distToPolyline([x, z], bz) >= 8) return 'outside-bazaar';
    for (const r of roadsClear) {
      if (distToPolyline([x, z], r.points) < (r.width || 3.5) / 2 + CORRIDOR_MARGIN) return 'road-corridor';
    }
    for (const fp of footprints) {
      if (pointInPoly([x, z], fp)) return 'in-building';
      if (distToPolyline([x, z], fp) < BLD_CLEAR) return 'on-building-edge';
    }
    for (const w of waterFps) if (pointInPoly([x, z], w)) return 'in-water';
    for (const b of bayPos) if (dist2d([x, z], b) < ENTR_CLEAR) return 'blocking-shop-entrance';
    for (const q of placed) if (dist2d([x, z], q) < 2.3) return 'stall-overlap';
    return null;
  };
  // 组团锚：road OSM id + 弧长(m) + 摊数；选址对准 frontage 缺口（量测见 commerce-audit streetFrontage）
  // 九曲桥广场东段(86-131m)夹于水池与 bld-553893872 之间，仅北段(s=20)与湖心亭西(s=96)容 6+2 摊
  const CLUSTERS = [
    { road: 238219462, s: 14, n: 6, bench: true },   // 方浜中路西段缺口 0-82m
    { road: 238219462, s: 52, n: 6, bench: true },
    { road: 238219462, s: 100, n: 4, bench: true },  // 方浜中路 98-112m 段
    { road: 33683251, s: 14, n: 6, bench: true },    // 旧校场路北口缺口 4-26m
    { road: 33683251, s: 70, n: 5, bench: true },    // 旧校场路中段缺口 58-114m
    { road: 33683251, s: 102, n: 5, bench: true },
    { road: 33683251, s: 296, n: 3, bench: true },   // 旧校场路南端缺口 292-308m
    { road: 428199195, s: 20, n: 6, bench: true },   // 九曲桥广场北段缺口 0-40m（广场摊位群主景）
    { road: 428199195, s: 96, n: 2, bench: false },  // 湖心亭西岸摊群（水面/建筑间收窄段）
  ];
  const stallsPlaced = [], rejects = {};
  let sid = 0, benchCount = 0;
  CLUSTERS.forEach((c, ci) => {
    const road = map.roads.find(r => r.id === c.road);
    if (!road) { console.error('stall cluster road missing:', c.road); process.exit(1); }
    const off = (road.width || 3.5) / 2 + 1.9; // 摊中心：路缘外 0.6m（净距 1.3 要求之上留出摊体半深）
    const placedLocal = [];
    for (let i = 0; i < c.n; i++) {
      const foodUse = FOOD_USES[(ci + i) % 4];
      let done = null, lastWhy = null;
      const slides = [0];
      for (let k = 1; k <= 15; k++) slides.push(0.6 * k, -0.6 * k); // ±9m 沿街滑移：避开汇交道/个别冲突
      for (const slide of slides) {
        const at = roadAt(road, c.s + i * STALL_GAP + slide);
        if (!at) continue;
        const nx = -at.u[1], nz = at.u[0];
        for (const side of [1, -1]) {
          const x = at.p[0] + nx * side * off, z = at.p[1] + nz * side * off;
          const why = stallBlock(x, z, placedLocal);
          if (why) { lastWhy = why; continue; }
          // 朝向人流：+Z 指向最近道路点
          const dirx = at.p[0] - x, dirz = at.p[1] - z, dl = Math.hypot(dirx, dirz) || 1;
          done = {
            x, z, rotY: Math.atan2(dirx / dl, dirz / dl), foodUse, slide,
            road: road.name, roadId: road.id, side, sArc: +(c.s + i * STALL_GAP + slide).toFixed(1),
            refPoint: [at.p[0], at.p[1]],
            slots: STALL_SLOTS[foodUse],
          };
          break;
        }
        if (done) break;
      }
      if (!done) { rejects[`cluster${ci + 1}-stall${i + 1}`] = lastWhy || 'no-arc'; continue; }
      placedLocal.push([done.x, done.z]);
      sid++;
      emit({
        id: `stall-${sid}`, zone: 'bazaar', kind: 'stall', lod: 'L1', disposition: 'rendered',
        geometry: { position: [done.x, done.z], rotY: done.rotY, slots: done.slots },
        height: 2.5, foodUse: done.foodUse, cluster: ci + 1,
        faces: { basis: 'faces cluster road arc point = foot-traffic side', road: done.road, roadOsm: done.roadId, arcM: done.sArc, side: done.side, refPoint: [done.refPoint[0], done.refPoint[1]] },
        sources: {}, confidence: 'design-inference',
        inferences: [
          `foodUse ${done.foodUse} is a design-purpose label only, no real shop brand invented`,
          'counter/display structure per foodUse; food_socket slots are reserved (owner food line not connected here)',
          `clearance kept: road corridor ${(road.width / 2 + CORRIDOR_MARGIN).toFixed(1)}m from centerline, building ${BLD_CLEAR}m, shop entrance ${ENTR_CLEAR}m`,
        ],
      });
    }
    if (c.bench && placedLocal.length) {
      // 座凳在组团端头外侧，面向街道（与人同向看摊）
      const endS = c.s + placedLocal.length * STALL_GAP + 1.6;
      let benchDone = false;
      const benchSlides = [0];
      for (let k = 1; k <= 18; k++) benchSlides.push(0.8 * k, -0.8 * k); // ±14.4m：端头常被路口/邻摊/区界挤压，允许长距滑移
      for (const slide of benchSlides) {
        if (benchDone) break;
        const at = roadAt(road, endS + slide);
        if (!at) continue;
        const nx = -at.u[1], nz = at.u[0];
        for (const side of [1, -1]) {
          const x = at.p[0] + nx * side * off, z = at.p[1] + nz * side * off;
          if (stallBlock(x, z, placedLocal)) continue;
          const dirx = at.p[0] - x, dirz = at.p[1] - z, dl = Math.hypot(dirx, dirz) || 1;
          sid++; benchCount++;
          placedLocal.push([x, z]);
          emit({
            id: `stall-${sid}`, zone: 'bazaar', kind: 'bench', lod: 'L1', disposition: 'rendered',
            geometry: { position: [x, z], rotY: Math.atan2(dirx / dl, dirz / dl) }, height: 0.5,
            cluster: ci + 1, faces: { basis: 'faces cluster road arc point', road: road.name, roadOsm: road.id, refPoint: [at.p[0], at.p[1]] },
            sources: {}, confidence: 'design-inference', inferences: ['seat block at cluster end, facing street'],
          });
          benchDone = true;
          break;
        }
      }
      if (!benchDone) rejects[`cluster${ci + 1}-bench`] = 'no-valid-slot';
    }
  });
  // 座凳补足：端头被干道走廊/区界夹死的组团，在其他有摊组团的另一端补足 8 凳（43 摊/8 凳口径不变）
  if (benchCount < TARGET_BENCHES) {
    const benchSlides2 = [0];
    for (let k = 1; k <= 18; k++) benchSlides2.push(0.8 * k, -0.8 * k);
    for (const c of CLUSTERS) {
      if (benchCount >= TARGET_BENCHES) break;
      const road = map.roads.find(r => r.id === c.road);
      const off = (road.width || 3.5) / 2 + 1.9;
      const placedLocal = [];
      for (let i = 0; i < c.n; i++) {
        const at = roadAt(road, c.s + i * STALL_GAP);
        if (!at) continue;
        placedLocal.push([at.p[0] - at.u[1] * off, at.p[1] + at.u[0] * off], [at.p[0] + at.u[1] * off, at.p[1] - at.u[0] * off]);
      }
      const startS = c.s - 1.6;
      for (const slide of benchSlides2) {
        if (benchCount >= TARGET_BENCHES) break;
        const at = roadAt(road, startS + slide);
        if (!at) continue;
        const nx = -at.u[1], nz = at.u[0];
        for (const side of [1, -1]) {
          const x = at.p[0] + nx * side * off, z = at.p[1] + nz * side * off;
          if (stallBlock(x, z, placedLocal)) continue;
          const dirx = at.p[0] - x, dirz = at.p[1] - z, dl = Math.hypot(dirx, dirz) || 1;
          sid++; benchCount++;
          emit({
            id: `stall-${sid}`, zone: 'bazaar', kind: 'bench', lod: 'L1', disposition: 'rendered',
            geometry: { position: [x, z], rotY: Math.atan2(dirx / dl, dirz / dl) }, height: 0.5,
            cluster: CLUSTERS.indexOf(c) + 1, faces: { basis: 'faces cluster road arc point', road: road.name, roadOsm: road.id, refPoint: [at.p[0], at.p[1]] },
            sources: {}, confidence: 'design-inference', inferences: ['seat block (top-up pass), facing street'],
          });
          break;
        }
      }
    }
  }
  const stallCount = objects.filter(o => o.kind === 'stall').length;
  const benchTotal = objects.filter(o => o.kind === 'bench').length;
  if (stallCount !== TARGET_STALLS || benchTotal !== TARGET_BENCHES) {
    console.error(`stall placement missed targets: stalls ${stallCount}/${TARGET_STALLS}, benches ${benchTotal}/${TARGET_BENCHES}, rejects:`, JSON.stringify(rejects));
    process.exit(1);
  }
  facadeStats.stalls = stallCount + benchTotal;
  facadeStats.stallGroupsPlanned = CLUSTERS.length;
  facadeStats.stallRejects = rejects;
  layoutExtras.stallPlacement = {
    scheme: 'G3 street-anchored clusters (replaces v2 random plaza scatter); clusters target frontage gaps',
    corridors: { roadMarginM: CORRIDOR_MARGIN, buildingM: BLD_CLEAR, shopEntranceM: ENTR_CLEAR, stallGapM: STALL_GAP },
    clusters: CLUSTERS.map((c, i) => {
      const members = objects.filter(o => o.cluster === i + 1 && o.kind === 'stall');
      return { cluster: i + 1, roadOsm: c.road, arcM: c.s, stalls: members.length, foodUses: [...new Set(members.map(m => m.foodUse))] };
    }),
    counts: { stalls: stallCount, benches: benchTotal, plannedClusters: CLUSTERS.length },
  };
}

// ---------- 2D 标注锚（外围 POI/商号提案） ----------
for (const p of map.pois) {
  labels.push({ id: `poi-${p.id}`, text: p.name, x: p.point[0], z: p.point[1], kind: p.type });
}

// ---------- G2 七节点对照索引（证据/特征/朝向，交付索引从这里导出） ----------
const gardenNodes = REQUIRED.map(n => {
  const o = objects.find(o2 => o2.id === gardenNamed[n]);
  if (!o) return { name: n, present: false };
  return {
    name: n, id: o.id, kind: o.kind, present: true,
    facade: o.facade || null,
    evidence: o.nodeEvidence || { refs: {}, evidenceType: 'category template only', feature: 'class default' },
    nodeFocus: o.nodeFocus || null,
    ...(o.reclassifiedFrom ? { reclassifiedFrom: o.reclassifiedFrom, reclassReason: o.reclassReason } : {}),
    ...(o.endPavilion ? { endPavilion: o.endPavilion } : {}),
  };
});
layoutExtras.gardenNodes = gardenNodes;

// ---------- 处理对账表（道路/水/建筑 无遗漏） ----------
const dispositionCount = {};
for (const o of objects) dispositionCount[o.disposition] = (dispositionCount[o.disposition] || 0) + 1;

const layout = {
  meta: {
    title: map.title, era: map.era, generatedAt: new Date().toISOString(),
    originWgs84: map.originWgs84, projection: map.projection, bounds: map.bounds,
    source: map.source, historicalCadastralAccuracy: false,
    notes: [
      ...map.notes,
      'layout.json 是唯一坐标源；3D 场景/2D 标注图/分区清单都从这里派生',
      'OSM 的 wikipedia 外链未采用（源数据存在错链）；名称按本区域位置与既有记录解释',
      '城隍庙组团对齐既有 temple-axis-v3 设计轴；OSM 庙区轮廓单列保留并标注差异',
      '非历史测绘复原；推断字段 inferences 可查询',
    ],
    inputs: {
      mapData: 'inputs/map-data.json', overpass: 'inputs/overpass.json',
      adoptedGate: { path: 'inputs/yuyuan-gate-v2.glb', sha256: GATE_SHA, ownerAdopted: true },
    },
  },
  zones,
  counts: {
    sourceRoads: map.roads.length, sourceBuildings: map.buildings.length, sourceWaters: map.water.length,
    sourceShopProposals: map.shops.length, sourceZones: map.features.length,
    objects: objects.length, instances: instances.length, labels: labels.length,
    disposition: dispositionCount,
    zoneBuildings: Object.fromEntries(Object.entries(byZone).map(([k, v]) => [k, v.length])),
    gardenNamedMissing: missingNames,
    gardenFocusNodes: gardenNodes.filter(n => n.present).length,
    gardenWallUpgrades: {
      latticeWindows: (objects.find(o => o.id === 'garden-wall')?.geometry.lattice || []).length,
      doorFrames: (objects.find(o => o.id === 'garden-wall')?.geometry.doorFrames || []).length,
      dragonHead: objects.some(o => o.id === 'garden-wall-dragonhead'),
    },
    plazas: plazaCount,
    commerce: {
      facadeBays: facadeStats.segments.reduce((s, x) => s + x.bays, 0),
      facadeSegments: facadeStats.segments.length,
      shophouseFootprintUnits: facadeStats.shophouses,
      proposalRowUnits: facadeStats.proposalRows ? facadeStats.proposalRows.total : 0,
      perimeterReplacedUnits: replaceStats.reduce((s, r) => s + r.units, 0),
      perimeterByStreet: replaceStats,
      streetRowUnits: (facadeStats.rows || []).reduce((s, r) => s + r.units, 0),
      rowsByStreet: facadeStats.rows || [],
      stallsAndBenches: facadeStats.stalls,
      distinctSourceBuildings:
        new Set([...facadeStats.segments.map(s => s.building),
          ...objects.filter(o => o.kind === 'shopAnchor').map(o => o.id)]).size,
    },
  },
  objects, instances, labels,
  ...layoutExtras,
};

fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 1));
console.log('layout.json:', objects.length, 'objects,', instances.length, 'instances');
console.log('zone buildings:', JSON.stringify(layout.counts.zoneBuildings));
console.log('disposition:', JSON.stringify(dispositionCount));
console.log('garden named check — missing:', missingNames.length ? missingNames : 'none');
console.log('facades: bays', facadeStats.segments.reduce((s, x) => s + x.bays, 0),
  '| shophouse units', facadeStats.shophouses,
  '| street rows', (facadeStats.rows || []).reduce((s, r) => s + r.units, 0),
  '| stalls', facadeStats.stalls);
console.log('rows by street:', JSON.stringify(facadeStats.rows || []));
