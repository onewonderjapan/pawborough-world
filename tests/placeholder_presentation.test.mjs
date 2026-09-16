// F3 placeholder presentation contract — drives the production BlockManager
// against the real blocks.json dataset and the real Rapier, with a recording
// view stub. Covers the lead-designed framing-view switch guarantees:
//   - display-only: hiding placeholders never creates/removes/hides colliders
//   - identity: the hidden set is exactly the registry's loaded placeholder
//     stable IDs (never color/geometry sniffing; reviewed root never touched)
//   - late-arriving loads follow the current presentation preference
//   - repeated switching churns nothing (no view dispose/recreate, no bodies)
//   - reload after unload re-applies the current preference
// Run: node tests/placeholder_presentation.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { BlockManager } from '../src/world/BlockManager.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const dataset = JSON.parse(await readFile(resolve(root, 'world/blocks.json'), 'utf8'));
const westIds = dataset.blocks.find(b => b.id === 'block-adjacent-west').placeholderIds.slice().sort();
const eastIds = dataset.blocks.find(b => b.id === 'block-adjacent-east').placeholderIds;

// recording view stub: every placeholder object carries its stable ID and a
// visibility flag the manager must flip; the reviewed root is a sentinel that
// must NEVER be touched by the presentation switch
let made = 0, disposedViews = 0;
const placeholderObjects = new Set();
const views = {
  add() {},
  remove() {},
  async makePlaceholder(ph) {
    made += 1;
    const obj = { kind: 'placeholder', phId: ph.id, visible: true };
    placeholderObjects.add(obj);
    return { object: obj, dispose: () => { disposedViews += 1; } };
  },
  disposePlaceholder(v) { v.dispose(); },
  async makeReviewed() { return { group: { kind: 'reviewed-root', visible: 'SENTINEL_REVIEWED' }, colliders: [] }; },
  disposeReviewed() {},
};

const physics = { world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }) };
const bm = new BlockManager({ RAPIER, physics, views, dataset });
const bodies = () => physics.world.bodies.len();
// state helpers read ONLY the manager's active registry (views currently in
// the scene) — the created-object set intentionally keeps stale objects from
// unloaded blocks for churn checks, so it must never drive visibility asserts
const activeObjects = () => {
  const arr = [];
  for (const b of bm.blocks.values()) for (const p of b.placeholders) arr.push(p.view.object);
  return arr;
};
const objectStates = () => activeObjects().map(o => `${o.phId}:${o.visible}`).sort().join(',');
const hiddenIds = () => activeObjects().filter(o => o.visible === false).map(o => o.phId).sort();

// --- 1. default: everything the manager loads is visible (walk-consistent) ---
{
  await bm.loadBlock('block-adjacent-west');
  const before = bodies();
  check('default presentation: loaded placeholders visible', objectStates().split(',').every(s => s.endsWith('true')) && bm.loadedPlaceholderIds().length === 15,
    `${bm.loadedPlaceholderIds().length} loaded`);
  check('default presentation: manager state visible', bm.placeholderVisible === true);
  check('default presentation: baseline bodies', bodies() === before);
}

// --- 2. display-only hide: exact stable-ID set, collision untouched ---
{
  const before = bodies();
  const applied = bm.setPlaceholdersVisible(false);
  check('hide returns the number of registry placeholders it applied to', applied === 15, `applied=${applied}`);
  check('hide set is exactly the loaded west stable IDs', JSON.stringify(hiddenIds()) === JSON.stringify(westIds),
    `${hiddenIds().length} hidden`);
  check('hide did not touch colliders (display only)', bodies() === before && bm.colliderCount() === 15,
    `bodies=${bodies()} colliders=${bm.colliderCount()}`);
  check('hide did not dispose or recreate any view', made === 15 && disposedViews === 0, `made=${made} disposed=${disposedViews}`);
  check('hide kept manager registry IDs in sync', JSON.stringify(bm.loadedPlaceholderIds()) === JSON.stringify(westIds));
}

// --- 3. repeated switching: no churn, final state equals last call ---
{
  const before = bodies();
  const snapshot = objectStates();
  for (let i = 0; i < 25; i++) bm.setPlaceholdersVisible(i % 2 === 0);
  check('25 toggles: bodies constant', bodies() === before, `${before} -> ${bodies()}`);
  check('25 toggles: no view dispose/recreate churn', made === 15 && disposedViews === 0);
  check('25 toggles: final state matches last call (visible)', bm.placeholderVisible === true && hiddenIds().length === 0);
  check('25 toggles: same object identities, only flags flipped', objectStates() === snapshot || hiddenIds().length === 0);
  bm.setPlaceholdersVisible(false);
}

// --- 4. late-arriving load follows the CURRENT preference (hide flipped mid-flight) ---
{
  bm.unloadBlock('block-adjacent-west');
  // preference currently false (hidden) from test 3; start a genuinely
  // in-flight load and flip the preference WHILE it is in flight
  let release;
  const gate = new Promise(r => { release = r; });
  const original = views.makePlaceholder;
  let gated = false;
  views.makePlaceholder = async (ph) => {
    const v = await original(ph);
    if (!gated) { gated = true; await gate; }
    return v;
  };
  const slow = bm.loadBlock('block-adjacent-west');
  await new Promise(r => setTimeout(r, 10)); // let the load hit the gate
  const midBodies = bodies();
  bm.setPlaceholdersVisible(true); // user turns placeholders ON mid-flight
  release();
  const res = await slow;
  views.makePlaceholder = original;
  check('late load completed (not stale)', res?.stale === false && bm.blocks.get('block-adjacent-west').state === 'loaded');
  check('late load created its colliders (display pref never blocks collision)', bodies() === midBodies + 15, `${midBodies} -> ${bodies()}`);
  check('late-arriving views follow the mid-flight preference (visible)', hiddenIds().length === 0 && objectStates().split(',').every(s => s.endsWith('true')),
    `${objectStates().split(',').filter(s => s.endsWith('false')).length} still hidden`);
}

// --- 5. reload after unload re-applies the current preference ---
{
  bm.unloadBlock('block-adjacent-west');
  const afterUnload = bodies();
  bm.setPlaceholdersVisible(false); // framing "refined only"
  await bm.loadBlock('block-adjacent-west');
  check('reload while hidden: new views come in hidden', JSON.stringify(hiddenIds()) === JSON.stringify(westIds));
  check('reload while hidden: colliders still fully present', bodies() === afterUnload + 15, `${afterUnload} -> ${bodies()}`);
  bm.setPlaceholdersVisible(true); // walk-mode enforcement restores display
  check('enforcement: all placeholders visible again', hiddenIds().length === 0);
}

// --- 6. reviewed street root is never a presentation target ---
{
  await bm.applyReviewed();
  const reviewedGroup = bm.blocks.get('block-review-street').reviewed.group;
  const before = bodies();
  bm.setPlaceholdersVisible(false);
  check('reviewed root visibility sentinel untouched', reviewedGroup.visible === 'SENTINEL_REVIEWED');
  check('reviewed activation creates no placeholder bodies', bodies() === before);
  await bm.loadBlock('block-adjacent-east');
  const replaced = eastIds.filter(id => bm.byPlaceholder.get(id)?.replacedBy === 'block-review-street');
  const spawned = eastIds.filter(id => !replaced.includes(id));
  const hiddenNow = hiddenIds();
  check('hidden set covers west+east spawned placeholders, never suppressed/replaced IDs',
    westIds.every(id => hiddenNow.includes(id)) && spawned.every(id => hiddenNow.includes(id)) && replaced.every(id => !hiddenNow.includes(id)),
    `hidden=${hiddenNow.length} spawned=${westIds.length + spawned.length} replaced=${replaced.length}`);
  check('reviewed root is not registered as a placeholder view', ![...placeholderObjects].some(o => o.kind !== 'placeholder'));
  check('loadedPlaceholderIds never contains replaced IDs while reviewed is active',
    replaced.every(id => !bm.loadedPlaceholderIds().includes(id)));
}

bm.dispose();
check('dispose leaves no loaded blocks', bm.activeIds().length === 0);

console.log(failures === 0 ? 'PLACEHOLDER_PRESENTATION PASS' : `PLACEHOLDER_PRESENTATION FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
