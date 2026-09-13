// N6 block lifecycle contract — drives the production BlockManager against
// the real blocks.json dataset and the real Rapier, with a counting view
// stub standing in for three.js rendering.
//
// Run: node tests/block_lifecycle.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { BlockManager } from '../src/world/BlockManager.js';
import { obbToWorld } from '../src/world/collisionAdapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const dataset = JSON.parse(await readFile(resolve(root, 'world/blocks.json'), 'utf8'));

// counting view stub (placeholder creation is awaitable so a load can genuinely
// be in flight across an unload)
let made = 0, disposedViews = 0;
const deferred = [];
const views = {
  createGroup() { return { name: `group${made++}` }; },
  add() {},
  remove() {},
  async makePlaceholder(ph) {
    made += 1;
    if (deferred.length) { await deferred.shift(); } // simulate slow IO for one placeholder
    return { object: { ph: ph.id }, dispose: () => { disposedViews += 1; } };
  },
  disposePlaceholder(v) { v.dispose(); },
  async makeReviewed() { return { group: { reviewed: true }, colliders: [] }; },
  disposeReviewed() {},
};

const physics = { world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }) };
const bm = new BlockManager({ RAPIER, physics, views, dataset });

function bodies() {
  return physics.world.bodies.len();
}

// --- 1. enter/exit symmetric (渲染和碰撞同生命周期)
{
  const east = bm.blocks.get('block-adjacent-east');
  const before = bodies();
  await bm.loadBlock('block-adjacent-east');
  const loadedViews = east.views.length, loadedCols = east.placeholders.length;
  const mid = bodies();
  check('east block loads its placeholders', loadedViews === 16 && loadedCols === 16, `views=${loadedViews} colliders=${loadedCols}`);
  check('physics bodies created for the block', mid > before, `${before} -> ${mid}`);
  bm.unloadBlock('block-adjacent-east');
  check('unload removes exactly the same views/colliders', east.views.length === 0 && east.placeholders.length === 0 && disposedViews === 16);
  check('physics bodies restored after unload', bodies() === before, `${mid} -> ${bodies()} (before ${before})`);
}

// --- 2. replacement never stacks (替换不叠加)
{
  await bm.applyReviewed();
  const reviewedActive = bm.blocks.get('block-review-street').state === 'loaded';
  check('reviewed block loads', reviewedActive);
  await bm.loadBlock('block-adjacent-east');
  const east = bm.blocks.get('block-adjacent-east');
  const suppressed = east.def.placeholderIds.filter(id => bm.byPlaceholder.get(id)?.replacedBy === 'block-review-street');
  const spawnedReplaced = east.placeholders.filter(p => p.ph.replacedBy === 'block-review-street');
  check('replaced placeholders suppressed while reviewed active', reviewedActive && spawnedReplaced.length === 0,
    `replaced in block: ${suppressed.length}, spawned: ${spawnedReplaced.length}`);
  await bm.loadBlock('block-adjacent-east'); // double load must not stack
  const ids1 = east.placeholders.map(p => p.ph.id).sort().join(',');
  const n1 = east.placeholders.length;
  check('double load does not stack', east.placeholders.length === n1, `n=${n1}`);
  bm.unloadBlock('block-adjacent-east');
  await bm.loadBlock('block-adjacent-east');
  const ids2 = east.placeholders.map(p => p.ph.id).sort().join(',');
  check('reload produces identical layout (no stacking drift)', ids1 === ids2);
}

// --- 3. late-arriving stale load discarded (晚到版本不覆盖新布局)
{
  bm.unloadBlock('block-adjacent-east');
  const east = bm.blocks.get('block-adjacent-east');
  // hold one placeholder creation so the load is genuinely in flight
  let release;
  const gate = new Promise(r => { release = r; });
  deferred.push(gate);
  const slow = bm.loadBlock('block-adjacent-east');
  await new Promise(r => setTimeout(r, 10)); // let the load start and hit the gate
  bm.unloadBlock('block-adjacent-east');     // epoch bumps while load in flight
  release();
  const res = await slow;
  check('stale in-flight load discarded, not applied', res.stale === true && east.state === 'unloaded' && east.views.length === 0,
    `stale=${res?.stale} state=${east.state}`);
  // world must be clean of the stale colliders
  check('stale load left no colliders', east.placeholders.length === 0);
}

// --- 4. 撤回恢复: revoke reviewed -> replaced placeholders return; restore -> suppressed again
{
  const east = bm.blocks.get('block-adjacent-east');
  const replacedInEast = east.def.placeholderIds
    .filter(id => bm.byPlaceholder.get(id)?.replacedBy === 'block-review-street').length;
  bm.unloadBlock('block-adjacent-east');
  await bm.loadBlock('block-adjacent-east'); // reviewed active: replaced suppressed
  const withReview = east.placeholders.filter(p => bm.byPlaceholder.get(p.ph.id)?.replacedBy === 'block-review-street').length;
  bm.revokeReviewed();
  check('reviewed unloaded by revoke', bm.blocks.get('block-review-street').state === 'unloaded');
  bm.unloadBlock('block-adjacent-east');
  await bm.loadBlock('block-adjacent-east');
  const afterRevoke = east.placeholders.filter(p => bm.byPlaceholder.get(p.ph.id)?.replacedBy === 'block-review-street').length;
  check('revoking reviewed restores replaced placeholders', withReview === 0 && afterRevoke === replacedInEast,
    `whileReviewed=${withReview} afterRevoke=${afterRevoke} expected=${replacedInEast}`);
  await bm.restoreReviewed();
  bm.unloadBlock('block-adjacent-east');
  await bm.loadBlock('block-adjacent-east');
  const afterRestore = east.placeholders.filter(p => bm.byPlaceholder.get(p.ph.id)?.replacedBy === 'block-review-street').length;
  check('restoring reviewed suppresses them again', afterRestore === 0, `afterRestore=${afterRestore}`);
}

// --- 5. rotated placeholder transform consistency (旋转建筑变换一致)
{
  const ph = bm.byPlaceholder.get('shop-122');
  const { center, halfExtents, yaw } = bm.placeholderCollider(ph);
  const expected = obbToWorld({
    name: 'x', type: 'box', min: [0, 0, 0], max: [0, ph.heightM, 0],
    obb: { pos: [ph.glbPoint[0], 0, ph.glbPoint[1]], theta: ph.angleRad, center: [0, ph.heightM / 2, 0], size: [ph.widthM, ph.heightM, ph.depthM] },
  });
  check('placeholder collider matches shared OBB math',
    Math.abs(center[0] - expected.center[0]) < 1e-9 && Math.abs(center[2] - expected.center[2]) < 1e-9 && yaw === expected.yaw,
    `center=(${center[0].toFixed(2)},${center[2].toFixed(2)}) yaw=${yaw.toFixed(4)}`);
  check('rotated placeholder has real yaw from map data', Math.abs(yaw) > 0.01, `angleRad=${ph.angleRad.toFixed(4)}`);
}

// --- 6. negatives: bad ids fail loudly without partial state
{
  let threw = false;
  try { await bm.loadBlock('block-does-not-exist'); } catch (e) { threw = String(e).includes('unknown block'); }
  check('unknown block id throws', threw);
  let threw2 = false;
  try { await bm.loadBlock('block-adjacent-west', { reviewed: false }); await bm.unloadBlock('block-adjacent-west'); } catch { threw2 = true; }
  check('west block load/unload cycle clean', threw2 === false);
}

bm.dispose();
check('dispose leaves no loaded blocks', bm.activeIds().length === 0);

console.log(failures === 0 ? 'BLOCK_LIFECYCLE PASS' : `BLOCK_LIFECYCLE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
