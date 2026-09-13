// R3 block-lifecycle regression on the REAL production stack: real collision
// records from world/collision-world.json, real ground triangles from the
// reviewed GLB, real Rapier world built by buildPhysicsWorld, and the REAL
// production view factory (createBlockViews with a session handle). The N6
// stub tests could not see the reviewed street; this test proves that revoke
// moves the real street root out of the scene AND its 208 wall colliders plus
// ground trimesh out of the physics world, that restore re-creates an
// identical set without stacking, that adjacent placeholders stay in sync,
// and that teardown order (BlockManager.dispose BEFORE physics.dispose)
// leaves no late-arriving load able to touch the freed world.
//
// Run: node tests/block_production.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BlockManager } from '../src/world/BlockManager.js';
import { createBlockViews } from '../src/world/blockViews.js';
import { buildPhysicsWorld } from '../src/world/physics.js';
import { obbToWorld } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

await RAPIER.init();
const [collision, dataset, glbBytes] = await Promise.all([
  readFile(resolve(root, 'world/collision-world.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'world/blocks.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'world/street-reviewed.glb'), null),
]);
const glb = readGlb(glbBytes);
const groundTriangles = collectGroundTriangles(glb.meshes);

// the street root is a real THREE.Group with a mesh, exactly the shape of
// WorldLoader's session.root; each section rebuilds a fresh scene graph
const streetRoot = new T.Group(); streetRoot.name = 'world-root';
streetRoot.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial()));
function freshGraph() {
  streetRoot.removeFromParent();
  const scene = new T.Scene();
  const container = new T.Group(); container.name = 'complete-fangbang-world';
  scene.add(container); container.add(streetRoot); // main.js: world.add(session.root)
  return { scene, container };
}
function buildSession() {
  return { RAPIER, root: streetRoot, physics: buildPhysicsWorld(RAPIER, { collision, groundTriangles }), collision, groundTriangles };
}
const worldCounts = (physics) => ({ colliders: physics.world.colliders.len(), bodies: physics.world.bodies.len() });

const WALLS = collision.colliders.length; // 208 in the frozen dataset
const eastBlock = dataset.blocks.find(b => b.id === 'block-adjacent-east');
const replacedInEast = eastBlock.placeholderIds
  .filter(id => dataset.placeholders.find(p => p.id === id)?.replacedBy === 'block-review-street');

// --- 1+2+3. takeover -> revoke -> restore: geometry and collision move together
{
  const session = buildSession();
  const { scene, container } = freshGraph();
  const bm = new BlockManager({ RAPIER, physics: session.physics, views: createBlockViews(scene, session), dataset });
  const base = worldCounts(session.physics);
  check(`physics world starts with ${WALLS} walls + ground only`,
    base.colliders === WALLS + 1 && base.bodies === WALLS + 1, JSON.stringify(base));

  await bm.applyReviewed();
  check('reviewed street active after applyReviewed', bm.activeIds().includes('block-review-street'), bm.activeIds().join(','));
  const taken = worldCounts(session.physics);
  check('takeover does not duplicate colliders (street walls stay single)',
    taken.colliders === WALLS + 1 && taken.bodies === WALLS + 1, JSON.stringify(taken));
  check('street root lives under its original container while reviewed', streetRoot.parent === container, '');
  const centerOf = (rec) => obbToWorld(rec).center;
  const worldCenter = (c) => { const t = c.translation(); return [t.x, t.y, t.z]; };
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 5e-4); // Rapier stores f32
  check("takeover colliders sit at their records' OBB centers",
    session.physics.colliders.every((c, i) => near(worldCenter(c.collider), centerOf(collision.colliders[i]))),
    `${session.physics.colliders.length} records`);

  await bm.revokeReviewed();
  const revoked = worldCounts(session.physics);
  check('revoke removes the street root from the scene graph', !streetRoot.parent, '');
  check(`revoke removes all ${WALLS} wall colliders + ground from physics`,
    revoked.colliders === 0 && revoked.bodies === 0, JSON.stringify(revoked));
  const missWhileRevoked = session.physics.world.castRay(new RAPIER.Ray({ x: 42, y: 5, z: 4 }, { x: 0, y: -1, z: 0 }), 50, true);
  check('with the street revoked, nothing catches a ray above the road (ground collision really gone)',
    missWhileRevoked === null, missWhileRevoked ? `toi=${missWhileRevoked.timeOfImpact}` : 'missed');

  await bm.restoreReviewed();
  const restored = worldCounts(session.physics);
  check('restore re-creates exactly walls + ground',
    restored.colliders === WALLS + 1 && restored.bodies === WALLS + 1, JSON.stringify(restored));
  check('restore re-adds the street root to its original container', streetRoot.parent === container, '');
  const recreated = bm.blocks.get('block-review-street').reviewed.colliders;
  check("re-created colliders match every record's OBB center (full 208-record identity)",
    recreated.length === collision.colliders.length &&
    recreated.every((c, i) => near(worldCenter(c.collider), centerOf(collision.colliders[i]))),
    `${recreated.length} records`);
  await bm.restoreReviewed(); // double restore must be a no-op
  check('double restore does not stack', worldCounts(session.physics).colliders === WALLS + 1, '');

  // ground really is back: downward rays along the route's road waypoints hit
  // a surface at road level (route points stand on the road by construction)
  const route = JSON.parse(await readFile(resolve(root, 'world/route.json'), 'utf8'));
  const roadPoints = route.mainStreet.filter((_, i) => i % 4 === 0);
  let roadHits = 0;
  for (const [px, , pz] of roadPoints) {
    const h = session.physics.world.castRay(new RAPIER.Ray({ x: px, y: 5, z: pz }, { x: 0, y: -1, z: 0 }), 50, true);
    if (h && Math.abs(h.timeOfImpact - (5 - 0.09)) < 0.4) roadHits += 1; // road surface ≈ y=0.09
  }
  check('restored ground trimesh catches downward rays at road level along the route',
    roadHits === roadPoints.length, `${roadHits}/${roadPoints.length} waypoints hit road surface`);

  bm.dispose();
  check('manager dispose leaves no colliders; physics world still alive', worldCounts(session.physics).colliders === 0, '');
  session.physics.dispose();
}

// --- 4. adjacent placeholders sync across revoke/restore (相邻占位同步)
{
  const session = buildSession();
  const { scene } = freshGraph();
  const bm = new BlockManager({ RAPIER, physics: session.physics, views: createBlockViews(scene, session), dataset });
  await bm.applyReviewed();
  await bm.loadBlock('block-adjacent-east');
  const east = bm.blocks.get('block-adjacent-east');
  const withReview = east.placeholders.filter(p => p.ph.replacedBy === 'block-review-street').length;
  check('replaced placeholders suppressed while reviewed street active', withReview === 0, String(withReview));

  await bm.revokeReviewed(); // refreshes the loaded east block in place
  const afterRevoke = east.placeholders.filter(p => p.ph.replacedBy === 'block-review-street').length;
  check('revoke restores replaced placeholders in the adjacent block without manual reload',
    east.state === 'loaded' && afterRevoke === replacedInEast.length,
    `state=${east.state} spawned=${afterRevoke}/${replacedInEast.length}`);

  await bm.restoreReviewed();
  const afterRestore = east.placeholders.filter(p => p.ph.replacedBy === 'block-review-street').length;
  check('restore suppresses them again (adjacent block refreshed symmetrically)',
    east.state === 'loaded' && afterRestore === 0, `spawned=${afterRestore}`);

  const counts = worldCounts(session.physics);
  check('post-cycle physics holds walls + ground + the surviving east placeholders',
    counts.bodies === WALLS + 1 + east.placeholders.length,
    JSON.stringify({ ...counts, placeholders: east.placeholders.length }));
  bm.dispose();
  check('dispose removes block-owned colliders; physics world still usable',
    worldCounts(session.physics).colliders === 0);
  session.physics.dispose();
}

// --- 5. teardown order: late-arriving loads never touch the freed world
{
  const session = buildSession();
  const { scene } = freshGraph();
  const bm = new BlockManager({ RAPIER, physics: session.physics, views: createBlockViews(scene, session), dataset });
  await bm.loadBlock('block-adjacent-east');
  // a view factory whose first placeholder creation is genuinely in flight
  const factory = createBlockViews(scene, null);
  let release;
  const gate = new Promise(r => { release = r; });
  const gatedViews = {
    add() {}, remove() {},
    makePlaceholder: async (ph) => { await gate; return factory.makePlaceholder(ph); },
    disposePlaceholder: (v) => v.dispose(),
    makeReviewed: () => factory.makeReviewed(),
    discardReviewed: (p) => factory.discardReviewed(p),
    disposeReviewed() {},
  };
  const bm2 = new BlockManager({ RAPIER, physics: session.physics, views: gatedViews, dataset });
  const slow = bm2.loadBlock('block-adjacent-west');
  bm2.dispose();          // ordered teardown first …
  release();
  const res = await slow; // … the late result must discard itself, not activate
  check('in-flight load after dispose discards without activating',
    res.stale === true && res.disposed === true, `stale=${res?.stale} disposed=${res?.disposed}`);
  bm.dispose();
  let freedOk = true;
  try { session.physics.dispose(); session.physics.dispose(); } catch (e) { freedOk = false; console.log(String(e)); }
  check('physics world frees cleanly after manager dispose', freedOk);
  const late = await bm2.loadBlock('block-adjacent-east');
  check('loads requested after dispose are refused without touching the freed world',
    late.stale === true && late.disposed === true, JSON.stringify(late));
}

// --- 6. stale reviewed load between revoke and completion hands the takeover back
{
  const session = buildSession();
  const { scene } = freshGraph();
  const factory = createBlockViews(scene, session);
  const slowViews = {
    add: (o, p) => factory.add(o, p), remove: (o) => factory.remove(o),
    makePlaceholder: (ph) => factory.makePlaceholder(ph),
    disposePlaceholder: (v) => v.dispose(),
    makeReviewed: async () => { await new Promise(r => setTimeout(r, 15)); return factory.makeReviewed(); },
    discardReviewed: (p) => factory.discardReviewed(p),
    disposeReviewed() {},
  };
  const bm = new BlockManager({ RAPIER, physics: session.physics, views: slowViews, dataset });
  const slow = bm.loadBlock('block-review-street', { reviewed: true });
  bm.unloadBlock('block-review-street'); // bumps epoch while the takeover is in flight
  const res = await slow;
  check('stale reviewed load is discarded', res.stale === true, `stale=${res?.stale}`);
  check('takeover handles handed back intact — walls never destroyed by the stale path',
    worldCounts(session.physics).colliders === WALLS + 1, JSON.stringify(worldCounts(session.physics)));
  await bm.restoreReviewed(); // takeover still valid -> applied normally now
  check('reviewed street applies after the takeover was handed back',
    bm.activeIds().includes('block-review-street') && worldCounts(session.physics).colliders === WALLS + 1, '');
  bm.dispose();
  session.physics.dispose();
}

console.log(failures === 0 ? 'BLOCK_PRODUCTION PASS' : `BLOCK_PRODUCTION FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
