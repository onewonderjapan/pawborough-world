// Street-completion replacement contract — the east-edge contract extended to
// the six-building tail: drives the production BlockManager against the derived
// world/street-completion/blocks.json and real Rapier with a counting view
// stub. Covers: dataset coherence vs the frozen world (exactly shop-130..133
// newly replaced; the delivered 128/129 block carried verbatim), apply/revoke
// of the new assets block (suppression both directions, physics follows), F3
// must not touch refined assets, stale asset loads don't leak, honest bytes in
// the manifest.
//
// Run: node tests/street_completion_contract.test.mjs   (exit 0 = contract holds)
import { readFile, stat } from 'node:fs/promises';
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

const BLOCK_ID = 'block-street-completion-shops';
const EAST_BLOCK_ID = 'block-east-edge-shops';
const REPLACED = ['shop-130', 'shop-131', 'shop-132', 'shop-133'];
const EAST_REPLACED = ['shop-128', 'shop-129'];

await RAPIER.init();
const frozen = JSON.parse(await readFile(resolve(root, 'world/blocks.json'), 'utf8'));
const eeBlocks = JSON.parse(await readFile(resolve(root, 'world/east-edge/blocks.json'), 'utf8'));
const dataset = JSON.parse(await readFile(resolve(root, 'world/street-completion/blocks.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'world/street-completion/review-manifest.json'), 'utf8'));

// --- 1. dataset contract ---------------------------------------------------
{
  const replacedFrozen = new Set(frozen.placeholders.filter(p => p.replacedBy).map(p => p.id));
  const replacedNow = new Set(dataset.placeholders.filter(p => p.replacedBy).map(p => p.id));
  const added = [...replacedNow].filter(id => !replacedFrozen.has(id) && id !== 'shop-128' && id !== 'shop-129');
  check('exactly shop-130..133 gained replacedBy beyond the east-edge pair',
    added.length === 4 && REPLACED.every(id => added.includes(id)), `added=${added.join(',')}`);
  check('128/129 map to the east-edge block, 130..133 to the new block',
    dataset.placeholders.filter(p => EAST_REPLACED.includes(p.id)).every(p => p.replacedBy === EAST_BLOCK_ID)
    && dataset.placeholders.filter(p => REPLACED.includes(p.id)).every(p => p.replacedBy === BLOCK_ID));
  const untouched = dataset.placeholders.filter(p => ![...REPLACED, ...EAST_REPLACED].includes(p.id))
    .every(p => JSON.stringify(p) === JSON.stringify(frozen.placeholders.find(q => q.id === p.id)));
  check('all other placeholders byte-identical to frozen', untouched);
  const block = dataset.blocks.find(b => b.id === BLOCK_ID);
  check('assets block declared with autoApply', !!block && block.kind === 'assets' && block.autoApply === true);
  check('assets block replaces exactly shop-130..133',
    JSON.stringify(block?.replacesBaseIds) === JSON.stringify(REPLACED));
  const eeBlockHere = dataset.blocks.find(b => b.id === EAST_BLOCK_ID);
  const eeBlockThere = eeBlocks.blocks.find(b => b.id === EAST_BLOCK_ID);
  check('east-edge 128/129 block carried verbatim',
    JSON.stringify(eeBlockHere) === JSON.stringify(eeBlockThere));
  const sc = manifest.streetCompletion;
  check('manifest records honest combined bytes ≤ 12MB',
    sc?.combinedDownloadBytes > 0 && sc.combinedDownloadBytes <= 12_000_000,
    `${((sc?.combinedDownloadBytes ?? 0) / 1e6).toFixed(2)}MB`);
  check('manifest records combined triangles ≤ 48k',
    sc?.combinedTriangleCount > 0 && sc.combinedTriangleCount <= 48_000, `${sc?.combinedTriangleCount} tris`);
  check('manifest asserts no runtime texture sharing',
    typeof sc?.runtimeTextureSharing === 'string' && /none claimed/.test(sc.runtimeTextureSharing));
  for (const a of sc?.assets ?? []) {
    const glb = await stat(resolve(root, `world/street-completion/${a.id}/model.glb`));
    check(`${a.id} (${a.designName}): GLB exists ≤ 10MB`, glb.size === a.bytes && a.bytes <= 10_000_000,
      `${(a.bytes / 1e6).toFixed(2)}MB, ${a.triangles} tris`);
    const sidecar = JSON.parse(await readFile(resolve(root, `world/street-completion/${a.id}/collision.json`), 'utf8'));
    check(`${a.id}: collision sidecar has world-space obb wall records`,
      sidecar.colliders.length > 0 && sidecar.colliders.every(c => c.obb && Array.isArray(c.obb.center) && c.type === 'box')
      && sidecar.colliders[0].obb.pos[0] === +a.positionGlb[0].toFixed(6));
    check(`${a.id}: no ground collider added`, sidecar.noGroundCollider === true);
  }
}

// --- 2. lifecycle against real physics -------------------------------------
let assetsLoads = 0, assetsDisposals = 0;
const views = {
  add() {}, remove() {},
  async makePlaceholder(ph) {
    return { object: { ph: ph.id, visible: true }, dispose: () => {} };
  },
  disposePlaceholder() {},
  async makeReviewed() { return { group: { reviewed: true }, colliders: [], ground: null, owns: false }; },
  async makeAssets(def) {
    assetsLoads += 1;
    const colliders = def.assets.map(a => {
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const collider = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), body);
      return { collider, body };
    });
    return { group: { name: def.id, visible: true }, colliders, ground: null, owns: true, isAssetGroup: true };
  },
  disposeAssets() { assetsDisposals += 1; },
  discardAssets(parts) {
    for (const c of parts.colliders) {
      physics.world.removeCollider(c.collider, false);
      physics.world.removeRigidBody(c.body);
    }
    assetsDisposals += 1;
  },
};

const physics = { world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }) };
const bm = new BlockManager({ RAPIER, physics, views, dataset });
const bodies = () => physics.world.bodies.len();

{
  await bm.applyReviewed();
  await bm.loadBlock('block-adjacent-east');
  const east = bm.blocks.get('block-adjacent-east');
  const grayShops = east.placeholders.filter(p => REPLACED.includes(p.ph.id));
  check('without the assets block the four gray boxes spawn', grayShops.length === 4);
  const before = bodies();
  await bm.applyAssets(BLOCK_ID);
  const block = bm.blocks.get(BLOCK_ID);
  check('assets block loads', block.state === 'loaded' && assetsLoads === 1);
  check('assets block owns its colliders', block.reviewed.colliders.length === 4);
  check('physics body count nets out (4 gray boxes traded for 4 assets)', bodies() === before, `${before} -> ${bodies()}`);
  const east2 = bm.blocks.get('block-adjacent-east');
  check('applying assets refreshes the loaded adjacent block in place',
    east2.state === 'loaded' && !east2.placeholders.some(p => REPLACED.includes(p.ph.id)));
  const stillSpawned = east2.def.placeholderIds
    .filter(id => !REPLACED.includes(id) && id !== 'shop-126').length;
  check('other placeholders keep spawning', east2.placeholders.length === stillSpawned,
    `${east2.placeholders.length}/${stillSpawned} spawned (shop-126 stays suppressed by the reviewed street block; 128/129 spawn because their block is not applied in this test)`);

  const vFlag = block.views[0].visible;
  bm.setPlaceholdersVisible(false);
  check('F3 leaves the assets group visible', block.views[0].visible === vFlag);
  bm.setPlaceholdersVisible(true);

  await bm.revokeAssets(BLOCK_ID);
  check('revoking assets removes their colliders', bodies() === before, `${bodies()} vs ${before}`);
  check('revoking assets restores the four gray boxes', assetsDisposals === 1
    && bm.blocks.get('block-adjacent-east').placeholders.filter(p => REPLACED.includes(p.ph.id)).length === 4);

  await bm.applyAssets(BLOCK_ID);
  check('re-apply works (restore)', bm.blocks.get(BLOCK_ID).state === 'loaded');
}

// --- 3. stale in-flight asset load leaves nothing behind -------------------
{
  const before = bodies();
  const real = views.makeAssets;
  let release;
  views.makeAssets = async (def) => {
    await new Promise(r => { release = r; });
    return real(def);
  };
  const slow = bm.revokeAssets(BLOCK_ID).then(() => bm.applyAssets(BLOCK_ID));
  await new Promise(r => setTimeout(r, 10));
  bm.unloadBlock(BLOCK_ID);
  release();
  await slow;
  const block = bm.blocks.get(BLOCK_ID);
  check('stale asset load discarded without partial state',
    block.state === 'unloaded' && block.views.length === 0, `state=${block.state}`);
  check('stale asset load left no colliders', bodies() === before, `${bodies()} vs ${before}`);
  views.makeAssets = real;
}

bm.dispose();
check('dispose leaves no loaded blocks', bm.activeIds().length === 0);

console.log(failures === 0 ? 'STREET_COMPLETION_CONTRACT PASS' : `STREET_COMPLETION_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
