// Play-phase 1 controller lifecycle: dispose must free the controller's OWN
// rigid body (not just its collider/character controller), stay idempotent,
// and leave the shared physics world fully usable. Play capsule dimensions
// (radius .28 / halfHeight .20 / eyeHeight .80 / speed 1.5) and optional
// autostep must be configurable WITHOUT changing the viewer defaults.
//
// Run: node tests/play_controller_lifecycle.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const [manifest, collision] = await Promise.all([
  readFile(resolve(root, 'world/review-manifest.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'world/collision-world.json'), 'utf8').then(JSON.parse),
]);
const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const groundTriangles = collectGroundTriangles(glb.meshes);
const SPAWN = [20, 1.2, -4];
const VIEWER = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6, spawn: SPAWN };
const PLAY = { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, speed: 1.5, autostep: 0.15, spawn: SPAWN };

const worldCounts = (physics) => ({
  bodies: physics.world.bodies.len(),
  colliders: physics.world.colliders.len(),
});
function runSteps(c, seconds) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) c.step(dt);
}

// --- viewer defaults unchanged (speed/autostep are optional, absent = old values)
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c = new WalkController({ RAPIER, physics, capsule: VIEWER });
  check('default speed stays 2.2 m/s', c.speed === 2.2, `speed=${c.speed}`);
  check('default capsule stays r=0.35 h=0.6 eye=1.6',
    c.radius === 0.35 && c.halfHeight === 0.6 && c.eyeHeight === 1.6);
  c.setMoveInput(1, 0);
  runSteps(c, 0.3);
  const f = c.feetPosition();
  const d = Math.hypot(f[0] - SPAWN[0], f[2] - SPAWN[2]);
  check('default controller still walks at ~2.2 m/s', Math.abs(d - 2.2 * 0.3) < 0.05, `dist=${d.toFixed(3)}m`);
  c.dispose();
  physics.dispose();
}

// --- play dimensions valid: capsule config + play speed effective
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const play = new WalkController({ RAPIER, physics, capsule: PLAY });
  check('play capsule accepted (r=0.28 h=0.2 eye=0.8)',
    play.radius === 0.28 && play.halfHeight === 0.2 && play.eyeHeight === 0.8);
  check('play speed set to 1.5 m/s', play.speed === 1.5, `speed=${play.speed}`);
  play.setMoveInput(1, 0);
  runSteps(play, 0.3);
  const fp = play.feetPosition();
  const dPlay = Math.hypot(fp[0] - SPAWN[0], fp[2] - SPAWN[2]);
  check('play controller walks at ~1.5 m/s', Math.abs(dPlay - 1.5 * 0.3) < 0.05, `dist=${dPlay.toFixed(3)}m`);
  play.dispose();

  // same world still fine afterwards, and viewer-vs-play speed differ on the same route
  const viewer = new WalkController({ RAPIER, physics, capsule: VIEWER });
  viewer.setMoveInput(1, 0);
  runSteps(viewer, 0.3);
  const fv = viewer.feetPosition();
  const dViewer = Math.hypot(fv[0] - SPAWN[0], fv[2] - SPAWN[2]);
  check('shared world usable after play dispose (successor walks)',
    dViewer > 0.5, `dist=${dViewer.toFixed(3)}m`);
  check('play speed is strictly slower than viewer on the same route', dPlay < dViewer - 0.1,
    `play=${dPlay.toFixed(3)} viewer=${dViewer.toFixed(3)}`);
  viewer.dispose();
  physics.dispose();
}

// --- dispose removes the controller's own body + collider (back to baseline counts)
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const before = worldCounts(physics);
  const cs = [];
  for (let i = 0; i < 3; i++) {
    const c = new WalkController({ RAPIER, physics, capsule: { ...VIEWER } });
    cs.push(c);
  }
  const during = worldCounts(physics);
  check('creating 3 controllers adds exactly 3 bodies and 3 colliders',
    during.bodies === before.bodies + 3 && during.colliders === before.colliders + 3,
    `before=${before.bodies}/${before.colliders} during=${during.bodies}/${during.colliders}`);

  let repeatError = null;
  for (const c of cs) {
    c.dispose();
    try { c.dispose(); } catch (e) { repeatError = e; } // double dispose must be a no-op
  }
  check('repeated dispose does not throw', !repeatError, repeatError?.message ?? '');
  const after = worldCounts(physics);
  check('after dispose, body AND collider counts return to baseline',
    after.bodies === before.bodies && after.colliders === before.colliders,
    `before=${before.bodies}/${before.colliders} after=${after.bodies}/${after.colliders}`);
  physics.dispose();
}

// --- a disposed controller must not leak into the shared world teardown path
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c = new WalkController({ RAPIER, physics, capsule: { ...PLAY } });
  runSteps(c, 0.2);
  c.dispose();
  let threw = null;
  try { physics.dispose(); } catch (e) { threw = e; } // world.free() with a leaked body crashes in rapier compat
  check('world frees cleanly after controller dispose', !threw, threw?.message ?? '');
  physics.dispose();
}

console.log(failures === 0 ? 'PLAY_CONTROLLER_LIFECYCLE PASS' : `PLAY_CONTROLLER_LIFECYCLE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
