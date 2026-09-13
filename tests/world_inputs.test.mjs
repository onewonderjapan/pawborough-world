// N2 world-input contract: the production validateWorldInputs must accept the
// real world JSONs and reject precisely-described bad ones (bad-load path).
// The blocks dataset is a REQUIRED input (R3): missing/corrupt blocks.json
// must fail validation, never degrade to a silently block-less scene.
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
async function loadInputs(dir = 'world') {
  const entries = await Promise.all([
    'review-manifest.json', 'instances.json', 'collision-world.json', 'route.json', 'blocks.json',
  ].map(p => readFile(resolve(root, dir, p), 'utf8').then(JSON.parse)));
  return { manifest: entries[0], instances: entries[1], collision: entries[2], route: entries[3], blocks: entries[4] };
}
async function expectThrow(name, mutate, dir = 'world') {
  const d = await loadInputs(dir);
  mutate(d);
  try {
    validateWorldInputs(d);
    check(name, false, 'no error thrown');
  } catch (e) {
    check(name, e instanceof Error && e.message.startsWith('world input:'), e.message.slice(0, 90));
  }
}

// good paths: frozen world AND lane-B candidate
{
  const d = await loadInputs('world');
  check('real world inputs validate', validateWorldInputs(d) === true);
  check('all 7 world-aligned seal walls derive sane boxes',
    d.collision.colliders.filter(c => !c.obb).every(c => { const b = obbToWorld(c); return b.yaw === 0 && b.halfExtents.every(h => h > 0); }));
  const dl = await loadInputs('world/laneb');
  check('laneb derived dataset validates', validateWorldInputs(dl) === true);
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
await expectThrow('bad: blocks dataset missing entirely', (d) => { delete d.blocks; });
await expectThrow('bad: blocks.blocks empty', (d) => { d.blocks.blocks = []; });
await expectThrow('bad: block references unknown placeholder', (d) => { d.blocks.blocks[1].placeholderIds[0] = 'shop-ghost'; });
await expectThrow('bad: placeholder replacedBy unknown block', (d) => { d.blocks.placeholders[0].replacedBy = 'block-ghost'; });
await expectThrow('bad: placeholder geometry malformed', (d) => { delete d.blocks.placeholders[0].heightM; });
await expectThrow('bad: street extent missing', (d) => { delete d.blocks.streetExtentX; });
await expectThrow('bad: no reviewed street block', (d) => { d.blocks.blocks = d.blocks.blocks.filter(b => b.kind !== 'reviewed'); });

console.log(failures === 0 ? 'WORLD_INPUTS PASS' : `WORLD_INPUTS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
