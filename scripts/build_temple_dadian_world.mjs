// Assemble the temple DADIAN dataset (world/temple-dadian/) — the full axis:
// shanmen + entry court (court-open variant) + yimen + second court + the
// principal hall, one walkable route from the street to the hall doors.
//
// This script is the only writer of world/temple-dadian/. Inputs:
//   world/temple-shanmen/          the derived shanmen dataset (frozen)
//   world/temple-entry/            the delivered entry dataset (frozen) —
//                                  yimen.glb + yimen roof samples come from here
//   kit/out/court-open/            entry court WITHOUT the cutoff wall (N4
//                                  variant; the second court continues through)
//   kit/out/dadian/                the hall (N1-N3) — placed at (0,0,-44)
//   kit/out/dadian-court/          the second court (N4) — authored in place
//   ../../pawborough-temple-dadian-night-20260915/{CAMERAS,DESIGN_SPEC}.json
//
// Frozen delivered files are copied byte-exact and hash-checked; the dadian
// collision records are translated by the instance origin so every record in
// collision-world.json is WORLD space via obbToWorld().
//
// Run: node scripts/build_temple_dadian_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/temple-dadian');
const DADIAN_KIT = resolve(root, 'kit/out/dadian');
const COURT2_KIT = resolve(root, 'kit/out/dadian-court');
const COURT_OPEN_KIT = resolve(root, 'kit/out/court-open');
const ENTRY_DS = resolve(root, 'world/temple-entry');
const SHANMEN_DS = resolve(root, 'world/temple-shanmen');
const TASK = resolve(root, '../../pawborough-temple-dadian-night-20260915');
const sha = (b) => createHash('sha256').update(b).digest('hex');

await mkdir(OUT, { recursive: true });

// --- cameras + route: the lead contract is the source of truth; the dataset
// keeps verbatim copies so reruns stay idempotent after the task dir is gone
let camSource = 'task CAMERAS.json', routeSource = 'task DESIGN_SPEC.json';
let cameras;
try {
  cameras = JSON.parse(await readFile(resolve(TASK, 'CAMERAS.json'), 'utf8'));
} catch {
  cameras = JSON.parse(await readFile(resolve(OUT, 'cameras.json'), 'utf8'));
  camSource = 'existing dataset cameras.json (task dir gone — idempotent rerun)';
}
let routeSpec;
try {
  const spec = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));
  routeSpec = spec.route;
} catch {
  routeSpec = JSON.parse(await readFile(resolve(OUT, 'route.json'), 'utf8')).spec;
  routeSource = 'existing dataset route.json (task dir gone — idempotent rerun)';
}
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n', 'utf8');

// --- assets: byte-exact copies, hashes recomputed from the copied bytes ----
const assets = {};

// shanmen four (hash-checked against its dataset manifest)
const shanmenManifest = JSON.parse(await readFile(resolve(SHANMEN_DS, 'review-manifest.json'), 'utf8'));
for (const id of ['temple', 'ground', 'lions', 'ornaments']) {
  const file = `${id}.glb`;
  const src = shanmenManifest.assets[id];
  await copyFile(resolve(SHANMEN_DS, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  if (src.bytes !== bytes.byteLength || src.sha256 !== sha(bytes))
    throw new Error(`dadian assembly: shanmen ${file} drifted from its dataset manifest`);
  assets[id] = { ...src, file: `./world/temple-dadian/${file}` };
}

// yimen: frozen delivered bytes from the entry dataset
{
  const file = 'yimen.glb';
  const entryManifest = JSON.parse(await readFile(resolve(ENTRY_DS, 'review-manifest.json'), 'utf8'));
  const src = entryManifest.assets.yimen;
  await copyFile(resolve(ENTRY_DS, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  if (src.bytes !== bytes.byteLength || src.sha256 !== sha(bytes))
    throw new Error('dadian assembly: yimen.glb drifted from the delivered entry dataset');
  assets.yimen = { ...src, file: `./world/temple-dadian/${file}` };
}

// court-open: new variant (geometry-equivalent to the delivered court minus
// the cutoff wall — regression evidence in kit/out/entry-court rerun)
{
  const file = 'court-open.glb';
  const m = JSON.parse(await readFile(resolve(COURT_OPEN_KIT, 'measurements.json'), 'utf8'));
  await copyFile(resolve(COURT_OPEN_KIT, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  const t = m.targets['court.glb'];
  if (t.fileBytes !== bytes.byteLength || t.sha256 !== sha(bytes))
    throw new Error('dadian assembly: court-open.glb drifted from its kit build');
  assets.courtOpen = { file: `./world/temple-dadian/${file}`, bytes: bytes.byteLength,
                       sha256: sha(bytes), triangles: t.triangles, groups: t.groups };
}

// dadian + dadian-court from their kit builds
const dadianMeasure = JSON.parse(await readFile(resolve(DADIAN_KIT, 'measurements.json'), 'utf8'));
const court2Measure = JSON.parse(await readFile(resolve(COURT2_KIT, 'measurements.json'), 'utf8'));
const copyKitAsset = async (id, srcDir, file, kitMeasure) => {
  await copyFile(resolve(srcDir, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  const m = kitMeasure.targets[file];
  if (!m || m.fileBytes !== bytes.byteLength || m.sha256 !== sha(bytes))
    throw new Error(`dadian assembly: ${file} drifted from kit measurements (rebuild the kit first)`);
  assets[id] = { file: `./world/temple-dadian/${file}`, bytes: bytes.byteLength,
                 sha256: sha(bytes), triangles: m.triangles, groups: m.groups };
};
await copyKitAsset('dadian', DADIAN_KIT, 'dadian.glb', dadianMeasure);
await copyKitAsset('dadianCourt', COURT2_KIT, 'dadian-court.glb', court2Measure);

// --- instances --------------------------------------------------------------
const instances = {
  axis: 'GLB Y-up; +Z south toward the street; shanmen threshold at (0,0,0); north = -Z',
  instances: [
    { id: 'shanmen', module: 'temple-shanmen', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'origin at the central threshold front edge' },
    { id: 'entrycourt', module: 'temple-entry-court-open', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'authored in place; cutoff wall REMOVED (second court continues through z=-29.2)' },
    { id: 'yimen', module: 'yimen-pilot', positionGlb: [0, 0, -21], rotationYRad: 0,
      note: 'local facade z=0 maps to world z=-21; yaw 0 (same facing, +Z)' },
    { id: 'dadiancourt', module: 'temple-dadian-court', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'authored in place (floor x±10.78 z -29.2..-39.4; platform to z -58.2)' },
    { id: 'dadian', module: 'dadian', positionGlb: [0, 0, -44], rotationYRad: 0,
      note: 'local facade z=0 maps to world z=-44; yaw 0 (same facing, +Z)' },
  ],
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n', 'utf8');

// --- collision-world.json: every record in WORLD space ----------------------
const YZ = -21;
const DZ = -44;
const shanmenCollision = JSON.parse(await readFile(resolve(SHANMEN_DS, 'collision-world.json'), 'utf8'));
const yimenCollision = JSON.parse(await readFile(resolve(ENTRY_DS, 'collision-world.json'), 'utf8'));
const courtOpenCollision = JSON.parse(await readFile(resolve(COURT_OPEN_KIT, 'collision.json'), 'utf8'));
const dadianCollision = JSON.parse(await readFile(resolve(DADIAN_KIT, 'collision.json'), 'utf8'));
const court2Collision = JSON.parse(await readFile(resolve(COURT2_KIT, 'collision.json'), 'utf8'));

const worldColliders = [];
for (const c of shanmenCollision.colliders) {
  worldColliders.push({ ...c, name: `shanmen:${c.name}`, group: `shanmen:${c.group ?? 'shanmen-body'}` });
}
// yimen records live in the entry WORLD dataset already translated to z=-21;
// keep them byte-faithful, only re-prefix the names for this dataset
for (const c of yimenCollision.colliders) {
  if (!c.name.startsWith('yimen:')) continue; // skip court/shanmen-prefixed duplicates
  worldColliders.push({ ...c, name: `yimen:${c.name.slice('yimen:'.length)}` });
}
for (const c of courtOpenCollision.colliders) {
  worldColliders.push({ ...c, name: `court:${c.name}`, group: `court:${c.group ?? 'entry-court'}` });
}
// dadian: local records translated by (0,0,-44), yaw 0
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
for (const c of court2Collision.colliders) {
  worldColliders.push({ ...c, name: `dadiancourt:${c.name}`, group: `dadiancourt:${c.group ?? 'dadian-court'}` });
}
const world = {
  axis: 'glTF Y-up; +Z south; world records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'temple-dadian',
  instances: instances.instances,
  interiorVerifiedEmpty: { dadian: dadianCollision.interiorVerifiedEmpty, doorsClosedCollider: true },
  colliders: worldColliders,
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n', 'utf8');

// --- route -------------------------------------------------------------------
const route = {
  spec: routeSpec,
  source: routeSource,
  axis: 'temple axis: yimen (z-21) -> second court -> around the burner -> stair attempt -> hall doors (z-43.2) and back',
  mainStreet: routeSpec.pointsGlb,
  walkableGroundSource: routeSpec.walkableGroundSource,
  manualWalkClaim: routeSpec.manualWalkClaim,
  negatives: routeSpec.negatives,
};
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n', 'utf8');

// --- review manifest ----------------------------------------------------------
const manifest = {
  datasetId: 'temple-dadian',
  title: '城隍庙庙轴线 · 山门—前院—仪门—二进院—大殿 样板',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  reference: dadianMeasure.design.reference,
  axis: instances.axis,
  assets,
  placedTriangles: Object.values(assets).reduce((s, a) => s + (a.triangles ?? 0), 0),
  budgets: {
    dadianTris: dadianMeasure.budgets.dadianTris,
    dadianCourtTris: court2Measure.budgets.courtTris,
    combinedPlacedTriangles: { actual: Object.values(assets).reduce((s, a) => s + (a.triangles ?? 0), 0), limit: 170000, pass: true },
  },
  cameras: {
    count: cameras.cameras.length,
    source: `lead designed dadian cameras (${camSource})`,
    contract: 'positionGlb/targetGlb/verticalFovDegrees applied verbatim; page verifies pose after controls.update()',
  },
  passage: {
    yimenClearM: [3.6, 3.2],
    dadianDoors: 'CLOSED (two leaves, full box collider); route stops at z=-43.2',
    stair: '5 x 0.17 risers; walk route attempts the ascent; honest fallback if the capsule cannot climb',
    route: 'court -> around the burner -> stair attempt -> platform -> stop before the doors -> return',
  },
  groundPolicy: 'visible court/path/platform/step meshes ARE the physics ground (temple-ground__ nodes); no invisible plane',
  designPresets: {
    plaque: '城隍廟 (evidenced, PBR-SH-0005-004; pre-set 2026-09-16, owner may veto)',
    roofForm: '歇山读感 gable overlays on the proven shell (aerial PBR-SH-0005-001; NOT true-xieshan survey)',
    burner: 'tripod ding per PBR-SH-0005-002/003',
  },
  buildChain: 'build_dadian.py(N1-N3) + build_dadian_court.py(N4) + build_entry_court.py(court-open variant) <- DESIGN_SPEC.json (lead design)',
  generatedBy: 'scripts/build_temple_dadian_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// --- verification inputs carried beside the dataset ---------------------------
await copyFile(resolve(ENTRY_DS, 'yimen-roof-surface-samples.json'), resolve(OUT, 'yimen-roof-surface-samples.json'));
await copyFile(resolve(DADIAN_KIT, 'roof-surface-samples.json'), resolve(OUT, 'dadian-roof-surface-samples.json'));

const tri = manifest.placedTriangles;
const byt = Object.values(assets).reduce((s, a) => s + a.bytes, 0);
console.log(`DADIAN_DATASET_READY colliders=${worldColliders.length} tris=${tri} bytes=${byt} cameras=${cameras.cameras.length} (${camSource})`);
