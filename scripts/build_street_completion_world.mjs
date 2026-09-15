// Street-completion candidate world: the six-building continuous street tail.
//
// Extends the east-edge replacement contract to shop-130..133 while keeping
// the delivered shop-128/129 block byte-compatible: the frozen world/blocks.json
// is read, the east-edge assets block is copied verbatim from the delivered
// world/east-edge dataset, and a NEW assets block replaces 130..133. Nothing is
// merged into street-reviewed.glb; each standalone GLB carries its own embedded
// textures and the manifest records honest download bytes.
//
// Run: node scripts/build_street_completion_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/street-completion');
const SPEC = '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/street-completion-night-plan-20260915/NEXT_FOUR_DESIGN.json';
const EAST_EDGE_BLOCKS = resolve(root, 'world/east-edge/blocks.json');
const EAST_EDGE_CAMERAS = resolve(root, 'world/east-edge/cameras.json');
const EAST_BLOCK_ID = 'block-east-edge-shops';
const BLOCK_ID = 'block-street-completion-shops';

const sha = (u8) => createHash('sha256').update(u8).digest('hex');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const H = (v) => v.map((x) => +x.toFixed(4));

await mkdir(OUT, { recursive: true });

const spec = await readJson(SPEC);
const buildings = spec.buildings;
if (buildings.length !== 4) throw new Error(`expected 4 buildings in NEXT_FOUR_DESIGN, got ${buildings.length}`);
const replaces = buildings.flatMap((b) => b.replacesBaseIds).sort();
if (JSON.stringify(replaces) !== JSON.stringify(['shop-130', 'shop-131', 'shop-132', 'shop-133']))
  throw new Error(`unexpected replacesBaseIds ${replaces}`);

// ---- per-asset files: GLB + world-space collision sidecar ----------------
const assets = [];
for (const b of buildings) {
  const src = resolve(root, `kit/out/${b.id}`);
  const dst = resolve(OUT, b.id);
  await mkdir(dst, { recursive: true });
  const glbBytes = await readFile(resolve(src, 'model.glb'));
  const local = await readJson(resolve(src, 'collision.json'));
  const measurements = await readJson(resolve(src, 'measurements.json'));
  await copyFile(resolve(src, 'model.glb'), resolve(dst, 'model.glb'));
  await copyFile(resolve(src, 'collision.json'), resolve(dst, 'collision-local.json'));

  const [ox, oy, oz] = b.positionGlb;
  const theta = b.yawRad;
  const c = Math.cos(theta), s = Math.sin(theta);
  const colliders = local.colliders.map((col) => {
    if (col.type !== 'box') throw new Error(`asset ${b.id}: unsupported collider type ${col.type}`);
    const [cx, cy, cz] = col.center;
    const [sx, sy, sz] = col.size;
    const wx = ox + c * cx + s * cz;
    const wz = oz - s * cx + c * cz;
    const corners = [[sx / 2, sz / 2], [sx / 2, -sz / 2], [-sx / 2, sz / 2], [-sx / 2, -sz / 2]]
      .map(([lx, lz]) => [c * lx + s * lz, -s * lx + c * lz]);
    const hx = Math.max(...corners.map((p) => Math.abs(p[0])));
    const hz = Math.max(...corners.map((p) => Math.abs(p[1])));
    return {
      name: `${b.id}:${col.name}`, module: b.id, type: 'box',
      min: [+(wx - hx).toFixed(4), +(oy + cy - sy / 2).toFixed(4), +(wz - hz).toFixed(4)],
      max: [+(wx + hx).toFixed(4), +(oy + cy + sy / 2).toFixed(4), +(wz + hz).toFixed(4)],
      obb: { pos: [+ox.toFixed(6), +oy.toFixed(6), +oz.toFixed(6)], theta, center: col.center, size: col.size },
    };
  });
  const sidecar = {
    axis: 'glTF Y-up; obb.pos = asset front-wall origin (world), theta = yawRad; center/size = asset-local',
    assetId: b.id,
    replacesBaseIds: b.replacesBaseIds,
    origin: b.positionGlb, yawRad: b.yawRad,
    designName: b.designName,
    doors: local.doors,
    colliders,
    noGroundCollider: true,
    notIntegratedOrWalkingTested: true,
  };
  await writeFile(resolve(dst, 'collision.json'), JSON.stringify(sidecar, null, 2) + '\n');
  assets.push({
    id: b.id,
    glb: `./world/street-completion/${b.id}/model.glb`,
    collision: `./world/street-completion/${b.id}/collision.json`,
    positionGlb: b.positionGlb,
    rotationYRad: b.yawRad,
    replacesBaseIds: b.replacesBaseIds,
    designName: b.designName,
    bytes: glbBytes.byteLength,
    sha256: sha(glbBytes),
    triangles: measurements.triangles,
  });
}
const assetBytes = assets.reduce((t, a) => t + a.bytes, 0);
const assetTris = assets.reduce((t, a) => t + a.triangles, 0);
for (const a of assets) if (a.bytes > 10_000_000) throw new Error(`${a.id} GLB ${a.bytes} exceeds the 10MB per-building budget`);
if (assetTris > 48_000) throw new Error(`combined triangle budget exceeded: ${assetTris} > 48000`);

// ---- blocks.json: frozen base + verbatim east-edge block + new block ------
const base = await readJson(resolve(root, 'world/blocks.json'));
const eastBlocks = await readJson(EAST_EDGE_BLOCKS);
const eastBlock = eastBlocks.blocks.find((b) => b.id === EAST_BLOCK_ID);
if (!eastBlock) throw new Error(`${EAST_BLOCK_ID} missing from the delivered east-edge dataset`);
// sanity: the copied 128/129 contract is unchanged
if (JSON.stringify(eastBlock.assets.map(({ id, positionGlb, rotationYRad }) => [id, positionGlb, rotationYRad])) !==
    JSON.stringify([
      ['east-shop-128', [97.66450990714537, 0, 17.734234931801197], -0.301652],
      ['east-shop-129', [95.7340372829119, 0, 23.93834100897118], 2.839941],
    ]))
  throw new Error('east-edge 128/129 asset contract drifted; aborting instead of silently rebasing it');

const blocks = JSON.parse(JSON.stringify(base));
for (const ph of blocks.placeholders) {
  if (ph.id === 'shop-128' || ph.id === 'shop-129') {
    if (ph.replacedBy && ph.replacedBy !== EAST_BLOCK_ID) throw new Error(`${ph.id} already replaced by ${ph.replacedBy}`);
    ph.replacedBy = EAST_BLOCK_ID;
  }
  if (replaces.includes(ph.id)) {
    if (ph.replacedBy && ph.replacedBy !== BLOCK_ID) throw new Error(`${ph.id} already replaced by ${ph.replacedBy}`);
    ph.replacedBy = BLOCK_ID;
  }
}
if (blocks.blocks.some((b) => b.id === BLOCK_ID)) throw new Error(`${BLOCK_ID} already present`);
blocks.blocks.push(JSON.parse(JSON.stringify(eastBlock)));
blocks.blocks.push({
  id: BLOCK_ID,
  kind: 'assets',
  replacesBaseIds: replaces,
  autoApply: true,
  assets: assets.map(({ id, glb, collision, positionGlb, rotationYRad }) =>
    ({ id, glb, collision, positionGlb, rotationYRad })),
  persistent: false,
});
blocks.generatedBy = 'scripts/build_street_completion_world.mjs (derived candidate; frozen world/blocks.json untouched; east-edge block copied verbatim from world/east-edge/blocks.json)';
await writeFile(resolve(OUT, 'blocks.json'), JSON.stringify(blocks, null, 2) + '\n');

// ---- surface: visible tail pavement = walkable ground (same faces) --------
const SURFACE_SRC = resolve(root, 'kit/out/sctail');
const surfaceGlb = await readFile(resolve(SURFACE_SRC, 'model.glb'));
const surfaceSpec = await readJson(resolve(SURFACE_SRC, 'surface-spec.json'));
const surfaceMeasurements = await readJson(resolve(SURFACE_SRC, 'measurements.json'));
await copyFile(resolve(SURFACE_SRC, 'model.glb'), resolve(OUT, 'surface.glb'));
await copyFile(resolve(SURFACE_SRC, 'surface-spec.json'), resolve(OUT, 'surface-spec.json'));
const clearances = surfaceSpec.clearance.perBuilding;
const failedClearance = Object.entries(clearances).filter(([k, v]) => k !== '_argmin' && !v.pass);
if (failedClearance.length) throw new Error(`surface clearance failed: ${failedClearance.map(([k]) => k).join(',')}`);

// ---- manifest --------------------------------------------------------------
const manifest = await readJson(resolve(root, 'world/review-manifest.json'));
manifest.generatedBy = 'scripts/build_street_completion_world.mjs (derived candidate; frozen dataset untouched)';
manifest.worldAssembly = { ...manifest.worldAssembly, path: './world/street-reviewed.glb' };
manifest.eastEdgeAssets = (await readJson(resolve(root, 'world/east-edge/review-manifest.json'))).eastEdgeAssets;
manifest.streetCompletion = {
  blockId: BLOCK_ID,
  eastEdgeBlockId: EAST_BLOCK_ID,
  eastEdgeContract: 'shop-128/129 replacement block copied verbatim from world/east-edge/blocks.json; no rebasing',
  assets,
  combinedDownloadBytes: assetBytes,
  combinedTriangleCount: assetTris,
  runtimeTextureSharing: 'none claimed — standalone GLBs embed their own image copies; unique images by content sha are counted in validation.json',
  designSpec: { path: SPEC, sha256: sha(await readFile(SPEC)) },
  surface: {
    path: './world/street-completion/surface.glb',
    bytes: surfaceGlb.byteLength,
    sha256: sha(surfaceGlb),
    triangles: surfaceMeasurements.triangles,
    groundNodeNames: ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'],
    spec: './world/street-completion/surface-spec.json',
    noCitywideSlab: true,
  },
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(SPEC, resolve(OUT, 'next-four-design.snapshot.json'));

// ---- route: frozen mainStreet extended east through the tail ---------------
const routeFrozen = await readJson(resolve(root, 'world/route.json'));
const east = routeFrozen.entries.east;
const tail = [[+east[0].toFixed(3), 0, +east[2].toFixed(3)],
  ...surfaceSpec.route.tailSamplesEvery2M.filter(([x, z]) => x > east[0]).map(([x, z]) => [+x.toFixed(3), 0, +z.toFixed(3)])];
const routeDerived = JSON.parse(JSON.stringify(routeFrozen));
routeDerived.mainStreet = routeFrozen.mainStreet.concat(tail.slice(1));
routeDerived.entries = { ...routeFrozen.entries, sctailEnd: [...tail[tail.length - 1]] };
routeDerived.note = `${routeFrozen.note}; mainStreet extended over the street-completion tail (surface-spec.json route extension; geometry-verified only at dataset build time)`;
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(routeDerived, null, 2) + '\n');

// ---- frozen pass-through inputs (client datasets fetch these by name) ------
for (const f of ['instances.json', 'collision-world.json']) {
  await copyFile(resolve(root, `world/${f}`), resolve(OUT, f));
}

// ---- cameras: frozen set + east-edge set + the batch's 8 fixed views ------
const cameras = await readJson(resolve(root, 'world/cameras.json'));
const have = new Set(cameras.cameras.map((c) => c.id));
const eastCams = await readJson(EAST_EDGE_CAMERAS);
for (const c of eastCams.cameras) {
  if (!have.has(c.id)) cameras.cameras.push(c);
}
const batch = [
  {
    id: 'sc-czero',
    ref: 'east-czero',
    note: '原C0终点方向 — verbatim copy of the measured east-czero view (six-building tail in frame)',
  },
  {
    id: 'sc-roof-north',
    positionGlb: [83.0, 14.0, 3.0], targetGlb: [115.0, 6.5, 20.5], lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: '北侧屋面连续全景（128→130→132 屋脊线）',
  },
  {
    id: 'sc-roof-south',
    positionGlb: [88.5, 10.5, 40.0], targetGlb: [114.0, 5.5, 29.0], lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: '南侧屋面连续全景（129→131→133 屋脊线）',
  },
  {
    id: 'sc-ground-seam',
    positionGlb: [79.5, 1.6, 16.2], targetGlb: [89.0, 0.2, 17.8], lensMm: 40, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: '近地街面接缝 — 原街面铺装东端与后续路面的交界（S3 surface-spec 对照机位）',
  },
  {
    id: 'sc-pair-cloth-silk',
    positionGlb: [103.5, 1.7, 24.3], targetGlb: [109.6, 2.6, 24.4], lensMm: 40, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: '棉布店(130,北)/绸缎店(131,南)对街 — 两种陈列构件同框',
  },
  {
    id: 'sc-pair-embroidery-leather',
    positionGlb: [116.0, 1.7, 27.0], targetGlb: [121.2, 2.6, 27.2], lensMm: 40, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: '绣品店(132,北)/皮货店(133,南)对街 — 挂框与木板闭合同框',
  },
  {
    id: 'sc-front-cloth',
    positionGlb: [106.06, 2.7, 24.53], targetGlb: [111.17, 2.05, 22.43], lensMm: 24, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: 'SC-F2 评审补图：棉布店(130)正面斜视 — 招牌(布行)与完整展示窗在画内，站在对弄向店面看',
  },
  {
    id: 'sc-front-silk',
    positionGlb: [112.4, 2.7, 24.04], targetGlb: [107.29, 2.05, 26.14], lensMm: 24, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: 'SC-F2 评审补图：绸缎店(131)正面斜视 — 招牌(绸庄)与完整展示窗在画内，站在对弄向店面看',
  },
  {
    id: 'sc-front-embroidery',
    positionGlb: [117.91, 2.7, 26.27], targetGlb: [123.02, 2.05, 24.17], lensMm: 24, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: 'SC-F2 评审补图：绣品店(132)正面斜视 — 招牌(绣坊)与完整展示窗在画内，站在对弄向店面看',
  },
  {
    id: 'sc-front-leather',
    positionGlb: [124.45, 2.7, 27.88], targetGlb: [119.34, 2.05, 29.98], lensMm: 24, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    note: 'SC-F2 评审补图：皮货店(133)正面斜视 — 招牌(皮货)、木板围挡与完整展示窗在画内，站在对弄向店面看',
  },
  {
    id: 'sc-lane-b',
    ref: 'lane',
    note: '支弄B保留 — frozen lane view carried through unchanged',
  },
  {
    id: 'sc-catwall',
    ref: 'catwall',
    note: '猫墙保留（2023特色，机主指定）— frozen catwall view carried through unchanged',
  },
];
const added = [];
for (const b of batch) {
  if (b.ref) {
    const src = cameras.cameras.find((c) => c.id === b.ref);
    if (!src) throw new Error(`ref camera ${b.ref} missing`);
    added.push({ ...JSON.parse(JSON.stringify(src)), id: b.id, source: `street-completion batch: ${b.note}` });
  } else {
    added.push({
      id: b.id, positionGlb: H(b.positionGlb), targetGlb: H(b.targetGlb),
      lensMm: b.lensMm, sensorWidthMm: b.sensorWidthMm, sensorFit: b.sensorFit,
      source: `street-completion batch: ${b.note}; point checked against visible geometry at capture time, adjust only with recorded before/after`,
    });
  }
}
for (const c of added) {
  const i = cameras.cameras.findIndex((x) => x.id === c.id);
  if (i >= 0) cameras.cameras[i] = c; else cameras.cameras.push(c);
}
cameras.generatedBy = 'scripts/build_street_completion_world.mjs (frozen cameras + east-edge cameras + 8 fixed batch views)';
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n');

console.log('STREET_COMPLETION_WORLD_READY', OUT);
console.log(`assets: ${assets.map((a) => `${a.id}(${a.designName}) ${a.triangles}tris ${(a.bytes / 1e6).toFixed(2)}MB`).join(', ')}`);
console.log(`combined ${assetTris}tris / ${(assetBytes / 1e6).toFixed(2)}MB; batch cameras: ${batch.map((b) => b.id).join(', ')}`);
