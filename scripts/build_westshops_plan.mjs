// B0/B1 — west-band shop plan: map the 17 active west-extension placeholders
// to frozen street modules (category→module), resolve overlaps along the road
// tangent (sequential shift), record gaps > 1.5 m as courtyard-strip walls.
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
  const frontCenter = [p.glbPoint[0], p.glbPoint[1]];
  const T = [Math.cos(p.angleRad + Math.PI / 2), Math.sin(p.angleRad + Math.PI / 2)];
  entries.push({
    id, category: cat, module,
    frontCenter: [p.glbPoint[0], p.glbPoint[1]], yawRad: p.angleRad,
    tangent: T, facadeM: dims.facadeM, depthM: dims.depthM,
    placeholderWidthM: p.widthM,
  });
}

// facade normal z-component decides the row: facade +Z-ish = north row
const sides = { north: [], south: [] };
for (const e of entries) {
  if (e.error) continue;
  const nz = Math.sin(e.yawRad);
  const side = nz >= 0 ? 'north' : 'south';
  (sides[side] = sides[side] ?? []).push(e);
  e.side = side;
}

// overlap resolution per side: sort along the shared tangent, push on overlap
const shiftLog = [];
for (const [side, list] of Object.entries(sides)) {
  if (!list.length) continue;
  const T = [list.reduce((s, e) => s + e.tangent[0], 0) / list.length,
             list.reduce((s, e) => s + e.tangent[1], 0) / list.length];
  const TL = Math.hypot(T[0], T[1]); T[0] /= TL; T[1] /= TL;
  for (const e of list) {
    e.T = T;
    e.tCoord = e.frontCenter[0] * T[0] + e.frontCenter[1] * T[1];
  }
  list.sort((a, b) => a.tCoord - b.tCoord);
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    const prevEnd = prev.tCoord + prev.facadeM / 2;
    const curStart = cur.tCoord - cur.facadeM / 2;
    const overlap = prevEnd - curStart;
    if (overlap > 0.2) {
      const half = overlap / 2;
      prev.tCoord -= half;
      prev.frontCenter = [prev.frontCenter[0] - T[0] * half, prev.frontCenter[1] - T[1] * half];
      cur.tCoord += overlap - half;
      cur.frontCenter = [cur.frontCenter[0] + T[0] * (overlap - half),
                         cur.frontCenter[1] + T[1] * (overlap - half)];
      shiftLog.push({ side, a: prev.id, b: cur.id, overlapM: +overlap.toFixed(2),
        shifted: { [prev.id]: +(-half).toFixed(2), [cur.id]: +(overlap - half).toFixed(2) } });
      for (let j = i - 1; j > 0; j--) {
        const p2 = list[j - 1], c2 = list[j];
        const p2End = p2.tCoord + p2.facadeM / 2;
        const c2Start = c2.tCoord - c2.facadeM / 2;
        const ov2 = p2End - c2Start;
        if (ov2 > 0.2) {
          p2.tCoord -= ov2;
          p2.frontCenter = [p2.frontCenter[0] - T[0] * ov2, p2.frontCenter[1] - T[1] * ov2];
          shiftLog.push({ side, a: p2.id, b: c2.id, overlapM: +ov2.toFixed(2),
            shifted: { [p2.id]: +(-ov2).toFixed(2) } });
        } else break;
      }
    }
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    b.gapToPrevM = +((b.tCoord - b.facadeM / 2) - (a.tCoord + a.facadeM / 2)).toFixed(2);
  }
}

const finalEntries = [];
for (const side of ['north', 'south']) {
  for (const e of sides[side] ?? []) {
    const T = e.T;
    e.finalCenter = [e.frontCenter[0], 5.6, e.frontCenter[1]];
    void T;
    finalEntries.push(e);
  }
}

await mkdir(resolve(root, 'kit/out/westshops'), { recursive: true });
const out = {
  spec: 'packageB_westBandShops',
  moduleDims,
  shiftLog,
  note: 'strips computed by the v3 world builder from gapToPrevM (strip = courtyard wall h2.9 t0.28 plaster+瓦帽, design_inference)',
  entries: finalEntries,
};
await writeFile(resolve(root, 'kit/out/westshops/plan.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`WESTSHOPS_PLAN entries=${finalEntries.length} shifts=${shiftLog.length} ` +
  `north=${sides.north?.length ?? 0} south=${sides.south?.length ?? 0}`);
for (const e of finalEntries) console.log(`  ${e.id} ${e.module} ${e.side} facade=${e.facadeM} gapPrev=${e.gapToPrevM ?? '-'}`);
