// N4: assemble the fangbang-temple bridge world dataset (world/fangbang-temple/).
// Merges the two delivered datasets into one walkable world:
//   street assembly (world/street-reviewed.glb, referenced, never copied)
//   + street-completion tail surface (referenced)
//   + east-edge / street-completion refined shops (referenced via blocks)
//   + west-extension surface + seal wall (this batch, copied from kit out)
//   + temple axis 8 GLBs (byte-exact frozen copies, sha-checked)
// Collision: base street walls + west-extension seal wall + the 128 temple
// records composed with T+yaw per DESIGN_SPEC.colliderComposition.
// Route: east tail end -> main street west -> west extension -> foot ->
//        forecourt -> threshold -> temple axis -> dadian closed doors.
//
// Run: node scripts/build_fangbang_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASK = resolve(root, '..');
const OUT = resolve(root, 'world/fangbang-temple');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const DS = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));

await mkdir(resolve(OUT, 'temple-axis'), { recursive: true });
await mkdir(resolve(OUT, 'west-extension'), { recursive: true });

// --- temple frame ---------------------------------------------------------------
const T = DS.templePlacement.translationGlb;
const YAW = DS.templePlacement.yawRad;
const CY = Math.cos(YAW), SY = Math.sin(YAW);
const localToWorld = (lx, ly, lz) => [T[0] + CY * lx + SY * lz, ly, T[2] - SY * lx + CY * lz];

// --- 1. temple-axis GLBs: byte-exact copies, hash-checked ----------------------
const dadianManifest = JSON.parse(await readFile(resolve(root, 'world/temple-dadian/review-manifest.json'), 'utf8'));
const templeAssets = [];
for (const a of DS.templePlacement.assets) {
  const src = resolve(root, 'world/temple-dadian', a.glb);
  const dst = resolve(OUT, 'temple-axis', a.glb);
  await copyFile(src, dst);
  const bytes = await readFile(dst);
  const ref = Object.values(dadianManifest.assets).find((x) => x.sha256 === sha(bytes));
  if (!ref) throw new Error(`temple-axis ${a.glb}: sha mismatch against world/temple-dadian/review-manifest.json`);
  const [wx, wy, wz] = localToWorld(a.localOffset[0], a.localOffset[1], a.localOffset[2]);
  templeAssets.push({
    id: a.id, glb: `./world/fangbang-temple/temple-axis/${a.glb}`,
    positionGlb: [+wx.toFixed(6), wy, +wz.toFixed(6)], rotationYRad: YAW,
    bytes: bytes.byteLength, sha256: sha(bytes), triangles: ref.triangles, module: `temple-axis-${a.id}`,
  });
}

// --- 2. west extension: surface + seal wall + collision sidecar -----------------
const WK = resolve(root, 'kit/out/fangbang-temple');
for (const [src, dst] of [
  ['west-extension/model.glb', 'west-extension/surface.glb'],
  ['west-extension/seal-wall.glb', 'west-extension/seal-wall.glb'],
  ['west-extension/collision.json', 'west-extension/collision.json'],
  ['west-extension/surface-spec.json', 'west-extension/surface-spec.json'],
  ['west-extension/measurements.json', 'west-extension/measurements.json'],
]) {
  await copyFile(resolve(WK, src), resolve(OUT, dst));
}
const surfaceBytes = await readFile(resolve(OUT, 'west-extension/surface.glb'));
const surfaceMeasure = JSON.parse(await readFile(resolve(WK, 'west-extension/measurements.json'), 'utf8'));
const wallMeasure = JSON.parse(await readFile(resolve(WK, 'west-seal/measurements.json'), 'utf8'));
const wallBytes = await readFile(resolve(OUT, 'west-extension/seal-wall.glb'));
const westSpec = JSON.parse(await readFile(resolve(WK, 'west-extension-spec.json'), 'utf8'));

// --- 3. instances.json ----------------------------------------------------------
const streetInstances = JSON.parse(await readFile(resolve(root, 'world/street-completion/instances.json'), 'utf8'));
const completionBlocks = JSON.parse(await readFile(resolve(root, 'world/street-completion/blocks.json'), 'utf8'));
const shopAssets = [];
for (const id of ['block-east-edge-shops', 'block-street-completion-shops']) {
  const b = completionBlocks.blocks.find((x) => x.id === id);
  for (const a of b.assets) {
    shopAssets.push({
      id: a.id, module: a.id, positionGlb: a.positionGlb, rotationYRad: a.rotationYRad,
      glb: a.glb, source: `verbatim from ${id}`,
    });
  }
}
const instances = {
  axis: 'GLB Y-up X east Z south; street assembly + refined shop assets + temple axis (T+yaw) + west extension (authored in place)',
  streetSource: './world/street-completion/instances.json (16 storefronts verbatim)',
  instances: [
    ...streetInstances.instances.map(({ id, module, positionGlb, rotationYRad }) => ({ id, module, positionGlb, rotationYRad, group: 'street' })),
    ...shopAssets.map(({ id, module, positionGlb, rotationYRad }) => ({ id, module, positionGlb, rotationYRad, group: 'street-tail-shops' })),
    ...templeAssets.map(({ id, module, positionGlb, rotationYRad }) => ({ id, module, positionGlb, rotationYRad, group: 'temple-axis' })),
    { id: 'westext-surface', module: 'westext-surface', positionGlb: [0, 0, 0], rotationYRad: 0, group: 'west-extension', note: 'authored in world coordinates' },
    { id: 'westext-seal-wall', module: 'westext-seal-wall', positionGlb: [0, 0, 0], rotationYRad: 0, group: 'west-extension', note: 'authored in world coordinates' },
  ],
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n');

// --- 4. collision-world.json ------------------------------------------------------
// temple composition per DESIGN_SPEC.colliderComposition: obb.pos' = T + R·pos,
// theta' = theta + yaw, center/size unchanged, min/max from the 4 rotated corners.
const composeTemple = (record) => {
  let { pos, theta, center, size } = record.obb ?? {};
  if (!pos) {
    // min/max-only record: convert to obb{pos:[0,0,0],theta:0} first
    const [x0, y0, z0] = record.min, [x1, y1, z1] = record.max;
    pos = [0, 0, 0]; theta = 0;
    center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    size = [x1 - x0, y1 - y0, z1 - z0];
  }
  const px = T[0] + CY * pos[0] + SY * pos[2];
  const pz = T[2] - SY * pos[0] + CY * pos[2];
  const py = (pos[1] ?? 0) + T[1];
  const th = theta + YAW;
  const c = Math.cos(th), s = Math.sin(th);
  // world center of the box: pos' + R(theta')·center (obbToWorld definition)
  const cxw = px + c * center[0] + s * center[2];
  const czw = pz - s * center[0] + c * center[2];
  const corners = [[size[0] / 2, size[2] / 2], [size[0] / 2, -size[2] / 2], [-size[0] / 2, size[2] / 2], [-size[0] / 2, -size[2] / 2]]
    .map(([lx, lz]) => [c * lx + s * lz, -s * lx + c * lz]);
  const hx = Math.max(...corners.map((p) => Math.abs(p[0])));
  const hz = Math.max(...corners.map((p) => Math.abs(p[1])));
  // name prefix must reference an instance id (validateWorldInputs); the
  // delivered court records are re-prefixed to the entrycourt-open instance
  const origPrefix = record.name.split(':')[0];
  const instId = origPrefix === 'court' ? 'entrycourt-open' : origPrefix;
  const name = `${instId}:${record.name.slice(record.name.indexOf(':') + 1)}`;
  const cyw = py + center[1];
  return {
    name, group: `${instId}:${(record.group ?? record.name).split(':').slice(1).join(':')}`, type: 'box',
    min: [+(cxw - hx).toFixed(6), +(cyw - size[1] / 2).toFixed(6), +(czw - hz).toFixed(6)],
    max: [+(cxw + hx).toFixed(6), +(cyw + size[1] / 2).toFixed(6), +(czw + hz).toFixed(6)],
    obb: { pos: [+px.toFixed(6), py, +pz.toFixed(6)], theta: +th.toFixed(8), center, size },
  };
};

const streetCollision = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
const templeCollision = JSON.parse(await readFile(resolve(root, 'world/temple-dadian/collision-world.json'), 'utf8'));
const westWall = JSON.parse(await readFile(resolve(OUT, 'west-extension/collision.json'), 'utf8'));
const composed = templeCollision.colliders.map(composeTemple);

// self-check (PLAN N4): re-derive 5 records (incl. one slanted shanmen wing wall
// and one min/max-type) from their obb independently; corners must reproduce
// min/max within 1e-6
const slantIdx = templeCollision.colliders.findIndex((c) => Math.abs((c.obb?.theta ?? 0)) > 0.1);
const pick = [...new Set([0, slantIdx, 46, 100, templeCollision.colliders.length - 1])].filter((i) => i >= 0);
let checkMaxErr = 0;
const check = pick.map((i) => {
  const rec = composed[i];
  const { pos, theta, center, size } = rec.obb;
  const c = Math.cos(theta), s = Math.sin(theta);
  // independent re-derivation: world center = pos + R(theta)·center, then the
  // four size/2 corners about that center reproduce the recorded AABB
  const cxw = pos[0] + c * center[0] + s * center[2];
  const czw = pos[2] - s * center[0] + c * center[2];
  const cs = [[size[0] / 2, size[2] / 2], [size[0] / 2, -size[2] / 2], [-size[0] / 2, size[2] / 2], [-size[0] / 2, -size[2] / 2]]
    .map(([lx, lz]) => [cxw + c * lx + s * lz, czw - s * lx + c * lz]);
  const minX = Math.min(...cs.map((p) => p[0])), maxX = Math.max(...cs.map((p) => p[0]));
  const minZ = Math.min(...cs.map((p) => p[1])), maxZ = Math.max(...cs.map((p) => p[1]));
  const err = Math.max(
    Math.abs(minX - rec.min[0]), Math.abs(maxX - rec.max[0]),
    Math.abs(minZ - rec.min[2]), Math.abs(maxZ - rec.max[2]));
  checkMaxErr = Math.max(checkMaxErr, err);
  return { name: rec.name, maxCornerErr: +err.toExponential(3) };
});
if (checkMaxErr > 1e-6) throw new Error(`temple composition self-check failed: max corner error ${checkMaxErr}`);
if (composed.length !== 128) throw new Error(`expected 128 temple colliders, composed ${composed.length}`);

const world = {
  axis: 'glTF Y-up; world records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'fangbang-temple',
  instances: instances.instances,
  colliders: [
    ...streetCollision.colliders,                       // 208 frozen street walls (verbatim)
    ...westWall.colliders,                              // 1 seal wall (world-space obb + AABB)
    ...composed,                                        // 128 temple records composed with T+yaw
  ],
  composition: {
    rule: DS.coordinateConvention.colliderComposition,
    templeRecords: composed.length,
    selfCheck: { sampled: check, maxCornerError: checkMaxErr },
    note: 'east-edge/street-completion shop walls live in their per-asset sidecars (blocks.json, verbatim delivered contracts) and are NOT duplicated here',
  },
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n');

// --- 5. route.json -----------------------------------------------------------------
const scRoute = JSON.parse(await readFile(resolve(root, 'world/street-completion/route.json'), 'utf8'));
const pts = [];
const push = (x, y, z) => {
  const p = [+x.toFixed(4), y, +z.toFixed(4)];
  const last = pts[pts.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < 1e-6) return;
  pts.push(p);
};
const subdiv = (a, b) => {   // linear subdivide so adjacent points stay <=6m (args: [x,z] or [x,y,z])
  const az = a[a.length - 1], bz = b[b.length - 1];
  const d = Math.hypot(b[0] - a[0], bz - az);
  const n = Math.max(1, Math.ceil(d / 6));
  for (let k = 1; k <= n; k++) push(a[0] + (b[0] - a[0]) * k / n, 0, az + (bz - az) * k / n);
};
// (1) main street reversed: east tail end -> west entry
const msRev = [...scRoute.mainStreet].reverse();
push(...msRev[0], 0);
for (let i = 1; i < msRev.length; i++) subdiv(msRev[i - 1], msRev[i]);
// (2) west extension centerline every 4m up to the foot
const foot = DS.mapRegistration.footOnCenterlineGlb;
let footIdx = 0;
for (let i = 0; i < westSpec.samples.length; i++) {
  const q = westSpec.samples[i];
  if (Math.hypot(q.x - foot[0], q.z - foot[2]) < 1.0 && q.s > westSpec.checks.footArcM) { footIdx = i; break; }
}
for (let i = 1; i <= footIdx; i += 8) push(westSpec.samples[i].x, 0, westSpec.samples[i].z);
push(foot[0], 0, foot[2]);
// (3) foot -> forecourt center local(0,3.5) -> threshold local(0,0)
const fcC = localToWorld(0, 0, 3.5);
const thres = localToWorld(0, 0, 0);
subdiv([foot[0], foot[2]], [fcC[0], fcC[2]]);
push(fcC[0], 0, fcC[2]);
push(thres[0], 0, thres[2]);
// (4) temple route points localToWorld (burner detour + stair), subdivided
const templeRoute = JSON.parse(await readFile(resolve(root, 'world/temple-dadian/route.json'), 'utf8'));
let prev = thres;
for (const [lx, lz] of templeRoute.mainStreet) {
  const w = localToWorld(lx, 0, lz);
  subdiv([prev[0], prev[2]], [w[0], w[2]]);
  push(w[0], 0, w[2]);
  prev = w;
}
const maxGap = Math.max(...pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2])));
if (maxGap > 6) throw new Error(`route gap ${maxGap.toFixed(2)}m exceeds 6m`);

const westEnd = DS.westExtension.westEndGlb;
const route = {
  axis: 'GLB Y-up X east Z south; heights 0 (ground walking; temple stair handled by the dadian segment samples)',
  dataset: 'fangbang-temple',
  segments: DS.route.segments,
  mainStreet: pts,
  totalLengthM: +pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2]), 0).toFixed(1),
  maxAdjacentGapM: +maxGap.toFixed(2),
  entries: {
    eastTailEnd: scRoute.entries.sctailEnd,
    west: scRoute.entries.west,
    bridgeStart: scRoute.entries.sctailEnd,
    shanmenThreshold: thres.map((v) => +v.toFixed(4)),
    dadianDoors: pts[pts.length - 1],
    westEndGlb: westEnd,
  },
  negatives: [
    { id: 'seal-wall', spawn: [+(westEnd[0] + 3).toFixed(3), 0, +westEnd[2].toFixed(3)], dir: [-1, 0, 0], walk: 'west', assertKind: 'staysEastOfX', barrierX: westEnd[0], assert: 'stopped by the seal wall; x never crosses the wall plane at westEndGlb' },
    { id: 'shop-165-placeholder', spawn: null, spawnNote: 'road centreline point nearest shop-165', dir: [0, 0, -1], walk: 'north toward the shop-165 placeholder box', assertKind: 'stopsAtObb', targetShop: 'shop-165', maxObbGapM: 1.0, assert: 'stopped by the placeholder collider (capsule may slide along the face but never enters the box)' },
    { id: 'forecourt-east', spawnLocal: [6, 0, 3], dir: [1, 0, 0], walk: 'east', assertKind: 'openEdgeOrBlocked', maxAdvancedM: 2.0, assert: 'either stopped before leaving the forecourt, or — the actual outcome with shop-167/169 suppressed by the temple axis — walks off the open east edge and falls (no synthetic slab east of the temple)', knownDeviation: 'the DESIGN_SPEC assumed a blocker east of the forecourt (placeholder); with the temple axis applied that placeholder is suppressed and the boundary is open — recorded in registry knownDeviations' },
    { id: 'dadian-doors', spawnLocal: [0, 0, -42.5], dir: [0, 0, -1], walk: 'north', assertKind: 'localZNorthOf', localZLimit: -44.0, assert: 'stopped by the dadian closed doors: final temple-local z stays north of -44.0 (same assertion as temple_dadian_passage, in world coordinates)' },
  ],
  fallCheck: DS.route.fallCheck,
  manualWalkClaim: false,
};
// fill the shop-165 spawn from the spec samples + resolve spawnLocal entries
{
  let best = null;
  for (const q of westSpec.samples) {
    const d = Math.hypot(q.x + 106.92, q.z - 26.92);
    if (!best || d < best.d) best = { d, q };
  }
  const neg = route.negatives.find((n) => n.id === 'shop-165-placeholder');
  neg.spawn = [+best.q.x.toFixed(3), 0, +best.q.z.toFixed(3)];
  delete neg.spawnNote;
  for (const n of route.negatives) {
    if (n.spawnLocal) {
      const w = localToWorld(n.spawnLocal[0], n.spawnLocal[1], n.spawnLocal[2]);
      n.spawn = [+w[0].toFixed(3), 0, +w[2].toFixed(3)];
    }
  }
}
// honest stair terminus: the capsule cannot climb the 0.17m platform risers
// (proven by temple_dadian_passage: blocked safely at the first riser), so
// the forward cruise's honest end is the stair foot, not the doors
route.stair = {
  footLocal: [0, -39.9],
  footGlb: (() => { const w = localToWorld(0, 0, -39.9); return [+w[0].toFixed(3), 0, +w[2].toFixed(3)]; })(),
  doorsLocalZ: -43.2,
  note: 'forward cruise terminates at the stair foot (capsule vs 0.17m risers — temple_dadian_passage evidence: blocked safely); the doors stay covered by the dadian-doors negative, which spawns ON the platform',
};
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n');

// --- 6. cameras.json (lead contract, verbatim) --------------------------------------
const cameras = JSON.parse(await readFile(resolve(TASK, 'CAMERAS.json'), 'utf8'));
cameras.generatedBy = 'lead CAMERAS.json copied verbatim (batch fangbang-temple-bridge-night-20260916)';
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n');

// --- 7. review-manifest.json ---------------------------------------------------------
const baseManifest = JSON.parse(await readFile(resolve(root, 'world/review-manifest.json'), 'utf8'));
const scManifest = JSON.parse(await readFile(resolve(root, 'world/street-completion/review-manifest.json'), 'utf8'));
const eeManifest = JSON.parse(await readFile(resolve(root, 'world/east-edge/review-manifest.json'), 'utf8'));
const baseInstances = JSON.parse(await readFile(resolve(root, 'world/street-completion/instances.json'), 'utf8'));
const moduleIds = new Set(baseManifest.modules.map((m) => m.id));
const modules = [...baseManifest.modules];
for (const inst of instances.instances) {
  if (moduleIds.has(inst.module)) continue;
  const ta = templeAssets.find((a) => a.module === inst.module);
  if (ta) { modules.push({ id: inst.module, path: ta.glb, bytes: ta.bytes, sha256: ta.sha256, triangles: ta.triangles }); continue; }
  if (inst.module === 'westext-surface') { modules.push({ id: inst.module, path: './world/fangbang-temple/west-extension/surface.glb', bytes: surfaceBytes.byteLength, sha256: sha(surfaceBytes), triangles: surfaceMeasure.triangles }); continue; }
  if (inst.module === 'westext-seal-wall') { modules.push({ id: inst.module, path: './world/fangbang-temple/west-extension/seal-wall.glb', bytes: wallBytes.byteLength, sha256: sha(wallBytes), triangles: wallMeasure.triangles }); continue; }
  const sa = shopAssets.find((a) => a.module === inst.module);
  if (sa) {
    const ref = [...(scManifest.streetCompletion?.assets ?? []), ...(eeManifest.eastEdgeAssets?.assets ?? [])].find((x) => x.id === inst.module);
    modules.push({ id: inst.module, path: sa.glb, bytes: ref.bytes, sha256: ref.sha256, triangles: ref.triangles });
    continue;
  }
  throw new Error(`instance module ${inst.module} has no manifest entry`);
}

const templeTris = templeAssets.reduce((s, a) => s + a.triangles, 0);
const shopTris = shopAssets.reduce((s, a) => {
  const ref = [...(scManifest.streetCompletion?.assets ?? []), ...(eeManifest.eastEdgeAssets?.assets ?? [])].find((x) => x.id === a.id);
  return s + ref.triangles;
}, 0);
const bridgeWorldTris = baseManifest.placedTriangles + templeTris + surfaceMeasure.triangles + wallMeasure.triangles;
const fullSceneTris = bridgeWorldTris + shopTris + scManifest.streetCompletion.surface.triangles;

const manifest = {
  datasetId: 'fangbang-temple',
  title: '方浜中路主街 ↔ 庙宇轴线桥接世界（山门—大殿 + 西延伸 + 占位街区 + 总图登记）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  reference: { dimensionDisclaimer: DS.dimensionDisclaimer, historicalAccuracyVerified: false, dimensionsAreDesign: true },
  axis: instances.axis,
  modules,
  worldAssembly: baseManifest.worldAssembly,
  placedTriangles: baseManifest.placedTriangles,
  sceneImages: baseManifest.sceneImages,
  triangleAccounting: {
    bridgeWorldTris,                    // assembly + temple + west extension (DESIGN_SPEC budget scope, lead's ~28万)
    fullSceneTris,                      // everything the page loads with default autoApply blocks
    budget: { limit: DS.budgets.combinedPlacedTrianglesMax, scope: 'bridgeWorldTris (street assembly + temple axis + west extension), matching the ~28万 estimate in STATUS-REVIEW-20260916 §3 V09' },
    breakdown: { streetAssembly: baseManifest.placedTriangles, templeAxis: templeTris, westExtension: surfaceMeasure.triangles + wallMeasure.triangles, tailShops: shopTris, eastTailSurface: scManifest.streetCompletion.surface.triangles },
    note: 'loading the delivered tail-shop blocks adds 42,896 tris beyond the bridge budget scope; both numbers are stated so the lead can re-scope the budget if intended otherwise',
  },
  templeAxis: {
    source: 'world/temple-dadian (byte-exact copies, sha-verified)',
    translationGlb: T, yawRad: YAW,
    assets: templeAssets,
    placedTriangles: templeTris,
    collision: '128 records composed into collision-world.json (self-check sampled ' + check.length + ', maxCornerError ' + checkMaxErr.toExponential(3) + ')',
  },
  westExtension: {
    surface: { path: './world/fangbang-temple/west-extension/surface.glb', bytes: surfaceBytes.byteLength, sha256: sha(surfaceBytes), triangles: surfaceMeasure.triangles, groundNodeNames: ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'], spec: './world/fangbang-temple/west-extension/surface-spec.json' },
    sealWall: { path: './world/fangbang-temple/west-extension/seal-wall.glb', bytes: wallBytes.byteLength, sha256: sha(wallBytes), triangles: wallMeasure.triangles },
    checks: { note: 'corridor / forecourt-joint / placeholder-residual reports live in west-extension/surface-spec.json (written by the Blender builder)' },
    centerlineSpec: 'kit/out/fangbang-temple/west-extension-spec.json',
  },
  streetCompletion: {
    // `surface` is the WorldLoader extension point: this dataset's own
    // walkable west-extension pavement loads with the byte check there.
    surface: {
      path: './world/fangbang-temple/west-extension/surface.glb',
      bytes: surfaceBytes.byteLength, sha256: sha(surfaceBytes), triangles: surfaceMeasure.triangles,
      groundNodeNames: ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'],
      noCitywideSlab: true,
    },
    eastTailSurface: scManifest.streetCompletion.surface,   // the page loads this surface for the east tail
    assets: scManifest.streetCompletion.assets,
  },
  eastEdgeAssets: eeManifest.eastEdgeAssets,
  mapRegistration: JSON.parse(await readFile(resolve(OUT, 'map-registry.json'), 'utf8')),
  route: { points: pts.length, totalLengthM: route.totalLengthM, manualWalkClaim: false, negatives: route.negatives.map((n) => n.id) },
  cameras: { count: cameras.cameras.length, source: 'lead CAMERAS.json verbatim', contract: 'positionGlb/targetGlb/verticalFovDegrees applied verbatim' },
  budgets: {
    combinedPlacedTriangles: { actual: bridgeWorldTris, limit: DS.budgets.combinedPlacedTrianglesMax, pass: bridgeWorldTris <= DS.budgets.combinedPlacedTrianglesMax, scope: 'bridgeWorldTris' },
    westExtensionTris: { actual: surfaceMeasure.triangles + wallMeasure.triangles, limit: DS.budgets.westExtensionTrisMax, pass: surfaceMeasure.triangles + wallMeasure.triangles <= DS.budgets.westExtensionTrisMax },
    newTextures: 0,
  },
  generatedBy: 'scripts/build_fangbang_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`FANGBANG_WORLD_READY instances=${instances.instances.length} colliders=${world.colliders.length} (street 208 + wall 1 + temple ${composed.length})`);
console.log(`route ${pts.length} pts ${route.totalLengthM}m maxGap ${route.maxAdjacentGapM}m; bridgeWorldTris=${bridgeWorldTris}/300000 fullSceneTris=${fullSceneTris}`);
