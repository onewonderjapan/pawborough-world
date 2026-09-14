// East-edge replacement contract — drives the production BlockManager against
// the derived world/east-edge/blocks.json and real Rapier, with a counting
// view stub. Covers: dataset coherence vs the frozen world, apply/revoke of
// the refined assets block (placeholder suppression both directions, physics
// bodies follow), F3 must not touch refined assets, stale asset loads don't
// leak, and the honest-bytes fields in the manifest.
//
// Run: node tests/eastedge_contract.test.mjs   (exit 0 = contract holds)
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

const BLOCK_ID = 'block-east-edge-shops';
const REPLACED = ['shop-128', 'shop-129'];

await RAPIER.init();
const frozen = JSON.parse(await readFile(resolve(root, 'world/blocks.json'), 'utf8'));
const dataset = JSON.parse(await readFile(resolve(root, 'world/east-edge/blocks.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'world/east-edge/review-manifest.json'), 'utf8'));

// --- 1. dataset contract ---------------------------------------------------
{
  const replacedFrozen = new Set(frozen.placeholders.filter(p => p.replacedBy).map(p => p.id));
  const replacedNow = new Set(dataset.placeholders.filter(p => p.replacedBy).map(p => p.id));
  const added = [...replacedNow].filter(id => !replacedFrozen.has(id));
  check('exactly shop-128/129 gained replacedBy', added.length === 2 && REPLACED.every(id => added.includes(id)),
    `added=${added.join(',')}`);
  const untouched = dataset.placeholders.filter(p => !REPLACED.includes(p.id))
    .every(p => JSON.stringify(p) === JSON.stringify(frozen.placeholders.find(q => q.id === p.id)));
  check('all other placeholders byte-identical to frozen', untouched);
  const block = dataset.blocks.find(b => b.id === BLOCK_ID);
  check('assets block declared with autoApply', !!block && block.kind === 'assets' && block.autoApply === true);
  check('assets block replaces exactly shop-128/129',
    JSON.stringify(block?.replacesBaseIds) === JSON.stringify(REPLACED));
  check('two assets with world transforms',
    block?.assets?.length === 2 && block.assets.every(a =>
      Array.isArray(a.positionGlb) && a.positionGlb.length === 3 && typeof a.rotationYRad === 'number'));
  const ee = manifest.eastEdgeAssets;
  check('manifest records honest combined bytes ≤ 5MB',
    ee?.combinedDownloadBytes > 0 && ee.combinedDownloadBytes <= 5_000_000,
    `${((ee?.combinedDownloadBytes ?? 0) / 1e6).toFixed(2)}MB`);
  check('manifest asserts no runtime texture sharing',
    typeof ee?.runtimeTextureSharing === 'string' && /none claimed/.test(ee.runtimeTextureSharing));
  for (const a of ee?.assets ?? []) {
    const glb = stat(resolve(root, `world/east-edge/${a.id}/model.glb`));
    check(`${a.id}: GLB exists ≤ 2.5MB`, (await glb).size === a.bytes && a.bytes <= 2_500_000, `${(a.bytes / 1e6).toFixed(2)}MB`);
    const sidecar = JSON.parse(await readFile(resolve(root, `world/east-edge/${a.id}/collision.json`), 'utf8'));
    check(`${a.id}: collision sidecar has world-space obb wall records`,
      sidecar.colliders.length > 0 && sidecar.colliders.every(c => c.obb && Array.isArray(c.obb.center) && c.type === 'box')
      && sidecar.colliders[0].obb.pos[0] === +a.positionGlb[0].toFixed(6));
    check(`${a.id}: no ground collider added`, sidecar.noGroundCollider === true);
  }
}

// --- 2. lifecycle against real physics -------------------------------------
let madePlaceholders = 0, assetsLoads = 0, assetsDisposals = 0;
const views = {
  add() {}, remove() {},
  async makePlaceholder(ph) {
    madePlaceholders += 1;
    return { object: { ph: ph.id, visible: true }, dispose: () => {} };
  },
  disposePlaceholder() {},
  async makeReviewed() { return { group: { reviewed: true }, colliders: [], ground: null, owns: false }; },
  async makeAssets(def) {
    assetsLoads += 1;
    // create REAL colliders so physics body counts are meaningful
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
  check('without the assets block the gray boxes spawn', grayShops.length === 2);
  const before = bodies();
  await bm.applyAssets(BLOCK_ID);
  const block = bm.blocks.get(BLOCK_ID);
  check('assets block loads', block.state === 'loaded' && assetsLoads === 1);
  // two gray-box bodies are suppressed, two asset bodies created: net zero,
  // but the assets block itself owns exactly 2 colliders
  check('assets block owns its colliders', block.reviewed.colliders.length === 2);
  check('physics body count nets out (2 gray boxes traded for 2 assets)', bodies() === before, `${before} -> ${bodies()}`);
  const east2 = bm.blocks.get('block-adjacent-east');
  check('applying assets refreshes the loaded adjacent block in place (相邻占位同步)',
    east2.state === 'loaded' && !east2.placeholders.some(p => REPLACED.includes(p.ph.id)));
  const stillSpawned = east2.def.placeholderIds
    .filter(id => !REPLACED.includes(id) && !bm.byPlaceholder.get(id)?.replacedBy).length;
  check('other placeholders keep spawning', east2.placeholders.length === stillSpawned,
    `${east2.placeholders.length}/${stillSpawned} (street-replaced shop-126 stays suppressed)`);

  // F3 display switch must not touch the refined assets (精修对象不被隐藏)
  const vFlag = block.views[0].visible;
  const applied = bm.setPlaceholdersVisible(false);
  check('F3 hides the loaded placeholders', applied === east2.placeholders.length
    && east2.placeholders.every(p => p.view.object.visible === false));
  check('F3 leaves the assets group visible', block.views[0].visible === vFlag);
  bm.setPlaceholdersVisible(true);

  await bm.revokeAssets(BLOCK_ID);
  check('revoking assets removes their colliders', bodies() === before, `${bodies()} vs ${before}`);
  check('revoking assets restores the gray boxes', assetsDisposals === 1
    && bm.blocks.get('block-adjacent-east').placeholders.filter(p => REPLACED.includes(p.ph.id)).length === 2);

  await bm.applyAssets(BLOCK_ID);
  check('re-apply works (restore)', bm.blocks.get(BLOCK_ID).state === 'loaded');
}

// --- 3. stale in-flight asset load leaves nothing behind -------------------
{
  const before = bodies();
  // monkey-gate makeAssets to be genuinely slow, then unload mid-flight
  const real = views.makeAssets;
  let release;
  views.makeAssets = async (def) => {
    await new Promise(r => { release = r; });
    return real(def);
  };
  const slow = bm.revokeAssets(BLOCK_ID).then(() => bm.applyAssets(BLOCK_ID));
  await new Promise(r => setTimeout(r, 10));
  bm.unloadBlock(BLOCK_ID); // bump epoch while the load is in flight
  release();
  await slow;
  const block = bm.blocks.get(BLOCK_ID);
  check('stale asset load discarded without partial state',
    block.state === 'unloaded' && block.views.length === 0,
    `state=${block.state}`);
  check('stale asset load left no colliders', bodies() === before, `${bodies()} vs ${before}`);
  views.makeAssets = real;
}

bm.dispose();
check('dispose leaves no loaded blocks', bm.activeIds().length === 0);

console.log(failures === 0 ? 'EASTEDGE_CONTRACT PASS' : `EASTEDGE_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
