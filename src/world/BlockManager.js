// N6 block lifecycle manager — the data/lifecycle layer for map-driven
// districts. One stable-ID layout (world/blocks.json) drives placeholders,
// their low-poly views AND their collision; the reviewed street is itself a
// block whose replacesBaseIds suppress overlapping placeholders (no stacking)
// and whose revocation restores them (撤回恢复).
//
// The reviewed block owns the REAL street: the session-backed view factory
// (blockViews.createBlockViews(scene, session)) hands over the actual
// WorldLoader root group and the live wall/ground collider handles, so a
// revoke removes the geometry AND its collision, and a restore re-creates
// exactly the same set (no stacking, no null-group placeholder).
//
// Guarantees (covered by tests/block_lifecycle.test.mjs and
// tests/block_production.test.mjs):
//   - enter/exit symmetric: load adds exactly the block's views+colliders,
//     unload removes exactly them (渲染和碰撞同生命周期)
//   - replacement never stacks (替换不叠加)
//   - late-arriving loads of a stale epoch are discarded (晚到版本不覆盖新布局)
//   - revoking the reviewed block restores its replaced placeholders and
//     refreshes loaded adjacent blocks in place (相邻占位同步)
//   - dispose before physics.dispose(); any load still in flight discards
//     itself and never touches the freed world (晚到结果不激活)
// Rendering is abstracted behind a view factory so node tests run without WebGL.

import { obbToWorld } from './collisionAdapter.js';
import { removeColliderWithBody } from './physics.js';

const LOAD_RADIUS = 30;   // m beyond block AABB the block stays loaded (hysteresis)
const ADJACENT_IDS = ['block-adjacent-east', 'block-adjacent-west'];

export class BlockManager {
  constructor({ RAPIER, physics, views, dataset }) {
    this.RAPIER = RAPIER;
    this.physics = physics;             // { world } from buildPhysicsWorld
    this.views = views;                 // { add(obj, parent?), remove(obj), makePlaceholder(ph), disposePlaceholder(v), makeReviewed() -> {group, parent?, colliders, ground, owns}, discardReviewed?(parts), disposeReviewed?() }
    this.dataset = dataset;
    this.blocks = new Map();            // id -> {def, state, epoch, views, colliders, placeholders, reviewed}
    this.epoch = 0;                     // bumped on every unload; stale loads are discarded
    this.byPlaceholder = new Map(dataset.placeholders.map(p => [p.id, p]));
    for (const b of dataset.blocks) {
      this.blocks.set(b.id, { def: b, state: 'unloaded', epoch: 0, views: [], colliders: [], placeholders: [], reviewed: null });
    }
    this.disposed = false;
  }

  placeholderCollider(ph) {
    // rotated box from map data via the SHARED transform math (render and
    // collision agree by construction)
    const rec = {
      name: `placeholder:${ph.id}`, type: 'box',
      obb: { pos: [ph.glbPoint[0], 0, ph.glbPoint[1]], theta: ph.angleRad, center: [0, ph.heightM / 2, 0], size: [ph.widthM, ph.heightM, ph.depthM] },
      min: [0, 0, 0], max: [0, ph.heightM, 0],
    };
    return obbToWorld(rec);
  }

  async loadBlock(id, { reviewed = false } = {}) {
    const block = this.blocks.get(id);
    if (!block) throw new Error(`block lifecycle: unknown block ${id}`);
    if (this.disposed) return { stale: true, disposed: true, block };
    if (block.state === 'loaded' || block.state === 'loading') return block; // never stack
    block.state = 'loading';
    const epochAtStart = this.epoch;

    // gather content
    let views = [];
    let colliders = [];
    let placeholders = [];
    let reviewedParts = null;
    if (reviewed) {
      const made = await this.views.makeReviewed();
      if (this.disposed) { block.state = 'unloaded'; return { stale: true, disposed: true, block }; }
      reviewedParts = made;
      views = [made.group];
      colliders = made.colliders.map(c => c.collider);
    } else {
      for (const phId of block.def.placeholderIds ?? []) {
        const ph = this.byPlaceholder.get(phId);
        if (!ph) throw new Error(`block lifecycle: placeholder ${phId} missing from dataset`);
        // replaced placeholders never spawn while their replacement is active
        if (ph.replacedBy && this.blocks.get(ph.replacedBy)?.state === 'loaded') continue;
        const view = await this.views.makePlaceholder(ph); // awaitable: allows genuinely in-flight loads
        // teardown may have happened while we awaited — never touch the freed
        // physics world with late results
        if (this.disposed) {
          this.views.disposePlaceholder?.(view);
          block.state = 'unloaded';
          return { stale: true, disposed: true, block };
        }
        const { center, halfExtents, yaw } = this.placeholderCollider(ph);
        const body = this.physics.world.createRigidBody(
          this.RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]));
        const collider = this.physics.world.createCollider(
          this.RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
            .setRotation({ w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 }), body);
        placeholders.push({ ph, view, body, collider });
      }
      views = placeholders.map(p => p.view.object);
      colliders = placeholders.map(p => p.collider);
    }

    // late-arrival guard: if anything was unloaded while we were building,
    // this load is stale and must not touch the new layout
    if (this.epoch !== epochAtStart) {
      for (const p of placeholders) {
        this.physics.world.removeCollider(p.collider, false);
        this.physics.world.removeRigidBody(p.body);
        this.views.disposePlaceholder?.(p.view);
      }
      if (reviewedParts) this.views.discardReviewed?.(reviewedParts);
      block.state = 'unloaded';
      return { stale: true, block };
    }

    block.views = views; block.colliders = colliders; block.placeholders = placeholders; block.reviewed = reviewedParts;
    for (const v of views) this.views.add(v, reviewedParts?.parent);
    block.state = 'loaded';
    this.primePipeline();
    return { stale: false, block };
  }

  // Re-prime the broad-phase after collider set changes (same reason
  // buildPhysicsWorld steps once at creation): the character controller's
  // next query must see the freshly created/removed colliders immediately.
  primePipeline() {
    if (this.disposed) return;
    this.physics.world.step();
  }

  unloadBlock(id) {
    const block = this.blocks.get(id);
    if (!block) throw new Error(`block lifecycle: unknown block ${id}`);
    if (block.state === 'unloaded') return;
    // remove whatever content is currently applied; a load still in flight
    // keeps its own epoch/disposed guard and will discard itself
    for (const v of block.views) this.views.remove(v);
    if (block.reviewed) {
      // real street ownership: walls + ground trimesh leave the world with
      // their rigid bodies, in the same order they were created
      for (const c of block.reviewed.colliders) removeColliderWithBody(this.physics.world, c.collider, c.body);
      if (block.reviewed.ground) removeColliderWithBody(this.physics.world, block.reviewed.ground.collider, block.reviewed.ground.body);
      block.reviewed = null;
    }
    for (const p of block.placeholders) {
      this.physics.world.removeCollider(p.collider, false);
      this.physics.world.removeRigidBody(p.body);
      this.views.disposePlaceholder?.(p.view);
    }
    block.views = []; block.colliders = []; block.placeholders = [];
    block.state = 'unloaded';
    this.epoch += 1; // any in-flight load for this block is now stale
    this.primePipeline();
  }

  // reviewed street replacement semantics. Both directions refresh loaded
  // adjacent blocks so placeholder spawns/suppressions stay in sync with the
  // reviewed state immediately (相邻占位同步), not just on the next
  // position-driven unload/reload cycle.
  async applyReviewed() {
    const res = await this.loadBlock('block-review-street', { reviewed: true });
    await this.refreshAdjacent();
    return res;
  }
  async revokeReviewed() {
    this.unloadBlock('block-review-street');
    await this.refreshAdjacent();
  }
  async refreshAdjacent() {
    // 撤回恢复: replaced placeholders spawn once the reviewed street is gone;
    // restoring it suppresses them again
    for (const id of ADJACENT_IDS) {
      if (this.blocks.get(id)?.state === 'loaded') {
        this.unloadBlock(id);
        await this.loadBlock(id);
      }
    }
  }
  restoreReviewed() { return this.applyReviewed(); }

  activeIds() { return [...this.blocks.values()].filter(b => b.state === 'loaded').map(b => b.def.id); }
  colliderCount() { return this.blocks.size && [...this.blocks.values()].reduce((s, b) => s + b.placeholders.length, 0); }

  // position-driven cycling (called each frame with the capsule position)
  update(px, pz) {
    if (this.disposed) return;
    // placeholder blocks cycle by adjacency to the street ends
    const east = this.blocks.get('block-adjacent-east');
    const west = this.blocks.get('block-adjacent-west');
    const [X0, X1] = this.dataset.streetExtentX;
    const wantEast = px > X1 - LOAD_RADIUS;
    const wantWest = px < X0 + LOAD_RADIUS;
    if (wantEast && east.state === 'unloaded') void this.loadBlock('block-adjacent-east');
    if (!wantEast && east.state === 'loaded') this.unloadBlock('block-adjacent-east');
    if (wantWest && west.state === 'unloaded') void this.loadBlock('block-adjacent-west');
    if (!wantWest && west.state === 'loaded') this.unloadBlock('block-adjacent-west');
  }

  // Ordered teardown — MUST run while the physics world is still alive
  // (main.js: blocks.dispose() before session.dispose()). An async load still
  // in flight sees this.disposed afterwards and discards itself without
  // touching the world the owner is about to free.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.blocks.keys()]) {
      try { this.unloadBlock(id); } catch { /* already unloaded */ }
    }
  }
}
