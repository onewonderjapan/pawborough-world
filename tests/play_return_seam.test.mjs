import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AreaWalkPhysics } from '../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';
import { WalkController } from '../src/player/WalkController.js';
import { installGroundSeams, RETURN_SEAM, STREET_SEAM } from '../scene-authoring/yuyuan-area/web/play/ground-seams.js';

await RAPIER.init();
const root = new URL('../scene-authoring/yuyuan-area/out-zone/', import.meta.url);
const json = async f => JSON.parse(await fs.readFile(new URL(f, root), 'utf8'));
const z = new AreaWalkPhysics({
  RAPIER,
  manifest: await json('zones-manifest.json'),
  readJson: json,
  readBytes: f => fs.readFile(new URL(f, root))
});
await z.loadZones(['outer', 'fangbang']);

const ground = (x, pz) => {
  const handles = new Set(z.groundColliders.map(c => c.handle));
  const h = z.physics.world.castRay(
    new RAPIER.Ray({ x, y: 0.3, z: pz }, { x: 0, y: -1, z: 0 }),
    2,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    c => handles.has(c.handle)
  );
  return h?.timeOfImpact === undefined ? null : 0.3 - h.timeOfImpact;
};

const initialBodies = z.physics.world.bodies.len();
const initialColliders = z.physics.world.colliders.len();
const initialTriangles = z.physics.groundTriangleCount;

// -------------------------------------------------------------------------
// 1. RED Phase: Original gap reaches backdrop (~ -0.40m) and stalls controller
// -------------------------------------------------------------------------
const failpointA = { x: 50.342323303222656, z: -20.414995193481445 };
const failpointB = { x: 50.35647201538086, z: -20.34304428100586 };

const floorPreA = ground(failpointA.x, failpointA.z);
const floorPreB = ground(failpointB.x, failpointB.z);
assert.ok(floorPreA < -0.1, `failpoint A floor ${floorPreA} < -0.1`);
assert.ok(floorPreA > -0.45 && floorPreA < -0.35, `failpoint A hits backdrop ~ -0.40m (was ${floorPreA})`);
assert.ok(floorPreB < -0.1, `failpoint B floor ${floorPreB} < -0.1`);
assert.ok(floorPreB > -0.45 && floorPreB < -0.35, `failpoint B hits backdrop ~ -0.40m (was ${floorPreB})`);

const redRayPoints = [
  [50.27283933600805, -20.6],
  [50.48100412107997, -20.0],
  [50.82794542953317, -19.0],
  [51.17488673798637, -18.0],
  [51.521828046439566, -17.0]
];
for (const [rx, rz] of redRayPoints) {
  const rf = ground(rx, rz);
  assert.ok(rf < -0.1, `red point (${rx}, ${rz}) floor ${rf} reaches backdrop`);
}

// Controller RED test at recorded blocked feet:
const blockedA = [50.37196350097656, 0.020148773193359337, -20.446605682373047];
const blockedB = [50.38729476928711, 0.02, -20.373506546020508];
const wp77 = [49.25, 0.02, -19.25];
const wp76 = [50.75, 0.02, -20.75];

for (const [name, pos] of [['blocked-A', blockedA], ['blocked-B', blockedB]]) {
  const yaw = Math.atan2(pos[0] - wp77[0], pos[2] - wp77[2]);
  const c = new WalkController({
    RAPIER,
    physics: z.physics,
    capsule: {
      radius: 0.28,
      halfHeight: 0.2,
      eyeHeight: 0.8,
      speed: 2.6,
      runSpeed: 4.2,
      autostep: 0.15,
      minimumGroundY: -0.1,
      groundColliders: () => z.groundColliders,
      spawn: pos
    }
  });
  c.teleport(pos, yaw);
  c.setMoveInput(1, 0);
  let unsupported = 0;
  for (let i = 0; i < 120; i++) {
    c.step(1 / 60);
    if (c.lastStep?.unsupported) unsupported++;
  }
  const disp = Math.hypot(c.feetPosition()[0] - pos[0], c.feetPosition()[2] - pos[2]);
  assert.ok(unsupported > 0, `${name} must stall before fix: got ${unsupported} unsupported steps`);
  assert.ok(disp < 0.05, `${name} must remain stationary before fix: disp=${disp}`);
  c.dispose();
}

// -------------------------------------------------------------------------
// 2. Install Ground Seams: Idempotent, scene mesh & collider registration
// -------------------------------------------------------------------------
const scene = new T.Scene();
const sentinel = new T.Group();
sentinel.name = 'sentinel';
scene.add(sentinel);

const owner = installGroundSeams({ scene, RAPIER, zonePhysics: z });
assert.ok(owner, 'owner must be returned');
assert.equal(installGroundSeams({ scene, RAPIER, zonePhysics: z }), owner, 'install must be idempotent per world');

// Both seams installed (street + return):
assert.equal(z.physics.world.bodies.len(), initialBodies + 2, 'adds exactly 2 rigid bodies');
assert.equal(z.physics.world.colliders.len(), initialColliders + 2, 'adds exactly 2 colliders');
assert.equal(z.physics.groundTriangleCount, initialTriangles + 4, 'adds exactly 4 ground triangles (2+2)');

const returnMesh = scene.getObjectByName(RETURN_SEAM.id);
assert.ok(returnMesh, 'visible return seam mesh added to scene');
assert.equal(returnMesh.material.color.getHex(), 0x565247, 'return seam has asphalt color consistent with neighbors');
assert.ok(returnMesh.receiveShadow, 'return seam receives shadow');

// -------------------------------------------------------------------------
// 3. GREEN Phase: Rays supported near topY = 0.001m; void/neighbors preserved
// -------------------------------------------------------------------------
const floorPostA = ground(failpointA.x, failpointA.z);
const floorPostB = ground(failpointB.x, failpointB.z);
assert.ok(Math.abs(floorPostA - 0.001) < 0.001, `failpoint A supported near topY=0.001 (was ${floorPostA})`);
assert.ok(Math.abs(floorPostB - 0.001) < 0.001, `failpoint B supported near topY=0.001 (was ${floorPostB})`);

for (const [rx, rz] of redRayPoints) {
  const rf = ground(rx, rz);
  assert.ok(Math.abs(rf - 0.001) < 0.001, `red point (${rx}, ${rz}) supported at topY=0.001 (was ${rf})`);
}

// Neighbor support points outside 2mm connector overlap retain measured elevations:
const neighborSupportPoints = [
  [50.31655211403381, -20.414995193481445, -0.004],
  [50.35749817726964, -20.414995193481445, 0.000],
  [50.34172029797838, -20.34304428100586, -0.004],
  [50.38225548076244, -20.34304428100586, 0.000]
];
for (const [nx, nz, expectedY] of neighborSupportPoints) {
  const nf = ground(nx, nz);
  assert.ok(Math.abs(nf - expectedY) < 0.005, `neighbor (${nx}, ${nz}) elevation preserved: got ${nf}, expected ~${expectedY}`);
}

// Stone curb is preserved (not flattened by an oversized AABB slab):
const curbPoint = [50.18, -20.76095962524414];
const cf = ground(curbPoint[0], curbPoint[1]);
assert.ok(cf > 0.08, `stone curb at (${curbPoint[0]}, ${curbPoint[1]}) preserved (got ${cf}m, expected ~0.09m)`);

// True void outside connector is NOT covered (no extra slab / city floor):
const realVoidPoints = [
  [50.217, -20.775]
];
for (const [vx, vz] of realVoidPoints) {
  const vf = ground(vx, vz);
  assert.ok(vf < -0.1, `true void point (${vx}, ${vz}) remains void (got ${vf})`);
}

// -------------------------------------------------------------------------
// 4. Movement: Walk/run, forward/reverse, multi-phase, 76<->77 traversals
// -------------------------------------------------------------------------
const testPositions = [
  ['blocked-A', blockedA],
  ['blocked-B', blockedB]
];

for (const [name, pos] of testPositions) {
  for (const forward of [true, false]) {
    const target = forward ? wp77 : wp76;
    const yaw = Math.atan2(pos[0] - target[0], pos[2] - target[2]);
    for (const running of [false, true]) {
      for (const phase of [0, 0.01, 0.02]) {
        const startX = pos[0] + (forward ? phase : -phase);
        const startZ = pos[2] + (forward ? -phase : phase);
        const startY = ground(startX, startZ) + 0.02;

        const c = new WalkController({
          RAPIER,
          physics: z.physics,
          capsule: {
            radius: 0.28,
            halfHeight: 0.2,
            eyeHeight: 0.8,
            speed: 2.6,
            runSpeed: 4.2,
            autostep: 0.15,
            minimumGroundY: -0.1,
            groundColliders: () => z.groundColliders,
            spawn: [startX, startY, startZ]
          }
        });
        c.teleport([startX, startY, startZ], yaw);
        c.setRunning(running);
        c.setMoveInput(1, 0);

        let unsupported = 0;
        let lowestY = Infinity;
        for (let i = 0; i < 60; i++) {
          c.step(1 / 60);
          if (c.lastStep?.unsupported) unsupported++;
          lowestY = Math.min(lowestY, c.feetPosition()[1]);
        }

        const disp = Math.hypot(c.feetPosition()[0] - startX, c.feetPosition()[2] - startZ);
        assert.equal(
          unsupported,
          0,
          `${name} forward=${forward} run=${running} phase=${phase} must have 0 unsupported steps`
        );
        assert.ok(disp > 1.2, `${name} continuous displacement expected (got ${disp}m)`);
        assert.ok(lowestY >= -0.005, `${name} elevation safe (lowest feet Y=${lowestY})`);
        c.dispose();
      }
    }
  }
}

// Full 76 <-> 77 route segment traversals:
for (const [dirName, from, to] of [
  ['76->77', wp76, wp77],
  ['77->76', wp77, wp76]
]) {
  const yaw = Math.atan2(from[0] - to[0], from[2] - to[2]);
  const c = new WalkController({
    RAPIER,
    physics: z.physics,
    capsule: {
      radius: 0.28,
      halfHeight: 0.2,
      eyeHeight: 0.8,
      speed: 2.6,
      runSpeed: 4.2,
      autostep: 0.15,
      minimumGroundY: -0.1,
      groundColliders: () => z.groundColliders,
      spawn: from
    }
  });
  c.teleport(from, yaw);
  c.setMoveInput(1, 0);

  let unsupported = 0;
  let reached = false;
  for (let i = 0; i < 120; i++) {
    c.step(1 / 60);
    if (c.lastStep?.unsupported) unsupported++;
    const cur = c.feetPosition();
    if (Math.hypot(cur[0] - to[0], cur[2] - to[2]) <= 0.16) {
      reached = true;
      break;
    }
  }
  assert.equal(unsupported, 0, `${dirName} traversal must have 0 unsupported steps`);
  assert.ok(reached, `${dirName} traversal must reach within 0.16m tolerance`);
  c.dispose();
}

// -------------------------------------------------------------------------
// 5. Lifecycle & Revocation: Idempotent disposal, clean unregistration
// -------------------------------------------------------------------------
owner.dispose();
owner.dispose(); // Idempotent check

assert.equal(z.physics.world.bodies.len(), initialBodies, 'bodies count restored after dispose');
assert.equal(z.physics.world.colliders.len(), initialColliders, 'colliders count restored after dispose');
assert.equal(z.physics.groundTriangleCount, initialTriangles, 'triangle count restored after dispose');
assert.deepEqual(scene.children, [sentinel], 'all seam meshes removed from scene');

const floorRevokeA = ground(failpointA.x, failpointA.z);
const floorRevokeB = ground(failpointB.x, failpointB.z);
assert.ok(floorRevokeA < -0.1, 'revoke restores original gap at failpoint A');
assert.ok(floorRevokeB < -0.1, 'revoke restores original gap at failpoint B');

z.physics.dispose();
console.log('RETURN_SEAM PASS: actual gap RED confirmed, reversible topY=0.001 GREEN, walk/run/phase/traversals pass, clean lifecycle');
