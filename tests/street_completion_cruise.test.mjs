// Street-completion S3 physical cruise — REAL Rapier, REAL ground faces
// (assembly GLB + the derived tail surface), REAL asset collision sidecars.
// Positive: the capsule cruises entries.west -> entries.sctailEnd and back
// through the SAME WalkController input chain as a human (CruiseDriver), with
// feet settling on the tail pavement at every sampled station.
// Negatives: facade wall stops the capsule, a closed shop door blocks it, and
// stepping off the tail band drops the capsule — proving no invisible slab
// under the tail. This is an AUTO cruise (driver log), never a manual walk.
//
// Run: node tests/street_completion_cruise.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { validateWorldInputs, GROUND_NODE_RE } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld, addWallCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { CruiseDriver } from '../src/player/cruise.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const [manifest, instances, collision, route, blocks] = await Promise.all([
  'review-manifest.json', 'instances.json', 'collision-world.json', 'route.json', 'blocks.json',
].map((p) => readFile(resolve(root, 'world/street-completion', p), 'utf8').then(JSON.parse)));
validateWorldInputs({ manifest, instances, collision, route, blocks });

// ground = frozen assembly faces + the derived tail surface faces
const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const surface = readGlb(await readFile(resolve(root, 'world/street-completion/surface.glb')));
const groundMeshes = [...glb.meshes, ...surface.meshes].filter((m) => GROUND_NODE_RE.test(m.name));
check('tail surface faces qualify as ground', surface.meshes.filter((m) => GROUND_NODE_RE.test(m.name)).length === 2,
  groundMeshes.map((m) => m.name).join(','));
const groundTriangles = collectGroundTriangles(groundMeshes);
check('combined ground trimesh non-empty', groundTriangles.triangleCount > glb.totalTriangles * 0.0001,
  `${groundTriangles.triangleCount} tris`);

const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });

// the six refined buildings contribute their real wall colliders (same
// addWallCollider path blockViews uses for assets)
const sidecars = await Promise.all(manifest.streetCompletion.assets.map((a) =>
  readFile(resolve(root, 'world/street-completion', a.id, 'collision.json'), 'utf8').then(JSON.parse)));
let wallCount = 0;
for (const sc of sidecars) for (const rec of sc.colliders) { addWallCollider(RAPIER, physics.world, rec); wallCount += 1; }
check('six asset sidecars contribute wall colliders', wallCount > 20, `${wallCount} colliders`);

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
function makeController(x, z, y = 1.0) {
  return new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [x, y, z] } });
}
const step = (controller, seconds, drive) => {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) { if (drive) drive(); controller.step(dt); }
};
const feet = (c) => c.feetPosition();

// --- 1. positive: full auto cruise west -> tail end -> west -----------------
const mainStreet = route.mainStreet;
check('route extended east of the frozen entry', mainStreet[mainStreet.length - 1][0] > route.entries.east[0] + 30,
  `last waypoint x=${mainStreet[mainStreet.length - 1][0]}`);
{
  const c = makeController(...mainStreet[0]);
  const driver = new CruiseDriver({ controller: c, waypoints: mainStreet, reachRadius: 1.2 });
  const dt = 1 / 60;
  let guard = 60 * 240;
  while (!driver.done && guard-- > 0) { driver.tick(dt); c.step(dt); }
  const end = mainStreet[mainStreet.length - 1];
  const [fx, fy, fz] = feet(c);
  check('auto cruise reaches the tail end', driver.done && Math.hypot(fx - end[0], fz - end[2]) < 2.0,
    `stop=(${fx.toFixed(1)},${fz.toFixed(1)}) target=(${end[0].toFixed(1)},${end[2].toFixed(1)}) blocked=${JSON.stringify(driver.blocked)}`);
  check('capsule stands ON the tail pavement (no sink, no fall)', fy > -0.1 && fy < 0.45, `feet y=${fy.toFixed(3)}`);
  check('cruise marked as auto (driver log present)', driver.log.length > 10, `${driver.log.length} waypoints logged`);

  const back = new CruiseDriver({ controller: c, waypoints: [...mainStreet].reverse(), reachRadius: 1.2 });
  guard = 60 * 240;
  while (!back.done && guard-- > 0) { back.tick(dt); c.step(dt); }
  const w0 = mainStreet[0];
  const [rx, , rz] = feet(c);
  check('auto cruise returns west (round trip)', back.done && Math.hypot(rx - w0[0], rz - w0[2]) < 2.5,
    `stop=(${rx.toFixed(1)},${rz.toFixed(1)}) target=(${w0[0].toFixed(1)},${w0[2].toFixed(1)})`);
}

// --- 2. feet settle on real pavement along the whole band --------------------
{
  let settled = 0;
  for (const x of [90, 95, 100, 105, 110, 115, 120, 124]) {
    const st = mainStreet.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best), mainStreet[0]);
    const c = makeController(st[0], st[2], 0.8);
    step(c, 2.0);
    const [, fy] = feet(c);
    if (fy > -0.05 && fy < 0.4) settled += 1;
  }
  check('capsule settles on pavement at all 8 tail stations', settled === 8, `${settled}/8`);
}

// --- 3/4. negative: solid facade + closed door stop the capsule -------------
// (targets use the collider's WORLD AABB center; obb.pos is the asset origin)
const worldCenter = (rec) => [
  (rec.min[0] + rec.max[0]) / 2, (rec.min[1] + rec.max[1]) / 2, (rec.min[2] + rec.max[2]) / 2];

function outwardNormal(rec) {
  // facade (+z local) for front walls; gable face (+x local, westOnLocalX=+1
  // on this building) for gable doors — rotated by the asset yaw
  const th = rec.obb.theta;
  return /front-wall/.test(rec.name) ? [Math.sin(th), Math.cos(th)] : [Math.cos(th), -Math.sin(th)];
}

function walkInto(sc, rec, label) {
  const [tx, ty, tz] = worldCenter(rec);
  const [nx, nz] = outwardNormal(rec);
  const sx = tx + nx * 1.2, sz = tz + nz * 1.2;
  const c = makeController(sx, sz, 0.6);
  const start = feet(c);
  step(c, 2.5, () => { c.yaw = Math.atan2(-(tx - start[0]), -(tz - start[2])); c.setMoveInput(1, 0); });
  const f = feet(c);
  const advanced = Math.hypot(f[0] - start[0], f[2] - start[2]);
  const remaining = Math.hypot(f[0] - tx, f[2] - tz);
  check(`${label} stops the capsule`, advanced < 1.0 && remaining > 0.3,
    `advanced ${advanced.toFixed(2)}m, ${remaining.toFixed(2)}m still short of the collider`);
}

{
  const sc = sidecars.find((s) => s.assetId === 'east-shop-130');
  // the widest z-thin band = solid front-wall pier between the door and display
  const pier = sc.colliders
    .filter((c) => /front-wall/.test(c.name) && (c.max[0] - c.min[0]) > 1.0)
    .sort((a, b) => (b.max[0] - b.min[0]) - (a.max[0] - a.min[0]))[0];
  check('130 solid pier collider found', Boolean(pier), pier?.name ?? 'none');
  if (pier) walkInto(sc, pier, '130 facade pier');
}
{
  const sc = sidecars.find((s) => s.assetId === 'east-shop-131');
  const door = sc.colliders.find((c) => /gable-door|side-door/i.test(c.name)) ?? sc.colliders.find((c) => /door/i.test(c.name));
  check('131 closed door collider exists in the sidecar', Boolean(door), door?.name ?? 'none');
  if (door) walkInto(sc, door, '131 closed door');
}

// --- 5. negative: off the tail band there is NO floor (no invisible slab) ---
{
  const c = makeController(86.0, 24.6, 0.5);   // north of the wedge road end, clear of buildings
  step(c, 2.0);
  const [, fy] = feet(c);
  check('capsule falls off the band edge (no synthetic plane)', fy < -1.5, `feet y after 2s = ${fy.toFixed(2)}`);
}

console.log(failures === 0 ? 'STREET_COMPLETION_CRUISE PASS' : `STREET_COMPLETION_CRUISE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
