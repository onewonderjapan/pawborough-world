// lanes-v2 batch tests — placement/manifest/budget/ground-contract integrity
// for the fangbang-temple-v5 candidate dataset. Node-runnable data checks; the
// live capsule verification lives in tools/lanes_x3_walk_capture.mjs (browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFile(resolve(root, p));

test('lanes-v2: v5 manifest matches the patched assembly byte-for-byte', async () => {
  const m = JSON.parse(await read('world/fangbang-temple-v5/review-manifest.json'));
  const b = await read('world/fangbang-temple-v5/street-reviewed-lanes.glb');
  assert.equal(b.byteLength, m.worldAssembly.bytes);
  assert.equal(sha(b), m.worldAssembly.sha256);
  assert.equal(m.placedTriangles, 171419, 'assembly = v4 placed minus the 45 placeholder triangles');
  assert.equal(m.ownerAdopted, false);
});

test('lanes-v2: every lane asset is manifest-matched with true bytes/sha/triangles', async () => {
  const m = JSON.parse(await read('world/fangbang-temple-v5/review-manifest.json'));
  const blocks = JSON.parse(await read('world/fangbang-temple-v5/blocks.json'));
  const block = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
  assert.ok(block && block.autoApply);
  for (const a of block.assets) {
    const entry = m.lanesV2.assets.find((e) => e.id === a.id);
    assert.ok(entry, `asset ${a.id} missing from manifest.lanesV2`);
    const glb = await read(a.glb.replace('./', ''));
    assert.equal(sha(glb), entry.sha256, `${a.id} glb sha`);
    assert.equal(glb.byteLength, entry.bytes, `${a.id} glb bytes`);
    assert.ok(entry.triangles > 0 && entry.triangles < 30000, `${a.id} triangle record`);
  }
});

test('lanes-v2: budgets (caps are ceilings, not quotas)', async () => {
  const m = JSON.parse(await read('world/fangbang-temple-v5/review-manifest.json'));
  const b = m.lanesV2.budgets;
  assert.ok(b.laneA <= 30000);
  assert.ok(b.laneB <= 30000);
  assert.ok(b.interfaces <= 20000);
  assert.ok(b.totalAdded <= 80000);
  assert.equal(b.totalAdded, b.laneA + b.laneB + b.interfaces);
});

test('lanes-v2: module sidecars are world-space obb records with sane bounds', async () => {
  const sideA = JSON.parse(await read('world/lanes-v2/lane-a/collision.json'));
  assert.ok(sideA.colliders.length >= 4);
  assert.equal(sideA.yawRad, 3.1165);
  for (const r of sideA.colliders) {
    assert.ok(r.obb && r.obb.pos && r.min && r.max, `${r.name}: world obb + aabb`);
    const c = [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, (r.min[2] + r.max[2]) / 2];
    assert.ok(Math.abs(c[0] - (r.obb.pos[0] + r.obb.center[0])) < 12, `${r.name} aabb near portal x`);
    assert.ok(c[2] < -10 && c[2] > -30, `${r.name} aabb z inside lane A corridor`);
  }
});

test('lanes-v2: placeholder walls are gone from the v5 collision world', async () => {
  const c = JSON.parse(await read('world/fangbang-temple-v5/collision-world.json'));
  assert.ok(!c.colliders.some((r) => r.name === 'lane-A-end-wall'));
  assert.ok(!c.colliders.some((r) => r.name === 'lane-B-end-wall'));
});

test('lanes-v2: walkable-ground node naming contract (extractor regex)', async () => {
  const { GROUND_NODE_RE } = await import('../src/world/collisionAdapter.js');
  for (const name of ['lanes-v2__paving-frontage', 'lanes-v2__worn-stone']) assert.ok(GROUND_NODE_RE.test(name), name);
  for (const name of ['lanes-v2__weathered-lime-plaster', 'street-kit__dark-iron']) assert.ok(!GROUND_NODE_RE.test(name), name);
});

test('lanes-v2: route excursions reach the designed depths', async () => {
  const r = JSON.parse(await read('world/fangbang-temple-v5/route.json'));
  const lastA = r.laneAExcursion[r.laneAExcursion.length - 1];
  const lastB = r.laneBExcursion[r.laneBExcursion.length - 1];
  assert.equal(lastA[0].toFixed(1), '43.7'); // portal + 7.5m inward
  assert.ok(lastA[2] < -23.5, 'lane A excursion beyond -23.5 (8m lane interior)');
  assert.equal(lastB[2].toFixed(1), '22.6'); // portal + 9.4m inward
  assert.ok(lastB[0] < 53.5 && lastB[0] > 52.5, 'lane B pocket end x');
});
