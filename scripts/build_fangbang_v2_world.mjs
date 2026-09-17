// Assemble the fangbang-temple BRIDGE V2 dataset (world/fangbang-temple-v2/).
// Copy-adapted from scripts/build_fangbang_world.mjs: identical street /
// west-extension / placeholder handling, but the temple block is the expanded
// AXIS V2 (13 GLBs: the frozen 7 + dadian-court-v2 + stage + peidian x2 +
// gallery x2 + court3 + houdian) — same frame composition
// (rotationYRad = 0.16703 + local yaw, positionGlb = localToWorld(offset)).
//
// T/yaw come from the frozen bridge batch (T=(-127.817,0,27.057) yaw=0.16703)
// and are cross-checked against the delivered world/fangbang-temple
// review-manifest so the two bridge datasets can never drift apart.
//
// Run: node scripts/build_fangbang_v2_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASK = resolve(root, '..');
const OUT = resolve(root, 'world/fangbang-temple-v2');
const AXIS_V2 = resolve(root, 'world/temple-axis-v2');
const sha = (b) => createHash('sha256').update(b).digest('hex');

await mkdir(resolve(OUT, 'temple-axis'), { recursive: true });
await mkdir(resolve(OUT, 'west-extension'), { recursive: true });

// --- temple frame: frozen bridge values, verified against the delivered set ---
const T = [-127.817, 0.0, 27.057];
const YAW = 0.16703;
{
  const delivered = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/review-manifest.json'), 'utf8'));
  const t0 = delivered.templeAxis.translationGlb, y0 = delivered.templeAxis.yawRad;
  if (Math.abs(t0[0] - T[0]) > 1e-9 || Math.abs(t0[2] - T[2]) > 1e-9 || Math.abs(y0 - YAW) > 1e-9)
    throw new Error('bridge v2: temple frame drifted from the delivered fangbang-temple dataset');
}
const CY = Math.cos(YAW), SY = Math.sin(YAW);
const localToWorld = (lx, ly, lz) => [T[0] + CY * lx + SY * lz, ly, T[2] - SY * lx + CY * lz];
const HALF_PI = 1.5707963267948966;

// the 13-asset v2 temple block: id, glb, temple-local offset, local yaw
const V2_ASSETS = [
  { id: 'shanmen', glb: 'temple.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'shanmen-ground', glb: 'ground.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'shanmen-lions', glb: 'lions.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'shanmen-ornaments', glb: 'ornaments.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'entrycourt-open', glb: 'court-open.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'yimen', glb: 'yimen.glb', offset: [0, 0, -21], yaw: 0 },
  { id: 'yimenstage', glb: 'yimen-stage.glb', offset: [0, 0, -21], yaw: 0 },
  { id: 'dadiancourt', glb: 'dadian-court-v2.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'peidian-w', glb: 'peidian.glb', offset: [-11.2, 0, -35.8], yaw: HALF_PI },
  { id: 'peidian-e', glb: 'peidian.glb', offset: [11.2, 0, -35.8], yaw: -HALF_PI },
  { id: 'gallery-w', glb: 'gallery.glb', offset: [-10.78, 0, -30.99], yaw: HALF_PI },
  { id: 'gallery-e', glb: 'gallery.glb', offset: [10.78, 0, -30.99], yaw: -HALF_PI },
  { id: 'dadian', glb: 'dadian.glb', offset: [0, 0, -44], yaw: 0 },
  { id: 'court3', glb: 'court3.glb', offset: [0, 0, 0], yaw: 0 },
  { id: 'houdian', glb: 'houdian.glb', offset: [0, 0, -74], yaw: 0 },
];

// --- 1. temple-axis GLBs: byte-exact copies from temple-axis-v2, hash-checked --
const axisManifest = JSON.parse(await readFile(resolve(AXIS_V2, 'review-manifest.json'), 'utf8'));
const templeAssets = [];
for (const a of V2_ASSETS) {
  const src = resolve(AXIS_V2, a.glb);
  const dst = resolve(OUT, 'temple-axis', a.glb);
  await copyFile(src, dst);
  const bytes = await readFile(dst);
  const ref = Object.values(axisManifest.assets).find((x) => x.sha256 === sha(bytes));
  if (!ref) throw new Error(`temple-axis ${a.glb}: sha mismatch against world/temple-axis-v2/review-manifest.json`);
  const [wx, wy, wz] = localToWorld(a.offset[0], a.offset[1], a.offset[2]);
  templeAssets.push({
    id: a.id, glb: `./world/fangbang-temple-v2/temple-axis/${a.glb}`,
    positionGlb: [+wx.toFixed(6), wy, +wz.toFixed(6)],
    rotationYRad: +(YAW + a.yaw).toFixed(8),
    bytes: bytes.byteLength, sha256: sha(bytes), triangles: ref.triangles, module: `temple-axis-${a.id}`,
  });
}

// --- 2. west extension: identical files to the delivered bridge dataset --------
const WK = resolve(root, 'kit/out/fangbang-temple');
for (const [src, dst] of [
  ['west-extension/model.glb', 'west-extension/surface.glb'],
  ['west-extension/seal-wall.glb', 'west-extension/seal-wall.glb'],
  ['west-extension/forecourt-bounds.glb', 'west-extension/forecourt-bounds.glb'],
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
const boundsBytes = await readFile(resolve(OUT, 'west-extension/forecourt-bounds.glb'));
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
  axis: 'GLB Y-up X east Z south; street assembly + refined shop assets + temple axis V2 (T+yaw, 15 instances incl. yawed peidian/gallery) + west extension (authored in place)',
  streetSource: './world/street-completion/instances.json (16 storefronts verbatim)',
  instances: [
    ...streetInstances.instances.map(({ id, module, positionGlb, rotationYRad }) => ({ id, module, positionGlb, rotationYRad, group: 'street' })),
    ...shopAssets.map(({ id, module, positionGlb, rotationYRad }) => ({ id, module, positionGlb, rotationYRad, group: 'street-tail-shops' })),
    ...templeAssets.map(({ id, module, positionGlb, rotationYRad }) => ({ id, module, positionGlb, rotationYRad, group: 'temple-axis-v2' })),
    { id: 'westext-surface', module: 'westext-surface', positionGlb: [0, 0, 0], rotationYRad: 0, group: 'west-extension' },
    { id: 'westext-seal-wall', module: 'westext-seal-wall', positionGlb: [0, 0, 0], rotationYRad: 0, group: 'west-extension' },
    { id: 'temple-bounds', module: 'temple-bounds', positionGlb: [0, 0, 0], rotationYRad: 0, group: 'west-extension' },
  ],
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n');

// --- 4. collision-world.json: 246 temple-axis-v2 records composed with T+yaw ----
const composeTemple = (record) => {
  let { pos, theta, center, size } = record.obb ?? {};
  if (!pos) {
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
  const cxw = px + c * center[0] + s * center[2];
  const czw = pz - s * center[0] + c * center[2];
  const corners = [[size[0] / 2, size[2] / 2], [size[0] / 2, -size[2] / 2], [-size[0] / 2, size[2] / 2], [-size[0] / 2, -size[2] / 2]]
    .map(([lx, lz]) => [c * lx + s * lz, -s * lx + c * lz]);
  const hx = Math.max(...corners.map((p) => Math.abs(p[0])));
  const hz = Math.max(...corners.map((p) => Math.abs(p[1])));
  const origPrefix = record.name.slice(0, record.name.indexOf(':'));
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
const templeCollision = JSON.parse(await readFile(resolve(AXIS_V2, 'collision-world.json'), 'utf8'));
const westWall = JSON.parse(await readFile(resolve(OUT, 'west-extension/collision.json'), 'utf8'));
const composed = templeCollision.colliders.map(composeTemple);

// self-check: re-derive sampled records (incl. yawed peidian/gallery) independently
const sampleIdx = [];
for (const probe of ['peidian-w:peidian-base', 'peidian-e:peidian-base', 'gallery-w:gallery-column',
  'houdian:rear-wall', 'court3:boundary-wall', 'dadiancourt:court2-south-return']) {
  const i = composed.findIndex((c) => c.name === probe);
  if (i >= 0) sampleIdx.push(i);
}
let checkMaxErr = 0;
const check = sampleIdx.map((i) => {
  const rec = composed[i];
  const { pos, theta, center, size } = rec.obb;
  const c = Math.cos(theta), s = Math.sin(theta);
  const cxw = pos[0] + c * center[0] + s * center[2];
  const czw = pos[2] - s * center[0] + c * center[2];
  const cs = [[size[0] / 2, size[2] / 2], [size[0] / 2, -size[2] / 2], [-size[0] / 2, size[2] / 2], [-size[0] / 2, -size[2] / 2]]
    .map(([lx, lz]) => [cxw + c * lx + s * lz, czw - s * lx + c * lz]);
  const err = Math.max(
    Math.abs(Math.min(...cs.map((p) => p[0])) - rec.min[0]), Math.abs(Math.max(...cs.map((p) => p[0])) - rec.max[0]),
    Math.abs(Math.min(...cs.map((p) => p[1])) - rec.min[2]), Math.abs(Math.max(...cs.map((p) => p[1])) - rec.max[2]));
  checkMaxErr = Math.max(checkMaxErr, err);
  return { name: rec.name, maxCornerErr: +err.toExponential(3) };
});
if (checkMaxErr > 1e-6) throw new Error(`temple composition self-check failed: max corner error ${checkMaxErr}`);
if (composed.length !== 246) throw new Error(`expected 246 temple colliders (axis-v2), composed ${composed.length}`);

const world = {
  axis: 'glTF Y-up; world records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'fangbang-temple-v2',
  instances: instances.instances,
  colliders: [
    ...streetCollision.colliders,
    ...westWall.colliders,
    ...composed,
  ],
  composition: {
    rule: 'obb.pos\' = T + R(yaw)·pos; theta\' = theta + yaw; min/max from the 4 rotated corners',
    templeRecords: composed.length,
    source: 'world/temple-axis-v2/collision-world.json (246 records incl. the v2 court and all new modules)',
    selfCheck: { sampled: check, maxCornerError: checkMaxErr },
  },
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n');

// --- 5. route.json: bridge route extended along the V2 temple route -------------
const scRoute = JSON.parse(await readFile(resolve(root, 'world/street-completion/route.json'), 'utf8'));
const axisV2Route = JSON.parse(await readFile(resolve(AXIS_V2, 'route.json'), 'utf8'));
const pts = [];
const push = (x, y, z) => {
  const p = [+x.toFixed(4), y, +z.toFixed(4)];
  const last = pts[pts.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < 1e-6) return;
  pts.push(p);
};
const subdiv = (a, b) => {
  const az = a[a.length - 1], bz = b[b.length - 1];
  const d = Math.hypot(b[0] - a[0], bz - az);
  const n = Math.max(1, Math.ceil(d / 6));
  for (let k = 1; k <= n; k++) push(a[0] + (b[0] - a[0]) * k / n, 0, az + (bz - az) * k / n);
};
const msRev = [...scRoute.mainStreet].reverse();
push(...msRev[0], 0);
for (let i = 1; i < msRev.length; i++) subdiv(msRev[i - 1], msRev[i]);
const bridgeSpec = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));
const foot = bridgeSpec.mapRegistration?.footOnCenterlineGlb
  ?? JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/map-registry.json'), 'utf8')).foot.onCenterlineGlb;
let footIdx = 0;
for (let i = 0; i < westSpec.samples.length; i++) {
  const q = westSpec.samples[i];
  if (Math.hypot(q.x - foot[0], q.z - foot[2]) < 1.0 && q.s > westSpec.checks.footArcM) { footIdx = i; break; }
}
for (let i = 1; i <= footIdx; i += 8) push(westSpec.samples[i].x, 0, westSpec.samples[i].z);
push(foot[0], 0, foot[2]);
const fcC = localToWorld(0, 0, 3.5);
const thres = localToWorld(0, 0, 0);
subdiv([foot[0], foot[2]], [fcC[0], fcC[2]]);
push(fcC[0], 0, fcC[2]);
push(thres[0], 0, thres[2]);
let prev = thres;
for (const pt of axisV2Route.mainStreet) {
  const [lx, , lz] = pt;   // axis-v2 route points are [x, y, z]
  const w = localToWorld(lx, 0, lz);
  subdiv([prev[0], prev[2]], [w[0], w[2]]);
  push(w[0], 0, w[2]);
  prev = w;
}
const maxGap = Math.max(...pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2])));
if (maxGap > 6 + 1e-3) throw new Error(`route gap ${maxGap.toFixed(2)}m exceeds 6m`);

const westEnd = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/route.json'), 'utf8')).entries.westEndGlb;
const bridgeNegatives = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/route.json'), 'utf8')).negatives;
const route = {
  axis: 'GLB Y-up X east Z south; heights 0 (ground walking; temple stair handled by the axis samples)',
  dataset: 'fangbang-temple-v2',
  mainStreet: pts,
  totalLengthM: +pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2]), 0).toFixed(1),
  maxAdjacentGapM: +maxGap.toFixed(2),
  entries: {
    eastTailEnd: scRoute.entries.sctailEnd,
    west: scRoute.entries.west,
    bridgeStart: scRoute.entries.sctailEnd,
    shanmenThreshold: thres.map((v) => +v.toFixed(4)),
    houdianDoors: pts[pts.length - 1],
    westEndGlb: westEnd,
  },
  negatives: bridgeNegatives,
  fallCheck: axisV2Route.fallCheck,
  manualWalkClaim: false,
  negativesNote: 'the four bridge negatives are carried verbatim from the delivered fangbang-temple route.json (same T/yaw, shared street/forecourt part unchanged); the seven temple-level negatives live in world/temple-axis-v2/route.json and are exercised by tests/temple_axis_v2_passage.test.mjs',
  stair: {
    footLocal: [0, -39.9],
    doorsLocalZ: -71.8,
    terminusLocalZ: -71.8,
    terminusToleranceM: 0.4,
    note: 'the v2 forward cruise continues past the dadian platform, through the east passage and court3; the terminus is the houdian base front (temple-local z -71.8 +/- 0.4; the closed doors sit at -74.4)',
  },
};
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n');

// --- 6. cameras.json: the delivered bridge cameras verbatim ---------------------
const cameras = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/cameras.json'), 'utf8'));
cameras.generatedBy = 'delivered bridge cameras copied verbatim (temple-axis unchanged at the street scale); see temple-axis-v2/cameras.json for the 10 expansion cameras';
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n');

// --- 7. review-manifest.json ----------------------------------------------------
const baseManifest = JSON.parse(await readFile(resolve(root, 'world/review-manifest.json'), 'utf8'));
const scManifest = JSON.parse(await readFile(resolve(root, 'world/street-completion/review-manifest.json'), 'utf8'));
const eeManifest = JSON.parse(await readFile(resolve(root, 'world/east-edge/review-manifest.json'), 'utf8'));
const moduleIds = new Set(baseManifest.modules.map((m) => m.id));
const modules = [...baseManifest.modules];
for (const inst of instances.instances) {
  if (moduleIds.has(inst.module)) continue;
  const ta = templeAssets.find((a) => a.module === inst.module);
  if (ta) { modules.push({ id: inst.module, path: ta.glb, bytes: ta.bytes, sha256: ta.sha256, triangles: ta.triangles }); continue; }
  if (inst.module === 'westext-surface') { modules.push({ id: inst.module, path: './world/fangbang-temple-v2/west-extension/surface.glb', bytes: surfaceBytes.byteLength, sha256: sha(surfaceBytes), triangles: surfaceMeasure.triangles }); continue; }
  if (inst.module === 'westext-seal-wall') { modules.push({ id: inst.module, path: './world/fangbang-temple-v2/west-extension/seal-wall.glb', bytes: wallBytes.byteLength, sha256: sha(wallBytes), triangles: wallMeasure.triangles }); continue; }
  if (inst.module === 'temple-bounds') { modules.push({ id: inst.module, path: './world/fangbang-temple-v2/west-extension/forecourt-bounds.glb', bytes: boundsBytes.byteLength, sha256: sha(boundsBytes), triangles: 24 }); continue; }
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
  datasetId: 'fangbang-temple-v2',
  title: '方浜中路主街 ↔ 庙宇轴线 v2 桥接世界（山门—城隍殿 + 戏楼/配殿/廊庑 + 西延伸 + 占位街区）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  reference: { dimensionDisclaimer: 'all new temple modules are design inference per the expansion DESIGN_SPEC', historicalAccuracyVerified: false, dimensionsAreDesign: true },
  axis: instances.axis,
  modules,
  worldAssembly: baseManifest.worldAssembly,
  placedTriangles: baseManifest.placedTriangles,
  sceneImages: baseManifest.sceneImages,
  triangleAccounting: {
    bridgeWorldTris,
    fullSceneTris,
    budget: { bridgeScopeLimit: 360000, fullSceneLimit: 400000, scope: 'both accounting modes reported per the expansion DESIGN_SPEC.budgets.bridgeV2PlacedTrisMax' },
    breakdown: { streetAssembly: baseManifest.placedTriangles, templeAxisV2: templeTris, westExtension: surfaceMeasure.triangles + wallMeasure.triangles, tailShops: shopTris, eastTailSurface: scManifest.streetCompletion.surface.triangles },
  },
  templeAxis: {
    source: 'world/temple-axis-v2 (byte-exact copies, sha-verified)',
    translationGlb: T, yawRad: YAW,
    assets: templeAssets,
    placedTriangles: templeTris,
    collision: '246 records composed into collision-world.json (self-check sampled ' + check.length + ', maxCornerError ' + checkMaxErr.toExponential(3) + ')',
  },
  westExtension: {
    surface: { path: './world/fangbang-temple-v2/west-extension/surface.glb', bytes: surfaceBytes.byteLength, sha256: sha(surfaceBytes), triangles: surfaceMeasure.triangles, groundNodeNames: ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'] },
    sealWall: { path: './world/fangbang-temple-v2/west-extension/seal-wall.glb', bytes: wallBytes.byteLength, sha256: sha(wallBytes), triangles: wallMeasure.triangles },
    forecourtBounds: { path: './world/fangbang-temple-v2/west-extension/forecourt-bounds.glb', bytes: boundsBytes.byteLength, sha256: sha(boundsBytes), triangles: 24 },
    centerlineSpec: 'kit/out/fangbang-temple/west-extension-spec.json',
  },
  streetCompletion: {
    surface: {
      path: './world/fangbang-temple-v2/west-extension/surface.glb',
      bytes: surfaceBytes.byteLength, sha256: sha(surfaceBytes), triangles: surfaceMeasure.triangles,
      groundNodeNames: ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'],
      noCitywideSlab: true,
    },
    eastTailSurface: scManifest.streetCompletion.surface,
    assets: scManifest.streetCompletion.assets,
  },
  eastEdgeAssets: eeManifest.eastEdgeAssets,
  mapRegistration: JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/map-registry.json'), 'utf8')),
  route: { points: pts.length, totalLengthM: route.totalLengthM, manualWalkClaim: false, negatives: route.negatives.map((n) => n.id) },
  cameras: { count: cameras.cameras.length, source: 'delivered bridge cameras verbatim', contract: 'positionGlb/targetGlb/verticalFovDegrees applied verbatim' },
  budgets: {
    bridgeScopeTris: { actual: bridgeWorldTris, limit: 360000, pass: bridgeWorldTris <= 360000 },
    fullSceneTris: { actual: fullSceneTris, limit: 400000, pass: fullSceneTris <= 400000 },
    newTextures: 0,
  },
  generatedBy: 'scripts/build_fangbang_v2_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// --- 8. blocks.json: verbatim except the temple block, which becomes the
// V2 asset list (15 GLBs in this dataset) and the v2 collision source
{
  const base = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/blocks.json'), 'utf8'));
  const tb = base.blocks.find((x) => x.id === 'block-temple-axis');
  tb.assets = templeAssets.map((a) => ({
    id: a.id, glb: a.glb, positionGlb: a.positionGlb, rotationYRad: a.rotationYRad,
  }));
  tb.collisionSource = './world/fangbang-temple-v2/collision-world.json';
  tb.note = 'temple-axis V2 (expansion batch 20260917): dadian-court-v2 + stage + peidian x2 + gallery x2 + court3 + houdian replace the v1 temple block; everything else verbatim';
  await writeFile(resolve(OUT, 'blocks.json'), JSON.stringify(base, null, 2) + '\n');
}

console.log(`FANGBANG_V2_READY instances=${instances.instances.length} colliders=${world.colliders.length} `
  + `(street ${streetCollision.colliders.length} + walls ${westWall.colliders.length} + temple ${composed.length})`);
console.log(`route ${pts.length} pts ${route.totalLengthM}m maxGap ${route.maxAdjacentGapM}m; `
  + `bridgeWorldTris=${bridgeWorldTris}/360000 fullSceneTris=${fullSceneTris}/400000`);
