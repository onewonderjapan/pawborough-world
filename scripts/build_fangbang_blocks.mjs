// N3: fangbang-temple bridge dataset — blocks.json + map-registry.json.
//
// blocks.json: the frozen base world/blocks.json is carried over (reviewed
// street + adjacent districts verbatim), the west band gains the four
// map-derived placeholders shop-168..171 (same derivation rule as
// scripts/build_blocks.mjs, x-band widened to the west end), and two assets
// blocks are added:
//   - block-east-edge-shops / block-street-completion-shops: copied VERBATIM
//     from the delivered datasets (128/129, 130..133 refined replacements)
//   - block-temple-axis: NEW — the 8 temple-axis GLBs placed by
//     localToWorld(localOffset) with rotationYRad = yaw (DESIGN_SPEC). Its
//     colliders live in the dataset collision-world.json (composed with
//     T+yaw there), NOT in per-asset sidecars: the block is the visual +
//     registry-suppression owner, the collision-world is the single wall
//     authority (no double colliders at runtime).
// Placeholder replacedBy is recomputed with DESIGN_SPEC's replacedRule and
// must land exactly on shop-167/169 (fallback #10: stop and re-check signs).
//
// map-registry.json: the lead-facing registration of this batch's positions
// against the frozen map (read-only source, sha recorded).
//
// Run: node scripts/build_fangbang_blocks.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASK = resolve(root, '..');
const OUT = resolve(root, 'world/fangbang-temple');
const MAP_PATH = '/home/baibai/outbox/pawborough-fangbang-map-1990s-20260912/workspace/public/map-data.json';
const sha = (b) => createHash('sha256').update(b).digest('hex');

const DS = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));
const base = JSON.parse(await readFile(resolve(root, 'world/blocks.json'), 'utf8'));
const completion = JSON.parse(await readFile(resolve(root, 'world/street-completion/blocks.json'), 'utf8'));
const mapRaw = await readFile(MAP_PATH);
const map = JSON.parse(mapRaw.toString('utf8'));

await mkdir(OUT, { recursive: true });

// --- temple frame -------------------------------------------------------------
const T = DS.templePlacement.translationGlb;
const YAW = DS.templePlacement.yawRad;
const CY = Math.cos(YAW), SY = Math.sin(YAW);
const localToWorld = (lx, lz) => [T[0] + CY * lx + SY * lz, T[2] - SY * lx + CY * lz];

// --- missing west-band placeholders (shop-168..171), build_blocks.mjs rule ----
const have = new Set(base.placeholders.map((p) => p.id));
const missing = DS.placeholders.idsInBand.filter((id) => !have.has(id));
const WEST_FLOOR = DS.westExtension.westEndGlb[0] - DS.westExtension.sealWall.widthM / 2 - 2.0; // band widened to the west end + seal wall margin
const added = [];
for (const s of map.shops) {
  if (!missing.includes(s.id)) continue;
  const gx = s.point[0] - 53.5, gz = s.point[1] + 17.4;   // anchor translation (build_blocks.mjs)
  if (!(gx < base.streetExtentX[0] - 4 && gx > WEST_FLOOR)) continue;
  added.push({
    id: s.id, baseId: s.id, replacedBy: null,
    mapPoint: s.point, glbPoint: [+gx.toFixed(3), +gz.toFixed(3)],
    angleRad: s.angle, widthM: s.width, depthM: s.depth, heightM: s.height,
    category: s.category,
    historicalPositionVerified: s.historicalPositionVerified === true,
    source: 'pawborough-fangbang-map-1990s (placeholder, low-poly extrusion only)',
  });
}
const gotIds = added.map((p) => p.id).sort();
const wantIds = [...missing].sort();
if (JSON.stringify(gotIds) !== JSON.stringify(wantIds))
  throw new Error(`band widening produced ${gotIds} but DESIGN_SPEC.idsInBand needs ${wantIds}`);

// --- replacedRule recomputation (must be exactly shop-167/169) ----------------
const replacedRule = DS.placeholders.replacedRule;
const hits = [];
for (const s of map.shops) {
  if (!DS.placeholders.idsInBand.includes(s.id)) continue;
  const wx = s.point[0] - 53.5, wz = s.point[1] + 17.4;
  const lx = CY * (wx - T[0]) - SY * (wz - T[2]);
  const lz = SY * (wx - T[0]) + CY * (wz - T[2]);
  const m = Math.max(s.width, s.depth) / 2;
  if (Math.abs(lx) < 13.4 + m && -59.8 - m < lz && lz < 7 + m) hits.push(s.id);
}
if (JSON.stringify(hits.sort()) !== JSON.stringify([...DS.placeholders.replacedByTempleAxis].sort()))
  throw new Error(`replacedRule computed ${hits} but DESIGN_SPEC says ${DS.placeholders.replacedByTempleAxis} — stopping per fallback #10 (check T/yaw/localToWorld signs; do not change the rule)`);

// --- assemble blocks.json -----------------------------------------------------
const dataset = JSON.parse(JSON.stringify(base));
dataset.placeholders.push(...added);
for (const ph of dataset.placeholders) {
  if (DS.placeholders.replacedByTempleAxis.includes(ph.id)) {
    if (ph.replacedBy && ph.replacedBy !== 'block-temple-axis')
      throw new Error(`${ph.id} already replaced by ${ph.replacedBy}`);
    ph.replacedBy = 'block-temple-axis';
  }
  // carry the delivered street-completion replacement state (128/129, 130..133)
  const cph = completion.placeholders.find((p) => p.id === ph.id);
  if (cph?.replacedBy && !ph.replacedBy) ph.replacedBy = cph.replacedBy;
}
// verbatim delivered asset blocks
for (const id of ['block-east-edge-shops', 'block-street-completion-shops']) {
  const b = completion.blocks.find((x) => x.id === id);
  if (!b) throw new Error(`${id} missing from the delivered street-completion blocks`);
  if (dataset.blocks.some((x) => x.id === id)) throw new Error(`${id} already present`);
  dataset.blocks.push(JSON.parse(JSON.stringify(b)));
}
// west band placeholder ids (base + the four additions)
const westBlock = dataset.blocks.find((b) => b.id === 'block-adjacent-west');
westBlock.placeholderIds = [...DS.placeholders.idsInBand];
// temple axis assets block
const templeAssets = DS.templePlacement.assets.map((a) => {
  const [wx, wz] = localToWorld(a.localOffset[0], a.localOffset[2]);
  return {
    id: a.id,
    glb: `./world/fangbang-temple/temple-axis/${a.glb}`,
    positionGlb: [+wx.toFixed(6), 0, +wz.toFixed(6)],
    rotationYRad: YAW,
  };
});
dataset.blocks.push({
  id: DS.templePlacement.groupId,
  kind: 'assets',
  replacesBaseIds: [...DS.placeholders.replacedByTempleAxis].sort(),
  autoApply: true,
  assets: templeAssets,
  persistent: false,
  collisionSource: 'world/fangbang-temple/collision-world.json (128 records composed with T+yaw) — no per-asset sidecars, the collision-world is the single wall authority',
});
dataset.generatedBy = 'scripts/build_fangbang_blocks.mjs (derived candidate; frozen world/blocks.json, world/east-edge and world/street-completion untouched; asset blocks copied verbatim)';
dataset.bandWidening = { westFloorGlbX: +WEST_FLOOR.toFixed(3), addedIds: wantIds, rule: 'build_blocks.mjs adjacency with the west floor moved to the west end (seal wall half-width + 2m margin)' };
await writeFile(resolve(OUT, 'blocks.json'), JSON.stringify(dataset, null, 2) + '\n');

// --- map-registry.json ----------------------------------------------------------
const reg = DS.mapRegistration;
const registry = {
  schemaVersion: 1,
  datasetId: 'fangbang-temple',
  batchId: DS.batchId,
  registeredBy: `batch fangbang-temple-bridge-night-20260916`,
  ownerAdopted: false,
  mapSource: { path: reg.mapSource, sha256: sha(mapRaw), readOnly: true },
  anchor: { worldOriginMapSpace: DS.coordinateConvention.worldOriginMapSpace, kind: 'documented approximate anchor (map local metres -> GLB translation only)' },
  poi: { id: reg.poiId, name: reg.poiName, pointMap: reg.poiPointMap, pointGlb: reg.poiPointGlb },
  road: { id: reg.roadId, name: reg.roadName, centerlineGlbWestOfStreet: reg.roadCenterlineGlbWestOfStreet },
  method: reg.method,
  foot: {
    onCenterlineGlb: reg.footOnCenterlineGlb,
    segment: reg.footSegment,
    roadTangentUnit: reg.roadTangentUnit,
    northNormalUnit: reg.northNormalUnit,
    arcLengthFromStreetWestVertexM: reg.arcLengthFromStreetWestVertexM,
  },
  templePlacement: {
    groupId: DS.templePlacement.groupId,
    translationGlb: T,
    yawRad: YAW,
    yawDeg: DS.templePlacement.yawDeg,
    assets: templeAssets.map(({ id, glb, positionGlb, rotationYRad }) => ({ id, glb, positionGlb, rotationYRad })),
    worldFootprintCornersGlb: DS.templePlacement.worldFootprintCornersGlb,
  },
  westEnd: { glb: DS.westExtension.westEndGlb, arcFromFootM: DS.westExtension.westEndArcFromFootM, sealWall: DS.westExtension.sealWall },
  replaced: { rule: replacedRule, ids: [...DS.placeholders.replacedByTempleAxis], blockId: DS.templePlacement.groupId, reversible: 'replacedBy lifecycle; revoke restores the placeholders' },
  knownDeviations: [
    reg.osmTemplePolygonNote,
    'map shop centroids carry per-shop residuals up to ~17m (historicalPositionVerified=false); the west-band placeholders therefore intrude the 8.5m design carriageway at 17 stations (see kit/out/fangbang-temple/west-extension/surface-spec.json placeholderResiduals) — recorded, not moved (frontSetback)',
    'positions are design locator values from the 2019 OSM snapshot, not a 1990s survey (dimensionsAreDesign)',
  ],
};
await writeFile(resolve(OUT, 'map-registry.json'), JSON.stringify(registry, null, 2) + '\n');

console.log(`FANGBANG_BLOCKS_READY placeholders=${dataset.placeholders.length} blocks=${dataset.blocks.map((b) => b.id).join(',')} templeAssets=${templeAssets.length} replaced=${hits.join(',')}`);
console.log(`MAP_REGISTRY_READY mapSha=${registry.mapSource.sha256.slice(0, 12)}...`);
