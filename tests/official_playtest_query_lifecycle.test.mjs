// Independent small fixture for the script bug found by live Flash traversal.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { FoodRoutePlanner } from './lib/food-route-planner.mjs';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
try {
  const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(5, .1, 5).setTranslation(0, -.1, 0));
  world.step();
  const planner = new FoodRoutePlanner({ physics: { world }, groundColliders: [ground], RAPIER });
  assert.ok(planner.checkPoint(0, 0), 'initial clear road is traversable');
  world.createCollider(RAPIER.ColliderDesc.cuboid(.475, .4, .325).setTranslation(0, .4, 0));
  world.step();
  assert.ok(planner.wallOverlap(0, .48, 0), 'updated world sees new cart');
  assert.ok(planner.checkPoint(0, 0), 'stale navigation cache alone still wrongly accepts road');
  planner.probeCache.clear();
  assert.equal(planner.checkPoint(0, 0), null, 'query refresh plus cache invalidation rejects occupied waypoint');
  console.log('OFFICIAL_PLAYTEST_QUERY_LIFECYCLE PASS');
} finally { world.free(); }
