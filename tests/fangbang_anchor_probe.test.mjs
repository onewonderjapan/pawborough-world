// Player-experience batch A regression: anchor validation must not misjudge a
// location as blocked just because a LIVE player capsule exists in the same
// physics world (the 20260920 root cause — the page validated bridgeStart
// while the live controller stood on exactly that point; an independent
// Rapier repro showed validateAnchor([0,0,0]) ok alone but "blocked at the
// mouth" with a live WalkController spawned at [0,1,0]). The probe must
// target the STATIC scene only, while real blocking and no-ground rejection
// keep working. Run: node --test tests/fangbang_anchor_probe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';

import { validateAnchor } from '../src/player/entryAnchors.js';
import { WalkController } from '../src/player/WalkController.js';

await RAPIER.init();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const P = [0, 0, 0];   // anchor point on the ground plane

function flatWorld({ wall = false } = {}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const physics = { world };
  // ground: top face exactly at y=0
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0), ground);
  if (wall) {   // solid wall 1.2 m ahead of P along the anchor's heading (-Z)
    const w = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1.5, 0.3).setTranslation(0, 1.5, -1.2), w);
  }
  world.step();   // prime the query pipeline (same as buildPhysicsWorld)
  return physics;
}
const anchorAtP = { id: 'probe', position: [...P], yaw: 0 };   // faces -Z

test('baseline: validateAnchor passes on clear static ground (no live player)', async () => {
  const v = await validateAnchor({ RAPIER, physics: flatWorld(), capsule: CAPSULE, anchor: anchorAtP });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(v.advancedM >= 0.8, `advanced ${v.advancedM}`);
});

test('coexisting live player does NOT cause a false blockage', async () => {
  const physics = flatWorld();
  const live = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [0, 1, 0] } });
  try {
    const v = await validateAnchor({ RAPIER, physics, capsule: CAPSULE, anchor: anchorAtP,
      excludeColliderHandles: [live.collider.handle] });
    assert.equal(v.ok, true, `misjudged with a live player present: ${JSON.stringify(v)}`);
    // the probe never disturbs the live player it excluded
    const f = live.feetPosition();
    assert.ok(Math.abs(f[0]) < 0.02 && Math.abs(f[2]) < 0.02, `live player moved: ${f}`);
  } finally {
    live.dispose();
  }
}, { timeout: 60000 });

test('real blocking is still reported through the same exclusion path', async () => {
  const physics = flatWorld({ wall: true });
  const live = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [0, 1, 0] } });
  try {
    const v = await validateAnchor({ RAPIER, physics, capsule: CAPSULE, anchor: anchorAtP,
      excludeColliderHandles: [live.collider.handle] });
    assert.equal(v.ok, false, 'a real wall must still block the probe');
    assert.equal(v.reason, 'blocked at the mouth', JSON.stringify(v));
  } finally {
    live.dispose();
  }
}, { timeout: 60000 });

test('no ground is still rejected through the same exclusion path', async () => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const physics = { world };
  const live = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [0, 1, 0] } });
  try {
    const v = await validateAnchor({ RAPIER, physics, capsule: CAPSULE, anchor: anchorAtP,
      excludeColliderHandles: [live.collider.handle] });
    assert.equal(v.ok, false, 'a groundless point must be rejected');
    assert.ok(v.reason === 'never grounded' || v.reason === 'unsafe height' || v.reason === 'fell while walking in',
      JSON.stringify(v));
  } finally {
    live.dispose();
  }
}, { timeout: 60000 });
