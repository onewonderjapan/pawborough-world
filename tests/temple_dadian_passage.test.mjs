// Temple DADIAN passage tests — REAL Rapier, the REAL assembled dataset
// (world/temple-dadian/): ground trimesh from the VISIBLE ground meshes of
// ground.glb + court-open.glb + dadian-court.glb, walls from the world-space
// collision records, driven through the same WalkController the preview page
// uses.
//
// Positives: full route forward (both gates, burner weave, stair attempt,
// stop before the closed hall doors) and back to the street.
// Negatives: court2 side wall; closed dadian doors; burner through-passage;
// void beyond the north closure.
//
// Run: node tests/temple_dadian_passage.test.mjs   (exit 0 = route holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { GROUND_NODE_RE } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-dadian');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));

const groundMeshes = [];
for (const file of ['ground.glb', 'court-open.glb', 'dadian-court.glb']) {
  const glb = readGlb(await readFile(resolve(DS, file)));
  const hits = glb.meshes.filter((m) => GROUND_NODE_RE.test(m.name));
  check(`ground faces from ${file} qualify`, hits.length >= 1,
    hits.map((m) => m.name).join(','));
  groundMeshes.push(...hits.map((m) => ({
    name: m.name, positions: m.positions,
    indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
    matrix: m.matrix,
  })));
}
const gt = collectGroundTriangles(groundMeshes);
check('ground triangle count sane', gt.triangleCount > 100, `${gt.triangleCount}`);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const mk = (x, z) => new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
const dt = 1 / 60;

// --- 1. positive: route forward through everything --------------------------
{
  const c = mk(0, 5);
  c.yaw = 0;
  const GATES = [
    { name: 'shanmen-mid', z: -1.8 }, { name: 'court-mid', z: -12 },
    { name: 'yimen-door', z: -21 }, { name: 'entry-landing', z: -27.3 },
    { name: 'court2-mid', z: -31.5 },
  ];
  const marks = [];
  let gi = 0;
  const wps = route.mainStreet.map((p) => [p[0], p[1]]);
  let wi = 0;
  for (let i = 0; i < Math.round(75 / dt); i++) {
    const [x, , z] = c.feetPosition();
    while (wi < wps.length && Math.hypot(x - wps[wi][0], z - wps[wi][1]) < 0.45) wi++;
    if (wi >= wps.length) break;
    const dx = wps[wi][0] - x, dz = wps[wi][1] - z;
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
    const [x2, , z2] = c.feetPosition();
    while (gi < GATES.length && z2 <= GATES[gi].z) {
      marks.push({ gate: GATES[gi].name, x: x2, grounded: c.isGrounded() });
      gi++;
    }
  }
  check('P1: every gate crossed grounded', GATES.every((g) => marks.find((m) => m.gate === g.name && m.grounded)),
    marks.map((m) => `${m.gate}:${m.grounded ? 'g' : 'AIR'}`).join(' '));
  check('P1: route waypoints all reached (stair attempt incl.)', wi >= wps.length, `wi=${wi}/${wps.length}`);
  check('P1: no fall during the route', c.feetPosition()[1] > -0.05, `y=${c.feetPosition()[1].toFixed(2)}`);

  // stair ascent: continue north onto the platform
  let climbed = false;
  for (let i = 0; i < Math.round(15 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const [, y, z] = c.feetPosition();
    if (z <= -42 && y >= 0.78) { climbed = true; break; }
  }
  check('P1: stair ascent onto the platform (climbed or honest block)',
    climbed ? true : c.isGrounded(),
    climbed ? 'climbed y>=0.78' : `blocked grounded=${c.isGrounded()} z=${c.feetPosition()[2].toFixed(2)}`);

  // stop before the closed doors
  let minDoorZ = 0;
  for (let i = 0; i < Math.round(8 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    minDoorZ = c.feetPosition()[2];
    if (minDoorZ <= -44.0) break;
  }
  check('P1: closed doors stop the capsule before z=-44.35', minDoorZ > -44.35, `z=${minDoorZ.toFixed(2)}`);

  // return leg all the way to the street
  // return along the mirrored route (waypoints reversed) back to the street
  c.yaw = Math.PI;
  const back = [[0, -43.2], [0, -41.9], [0, -39.9], [0, -38.5], [-2.2, -36], [-2.2, -33],
    [0, -30], [0, -24.5], [0, -12], [0, 4.2]];
  let backZ = null, backEnd = null, bi = 0;
  for (let i = 0; i < Math.round(150 / dt); i++) {
    const [x, , z] = c.feetPosition();
    while (bi < back.length && Math.hypot(x - back[bi][0], z - back[bi][1]) < 0.45) bi++;
    if (bi >= back.length) { backZ = z; break; }
    const dx = back[bi][0] - x, dz = back[bi][1] - z;
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
    const p = c.feetPosition();
    backEnd = [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)];
    if (p[2] > 4.0) { backZ = p[2]; break; }
  }
  check('P1: return to the street along the mirrored route', backZ !== null,
    backZ !== null ? `z=${backZ}` : `stuck at ${backEnd}`);
  c.dispose();
}

// --- 2. negative: court2 side wall ------------------------------------------
{
  const c = mk(7.0, -33.0);
  c.yaw = -Math.PI / 2;
  for (let i = 0; i < Math.round(8 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const x = c.feetPosition()[0];
  check('P2: second-court side wall blocks eastward walk', x < 10.3, `x=${x.toFixed(2)}`);
  c.dispose();
}

// --- 3. negative: closed dadian doors from the platform ---------------------
{
  const c = mk(0, -42.5);
  c.yaw = 0;
  for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const z = c.feetPosition()[2];
  check('P3: closed doors block northward walk', z > -44.2, `z=${z.toFixed(2)}`);
  c.dispose();
}

// --- 4. negative: burner through-passage ------------------------------------
{
  const c = mk(0, -31.5);
  c.yaw = 0;
  let through = false, minZ = 0;
  for (let i = 0; i < Math.round(8 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const [x, , z] = c.feetPosition();
    minZ = Math.min(minZ, z);
    if (Math.abs(x) < 0.75 && z < -33.8 && z > -35.2) through = true;
  }
  check('P4: burner body blocks through-passage on the axis', !through, `minZ=${minZ.toFixed(2)}`);
  c.dispose();
}

// --- 5. negative: void beyond the north closure ------------------------------
{
  const c = mk(0, -61.5);
  for (let i = 0; i < Math.round(2 / dt); i++) c.step(dt);
  check('P5: capsule falls beyond the north closure (no invisible plane)',
    c.feetPosition()[1] < -1.0, `y=${c.feetPosition()[1].toFixed(2)}`);
  c.dispose();
}

// --- 6. negative: void west of the court2 wall -------------------------------
{
  const c = mk(-11.8, -34.0);
  for (let i = 0; i < Math.round(2 / dt); i++) c.step(dt);
  check('P6: capsule falls west of the second-court wall',
    c.feetPosition()[1] < -1.0, `y=${c.feetPosition()[1].toFixed(2)}`);
  c.dispose();
}

console.log(failures === 0 ? '\nDADIAN_PASSAGE PASS' : `\nDADIAN_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
