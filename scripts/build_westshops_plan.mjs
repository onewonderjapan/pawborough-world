// B0/B1 — west-band shop plan (R1-01 rewrite): map the 17 active
// west-extension placeholders to frozen street modules (category→module) and
// place every front wall ON the 5.6 m front line of the BUILT west-extension
// centerline (kit/out/fangbang-temple/west-extension-spec.json samples), not
// at the map centroid. Per shop: take the bridge-R1-adjusted placeholder
// center (glbPoint + placementAdjust.shiftM × alongNormal), project it onto
// the centerline (foot point + arc length), then frontCenter = foot + normal
// × 5.6 (south normal for north-row shops, negated for south-row) and
// yaw = atan2(nx, nz) so the module's local +Z facade faces the road.
// Overlap resolution shifts along the LOCAL road tangent of the pair; gaps
// > 1.5 m on one side become courtyard-strip walls (h2.9 t0.28).
//
// Run: node scripts/build_westshops_plan.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(await readFile(resolve(root, '..', 'DESIGN_SPEC.json'), 'utf8'));
const B = spec.packageB_westBandShops;
const MAP = B.moduleByCategory;
const blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/blocks.json'), 'utf8'));
const phs = Object.fromEntries(blocks.placeholders.map((p) => [p.id, p]));
const centerline = JSON.parse(await readFile(resolve(root, 'kit/out/fangbang-temple/west-extension-spec.json'), 'utf8'));
const SAMPLES = centerline.samples; // {s, x, z, southNx, southNz} along the BUILT centerline
const FRONTLINE_M = 5.6;

// module footprint: facade width + depth from the BUILDING collision records
// (module-local: facade along X, depth along Z)
const moduleDims = {};
for (const m of ['plain-v1', 'plain-v2', 'plain-v3', 'pharmacy_shop', 'cloth_shop',
  'curio-a', 'curio-b', 'restaurant-a', 'restaurant-b', 'dry_goods_shop', 'photo_shop']) {
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

// project (x,z) onto the sampled centerline: nearest vertex, then the two
// adjacent segments by linear foot projection; returns {foot:[x,z], s, idx}
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
  // normal interpolated AT the foot (curved sections: the nearest-vertex
  // normal deviates a couple of degrees from the true foot normal, which the
  // W2 yaw assertion would then flag)
  const A = SAMPLES[f.j], B = SAMPLES[Math.min(f.j + 1, SAMPLES.length - 1)];
  const tseg = B.s === A.s ? 0 : (f.s - A.s) / (B.s - A.s);
  const nInterp = [A.southNx + tseg * (B.southNx - A.southNx), A.southNz + tseg * (B.southNz - A.southNz)];
  const nL = Math.hypot(nInterp[0], nInterp[1]);
  // local road tangent from neighboring samples (road direction)
  const i0 = Math.max(0, Math.min(SAMPLES.length - 2, best));
  const dx = SAMPLES[i0 + 1].x - SAMPLES[i0].x, dz = SAMPLES[i0 + 1].z - SAMPLES[i0].z;
  const L = Math.hypot(dx, dz);
  return { foot: [f.fx, f.fz], s: f.s, idx: best, T: [dx / L, dz / L],
           southN: [nInterp[0] / nL, nInterp[1] / nL] };
}

const entries = [];
let defIdx = 0;
for (const id of B.placeholderIds) {
  const p = phs[id];
  if (!p) { entries.push({ id, error: 'placeholder missing' }); continue; }
  const cat = p.category ?? 'default';
  const DEFAULTS = ['plain-v1', 'plain-v2', 'plain-v3'];
  let module = MAP[cat];
  if (!module) module = DEFAULTS[defIdx++ % 3];
  else if (module.includes('/')) module = module.split('/')[0];
  const dims = moduleDims[module];
  // bridge-R1-adjusted placeholder center (the retire-the-centroid result)
  const adj = p.placementAdjust ?? { shiftM: 0, alongNormal: [0, 0] };
  const px = p.glbPoint[0] + adj.shiftM * adj.alongNormal[0];
  const pz = p.glbPoint[1] + adj.shiftM * adj.alongNormal[1];
  const proj = projectOnCenterline(px, pz);
  const { foot, s: footS, T } = proj;
  // which side of the road is this shop on? dot(center-foot, southN): the
  // sample's southNx/southNz point toward the +z side (verified against the
  // placeholders — north-row shops sit at foot + 5.6·southN)
  const southN = proj.southN; // interpolated at the foot point
  const sideDot = (px - foot[0]) * southN[0] + (pz - foot[1]) * southN[1];
  const sign = sideDot >= 0 ? 1 : -1;   // shop stays on ITS OWN side of the road
  const side = sign > 0 ? 'north' : 'south';
  // front = foot + 5.6·(sign·southN) — the SAME side as the placeholder;
  // facade normal = toward the road = the opposite direction. (Getting either
  // sign backwards puts shops across the road or aims facades outward.)
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
    placeholderWidthM: p.widthM,
    footS: +footS.toFixed(3),
    roadDistanceM: +Math.hypot(frontCenter[0] - foot[0], frontCenter[1] - foot[1]).toFixed(3),
  });
}

// overlap resolution per side: order along the local road tangent, shift
// pairs apart along their SHARED average tangent (frontline is near-straight
// over one facade width)
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
    const pairT = (() => { // tangent shared by the pair (local road direction)
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
    e.finalCenter = [e.frontCenter[0], 0, e.frontCenter[1]]; // real 3D, ground level
    finalEntries.push(e);
  }
}

// cross-side SAT sweep: at the road ends two shops of OPPOSITE rows stand
// corner-to-corner, and their out-of-road bodies (floor/back wall) can
// interpenetrate even though each front wall is exactly on its 5.6 m line.
// Approximate each shop by its full footprint (front wall center, facade ×
// depth, facade normal toward the road) and shift an overlapping pair along
// each shop's OWN road tangent (sign chosen to separate them) until the SAT
// clears — tangential motion keeps the front line exact.
const sat2d = (a, b) => {
  // facade normal (toward road) = (sin yaw, cos yaw); body extends BEHIND the
  // front wall (away from road) by depth → box center = front − normal·depth/2
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
    if (a.side === b.side) continue; // same-side pairs handled above
    let guard = 0;
    while (sat2d(a, b) && guard++ < 32) {
      const step = 0.25;
      // shift both along their own tangent, in the direction that separates
      // their foot points (larger footS moves further out)
      const [da, db] = a.footS <= b.footS ? [step, -step] : [-step, step];
      a.frontCenter = [+(a.frontCenter[0] + a.tangent[0] * da).toFixed(3), +(a.frontCenter[1] + a.tangent[1] * da).toFixed(3)];
      b.frontCenter = [+(b.frontCenter[0] + b.tangent[0] * db).toFixed(3), +(b.frontCenter[1] + b.tangent[1] * db).toFixed(3)];
    }
    if (guard > 0) crossShifts.push({ a: a.id, b: b.id, shiftM: +(guard * 0.25).toFixed(2) });
    if (guard >= 32) crossShifts.push({ blocker: `${a.id} x ${b.id} could not be separated` });
  }
}

await mkdir(resolve(root, 'kit/out/westshops'), { recursive: true });
const out = {
  spec: 'packageB_westBandShops',
  frontline: { rule: 'front wall center = centerline foot + normal × 5.6 (south normal on the north row, negated on the south row); yaw = atan2(nx, nz)',
    source: 'kit/out/fangbang-temple/west-extension-spec.json samples (the BUILT west-extension centerline)' },
  moduleDims,
  shiftLog,
  crossShifts,
  note: 'strips computed by the v3 world builder from gapToPrevM (strip = courtyard wall h2.9 t0.28 plaster+瓦帽, design_inference); strip centers use the real front-wall midpoint, not a tangent-axis reconstruction',
  entries: finalEntries,
};
await writeFile(resolve(root, 'kit/out/westshops/plan.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`WESTSHOPS_PLAN entries=${finalEntries.length} shifts=${shiftLog.length} ` +
  `north=${sides.north?.length ?? 0} south=${sides.south?.length ?? 0}`);
for (const e of finalEntries) {
  console.log(`  ${e.id} ${e.module} ${e.side} roadDist=${e.roadDistanceM} footS=${e.footS} facade=${e.facadeM} gapPrev=${e.gapToPrevM ?? '-'}`);
}
