// Assemble the temple ENTRY-GROUP dataset (world/temple-entry/) — shanmen +
// yimen + walled court + candidates, one walkable axis from the street
// through both gates to the rear landing and back.
//
// This script is the only writer of world/temple-entry/. Inputs:
//   world/temple-shanmen/          the derived shanmen dataset (N1 revision)
//   kit/out/yimen/                 the yimen gate (N2/N3) — placed at (0,0,-21)
//   kit/out/entry-court/           the walled court (N4) — authored in place
//   ../CAMERAS.json                the 8 lead cameras (falls back to the
//                                  dataset's own copy for idempotent reruns)
//   ../DESIGN_SPEC.json            the route points (same fallback rule)
//
// The shanmen GLBs are copied byte-exact (their own tests still cover them);
// the yimen collision records are translated by the instance origin so every
// record in collision-world.json is WORLD space via obbToWorld().
//
// Run: node scripts/build_temple_entry_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/temple-entry');
const YIMEN_KIT = resolve(root, 'kit/out/yimen');
const COURT_KIT = resolve(root, 'kit/out/entry-court');
const SHANMEN_DS = resolve(root, 'world/temple-shanmen');
const sha = (b) => createHash('sha256').update(b).digest('hex');

await mkdir(OUT, { recursive: true });

// --- cameras + route: the lead contract is the source of truth; the dataset
// keeps verbatim copies so reruns stay idempotent after the task dir is gone
const ENTRY_TASK = resolve(root, '../../pawborough-temple-entry-next-20260915');
let camSource = 'task CAMERAS.json', routeSource = 'task DESIGN_SPEC.json';
let cameras;
try {
  cameras = JSON.parse(await readFile(resolve(ENTRY_TASK, 'CAMERAS.json'), 'utf8'));
} catch {
  cameras = JSON.parse(await readFile(resolve(OUT, 'cameras.json'), 'utf8'));
  camSource = 'existing dataset cameras.json (task dir gone — idempotent rerun)';
}
let routeSpec;
try {
  const spec = JSON.parse(await readFile(resolve(ENTRY_TASK, 'DESIGN_SPEC.json'), 'utf8'));
  routeSpec = spec.route;
} catch {
  routeSpec = JSON.parse(await readFile(resolve(OUT, 'route.json'), 'utf8')).spec;
  routeSource = 'existing dataset route.json (task dir gone — idempotent rerun)';
}
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n', 'utf8');

// --- assets: byte-exact copies, hashes recomputed from the copied bytes ----
const assets = {};
const copyAsset = async (id, srcDir, file, kitMeasure, groups) => {
  await copyFile(resolve(srcDir, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  let triangles;
  if (kitMeasure) {
    const m = kitMeasure.targets[file] ?? kitMeasure.targets[`${id}.glb`];
    if (!m || m.fileBytes !== bytes.byteLength || m.sha256 !== sha(bytes))
      throw new Error(`entry assembly: ${file} drifted from kit measurements (rebuild the kit first)`);
    triangles = m.triangles;
    groups = m.groups;
  } else {
    triangles = null; // shanmen: trust its own dataset manifest
  }
  assets[id] = {
    file: `./world/temple-entry/${file}`,
    bytes: bytes.byteLength,
    sha256: sha(bytes),
    ...(triangles !== null ? { triangles, groups } : {}),
  };
  return bytes;
};

// shanmen five (triangles/groups from the shanmen dataset manifest)
const shanmenManifest = JSON.parse(await readFile(resolve(SHANMEN_DS, 'review-manifest.json'), 'utf8'));
for (const id of ['temple', 'ground', 'lions', 'ornaments']) {
  const file = `${id}.glb`;
  const src = shanmenManifest.assets[id];
  await copyFile(resolve(SHANMEN_DS, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  if (src.bytes !== bytes.byteLength || src.sha256 !== sha(bytes))
    throw new Error(`entry assembly: shanmen ${file} drifted from its dataset manifest`);
  assets[id] = { ...src, file: `./world/temple-entry/${file}` };
}
// yimen + court from their kit builds
const yimenMeasure = JSON.parse(await readFile(resolve(YIMEN_KIT, 'measurements.json'), 'utf8'));
const courtMeasure = JSON.parse(await readFile(resolve(COURT_KIT, 'measurements.json'), 'utf8'));
await copyAsset('yimen', YIMEN_KIT, 'yimen.glb', yimenMeasure);
await copyAsset('court', COURT_KIT, 'court.glb', courtMeasure);

// --- instances: the assembly record the preview and tests consume ----------
const instances = {
  axis: 'GLB Y-up; +Z south toward the street; shanmen threshold at (0,0,0); north = -Z',
  instances: [
    { id: 'shanmen', module: 'temple-shanmen', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'origin at the central threshold front edge' },
    { id: 'yimen', module: 'yimen-pilot', positionGlb: [0, 0, -21], rotationYRad: 0,
      note: 'local facade z=0 maps to world z=-21; yaw 0 (same facing, +Z)' },
    { id: 'entrycourt', module: 'temple-entry-court', positionGlb: [0, 0, 0], rotationYRad: 0,
      note: 'authored in place (court interior x±8, z -3.6..-21)' },
  ],
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n', 'utf8');

// --- collision-world.json: every record in WORLD space ----------------------
const yimenCollision = JSON.parse(await readFile(resolve(YIMEN_KIT, 'collision.json'), 'utf8'));
const courtCollision = JSON.parse(await readFile(resolve(COURT_KIT, 'collision.json'), 'utf8'));
const shanmenCollision = JSON.parse(await readFile(resolve(SHANMEN_DS, 'collision-world.json'), 'utf8'));

const worldColliders = [];
// shanmen: already world (identity instance)
for (const c of shanmenCollision.colliders) {
  worldColliders.push({ ...c, name: `shanmen:${c.name}`, group: `shanmen:${c.group ?? 'shanmen-body'}` });
}
// yimen: local records translated by the instance origin (0,0,-21), yaw 0
const YZ = -21;
for (const c of yimenCollision.colliders) {
  const [cx, cy, cz] = c.obb.center;
  const [sx, sy, sz] = c.obb.size;
  worldColliders.push({
    name: `yimen:${c.name}`, group: `yimen:${c.group ?? 'yimen-body'}`, type: 'box',
    min: [cx - sx / 2, cy - sy / 2, cz + YZ - sz / 2],
    max: [cx + sx / 2, cy + sy / 2, cz + YZ + sz / 2],
    obb: { pos: [0, 0, YZ], theta: 0.0, center: [cx, cy, cz], size: [sx, sy, sz] },
  });
}
// court: world records already
for (const c of courtCollision.colliders) {
  worldColliders.push({ ...c, name: `court:${c.name}`, group: `court:${c.group ?? 'entry-court'}` });
}
const world = {
  axis: 'glTF Y-up; +Z south; world records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'temple-entry',
  instances: instances.instances,
  clearCorridors: {
    shanmen: shanmenCollision.clearCorridor,
    yimenWorld: {
      x: yimenCollision.clearCorridor.x, y0: yimenCollision.clearCorridor.y0,
      y1: yimenCollision.clearCorridor.y1,
      z0: yimenCollision.clearCorridor.z0 + YZ, z1: yimenCollision.clearCorridor.z1 + YZ,
    },
  },
  colliders: worldColliders,
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n', 'utf8');

// --- route -------------------------------------------------------------------
const route = {
  spec: routeSpec,
  source: routeSource,
  axis: 'entry axis: street (z+5) -> shanmen (z0) -> court -> yimen (z-21) -> landing (z-27.3) and back',
  mainStreet: routeSpec.pointsGlb,
  walkableGroundSource: routeSpec.walkableGroundSource,
  manualWalkClaim: routeSpec.manualWalkClaim,
  negatives: [
    'court side walls + returns block leaving the court sideways',
    'yimen lattice bays are solid (closed doors with real collision)',
    'no ground beyond the landing / cutoff wall (z < -29.34) and outside x ±8.28 — capsules fall',
  ],
};
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n', 'utf8');

// --- review manifest ----------------------------------------------------------
const manifest = {
  datasetId: 'temple-entry',
  title: '城隍庙入口组 · 山门—前院—仪门 样板',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  reference: yimenMeasure.design.reference,
  axis: instances.axis,
  assets,
  placedTriangles: Object.values(assets).reduce((s, a) => s + a.triangles, 0),
  budgets: {
    newYimenTris: yimenMeasure.budgets.yimenTris,
    courtTris: courtMeasure.budgets.courtTris,
    newDownloadBytes: {
      actual: assets.yimen.bytes + assets.court.bytes,
      limit: 10000000,
      pass: assets.yimen.bytes + assets.court.bytes <= 10000000,
      note: 'new content only; shanmen assets reused from the adopted-candidate dataset',
    },
  },
  cameras: {
    count: cameras.cameras.length,
    source: `lead designed entry cameras (${camSource})`,
    contract: 'positionGlb/targetGlb/verticalFovDegrees applied verbatim; page verifies pose after controls.update()',
  },
  passage: {
    shanmenClearM: [3.0, 3.1],
    yimenClearM: [3.6, 3.2],
    route: 'front approach -> through shanmen -> court -> through yimen -> rear landing -> return',
  },
  groundPolicy: 'visible court/paving/hall-floor meshes ARE the physics ground (temple-ground__ nodes); no invisible plane',
  buildChain: 'build_temple_shanmen.py(N1) + build_yimen.py(N2/N3) + build_entry_court.py(N4) <- DESIGN_SPEC.json (lead design)',
  generatedBy: 'scripts/build_temple_entry_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// --- verification inputs carried beside the dataset ---------------------------
await copyFile(resolve(YIMEN_KIT, 'roof-surface-samples.json'), resolve(OUT, 'yimen-roof-surface-samples.json'));

const tri = manifest.placedTriangles;
const byt = Object.values(assets).reduce((s, a) => s + a.bytes, 0);
console.log(`ENTRY_DATASET_READY colliders=${worldColliders.length} tris=${tri} bytes=${byt} cameras=${cameras.cameras.length} (${camSource})`);
