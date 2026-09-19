// East-band shop plan (adoption batch package J, G5): the east-band upgrade
// mirrors the west-band R1 rules — map the 9 east placeholders
// (shop-134..142) to frozen street modules (category→module), SET BACK every
// placeholder box behind the 5.6 m front line of the BUILT east-extension
// centerline (kit/out/east-extension-spec.json samples, J2), then place every
// front wall ON that front line (J3): frontCenter = foot + normal × 5.6 (own
// side of the road), yaw = atan2(nx, nz) so the module's local +Z facade
// faces the road. Overlap resolution shifts along the pair's shared road
// tangent; cross-side SAT sweep keeps opposite rows clear; gaps 1.5–8 m on a
// side become courtyard strips (h2.9 t0.28, plaster + cap), >8 m stays open.
//
// Run: node scripts/build_eastshops_plan.mjs
// Out: kit/out/east-band/plan.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER_IDS = ['shop-134', 'shop-135', 'shop-136', 'shop-137', 'shop-138',
  'shop-139', 'shop-140', 'shop-141', 'shop-142'];
// DESIGN_SPEC.packageJ.placeholders.moduleByCategory
const MAP = {
  参茸: 'curio-a', 药材: 'pharmacy_shop', 南北杂货: 'dry_goods_shop',
  照相店: 'photo_shop', 字画店: 'curio-a',
};
const DEFAULTS = ['plain-v1', 'plain-v2', 'plain-v3']; // 木器/洋货/海味/腌腊 rotate
const FRONTLINE_M = 5.6;

const blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v3/blocks.json'), 'utf8'));
const phs = Object.fromEntries(blocks.placeholders.map((p) => [p.id, p]));
const centerline = JSON.parse(await readFile(resolve(root, 'kit/out/east-extension-spec.json'), 'utf8'));
const SAMPLES = centerline.samples; // {s, x, z, southNx, southNz, widthM}

const moduleDims = {};
for (const m of ['plain-v1', 'plain-v2', 'plain-v3', 'pharmacy_shop', 'dry_goods_shop', 'photo_shop', 'curio-a']) {
  const c = JSON.parse(await readFile(resolve(root, `building/${m}/collision.json`), 'utf8'));
  let xMin = 1e9, xMax = -1e9, zMin = 1e9, zMax = -1e9;
  for (const r of c.colliders) {
    xMin = Math.min(xMin, r.center[0] - r.size[0] / 2);
    xMax = Math.max(xMax, r.center[0] + r.size[0] / 2);
    zMin = Math.min(zMin, r.center[2] - r.size[2] / 2);
    zMax = Math.max(zMax, r.center[2] + r.size[2] / 2);
  }
  moduleDims[m] = { facadeM: +(xMax - xMin).toFixed(2), depthM: +(zMax - zMin).toFixed(2) };
}

function projectOnCenterline(x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < SAMPLES.length; i++) {
    const d = (SAMPLES[i].x - x) ** 2 + (SAMPLES[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const footOnSegment = (a, b) => {
    const abx = b.x - a.x, abz = b.z - a.z;
    const L2 = abx * abx + abz * abz;
    if (L2 === 0) return null;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / L2;
    if (t < 0 || t > 1) return null;
    return { fx: a.x + t * abx, fz: a.z + t * abz, s: a.s + t * (b.s - a.s) };
  };
  const cands = [];
  for (const j of [best - 1, best]) {
    if (j < 0 || j + 1 >= SAMPLES.length) continue;
    const f = footOnSegment(SAMPLES[j], SAMPLES[j + 1]);
    if (f) cands.push({ ...f, j });
  }
  if (!cands.length) cands.push({ fx: SAMPLES[best].x, fz: SAMPLES[best].z, s: SAMPLES[best].s, j: best });
  cands.sort((p, q) => (p.fx - x) ** 2 + (p.fz - z) ** 2 - ((q.fx - x) ** 2 + (q.fz - z) ** 2));
  const f = cands[0];
  const A = SAMPLES[f.j], B = SAMPLES[Math.min(f.j + 1, SAMPLES.length - 1)];
  const tseg = B.s === A.s ? 0 : (f.s - A.s) / (B.s - A.s);
  const nInterp = [A.southNx + tseg * (B.southNx - A.southNx), A.southNz + tseg * (B.southNz - A.southNz)];
  const nL = Math.hypot(nInterp[0], nInterp[1]);
  const i0 = Math.max(0, Math.min(SAMPLES.length - 2, best));
  const dx = SAMPLES[i0 + 1].x - SAMPLES[i0].x, dz = SAMPLES[i0 + 1].z - SAMPLES[i0].z;
  const L = Math.hypot(dx, dz);
  return { foot: [f.fx, f.fz], s: f.s, idx: best, T: [dx / L, dz / L],
           southN: [nInterp[0] / nL, nInterp[1] / nL] };
}

// box nearest-distance to the centerline (obb vs polyline, 2D)
function boxCenterlineDist(px, pz, theta, hw, hd) {
  let best = Infinity, bestFoot = null;
  for (let i = 0; i < SAMPLES.length; i++) {
    const q = SAMPLES[i];
    const dx = px - q.x, dz = pz - q.z;
    const lx = Math.cos(theta) * dx - Math.sin(theta) * dz;
    const lz = Math.sin(theta) * dx + Math.cos(theta) * dz;
    const d = Math.hypot(max0(Math.abs(lx) - hw), max0(Math.abs(lz) - hd));
    if (d < best) { best = d; bestFoot = q; }
  }
  return { d: best, foot: bestFoot };
}
const max0 = (v) => Math.max(v, 0);

// --- J2: setback every placeholder behind the 5.6 front line -------------------
const setbacks = [];
for (const id of PLACEHOLDER_IDS) {
  const p = phs[id];
  if (!p) { setbacks.push({ id, error: 'placeholder missing' }); continue; }
  const hw = p.widthM / 2, hd = p.depthM / 2, theta = p.angleRad ?? 0;
  const [px, pz] = p.glbPoint;
  const proj = projectOnCenterline(px, pz);
  const southN = proj.southN;
  const sideDot = (px - proj.foot[0]) * southN[0] + (pz - proj.foot[1]) * southN[1];
  const sign = sideDot >= 0 ? 1 : -1;           // own side of the road
  const away = [sign * southN[0], sign * southN[1]];  // away-from-road: foot -> box direction
  const { d } = boxCenterlineDist(px, pz, theta, hw, hd);
  const needed = Math.max(0, +(FRONTLINE_M - d).toFixed(3));
  const glbPoint = [+(px + away[0] * needed).toFixed(4), +(pz + away[1] * needed).toFixed(4)];
  setbacks.push({
    id, side: sign > 0 ? 'north' : 'south',
    previousGlbPoint: [px, pz],
    glbPoint,                                  // retreated position (v4 blocks.json)
    placementAdjust: { shiftM: needed, alongNormal: [+away[0].toFixed(5), +away[1].toFixed(5)],
      rule: 'box road-side corner retired to the 5.6m front line of the BUILT east centerline' },
    minDistBeforeM: +d.toFixed(3),
  });
}
const setbackBy = Object.fromEntries(setbacks.map((s) => [s.id, s]));

// --- J3: module placements on the front line -----------------------------------
const entries = [];
let defIdx = 0;
for (const id of PLACEHOLDER_IDS) {
  const sb = setbackBy[id];
  if (!sb || sb.error) { entries.push({ id, error: sb?.error ?? 'setback missing' }); continue; }
  const cat = phs[id].category ?? 'default';
  let module = MAP[cat];
  if (!module) module = DEFAULTS[defIdx++ % 3];
  const dims = moduleDims[module];
  const [px, pz] = sb.glbPoint;               // post-setback placeholder center
  const proj = projectOnCenterline(px, pz);
  const { foot, s: footS, T, southN } = proj;
  const sideDot = (px - foot[0]) * southN[0] + (pz - foot[1]) * southN[1];
  const sign = sideDot >= 0 ? 1 : -1;
  const side = sign > 0 ? 'north' : 'south';
  const nx = -sign * southN[0];
  const nz = -sign * southN[1];
  const frontCenter = [+(foot[0] + FRONTLINE_M * sign * southN[0]).toFixed(3),
                       +(foot[1] + FRONTLINE_M * sign * southN[1]).toFixed(3)];
  const yawRad = +Math.atan2(nx, nz).toFixed(6);
  entries.push({
    id, category: cat, module, side,
    frontCenter, yawRad,
    tangent: [+T[0].toFixed(6), +T[1].toFixed(6)],
    facadeM: dims.facadeM, depthM: dims.depthM,
    placeholderWidthM: phs[id].widthM,
    footS: +footS.toFixed(3),
    roadDistanceM: +Math.hypot(frontCenter[0] - foot[0], frontCenter[1] - foot[1]).toFixed(3),
  });
}

// --- overlap resolution (same-side, along the shared tangent) -------------------
const shiftLog = [];
const sides = { north: [], south: [] };
for (const e of entries) {
  if (e.error) continue;
  (sides[e.side] = sides[e.side] ?? []).push(e);
}
for (const [side, list] of Object.entries(sides)) {
  if (!list.length) continue;
  const axis = list.reduce((a, e) => [a[0] + e.tangent[0], a[1] + e.tangent[1]], [0, 0]);
  const AL = Math.hypot(axis[0], axis[1]);
  const AT = [axis[0] / AL, axis[1] / AL];
  for (const e of list) e.tCoord = e.frontCenter[0] * AT[0] + e.frontCenter[1] * AT[1];
  list.sort((a, b) => a.tCoord - b.tCoord);
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    const pairT = (() => {
      const tx = (prev.tangent[0] + cur.tangent[0]) / 2, tz = (prev.tangent[1] + cur.tangent[1]) / 2;
      const L = Math.hypot(tx, tz);
      return [tx / L, tz / L];
    })();
    const resolveOverlap = (a, b) => {
      const ta = a.frontCenter[0] * pairT[0] + a.frontCenter[1] * pairT[1];
      const tb = b.frontCenter[0] * pairT[0] + b.frontCenter[1] * pairT[1];
      const overlap = (ta + a.facadeM / 2) - (tb - b.facadeM / 2);
      if (overlap <= 0.2) return 0;
      const half = overlap / 2;
      a.frontCenter = [+(a.frontCenter[0] - pairT[0] * half).toFixed(3), +(a.frontCenter[1] - pairT[1] * half).toFixed(3)];
      b.frontCenter = [+(b.frontCenter[0] + pairT[0] * (overlap - half)).toFixed(3), +(b.frontCenter[1] + pairT[1] * (overlap - half)).toFixed(3)];
      shiftLog.push({ side, a: a.id, b: b.id, overlapM: +overlap.toFixed(2),
        shifted: { [a.id]: +(-half).toFixed(2), [b.id]: +(overlap - half).toFixed(2) } });
      return overlap;
    };
    resolveOverlap(prev, cur);
    for (let j = i - 1; j > 0; j--) {
      if (resolveOverlap(list[j - 1], list[j]) === 0) break;
    }
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const ta = a.frontCenter[0] * AT[0] + a.frontCenter[1] * AT[1];
    const tb = b.frontCenter[0] * AT[0] + b.frontCenter[1] * AT[1];
    a.tCoord = +ta.toFixed(3);
    b.tCoord = +tb.toFixed(3);
    b.gapToPrevM = +((tb - b.facadeM / 2) - (ta + a.facadeM / 2)).toFixed(2);
  }
}

const finalEntries = [];
for (const side of ['north', 'south']) {
  for (const e of sides[side] ?? []) {
    e.finalCenter = [e.frontCenter[0], 0, e.frontCenter[1]];
    finalEntries.push(e);
  }
}

// --- cross-side SAT sweep (same as the west band) -------------------------------
const sat2d = (a, b) => {
  const centerOf = (o) => [o.frontCenter[0] - Math.sin(o.yawRad) * o.depthM / 2,
                           o.frontCenter[1] - Math.cos(o.yawRad) * o.depthM / 2];
  const cornersOf = (o) => {
    const [cx2, cz2] = centerOf(o);
    const c = Math.cos(o.yawRad), s = Math.sin(o.yawRad);
    return [[o.facadeM / 2, o.depthM / 2], [o.facadeM / 2, -o.depthM / 2],
      [-o.facadeM / 2, o.depthM / 2], [-o.facadeM / 2, -o.depthM / 2]]
      .map(([x, z]) => [cx2 + c * x + s * z, cz2 - s * x + c * z]);
  };
  const A = cornersOf(a), B = cornersOf(b);
  const axes = [];
  for (const o of [a, b]) {
    const c = Math.cos(o.yawRad), s = Math.sin(o.yawRad);
    axes.push([c, -s], [s, c]);
  }
  for (const ax of axes) {
    const pa = A.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    const pb = B.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
};
const crossShifts = [];
for (let i = 0; i < finalEntries.length; i++) {
  for (let j = i + 1; j < finalEntries.length; j++) {
    const a = finalEntries[i], b = finalEntries[j];
    if (a.side === b.side) continue;
    let guard = 0;
    while (sat2d(a, b) && guard++ < 32) {
      const step = 0.25;
      const [da, db] = a.footS <= b.footS ? [step, -step] : [-step, step];
      a.frontCenter = [+(a.frontCenter[0] + a.tangent[0] * da).toFixed(3), +(a.frontCenter[1] + a.tangent[1] * da).toFixed(3)];
      b.frontCenter = [+(b.frontCenter[0] + b.tangent[0] * db).toFixed(3), +(b.frontCenter[1] + b.tangent[1] * db).toFixed(3)];
    }
    if (guard > 0) crossShifts.push({ a: a.id, b: b.id, shiftM: +(guard * 0.25).toFixed(2) });
    if (guard >= 32) crossShifts.push({ blocker: `${a.id} x ${b.id} could not be separated` });
  }
}

await mkdir(resolve(root, 'kit/out/east-band'), { recursive: true });
const out = {
  spec: 'packageJ_east.placeholders',
  frontline: { rule: 'front wall center = centerline foot + normal × 5.6 (own side of the road); yaw = atan2(nx, nz)',
    source: 'kit/out/east-extension-spec.json samples (the BUILT east-extension centerline)' },
  moduleDims,
  setbacks,
  shiftLog,
  crossShifts,
  note: 'strips computed by the v4 world builder from gapToPrevM (strip = courtyard wall h2.9 t0.28 plaster+cap, design_inference)',
  entries: finalEntries,
};
await writeFile(resolve(root, 'kit/out/east-band/plan.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`EASTSHOPS_PLAN entries=${finalEntries.length} setbacks=${setbacks.filter((s) => s.placementAdjust && s.placementAdjust.shiftM > 0).length}/${setbacks.length} shifts=${shiftLog.length} ` +
  `north=${sides.north?.length ?? 0} south=${sides.south?.length ?? 0}`);
for (const e of finalEntries) {
  console.log(`  ${e.id} ${e.module} ${e.side} roadDist=${e.roadDistanceM} footS=${e.footS} facade=${e.facadeM} gapPrev=${e.gapToPrevM ?? '-'}`);
}
