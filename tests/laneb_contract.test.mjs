// N5 lane-B candidate world contract — runs the SAME production physics stack
// against world/laneb/ (derived 12m lane world).
//
// Run: node tests/laneb_contract.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { obbToWorld, validateWorldInputs, GROUND_NODE_RE } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const D = 'world/laneb';
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const [manifest, instances, collision, route, blocks] = await Promise.all([
  'review-manifest.json', 'instances.json', 'collision-world.json', 'route.json', 'blocks.json',
].map(p => readFile(resolve(root, D, p), 'utf8').then(JSON.parse)));
validateWorldInputs({ manifest, instances, collision, route, blocks });
check('laneb dataset validates (blocks dataset included)', true);

const glb = readGlb(await readFile(resolve(root, manifest.worldAssembly.path.replace(/^\.\//, ''))));
const groundTriangles = collectGroundTriangles(glb.meshes);
check('ground includes derived lane floor (4 faces)', groundTriangles.usedMeshes === 4, `${groundTriangles.usedMeshes} faces`);
check('placed triangle total matches manifest', glb.totalTriangles === manifest.placedTriangles,
  `${glb.totalTriangles} vs ${manifest.placedTriangles}`);
check('triangle budget respected (<=210000)', manifest.placedTriangles <= 210000, String(manifest.placedTriangles));
check('world bytes budget respected (<=27MB)', manifest.worldAssembly.bytes <= 27_000_000, String(manifest.worldAssembly.bytes));

const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });
check('old lane-B seal wall removed from collision', !collision.colliders.some(c => c.name === 'lane-B-end-wall'));
check('lane-b colliders present', collision.colliders.some(c => c.name.startsWith('N17-lane-b:')));

const CAPS = { radius: .35, halfHeight: .6, eyeHeight: 1.6 };
function runSteps(c, seconds, input) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) { if (input) input(); c.step(dt); }
}
const INWARD = [-0.4631, 0.8863];
const PORTAL = [57.418, 14.2485];

// walk from the street, THROUGH the portal, into the pocket
{
  // spawn on the lane floor just outside the portal
  const sx = PORTAL[0] - INWARD[0] * 2.2, sz = PORTAL[1] - INWARD[1] * 2.2;
  const c = new WalkController({ RAPIER, physics, capsule: { ...CAPS, spawn: [sx, 1.2, sz] } });
  runSteps(c, 1.0);
  const settled = c.feetPosition()[1];
  check('capsule settles on lane floor outside portal', settled > -0.05 && settled < 0.5, `y=${settled.toFixed(3)}`);
  c.yaw = Math.atan2(-INWARD[0], -INWARD[1]); // face inward
  runSteps(c, 4.0, () => c.setMoveInput(1, 0)); // 8.8 m desired: through portal + 5.5 m lane
  const feet = c.feetPosition();
  const s = (feet[0] - PORTAL[0]) * INWARD[0] + (feet[2] - PORTAL[1]) * INWARD[1];
  check('capsule passes THROUGH the new portal', s > 3.0, `progressed ${s.toFixed(2)} m past portal plane`);
  // keep walking: the new back facade must stop the capsule near s=5.5
  runSteps(c, 6.0, () => c.setMoveInput(1, 0));
  const feet2 = c.feetPosition();
  const s2 = (feet2[0] - PORTAL[0]) * INWARD[0] + (feet2[2] - PORTAL[1]) * INWARD[1];
  check('pocket back facade blocks near s=5.5', s2 > 4.2 && s2 < 6.0, `stopped at s=${s2.toFixed(2)}`);
  check('still on real ground deep in the lane', feet2[1] > -0.05 && feet2[1] < 0.5, `y=${feet2[1].toFixed(3)}`);
  c.dispose();
}

// side walls: pocket side facade blocks lateral escape from INSIDE the pocket
{
  const start = [PORTAL[0] + INWARD[0] * 3.5, 1.2, PORTAL[1] + INWARD[1] * 3.5];
  const c = new WalkController({ RAPIER, physics, capsule: { ...CAPS, spawn: start } });
  runSteps(c, 1.0);
  runSteps(c, 3.0, () => { c.yaw = -Math.PI / 2; c.setMoveInput(0, 1); }); // strafe right toward side facade
  const feet = c.feetPosition();
  const right = (feet[0] - PORTAL[0]) * 0.8863 + (feet[2] - PORTAL[1]) * 0.4631;
  check('side facade blocks lateral walk', right > 1.2 && right < 1.7, `right coord ${right.toFixed(2)} (facade face at 1.8, capsule stops ≈1.43)`);
  c.dispose();
}

physics.dispose();
console.log(failures === 0 ? 'LANEB_CONTRACT PASS' : `LANEB_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
