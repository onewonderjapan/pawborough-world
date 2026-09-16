// fangbang-temple bridge CONTRACT test — the static design contract of the
// assembled dataset, checked against the frozen DESIGN_SPEC numbers:
//   1. the 8 temple-axis GLBs are byte-exact copies (sha == temple-dadian manifest)
//   2. temple placement T/yaw equal DESIGN_SPEC
//   3. every assets-block positionGlb equals localToWorld(localOffset)
//   4. all 128 temple collision records recompose per colliderComposition
//      (obb pos/theta composition + yaw-expanded min/max, error <= 1e-6)
//   5. replacedRule lands exactly on shop-167/169 (replacedBy lifecycle intact)
//   6. route continuity (adjacent <= 6m) and every point inside a walkable
//      band projection (street 5.6m band / west-extension 5.6m band / temple
//      footprint), length ~320m
//   7. manifest triangle accounting = per-GLB measured; west extension
//      <= 8,000 tris; bridge-world total <= 300,000 (DESIGN_SPEC budget
//      scope: street assembly + temple axis + west extension; the page-level
//      full-scene number is reported and must equal the honest sum too)
//
// Run: node tests/fangbang_bridge_contract.test.mjs   (exit 0 = contract holds)
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASK = resolve(root, '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const j = (p) => readFile(resolve(root, p), 'utf8').then(JSON.parse);

const DS = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));
const B = 'world/fangbang-temple/';
const [manifest, instances, collision, route, blocks, registry, dadianManifest] = await Promise.all([
  j(B + 'review-manifest.json'), j(B + 'instances.json'), j(B + 'collision-world.json'),
  j(B + 'route.json'), j(B + 'blocks.json'), j(B + 'map-registry.json'), j('world/temple-dadian/review-manifest.json'),
]);
const T = DS.templePlacement.translationGlb;
const YAW = DS.templePlacement.yawRad;
const CY = Math.cos(YAW), SY = Math.sin(YAW);
const l2w = (lx, ly, lz) => [T[0] + CY * lx + SY * lz, ly, T[2] - SY * lx + CY * lz];

// --- 1. frozen copies ----------------------------------------------------------
for (const a of DS.templePlacement.assets) {
  const bytes = await readFile(resolve(root, B + 'temple-axis', a.glb));
  const ref = Object.values(dadianManifest.assets).find((x) => x.file.endsWith('/' + a.glb));
  check(`frozen copy ${a.glb}`, ref && sha(bytes) === ref.sha256 && bytes.byteLength === ref.bytes,
    `sha ${sha(bytes).slice(0, 10)}…`);
  const m = manifest.templeAxis.assets.find((x) => x.id === a.id);
  check(`manifest sha/bytes ${a.id}`, m && m.sha256 === sha(bytes) && m.bytes === bytes.byteLength);
}

// --- 2. placement equals DESIGN_SPEC ---------------------------------------------
check('registry T == DESIGN_SPEC', JSON.stringify(registry.templePlacement.translationGlb) === JSON.stringify(T));
check('registry yaw == DESIGN_SPEC', Math.abs(registry.templePlacement.yawRad - YAW) < 1e-12, `${YAW}`);

// --- 3. assets positions = localToWorld ------------------------------------------
const templeBlock = blocks.blocks.find((b) => b.id === DS.templePlacement.groupId);
check('temple assets block exists with 8 assets', templeBlock && templeBlock.assets.length === 8);
for (const a of DS.templePlacement.assets) {
  const rec = templeBlock.assets.find((x) => x.id === a.id);
  const w = l2w(a.localOffset[0], a.localOffset[1], a.localOffset[2]);
  const ok = rec && Math.abs(rec.positionGlb[0] - w[0]) < 1e-4 && Math.abs(rec.positionGlb[2] - w[2]) < 1e-4
    && rec.positionGlb[1] === w[1] && Math.abs(rec.rotationYRad - YAW) < 1e-9;
  check(`positionGlb ${a.id} = localToWorld`, ok, rec ? `${rec.positionGlb.map((v) => +v.toFixed(3))} vs ${w.map((v) => +v.toFixed(3))}` : 'missing');
}
const instById = new Map(instances.instances.map((i) => [i.id, i]));
for (const a of DS.templePlacement.assets) {
  const rec = templeBlock.assets.find((x) => x.id === a.id);
  const inst = instById.get(a.id);
  check(`instance ${a.id} matches block asset`, inst && JSON.stringify(inst.positionGlb) === JSON.stringify(rec.positionGlb) && inst.rotationYRad === rec.rotationYRad);
}

// --- 4. collision composition (all 128, recomputed independently) ----------------
const dadianCollision = await j('world/temple-dadian/collision-world.json');
check('temple record count preserved', collision.colliders.filter((c) => c.name.startsWith('shanmen:') || c.name.startsWith('yimen:') || c.name.startsWith('entrycourt-open:') || c.name.startsWith('dadian')).length === dadianCollision.colliders.length,
  `${dadianCollision.colliders.length} source records`);
let maxErr = 0;
let worst = '';
const COMPOSED_BASE = 209;   // collision.colliders = [...208 street, 1 wall, ...128 composed]
for (let i = 0; i < dadianCollision.colliders.length; i++) {
  const src = dadianCollision.colliders[i];
  const dst = collision.colliders[COMPOSED_BASE + i];
  if (!dst) { maxErr = Infinity; worst = src.name + ' missing'; break; }
  const { pos, theta, center, size } = dst.obb;
  const c2 = Math.cos(theta), s2 = Math.sin(theta);
  const cxw = pos[0] + c2 * center[0] + s2 * center[2];
  const czw = pos[2] - s2 * center[0] + c2 * center[2];
  const cs = [[size[0] / 2, size[2] / 2], [size[0] / 2, -size[2] / 2], [-size[0] / 2, size[2] / 2], [-size[0] / 2, -size[2] / 2]]
    .map(([lx, lz]) => [cxw + c2 * lx + s2 * lz, czw - s2 * lx + c2 * lz]);
  const err = Math.max(
    Math.abs(Math.min(...cs.map((p) => p[0])) - dst.min[0]), Math.abs(Math.max(...cs.map((p) => p[0])) - dst.max[0]),
    Math.abs(Math.min(...cs.map((p) => p[1])) - dst.min[2]), Math.abs(Math.max(...cs.map((p) => p[1])) - dst.max[2]));
  if (err > maxErr) { maxErr = err; worst = dst.name; }
  // theta composition: the slanted shanmen wing walls must carry theta+yaw
  if (Math.abs(src.obb.theta) > 0.1) {
    const expect = src.obb.theta + YAW;
    if (Math.abs(dst.obb.theta - expect) > 1e-7) { maxErr = Infinity; worst = dst.name + ' theta not composed'; }
  }
}
check('128 records recompose (obbToWorld corners vs min/max)', maxErr <= 1e-6, `maxErr ${maxErr.toExponential(2)} at ${worst}`);
check('west seal-wall record present', collision.colliders.some((c) => c.name === 'westext-seal-wall:seal-wall'));

// --- 5. replacedRule lands exactly on shop-167/169 --------------------------------
const replaced = blocks.placeholders.filter((p) => p.replacedBy === DS.templePlacement.groupId).map((p) => p.id).sort();
check('replacedBy == {167,169}', JSON.stringify(replaced) === JSON.stringify([...DS.placeholders.replacedByTempleAxis].sort()), replaced.join(','));
check('replaced placeholders not deleted', replaced.every((id) => blocks.placeholders.some((p) => p.id === id && p.baseId === id)));
check('west band carries all idsInBand', DS.placeholders.idsInBand.every((id) => blocks.placeholders.some((p) => p.id === id))
  , `${blocks.placeholders.length} placeholders total`);

// --- 6. route continuity + walkable-band projection --------------------------------
const pts = route.mainStreet;
let maxGap = 0;
for (let i = 1; i < pts.length; i++) maxGap = Math.max(maxGap, Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
check('route adjacent gaps <= 6m', maxGap <= 6.0, `max ${maxGap.toFixed(2)}m, ${pts.length} pts`);
const totalLen = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2]), 0);
check('route length ~320m', totalLen > 300 && totalLen < 340, `${totalLen.toFixed(1)}m`);
const westSpec = await j('kit/out/fangbang-temple/west-extension-spec.json');
const segDist = (a, b, p) => {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const L2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vz));
};
function localOf(p) {
  const dx = p[0] - T[0], dz = p[2] - T[2];
  const lx = CY * dx - SY * dz, lz = SY * dx + CY * dz;
  return (Math.abs(lx) <= 13.4 + 1 && lz >= -60 && lz <= 8) ? { lx, lz } : null;
}
const centerW = westSpec.samples.map((s) => [s.x, s.z]);
const distTo = (line, p) => Math.min(...line.slice(0, -1).map((c, i) => segDist(c, line[i + 1], p)));
const streetSeg = await j('world/segment.json');
const centerS = streetSeg.samplesMeters.map((s) => [s.x, s.z]);
let offBand = 0;
for (const p of pts) {
  if (localOf(p) !== null) continue;                       // temple footprint
  if (p[0] > 84) continue;                                 // delivered east tail band (S3 surface spec)
  const pz = [p[0], p[2]];
  const d = p[0] >= -4 ? distTo(centerS, pz) : distTo(centerW, pz);
  if (d > 6.1) { offBand += 1; if (offBand <= 6) console.error('   off-band pt', p.map((v) => +v.toFixed(2)).join(','), 'd=' + d.toFixed(1)); }
}
check('every route point on road band or temple footprint', offBand === 0, `${offBand} off-band`);
check('route terminal is the dadian doors', (() => {
  const e = pts[pts.length - 1];
  const l = localOf(e);
  return l && Math.abs(l.lz - (-43.2)) < 0.05 && Math.abs(l.lx) < 0.05;
})(), `local ${JSON.stringify(localOf(pts[pts.length - 1]))}`);

// --- 7. triangle accounting ---------------------------------------------------------
const assemblyGlb = readGlb(await readFile(resolve(root, 'world/street-reviewed.glb')));
check('manifest placedTriangles = measured assembly', assemblyGlb.totalTriangles === manifest.placedTriangles,
  `${assemblyGlb.totalTriangles}`);
let measuredTris = 0;
for (const a of manifest.templeAxis.assets) {
  const g = readGlb(await readFile(resolve(root, B + 'temple-axis', a.glb.split('/').pop())));
  measuredTris += g.totalTriangles;
  if (g.totalTriangles !== a.triangles) check(`temple tris ${a.id}`, false, `${g.totalTriangles} != manifest ${a.triangles}`);
}
check('temple placed tris measured', measuredTris === manifest.templeAxis.placedTriangles, `${measuredTris}`);
const westSurfaceGlb = readGlb(await readFile(resolve(root, B + 'west-extension/surface.glb')));
const wallGlb = readGlb(await readFile(resolve(root, B + 'west-extension/seal-wall.glb')));
check('west extension <= 8,000 tris', westSurfaceGlb.totalTriangles + wallGlb.totalTriangles <= DS.budgets.westExtensionTrisMax,
  `${westSurfaceGlb.totalTriangles}+${wallGlb.totalTriangles}`);
const bridge = manifest.placedTriangles + manifest.templeAxis.placedTriangles + westSurfaceGlb.totalTriangles + wallGlb.totalTriangles;
check('bridge world <= 300,000 (DESIGN_SPEC scope)', bridge <= DS.budgets.combinedPlacedTrianglesMax,
  `${bridge}`);
check('full-scene accounting is the honest sum', manifest.triangleAccounting.fullSceneTris === bridge + manifest.triangleAccounting.breakdown.tailShops + manifest.triangleAccounting.breakdown.eastTailSurface,
  `${manifest.triangleAccounting.fullSceneTris}`);

console.log(failures === 0 ? 'FANGBANG_BRIDGE_CONTRACT PASS' : `FANGBANG_BRIDGE_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
