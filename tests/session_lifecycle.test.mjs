// N2 session lifecycle: pause leaves no residual motion, blur-clear works,
// and repeated enter/exit (load/unload cycles) never stacks colliders or
// leaks a physics world.
//
// Run: node tests/session_lifecycle.test.mjs   (exit 0 = contract holds)
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
const close = (a, b, eps) => Math.abs(a - b) <= eps;
const samePos = (a, b, eps = 1e-6) => close(a[0], b[0], eps) && close(a[1], b[1], eps) && close(a[2], b[2], eps);

await RAPIER.init();
const [manifest, collision] = await Promise.all([
  readFile(resolve(root, 'world/review-manifest.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'world/collision-world.json'), 'utf8').then(JSON.parse),
]);
const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const groundTriangles = collectGroundTriangles(glb.meshes);
const SPAWN = [20, 1.2, -4];

function runSteps(c, seconds, input) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    if (input) input();
    c.step(dt);
  }
}

// --- pause: no stepping, no residual motion, keys cleared
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c = new WalkController({ RAPIER, physics, capsule: { radius: .35, halfHeight: .6, eyeHeight: 1.6, spawn: SPAWN } });
  runSteps(c, 1.0);
  c.setMoveInput(1, 0);
  runSteps(c, 0.25, () => c.setMoveInput(1, 0)); // walking
  c.pause();
  check('pause cleared keys', c.input.forward === 0 && c.input.right === 0 && !c.input.jump);
  const atPause = c.feetPosition();
  runSteps(c, 2.0, () => c.setMoveInput(1, 0)); // re-fed input while paused must be ignored
  check('paused controller does not move', samePos(c.feetPosition(), atPause),
    `delta=${Math.hypot(...c.feetPosition().map((v, i) => v - atPause[i])).toFixed(4)}m`);
  c.resume();
  const atResume = c.feetPosition();
  runSteps(c, 0.5); // resume does NOT re-apply old input (keys stay cleared)
  const now = c.feetPosition();
  check('resume without new input stays put (horizontal exact; ground snap may jitter y)',
    Math.hypot(now[0] - atResume[0], now[2] - atResume[2]) < 1e-6 && Math.abs(now[1] - atResume[1]) < 2e-3,
    `dxz=${Math.hypot(now[0] - atResume[0], now[2] - atResume[2]).toExponential(1)} dy=${(now[1] - atResume[1]).toExponential(1)}`);
  c.dispose(); physics.dispose();
}

// --- blur-style hard clear mid-motion
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c = new WalkController({ RAPIER, physics, capsule: { radius: .35, halfHeight: .6, eyeHeight: 1.6, spawn: SPAWN } });
  runSteps(c, 1.0);
  c.setMoveInput(1, 0.5);
  runSteps(c, 0.25);
  const moving = c.feetPosition();
  c.clearKeys(); // what the browser does on window blur
  runSteps(c, 1.0);
  const stopped = c.feetPosition();
  check('clearKeys mid-walk stops motion next step', Math.hypot(stopped[0] - moving[0], stopped[2] - moving[2]) < 0.06,
    `drift=${Math.hypot(stopped[0] - moving[0], stopped[2] - moving[2]).toFixed(3)}m`);
  c.dispose(); physics.dispose();
}

// --- repeated enter/exit: identical worlds, no stacking, double-dispose safe
{
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
    const c = new WalkController({ RAPIER, physics, capsule: { radius: .35, halfHeight: .6, eyeHeight: 1.6, spawn: SPAWN } });
    runSteps(c, 0.5);
    seen.push({ walls: physics.wallCount, ground: physics.groundTriangleCount, feet: c.feetPosition() });
    c.dispose();
    c.dispose(); // must be safe
    physics.dispose();
    physics.dispose(); // must be safe
  }
  check('three load cycles each see exactly 208 walls', seen.every(s => s.walls === 208), seen.map(s => s.walls).join(','));
  check('ground trimesh identical every cycle', seen.every(s => s.ground === seen[0].ground));
  check('same spawn lands at the same place every cycle (no stacking drift)',
    samePos(seen[0].feet, seen[1].feet, 1e-6) && samePos(seen[1].feet, seen[2].feet, 1e-6),
    seen.map(s => s.feet.map(v => v.toFixed(4)).join(',')).join(' | '));
}

// --- a disposed controller's collider is really gone
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c1 = new WalkController({ RAPIER, physics, capsule: { radius: .35, halfHeight: .6, eyeHeight: 1.6, spawn: SPAWN } });
  runSteps(c1, 0.5);
  c1.dispose();
  const c2 = new WalkController({ RAPIER, physics, capsule: { radius: .35, halfHeight: .6, eyeHeight: 1.6, spawn: SPAWN } });
  runSteps(c2, 0.5);
  check('replacement controller walks normally after predecessor disposed', c2.isGrounded() && Number.isFinite(c2.feetPosition()[0]),
    `grounded=${c2.isGrounded()} feet=${c2.feetPosition().map(v => v.toFixed(2))}`);
  c2.dispose(); physics.dispose();
}

console.log(failures === 0 ? 'SESSION_LIFECYCLE PASS' : `SESSION_LIFECYCLE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
