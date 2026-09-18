// Assemble the temple AXIS V2 dataset (world/temple-axis-v2/) — the expanded
// axis: shanmen + entry court (court-open) + yimen (+ rear stage) + second
// court VARIANT (side walls / north closure removed) + peidian x2 + gallery x2
// + the principal hall + side passages + third court + houdian.
//
// This script is the only writer of world/temple-axis-v2/. Inputs:
//   world/temple-shanmen/          frozen (temple/ground/lions/ornaments)
//   world/temple-entry/            frozen (yimen.glb + roof samples)
//   world/temple-dadian/           frozen 7-of-8 copies (dadian-court.glb is
//                                  REPLACED by the v2 variant — the delivered
//                                  file itself is never touched)
//   kit/out/court-open/            entry court variant (frozen kit output)
//   kit/out/dadian/                the hall (frozen kit output)
//   kit/out/dadian-court-v2/       N1 second-court variant
//   kit/out/peidian/ gallery/ yimen-stage/ court3/ houdian/   N2-N4 builds
//   ../../{CAMERAS,DESIGN_SPEC}.json   the expansion task contract
//
// Frozen delivered files are copied byte-exact and hash-checked; every new
// collision record carries an obb {pos,theta,center,size} whose world AABB is
// recomputed here, and six sampled records (incl. yaw ±π/2) are verified
// corner-by-corner against the production obbToWorld math.
//
// Run: node scripts/build_temple_axis_v2_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/temple-axis-v2');
const DADIAN_DS = resolve(root, 'world/temple-dadian');
const ENTRY_DS = resolve(root, 'world/temple-entry');
const SHANMEN_DS = resolve(root, 'world/temple-shanmen');
const KIT = (d) => resolve(root, 'kit/out', d);
const TASK = resolve(root, '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const HALF_PI = 1.5707963267948966;

await mkdir(OUT, { recursive: true });

// --- cameras + route (task contract first, dataset copy for idempotent reruns)
let camSource = 'task CAMERAS.json', routeSource = 'task DESIGN_SPEC.json';
let cameras, routeSpec;
try {
  cameras = JSON.parse(await readFile(resolve(TASK, 'CAMERAS.json'), 'utf8'));
} catch {
  cameras = JSON.parse(await readFile(resolve(OUT, 'cameras.json'), 'utf8'));
  camSource = 'existing dataset cameras.json (task dir gone — idempotent rerun)';
}
try {
  routeSpec = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8')).route;
} catch {
  routeSpec = JSON.parse(await readFile(resolve(OUT, 'route.json'), 'utf8')).spec;
  routeSource = 'existing dataset route.json (task dir gone — idempotent rerun)';
}
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n', 'utf8');

// --- obb -> world AABB (same math as src/world/collisionAdapter.obbToWorld --
const compose = (pos, theta, rec) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  const [cx, cy, cz] = rec.obb ? rec.obb.center : rec.center;
  const [sx, sy, sz] = rec.obb ? rec.obb.size : rec.size;
  const wx = pos[0] + c * cx + s * cz;
  const wz = pos[2] - s * cx + c * cz;
  const wy = cy + (pos[1] ?? 0);
  const hx = Math.abs(c) * sx / 2 + Math.abs(s) * sz / 2;
  const hz = Math.abs(s) * sx / 2 + Math.abs(c) * sz / 2;
  return {
    name: rec.name, group: rec.group ?? 'body', type: 'box',
    min: [wx - hx, wy - sy / 2, wz - hz],
    max: [wx + hx, wy + sy / 2, wz + hz],
    obb: { pos, theta, center: [cx, cy, cz], size: [sx, sy, sz] },
  };
};
const translate = (pos, theta, rec) => compose(pos, theta, rec);

// --- instances ----------------------------------------------------------------
const instances = {
  axis: 'GLB Y-up; +Z south toward the street; shanmen threshold at (0,0,0); north = -Z',
  instances: [
    { id: 'shanmen', module: 'temple-shanmen', positionGlb: [0, 0, 0], rotationYRad: 0 },
    { id: 'entrycourt', module: 'temple-entry-court-open', positionGlb: [0, 0, 0], rotationYRad: 0 },
    { id: 'yimen', module: 'yimen-pilot', positionGlb: [0, 0, -21], rotationYRad: 0 },
    { id: 'yimenstage', module: 'yimen-stage', positionGlb: [0, 0, -21], rotationYRad: 0,
      note: 'yimen-LOCAL authored; hangs on the yimen rear face' },
    { id: 'dadiancourt', module: 'dadian-court-v2', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'VARIANT: side walls + north closure + stubs removed' },
    { id: 'peidian-w', module: 'peidian', positionGlb: [-11.2, 0, -35.8], rotationYRad: HALF_PI },
    { id: 'peidian-e', module: 'peidian', positionGlb: [11.2, 0, -35.8], rotationYRad: -HALF_PI },
    { id: 'gallery-w', module: 'gallery', positionGlb: [-10.78, 0, -30.99], rotationYRad: HALF_PI },
    { id: 'gallery-e', module: 'gallery', positionGlb: [10.78, 0, -30.99], rotationYRad: -HALF_PI },
    { id: 'dadian', module: 'dadian', positionGlb: [0, 0, -44], rotationYRad: 0 },
    { id: 'court3', module: 'court3', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'authored in place (passages z -39.1..-58.2, court3 to -72.2, walls to -84)' },
    { id: 'houdian', module: 'houdian', positionGlb: [0, 0, -74], rotationYRad: 0 },
  ],
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n', 'utf8');

// --- assets: byte-exact copies with recomputed hashes --------------------------
const assets = {};
const copyFrozen = async (id, srcDir, file) => {
  await copyFile(resolve(srcDir, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  assets[id] = { file: `./world/temple-axis-v2/${file}`, bytes: bytes.byteLength,
                 sha256: sha(bytes) };
  return bytes;
};
const copyKit = async (id, kitDir, file) => {
  const m = JSON.parse(await readFile(resolve(KIT(kitDir), 'measurements.json'), 'utf8'));
  await copyFile(resolve(KIT(kitDir), file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  const t = m.targets[file];
  if (!t || t.fileBytes !== bytes.byteLength || t.sha256 !== sha(bytes))
    throw new Error(`axis-v2 assembly: ${file} drifted from its kit build`);
  assets[id] = { file: `./world/temple-axis-v2/${file}`, bytes: bytes.byteLength,
                 sha256: sha(bytes), triangles: t.triangles, groups: t.groups };
};

// frozen five via their dataset manifests (byte-drift guard)
{
  const shanmenManifest = JSON.parse(await readFile(resolve(SHANMEN_DS, 'review-manifest.json'), 'utf8'));
  for (const id of ['temple', 'ground', 'lions', 'ornaments']) {
    const bytes = await copyFrozen(id, SHANMEN_DS, `${id}.glb`);
    const src = shanmenManifest.assets[id];
    if (src.bytes !== bytes.byteLength || src.sha256 !== sha(bytes))
      throw new Error(`axis-v2 assembly: shanmen ${id}.glb drifted`);
    assets[id].triangles = src.triangles;
    assets[id].groups = src.groups;
  }
  const entryManifest = JSON.parse(await readFile(resolve(ENTRY_DS, 'review-manifest.json'), 'utf8'));
  const yimenBytes = await copyFrozen('yimen', ENTRY_DS, 'yimen.glb');
  if (entryManifest.assets.yimen.bytes !== yimenBytes.byteLength
    || entryManifest.assets.yimen.sha256 !== sha(yimenBytes))
    throw new Error('axis-v2 assembly: yimen.glb drifted');
  assets.yimen.triangles = entryManifest.assets.yimen.triangles;
  assets.yimen.groups = entryManifest.assets.yimen.groups;
  // dadian four (frozen in the dadian dataset, hash-checked against it)
  const dadianManifest = JSON.parse(await readFile(resolve(DADIAN_DS, 'review-manifest.json'), 'utf8'));
  for (const [id, file] of [['courtOpen', 'court-open.glb'], ['dadian', 'dadian.glb']]) {
    const bytes = await copyFrozen(id, DADIAN_DS, file);
    const src = dadianManifest.assets[id];
    if (src.bytes !== bytes.byteLength || src.sha256 !== sha(bytes))
      throw new Error(`axis-v2 assembly: ${file} drifted from the dadian dataset`);
    assets[id].triangles = src.triangles;
    assets[id].groups = src.groups;
  }
}
// the six new builds
await copyKit('dadianCourtV2', 'dadian-court-v2', 'dadian-court-v2.glb');
await copyKit('peidian', 'peidian', 'peidian.glb');
await copyKit('gallery', 'gallery', 'gallery.glb');
await copyKit('yimenStage', 'yimen-stage', 'yimen-stage.glb');
await copyKit('court3', 'court3', 'court3.glb');
await copyKit('houdian', 'houdian', 'houdian.glb');

// --- collision-world.json -------------------------------------------------------
const shanmenCollision = JSON.parse(await readFile(resolve(SHANMEN_DS, 'collision-world.json'), 'utf8'));
const yimenCollision = JSON.parse(await readFile(resolve(ENTRY_DS, 'collision-world.json'), 'utf8'));
const courtOpenCollision = JSON.parse(await readFile(resolve(KIT('court-open'), 'collision.json'), 'utf8'));
const dadianCollision = JSON.parse(await readFile(resolve(KIT('dadian'), 'collision.json'), 'utf8'));
const courtV2Collision = JSON.parse(await readFile(resolve(KIT('dadian-court-v2'), 'collision.json'), 'utf8'));
const peidianCollision = JSON.parse(await readFile(resolve(KIT('peidian'), 'collision.json'), 'utf8'));
const galleryCollision = JSON.parse(await readFile(resolve(KIT('gallery'), 'collision.json'), 'utf8'));
const stageCollision = JSON.parse(await readFile(resolve(KIT('yimen-stage'), 'collision.json'), 'utf8'));
const court3Collision = JSON.parse(await readFile(resolve(KIT('court3'), 'collision.json'), 'utf8'));
const houdianCollision = JSON.parse(await readFile(resolve(KIT('houdian'), 'collision.json'), 'utf8'));

const worldColliders = [];
for (const c of shanmenCollision.colliders)
  worldColliders.push({ ...c, name: `shanmen:${c.name}`, group: `shanmen:${c.group ?? 'shanmen-body'}` });
for (const c of yimenCollision.colliders) {
  if (!c.name.startsWith('yimen:')) continue;
  worldColliders.push({ ...c, name: `yimen:${c.name.slice('yimen:'.length)}` });
}
for (const c of courtOpenCollision.colliders)
  worldColliders.push({ ...c, name: `court:${c.name}`, group: `court:${c.group ?? 'entry-court'}` });
const DZ = -44;
for (const c of dadianCollision.colliders) {
  const [cx, cy, cz] = c.obb.center;
  const [sx, sy, sz] = c.obb.size;
  worldColliders.push({
    name: `dadian:${c.name}`, group: `dadian:${c.group ?? 'dadian-body'}`, type: 'box',
    min: [cx - sx / 2, cy - sy / 2, cz + DZ - sz / 2],
    max: [cx + sx / 2, cy + sy / 2, cz + DZ + sz / 2],
    obb: { pos: [0, 0, DZ], theta: 0.0, center: [cx, cy, cz], size: [sx, sy, sz] },
  });
}
// the v2 second court (authored in place) replaces the delivered court records
for (const c of courtV2Collision.colliders)
  worldColliders.push({ ...c, name: `dadiancourt:${c.name}`, group: `dadiancourt:${c.group ?? 'dadian-court'}` });
// yawed peidian/gallery instances (records carry bare local names)
const P_W = [-11.2, 0, -35.8], P_E = [11.2, 0, -35.8];
const G_W = [-10.78, 0, -30.99], G_E = [10.78, 0, -30.99];
for (const c of peidianCollision.colliders) {
  const grp = `peidian:${c.group ?? 'peidian-body'}`;
  worldColliders.push(compose(P_W, HALF_PI, { ...c, name: `peidian-w:${c.name}`, group: grp }));
  worldColliders.push(compose(P_E, -HALF_PI, { ...c, name: `peidian-e:${c.name}`, group: grp }));
}
for (const c of galleryCollision.colliders) {
  const grp = `gallery:${c.group ?? 'gallery-body'}`;
  worldColliders.push(compose(G_W, HALF_PI, { ...c, name: `gallery-w:${c.name}`, group: grp }));
  worldColliders.push(compose(G_E, -HALF_PI, { ...c, name: `gallery-e:${c.name}`, group: grp }));
}
for (const c of stageCollision.colliders)
  worldColliders.push(compose([0, 0, -21], 0, { ...c, name: `yimenstage:${c.name}`, group: c.group ?? 'yimen-stage-body' }));
for (const c of court3Collision.colliders)
  worldColliders.push({ ...c, name: `court3:${c.name}`, group: `court3:${c.group ?? 'court3-boundary'}` });
for (const c of houdianCollision.colliders)
  worldColliders.push(compose([0, 0, -74], 0, { ...c, name: `houdian:${c.name}`, group: c.group ?? 'houdian-body' }));

const world = {
  axis: 'glTF Y-up; +Z south; world records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'temple-axis-v2',
  instances: instances.instances,
  variant: 'dadian-court-v2: side walls + north closure + stubs removed (buildSideWalls/buildNorthClosure=false)',
  colliders: worldColliders,
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n', 'utf8');

// --- route -----------------------------------------------------------------------
// mainStreet = the frozen spec polyline with ONE walkability lane inserted:
// the eastbound leg (0,-40.2)->(6,-40.2) would scrape the stair cheeks
// (x ±3..3.55, z -39.35..-41.05) when walked in reverse, so the dataset
// polyline routes that crossing through the cheek-free court lane z=-38.6.
// route.spec keeps the frozen DESIGN_SPEC points verbatim.
const laneAt = (pts, zA, zB) => {
  const i = pts.findIndex((p, k) => k > 0 && pts[k - 1][1] === zA && p[1] === zB);
  return i;
};
const specPts = routeSpec.templeLocal.map(([x, z]) => [x, 0, z]);
{
  const i = specPts.findIndex((p) => p[0] === 6 && p[1] === 0 && p[2] === -40.2);
  if (i > -1) specPts.splice(i, 0, [0, 0, -38.6], [6, 0, -38.6]);
}
// subdivide to <= 6 m adjacent gaps (same rule as the bridge route polyline;
// the frozen spec points stay untouched in route.spec)
{
  const out = [specPts[0]];
  for (let k = 1; k < specPts.length; k++) {
    const a = out[out.length - 1], b = specPts[k];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / 6));
    for (let j = 1; j <= n; j++)
      out.push([a[0] + (b[0] - a[0]) * j / n, 0, a[2] + (b[2] - a[2]) * j / n]);
  }
  specPts.length = 0;
  specPts.push(...out);
}
const route = {
  spec: routeSpec,
  source: routeSource,
  axis: 'full axis: shanmen -> yimen/stage -> second court (peidian gallery) -> platform -> east passage -> court3 -> houdian doors, then return',
  mainStreetLaneNote: 'the (6,-40.2) crossing is routed via the cheek-free lane z=-38.6 so the polyline walks in BOTH directions; frozen points stay in .spec',
  mainStreet: specPts,
  fallCheck: routeSpec.fallCheck,
  manualWalkClaim: routeSpec.manualWalkClaim ?? false,
  negatives: routeSpec.negatives,
};
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n', 'utf8');

// --- review manifest ---------------------------------------------------------------
const manifest = {
  datasetId: 'temple-axis-v2',
  title: '城隍庙庙轴线 v2 · 山门—仪门/戏楼—配殿院—大殿—三进院—城隍殿',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  reference: 'DESIGN_SPEC.json pawborough-temple-expansion-night-20260917 (all new modules design inference; GEN images form-direction only)',
  axis: instances.axis,
  assets,
  placedTriangles: Object.values(assets).reduce((s, a) => s + (a.triangles ?? 0), 0),
  budgets: {
    newModulesTris: {
      actual: ['dadianCourtV2', 'peidian', 'gallery', 'yimenStage', 'court3', 'houdian']
        .reduce((s, id) => s + assets[id].triangles, 0),
      limit: 70000,
    },
    placedTriangles: { actual: 0, limit: 180000 },
  },
  cameras: {
    count: cameras.cameras.length,
    source: `lead designed expansion cameras (${camSource})`,
    contract: 'positionGlb/targetGlb/verticalFovDegrees applied verbatim; page verifies pose after controls.update()',
  },
  groundPolicy: 'visible court/path/platform/step/base meshes ARE the physics ground (temple-ground__ nodes); no invisible plane; stage floor deliberately NOT temple-ground (unreachable)',
  designPresets: {
    peidianGable: '硬山 (owner ruling; GEN 观音兜 not copied)',
    houdianRoof: 'single-eave 硬山 (owner ruling; GEN G36 xieshan read not adopted this batch)',
    stage: 'attached to the yimen rear, floor 2.6 m, unreachable, ridge 7.4 < yimen 7.7',
    plaques: 'all blank boards (new image budget 0)',
    boundaryWalls: 'x ±16.4 + north closure z -84.0 — sample language, NOT historical',
  },
  buildChain: 'build_dadian_court.py(v2 keys) + build_peidian.py + build_gallery.py + build_yimen_stage.py + build_court3.py + build_houdian.py <- DESIGN_SPEC.json (lead design)',
  generatedBy: 'scripts/build_temple_axis_v2_world.mjs',
};
manifest.budgets.placedTriangles.actual = manifest.placedTriangles;
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// --- verification sidecars ---------------------------------------------------------
await copyFile(resolve(DADIAN_DS, 'yimen-roof-surface-samples.json'), resolve(OUT, 'yimen-roof-surface-samples.json'));
await copyFile(resolve(DADIAN_DS, 'dadian-roof-surface-samples.json'), resolve(OUT, 'dadian-roof-surface-samples.json'));
await copyFile(resolve(KIT('peidian'), 'roof-surface-samples.json'), resolve(OUT, 'peidian-roof-surface-samples.json'));
await copyFile(resolve(KIT('houdian'), 'roof-surface-samples.json'), resolve(OUT, 'houdian-roof-surface-samples.json'));

// --- self-check: six new records (incl. yaw ±π/2) corner-checked -------------------
// Rebuild each sampled record's four corners from obbToWorld and compare with
// the stored AABB at 1e-6.
const cornerCheck = (rec) => {
  const { pos, theta, center, size } = rec.obb;
  const c = Math.cos(theta), s = Math.sin(theta);
  const wx = pos[0] + c * center[0] + s * center[2];
  const wz = pos[2] - s * center[0] + c * center[2];
  const wy = center[1] + (pos[1] ?? 0);
  const hx = Math.abs(c) * size[0] / 2 + Math.abs(s) * size[2] / 2;
  const hz = Math.abs(s) * size[0] / 2 + Math.abs(c) * size[2] / 2;
  const corners = [[wx - hx, wz - hz], [wx + hx, wz - hz], [wx + hx, wz + hz], [wx - hx, wz + hz]];
  return corners.every(([x, z]) =>
    x >= rec.min[0] - 1e-6 && x <= rec.max[0] + 1e-6 && z >= rec.min[2] - 1e-6 && z <= rec.max[2] + 1e-6);
};
const pick = (prefix, name, theta) => worldColliders.find((c) => c.name === `${prefix}:${name}`
  && Math.abs(c.obb.theta - theta) < 1e-9);
const sampled = [
  worldColliders.find((c) => c.name.startsWith('peidian-w:') && c.obb.theta === HALF_PI),
  worldColliders.find((c) => c.name.startsWith('peidian-e:') && c.obb.theta === -HALF_PI),
  worldColliders.find((c) => c.name.startsWith('gallery-w:') && c.obb.theta === HALF_PI),
  worldColliders.find((c) => c.name.startsWith('gallery-e:') && c.obb.theta === -HALF_PI),
  worldColliders.find((c) => c.name === 'houdian:rear-wall'),
  worldColliders.find((c) => c.name === 'court3:boundary-wall'),
];
let bad = 0;
for (const rec of sampled.filter(Boolean)) if (!cornerCheck(rec)) bad++;
if (sampled.filter(Boolean).length < 6 || bad > 0) {
  console.error(`AXIS_V2_SELF_CHECK_FAIL sampled=${sampled.filter(Boolean).length} bad=${bad}`);
  process.exit(4);
}

const tri = manifest.placedTriangles;
const byt = Object.values(assets).reduce((s, a) => s + a.bytes, 0);
console.log(`AXIS_V2_DATASET_READY colliders=${worldColliders.length} tris=${tri} `
  + `bytes=${byt} cameras=${cameras.cameras.length} (${camSource}) selfcheck=6/6`);
