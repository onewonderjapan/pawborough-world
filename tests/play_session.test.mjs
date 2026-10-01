// Play-phase 1 session continuity, driven against the REAL WalkController and
// the real reviewed world with the play capsule. The decisions under test live
// in scene-authoring/yuyuan-area/web/play/session.js (DOM-free); the page just
// applies them.
//
// Contract (GOAL.md 生命周期):
//   - the FIRST play entry spawns; every later enter/exit round-trip restores
//     the captured feet + yaw — a mode switch is never a new game
//   - pause/blur clears keys, never moves the capsule, and resume produces no
//     dt-spike jump; a huge dt while active stays bounded by the fixed-step cap
//   - only an EXPLICIT relocation (回到锚点) moves the spawn position
//
// Run: node tests/play_session.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';
import { PlaySession } from '../scene-authoring/yuyuan-area/web/play/session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sameFeet = (a, b, eps = 1e-4) => close(a[0], b[0], eps) && close(a[1], b[1], 5e-3) && close(a[2], b[2], eps);

await RAPIER.init();
const [manifest, collision] = await Promise.all([
  readFile(resolve(root, 'world/review-manifest.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'world/collision-world.json'), 'utf8').then(JSON.parse),
]);
const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const groundTriangles = collectGroundTriangles(glb.meshes);
const SPAWN = [20, 1.2, -4];
const PLAY_CAPSULE = { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, speed: 1.5, spawn: SPAWN };

function makeController(physics) {
  return new WalkController({ RAPIER, physics, capsule: { ...PLAY_CAPSULE } });
}
function walkSeconds(c, seconds) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    c.setMoveInput(1, 0); // hold W the way the page does every frame
    c.step(dt);
  }
}

// --- first entry spawns, later entries restore the captured pose
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const session = new PlaySession();
  const c = makeController(physics);

  const first = session.begin(c, { spawnFeet: SPAWN });
  check('first entry spawns at the given feet', first?.spawned === true && sameFeet(c.feetPosition(), SPAWN),
    JSON.stringify(first));
  walkSeconds(c, 1.0);
  const walked = c.feetPosition();
  const walkedYaw = c.yaw;
  c.look(0, 0); c.yaw = 1.2; // turned while walking
  const endPose = session.end(c);
  check('exit captures where the player actually stands (not the spawn)',
    endPose && !sameFeet(endPose.feet, SPAWN, 0.2), `feet=${endPose?.feet.map(v => v.toFixed(2))}`);
  check('exit cleared keys', c.input.forward === 0 && c.input.right === 0 && !c.input.jump);

  const second = session.begin(c, { spawnFeet: SPAWN });
  check('re-entry restores the captured pose, NOT the spawn',
    second?.restored === true && second?.spawned === false && sameFeet(c.feetPosition(), endPose.feet) && close(c.yaw, 1.2),
    `feet=${c.feetPosition().map(v => v.toFixed(2))} yaw=${c.yaw.toFixed(3)} walked=${walked.map(v => v.toFixed(2))} walkedYaw=${walkedYaw}`);
  physics.dispose();
}

// --- pause/blur: keys cleared, capsule frozen even if input keeps arriving
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const session = new PlaySession();
  const c = makeController(physics);
  session.begin(c, { spawnFeet: SPAWN });
  walkSeconds(c, 0.4);
  const atPause = c.feetPosition();

  const paused = session.pause(c, 'blur');
  check('blur pause changed state and cleared keys',
    paused?.changed === true && session.paused && c.input.forward === 0 && c.input.right === 0 && !c.input.jump);
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) { c.setMoveInput(1, 0); c.step(dt); } // re-fed input while paused
  check('paused capsule does not move despite held input', sameFeet(c.feetPosition(), atPause),
    `delta=${Math.hypot(...c.feetPosition().map((v, i) => v - atPause[i])).toExponential(1)}`);

  const resumed = session.resume(c);
  check('resume restarts from clean input', resumed?.changed === true && !session.paused
    && c.input.forward === 0 && c.input.right === 0);
  const atResume = c.feetPosition();
  for (let i = 0; i < 30; i++) c.step(dt); // resume with NO new input stays put
  const now = c.feetPosition();
  check('resume without input does not drift',
    Math.hypot(now[0] - atResume[0], now[2] - atResume[2]) < 1e-4,
    `drift=${Math.hypot(now[0] - atResume[0], now[2] - atResume[2]).toExponential(1)}`);

  // paused + a wall-clock dt spike (tab was hidden for "10 s") must be a no-op
  session.pause(c, 'blur');
  const beforeSpike = c.feetPosition();
  c.step(10.0);
  check('huge dt while paused does not move the capsule', sameFeet(c.feetPosition(), beforeSpike));
  session.resume(c);
  physics.dispose();
}

// --- active huge dt is bounded by the fixed-step cap (no jump through walls)
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const session = new PlaySession();
  const c = makeController(physics);
  session.begin(c, { spawnFeet: SPAWN });
  const before = c.feetPosition();
  c.setMoveInput(1, 0);
  c.step(10.0); // one frame claiming 10 seconds
  const after = c.feetPosition();
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  const capped = 1.5 * 0.25 * 8; // dt clamp 0.25 s x max 8 fixed steps
  check('active dt spike moves at most the fixed-step cap', moved <= capped + 0.02,
    `moved=${moved.toFixed(3)}m cap=${capped.toFixed(3)}m`);
  physics.dispose();
}

// --- explicit relocation (回到锚点) is the ONLY thing that moves the spawn
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const session = new PlaySession();
  const c = makeController(physics);
  session.begin(c, { spawnFeet: SPAWN });
  walkSeconds(c, 0.5);
  const away = c.feetPosition();

  const anchorFeet = [22, 0.02, -4];
  const rel = session.relocate(c, anchorFeet, 0.5);
  check('explicit relocation teleports to the anchor', rel?.ok === true && sameFeet(c.feetPosition(), anchorFeet),
    `feet=${c.feetPosition().map(v => v.toFixed(2))}`);
  check('relocation recorded as explicit, never as walking evidence',
    session.relocations.length === 1 && session.relocations[0].explicit === true
    && close(session.relocations[0].feet[0], anchorFeet[0]));

  session.end(c);
  session.begin(c, { spawnFeet: SPAWN });
  check('after explicit relocation, re-entry restores the ANCHOR pose (new spawn)',
    sameFeet(c.feetPosition(), anchorFeet) && close(c.yaw, 0.5),
    `feet=${c.feetPosition().map(v => v.toFixed(2))} yaw=${c.yaw.toFixed(2)} away=${away.map(v => v.toFixed(2))}`);
  check('away-from-anchor walking never polluted the relocation log',
    session.relocations.length === 1);
  physics.dispose();
}

// --- session guards: pause/resume outside play mode are no-ops; snapshot is a copy
{
  const session = new PlaySession();
  check('pause before any play entry is a no-op', session.pause(null, 'blur')?.changed === false);
  // produce a pose, then prove snapshot() deep-copies it
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c = makeController(physics);
  session.begin(c, { spawnFeet: SPAWN });
  session.end(c);
  const snap = session.snapshot();
  snap.pose.feet[0] = 999;
  check('snapshot deep-copies the pose', session.snapshot().pose?.feet[0] !== 999);
  physics.dispose();
}

console.log(failures === 0 ? 'PLAY_SESSION PASS' : `PLAY_SESSION FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
