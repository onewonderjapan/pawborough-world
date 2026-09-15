// Temple pilot passage tests — REAL Rapier, REAL dataset collision records,
// REAL ground faces from the exported ground.glb, driven through the SAME
// WalkController input chain a human uses in the browser page.
//
// Positive: capsule walks the approach axis through the 3.0m opening, grounded
// on the passage floor, exits past the rear wall.
// Negatives: (a) off-axis run is stopped by the reveal wall/column line;
// (b) the folded lattice door leaf is solid; (c) walking off the court edge
// drops the capsule — no invisible world plane anywhere.
//
// Run: node tests/temple_shanmen_passage.test.mjs   (exit 0 = passage holds)
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
const DS = resolve(root, 'world/temple-shanmen');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));

// ground trimesh from the exported ground.glb faces (same node rule as the page)
const glb = readGlb(await readFile(resolve(DS, 'ground.glb')));
const groundMeshes = glb.meshes.filter((m) => GROUND_NODE_RE.test(m.name));
check('ground faces qualify for the physics ground', groundMeshes.length >= 2,
  groundMeshes.map((m) => m.name).join(','));
const groundTriangles = collectGroundTriangles(groundMeshes);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, groundTriangles);

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const mk = (x, z) => new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });

// --- 1. positive: through the opening on the axis ---------------------------
{
  const c = mk(0, 6.5);
  let midGrounded = null, exitZ = null;
  const dt = 1 / 60;
  c.yaw = 0; // facing -Z, straight at the gate
  for (let i = 0; i < Math.round(10 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const [, , z] = c.feetPosition();
    if (midGrounded === null && z < -1.8 && z > -2.4) midGrounded = c.isGrounded();
    if (z < -4.2) { exitZ = z; break; }
  }
  const [x] = c.feetPosition();
  check('positive: capsule crosses the gate to z<-4.2', exitZ !== null, `exit z=${exitZ?.toFixed(3)}`);
  check('positive: lateral drift < 0.45m', Math.abs(x) < 0.45, `x=${x.toFixed(3)}`);
  check('positive: grounded on the passage floor at mid-door', midGrounded === true);
  c.dispose();
}

// --- 2. negative: 0.7m off-axis is stopped by the reveal wall ---------------
{
  const c = mk(-1.6, 6.5);
  c.yaw = 0;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(8 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [, , z] = c.feetPosition();
  check('negative: off-axis run blocked before the passage', z > -0.5, `stopped at z=${z.toFixed(3)}`);
  c.dispose();
}

// --- 3. negative: the folded lattice door leaf is solid collision -----------
{
  const leaf = collision.colliders.filter((c) => /lattice-door-leaf/.test(c.name));
  check('collision records include the door leaves', leaf.length === 2, `${leaf.length}`);
  const c = mk(2.25, 2.5);
  c.yaw = 0;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [, , z] = c.feetPosition();
  check('negative: door leaf blocks the walk', z > 0.05, `stopped at z=${z.toFixed(3)}`);
  c.dispose();
}

// --- 4. negative: no invisible plane — stepping off the court falls ---------
{
  const c = mk(0, 3.0);
  c.yaw = -Math.PI / 2; // face +X, off the court's east edge (court ends at x=9)
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(9 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [x, y] = c.feetPosition();
  check('negative: capsule falls off the court edge (no invisible slab)', y < -1.0, `x=${x.toFixed(2)} y=${y.toFixed(2)}`);
  c.dispose();
}

// --- 5. wing walls collide as oriented boxes (not yaw-expanded AABBs) -------
{
  const wings = collision.colliders.filter((c) => /wing-wall-body/.test(c.name));
  check('both wing walls carry yaw OBB records', wings.length === 2,
    wings.map((w) => `${w.name}@${w.obb.theta.toFixed(3)}`).join(', '));
  // self-consistency: obbToWorld must reproduce each record's own AABB
  for (const w of wings) {
    const { pos, theta, center, size } = w.obb;
    const c = Math.cos(theta), s = Math.sin(theta);
    const wx = pos[0] + c * center[0] + s * center[2];
    const wz = pos[2] - s * center[0] + c * center[2];
    const reach = [size[0] * Math.abs(c) + size[2] * Math.abs(s), size[1], size[0] * Math.abs(s) + size[2] * Math.abs(c)];
    const lo = [wx - reach[0] / 2, w.min[1], wz - reach[2] / 2], hi = [wx + reach[0] / 2, w.max[1], wz + reach[2] / 2];
    const ok = lo.every((v, i) => Math.abs(v - w.min[i]) < 1e-3) && hi.every((v, i) => Math.abs(v - w.max[i]) < 1e-3);
    check(`wing record self-consistent (${w.name})`, ok);
  }
  // capsule approaching the LEFT wing from inside the court: the wall must
  // stop the through-direction (the controller then slides ALONG the diagonal
  // face — legal). Pass = the capsule never crosses the wall line at its own z
  // during the whole walk, and it actually made contact (moved < full distance)
  const c = mk(-4.5, 1.2);
  c.yaw = Math.PI / 2; // face -X
  const dt = 1 / 60;
  const wallX = (z) => -3.35 - 4.65 * (z - 0.15) / 2.0;
  const inWallSpan = (z) => z > 0.05 && z < 2.3; // the wall segment only — no infinite-line extrapolation
  let minGap = 1e9, crossed = false, finalX = null, finalZ = null;
  for (let i = 0; i < Math.round(6 / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const [x, y, z] = c.feetPosition();
    finalX = x; finalZ = z;
    if (y < -1) break; // slid past the wall end and off the court — legal end state
    if (!inWallSpan(z)) continue;
    minGap = Math.min(minGap, x - (wallX(z) + 0.16));
    if (x < wallX(z) - 0.05) { crossed = true; break; }
  }
  check('negative: wing wall blocks through-passage (slide along the face is legal)',
    !crossed && minGap <= 1.45,
    `stopped x=${finalX?.toFixed(2)} z=${finalZ?.toFixed(2)}, closest horizontal approach to the face ${minGap.toFixed(3)}m (contact band ≈ (0.35r+0.16t)·√(1+2.325²) ≈ 1.29m in x units)`);
  c.dispose();
}

console.log(failures === 0 ? 'TEMPLE_PASSAGE_PASS' : `TEMPLE_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
