// Lane-A survey walk test — REAL production WalkController + Rapier on the
// v5 candidate dataset, exactly as the page assembles it:
//   walls  = world/fangbang-temple-v5/collision-world.json
//            + block sidecars world/lanes-v2/{lane-a,interfaces}/collision.json
//   ground = GROUND_NODE_RE faces of the assembly GLB + the two block GLBs
//            (lane-a placed at T=[43.545,0.09,-16.375] yaw 3.1165, interfaces
//            identity) — the page's session trimesh + extraMeshes set.
// A live player capsule exists in the world (as on the page); every probe
// controller EXCLUDES the player's collider handle via excludeColliderHandles
// (the 20260920 fixed mechanism) so probes can never be blocked by the player.
//
// Output: artifacts/lane-a-polish/survey/walktest.json (+ console digest).
// Read-only survey tool; runs headless under plain node.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { readGlb } from '../src/world/glbReader.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/lane-a-polish/survey');
await RAPIER.init();

// ---- world assembly (production set) --------------------------------------
const collision = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v5/collision-world.json'), 'utf8'));
const sideA = JSON.parse(await readFile(resolve(root, 'world/lanes-v2/lane-a/collision.json'), 'utf8'));
const sideI = JSON.parse(await readFile(resolve(root, 'world/lanes-v2/interfaces/collision.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v5/route.json'), 'utf8'));

const assembly = readGlb(await readFile(resolve(root, 'world/fangbang-temple-v5/street-reviewed-lanes.glb')));
const laneAGlb = readGlb(await readFile(resolve(root, 'world/lanes-v2/lane-a/model.glb')));
const ifcGlb = readGlb(await readFile(resolve(root, 'world/lanes-v2/interfaces/model.glb')));

// holder transform for the lane-a block asset (blocks.json), column-major
const YAW = 3.1165, T = [43.545, 0.09, -16.375];
const c = Math.cos(YAW), s = Math.sin(YAW);
const holder = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, T[0], T[1], T[2], 1];
const mul = (a, b) => {
  const r = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[k * 4 + row] * b[col * 4 + k];
    r[col * 4 + row] = v;
  }
  return r;
};

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const wallRecords = [...collision.colliders, ...sideA.colliders, ...sideI.colliders];
for (const rec of wallRecords) addWallCollider(RAPIER, world, rec);
const groundMeshes = [
  ...assembly.meshes.filter((m) => /street-kit__/.test(m.name)),
  ...laneAGlb.meshes.map((m) => ({ ...m, matrix: mul(holder, m.matrix) })),
  ...ifcGlb.meshes,
];
const gt = collectGroundTriangles(groundMeshes);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const dt = 1 / 60;

// live player standing at the page spawn — probes must ignore it
const start = route.entries.bridgeStart;
const player = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [start[0], 0.2, start[2]] } });

const mkProbe = () => new WalkController({
  RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [0, 1.0, 0] },
  excludeColliderHandles: [player.collider.handle],   // the fixed exclude-self mechanism
});

// walk a polyline with the production input->fixed-step chain; returns stats
function walkLine(name, pts, budgetS = 45) {
  const c = mkProbe();
  c.teleport([pts[0][0], 0.1, pts[0][1]], 0);
  let wi = 0, reached = false, fell = null, minY = 1, steps = 0, stall = 0, lastX = pts[0][0], lastZ = pts[0][1], stallS = 0;
  for (let i = 0; i < Math.round(budgetS / dt); i++) {
    const [x, , z] = c.feetPosition();
    while (wi < pts.length && Math.hypot(x - pts[wi][0], z - pts[wi][1]) < 0.8) wi++;
    if (wi >= pts.length) { reached = true; break; }
    const dx = pts[wi][0] - x, dz = pts[wi][1] - z;
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
    steps++;
    const p = c.feetPosition();
    minY = Math.min(minY, p[1]);
    if (p[1] < -0.05) { fell = p.map(v => +v.toFixed(2)); break; }
    if (Math.hypot(p[0] - lastX, p[2] - lastZ) < 0.008) { stallS += dt; if (stallS > 6) break; } else stallS = 0;
    lastX = p[0]; lastZ = p[2];
  }
  const p = c.feetPosition();
  c.dispose();
  return { name, reached, fell, feetYMin: +minY.toFixed(3), end: p.map(v => +v.toFixed(2)), stalledS: +stallS.toFixed(1) };
}

// push probe along heading until it stops (or timeout); report where physics
// actually stops it relative to named geometry
function pushProbe(name, fromXyz, yaw, seconds = 4) {
  const c = mkProbe();
  c.teleport(fromXyz, yaw);
  let contact = null;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const st = c.lastStep;
    if (st && Math.hypot(st.corrected[0], st.corrected[2]) < 0.15 * Math.hypot(st.desired[0], st.desired[2]) && st.desired[1] > -1.6 / 60) {
      // movement corrected to <15% of intent while trying to move horizontally
      if (contact === null) contact = i * dt;
    }
  }
  const p = c.feetPosition();
  c.dispose();
  return { name, yaw, stop: p.map(v => +v.toFixed(3)), grounded: c.isGrounded(), correctedAtS: contact && +contact.toFixed(2) };
}

const results = { wallRecords: wallRecords.length, groundTriangles: gt.triangleCount, tests: [] };

// P1 — production lane A excursion, in and back out
results.tests.push(walkLine('P1 laneAExcursion inward', route.laneAExcursion.map(([x, , z]) => [x, z])));
results.tests.push(walkLine('P1 laneAExcursion outward', [...route.laneAExcursion].reverse().map(([x, , z]) => [x, z])));
// P2 — west-strip line just inside the covered floor, street -> portal
results.tests.push(walkLine('P2 west strip street->portal', [[42.9, -10.5], [42.9, -12.5], [43.0, -14.5], [43.55, -16.1]]));
results.tests.push(walkLine('P2 west strip portal->street', [[43.55, -16.1], [43.0, -14.5], [42.9, -12.5], [42.9, -10.5]]));

// N1 — boundary pushes at the mid-corridor section (z=-13.4)
results.tests.push(pushProbe('N1 push east into N06 wall @z-13.4', [43.4, 0.11, -13.4], -Math.PI / 2, 3));
results.tests.push(pushProbe('N1 push west into N05 wall @z-13.4', [43.0, 0.11, -13.4], Math.PI / 2, 3));
// N2 — portal pass-through and lane end / closed rear door
results.tests.push(pushProbe('N2 portal pass (walk -z through portal)', [43.6, 0.11, -15.2], 0, 3));
results.tests.push(pushProbe('N2 push into lane end band @-23.8', [43.65, 0.11, -23.5], 0, 3));
results.tests.push(pushProbe('N2 push into closed rear door', [43.4, 0.11, -21.3], Math.PI / 2, 3));
// N3 — the visible gray-band voids: expected FALL (no ground, no wall)
results.tests.push(pushProbe('N3 void probe mouth-right (43.9,-10.6)', [43.9, 0.11, -10.6], 0, 2));
results.tests.push(pushProbe('N3 void probe east strip (43.7,-12.0)', [43.7, 0.11, -12.0], 0, 2));
results.tests.push(pushProbe('N3 void probe portal corner (44.0,-15.3)', [44.0, 0.11, -15.3], 0, 2));

// N4 — narrow-gap probes: can the capsule squeeze between a-floor east edge
// and N06 collider (the 0.9-1.2m band) WITHOUT falling, i.e. is the band
// physically entered from the covered floor at all?
results.tests.push(walkLine('N4 straddle east edge z-12.6', [[43.0, -12.6], [43.35, -12.6]]));

player.dispose();
await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'walktest.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
