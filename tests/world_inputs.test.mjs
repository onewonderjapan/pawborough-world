// N2 world-input contract: the production validateWorldInputs must accept the
// real world JSONs and reject precisely-described bad ones (bad-load path).
//
// Run: node tests/world_inputs.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldInputs, obbToWorld } from '../src/world/collisionAdapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
async function expectThrow(name, mutate) {
  const [manifest, instances, collision, route] = await Promise.all([
    'world/review-manifest.json', 'world/instances.json', 'world/collision-world.json', 'world/route.json',
  ].map(p => readFile(resolve(root, p), 'utf8').then(JSON.parse)));
  mutate({ manifest, instances, collision, route });
  try {
    validateWorldInputs({ manifest, instances, collision, route });
    check(name, false, 'no error thrown');
  } catch (e) {
    check(name, e instanceof Error && e.message.startsWith('world input:'), e.message.slice(0, 90));
  }
}

// good path
{
  const [manifest, instances, collision, route] = await Promise.all([
    'world/review-manifest.json', 'world/instances.json', 'world/collision-world.json', 'world/route.json',
  ].map(p => readFile(resolve(root, p), 'utf8').then(JSON.parse)));
  check('real world inputs validate', validateWorldInputs({ manifest, instances, collision, route }) === true);
  check('all 7 world-aligned seal walls derive sane boxes',
    collision.colliders.filter(c => !c.obb).every(c => { const b = obbToWorld(c); return b.yaw === 0 && b.halfExtents.every(h => h > 0); }));
}

await expectThrow('bad: empty manifest modules', (d) => { d.manifest.modules = []; });
await expectThrow('bad: manifest triangle count missing', (d) => { delete d.manifest.placedTriangles; });
await expectThrow('bad: instance references unknown module', (d) => { d.instances.instances[0].module = 'nonexistent-module'; });
await expectThrow('bad: instance rotation missing', (d) => { delete d.instances.instances[0].rotationYRad; });
await expectThrow('bad: colliders missing entirely', (d) => { d.collision.colliders = []; });
await expectThrow('bad: collider without obb or min/max', (d) => { const c = d.collision.colliders[0]; delete c.obb; delete c.min; delete c.max; });
await expectThrow('bad: collider references unknown instance', (d) => { d.collision.colliders[0].name = 'N99-ghost:left-side'; });
await expectThrow('bad: route too short', (d) => { d.route.mainStreet = [d.route.mainStreet[0]]; });
await expectThrow('bad: no west entry', (d) => { delete d.route.entries.west; });

console.log(failures === 0 ? 'WORLD_INPUTS PASS' : `WORLD_INPUTS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
