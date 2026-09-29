// wave10-pondqa Q1 普查（只读）：九曲桥 / 池岸 / 水面 / 湖心亭周边 / 池带铺装与台阶。
// 被测：OUT_DIR 下的真实分区 GLB（zones-manifest 全部分件，含外围地面）+ 站点模块 GLB（jiuqu-bridge / huxin-ting）。
// 基准：baseline/layout.json 重算（水池多边形、水面高、桥折线、桥面高、台阶锚、湖心亭 footprint）。
// 用法：OUT_DIR=out-zone node tests/pondqa-survey.mjs --out <survey.json>
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './pondqa-lib.mjs';
import { islands, backfaces, imagesOf, crossIntersect, f3 } from './templeqa-lib.mjs';
import { readGlbTree } from './smallqa-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const OUT = path.resolve(Q.ROOT, process.env.OUT_DIR || 'out-zone');
const REPORT = opt('--out');
const R = {};
const W = Q.loadWorld(OUT);
const xs = Q.WATER_POLY.map((p) => p[0]), zs = Q.WATER_POLY.map((p) => p[1]);
const REGION = [Math.min(...xs) - 12, Math.min(...zs) - 12, Math.max(...xs) + 12, Math.max(...zs) + 12];
const G = new Q.VGrid(W.nodes, { cell: 1.0, region: REGION });
const isWater = (n) => n.id === Q.POND_WATER_ID;
const isBridge = (n) => n.id === 'jiuqu-bridge' || (n.name || '').startsWith('jiuqu-bridge__');
const isHT = (n) => n.id === 'huxin-ting' || /huxin-ting__/.test(n.name || '');
const isStructure = (n) => isBridge(n) || isHT(n);
const topSurface = (col, { maxY = 1.0, skip = () => false } = {}) => col.find((h) => h.ny > 0.2 && h.y <= maxY && !skip(h.node));

// ---------- 1) 水面：GLB 实测高度 / 覆盖（露底）/ 被岸上铺面盖住 ----------
{
  const water = W.nodes.filter(isWater);
  const ys = water.flatMap((n) => Array.from({ length: n.P.length / 3 }, (_, i) => n.P[i * 3 + 1]));
  const res = { nodes: water.map((n) => ({ file: n.file, name: n.name, mat: n.mat, tris: n.T.length / 3 })), yMin: f3(Math.min(...ys)), yMax: f3(Math.max(...ys)), layoutY: Q.WATER_Y };
  // 0.5 m 网格：池内每点竖直线上，除桥 / 湖心亭外的最高朝上面
  let inside = 0, waterTop = 0, noWater = 0, covered = 0;
  const coveredBy = new Map(), holes = [];
  for (let x = Math.ceil(Math.min(...xs) * 2) / 2; x <= Math.max(...xs); x += 0.5) for (let z = Math.ceil(Math.min(...zs) * 2) / 2; z <= Math.max(...zs); z += 0.5) {
    if (!Q.pointInPoly([x, z], Q.WATER_POLY)) continue;
    inside++;
    const col = G.column(x, z);
    const hasWater = col.some((h) => isWater(h.node) && h.ny > 0);
    if (!hasWater) { noWater++; if (holes.length < 20) holes.push([f3(x), f3(z)]); }
    const top = topSurface(col, { maxY: 0.3, skip: isStructure });
    if (top && !isWater(top.node)) { covered++; const k = top.node.file + ' ' + top.node.id; coveredBy.set(k, (coveredBy.get(k) || 0) + 1); }
    else if (top) waterTop++;
  }
  res.grid = { stepM: 0.5, samples: inside, waterOnTop: waterTop, noWaterUnder: noWater, holeSamples: holes, coveredByOther: covered, coveredByAreaM2: Object.fromEntries([...coveredBy].map(([k, v]) => [k, v * 0.25])) };
  R.water = res;
}

// ---------- 2) 岸线：沿水池边界每 0.5 m，岸上 0.3 m 处的地面高 vs 水面；岸边有无竖向驳岸面 ----------
{
  const S = Q.shoreSamples(0.5);
  const rows = [];
  let open = 0, openLen = 0, maxDrop = 0, aboveWater = 0, belowWater = 0, noLand = 0;
  const byLand = new Map();
  for (const s of S) {
    const land = [s.p[0] + s.n[0] * 0.3, s.p[1] + s.n[1] * 0.3];
    const col = G.column(land[0], land[1]);
    const top = topSurface(col, { maxY: 0.6, skip: isStructure });
    const landY = top ? top.y : null;
    const landId = top ? top.node.file + ' ' + top.node.id : 'none';
    byLand.set(landId, (byLand.get(landId) || 0) + 0.5);
    // 岸边竖向面：在边界点内外 ±0.35 m 的水平线上（高度取水面与岸面之间中点）找近竖直三角
    let wall = false;
    if (landY !== null) {
      const ymid = (landY + Q.WATER_Y) / 2;
      const a = [s.p[0] - s.n[0] * 0.35, ymid, s.p[1] - s.n[1] * 0.35], b = [s.p[0] + s.n[0] * 0.35, ymid, s.p[1] + s.n[1] * 0.35];
      const cand = G.near(a[0], a[2], b[0], b[2]).filter((t) => Math.abs(t.ny) < 0.5 && t.y0 <= ymid && t.y1 >= ymid && !isStructure(t.node));
      wall = !!Q.segHit(cand, a, b);
    }
    const drop = landY === null ? null : landY - Q.WATER_Y;
    if (landY === null) noLand++;
    else if (drop > 0.01) aboveWater++;
    else if (drop < -0.01) belowWater++;
    if (drop !== null && Math.abs(drop) > 0.01 && !wall) { open++; openLen += 0.5; }
    if (drop !== null) maxDrop = Math.max(maxDrop, Math.abs(drop));
    rows.push({ s: s.s, p: s.p.map(f3), landY: landY === null ? null : f3(landY), land: landId, wall });
  }
  R.shore = {
    perimeterM: f3(S.length * 0.5), samples: S.length, landAboveWaterM: aboveWater * 0.5, landBelowWaterM: belowWater * 0.5, noLandM: noLand * 0.5,
    openEdgeM: openLen, maxLevelDiffM: f3(maxDrop), landByOwnerM: Object.fromEntries([...byLand].sort((a, b) => b[1] - a[1])),
    levelHistogram: rows.reduce((h, r) => { const k = r.landY === null ? 'none' : r.landY.toFixed(2); h[k] = (h[k] || 0) + 0.5; return h; }, {}),
    samplesDetail: rows.filter((_, i) => i % 8 === 0),
  };
}

// ---------- 3) 九曲桥：焊接连通块分类 → 桥面 / 栏板 / 望柱 / 扶手 / 墩柱 / 边石 ----------
{
  const bridgeNodes = W.nodes.filter(isBridge);
  const deck = bridgeNodes.filter((n) => /deck-stone/.test(n.mat));
  const stone = bridgeNodes.filter((n) => /grey-stone/.test(n.mat));
  const blocks = [];
  for (const n of stone) {
    const isl = islands(n);
    for (const L of isl.list) {
      const dx = L.max[0] - L.min[0], dy = L.max[1] - L.min[1], dz = L.max[2] - L.min[2];
      let cls = 'other';
      if (L.min[1] < 0 && L.max[1] <= Q.DECK_Y - 0.08) cls = 'pier';   // wave14-jiuqu：墩顶=板底 0.46
      else if (Math.abs(L.min[1] - Q.DECK_Y) < 0.005 && Math.abs(dy - 0.95) < 0.01) cls = 'post';
      else if (L.min[1] >= Q.DECK_Y + 0.9) cls = 'postcap';
      else if (Math.abs(L.min[1] - Q.DECK_Y) < 0.005 && dy < 0.07) cls = 'curb';
      else if (L.min[1] >= Q.DECK_Y + 0.7 && L.max[1] <= Q.DECK_Y + 0.95) cls = 'rail';
      else if (L.min[1] >= Q.DECK_Y + 0.02 && L.max[1] <= Q.DECK_Y + 0.85) cls = 'panel';
      blocks.push({ cls, min: L.min, max: L.max, tris: L.tris.length, node: n.name });
    }
  }
  const byCls = blocks.reduce((m, b) => ((m[b.cls] = (m[b.cls] || 0) + 1), m), {});
  // 栏板底与桥面：栏板块底 y 与其正下方桥面顶的净空
  const DG = new Q.VGrid(deck, { cell: 1.0 });
  const panelGaps = [];
  for (const b of blocks.filter((b) => b.cls === 'panel')) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const top = DG.column(cx, cz).find((h) => h.ny > 0.2);
    panelGaps.push(top ? b.min[1] - top.y : null);
  }
  const pg = panelGaps.filter((v) => v !== null);
  // 望柱底：落在桥面上（柱心竖直线命中桥面顶 = 柱底）
  const postOff = [];
  for (const b of blocks.filter((b) => b.cls === 'post')) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const top = DG.column(cx, cz).find((h) => h.ny > 0.2);
    postOff.push(top ? b.min[1] - top.y : null);
  }
  // 墩柱：底在水面下多深 / 顶与桥面底；墩柱正下方是水还是地
  const piers = blocks.filter((b) => b.cls === 'pier').map((b) => {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const inWater = Q.pointInPoly([cx, cz], Q.WATER_POLY);
    const col = G.column(cx + 0.3, cz).filter((h) => !isStructure(h.node));
    const ground = col.find((h) => h.ny > 0.2);
    return { c: [f3(cx), f3(cz)], bottom: f3(b.min[1]), top: f3(b.max[1]), inWater, below: ground ? { y: f3(ground.y), owner: ground.node.id } : null };
  });
  const deckBot = Math.min(...deck.flatMap((n) => Array.from({ length: n.P.length / 3 }, (_, i) => n.P[i * 3 + 1])));
  // 桥身在岸上的长度（桥折线落在水池多边形外的部分）与桥下地面
  let onLand = 0; const landUnder = new Map();
  const Lb = Q.polylineLength(Q.BRIDGE_LINE);
  for (let s = 0; s <= Lb; s += 0.25) {
    const a = Q.alongPolyline(Q.BRIDGE_LINE, s);
    if (Q.pointInPoly(a.p, Q.WATER_POLY)) continue;
    onLand += 0.25;
    const g = G.column(a.p[0], a.p[1]).filter((h) => !isStructure(h.node)).find((h) => h.ny > 0.2);
    const k = g ? g.node.id + '@' + f3(g.y) : 'none';
    landUnder.set(k, (landUnder.get(k) || 0) + 0.25);
  }
  R.bridge = {
    lengthM: f3(Lb), blocks: byCls, deckTopY: Q.DECK_Y, deckBottomY: f3(deckBot),
    panels: { n: pg.length, gapMin: f3(Math.min(...pg)), gapMax: f3(Math.max(...pg)), gapMedian: f3(pg.sort((a, b) => a - b)[pg.length >> 1] ?? NaN) },
    posts: { n: postOff.length, bottomOffsetMax: f3(Math.max(...postOff.filter((v) => v !== null).map(Math.abs))) },
    piers: { n: piers.length, inWater: piers.filter((p) => p.inWater).length, onLand: piers.filter((p) => !p.inWater).length, bottomMin: f3(Math.min(...piers.map((p) => p.bottom))), topMax: f3(Math.max(...piers.map((p) => p.top))), submergedM: f3(Q.WATER_Y - Math.max(...piers.map((p) => p.bottom))), landSample: piers.filter((p) => !p.inWater).slice(0, 6) },
    onLandM: onLand, underOnLand: Object.fromEntries(landUnder),
  };
  R._blocks = blocks;
}

// ---------- 4) 桥端 × 台阶接缝：桥端截面前后 ±0.5 m、横向 -1.1..1.1 的顶面高度剖面 ----------
{
  const struct = new Q.VGrid(W.nodes.filter((n) => isBridge(n) || /jiuqu-bridge-step/.test(n.id || '') || n.id === 'east-landing-access-apron'), { cell: 0.5 });
  const ends = [['jiuqu-bridge-step-w', Q.BRIDGE_LINE[0], Q.BRIDGE_LINE[1]], ['jiuqu-bridge-step-e', Q.BRIDGE_LINE.at(-1), Q.BRIDGE_LINE.at(-2)]];
  R.seams = ends.map(([id, e, inner]) => {
    const st = Q.OBJ.get(id).geometry;
    const into = [(inner[0] - e[0]), (inner[1] - e[1])], L = Math.hypot(...into); into[0] /= L; into[1] /= L;
    const side = [-into[1], into[0]];
    const fwd = [Math.sin(st.rotY), Math.cos(st.rotY)];
    const yawDiffDeg = Math.acos(Math.max(-1, Math.min(1, fwd[0] * into[0] + fwd[1] * into[1]))) * 180 / Math.PI;
    // 台阶中线到桥端中线的横向偏移
    const lateral = (st.position[0] - e[0]) * side[0] + (st.position[1] - e[1]) * side[1];
    const prof = [];
    let gaps = 0, jumps = 0, maxJump = 0;
    for (const a of [-1.1, -0.6, 0, 0.6, 1.1]) {
      let prev = null;
      for (let d = -0.6; d <= 0.6001; d += 0.02) {
        const x = e[0] + into[0] * d + side[0] * a, z = e[1] + into[1] * d + side[1] * a;
        const top = struct.column(x, z).find((h) => h.ny > 0.2 && h.y <= Q.DECK_Y + 0.05);
        const y = top ? top.y : null;
        if (y === null && Math.abs(a) < 1.0) gaps++;
        if (prev !== null && y !== null && Math.abs(y - prev) > 0.005 && d > -0.35) { jumps++; maxJump = Math.max(maxJump, Math.abs(y - prev)); }
        if (Math.abs(d % 0.1) < 0.011) prev !== undefined && prof.push({ across: a, d: f3(d), y: y === null ? null : f3(y) });
        prev = y;
      }
    }
    // 台阶顶面宽度 vs 桥面宽度：台阶盒与桥端横线相交区间
    return { id, endpoint: e.map(f3), yawDiffDeg: f3(yawDiffDeg), lateralOffsetM: f3(lateral), stepWidth: st.width, deckWidth: Q.BRIDGE_W, profileHoles: gaps, profileJumpsNearEnd: jumps, maxJumpM: f3(maxJump), profile: prof };
  });
}

// ---------- 5) 湖心亭承台 × 桥：共面重叠（z-fight）/ 三角互穿 / 承台与桥面缝 ----------
{
  const htN = W.nodes.filter(isHT), brN = W.nodes.filter(isBridge);
  const toTris = (nodes) => { const out = []; for (const n of nodes) { const { P, T } = n; for (let t = 0; t < T.length; t += 3) { const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]]; out.push({ A, B, C, node: n.name, min: [0, 1, 2].map((c) => Math.min(A[c], B[c], C[c])), max: [0, 1, 2].map((c) => Math.max(A[c], B[c], C[c])) }); } } return out; };
  const TA = toTris(htN), TB = toTris(brN);
  const inter = crossIntersect(TA, TB, 1.0);
  // 共面朝上重叠面积：0.1 m 网格上同时命中两者 y=0.55±0.005 朝上面
  const HG = new Q.VGrid(htN, { cell: 1.0 }), BG = new Q.VGrid(brN, { cell: 1.0 });
  const hx = Q.HT_POLY.map((p) => p[0]), hz = Q.HT_POLY.map((p) => p[1]);
  let both = 0, htOnly = 0;
  for (let x = Math.min(...hx) - 4; x <= Math.max(...hx) + 4; x += 0.1) for (let z = Math.min(...hz) - 4; z <= Math.max(...hz) + 4; z += 0.1) {
    const h = HG.column(x, z).find((q) => q.ny > 0.2 && Math.abs(q.y - Q.DECK_Y) < 0.006);
    if (!h) continue;
    const b = BG.column(x, z).find((q) => q.ny > 0.2 && Math.abs(q.y - Q.DECK_Y) < 0.006);
    if (b) both++; else htOnly++;
  }
  // 承台边到桥面边：沿桥中线在湖心亭附近横向扫，找桥面边与承台边之间的空隙（两者都不在 0.55 的地方）
  const gaps = [];
  const Lb = Q.polylineLength(Q.BRIDGE_LINE);
  for (let s = 0; s <= Lb; s += 0.25) {
    const a = Q.alongPolyline(Q.BRIDGE_LINE, s);
    const dHT = Q.distToPolyline(a.p, Q.HT_POLY, true).d;
    if (dHT > 5) continue;
    const side = [-a.dir[1], a.dir[0]];
    for (const sg of [-1, 1]) {
      let run = 0, started = false, seenHT = false;
      for (let w = 0; w <= 4; w += 0.05) {
        const x = a.p[0] + side[0] * sg * w, z = a.p[1] + side[1] * sg * w;
        const onB = BG.column(x, z).some((q) => q.ny > 0.2 && Math.abs(q.y - Q.DECK_Y) < 0.08);
        const onH = HG.column(x, z).some((q) => q.ny > 0.2 && Math.abs(q.y - Q.DECK_Y) < 0.006);
        if (onH) { seenHT = true; break; }
        if (!onB) { started = true; run += 0.05; }
      }
      if (seenHT && run > 0) gaps.push({ s: f3(s), side: sg, gapM: f3(run) });
    }
  }
  R.htBridge = { intersections: { crossings: inter.crossings, lenM: inter.lenM, coplanarTris: inter.coplanarTris, pairs: inter.pairs.slice(0, 10) }, coplanarUpOverlapM2: f3(both * 0.01), htDeckOnlyM2: f3(htOnly * 0.01), deckEdgeGaps: gaps.slice(0, 30), deckEdgeGapMax: gaps.length ? f3(Math.max(...gaps.map((g) => g.gapM))) : 0 };
}

// ---------- 6) 池带铺装 / 台阶：与相邻铺面共面、落地 ----------
{
  const pondFlat = W.nodes.filter((n) => ['pond-west-link', 'jiuqu-bridge-step-w', 'jiuqu-bridge-step-e', 'east-landing-access-apron'].includes(n.id));
  const rows = [];
  for (const n of pondFlat) {
    // 该件的朝上面采样点：正下方 0.03 m 内是否有其他件的朝上面（共面 / 近共面 z-fight 候选）
    const { P, T } = n; let area = 0, near = 0, nearBy = new Map(), downFacing = 0;
    for (let t = 0; t < T.length; t += 3) {
      const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const a2 = Math.hypot(...nr); if (a2 < 1e-9) continue;
      if (nr[1] / a2 < -0.9) downFacing += a2 / 2;
      if (nr[1] / a2 < 0.9) continue;
      area += a2 / 2;
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
      const other = G.column(cx, cz).find((h) => h.node !== n && h.ny > 0.2 && Math.abs(h.y - cy) < 0.03 && !isStructure(h.node));
      if (other) { near += a2 / 2; const k = other.node.id + ' dy=' + f3(cy - other.y); nearBy.set(k, (nearBy.get(k) || 0) + a2 / 2); }
    }
    rows.push({ id: n.id, file: n.file, upAreaM2: f3(area), nearCoplanarM2: f3(near), nearBy: Object.fromEntries([...nearBy].map(([k, v]) => [k, f3(v)])), downFacingM2: f3(downFacing) });
  }
  // 台阶最低一级外沿下方地面
  const stepFoot = Q.STEPS.map((o) => {
    const g = o.geometry, n = g.stepCount, fwd = [Math.sin(g.rotY), Math.cos(g.rotY)], across = [Math.cos(g.rotY), -Math.sin(g.rotY)];
    const d = -(0.18 + (n - 1) * 0.32) - 0.25; // 最低一级外侧 0.25 m
    const out = [];
    for (const a of [-0.9, 0, 0.9]) {
      const x = g.position[0] + fwd[0] * d + across[0] * a, z = g.position[1] + fwd[1] * d + across[1] * a;
      const top = G.column(x, z).filter((h) => !isStructure(h.node) && !/jiuqu-bridge-step/.test(h.node.id || '')).find((h) => h.ny > 0.2 && h.y < 0.6);
      out.push({ across: a, groundY: top ? f3(top.y) : null, owner: top ? top.node.id : null, inWater: Q.pointInPoly([x, z], Q.WATER_POLY) });
    }
    return { id: o.id, bottomTreadTopY: f3(g.bottomY + (g.topY - g.bottomY) / n), bottomY: g.bottomY, foot: out };
  });
  // 池西步道离水边的距离
  const pwl = Q.OBJ.get('pond-west-link');
  let minD = Infinity, overWater = 0;
  const Lp = Q.polylineLength(pwl.geometry.polyline);
  for (let s = 0; s <= Lp; s += 0.25) { const a = Q.alongPolyline(pwl.geometry.polyline, s); const d = Q.distToPolyline(a.p, Q.WATER_POLY, true).d; const inW = Q.pointInPoly(a.p, Q.WATER_POLY); if (inW) overWater += 0.25; minD = Math.min(minD, inW ? -d : d); }
  R.paving = { surfaces: rows, stepFoot, pondWestLink: { lengthM: f3(Lp), widthM: pwl.width, centreMinDistToWaterM: f3(minD), centreOverWaterM: overWater, edgeMinDistM: f3(minD - pwl.width / 2) } };
}

// ---------- 7) 背面朝外（站点模块 GLB + 池带程序化件） ----------
{
  const mods = [['jiuqu-bridge', path.join(OUT, 'jiuqu-bridge.glb')], ['huxin-ting', path.join(OUT, 'huxin-ting.glb')]];
  const out = {};
  for (const [id, f] of mods) {
    if (!fs.existsSync(f)) { out[id] = 'missing'; continue; }
    const t = readGlbTree(f, { normLimit: 1e6 });
    const bf = backfaces({ nodes: t.nodes.map((n) => ({ ...n, material: n.material || {} })) });
    out[id] = bf.map((b) => ({ node: b.node, tris: b.tris, doubleSided: b.doubleSided, windingVsNormal: b.windingVsNormal, closedIslands: b.closed.islands, invertedIslands: b.closed.invertedIslands, inwardTris: b.closed.inwardTris, inwardAreaM2: b.closed.inwardAreaM2, openIslands: b.openIslands, invertedSample: b.closed.invertedSample.slice(0, 3) }));
  }
  // 程序化池带件（分区 GLB 里）：水面 / 步道 / 台阶的朝上面是否真朝上（单面材质下朝下 = 从上看不见）
  const flat = W.nodes.filter((n) => isWater(n) || ['pond-west-link', 'jiuqu-bridge-step-w', 'jiuqu-bridge-step-e', 'east-landing-access-apron'].includes(n.id));
  out.procedural = flat.map((n) => {
    const b = backfaces({ nodes: [{ ...n, material: { doubleSided: n.doubleSided } }] })[0];
    return { id: n.id, file: n.file, doubleSided: n.doubleSided, tris: b.tris, windingVsNormal: b.windingVsNormal, closedIslands: b.closed.islands, invertedIslands: b.closed.invertedIslands, inwardTris: b.closed.inwardTris, openIslands: b.openIslands };
  });
  R.backfaces = out;
}

// ---------- 8) 贴图撞名：池带分件的贴图 vs 其他分件（名 + 尺寸同、内容不同） ----------
{
  const files = W.manifest.zones.map((z) => z.file);
  const all = [];
  for (const f of files) for (const im of imagesOf(path.join(OUT, f))) all.push({ file: f, ...im });
  for (const f of ['jiuqu-bridge.glb', 'huxin-ting.glb']) if (fs.existsSync(path.join(OUT, f))) for (const im of imagesOf(path.join(OUT, f))) all.push({ file: f, ...im });
  const pondKeys = new Set(all.filter((i) => /pond|jiuqu|huxin/.test(i.file)).map((i) => i.key + '|' + (i.dims || []).join('x')));
  const clashes = [];
  for (const k of pondKeys) {
    const g = all.filter((i) => i.key + '|' + (i.dims || []).join('x') === k);
    const shas = [...new Set(g.map((i) => i.sha))];
    if (shas.length > 1) clashes.push({ key: k, variants: shas.map((s) => ({ sha: s.slice(0, 12), files: g.filter((i) => i.sha === s).map((i) => i.file) })) });
  }
  R.textures = { pondImages: all.filter((i) => /pond|jiuqu|huxin/.test(i.file)).map((i) => ({ file: i.file, name: i.name, dims: i.dims, sha: i.sha.slice(0, 12), users: i.users })), clashes };
}

// ---------- 9) 岸线穿插：除桥墩 / 湖心亭桩外，穿过水面的三角（建筑、墙、铺面插进水面） ----------
{
  const toTris = (nodes) => { const out = []; for (const n of nodes) { const { P, T } = n; for (let t = 0; t < T.length; t += 3) { const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]]; const mn = [0, 1, 2].map((c) => Math.min(A[c], B[c], C[c])), mx = [0, 1, 2].map((c) => Math.max(A[c], B[c], C[c])); if (mx[0] < REGION[0] || mn[0] > REGION[2] || mx[2] < REGION[1] || mn[2] > REGION[3]) continue; out.push({ A, B, C, node: n.file + ' ' + n.id, min: mn, max: mx }); } } return out; };
  const TW = toTris(W.nodes.filter(isWater));
  const TO = toTris(W.nodes.filter((n) => !isWater(n) && !isStructure(n) && n.file.indexOf('fangbang') < 0)).filter((t) => t.min[1] < Q.WATER_Y && t.max[1] > Q.WATER_Y);
  const x = crossIntersect(TW, TO, 1.0);
  R.waterCrossings = { crossings: x.crossings, lenM: x.lenM, byOwner: x.pairs.map((p) => ({ owner: p.pair.split(' × ')[1], crossings: p.crossings, lenM: p.lenM, min: p.min, max: p.max })) };
  // 建筑 footprint 落在水池多边形里的面积（layout 重算，0.25 m 网格）
  const over = [];
  for (const o of Q.LAYOUT.objects) {
    const fp = o.geometry?.footprint; if (!fp || o.id === Q.POND_WATER_ID || o.kind === 'water' || o.skipRender) continue;
    const bx = fp.map((p) => p[0]), bz = fp.map((p) => p[1]);
    if (Math.max(...bx) < Math.min(...xs) || Math.min(...bx) > Math.max(...xs) || Math.max(...bz) < Math.min(...zs) || Math.min(...bz) > Math.max(...zs)) continue;
    let n = 0;
    for (let x0 = Math.min(...bx); x0 <= Math.max(...bx); x0 += 0.25) for (let z0 = Math.min(...bz); z0 <= Math.max(...bz); z0 += 0.25) if (Q.pointInPoly([x0, z0], fp) && Q.pointInPoly([x0, z0], Q.WATER_POLY)) n++;
    if (n) over.push({ id: o.id, kind: o.kind, zone: o.zone, name: o.name || null, inWaterM2: f3(n * 0.0625) });
  }
  R.footprintsInWater = over.sort((a, b) => b.inWaterM2 - a.inWaterM2);
}

delete R._blocks;
const txt = JSON.stringify(R, null, 1);
if (REPORT) fs.writeFileSync(REPORT, txt);
const brief = { water: { ...R.water, grid: { ...R.water.grid, holeSamples: R.water.grid.holeSamples.length } }, shore: { ...R.shore, samplesDetail: undefined }, bridge: R.bridge, seams: R.seams.map((s) => ({ ...s, profile: undefined })), htBridge: { ...R.htBridge, intersections: { ...R.htBridge.intersections, pairs: R.htBridge.intersections.pairs.slice(0, 4) } }, paving: R.paving, textures: { clashes: R.textures.clashes }, waterCrossings: R.waterCrossings, footprintsInWater: R.footprintsInWater };
console.log(JSON.stringify(brief, null, 1));
