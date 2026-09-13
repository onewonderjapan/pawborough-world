// three.js view factory for the block lifecycle — neutral gray low-poly
// extrusions of map placeholders, no invented historical detail.
//
// With a `session` (the loaded WorldLoader handle) this factory also owns the
// REAL reviewed street: `makeReviewed()` hands out the actual world root plus
// the WorldLoader-created wall/ground collider handles on first activation.
// After a revoke destroyed those handles, later activations re-create them
// from the same collision records via the same physics helpers
// (addWallCollider/addGroundCollider), so restore is byte-identical and never
// stacks. Node tests run the placeholder path without a session and the
// reviewed path against a real session-shaped handle.
import * as T from 'three';
import { addWallCollider, addGroundCollider, removeColliderWithBody } from './physics.js';

export function createBlockViews(scene, session = null) {
  const material = new T.MeshStandardMaterial({ color: 0x9aa09b, roughness: .95 });
  // captured ONCE while the root is still attached: after a revoke the root
  // has no parent, and re-adding it to the scene root would break main.js's
  // container traversal (resources/telemetry walk the original container)
  const reviewedParent = session ? (session.root.parent ?? scene) : null;
  // live WorldLoader handles, claimable exactly once; afterwards the reviewed
  // street is re-created from records on every activation
  let takeover = session ? {
    colliders: session.physics.colliders.map(c => ({ collider: c.collider, body: c.body })),
    ground: { collider: session.physics.groundCollider, body: session.physics.groundBody },
  } : null;
  const api = {
    add(obj, parent) { if (obj) (parent ?? scene).add(obj); },
    remove(obj) { if (obj) obj.removeFromParent(); },
    makePlaceholder(ph) {
      const geo = new T.BoxGeometry(ph.widthM, ph.heightM, ph.depthM);
      const mesh = new T.Mesh(geo, material);
      mesh.position.set(ph.glbPoint[0], ph.heightM / 2, ph.glbPoint[1]);
      mesh.rotation.y = ph.angleRad;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `placeholder__${ph.id}`;
      return { object: mesh, dispose() { geo.dispose(); } };
    },
    disposePlaceholder(v) { v.dispose(); },
    // group + live colliders for the reviewed street; `owns` marks parts this
    // factory created (must be removed if the load is discarded) versus
    // takeover parts (must be handed back, they are live in the physics world)
    async makeReviewed() {
      if (!session) throw new Error('blockViews: reviewed street requires the loaded world session');
      if (takeover) {
        const parts = {
          group: session.root, parent: reviewedParent,
          colliders: takeover.colliders, ground: takeover.ground, owns: false,
        };
        takeover = null;
        return parts;
      }
      const world = session.physics.world;
      return {
        group: session.root, parent: reviewedParent,
        colliders: session.collision.colliders.map((record) => {
          const c = addWallCollider(session.RAPIER, world, record);
          return { collider: c.collider, body: c.body };
        }),
        ground: addGroundCollider(session.RAPIER, world, session.groundTriangles),
        owns: true,
      };
    },
    // a load that went stale between makeReviewed() and apply: takeover parts
    // return to the claimable pool, factory-created parts leave the world
    discardReviewed(parts) {
      if (!parts) return;
      if (parts.owns) {
        const world = session.physics.world;
        for (const c of parts.colliders) removeColliderWithBody(world, c.collider, c.body);
        if (parts.ground) removeColliderWithBody(world, parts.ground.collider, parts.ground.body);
      } else {
        takeover = { colliders: parts.colliders, ground: parts.ground };
      }
    },
    // geometry disposal stays with session.dispose (it traverses the root);
    // collider teardown is BlockManager's job while the physics world lives
    disposeReviewed() {},
  };
  return api;
}
