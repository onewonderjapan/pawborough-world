// Temple ENTRY-GROUP passage tests — REAL Rapier, the REAL assembled dataset
// (shanmen at origin + yimen at (0,0,-21) + walled court), ground trimesh from
// the VISIBLE paving/hall-floor meshes of BOTH ground sources, walls from the
// world-space collision records, driven through the same WalkController a
// human uses in the preview page.
//
// Route (world/temple-entry/route.json):
//   front approach (z+5) -> through the shanmen (3.0m clear) -> court ->
//   through the yimen (3.6m clear, 12mm threshold) -> rear landing (z-27.3)
//   -> turn and return to the street side.
// Negatives: court side wall; south return; yimen lattice bay; no ground
// beyond the landing cutoff or outside the court side walls.
//
// Run: node tests/temple_entry_passage.test.mjs   (exit 0 = route holds)
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
const DS = resolve(root, 'world/temple-entry');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));

// ground trimesh from the VISIBLE meshes of both ground sources (no plane)
const groundMeshes = [];
for (const file of ['ground.glb', 'court.glb']) {
  const glb = readGlb(await readFile(resolve(DS, file)));
  const hits = glb.meshes.filter((m) => GROUND_NODE_RE.test(m.name));
  check(`ground faces from ${file} qualify for the physics ground`, hits.length >= 1,
    hits.map((m) => m.name).join(','));
  groundMeshes.push(...hits.map((m) => ({
    name: m.name, positions: m.positions,
    indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
    matrix: m.matrix,
  })));
}
const gt = collectGroundTriangles(groundMeshes);
check('ground triangle count sane (court + shanmen paving)', gt.triangleCount > 40, `${gt.triangleCount}`);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const mk = (x, z) => new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });

// --- 1. positive: the whole JSON route, forward then back -------------------
{
  const c = mk(0, 5);
  const dt = 1 / 60;
  c.yaw = 0;
  const marks = [];
  let groundedMisses = 0, checks = 0;
  const GATES = [
    { name: 'shanmen-mid', z: -1.8 }, { name: 'shanmen-exit', z: -3.8 },
    { name: 'court-mid', z: -12 }, { name: 'yimen-door', z: -21 },
    { name: 'yimen-exit', z: -26.8 }, { name: 'landing', z: -27.3 },
  ];
  let gi = 0;
  for (let i = 0; i < Math.round(30 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const [x, , z] = c.feetPosition();
    checks++;
    if (z > -0.5 && !c.isGrounded()) groundedMisses++;
    while (gi < GATES.length && z <= GATES[gi].z) {
      marks.push({ gate: GATES[gi].name, x, z, grounded: c.isGrounded() });
      gi++;
    }
    if (z <= -27.3) break;
  }
  check('route: capsule reaches the rear landing waypoint (z=-27.3)',
    marks.some((m) => m.gate === 'landing'), `marks: ${marks.map((m) => m.gate).join('>') || 'none'}`);
  check('route: grounded through every gate (shanmen/court/yimen/landing)',
    GATES.every((g) => marks.find((m) => m.gate === g.name && m.grounded)),
    marks.map((m) => `${m.gate}:${m.grounded ? 'g' : 'AIR'}`).join(' '));
  check('route: lateral drift on the axis < 0.5m through both gates',
    marks.filter((m) => m.gate !== 'landing').every((m) => Math.abs(m.x) < 0.5),
    marks.map((m) => `${m.gate}:x=${m.x.toFixed(2)}`).join(' '));

  // return leg: turn around at the landing, walk back to the street side
  c.yaw = Math.PI; // facing +Z
  let backZ = null;
  for (let i = 0; i < Math.round(40 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const [, , z] = c.feetPosition();
    if (z > 4.0) { backZ = z; break; }
  }
  check('route: return leg crosses both gates back to the street (z>+4)',
    backZ !== null, backZ === null ? 'did not return in 40s of walking' : `z=${backZ.toFixed(2)}`);
  c.dispose();
}

// --- 2. negative: court side wall blocks +X at mid-court --------------------
{
  const c = mk(5, -12);
  c.yaw = -Math.PI / 2; // face +X
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [x] = c.feetPosition();
  check('negative: court side wall stops +X walk (x stays < 8.1)', x < 8.1, `x=${x.toFixed(2)}`);
  c.dispose();
}

// --- 3. negative: south return closes the corner behind the shanmen --------
// approach from INSIDE the court, heading +Z at x=-5: the return wall on the
// z=-3.6 line must stop the capsule (the shanmen passage is the only opening)
{
  const c = mk(-5, -6.0);
  c.yaw = Math.PI; // face +Z
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [, , z] = c.feetPosition();
  check('negative: south return blocks the court corner (z stays < -3.4)', z < -3.4, `z=${z.toFixed(2)}`);
  c.dispose();
}

// --- 4. negative: yimen lattice bays are solid closed doors ----------------
{
  const c = mk(4.2, -19.0);
  c.yaw = 0;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [, , z] = c.feetPosition();
  check('negative: yimen lattice bay blocks the walk at the facade (z > -21.3)', z > -21.3, `z=${z.toFixed(2)}`);
  c.dispose();
}

// --- 5. negative: no ground beyond the cutoff / outside the court ----------
{
  const c = mk(0, -27.6);
  c.yaw = 0; // face -Z toward the cutoff wall
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [, , z] = c.feetPosition();
  check('negative: cutoff wall stops the walk at the landing end (z > -29.0)', z > -29.0, `z=${z.toFixed(2)}`);
  // beyond the wall spans void: spawn past it on NO ground -> falls immediately
  const v = mk(0, -30.5);
  for (let i = 0; i < Math.round(2 / dt); i++) { v.step(dt); }
  const [, vy] = v.feetPosition();
  check('negative: beyond the cutoff wall there is no ground (capsule falls)', vy < -1.0, `y=${vy.toFixed(2)}`);
  v.dispose(); c.dispose();
}
{
  const c = mk(9.5, -12); // outside the court side wall x=8.28 — no ground
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(2 / dt); i++) c.step(dt);
  const [, y] = c.feetPosition();
  check('negative: outside the court side wall there is no ground (falls)', y < -1.0, `y=${y.toFixed(2)}`);
  c.dispose();
}

// --- 6. yimen instance collision records are world-space correct -----------
{
  const jambs = collision.colliders.filter((c) => /yimen:door-jamb/.test(c.name));
  check('yimen door jambs present in world records', jambs.length === 2, `${jambs.length}`);
  const okZ = jambs.every((c) => c.min[2] < -21 && c.max[2] > -26);
  check('yimen jamb boxes span world z -21..-26.2 (instance origin applied)', okZ,
    jambs.map((c) => `z ${c.min[2].toFixed(1)}..${c.max[2].toFixed(1)}`).join(' | '));
}

console.log(failures === 0 ? 'ENTRY_PASSAGE_PASS' : `ENTRY_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
