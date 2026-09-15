// Assemble the standalone temple pilot dataset (world/temple-shanmen/) from
// the kit build output. The dataset is what the preview page, tests and the
// strict dist build consume — this script is the only writer.
//
// Inputs:  kit/out/temple-shanmen/{temple,ground,lions,ornaments}.glb + the
//          builder sidecars (measurements/collision), plus the lead camera
//          contract ../CAMERAS.json (falls back to the dataset's own copy so
//          reruns stay idempotent after the outbox task dir is gone).
// Output:  world/temple-shanmen/{temple.glb,ground.glb,lions.glb,ornaments.glb,
//          cameras.json,review-manifest.json,collision-world.json}
//
// Run: node scripts/build_temple_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/temple-shanmen');
const OUT = resolve(root, 'world/temple-shanmen');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const measure = JSON.parse(await readFile(resolve(KIT, 'measurements.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));

// --- cameras: the lead contract is the source of truth; the dataset keeps a
// verbatim copy (same ids/fovs/poses) so the repo stays self-contained ------
let camSource = 'task CAMERAS.json';
let cameras;
try {
  cameras = JSON.parse(await readFile(resolve(root, '../CAMERAS.json'), 'utf8'));
} catch {
  cameras = JSON.parse(await readFile(resolve(OUT, 'cameras.json'), 'utf8'));
  camSource = 'existing dataset cameras.json (task dir gone — idempotent rerun)';
}
await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n', 'utf8');

// --- GLBs, copied byte-exact; hashes recomputed from the copied bytes ------
const assets = {};
for (const id of ['temple', 'ground', 'lions', 'ornaments']) {
  const file = `${id}.glb`;
  await copyFile(resolve(KIT, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  const m = measure.targets[file];
  if (m.fileBytes !== bytes.byteLength || m.sha256 !== sha(bytes))
    throw new Error(`dataset assembly: ${file} drifted from kit measurements (rebuild the kit first)`);
  assets[id] = {
    file: `./world/temple-shanmen/${file}`,
    bytes: bytes.byteLength,
    sha256: sha(bytes),
    triangles: m.triangles,
    groups: m.groups,
  };
}

// --- collision-world.json: world-space adapter records, grouped by asset ----
const groups = collision.groups;
const world = {
  axis: 'glTF Y-up; +Z front; origin central-threshold-front; temple at identity',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'temple-shanmen',
  clearCorridor: collision.clearCorridor,
  corridorVerifiedEmpty: collision.corridorVerifiedEmpty,
  colliders: collision.colliders.map((c) => ({
    name: c.name,
    group: c.group,
    type: 'box',
    min: c.min,
    max: c.max,
    obb: c.obb,
  })),
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n', 'utf8');

// --- review manifest --------------------------------------------------------
const manifest = {
  datasetId: 'temple-shanmen',
  title: '城隍庙山门＋短前庭 · 独立样板',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  reference: measure.design.reference,
  axis: measure.axis,
  assets,
  budgets: measure.budgets,
  passage: {
    clearOpeningM: measure.design.clearOpeningM,
    corridor: collision.clearCorridor,
    doorLeaves: 'open, folded flat against the side bays (solid collision, outside the corridor)',
  },
  cameras: {
    count: cameras.cameras.length,
    source: `lead designed review cameras (${camSource})`,
    contract: 'positionGlb/targetGlb/verticalFovDegrees applied verbatim; page verifies pose after controls.update()',
  },
  groundPolicy: 'visible forecourt + passage paving IS the physics ground (temple-ground__ nodes); no invisible plane',
  buildChain: 'kit/build_temple_shanmen.py <- kit/temple-shanmen.config.json <- DESIGN_SPEC.json (lead design values)',
  generatedBy: 'scripts/build_temple_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const tri = Object.values(assets).reduce((s, a) => s + a.triangles, 0);
const byt = Object.values(assets).reduce((s, a) => s + a.bytes, 0);
console.log(`TEMPLE_DATASET_READY colliders=${world.colliders.length} tris=${tri} bytes=${byt} cameras=${cameras.cameras.length} (${camSource})`);
