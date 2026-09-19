// P (closeout batch 20260919) — FAILURE NEGATIVES for the review_repairs
// regressions. The positive tests in tests/review_repairs.test.mjs only prove
// something when a mutation actually breaks them; these negatives apply each
// historical defect IN MEMORY (the committed files are never modified) and
// assert the check now FAILS:
//
//   1. removing the two ground stucco wing-wall colliders -> the capsule at
//      (±2.4, 1.01, -27.085) passes THROUGH (both sides) — the wing walls are
//      what blocks, not the elevated flank guards;
//   2. dropping pos.y from the strip records' AABB derivation (the pre-repair
//      bug: min/max Y flattened to center-less ranges) -> the eight strips no
//      longer satisfy [0, 2.9];
//   3. expected values are computed from src/world/collisionAdapter.obbToWorld
//      (the production formula) — never by copying a buggy formula as truth.
//
// The rebuild harness (tools/closeout_rebuild.mjs) proves the adopted datasets
// equal the regenerated ones (canonical collider comparison), so these
// negatives transfer to the rebuilt outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import { addWallCollider } from '../src/world/physics.js';
import { obbToWorld } from '../src/world/collisionAdapter.js';

const json = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
await R.init();
const castOutward = (w, side) => w.castShape(
  { x: side * 2.4, y: 1.01, z: -27.085 },
  { x: 0, y: 0, z: 0, w: 1 },
  { x: side, y: 0, z: 0 },
  new R.Capsule(0.6, 0.35), 0, 1.3, true);

test('NEGATIVE: without the ground wing walls the axis crossing is NOT blocked (the positive test detects the defect)', async () => {
  const data = json('world/temple-axis-v3/collision-world.json');
  const before = data.colliders.filter((c) => c.name === 'yimenstage:stage-wing-wall');
  assert.equal(before.length, 2, 'sidecar must carry exactly two wing walls');
  const w = new R.World({ x: 0, y: 0, z: 0 });
  try {
    for (const c of data.colliders.filter((c) => c.name !== 'yimenstage:stage-wing-wall')) addWallCollider(R, w, c);
    w.step();
    for (const side of [-1, 1]) {
      const hit = castOutward(w, side);
      assert.equal(hit, null, `without wing walls side ${side} must pass through — if this fails, something ELSE blocks there and the review_repairs positive test is not actually pinned to the wing walls`);
    }
  } finally { w.free(); }
});

test('NEGATIVE: dropping pos.y from the strips Y derivation breaks the [0, 2.9] assertion', () => {
  const data = json('world/fangbang-temple-v4/collision-world.json');
  const strips = data.colliders.filter((r) => /^(westshops|eastshops)-strips:/.test(r.name));
  assert.equal(strips.length, 8);
  for (const r of strips) {
    // honest current state: Y from the record's own obb (pos.y + center.y ± size.y/2)
    const { center, halfExtents } = obbToWorld(r);
    assert.deepEqual([Math.round((center[1] - halfExtents[1]) * 1e5) / 1e5, Math.round((center[1] + halfExtents[1]) * 1e5) / 1e5],
      [r.min[1], r.max[1]], r.name + ': production formula must reproduce the stored AABB');
    assert.deepEqual([r.min[1], r.max[1]], [0, 2.9], r.name);
    // the DEFECT: ignore pos[1] (treat the box as sitting at y=0) — exactly the
    // pre-repair flattening. Recompute with pos.y dropped:
    const buggy = {
      ...r,
      obb: { ...r.obb, pos: [r.obb.pos[0], 0, r.obb.pos[2]] },
    };
    const b2 = obbToWorld(buggy);
    const yLo = Math.round((b2.center[1] - b2.halfExtents[1]) * 1e5) / 1e5;
    const yHi = Math.round((b2.center[1] + b2.halfExtents[1]) * 1e5) / 1e5;
    assert.notDeepEqual([yLo, yHi], [0, 2.9],
      r.name + ': dropping pos.y must visibly break the [0,2.9] assertion — if it still passes, the strips assertion cannot detect the regression');
  }
});
