// REL-04 (world-reliability 20260921) — temple-front spawn facing.
// On v7+ the mainStreet zigzag repeats the shanmenThreshold waypoint
// (ms-301 == ms-303, ms-300 == ms-302 behind it), so the legacy route rule
// degenerated to atan2(-0,-0) = -π: the 庙前 spawn faced OUT through the door
// toward 方浜路 with the entire temple behind the player's back (「背对山门」;
// first-person captures in artifacts/world-reliability/temple-front/). The
// fix derives the facing from the temple placement yaw
// (mapRegistration.templePlacement.yawRad): controller forward at yaw = yawRad
// is rotY(yawRad)·(0,0,-1) = gate-local -Z — straight through the passage
// INTO the temple, along the actual 9.57°-rotated gate axis.
//
// Assertions: the four entries each face their real semantic target
// (四入口对比); templeFront faces the gate axis inward (and away from the road
// camera); the spawn POSITION is untouched; and the anchor still validates
// (settles + advances) on the REAL v7 physics with the new facing.
// Run: node --test tests/fangbang_temple_front.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { readGlb } from '../src/world/glbReader.js';
import { deriveEntryAnchors, validateAnchor } from '../src/player/entryAnchors.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(resolve(root, p));

await RAPIER.init();
const route = JSON.parse(await read('world/fangbang-temple-v7/route.json'));
const manifest = JSON.parse(await read('world/fangbang-temple-v7/review-manifest.json'));
const TEMPLE_YAW = manifest.mapRegistration.templePlacement.yawRad;
const THRESHOLD = route.entries.shanmenThreshold;

const anchors = deriveEntryAnchors({ route, templeYawRad: TEMPLE_YAW });
const byId = Object.fromEntries(anchors.map((a) => [a.id, a]));
const heading = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)]; // controller forward
const dotXZ = (h, dx, dz) => (h[0] * dx + h[2] * dz) / Math.hypot(dx, dz);
// gate axes in world space: inward = rotY(θ)·(0,0,-1), outward = rotY(θ)·(0,0,1)
const IN = [-Math.sin(TEMPLE_YAW), 0, -Math.cos(TEMPLE_YAW)];
const OUT = [Math.sin(TEMPLE_YAW), 0, Math.cos(TEMPLE_YAW)];

test('REL-04: the legacy rule on v7 faces OUT the door (the 背对山门 defect)', () => {
  const legacy = deriveEntryAnchors({ route });
  const t = legacy.find((a) => a.id === 'templeFront');
  assert.ok(Math.abs(t.yaw + Math.PI) < 1e-9, `pre-fix yaw is the degenerate -π (got ${t.yaw})`);
  const dOut = dotXZ(heading(t.yaw), OUT[0], OUT[2]);
  assert.ok(dOut > 0.98, `pre-fix faces due-south = essentially outward (dot=${dOut.toFixed(4)}, 9.6° off the gate axis)`);
});

test('REL-04: templeFront now faces INTO the temple along the actual gate axis', () => {
  const yaw = byId.templeFront.yaw;
  assert.ok(Math.abs(yaw - TEMPLE_YAW) < 1e-12, `yaw is the placement yaw (${yaw})`);
  const dIn = dotXZ(heading(yaw), IN[0], IN[2]);
  assert.ok(dIn > 0.9999, `facing aligns with the inward gate axis (dot=${dIn.toFixed(5)})`);
  const dOut = dotXZ(heading(yaw), OUT[0], OUT[2]);
  assert.ok(dOut < -0.9999, `definitively NOT facing out to the street (dot=${dOut.toFixed(5)})`);
  // the spawn position is UNCHANGED (only the facing moved)
  assert.deepEqual(byId.templeFront.position, THRESHOLD.slice());
});

test('REL-04: templeFront looks into the axis — away from the road camera, toward the courtyard', async () => {
  const cam = JSON.parse(await read('world/fangbang-temple-v7/cameras.json'));
  const view = cam.cameras.find((v) => v.id === 'shanmen-from-road');
  assert.ok(view, 'shanmen-from-road view exists');
  // the camera stands on 方浜路 looking at the gate: the re-faced player looks
  // the OPPOSITE way (into the temple), back to the road
  const toCam = [view.positionGlb[0] - THRESHOLD[0], view.positionGlb[2] - THRESHOLD[2]];
  const dCam = dotXZ(heading(byId.templeFront.yaw), toCam[0], toCam[1]);
  assert.ok(dCam < -0.9, `road camera is BEHIND the spawn facing (dot=${dCam.toFixed(4)})`);
  // and the courtyard/yimen is ahead
  const toYimen = [-131.308343 - THRESHOLD[0], 6.349259 - THRESHOLD[2]];
  const dYimen = dotXZ(heading(byId.templeFront.yaw), toYimen[0], toYimen[1]);
  assert.ok(dYimen > 0.9, `faces the courtyard/yimen (dot=${dYimen.toFixed(4)})`);
});

test('REL-04: 四入口对比 — each entry faces its real semantic target', () => {
  const ms = route.mainStreet;
  // 主街: along the route at the waypoint nearest the bridge start (the route
  // begins in the east extension; bridgeStart is a mid-route point)
  let best = 0, bd = Infinity;
  ms.forEach((w, i) => {
    const d = Math.hypot(w[0] - route.entries.bridgeStart[0], w[2] - route.entries.bridgeStart[2]);
    if (d < bd) { bd = d; best = i; }
  });
  const a = ms[Math.max(0, best - 1)], b = ms[Math.min(ms.length - 1, best + 1)];
  const dMs = dotXZ(heading(byId.mainStreet.yaw), b[0] - a[0], b[2] - a[2]);
  assert.ok(dMs > 0.99, `mainStreet faces down the route (dot=${dMs.toFixed(4)})`);
  // A弄 / B弄: into their lanes (excursion[0] -> excursion[1])
  for (const [id, exc] of [['laneA', route.laneAExcursion], ['laneB', route.laneBExcursion]]) {
    const d = dotXZ(heading(byId[id].yaw), exc[1][0] - exc[0][0], exc[1][2] - exc[0][2]);
    assert.ok(d > 0.99, `${id} faces into the lane (dot=${d.toFixed(4)})`);
  }
  // 庙前: the inward gate axis (asserted in detail above)
  assert.ok(dotXZ(heading(byId.templeFront.yaw), IN[0], IN[2]) > 0.9999);
  // and the four headings are pairwise distinct directions
  const yaws = anchors.map((a) => a.yaw);
  for (let i = 0; i < yaws.length; i++)
    for (let j = i + 1; j < yaws.length; j++) {
      const dd = Math.abs(Math.atan2(Math.sin(yaws[i] - yaws[j]), Math.cos(yaws[i] - yaws[j])));
      assert.ok(dd > 0.2, `anchors ${anchors[i].id} vs ${anchors[j].id} face distinct ways (Δ=${dd.toFixed(2)})`);
    }
});

test('REL-04: the re-faced templeFront still settles and advances on the REAL v7 world', async () => {
  // same production assembly the page walks on (street + tails + temple grounds)
  const TT = THRESHOLD, TYAW = TEMPLE_YAW;
  const c0 = Math.cos(TYAW), s0 = Math.sin(TYAW);
  const templeFrame = [c0, 0, -s0, 0, 0, 1, 0, 0, s0, 0, c0, 0, TT[0], 0, TT[2], 1];
  const groundSources = [
    ['world/fangbang-temple-v5/street-reviewed-lanes.glb', /street-kit__/, null],
    ['world/fangbang-temple-v4/west-extension/surface.glb', /sctail__/, null],
    ['world/street-completion/surface.glb', /sctail__/, null],
    ['world/fangbang-temple-v3/temple-axis/ground.glb', /temple-ground__/, templeFrame],
    ['world/fangbang-temple-v4/temple-axis/court-open.glb', /temple-ground__/, templeFrame],
    ['world/fangbang-temple-v3/temple-axis/dadian-court-v2.glb', /temple-ground__/, templeFrame],
    ['world/fangbang-temple-v3/temple-axis/court3.glb', /temple-ground__/, templeFrame],
  ];
  const groundMeshes = [];
  for (const [p, re, frame] of groundSources) {
    const glb = readGlb(await read(p));
    groundMeshes.push(...glb.meshes.filter((m) => re.test(m.name)).map((m) => ({ name: m.name,
      positions: m.positions, indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
      matrix: frame ?? m.matrix })));
  }
  const gt = collectGroundTriangles(groundMeshes);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const collision = JSON.parse(await read('world/fangbang-temple-v7/collision-world.json'));
  for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
  addGroundCollider(RAPIER, world, gt);
  world.step();
  const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
  const validation = await validateAnchor({ RAPIER, physics: { world }, capsule: CAPSULE, anchor: byId.templeFront });
  assert.equal(validation.ok, true, `templeFront (facing into the temple) validates: ${JSON.stringify(validation)}`);
});
