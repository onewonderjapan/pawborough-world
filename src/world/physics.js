// Physics world construction from world data — production code shared by the
// browser WorldLoader and node tests, so the collision used in play is exactly
// the collision tested.
//
// Walls: one Rapier cuboid per collision-world.json record, placed through the
// shared obbToWorld() transform (local center + instance yaw). The record's
// AABB is yaw-expanded and is NOT used as a collider — using it would seal the
// diagonal street and every doorway.
// Ground: a static trimesh built ONLY from the lead-verified road / frontage
// paving / worn-stone faces of the assembled GLB (see groundExtractor). No
// synthetic city-wide slab exists anywhere in this pipeline.

import { obbToWorld as obbToWorldRecord } from './collisionAdapter.js';

export function buildPhysicsWorld(RAPIER, { collision, groundTriangles }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const colliders = [];
  for (const record of collision.colliders) {
    const { center, halfExtents, yaw } = obbToWorldRecord(record);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]));
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
      .setRotation({ w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 });
    colliders.push({ handle: world.createCollider(desc, body), record });
  }
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const groundCollider = world.createCollider(
    RAPIER.ColliderDesc.trimesh(groundTriangles.positions, groundTriangles.indices), groundBody);
  // Prime the query pipeline: until the first world.step() the broad-phase is
  // empty and shape casts (including the character controller) see nothing.
  world.step();
  let disposed = false;
  return {
    world,
    colliders,
    groundCollider,
    wallCount: colliders.length,
    groundTriangleCount: groundTriangles.indices.length / 3,
    dispose() {
      if (disposed) return;
      disposed = true;
      world.free();
    },
  };
}
