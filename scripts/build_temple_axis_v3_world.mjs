// Assemble the temple AXIS V3 dataset (world/temple-axis-v3/) — the corridor
// refinement batch: temple-axis-v2 frozen assets with THREE variant swaps
// (lions-v2 / ornaments-v2 square lattice windows / entry-court-v3 = court-open
// + incense road + bronze burner) PLUS the camphor tree instanced 4x, the
// burner detour on the forecourt route and the burner negative.
//
// The only writer of world/temple-axis-v3/. Frozen files are copied byte-exact
// and hash-checked; the v2 dataset itself is never touched.
//
// Run: node scripts/build_temple_axis_v3_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/temple-axis-v3');
const V2 = resolve(root, 'world/temple-axis-v2');
const SHANMEN_V2_KIT = resolve(root, 'kit/out/shanmen-v2-assets');
const V3_KIT = resolve(root, 'kit/out/temple-axis-v3-assets');
const TREE_KIT = resolve(root, 'kit/out/tree-camphor');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const HALF_PI = 1.5707963267948966;

await mkdir(OUT, { recursive: true });

// --- obb -> world AABB (same math as src/world/collisionAdapter.obbToWorld) --
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

// --- cameras (frozen 10-camera contract from v2) ------------------------------
const cameras = JSON.parse(await readFile(resolve(V2, 'cameras.json'), 'utf8'));
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n', 'utf8');

// --- route geometry (needed before tree placement) ------------------------------
const v2Route = JSON.parse(await readFile(resolve(V2, 'route.json'), 'utf8'));
const specPts = v2Route.spec.templeLocal.map(([x, z]) => [x, z]);
{
  const i = specPts.findIndex((p) => p[0] === 0 && p[1] === -10);
  if (i > -1) specPts.splice(i + 1, 0, [-2.0, -10.5], [-2.0, -13.5], [0, -14]);
}
let full = specPts.map(([x, z]) => [x, 0, z]);
{
  const i = full.findIndex((p) => p[0] === 6 && p[2] === -40.2);
  if (i > -1) full.splice(i, 0, [0, 0, -38.6], [6, 0, -38.6]);
}
{
  const out2 = [full[0]];
  for (let k = 1; k < full.length; k++) {
    const a = out2[out2.length - 1], b = full[k];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / 6));
    for (let j = 1; j <= n; j++)
      out2.push([a[0] + (b[0] - a[0]) * j / n, 0, a[2] + (b[2] - a[2]) * j / n]);
  }
  full = out2;
}

// --- tree placements vs the route corridor (fallback #2: shift <= 1.0 m away) --
const distToRoute = (pts, x, z) => {
  let best = 1e9, bx = 0, bz = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, , az] = pts[k - 1], [bx2, , bz2] = pts[k];
    const dx = bx2 - ax, dz = bz2 - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return { d: best, nx: bx, nz: bz };
};
const TREE_POS = {
  'tree-court2-w': [-7.2, 0, -37.6],
  'tree-court2-e': [7.2, 0, -37.6],
  'tree-court3-w': [-10.5, 0, -64.0],
  'tree-court3-e': [10.5, 0, -64.0],
};
const placementShifts = [];
const droppedTrees = [];
for (const [id, pos] of Object.entries(TREE_POS)) {
  const { d, nx, nz } = distToRoute(full, pos[0], pos[2]);
  if (d < 1.75) {
    const need = Math.min(1.0, 1.8 - d);
    const len = Math.hypot(pos[0] - nx, pos[2] - nz) || 1;
    pos[0] += ((pos[0] - nx) / len) * need;
    pos[2] += ((pos[2] - nz) / len) * need;
    const after = distToRoute(full, pos[0], pos[2]).d;
    if (after < 1.75) { droppedTrees.push(id); delete TREE_POS[id]; continue; }
    placementShifts.push({ tree: id, shiftedBy: +need.toFixed(3),
      newDistanceToRoute: +after.toFixed(3),
      reason: 'spec position inside the +/-1.5 route corridor (dist '
        + d.toFixed(2) + ' m); fallback #2 away-shift' });
  }
}

// --- instances ------------------------------------------------------------------
const v2Instances = JSON.parse(await readFile(resolve(V2, 'instances.json'), 'utf8'));
const instances = {
  axis: v2Instances.axis,
  instances: [
    ...v2Instances.instances.map((i) => i.id === 'entrycourt'
      ? { ...i, module: 'temple-entry-court-v3', note: 'VARIANT: court-open + incense road + bronze burner' }
      : i),
    ...Object.entries(TREE_POS).map(([id, positionGlb]) => ({
      id, module: 'temple-tree-camphor', positionGlb, rotationYRad: 0,
      note: 'D3 camphor tree, design_inference (position/spec values)',
    })),
  ],
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n', 'utf8');

// --- assets -----------------------------------------------------------------------
const assets = {};
const v2Manifest = JSON.parse(await readFile(resolve(V2, 'review-manifest.json'), 'utf8'));
const copyFrozenFromV2 = async (id) => {
  const src = v2Manifest.assets[id];
  const file = src.file.split('/').pop();
  await copyFile(resolve(V2, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  if (src.bytes !== bytes.byteLength || src.sha256 !== sha(bytes))
    throw new Error(`axis-v3 assembly: frozen ${file} drifted from temple-axis-v2`);
  assets[id] = { file: `./world/temple-axis-v3/${file}`, bytes: bytes.byteLength,
                 sha256: sha(bytes), triangles: src.triangles, groups: src.groups };
};
for (const id of ['temple', 'ground', 'yimen', 'dadian', 'dadianCourtV2', 'peidian', 'gallery',
  'yimenStage', 'court3', 'houdian']) await copyFrozenFromV2(id);

const copyKit = async (id, kitDir, file, extra = {}) => {
  const m = JSON.parse(await readFile(resolve(kitDir, 'measurements.json'), 'utf8'));
  await copyFile(resolve(kitDir, file), resolve(OUT, file));
  const bytes = await readFile(resolve(OUT, file));
  const t = m.targets[file];
  if (!t || t.fileBytes !== bytes.byteLength || t.sha256 !== sha(bytes))
    throw new Error(`axis-v3 assembly: ${file} drifted from its kit build`);
  assets[id] = { file: `./world/temple-axis-v3/${file}`, bytes: bytes.byteLength,
                 sha256: sha(bytes), triangles: t.triangles, groups: t.groups, ...extra };
};
await copyKit('lionsV2', SHANMEN_V2_KIT, 'lions-v2.glb',
  { variantOf: 'lions', note: 'v2 seated lions (ball LEFT / cub RIGHT), spec <=3500 tris each' });
await copyKit('ornamentsV2', SHANMEN_V2_KIT, 'ornaments-v2.glb',
  { variantOf: 'ornaments', note: 'v2 square lattice windows 1.1x1.1 on the wing walls, design_inference' });
await copyKit('entryCourtV3', V3_KIT, 'entry-court-v3.glb',
  { variantOf: 'courtOpen', note: 'court-open + incense road (temple-ground__worn-stone) + bronze burner' });
await copyKit('tree', TREE_KIT, 'tree-camphor.glb',
  { note: 'single module, 4 instances', instances: 4,
    instancesAt: Object.fromEntries(Object.entries(TREE_POS)) });

// --- collision-world: v2 records MINUS swapped sources PLUS v3 records ---------
const v2Collision = JSON.parse(await readFile(resolve(V2, 'collision-world.json'), 'utf8'));
const shanmenV2Collision = JSON.parse(await readFile(resolve(SHANMEN_V2_KIT, 'collision.json'), 'utf8'));
const courtV3Collision = JSON.parse(await readFile(resolve(V3_KIT, 'collision.json'), 'utf8'));
const treeCollision = JSON.parse(await readFile(resolve(TREE_KIT, 'collision.json'), 'utf8'));

const worldColliders = v2Collision.colliders.filter((c) => {
  if (c.name === 'shanmen:lion-plinth') return false;            // replaced by v2 guard boxes
  if (c.name.startsWith('court:')) return false;                 // replaced by the v3 court
  return true;
});
for (const c of shanmenV2Collision.colliders) {
  if (!c.name.startsWith('lion2-')) continue;                    // the two guard boxes
  worldColliders.push({ ...c, name: `shanmen:${c.name}`, group: `shanmen:shanmen-lion` });
}
for (const c of courtV3Collision.colliders)
  worldColliders.push({ ...c, name: `court:${c.name}`, group: `court:${c.group ?? 'entry-court'}` });
for (const [id, pos] of Object.entries(TREE_POS))
  for (const c of treeCollision.colliders)
    worldColliders.push(compose(pos, 0, { ...c, name: `${id}:${c.name}`, group: `${id}:temple-tree` }));

// tree clearance (D3/D4 contract): trunk box >= 0.6 from any other collider,
// trunk outside the route corridor (|x| band handled after route build below)
const grow = (c, g) => ({
  x0: c.min[0] - g, x1: c.max[0] + g, z0: c.min[2] - g, z1: c.max[2] + g,
});
const overlaps2D = (a, b) => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.z1 <= b.z0 || a.z0 >= b.z1);
const placementAdjust = [];
for (const [id, pos] of Object.entries(TREE_POS)) {
  const mine = worldColliders.find((c) => c.name === `${id}:tree-trunk-block`);
  const mineBand = { x0: mine.min[0], x1: mine.max[0], z0: mine.min[2], z1: mine.max[2] };
  for (const c of worldColliders) {
    if (c.name.startsWith(`${id}:`) || c.name.startsWith('court:incense-road')) continue;
    const other = { x0: c.min[0], x1: c.max[0], z0: c.min[2], z1: c.max[2] };
    if (c.max[1] <= 0.05 || c.min[1] >= 3.0) continue;           // ground slabs / high caps
    if (overlaps2D(mineBand, { x0: other.x0 - 0.6, x1: other.x1 + 0.6, z0: other.z0 - 0.6, z1: other.z1 + 0.6 })) {
      placementAdjust.push({ tree: id, blockedBy: c.name });
    }
  }
}
if (placementAdjust.length > 0) {
  console.error('TREE_CLEARANCE_FAIL', JSON.stringify(placementAdjust));
  process.exit(6);
}

const world = {
  ...v2Collision,
  dataset: 'temple-axis-v3',
  instances: instances.instances,
  variant: 'v3: lions-v2 + wing windows v2 + entry-court-v3 (incense road + burner) + 4 camphor trees; '
    + 'lion collision per spec 0.62x1.35x0.75 (v1 shipped plinth-only records)',
  colliders: worldColliders,
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(world, null, 2) + '\n', 'utf8');

// --- route: v2 + burner detour + burner negative --------------------------------
const negatives = [...v2Route.negatives, {
  spawn: [0, 0, -9.5], walk: 'north',
  assert: '被鼎挡住：鼎碰撞盒前缘 z=-11.45 + 胶囊半径 0.35 → 停在 ≈z=-11.10'
    + '（DESIGN_SPEC 写 -10.9 为近似值，实测口径 -11.3..-10.8；不得穿过鼎）',
}];
const route = {
  ...v2Route,
  source: 'v2 route + DESIGN_SPEC packageD.entryCourtBurner detour (-2.0,-10.5)/(-2.0,-13.5) + burner negative',
  spec: { ...v2Route.spec, templeLocal: specPts },
  mainStreet: full,
  negatives,
};
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n', 'utf8');

// final corridor assert against the SUBDIVIDED polyline (adjustment above used
// the spec polyline; the subdivided one stays within 6 m of it)
{
  const spec = full;
  for (const [id, pos] of Object.entries(TREE_POS)) {
    const d = distToRoute(spec, pos[0], pos[2]).d;
    if (d < 1.75) {
      console.error(`TREE_CORRIDOR_FAIL ${id} dist=${d.toFixed(2)} < 1.75`);
      process.exit(7);
    }
  }
}

// --- review manifest --------------------------------------------------------------
const newTri = assets.lionsV2.triangles + assets.ornamentsV2.triangles
  + assets.entryCourtV3.triangles + assets.tree.triangles;
const placed = Object.values(assets).reduce((s, a) => s + (a.triangles ?? 0), 0)
  + assets.peidian.triangles + assets.gallery.triangles + assets.tree.triangles * 3;
const manifest = {
  datasetId: 'temple-axis-v3',
  title: '城隍庙庙轴线 v3 · 走廊精修变体（狮子v2/方形漏窗v2/前院香道+铜鼎/樟树×4）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  reference: 'DESIGN_SPEC.json pawborough-corridor-video-night-20260919 packageD; 狮子参照 PBR-SH-0003-003/004 只取姿态比例',
  axis: instances.axis,
  assets,
  placedTriangles: placed,
  budgets: {
    newModulesTris: { actual: newTri, limit: 16000 },
    placedTriangles: { actual: placed, limit: 200000 },
    newImages: { actual: 0, limit: 0 },
  },
  variants: {
    lionsV2: 'seated, faceted head, 9 mane curls, ball LEFT / cub RIGHT; collision per spec 0.62x1.35x0.75 (v1 had plinth-only records — recorded in PROGRESS)',
    ornamentsV2: 'square lattice windows 1.1x1.1 covering the v1 relief panel position (frozen temple.glb untouched); design_inference, G13 gate',
    entryCourtV3: 'court-open + incense road (z 0..7, slabs 1.5x0.75 joint 0.02, top +0.01, faces temple-ground__worn-stone) + burner (0,0,-12) scaled 0.85 with spec plinth tiers 1.4x0.22 + 1.05x0.18; collision 1.1x1.3x1.1',
    trees: '4 camphor instances; trunk-collider >= 0.6, canopy bottom >= 3.0, route corridor >= 1.75; G12 gate',
  },
  placementShifts,
  droppedTrees,
  cameras: { count: cameras.cameras.length, source: 'frozen temple-axis-v2 camera contract' },
  buildChain: 'build_temple_shanmen.py(--lionsVersion v2 --windowsVersion v2) + build_entry_court.py(--addIncenseRoad --addBurner) + build_tree.py <- DESIGN_SPEC.json',
  generatedBy: 'scripts/build_temple_axis_v3_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// --- carry verification sidecars from v2 ------------------------------------------
for (const f of ['yimen-roof-surface-samples.json', 'dadian-roof-surface-samples.json',
  'peidian-roof-surface-samples.json', 'houdian-roof-surface-samples.json'])
  await copyFile(resolve(V2, f), resolve(OUT, f));

const tri = manifest.placedTriangles;
const byt = Object.values(assets).reduce((s, a) => s + a.bytes, 0);
console.log(`AXIS_V3_DATASET_READY colliders=${worldColliders.length} tris=${tri} `
  + `bytes=${byt} cameras=${cameras.cameras.length} newTri=${newTri} trees=4`);
