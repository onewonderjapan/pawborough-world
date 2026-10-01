// R1 repair tests: per-frame play telemetry (actual corrected horizontal
// velocity + facing direction) computed from the REAL WalkController steps.
// Review R0 items 2/3/4: the play branch must feed actual motion (not the
// nominal 1.5 m/s) and a movement-derived facing into the avatar; onFeet is
// exercised separately in the browser smoke.
//
// Run: node tests/play_telemetry.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';
import { computeStepMotion, MOVE_EPS_SPEED } from '../scene-authoring/yuyuan-area/web/play/telemetry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

await RAPIER.init();
const [manifest, collision] = await Promise.all([
  readFile(resolve(root, 'world/review-manifest.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'world/collision-world.json'), 'utf8').then(JSON.parse),
]);
const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const groundTriangles = collectGroundTriangles(glb.meshes);
const SPAWN = [20, 1.2, -4];
const PLAY = { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, speed: 1.5, spawn: SPAWN };

// --- pure guards: no step / bad dt never produce motion
{
  check('no lastStep -> no motion', (() => {
    const m = computeStepMotion(null, 1 / 60);
    return m.moving === false && m.actualSpeed === 0 && m.facingYaw === null;
  })());
  const m = computeStepMotion({ corrected: [1, 0, 1] }, NaN);
  check('bad fixedDt -> no motion (no NaN propagation)',
    m.moving === false && m.actualSpeed === 0 && m.facingYaw === null);
}

// --- free walk: actual speed ≈ 1.5 m/s, facing follows the movement direction
{
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
  const c = new WalkController({ RAPIER, physics, capsule: { ...PLAY } });
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) { c.setMoveInput(1, 0); c.step(dt); } // W only, yaw 0 → -Z
  const m = computeStepMotion(c.lastStep, c.fixedDt);
  check('free walk actual speed ≈ play speed', Math.abs(m.actualSpeed - 1.5) < 0.15,
    `speed=${m.actualSpeed.toFixed(3)}`);
  check('free walk reports moving', m.moving === true);
  check('facing = movement direction (controller convention: forward=(-sin f, -cos f))',
    close(m.facingYaw, 0, 1e-3), `f=${m.facingYaw?.toFixed(6)}`);
  const fwd = [-Math.sin(m.facingYaw), -Math.cos(m.facingYaw)];
  const step = c.lastStep.corrected;
  const horiz = Math.hypot(step[0], step[2]);
  check('facing unit vector matches the corrected horizontal displacement direction',
    close(fwd[0], step[0] / horiz, 1e-6) && close(fwd[1], step[2] / horiz, 1e-6));

  // strafe D only (right = +X at yaw 0): facing must turn to +X, not stay forward
  for (let i = 0; i < 20; i++) { c.setMoveInput(0, 1); c.step(dt); }
  const m2 = computeStepMotion(c.lastStep, c.fixedDt);
  const fwd2 = [-Math.sin(m2.facingYaw), -Math.cos(m2.facingYaw)];
  check('strafe facing follows the new direction (+X)',
    fwd2[0] > 0.9 && Math.abs(fwd2[1]) < 0.1, `fwd=(${fwd2[0].toFixed(3)}, ${fwd2[1].toFixed(3)})`);
  c.dispose();
  physics.dispose();
}

// --- wall-blocked: actual speed collapses below threshold -> not moving
{
  // open-air arena with one wall right in front of the spawn
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1, 0.1).setTranslation(0, 0.5, -0.6));
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...PLAY, spawn: [0, 0.02, 0] } });
  const dt = 1 / 60;
  for (let i = 0; i < 45; i++) { c.setMoveInput(1, 0); c.step(dt); } // push into the wall
  const m = computeStepMotion(c.lastStep, c.fixedDt);
  check('wall-blocked actual speed collapses', m.actualSpeed < MOVE_EPS_SPEED,
    `speed=${m.actualSpeed.toFixed(4)} eps=${MOVE_EPS_SPEED}`);
  check('wall-blocked is NOT moving (no walk playback against a wall)', m.moving === false);
  check('wall-blocked facing is null (avatar keeps its last facing)', m.facingYaw === null);
  c.dispose();
  world.free();
}

console.log(failures === 0 ? 'PLAY_TELEMETRY PASS' : `PLAY_TELEMETRY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
