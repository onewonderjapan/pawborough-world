// R2 cancellation/partial-failure contract for refined asset blocks, driven
// through the REAL production stack: createBlockViews.makeAssets (the same
// factory the browser runs), the real east-edge dataset, real collision
// sidecars placed by addWallCollider/obbToWorld into a real Rapier world,
// and the real BlockManager.loadBlock error/cancel paths. Only the two
// browser-only await boundaries are injected (fetch serves the REAL GLB /
// sidecar bytes from disk; parse verifies the GLB and hands back a spy
// scene graph) — the cancel checks, rollback and collider bookkeeping under
// test are the production code, not stubs.
//
// Covered (lead review R2):
//   - dispose-during-await: in-flight load discards itself; with physics
//     alive every created collider is removed (bodies back to baseline) and
//     decoded GPU resources are disposed
//   - dispose AFTER the owner freed the physics world: the resumed load
//     releases GPU resources only — touching the freed world would throw
//   - second resource fails after the first asset fully applied: full
//     rollback (no colliders left, GPU disposed), loud error, block
//     reloadable, retry does not stack
//   - unload (epoch bump) mid-flight: factory stops at the next await
//     boundary before creating further colliders
//
// Run: node tests/asset_cancel.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BlockManager } from '../src/world/BlockManager.js';
import { createBlockViews } from '../src/world/blockViews.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const tick = () => new Promise(r => setTimeout(r, 0));

await RAPIER.init();
// blockViews resolves asset URLs against location.href — give node the repo
// root so the paths stay meaningful (fetchImpl maps them back to disk)
globalThis.location = new URL(`file://${root}/index.html`);

const dataset = JSON.parse(await readFile(resolve(root, 'world/east-edge/blocks.json'), 'utf8'));
const BLOCK = 'block-east-edge-shops';
const glb128 = await readFile(resolve(root, 'world/east-edge/east-shop-128/model.glb'), null);
const glb129 = await readFile(resolve(root, 'world/east-edge/east-shop-129/model.glb'), null);
const col128 = JSON.parse(await readFile(resolve(root, 'world/east-edge/east-shop-128/collision.json'), 'utf8'));
const col129 = JSON.parse(await readFile(resolve(root, 'world/east-edge/east-shop-129/collision.json'), 'utf8'));
const ALL_COLLIDERS = col128.colliders.length + col129.colliders.length;
check('real GLBs and sidecars feed the test', readGlb(glb128).totalTriangles === 6724 && readGlb(glb129).totalTriangles === 6716
  && col128.colliders.length > 0 && col129.colliders.length > 0, `${col128.colliders.length}+${col129.colliders.length} wall records`);
const diskBySuffix = new Map([
  ['east-shop-128/model.glb', glb128],
  ['east-shop-128/collision.json', glbToSidecar(col128)],
  ['east-shop-129/model.glb', glb129],
  ['east-shop-129/collision.json', glbToSidecar(col129)],
]);
function glbToSidecar(sidecar) { return Buffer.from(JSON.stringify(sidecar), 'utf8'); }
function serve(url) {
  const key = [...diskBySuffix.keys()].find(k => url.endsWith(k));
  if (!key) return { ok: false, status: 404, arrayBuffer: async () => { throw new Error('unexpected url ' + url); } };
  const bytes = diskBySuffix.get(key);
  return { ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer, json: async () => JSON.parse(bytes.toString('utf8')) };
}

// spy parse: the browser-only image decode is what node cannot run; the GLB
// bytes themselves are verified above with the real reader
function spySceneGraph() {
  const counts = { geo: 0, mat: 0, tex: 0 };
  const scene = new T.Group();
  const geo = new T.BoxGeometry(1, 1, 1);
  const origGeo = geo.dispose.bind(geo); geo.dispose = () => { counts.geo++; origGeo(); };
  const mat = new T.MeshStandardMaterial();
  const origMat = mat.dispose.bind(mat); mat.dispose = () => { counts.mat++; origMat(); };
  const tex = new T.Texture();
  const origTex = tex.dispose.bind(tex); tex.dispose = () => { counts.tex++; origTex(); };
  mat.map = tex;
  const mesh = new T.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = false;
  scene.add(mesh);
  return { scene, counts };
}
function makeSession(world, disposedFlag) {
  return {
    RAPIER,
    root: new T.Group(),
    // just enough renderer surface for createGLTFLoader's decoder probing
    // (no compressed textures supported → the decoders stay inert here) and
    // for makeAssets' anisotropy clamp
    renderer: { capabilities: { getMaxAnisotropy: () => 4, isWebGL2: false }, extensions: { has: () => false } },
    physics: { world, colliders: [], groundCollider: null, groundBody: null },
    get disposed() { return disposedFlag?.value === true; },
  };
}
function fetchGate(serveImpl) {
  // gate the Nth fetch call so the load is genuinely suspended at the
  // production await boundary
  let calls = 0, release = null;
  const impl = async (url, init) => {
    calls++;
    if (calls === impl.gateAt) await new Promise(r => { release = r; });
    return serveImpl(url, init);
  };
  impl.gateAt = Infinity;
  impl.open = () => release?.();
  impl.calls = () => calls;
  return impl;
}

// --- 1+2. dispose during the second asset's fetch: physics alive ----------
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const session = makeSession(world);
  const scene = new T.Scene();
  const views = createBlockViews(scene, session);
  const bm = new BlockManager({ RAPIER, physics: { world }, views, dataset });
  const fetch = fetchGate(serve);
  fetch.gateAt = 3; // 128 glb + 128 collision applied; gated inside 129 glb fetch
  const realParse = views.makeAssets;
  let spy;
  views.makeAssets = (def, opts) => realParse.call(views, def, { ...opts, fetchImpl: fetch, parseImpl: async (buf, url) => { spy = spySceneGraph(); return spy; } });
  const pending = bm.loadBlock(BLOCK);
  await tick(); // let the first two fetches+colliders land
  const midBodies = world.bodies.len();
  check('first asset colliders exist while the load is in flight', midBodies === col128.colliders.length, `${midBodies} bodies`);
  bm.dispose(); // ordered teardown while the load is suspended at an await
  fetch.open();
  const res = await pending;
  check('dispose-during-await returns stale+disposed', res.stale === true && res.disposed === true, JSON.stringify({ stale: res.stale, disposed: res.disposed }));
  check('in-flight colliders fully removed while physics is alive', world.bodies.len() === 0 && world.colliders.len() === 0,
    `bodies=${world.bodies.len()} colliders=${world.colliders.len()}`);
  check('decoded GPU resources disposed by the cancelled load', spy && spy.counts.geo > 0 && spy.counts.mat > 0 && spy.counts.tex > 0,
    JSON.stringify(spy?.counts));
  check('block left reloadable (no partial state)', bm.blocks.get(BLOCK).state === 'unloaded');
  // (retry-without-stacking is proven against live managers in scenarios 4+5;
  // this manager is disposed, so loadBlock now refuses by contract)
}

// --- 3. dispose AFTER the physics world was freed: GPU-only cleanup --------
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const flag = { value: false };
  const session = makeSession(world, flag);
  const scene = new T.Scene();
  const views = createBlockViews(scene, session);
  const bm = new BlockManager({ RAPIER, physics: { world }, views, dataset, physicsAlive: () => flag.value !== true });
  const fetch = fetchGate(serve);
  fetch.gateAt = 3;
  const realParse = views.makeAssets;
  let spy;
  views.makeAssets = (def, opts) => realParse.call(views, def, { ...opts, fetchImpl: fetch, parseImpl: async (buf, url) => { spy = spySceneGraph(); return spy; } });
  const pending = bm.loadBlock(BLOCK);
  await tick();
  bm.dispose();       // main.js order: blocks.dispose() …
  flag.value = true;  // … then session.dispose() flips the flag and frees
  world.free();
  fetch.open();
  let res = null, threw = null;
  try { res = await pending; } catch (e) { threw = e; }
  check('resumed load after world.free() does not touch the freed physics world', !threw && res?.stale === true && res?.disposed === true,
    threw ? String(threw).split('\n')[0] : JSON.stringify({ stale: res?.stale, disposed: res?.disposed }));
  check('GPU resources still released on the freed-world path', spy && spy.counts.geo > 0 && spy.counts.tex > 0, JSON.stringify(spy?.counts));
}

// --- 4. second resource fails: rollback, loud error, retry without stacking
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const session = makeSession(world);
  const scene = new T.Scene();
  const views = createBlockViews(scene, session);
  const bm = new BlockManager({ RAPIER, physics: { world }, views, dataset });
  const failing = (url) => url.endsWith('east-shop-129/model.glb') ? { ok: false, status: 404 } : serve(url);
  const fetch = fetchGate(failing);
  const realParse = views.makeAssets;
  let spy;
  views.makeAssets = (def, opts) => realParse.call(views, def, { ...opts, fetchImpl: fetch, parseImpl: async (buf, url) => { spy = spySceneGraph(); return spy; } });
  let err = null;
  try { await bm.loadBlock(BLOCK); } catch (e) { err = e; }
  check('second-resource failure fails loudly (HTTP 404 surfaces)', err && /east-shop-129.*404/.test(err.message) && !err.cancelled,
    err ? err.message.split('\n')[0] : 'no error');
  check('failure rolls back the first asset\'s colliders completely', world.bodies.len() === 0 && world.colliders.len() === 0,
    `bodies=${world.bodies.len()} colliders=${world.colliders.len()}`);
  check('failure disposes the partially decoded group', spy && spy.counts.geo > 0, JSON.stringify(spy?.counts));
  check('failed block state reset to unloaded (reloadable)', bm.blocks.get(BLOCK).state === 'unloaded');
  // retry with the real dataset (failure removed): loads fully, exactly once
  views.makeAssets = (def, opts) => realParse.call(views, def, { ...opts, fetchImpl: (u, i) => serve(u, i), parseImpl: async (buf) => spySceneGraph() });
  const retry = await bm.loadBlock(BLOCK);
  check('retry after failure applies without stacking', retry.stale === false && world.bodies.len() === ALL_COLLIDERS
    && bm.blocks.get(BLOCK).reviewed.colliders.length === ALL_COLLIDERS,
    `bodies=${world.bodies.len()} blockColliders=${bm.blocks.get(BLOCK).reviewed.colliders.length}`);
  check('activeIds reports the assets block', bm.activeIds().includes(BLOCK));
  bm.dispose();
}

// --- 5. unload (epoch bump) mid-flight: factory stops before next colliders
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const session = makeSession(world);
  const scene = new T.Scene();
  const views = createBlockViews(scene, session);
  const bm = new BlockManager({ RAPIER, physics: { world }, views, dataset });
  const fetch = fetchGate(serve);
  fetch.gateAt = 3;
  const realParse = views.makeAssets;
  views.makeAssets = (def, opts) => realParse.call(views, def, { ...opts, fetchImpl: fetch, parseImpl: async (buf) => spySceneGraph() });
  const pending = bm.loadBlock(BLOCK);
  await tick();
  bm.unloadBlock(BLOCK); // epoch bump while suspended at the 129 fetch
  fetch.open();
  const res = await pending;
  check('unload-during-await discards the stale load (no dispose flag)', res.stale === true && res.disposed !== true,
    JSON.stringify({ stale: res.stale, disposed: res.disposed }));
  check('stale load left no colliders and no bodies', world.bodies.len() === 0 && world.colliders.len() === 0,
    `bodies=${world.bodies.len()} colliders=${world.colliders.len()}`);
  const retry = await bm.loadBlock(BLOCK);
  check('reload after stale discard does not stack', retry.stale === false && world.bodies.len() === ALL_COLLIDERS, `bodies=${world.bodies.len()}`);
  bm.dispose();
}

console.log(failures === 0 ? 'ASSET_CANCEL PASS' : `ASSET_CANCEL FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
