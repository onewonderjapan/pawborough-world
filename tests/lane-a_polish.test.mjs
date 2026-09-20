// lane-a-polish batch tests — v6 candidate dataset integrity, budgets in the
// two SEPARATE display configurations, world-space collision sidecars, and
// the lead-fixed threshold surface contract (top <= floor + 0.02).
// The runtime walk evidence lives in tools/lane_a_polish_walktest.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFile(resolve(root, p));
const json = async (p) => JSON.parse(await read(p));

test('lane-a-polish: v6 manifest matches the real assembly and asset files', async () => {
  const m = await json('world/fangbang-temple-v6/review-manifest.json');
  const asm = await read('world/fangbang-temple-v6/street-reviewed-lanes.glb');
  assert.equal(asm.byteLength, m.worldAssembly.bytes);
  assert.equal(sha(asm), m.worldAssembly.sha256, 'assembly copied byte-exact from v5');
  assert.equal(m.placedTriangles, 171419);
  assert.equal(m.ownerAdopted, false);
  const blocks = await json('world/fangbang-temple-v6/blocks.json');
  const lanes = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
  assert.ok(lanes && lanes.autoApply);
  for (const a of lanes.assets) {
    const entry = m.lanesV2.assets.find((e) => e.id === a.id);
    assert.ok(entry, `asset ${a.id} missing from manifest.lanesV2`);
    const glb = await read(a.glb.replace('./', ''));
    assert.equal(sha(glb), entry.sha256, `${a.id} glb sha`);
    assert.equal(glb.byteLength, entry.bytes, `${a.id} glb bytes`);
    // manifest triangle records must equal the builder-measured sidecars
    // (only the NEW assets carry measurements.json; lane-b-v2 inherits v5 numbers)
    if (a.glb.startsWith('./world/lane-a-polish/')) {
      const side = await json(a.glb.replace('model.glb', 'measurements.json'));
      assert.equal(entry.triangles, side.triangles, `${a.id} triangles vs builder measurement`);
    }
  }
});

test('lane-a-polish: v6 budgets — A scope targets + base ceiling, itemized', async () => {
  const m = await json('world/fangbang-temple-v6/review-manifest.json');
  const b = m.lanesV2.budgets;
  assert.ok(b.laneA.actual <= 4000, `lane-a ${b.laneA.actual} <= 4000`);
  assert.ok(b.interfaces.actual <= 950, `interfaces ${b.interfaces.actual} <= 950 (east mouth wall included)`);
  assert.equal(b.totalAdded, b.laneA.actual + b.laneB + b.interfaces.actual);
  assert.ok(m.budgets.fullSceneV6Tris <= 700000, `page-default base ${m.budgets.fullSceneV6Tris} <= 700000`);
  // v6 replaced v5's lane-a(7290)+interfaces(876) inside the same page total
  assert.equal(m.budgets.fullSceneV6Tris, 703049 - 7290 - 876 + b.laneA.actual + b.interfaces.actual);
});

test('lane-a-polish: skins+props all-on is a SEPARATE config, never claimed under the base ceiling', async () => {
  const cap = await json('artifacts/lane-a-polish/web-capture.json');
  const base = cap.budgets.base.triangles;
  const allOn = cap.budgets.skinsAndProps.triangles;
  assert.ok(base <= 700000, `runtime base ${base}`);
  assert.ok(allOn > base, 'all-on adds skins+props on top of base');
  // recorded as its own line; over the ceiling is a fact, not a failure of base
  assert.ok(allOn > 700000, `all-on ${allOn} recorded separately (over the base ceiling by ${allOn - 700000})`);
});

test('lane-a-polish: module sidecars are world-space obb records, walls keep v5 names', async () => {
  const sideA = await json('world/lane-a-polish/lane-a/collision.json');
  assert.equal(sideA.yawRad, 3.1165);
  assert.deepEqual(sideA.origin, [43.545, 0.09, -16.375]);
  const names = sideA.colliders.map((r) => r.name);
  for (const n of ['lane-a:wall-west-s1', 'lane-a:wall-west-s2', 'lane-a:wall-east',
    'lane-a:rear-door-backwall', 'lane-a:end-band-below', 'lane-a:end-band-above'])
    assert.ok(names.includes(n), `${n} kept`);
  for (const r of sideA.colliders) {
    assert.ok(r.obb && r.min && r.max, `${r.name}: obb + aabb`);
    const cz = (r.min[2] + r.max[2]) / 2;
    assert.ok(cz < -10 && cz > -30, `${r.name} aabb z inside lane A`);
  }
  const sideI = await json('world/lane-a-polish/interfaces/collision.json');
  const iNames = sideI.colliders.map((r) => r.name);
  assert.ok(iNames.includes('lane-a:wall-east-mouth'), 'new east mouth wall collider present');
  assert.ok(iNames.includes('interfaces:a-jamb-west') && iNames.includes('interfaces:a-jamb-east'), 're-anchored piers');
  const wall = sideI.colliders.find((r) => r.name === 'lane-a:wall-east-mouth');
  // closes the gap between N06's NW corner and the module east wall
  assert.ok(wall.min[0] > 44.6 && wall.max[0] < 45.11 && wall.min[2] < -16.4 && wall.max[2] > -14.8);
});

test('lane-a-polish: threshold surface <= floor + 0.02 (lead fix; no 4 cm bump)', async () => {
  // worst walkable worn-stone top inside the portal band, measured from the
  // exported GLB in world space (holder T y=0.09)
  const { readGlb } = await import('../src/world/glbReader.js');
  const glb = readGlb(await read('world/lane-a-polish/lane-a/model.glb'));
  const cy = Math.cos(3.1165), sy = Math.sin(3.1165);
  let worst = 0;
  for (const mesh of glb.meshes) {
    if (!/^lanes-v2__worn-stone$/.test(mesh.name)) continue;
    const p = mesh.positions, ix = mesh.indices;
    for (let i = 0; i < ix.length; i += 3) {
      for (const k of [ix[i], ix[i + 1], ix[i + 2]]) {
        const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
        // local -> world; portal band = |local s| <= 0.20 at |local x| <= 1.2
        const ls = sy * (x) + cy * (z);
        const lx = cy * x - sy * z;
        if (Math.abs(ls) <= 0.20 && Math.abs(lx) <= 1.2) worst = Math.max(worst, 0.09 + y);
      }
    }
  }
  assert.ok(worst > 0.095, `a threshold stone exists in the band (worst top ${worst})`);
  assert.ok(worst <= 0.09 + 0.02 + 1e-6, `portal threshold top ${worst} <= 0.11`);
});

test('lane-a-polish: v6 blocks point only at the new A assets; B untouched', async () => {
  const blocks = await json('world/fangbang-temple-v6/blocks.json');
  const lanes = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
  const laneA = lanes.assets.find((a) => a.id === 'lane-a');
  const ifc = lanes.assets.find((a) => a.id === 'lanes-interfaces');
  const laneB = lanes.assets.find((a) => a.id === 'lane-b-v2');
  assert.ok(laneA.glb.startsWith('./world/lane-a-polish/'));
  assert.ok(ifc.glb.startsWith('./world/lane-a-polish/'));
  assert.equal(laneB.glb, './world/lanes-v2/lane-b-v2/model.glb', 'lane-b-v2 stays the v5 asset');
  assert.deepEqual(laneA.positionGlb, [43.545, 0.09, -16.375]);
  assert.equal(laneA.rotationYRad, 3.1165);
  // v5 dataset itself is untouched by this batch (read-only source)
  const v5 = await json('world/fangbang-temple-v5/blocks.json');
  const v5Lanes = v5.blocks.find((b) => b.id === 'block-lanes-v2');
  assert.equal(v5Lanes.assets.find((a) => a.id === 'lane-a').glb, './world/lanes-v2/lane-a/model.glb');
});
