// Lane-A polish verification walk test — REAL production WalkController +
// Rapier on the v6 candidate dataset, exactly as the page assembles it:
//   walls  = world/fangbang-temple-v6/collision-world.json (v5 copy)
//            + sidecars world/lane-a-polish/{lane-a,interfaces}/collision.json
//            + the untouched lane-b-v2 sidecar (same physics set as the page)
//   ground = GROUND_NODE_RE faces of the assembly GLB + the two new block GLBs
//            (lane-a placed at T=[43.545,0.09,-16.375] yaw 3.1165)
// Differences vs the v5 survey run that MUST hold now:
//   N3 void probes grounded-and-blocked (v5: fell out of the world),
//   east pushes stop AT the visible faces (distances measured from the FINAL
//   foot point to the wall planes, not from the initial z-slice),
//   a coverage grid of down-rays over the whole corridor (no start==end
//   vacuous assertions).
// Output: artifacts/lane-a-polish/verify/walktest-v6.json; exit != 0 on FAIL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { readGlb } from '../src/world/glbReader.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/lane-a-polish/verify');
await RAPIER.init();

const V6 = 'world/fangbang-temple-v6';
const collision = JSON.parse(await readFile(resolve(root, `${V6}/collision-world.json`), 'utf8'));
const sideA = JSON.parse(await readFile(resolve(root, 'world/lane-a-polish/lane-a/collision.json'), 'utf8'));
const sideI = JSON.parse(await readFile(resolve(root, 'world/lane-a-polish/interfaces/collision.json'), 'utf8'));
const sideB = JSON.parse(await readFile(resolve(root, 'world/lanes-v2/lane-b-v2/collision.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, `${V6}/route.json`), 'utf8'));

const assembly = readGlb(await readFile(resolve(root, `${V6}/street-reviewed-lanes.glb`)));
const laneAGlb = readGlb(await readFile(resolve(root, 'world/lane-a-polish/lane-a/model.glb')));
const ifcGlb = readGlb(await readFile(resolve(root, 'world/lane-a-polish/interfaces/model.glb')));
const laneBGlb = readGlb(await readFile(resolve(root, 'world/lanes-v2/lane-b-v2/model.glb')));

const YAW_A = 3.1165, T_A = [43.545, 0.09, -16.375];
const YAW_B = -0.4818, T_B = [57.418, 0.09, 14.2485];
const holderOf = (yaw, t) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1];
};
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
const wallRecords = [...collision.colliders, ...sideA.colliders, ...sideI.colliders, ...sideB.colliders];
for (const rec of wallRecords) addWallCollider(RAPIER, world, rec);
const groundMeshes = [
  ...assembly.meshes.filter((m) => /street-kit__/.test(m.name)),
  ...laneAGlb.meshes.map((m) => ({ ...m, matrix: mul(holderOf(YAW_A, T_A), m.matrix) })),
  ...ifcGlb.meshes,
  ...laneBGlb.meshes.map((m) => ({ ...m, matrix: mul(holderOf(YAW_B, T_B), m.matrix) })),
];
const gt = collectGroundTriangles(groundMeshes);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const dt = 1 / 60;

const start = route.entries.bridgeStart;
const player = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [start[0], 0.2, start[2]] } });
const mkProbe = () => new WalkController({
  RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [0, 1.0, 0] },
  excludeColliderHandles: [player.collider.handle],
});

function walkLine(name, pts, budgetS = 45) {
  const c = mkProbe();
  c.teleport([pts[0][0], 0.1, pts[0][1]], 0);
  let wi = 0, reached = false, fell = null, minY = 1, stallS = 0, lastX = pts[0][0], lastZ = pts[0][1];
  for (let i = 0; i < Math.round(budgetS / dt); i++) {
    const [x, , z] = c.feetPosition();
    while (wi < pts.length && Math.hypot(x - pts[wi][0], z - pts[wi][1]) < 0.8) wi++;
    if (wi >= pts.length) { reached = true; break; }
    const dx = pts[wi][0] - x, dz = pts[wi][1] - z;
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
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

function pushProbe(name, fromXyz, yaw, seconds = 4) {
  const c = mkProbe();
  c.teleport(fromXyz, yaw);
  let contact = null;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
    const st = c.lastStep;
    if (st && Math.hypot(st.corrected[0], st.corrected[2]) < 0.15 * Math.hypot(st.desired[0], st.desired[2]) && st.desired[1] > -1.6 / 60) {
      if (contact === null) contact = i * dt;
    }
  }
  const p = c.feetPosition();
  const grounded = c.isGrounded();
  c.dispose();
  return { name, yaw, stop: p.map(v => +v.toFixed(3)), grounded, correctedAtS: contact && +contact.toFixed(2) };
}

// ---- measured wall lines (survey 2026-09-20; same anchors the builders used)
const N05_A = [42.02, -9.83], N05_B = [42.57, -16.80];
const N06_A = [44.00, -9.67], N06_B = [44.87, -14.79];
const lineX = (p0, p1, z) => p0[0] + (p1[0] - p0[0]) * (p0[1] - z) / (p0[1] - p1[1]);
// new east mouth wall west face (from the interfaces measurements.json)
const designI = JSON.parse(await readFile(resolve(root, 'world/lane-a-polish/interfaces/measurements.json'), 'utf8')).design;
const WN = designI.measuredAnchors.newWallWestFace.north, WS = designI.measuredAnchors.newWallWestFace.south;
const wallX = (z) => WN[0] + (WS[0] - WN[0]) * (z - WN[1]) / (WS[1] - WN[1]);
// module local frame (end wall face s=8, rear-door backwall lx=1.35)
const cy = Math.cos(YAW_A), sy = Math.sin(YAW_A);
const toLocal = (x, z) => [cy * (x - T_A[0]) - sy * (z + 16.375), sy * (x - T_A[0]) + cy * (z + 16.375)];

const results = { wallRecords: wallRecords.length, groundTriangles: gt.triangleCount, tests: [], coverage: null, boundary: [] };

// positives: the lane A excursion and west strip must stay walked
results.tests.push(walkLine('P1 laneAExcursion inward', route.laneAExcursion.map(([x, , z]) => [x, z])));
results.tests.push(walkLine('P1 laneAExcursion outward', [...route.laneAExcursion].reverse().map(([x, , z]) => [x, z])));
results.tests.push(walkLine('P2 west strip street->portal', [[42.9, -10.5], [42.9, -12.5], [43.0, -14.5], [43.55, -16.1]]));
results.tests.push(walkLine('P2 west strip portal->street', [[43.55, -16.1], [43.0, -14.5], [42.9, -12.5], [42.9, -10.5]]));
// NEW positive: walk the previously-void east band end to end
results.tests.push(walkLine('P3 east band street->portal (was void)', [[43.9, -10.6], [44.05, -12.0], [44.15, -13.6], [44.3, -15.2], [44.4, -16.2]]));

// N3 — the former fall-out probes must now be grounded and standing still
for (const [nm, p] of [
  ['N3 void probe mouth-right (43.9,-10.6)', [43.9, 0.11, -10.6]],
  ['N3 void probe east strip (43.7,-12.0)', [43.7, 0.11, -12.0]],
  ['N3 void probe portal corner (44.0,-15.3)', [44.0, 0.11, -15.3]],
]) results.tests.push(pushProbe(nm, p, 0, 2));

// boundary pushes (final-foot-point distances judged further below)
const pushW = pushProbe('N1 push west into N05 wall @z-13.4', [43.4, 0.11, -13.4], Math.PI / 2, 3);
const pushE06 = pushProbe('N1 push east into N06 wall @z-13.4', [43.4, 0.11, -13.4], -Math.PI / 2, 3);
const pushEW = pushProbe('N1 push east into new mouth wall @z-15.6', [44.2, 0.11, -15.6], -Math.PI / 2, 3);
const pushDoor = pushProbe('N2 push into closed rear door', [43.4, 0.11, -21.3], Math.PI / 2, 3);
const pushEnd = pushProbe('N2 push into lane end band @-23.8', [43.65, 0.11, -23.5], 0, 3);
results.tests.push(pushW, pushE06, pushEW, pushDoor, pushEnd, pushProbe('N2 portal pass (walk -z through portal)', [43.6, 0.11, -15.2], 0, 3));

// boundary distances from the FINAL foot points to the wall planes
const dist = {
  n05West: +(pushW.stop[0] - lineX(N05_A, N05_B, pushW.stop[2])).toFixed(3),
  n06East: +(lineX(N06_A, N06_B, pushE06.stop[2]) - pushE06.stop[0]).toFixed(3),
  newWallEast: +(wallX(pushEW.stop[2]) - pushEW.stop[0]).toFixed(3),
  rearDoor: +(1.35 - toLocal(pushDoor.stop[0], pushDoor.stop[2])[0]).toFixed(3),
  laneEnd: +(8.0 - toLocal(pushEnd.stop[0], pushEnd.stop[2])[1]).toFixed(3),
};
const R = CAPSULE.radius;
for (const [k, v] of Object.entries(dist)) results.boundary.push({ wall: k, gapM: v, expect: R, pass: Math.abs(v - R) <= 0.06 });

// ---- coverage grid: down-rays over the whole walkable corridor ---------------
const Z0 = -16.38, Z1 = -10.55, STEP = 0.15;
let samples = 0, misses = 0, badY = 0, yMin = 1e9, yMax = -1e9;
const holes = [];
for (let z = Z0; z <= Z1 + 1e-9; z += STEP) {
  const xw = lineX(N05_A, N05_B, z) + R + 0.01;
  const xe = (z >= -14.79 ? lineX(N06_A, N06_B, z) : wallX(z)) - R - 0.01;
  for (let x = xw; x <= xe; x += STEP) {
    samples++;
    const ray = new RAPIER.Ray({ x, y: 2.0, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 4.0, true);
    if (!hit) { misses++; if (holes.length < 12) holes.push([+x.toFixed(2), +z.toFixed(2)]); continue; }
    const y = 2.0 - hit.timeOfImpact;
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    if (y < 0.05 || y > 0.16) { badY++; if (holes.length < 12) holes.push([+x.toFixed(2), +z.toFixed(2), +y.toFixed(3)]); }
  }
}
results.coverage = { step: STEP, zRange: [Z0, Z1], samples, misses, badY, groundYRange: [ +yMin.toFixed(3), +yMax.toFixed(3) ], firstHoles: holes };

// ---- surface profiles: adjacent-sample height steps must stay <= 0.021 m ----
// (lead fix 2026-09-20: the old portal threshold top sat +0.04 above the
// floor — a real bump the 0.05..0.16 coverage band could not see)
const groundY = (x, z) => {
  const ray = new RAPIER.Ray({ x, y: 2.0, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 4.0, true);
  return hit ? 2.0 - hit.timeOfImpact : null;
};
const profile = (name, pts) => {
  const ys = pts.map(([x, z]) => [x, z, groundY(x, z)]);
  let maxStep = 0, worst = null, holesN = 0;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i][2] === null || ys[i - 1][2] === null) { holesN++; continue; }
    const d = Math.abs(ys[i][2] - ys[i - 1][2]);
    if (d > maxStep) { maxStep = d; worst = [ys[i - 1], ys[i]]; }
  }
  return { name, samples: ys.length, holes: holesN, maxStepM: +maxStep.toFixed(4),
    worst: worst && worst.map((p) => [+p[0].toFixed(3), +p[2].toFixed(3)]), pass: holesN === 0 && maxStep <= 0.021 };
};
const portalPts = [];
for (let ls = -0.30; ls <= 0.301; ls += 0.02)
  portalPts.push([43.545 + 0.02506 * ls, -16.375 - 0.99969 * ls]);       // module axis, lx=0
const centerPts = [];
for (let ls = -6.30; ls <= 0.051; ls += 0.06)
  centerPts.push([43.545 + 0.02506 * ls, -16.375 - 0.99969 * ls]);       // street -> lane centreline
const westPts = [];
for (let z = -16.30; z <= -10.451; z += 0.06)
  westPts.push([lineX(N05_A, N05_B, z) + 0.45, z]);                      // crosses the recessed drain
results.profiles = [profile('portal axis lx=0 (ls -0.30..0.30)', portalPts),
  profile('centreline street->lane', centerPts), profile('west strip +0.45 (drain)', westPts)];

player.dispose();
await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'walktest-v6.json'), JSON.stringify(results, null, 1));

// ---- verdict ------------------------------------------------------------------
let fail = 0;
const ok = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) fail++; };
for (const t of results.tests.filter((t) => t.name.startsWith('P'))) {
  ok(t.reached && !t.fell && t.feetYMin > 0.085, `${t.name} (reached=${t.reached} feetYMin=${t.feetYMin})`);
}
for (const t of results.tests.filter((t) => t.name.startsWith('N3'))) {
  ok(t.grounded && t.stop[1] > 0.08, `${t.name} -> grounded=${t.grounded} y=${t.stop[1]}`);
}
ok(pushE06.grounded && dist.n06East > 0 && Math.abs(dist.n06East - R) <= 0.06, `east push stops at N06 visible face (gap=${dist.n06East})`);
ok(pushEW.grounded && dist.newWallEast > 0 && Math.abs(dist.newWallEast - R) <= 0.06, `east push stops at new mouth wall face (gap=${dist.newWallEast})`);
ok(Math.abs(dist.n05West - R) <= 0.06, `west push stops at N05 face (gap=${dist.n05West})`);
ok(Math.abs(dist.rearDoor - R) <= 0.06, `closed rear door blocks (gap=${dist.rearDoor})`);
ok(Math.abs(dist.laneEnd - R) <= 0.06, `lane end band blocks (gap=${dist.laneEnd})`);
ok(misses === 0 && badY === 0, `coverage grid: ${samples} samples, misses=${misses}, badY=${badY}, groundY=${results.coverage.groundYRange}`);
for (const pr of results.profiles)
  ok(pr.pass, `surface profile ${pr.name}: maxStep=${pr.maxStepM}m holes=${pr.holes}`, pr.worst ? JSON.stringify(pr.worst) : '');
if (holes.length) console.log('holes:', JSON.stringify(holes));
console.log(fail === 0 ? 'WALKTEST_V6_PASS' : `WALKTEST_V6_FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
