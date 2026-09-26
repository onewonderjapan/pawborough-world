// 外围老城厢建筑套件（wave7-outerkit，2026-09-26）：outerBuilding footprint → 灰瓦坡顶 + 分层立面的廉价体块。
// 由 build-scene.mjs 对外围区全部 outerBuilding 调用（wave8-outerlazy：OUTER_KIT 默认开，301 栋全铺开；OUTER_KIT=0 关，产物回到方块）。
//
// 形制（上海老城厢 / 里弄 2–3 层民居与沿街店屋；推断部分见 DESIGN_INFERENCE）：
//   - 选型按 layout 字段自动：levels ≥ 4 → apartment（多层公房）；有临街边 → shophouse（沿街店屋）；否则 lilong（里弄民居）。
//   - 屋面：沿主轴的双坡「条带」，进深按 11 m（公房 15 m）一条切成并列的几条脊（大进深地块 = 多排里弄屋脊）；
//     进深 < 6.5 m 用单坡（高侧背街）。layout height 当作平均屋面高：檐口 = h − rise/2，屋脊 = h + rise/2。
//   - 晒台：里弄 / 店屋单条带、长 ≥ 12 m 时按 id 哈希约一半在一端切出平台 + 女儿墙；老虎窗：屋面 rise ≥ 1.9 m 时按哈希加 1–2 个。
//   - 店屋临街边：底层店面 + 一道披檐。
// 三种立面方案（OUTER_KIT_MODE）共用同一套体块，只换「立面细节从哪来」：
//   geo  纯几何：顶点色 + 窗框 / 窗扇 / 店面等贴面四边形（细节吃三角预算）；
//   tex  几何 + 立面贴图：一张共享图集（resources/textures/outer-kit/outerkit-atlas.jpg，脚本 modules/outer-kit/bake_atlas.py），
//        墙按层切带，UV 落到图集横条（横向 REPEAT，纵向限在条内）；
//   proc 程序化 shader：几何同 tex 但不分层，UV 只编码「类别 + 檐口高 / 沿墙米数」，窗与瓦由运行时 shader 画（web/outer-kit-proc.js）。
// 坐标：x 东、z 南、y 上，米；footprint 直接取 layout（不另存副本）。
import * as THREE from 'three';
import { orientRing, polyArea, minAreaRect, distToSeg, triangulateRing, offsetPolySafe, pointInPoly } from './lib.mjs';

export const TRI_CAP = 400;
export const SLOT_ATLAS = 'outerkit-atlas';
export const SLOT_PROC = 'outerkit-proc';
export const MODES = ['geo', 'tex', 'proc'];
export const FRONT_DIST = 6;       // 边中点到道路（中线 − 半宽）≤ 6 m 算临街
export const FRONT_MINLEN = 3;
const OVERHANG = 0.35;             // 檐口 / 山墙出挑
const ROOF_T = 0.12;               // 屋面板厚（底面 + 封檐板）
const PLINTH = 0.6;                // 勒脚高
export const DESIGN_INFERENCE = [
  'layout height 视为平均屋面高：檐口 = height − rise/2，屋脊 = height + rise/2（与原方块体积平均高一致）',
  '坡度：民居 27°，公房 18°；rise 上限 2.8 m / 2.2 m；单坡 20°、上限 2.0 m',
  '大进深地块按 11 m（公房 15 m）切成并列双坡条带，表示一块地里的多排里弄屋脊，不是测绘',
  '临街 = 边中点到 layout 道路（中线 − 半宽）≤ 6 m；店屋屋脊平行于最长临街边',
  '晒台 / 老虎窗 / 墙面色按 id 哈希取，属形制示意，不对应具体门牌',
  '参照（只看形制比例与配色，未取像素）：PBR-SH-0001-004/005/010/020、PBR-SH-0002-006（CATALOG 登记，CC BY-SA / CC0）',
];

// ---------- 小工具 ----------
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed, k) {
  let x = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// 半平面裁剪：保留 f(p) ≥ 0（f 线性）
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa > 0 && fb < 0) || (fa < 0 && fb > 0)) out.push(lerp2(a, b, fa / (fa - fb)));
  }
  return out;
}

// ---------- 环境：道路段、邻栋 ----------
export function roadSegments(layout) {
  const segs = [];
  for (const r of layout.objects) {
    if (r.kind !== 'road' || !r.geometry || !r.geometry.polyline) continue;
    const pl = r.geometry.polyline, half = (r.geometry.width || 4) / 2;
    for (let i = 1; i < pl.length; i++) segs.push({ a: pl[i - 1], b: pl[i], half, road: r.name || r.id });
  }
  return segs;
}
export function frontageEdges(ring, segs) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < FRONT_MINLEN) continue;
    const m = lerp2(a, b, 0.5);
    let best = null;
    for (const s of segs) { const d = distToSeg(m, s.a, s.b) - s.half; if (!best || d < best.d) best = { d, road: s.road }; }
    if (best && best.d <= FRONT_DIST) out.push({ i, len, d: best.d, road: best.road });
  }
  return out;
}
// 共墙：与别栋某边近平行（< 10°）、距离 < 0.6 m、重叠 ≥ 50% 边长
export function partyEdges(ring, others) {
  const res = new Set();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    let cover = 0;
    for (const o of others) {
      if (o.bb.x0 > Math.max(a[0], b[0]) + 1 || o.bb.x1 < Math.min(a[0], b[0]) - 1 || o.bb.z0 > Math.max(a[1], b[1]) + 1 || o.bb.z1 < Math.min(a[1], b[1]) - 1) continue;
      const r = o.ring;
      for (let j = 0; j < r.length; j++) {
        const c = r[j], d = r[(j + 1) % r.length];
        const ex = d[0] - c[0], ez = d[1] - c[1], el = Math.hypot(ex, ez);
        if (el < 1e-6 || Math.abs((ux * ez - uz * ex) / el) > 0.17) continue;
        const pc = -(c[0] - a[0]) * uz + (c[1] - a[1]) * ux, pd = -(d[0] - a[0]) * uz + (d[1] - a[1]) * ux;
        if (Math.abs(pc) > 0.6 || Math.abs(pd) > 0.6) continue;
        const tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz, td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz;
        cover += Math.max(0, Math.min(len, Math.max(tc, td)) - Math.max(0, Math.min(tc, td)));
      }
    }
    if (cover >= 0.5 * len) res.add(i);
  }
  return res;
}
export function neighbourRings(layout, selfId, kinds = ['outerBuilding', 'bazaarBlock']) {
  const out = [];
  for (const o of layout.objects) {
    if (o.id === selfId || !kinds.includes(o.kind) || !o.geometry || !o.geometry.footprint) continue;
    const ring = orientRing(o.geometry.footprint);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    out.push({ id: o.id, ring, bb: { x0, x1, z0, z1 } });
  }
  return out;
}

// ---------- 规划：选型 + 屋面条带 ----------
export function planBuilding(o, env, opt = {}) {
  const ring = orientRing(o.geometry.footprint);
  const n = ring.length;
  const seed = hash32(o.id);
  const h = o.height || 6.4;
  const levels = o.levels || Math.max(1, Math.round(h / 3.2));
  const front = frontageEdges(ring, env.roadSegs || []);
  const party = env.others ? partyEdges(ring, env.others) : new Set();
  const mar = minAreaRect(ring);
  let axis = mar.lenU >= mar.lenV ? mar.axis : [-mar.axis[1], mar.axis[0]];
  // 店屋屋脊平行于最长临街边——但只在该边是长边时（山墙临街的里弄排屋仍沿长轴起脊）
  if (front.length) {
    const f = front.reduce((p, q) => (q.len > p.len ? q : p));
    const a = ring[f.i], b = ring[(f.i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L >= 0.75 * Math.max(mar.lenU, mar.lenV)) axis = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  }
  if (axis[0] < -1e-9 || (Math.abs(axis[0]) <= 1e-9 && axis[1] < 0)) axis = [-axis[0], -axis[1]];
  const perp = [-axis[1], axis[0]];
  const S = (p) => p[0] * axis[0] + p[1] * axis[1];
  const T = (p) => p[0] * perp[0] + p[1] * perp[1];
  const ts = ring.map(T), ss = ring.map(S);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), s0 = Math.min(...ss), s1 = Math.max(...ss);
  const D = t1 - t0, Ls = s1 - s0;
  const type = levels >= 4 ? 'apartment' : (front.length ? 'shophouse' : 'lilong');
  const apt = type === 'apartment';
  const roofKind = (!apt && D < 6.5) ? 'shed' : 'gable';
  const pitch = (roofKind === 'shed' ? 20 : apt ? 18 : 27) * Math.PI / 180;
  const nStrip = roofKind === 'shed' ? 1 : Math.min(opt.maxStrip || 6, Math.max(1, Math.round(D / (apt ? 15 : 11))));
  const d = D / nStrip;
  const rise = roofKind === 'shed' ? Math.min(2.0, D * Math.tan(pitch)) : Math.min(apt ? 2.2 : 2.8, (d / 2) * Math.tan(pitch));
  const eave = h - rise / 2;
  // 街在 t 的哪一侧（单坡高侧背街；老虎窗朝街）
  const tc = (t0 + t1) / 2;
  let streetLow = rnd(seed, 1) < 0.5;
  if (front.length) {
    const f = front.reduce((p, q) => (q.len > p.len ? q : p));
    streetLow = T(lerp2(ring[f.i], ring[(f.i + 1) % n], 0.5)) < tc;
  }
  const plan = { id: o.id, seed, ring, h, levels, type, roofKind, axis, perp, t0, t1, s0, s1, D, Ls, nStrip, d, rise, eave,
    ridge: eave + rise, pitch, front, party: [...party], streetLow, terrace: null, dormers: [] };
  // 晒台
  if (!opt.plain && !apt && roofKind === 'gable' && nStrip === 1 && Ls >= 12 && rnd(seed, 2) < 0.5) {
    const cut = Math.min(3.6, 0.25 * Ls);
    plan.terrace = rnd(seed, 3) < 0.5 ? { sCut: s1 - cut, side: +1 } : { sCut: s0 + cut, side: -1 };
  }
  // 老虎窗
  if (!opt.plain && !apt && roofKind === 'gable' && rise >= 1.9 && Ls >= 8 && rnd(seed, 4) < 0.7) {
    const k = Ls >= 20 ? 2 : 1;
    const strip = streetLow ? 0 : nStrip - 1;
    for (let j = 0; j < k; j++) {
      const sc = s0 + Ls * (k === 1 ? 0.5 : (j === 0 ? 0.3 : 0.7)) + (rnd(seed, 5 + j) - 0.5) * 1.0;
      if (plan.terrace && (plan.terrace.side > 0 ? sc + 1.5 > plan.terrace.sCut : sc - 1.5 < plan.terrace.sCut)) continue;
      plan.dormers.push({ sc, strip, low: streetLow });
    }
  }
  return plan;
}

// 屋面平面高（不含晒台）
function roofPlaneY(P, t) {
  if (P.roofKind === 'shed') {
    const f = P.streetLow ? (t - P.t0) / P.D : (P.t1 - t) / P.D;   // 街侧低
    return P.eave + P.rise * f;
  }
  const k = Math.min(P.nStrip - 1, Math.max(0, Math.floor((t - P.t0) / P.d)));
  const tm = P.t0 + (k + 0.5) * P.d;
  return P.eave + P.rise * (1 - Math.abs(t - tm) / (P.d / 2));
}
// 坡面上某点到本坡「高线」（屋脊 / 单坡高边）的斜距
function slopeDist(P, t) {
  if (P.roofKind === 'shed') {
    const dt = P.streetLow ? P.t1 - t : t - P.t0;
    return Math.max(0, dt) / Math.cos(P.pitch);
  }
  const k = Math.min(P.nStrip - 1, Math.max(0, Math.floor((t - P.t0) / P.d)));
  const tm = P.t0 + (k + 0.5) * P.d;
  return Math.abs(t - tm) / Math.cos(P.pitch);
}
function tBreaks(P, extraSlopeBand) {
  const br = [];
  if (P.roofKind === 'gable') {
    for (let k = 0; k < P.nStrip; k++) {
      const tm = P.t0 + (k + 0.5) * P.d;
      br.push(tm);
      if (k > 0) br.push(P.t0 + k * P.d);
      if (extraSlopeBand) {   // tex：斜距每满一条瓦带（图集 V 不能跨条重复）加一道
        const step = extraSlopeBand * Math.cos(P.pitch);
        for (let j = 1; j * step < P.d / 2 + OVERHANG; j++) { br.push(tm - j * step); br.push(tm + j * step); }
      }
    }
  } else if (extraSlopeBand) {
    const step = extraSlopeBand * Math.cos(P.pitch);
    for (let j = 1; j * step < P.D + OVERHANG; j++) br.push(P.streetLow ? P.t1 - j * step : P.t0 + j * step);
  }
  return [...new Set(br.map(v => +v.toFixed(6)))].sort((a, b) => a - b);
}

// ---------- 面片生成（与方案无关） ----------
// wall：{cls, a,b(2D), al0,al1(沿边米数), len, y0, top0, top1, n(外法线 2D), edge}
// roof：{tris(3D), up/down, slope, s/t 信息}
export function buildFaces(P, { slopeBand = 0 } = {}) {
  const ring = P.ring, n = ring.length;
  const S = (p) => p[0] * P.axis[0] + p[1] * P.axis[1];
  const T = (p) => p[0] * P.perp[0] + p[1] * P.perp[1];
  const W = (s, t) => [s * P.axis[0] + t * P.perp[0], s * P.axis[1] + t * P.perp[1]];
  const br = tBreaks(P, 0);
  const inTerrace = (p) => P.terrace && (P.terrace.side > 0 ? S(p) > P.terrace.sCut + 1e-6 : S(p) < P.terrace.sCut - 1e-6);
  const PARAPET = 0.9;
  const walls = [], roofs = [], extras = [];
  const party = new Set(P.party), front = new Set(P.front.map(f => f.i));
  // 墙：按 t 断线 / 晒台切线分段
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nn = [dz / len, -dx / len];
    const along = Math.abs((dx * P.axis[0] + dz * P.axis[1]) / len);
    const cls = party.has(i) ? 'party' : front.has(i) ? 'front' : P.type === 'apartment' ? 'apt' : along >= 0.7 ? 'long' : 'side';
    const lam = [0, 1];
    const ta = T(a), tb = T(b);
    for (const tv of br) if ((ta - tv) * (tb - tv) < 0) lam.push((tv - ta) / (tb - ta));
    if (P.terrace) { const sa = S(a), sb = S(b), sv = P.terrace.sCut; if ((sa - sv) * (sb - sv) < 0) lam.push((sv - sa) / (sb - sa)); }
    lam.sort((x, y) => x - y);
    for (let k = 0; k < lam.length - 1; k++) {
      const l0 = lam[k], l1 = lam[k + 1];
      if (l1 - l0 < 1e-6) continue;
      const p0 = lerp2(a, b, l0), p1 = lerp2(a, b, l1), mid = lerp2(a, b, (l0 + l1) / 2);
      const terr = inTerrace(mid);
      const top = (p) => (terr ? P.eave + PARAPET : roofPlaneY(P, T(p)));
      walls.push({ cls, edge: i, a: p0, b: p1, al0: l0 * len, al1: l1 * len, len, y0: 0, top0: top(p0), top1: top(p1), n: nn, terr });
    }
  }
  // 晒台：切口山墙（底 = 檐口）+ 平台板
  if (P.terrace) {
    const sv = P.terrace.sCut, side = P.terrace.side;
    const hits = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], sa = S(a), sb = S(b);
      if ((sa - sv) * (sb - sv) < 0) hits.push(T(lerp2(a, b, (sv - sa) / (sb - sa))));
    }
    hits.sort((x, y) => x - y);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      // 面朝晒台一侧（side 方向）：外法线 = side * axis
      const nn = [side * P.axis[0], side * P.axis[1]];
      const cuts = [hits[k], ...br.filter(tv => tv > hits[k] && tv < hits[k + 1]), hits[k + 1]];
      for (let j = 0; j + 1 < cuts.length; j++) {
        const p0 = W(sv, cuts[j]), p1 = W(sv, cuts[j + 1]);
        walls.push({ cls: 'side', edge: -1, a: p0, b: p1, al0: cuts[j] - hits[k], al1: cuts[j + 1] - hits[k], len: hits[k + 1] - hits[k],
          y0: P.eave, top0: roofPlaneY(P, cuts[j]), top1: roofPlaneY(P, cuts[j + 1]), n: nn, terr: false, cut: true });
      }
    }
    const slab = clipPoly(ring, (p) => side * (S(p) - sv));
    for (const tri of triangulateRing(slab)) extras.push({ kind: 'slab', tri: tri.map(p => [p[0], P.eave, p[1]]) });
  }
  // 屋面：外扩 OVERHANG 的轮廓按半坡带裁剪（晒台一侧另裁掉），每块是平面
  let roofPoly = offsetPolySafe(ring, OVERHANG).pts;
  if (P.terrace) { const sv = P.terrace.sCut + P.terrace.side * 0.25; roofPoly = clipPoly(roofPoly, (p) => -P.terrace.side * (S(p) - sv)); }
  const rbr = tBreaks(P, slopeBand);
  const bands = [-Infinity, ...rbr, Infinity];
  for (let k = 0; k + 1 < bands.length; k++) {
    const lo = bands[k], hi = bands[k + 1];
    let piece = roofPoly;
    if (Number.isFinite(lo)) piece = clipPoly(piece, (p) => T(p) - lo);
    if (Number.isFinite(hi) && piece.length >= 3) piece = clipPoly(piece, (p) => hi - T(p));
    if (piece.length < 3 || Math.abs(polyArea(piece)) < 1e-4) continue;
    for (const tri of triangulateRing(piece)) {
      roofs.push({ tri: tri.map(p => [p[0], roofPlaneY(P, T(p)), p[1]]), st: tri.map(p => [S(p), T(p)]) });
    }
  }
  // 封檐板：roofPoly 边界按 t 断线分段
  const fascia = [];
  for (let i = 0; i < roofPoly.length; i++) {
    const a = roofPoly[i], b = roofPoly[(i + 1) % roofPoly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 0.02) continue;
    const orient = polyArea(roofPoly) > 0 ? 1 : -1;
    const nn = [orient * dz / len, -orient * dx / len];
    const lam = [0, 1], ta = T(a), tb = T(b);
    for (const tv of rbr) if ((ta - tv) * (tb - tv) < 0) lam.push((tv - ta) / (tb - ta));
    lam.sort((x, y) => x - y);
    for (let k = 0; k + 1 < lam.length; k++) {
      const p0 = lerp2(a, b, lam[k]), p1 = lerp2(a, b, lam[k + 1]);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 0.02) continue;
      fascia.push({ a: p0, b: p1, top0: roofPlaneY(P, T(p0)), top1: roofPlaneY(P, T(p1)), n: nn });
    }
  }
  // 屋脊压顶：每条脊线与 roofPoly 的交段
  const ridges = [];
  if (P.roofKind === 'gable') {
    for (let k = 0; k < P.nStrip; k++) {
      const tm = P.t0 + (k + 0.5) * P.d;
      const hits = [];
      for (let i = 0; i < roofPoly.length; i++) {
        const a = roofPoly[i], b = roofPoly[(i + 1) % roofPoly.length], ta = T(a), tb = T(b);
        if ((ta - tm) * (tb - tm) < 0) hits.push(S(lerp2(a, b, (tm - ta) / (tb - ta))));
      }
      hits.sort((x, y) => x - y);
      for (let j = 0; j + 1 < hits.length; j += 2) if (hits[j + 1] - hits[j] > 0.3) ridges.push({ s0: hits[j], s1: hits[j + 1], t: tm });
    }
  }
  // 老虎窗
  const dormers = [];
  for (const dm of P.dormers) {
    const k = dm.strip, tm = P.t0 + (k + 0.5) * P.d, half = P.d / 2;
    const dir = dm.low ? -1 : 1;              // 朝 t 减小（low）或增大
    const tEdge = tm + dir * half;            // 该坡檐口线
    const tf = tEdge - dir * 0.3 * half;      // 老虎窗正面
    const yb = roofPlaneY(P, tf), hw = Math.min(1.0, P.rise * 0.45), yw = yb + hw;
    const hr = Math.min(0.45, P.ridge - yw - 0.12);
    if (hr < 0.15) continue;
    const yr = yw + hr;
    const tW = tm + dir * half * (1 - (yw - P.eave) / P.rise);   // 主坡面达到 yw 的 t
    const tR = tm + dir * half * (1 - (yr - P.eave) / P.rise);
    const w = 1.8;
    const corners = [[dm.sc - w / 2, tf], [dm.sc + w / 2, tf], [dm.sc - w / 2, tR], [dm.sc + w / 2, tR]].map(([s, t]) => W(s, t));
    if (!corners.every(c => pointInPoly(c, ring))) continue;
    dormers.push({ sc: dm.sc, w, tf, tW, tR, yb, yw, yr, dir });
  }
  // 店屋披檐
  const awnings = [];
  if (P.type === 'shophouse' && !P.plain) {
    const yA = Math.min(3.2, P.eave / P.levels + 0.1);
    for (const f of P.front) {
      if (party.has(f.i)) continue;
      const a = ring[f.i], b = ring[(f.i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      const nn = [dz / len, -dx / len];
      const p0 = lerp2(a, b, 0.3 / len), p1 = lerp2(a, b, 1 - 0.3 / len);
      awnings.push({ a: p0, b: p1, n: nn, y: yA, out: 0.9, drop: 0.35, len: len - 0.6 });
    }
  }
  return { walls, roofs, fascia, ridges, dormers, awnings, extras, S, T, W };
}

// ---------- 三角收集器 ----------
class Sink {
  constructor(mode) { this.mode = mode; this.pos = []; this.nrm = []; this.col = []; this.uv = []; }
  // 三角 p,q,r（3D），期望外法线 n（3D，未必单位）；attr(p) → [r,g,b] 或 [u,v]
  tri(p, q, r, n, attr) {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const cl = Math.hypot(cx, cy, cz);
    if (cl < 1e-9) return;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { [q, r] = [r, q]; cx = -cx; cy = -cy; cz = -cz; }
    for (const v of [p, q, r]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(cx / cl, cy / cl, cz / cl);
      const at = attr(v);
      if (this.mode === 'geo') this.col.push(at[0], at[1], at[2]); else this.uv.push(at[0], at[1]);
    }
  }
  poly(pts, n, attr) { for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], n, attr); }
  get tris() { return this.pos.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.mode === 'geo') g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    else g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ---------- 图集布局（tex）：512×1024，glTF UV（v=0 在图顶） ----------
export const ATLAS = {
  W: 512, H: 1024,
  roof: { y0: 0, y1: 256, slopeM: 6.4, uM: 3.2 },          // 瓦面：V 周期 = 斜距 6.4 m，U 周期 3.2 m
  strips: { shop: 256, res: 384, up: 512, apt: 640, sidewin: 768, plain: 896 },   // 各 128 px 一层
  stripH: 128, pad: 3, bayM: 3.6, plainM: 6.4,
  dark: [0.5, (256 + 10) / 1024],                           // 店面条顶部招牌暗带：封檐 / 檐底 / 屋脊压顶取这里
};
function stripV(row, f) { // f ∈ [0,1] 自下而上
  return (row + ATLAS.pad + (1 - f) * (ATLAS.stripH - 2 * ATLAS.pad)) / ATLAS.H;
}

// ---------- 方案发射 ----------
// 超 TRI_CAP 时逐级降级：去晒台/老虎窗/披檐 → 减条带数 → 去檐底面。返回首个 ≤ TRI_CAP 的结果（都超则返回最后一级并标 overCap）。
export function buildOuterKitGeometry(o, env, mode = 'tex') {
  if (!MODES.includes(mode)) throw new Error('OUTER_KIT_MODE must be one of ' + MODES.join('/'));
  const full = planBuilding(o, env);
  const ladder = [{}, { plain: true }];
  for (let k = full.nStrip - 1; k >= 1; k--) ladder.push({ plain: true, maxStrip: k });
  ladder.push({ plain: true, maxStrip: 1, noUnderside: true });
  let r = null;
  for (let i = 0; i < ladder.length; i++) {
    r = emitBuilding(o, env, mode, ladder[i]);
    r.degrade = i;
    if (r.tris <= TRI_CAP) return r;
  }
  r.overCap = true;
  return r;
}
function emitBuilding(o, env, mode, opt) {
  const P = planBuilding(o, env, opt);
  P.plain = !!opt.plain;
  const F = buildFaces(P, { slopeBand: mode === 'tex' ? ATLAS.roof.slopeM : 0 });
  const sink = new Sink(mode);
  const seed = P.seed;
  const up = [0, 1, 0], down = [0, -1, 0];
  const n3 = (n2) => [n2[0], 0, n2[1]];
  const fh = P.eave / P.levels;
  // ----- 调色（geo）/ 类别码（proc）-----
  const plasterPal = [0xe4dfd3, 0xd8d1c1, 0xcbc6bb, 0xc9b99c];
  const pal = {
    plaster: rgb(plasterPal[Math.floor(rnd(seed, 10) * plasterPal.length)]),
    brick: rgb(0x77726b), wood: rgb(0x6a4630), glass: rgb(0x2c2723), shop: rgb(0x4d3323),
    tile: rgb([0x4b4d51, 0x55565a, 0x45474b][Math.floor(rnd(seed, 11) * 3)]), dark: rgb(0x33291f), slab: rgb(0x9d978c),
  };
  const CODE = { roof: 0, front: 1, long: 2, side: 3, apt: 4, party: 5, dark: 6, slab: 7, dormer: 8 };
  const procUV = (code, e) => (u) => [u, code * 32 + Math.min(31.9, Math.max(0, e))];
  const darkUV = () => ATLAS.dark;
  const uOff = rnd(seed, 12) * 4;   // tex：每栋 U 偏移，错开图集重复
  const upperStrip = 'up';

  // ----- 墙 -----
  const wallPts = (w, ylo, yhi) => {
    // 墙片在 (f, y) 参数平面是四边形 (0,y0)(1,y0)(1,top1)(0,top0)；裁到 ylo ≤ y ≤ yhi 后映回 3D
    let q = [[0, w.y0], [1, w.y0], [1, w.top1], [0, w.top0]];
    q = clipPoly(q, (p) => p[1] - ylo);
    if (q.length >= 3) q = clipPoly(q, (p) => yhi - p[1]);
    if (q.length < 3 || Math.abs(polyArea(q)) < 1e-6) return null;
    return q.map(([f, y]) => { const p = lerp2(w.a, w.b, f); return [p[0], y, p[1]]; });
  };
  const alongOf = (w) => (p) => w.al0 + Math.hypot(p[0] - w.a[0], p[2] - w.a[1]);

  for (const w of F.walls) {
    const nn = n3(w.n), al = alongOf(w);
    const maxTop = Math.max(w.top0, w.top1);
    if (mode === 'geo') {
      const bandColor = w.cls === 'party' ? pal.plaster : pal.brick;
      if (w.y0 < PLINTH) { const q = wallPts(w, 0, PLINTH); if (q) sink.poly(q, nn, () => bandColor); }
      const q = wallPts(w, Math.max(PLINTH, w.y0), maxTop + 1); if (q) sink.poly(q, nn, () => pal.plaster);
    } else if (mode === 'proc') {
      const code = CODE[w.cls === 'apt' ? 'apt' : w.cls];
      const q = wallPts(w, w.y0, maxTop + 1); if (q) sink.poly(q, nn, (p) => procUV(code, w.terr || w.cut ? 0 : P.eave)(al(p)));
    } else {
      // tex：层带（y0 < eave 的部分）+ 檐口以上（山尖 / 女儿墙）
      const nb = Math.max(1, Math.round(w.len / ATLAS.bayM));
      const uBay = (p) => uOff + (al(p) / w.len) * nb / 2;
      const uPlain = (p) => uOff + al(p) / ATLAS.plainM;
      for (let k = 0; k < P.levels; k++) {
        const yb = k * fh, yt = (k + 1) * fh;
        if (yt <= w.y0 + 1e-4) continue;
        const q = wallPts(w, yb, yt); if (!q) continue;
        let strip;
        if (w.cls === 'front') strip = k === 0 ? 'shop' : upperStrip;
        else if (w.cls === 'long') strip = k === 0 ? 'res' : upperStrip;
        else if (w.cls === 'apt') strip = 'apt';
        else if (w.cls === 'side') strip = (w.len >= 4.5 && k > 0) ? 'sidewin' : 'plain';
        else strip = 'plain';
        const row = ATLAS.strips[strip];
        const uf = (strip === 'plain') ? uPlain : (strip === 'sidewin' ? (p) => uOff + al(p) / w.len * Math.max(1, Math.round(w.len / 6.4)) / 2 : uBay);
        sink.poly(q, nn, (p) => [uf(p), stripV(row, Math.min(1, Math.max(0, (p[1] - yb) / fh)))]);
      }
      if (maxTop > P.eave + 1e-3) {
        const q = wallPts(w, Math.max(P.eave, w.y0), maxTop + 1);
        if (q) sink.poly(q, nn, (p) => [uPlain(p), stripV(ATLAS.strips.plain, Math.min(1, Math.max(0, (p[1] - P.eave) / 3.2)))]);
      }
    }
  }
  // ----- 晒台板 -----
  for (const e of F.extras) sink.tri(e.tri[0], e.tri[1], e.tri[2], up,
    mode === 'geo' ? () => pal.slab : mode === 'proc' ? (p) => procUV(CODE.slab, 0)(p[0]) : (p) => [p[0] / ATLAS.plainM, stripV(ATLAS.strips.plain, 0.5)]);
  // ----- 屋面（顶 + 底）-----
  for (const r of F.roofs) {
    const [a, b, c] = r.tri;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const S = F.S, T = F.T;
    const attr = mode === 'geo' ? () => pal.tile
      : mode === 'proc' ? (p) => procUV(CODE.roof, slopeDist(P, T([p[0], p[2]])))(S([p[0], p[2]]))
        : (p) => {
          const sd = slopeDist(P, T([p[0], p[2]]));
          const band = Math.floor((sd - 1e-6) / ATLAS.roof.slopeM);
          const f = (sd - Math.max(0, band) * ATLAS.roof.slopeM) / ATLAS.roof.slopeM;
          return [uOff + S([p[0], p[2]]) / ATLAS.roof.uM, (ATLAS.roof.y0 + ATLAS.pad + Math.min(1, Math.max(0, f)) * (ATLAS.roof.y1 - ATLAS.roof.y0 - 2 * ATLAS.pad)) / ATLAS.H];
        };
    sink.tri(a, b, c, [nx, ny, nz], attr);
    const lo = (p) => [p[0], p[1] - ROOF_T, p[2]];
    if (!opt.noUnderside) sink.tri(lo(a), lo(b), lo(c), [-nx, -ny, -nz], mode === 'geo' ? () => pal.dark : mode === 'proc' ? (p) => procUV(CODE.dark, 0)(0) : darkUV);
  }
  // ----- 封檐板 -----
  for (const f of F.fascia) {
    const pts = [[f.a[0], f.top0 - ROOF_T, f.a[1]], [f.b[0], f.top1 - ROOF_T, f.b[1]], [f.b[0], f.top1, f.b[1]], [f.a[0], f.top0, f.a[1]]];
    sink.poly(pts, n3(f.n), mode === 'geo' ? () => pal.dark : mode === 'proc' ? () => procUV(CODE.dark, 0)(0) : darkUV);
  }
  // ----- 屋脊压顶（倒 V，两片斜面）-----
  for (const r of F.ridges) {
    const y = P.ridge, hw = 0.2, hh = 0.16;
    const A = F.W(r.s0, r.t), B = F.W(r.s1, r.t), Al = F.W(r.s0, r.t - hw), Bl = F.W(r.s1, r.t - hw), Ar = F.W(r.s0, r.t + hw), Br = F.W(r.s1, r.t + hw);
    const top = [[A[0], y + hh, A[1]], [B[0], y + hh, B[1]]];
    const cc = mode === 'geo' ? () => rgb(0x3a3b3e) : mode === 'proc' ? () => procUV(CODE.dark, 0)(0) : darkUV;
    sink.poly([[Al[0], y - 0.02, Al[1]], [Bl[0], y - 0.02, Bl[1]], top[1], top[0]], [-P.perp[0], 1, -P.perp[1]], cc);
    sink.poly([[Ar[0], y - 0.02, Ar[1]], [Br[0], y - 0.02, Br[1]], top[1], top[0]], [P.perp[0], 1, P.perp[1]], cc);
  }
  // ----- 老虎窗 -----
  for (const dmr of F.dormers) {
    const { sc, w, tf, tW, tR, yb, yw, yr, dir } = dmr;
    const Wp = (s, t, y) => { const q = F.W(s, t); return [q[0], y, q[1]]; };
    const fn = [dir * P.perp[0], 0, dir * P.perp[1]];
    const sL = sc - w / 2, sR = sc + w / 2;
    const front = [Wp(sL, tf, yb), Wp(sR, tf, yb), Wp(sR, tf, yw), Wp(sL, tf, yw)];
    const gable = [Wp(sL, tf, yw), Wp(sR, tf, yw), Wp(sc, tf, yr)];
    const fAttr = mode === 'geo' ? () => pal.wood : mode === 'proc' ? (p) => procUV(CODE.dormer, yw - yb)(F.S([p[0], p[2]]) - sL)
      : (p) => [0.125 + (F.S([p[0], p[2]]) - sL) / w * 0.25, stripV(ATLAS.strips.up, 0.22 + 0.68 * (p[1] - yb) / (yw - yb))];   // 对准图集第一开间的窗
    sink.poly(front, fn, fAttr);
    const pAttr = mode === 'geo' ? () => pal.plaster : mode === 'proc' ? () => procUV(CODE.party, 0)(0) : (p) => [p[0] / ATLAS.plainM, stripV(ATLAS.strips.plain, 0.5)];
    sink.tri(gable[0], gable[1], gable[2], fn, pAttr);
    for (const [s, sg] of [[sL, -1], [sR, 1]]) sink.tri(Wp(s, tf, yb), Wp(s, tf, yw), Wp(s, tW, yw), [sg * P.axis[0], 0, sg * P.axis[1]], pAttr);
    const rAttr = mode === 'geo' ? () => pal.tile : mode === 'proc' ? (p) => procUV(CODE.roof, 1)(F.S([p[0], p[2]])) : (p) => [F.S([p[0], p[2]]) / ATLAS.roof.uM, (ATLAS.roof.y0 + 40) / ATLAS.H];
    const eo = 0.15;   // 老虎窗檐出挑
    for (const [s, sg] of [[sL - eo, -1], [sR + eo, 1]]) {
      const pts = [Wp(s, tf - dir * eo, yw - 0.06), Wp(sc, tf - dir * eo, yr), Wp(sc, tR, yr), Wp(s, tW, yw - 0.06)];
      sink.poly(pts, [sg * P.axis[0], 1, sg * P.axis[1]], rAttr);
    }
  }
  // ----- 披檐 -----
  for (const aw of F.awnings) {
    const o3 = (p, dy, out) => [p[0] + aw.n[0] * out, aw.y + dy, p[1] + aw.n[1] * out];
    const top = [o3(aw.a, 0, 0), o3(aw.b, 0, 0), o3(aw.b, -aw.drop, aw.out), o3(aw.a, -aw.drop, aw.out)];
    const nUp = [aw.n[0] * aw.drop, aw.out, aw.n[1] * aw.drop];
    sink.poly(top, nUp, mode === 'geo' ? () => pal.tile : mode === 'proc' ? (p) => procUV(CODE.roof, 1)(Math.hypot(p[0] - aw.a[0], p[2] - aw.a[1])) : (p) => [uOff + Math.hypot(p[0] - aw.a[0], p[2] - aw.a[1]) / ATLAS.roof.uM, (ATLAS.roof.y0 + 20 + (p[1] < aw.y - 0.1 ? 60 : 0)) / ATLAS.H]);
    const bot = top.map(p => [p[0], p[1] - 0.06, p[2]]);
    sink.poly(bot, [-nUp[0], -nUp[1], -nUp[2]], mode === 'geo' ? () => pal.dark : mode === 'proc' ? () => procUV(CODE.dark, 0)(0) : darkUV);
  }
  // ----- geo：窗 / 门 / 店面（贴面四边形，吃剩余预算）-----
  if (mode === 'geo') {
    const base = sink.tris;
    const edges = new Map();
    for (const w of F.walls) {
      if (w.edge < 0 || w.cls === 'party') continue;
      if (!edges.has(w.edge)) edges.set(w.edge, w);
    }
    const plan = (spacing) => {
      const quads = [];
      for (const w of edges.values()) {
        const a = P.ring[w.edge], b = P.ring[(w.edge + 1) % P.ring.length];
        const len = w.len, u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const at = (al, y, off) => [a[0] + u[0] * al + w.n[0] * off, y, a[1] + u[1] * al + w.n[1] * off];
        const rect = (c, y0, ww, hh, off, col) => quads.push({ pts: [at(c - ww / 2, y0, off), at(c + ww / 2, y0, off), at(c + ww / 2, y0 + hh, off), at(c - ww / 2, y0 + hh, off)], n: [w.n[0], 0, w.n[1]], col });
        const winSp = w.cls === 'side' ? Math.max(spacing * 2, 6) : spacing;
        const nb = Math.floor((len - 0.8) / winSp);
        if (nb < 1) continue;
        const c0 = (len - nb * winSp) / 2 + winSp / 2;
        for (let k = 0; k < P.levels; k++) {
          const yb = k * fh;
          if (k === 0 && w.cls === 'front') { rect(len / 2, 0.15, Math.max(0.5, len - 0.8), Math.min(2.7, fh - 0.4), 0.03, pal.shop); continue; }
          if (k === 0 && w.cls === 'side') continue;
          for (let j = 0; j < nb; j++) {
            const c = c0 + j * winSp;
            if (k === 0 && w.cls === 'long' && j % 2 === 0) { rect(c, 0.05, 1.1, Math.min(2.3, fh - 0.5), 0.03, pal.shop); continue; }
            const wy = yb + Math.min(0.9, fh * 0.3), wh = Math.min(1.5, fh * 0.5);
            rect(c, wy, 1.3, wh, 0.03, pal.wood);
            rect(c, wy + 0.12, 1.02, wh - 0.24, 0.05, pal.glass);
          }
        }
      }
      return quads;
    };
    let quads = null;
    for (const sp of [3.3, 4.2, 5.4, 7.2, 10, 14, 20, 40]) { quads = plan(sp); if (base + quads.length * 2 <= TRI_CAP) break; }
    for (const q of quads) if (sink.tris + 2 <= TRI_CAP) sink.poly(q.pts, q.n, () => q.col);
  }
  const geometry = sink.geometry();
  return { geometry, plan: P, tris: sink.tris, faces: { walls: F.walls.length, roofs: F.roofs.length, ridges: F.ridges.length, dormers: F.dormers.length, awnings: F.awnings.length, terrace: !!P.terrace } };
}
