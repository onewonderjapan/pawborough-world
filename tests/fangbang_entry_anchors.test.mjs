// Player-experience batch A regression #4 (data+physics half) — the player
// entry anchors are DERIVED from the delivered v5 route and VALIDATED with a
// real capsule over the page's real ground/wall assembly (same sources the
// page assembles: street-reviewed-lanes + west/east surfaces + temple courts
// + lanes modules + v5 collision-world + lanes sidecars). Nothing is a guessed
// constant: if an anchor stops settling or stops walking, this fails.
//
// Run: node --test tests/fangbang_entry_anchors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { GROUND_NODE_RE, headingVector } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld, addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { readGlb } from '../src/world/glbReader.js';
import { CAPSULE } from '../src/world/WorldLoader.js';
import { deriveEntryAnchors, validateAnchor, anchorForCamera, nearestAnchor } from '../src/player/entryAnchors.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/fangbang-temple-v5');
const read = (p) => readFile(resolve(root, p));

await RAPIER.init();
const route = JSON.parse(await read('world/fangbang-temple-v5/route.json'));

// ---- derivation: anchors come from the route, not from magic constants ----
const anchors = deriveEntryAnchors({ route });
const byId = Object.fromEntries(anchors.map((a) => [a.id, a]));

test('derivation: the v5 route yields the four player anchors with sources', () => {
  assert.deepEqual(anchors.map((a) => a.id).sort(), ['laneA', 'laneB', 'mainStreet', 'templeFront']);
  assert.deepEqual(byId.mainStreet.position, route.entries.bridgeStart);
  assert.deepEqual(byId.templeFront.position, route.entries.shanmenThreshold);
  // lane mouths are the first excursion points (street side of each portal)
  assert.ok(Math.hypot(byId.laneA.position[0] - route.laneAExcursion[0][0], byId.laneA.position[2] - route.laneAExcursion[0][2]) < 1e-6);
  assert.ok(Math.hypot(byId.laneB.position[0] - route.laneBExcursion[0][0], byId.laneB.position[2] - route.laneBExcursion[0][2]) < 1e-6);
  // provenance is explicit
  assert.equal(byId.mainStreet.source.entry, 'bridgeStart');
  assert.equal(byId.laneA.source.excursion, 'laneAExcursion');
});

test('derivation: lane anchors face INTO the lane, temple faces the axis', () => {
  const into = (a, from, to) => {
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const len = Math.hypot(dx, dz);
    const h = headingVector(a.yaw);
    return (h[0] * dx + h[2] * dz) / len;
  };
  assert.ok(into(byId.laneA, route.laneAExcursion[0], route.laneAExcursion[1]) > 0.95, `laneA heading dot ${into(byId.laneA, route.laneAExcursion[0], route.laneAExcursion[1])}`);
  assert.ok(into(byId.laneB, route.laneBExcursion[0], route.laneBExcursion[1]) > 0.95);
  // templeFront faces along the route INTO the axis (not back out to the street)
  const t = route.entries.shanmenThreshold;
  assert.ok(into(byId.templeFront, t, [-126.4786, 0, 34.9951]) > 0.9);
});

test('anchor selection: camera framing picks the near anchor; aerial is displaced', () => {
  const a = anchorForCamera(anchors, [43.5, 1.6, -9.8]);   // lane-a look-in pose
  assert.equal(a.anchor.id, 'laneA');
  assert.equal(a.displaced, false);
  const air = anchorForCamera(anchors, [-70, 45, 70]);     // aerial-overview pose
  assert.equal(air.anchor.id, 'templeFront');
  assert.equal(air.displaced, true);
  assert.equal(air.reason, 'aerial');
  assert.equal(nearestAnchor(anchors, [232, 1, 47]).anchor.id, 'mainStreet');
});

// ---- physics assembly: the page's real ground + walls -----------------------
const groundMeshes = [];
const pushGround = (glb, frame) => {
  for (const m of glb.meshes) {
    if (!GROUND_NODE_RE.test(m.name)) continue;
    groundMeshes.push({ name: m.name, positions: m.positions,
      indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
      matrix: frame ?? m.matrix });
  }
};
const holderFrame = (x, y, z, rotY) => {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]; // column-major
};
const TT = [-127.817, 0, 27.057], TYAW = 0.16703;
const templeFrame = holderFrame(TT[0], 0, TT[2], TYAW);
const v5Blocks = JSON.parse(await read('world/fangbang-temple-v5/blocks.json'));
const lanesBlock = v5Blocks.blocks.find((b) => b.id === 'block-lanes-v2');
for (const asset of lanesBlock.assets) {
  const glb = readGlb(await read(asset.glb.replace('./', '')));
  pushGround(glb, holderFrame(...asset.positionGlb, asset.rotationYRad));
}
pushGround(readGlb(await readFile(DS + '/street-reviewed-lanes.glb')));
pushGround(readGlb(await read('world/fangbang-temple-v4/west-extension/surface.glb')));
pushGround(readGlb(await read('world/street-completion/surface.glb')));
pushGround(readGlb(await read('world/fangbang-temple-v4/east-extension/surface.glb')));
for (const g of ['ground.glb', 'court-open.glb', 'court3.glb', 'dadian-court-v2.glb'])
  pushGround(readGlb(await read('world/fangbang-temple-v4/temple-axis/' + g)), templeFrame);
const gt = collectGroundTriangles(groundMeshes);

const v5collision = JSON.parse(await read('world/fangbang-temple-v5/collision-world.json'));
const physics = buildPhysicsWorld(RAPIER, { collision: v5collision, groundTriangles: gt });
for (const side of ['lane-a', 'lane-b-v2', 'interfaces']) {
  const sc = JSON.parse(await read(`world/lanes-v2/${side}/collision.json`));
  for (const rec of sc.colliders) addWallCollider(RAPIER, physics.world, rec);
}

test('every player anchor settles on real ground and walks INTO its place', async () => {
  const problems = [];
  for (const a of anchors) {
    const v = await validateAnchor({ RAPIER, physics, capsule: CAPSULE, anchor: a });
    if (!v.ok) problems.push(`${a.id}: ${v.reason} (settled y=${v.settledFeetY}, advanced ${v.advancedM}m)`);
    else console.log(`     anchor ${a.id}: feetY=${v.settledFeetY} advanced=${v.advancedM}m`);
  }
  assert.deepEqual(problems, []);
}, { timeout: 120000 });

test('a deliberately unsafe point is REJECTED by the same validator', async () => {
  // inside the lane-A west wall mass (sidecar collider body), never walkable
  const bad = { id: 'bad', position: [42.4, 0, -20.9], yaw: 0 };
  const v = await validateAnchor({ RAPIER, physics, capsule: CAPSULE, anchor: bad });
  assert.equal(v.ok, false, JSON.stringify(v));
}, { timeout: 60000 });
