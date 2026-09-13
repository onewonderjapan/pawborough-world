// N2 physics contract tests — run against the REAL street-reviewed.glb bytes,
// the REAL collision/instance/route JSONs and the REAL Rapier, using the same
// production modules the browser uses (collisionAdapter / groundExtractor /
// physics / WalkController / cruise). No browser, no mocks of the math.
//
// Run: node tests/physics_contract.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { obbToWorld, validateWorldInputs, GROUND_NODE_RE } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { CruiseDriver } from '../src/player/cruise.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const close = (a, b, eps) => Math.abs(a - b) <= eps;

await RAPIER.init();
const [manifest, instances, collision, route] = await Promise.all([
  'world/review-manifest.json', 'world/instances.json', 'world/collision-world.json', 'world/route.json',
].map(p => readFile(resolve(root, p), 'utf8').then(JSON.parse)));
validateWorldInputs({ manifest, instances, collision, route });

const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const groundTriangles = collectGroundTriangles(glb.meshes);

// --- 1. transform math: shared obbToWorld reproduces every recorded AABB center
let aabbMismatches = 0;
for (const c of collision.colliders) {
  const { center } = obbToWorld(c);
  const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2;
  if (!close(center[0], cx, 0.02) || !close(center[1], cy, 0.02) || !close(center[2], cz, 0.02)) aabbMismatches += 1;
}
check('obbToWorld matches all 208 recorded AABB centers', aabbMismatches === 0, `mismatches=${aabbMismatches}`);

// --- 2. ground triangles come only from the three street-kit faces
const groundMeshNames = glb.meshes.filter(m => GROUND_NODE_RE.test(m.name)).map(m => m.name);
check('ground sources are exactly the 3 verified street-kit faces', groundMeshNames.length === 3, groundMeshNames.join(','));
check('ground trimesh non-empty', groundTriangles.triangleCount > 0, `${groundTriangles.triangleCount} tris from ${groundTriangles.usedMeshes} meshes`);

// --- 3. browser-visible geometry total matches the manifest (same math as main.js)
check('placed triangle total matches manifest', glb.totalTriangles === manifest.placedTriangles,
  `${glb.totalTriangles} vs ${manifest.placedTriangles}`);

// --- 4. physics world: 208 walls + 1 ground trimesh
const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
check('wall collider count', physics.wallCount === collision.colliders.length, `${physics.wallCount}`);
check('ground collider exists', Boolean(physics.groundCollider));

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6, spawn: null };
function makeController(spawn) {
  return new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn } });
}
function runSteps(controller, seconds, input) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    if (input) input();
    controller.step(dt);
  }
}

// --- 5. spawn falls onto the real road at the west entry
{
  const c = makeController([route.entries.west[0], route.entries.west[1] + 1.0, route.entries.west[2]]);
  runSteps(c, 1.5);
  const feet = c.feetPosition();
  check('spawn lands on real road', feet[1] > -0.05 && feet[1] < 0.2, `feet y=${feet[1].toFixed(3)}`);
  check('spawn settles grounded', c.isGrounded());
  check('eye height is 1.6 above feet', close(c.eyePosition()[1] - feet[1], 1.6, 1e-9));
  c.dispose();
}

// --- 6. ground heights along the whole route (no invisible slab needed)
{
  const samples = [...route.mainStreet.filter((_, i) => i % 4 === 0), ...route.laneAExcursion, ...route.laneBExcursion];
  let bad = null;
  for (const p of samples) {
    const c = makeController([p[0], 1.2, p[2]]);
    runSteps(c, 2.0);
    const y = c.feetPosition()[1];
    if (!(y > -0.05 && y < 1.3)) { bad = { p, y }; break; }
    c.dispose();
  }
  check(`ground landing sane along ${samples.length} route samples`, !bad, bad ? JSON.stringify(bad) : '');
}

// --- 7. off-geometry west: nothing stops the fall (no invisible plane)
{
  const c = makeController([-20, 2.0, -0.16]);
  runSteps(c, 2.0);
  check('no invisible slab west of the street', c.feetPosition()[1] < -3, `feet y=${c.feetPosition()[1].toFixed(2)}`);
  c.dispose();
}

// --- 8. a street-facing ROTATED wall really blocks
// N01-plain-v1:front-brick-plinth — the 11.7 m facade-line wall, rotated with
// its instance (yaw 0.31264), thin axis in local Z, facing the street across
// real paving. Approached from the street side, so the capsule stands on
// geometry the whole way.
{
  const rec = collision.colliders.find(c => c.name === 'N01-plain-v1:front-brick-plinth');
  const { center, halfExtents, yaw } = obbToWorld(rec);
  const nx = Math.sin(yaw), nz = Math.cos(yaw); // local +Z in world = toward street
  const startX = center[0] + nx * 1.5, startZ = center[2] + nz * 1.5; // street side
  const c = makeController([startX, 1.2, startZ]);
  runSteps(c, 1.0); // settle onto paving
  const settledY = c.feetPosition()[1];
  c.yaw = Math.atan2(nx, nz); // forward (-sin,-cos) = (-nx,-nz): into the facade
  runSteps(c, 2.0, () => c.setMoveInput(1, 0)); // desired 4.4 m north into the wall
  const after = c.feetPosition();
  const dStreet = (after[0] - center[0]) * nx + (after[2] - center[2]) * nz; // + = street side
  const approach = (startX - after[0]) * nx + (startZ - after[2]) * nz;
  check('capsule settles on street paving before the wall test', settledY > -0.05 && settledY < 0.4, `feet y=${settledY.toFixed(3)}`);
  const stopGap = dStreet - halfExtents[2] - CAPSULE.radius; // ≈ controller offset when blocked
  check('rotated facade plinth stops the capsule on the street side', dStreet > halfExtents[2] && dStreet < halfExtents[2] + CAPSULE.radius + 0.25,
    `dStreet=${dStreet.toFixed(2)}m halfThick=${halfExtents[2]} stopGap=${stopGap.toFixed(2)} (expect ≈0.02)`);
  check('capsule approached the wall before being stopped', approach > 0.4, `approach=${approach.toFixed(2)}m`);
  c.dispose();

  // negative control: identical walk in a wall-free world covers the full distance
  const empty = buildPhysicsWorld(RAPIER, { collision: { colliders: [] }, groundTriangles });
  const c2 = new WalkController({ RAPIER, physics: empty, capsule: { ...CAPSULE, spawn: [startX, 1.2, startZ] } });
  runSteps(c2, 1.0);
  c2.yaw = Math.atan2(nx, nz);
  const b2 = c2.feetPosition();
  runSteps(c2, 2.0, () => c2.setMoveInput(1, 0));
  const a2 = c2.feetPosition();
  const approach2 = (startX - a2[0]) * nx + (startZ - a2[2]) * nz;
  check('wall-free control walk passes (block is the wall, not a ground artifact)', approach2 > 3.5, `approach=${approach2.toFixed(2)}m`);
  c2.dispose(); empty.dispose();
}

// --- 9. lane A mouth has real clearance (yaw-expanded AABBs would seal it)
{
  const a = route.laneAExcursion[0], b = route.laneAExcursion[2];
  const c = makeController([a[0], 0.9, a[2]]);
  runSteps(c, 1.0);
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  c.yaw = Math.atan2(-dx / len, -dz / len);
  runSteps(c, 3.0, () => c.setMoveInput(1, 0));
  const feet = c.feetPosition();
  const progressed = (feet[2] - a[2]) * (dz / len) + (feet[0] - a[0]) * (dx / len);
  check('capsule walks into lane A through the mouth', progressed > 2.5, `progressed=${progressed.toFixed(2)}m of ${len.toFixed(2)}m at (${feet[0].toFixed(2)},${feet[2].toFixed(2)})`);
  // keep walking: the real end wall must stop it before the lane closes
  runSteps(c, 6.0, () => c.setMoveInput(1, 0));
  const endWall = collision.colliders.find(x => x.name === 'lane-A-end-wall');
  const stopZ = c.feetPosition()[2];
  check('lane A end wall blocks (beyond mouth, before wall far side)', stopZ > endWall.min[2] - 0.5 && stopZ < endWall.max[2] + 1.5,
    `stopped z=${stopZ.toFixed(2)} wall z=[${endWall.min[2]},${endWall.max[2]}]`);
  c.dispose();
}

// --- 10. route cruise through the SAME input chain (auto physics cruise)
{
  const c = makeController([route.entries.west[0], route.entries.west[1] + 0.5, route.entries.west[2]]);
  runSteps(c, 1.0);
  const cruise = new CruiseDriver({ controller: c, waypoints: route.mainStreet });
  const dt = 1 / 60;
  let guard = 60 * 180;
  while (!cruise.done && guard-- > 0) cruise.tick(dt) && c.step(dt);
  const s = cruise.status();
  check('route cruise reaches east end via physics', s.done && !s.blocked && s.reached === s.total,
    JSON.stringify({ reached: s.reached, total: s.total, blocked: s.blocked }));
  check('cruise stays on street ground', c.feetPosition()[1] > -0.05 && c.feetPosition()[1] < 0.3, `y=${c.feetPosition()[1].toFixed(3)}`);
  c.dispose();
}

physics.dispose();
console.log(failures === 0 ? 'PHYSICS_CONTRACT PASS' : `PHYSICS_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
