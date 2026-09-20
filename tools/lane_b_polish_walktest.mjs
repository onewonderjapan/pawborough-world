// Lane-B polish verification walk test — REAL production WalkController +
// Rapier on the v7 candidate dataset, exactly as the page assembles it:
//   walls  = world/fangbang-temple-v7/collision-world.json (v6 copy)
//            + sidecars world/lane-a-polish/{lane-a,interfaces}/collision.json
//            (v6 bytes, untouched) and world/lane-b-polish/{lane-b,interfaces}
//   ground = GROUND_NODE_RE faces of the assembly GLB + the three block GLBs
//            (lane-a holder [43.545,0.09,-16.375] yaw 3.1165;
//             lane-b holder [57.418,0.09,14.2485] yaw -0.4818)
// B positives: street -> 10 m pocket end -> back (real capsule, face normals);
// centre / left / right reachable edges; static probes in the previously
// degenerate apron band (v6: rays fell through). Negatives: closed side door,
// rear service door, back wall corner, funnel walls. Coverage grid + surface
// profiles over the whole B corridor (no start==end vacuous assertions).
// A regression (original coordinates from the delivered v6 walk test): the
// lane-A excursion both ways, the former-void probes, the portal threshold
// profile and the five boundary pushes.
// Output: artifacts/lane-b-polish/verify/walktest-v7.json; exit != 0 on FAIL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { readGlb } from '../src/world/glbReader.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/lane-b-polish/verify');
await RAPIER.init();

const V7 = 'world/fangbang-temple-v7';
const collision = JSON.parse(await readFile(resolve(root, `${V7}/collision-world.json`), 'utf8'));
const sideA = JSON.parse(await readFile(resolve(root, 'world/lane-a-polish/lane-a/collision.json'), 'utf8'));
const sideB = JSON.parse(await readFile(resolve(root, 'world/lane-b-polish/lane-b/collision.json'), 'utf8'));
const sideI = JSON.parse(await readFile(resolve(root, 'world/lane-b-polish/interfaces/collision.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, `${V7}/route.json`), 'utf8'));

const assembly = readGlb(await readFile(resolve(root, `${V7}/street-reviewed-lanes.glb`)));
const laneAGlb = readGlb(await readFile(resolve(root, 'world/lane-a-polish/lane-a/model.glb')));
const ifcGlb = readGlb(await readFile(resolve(root, 'world/lane-b-polish/interfaces/model.glb')));
const laneBGlb = readGlb(await readFile(resolve(root, 'world/lane-b-polish/lane-b/model.glb')));

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
// walls: v7 world + frozen A module sidecar (v6 bytes) + the v7 interfaces and
// lane-b sidecars (A records of the v7 interfaces sidecar are verified
// identical to v6's, so the frozen A and the repaired B never double-load)
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
const R = CAPSULE.radius;

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
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    c.setMoveInput(1, 0);
    c.step(dt);
  }
  const p = c.feetPosition();
  const grounded = c.isGrounded();
  c.dispose();
  return { name, yaw, stop: p.map(v => +v.toFixed(3)), grounded };
}

// ---- lane-B local frame helpers ----------------------------------------------
const CB = Math.cos(YAW_B), SB = Math.sin(YAW_B);
const toWorldB = (lx, ly, ls) => [T_B[0] + CB * lx + SB * ls, T_B[1] + ly, T_B[2] - SB * lx + CB * ls];
const toLocalB = (x, z) => [CB * (x - T_B[0]) - SB * (z - T_B[2]), SB * (x - T_B[0]) + CB * (z - T_B[2])];
// corridor bounds (lane-local): the funnel/facade/pocket wall faces
const eastFace = (ls) => ls <= 0 ? 1.067 - 0.0536 * (ls + 0.26) : ls <= 2.5 ? 0.81 + 0.99 * (ls / 2.5) : 1.80;
const westFace = (ls) => ls <= 0 ? -1.096 : ls <= 3.5 ? -(0.81 + 0.99 * (ls / 3.5)) : -1.80;

const results = { wallRecords: wallRecords.length, groundTriangles: gt.triangleCount, tests: [], coverage: null, boundary: [], profiles: [] };

// ---- B positives ---------------------------------------------------------------
results.tests.push(walkLine('P1 laneBExcursion inward', route.laneBExcursion.map(([x, , z]) => [x, z])));
results.tests.push(walkLine('P1 laneBExcursion outward', [...route.laneBExcursion].reverse().map(([x, , z]) => [x, z])));
// reachable edges: capsule offset from each wall along the whole run
const edgePts = (side) => {
  const pts = [];
  for (let ls = -1.30; ls <= 9.35; ls += 0.4) {
    const lx = side > 0 ? eastFace(Math.max(ls, 0.05)) - R - 0.04 : westFace(Math.max(ls, 0.05)) + R + 0.04;
    const w = toWorldB(lx, 0, ls);
    pts.push([+w[0].toFixed(3), +w[2].toFixed(3)]);
  }
  return pts;
};
results.tests.push(walkLine('P2 laneB east reachable edge', edgePts(+1)));
results.tests.push(walkLine('P2 laneB west reachable edge', edgePts(-1)));
results.tests.push(walkLine('P2 laneB centreline street->pocket', (() => {
  const pts = [];
  for (let ls = -1.35; ls <= 9.35; ls += 0.35) { const w = toWorldB(0, 0, ls); pts.push([+w[0].toFixed(3), +w[2].toFixed(3)]); }
  return pts;
})()));

// ---- B negatives ----------------------------------------------------------------
// static probes in the v6 degenerate apron band (rays fell through there)
for (const [nm, lx, ls] of [
  ['N3 apron probe centre (0, -0.55)', 0.0, -0.55],
  ['N3 apron probe east (0.5, -1.0)', 0.5, -1.0],
  ['N3 apron probe west (-0.5, -0.3)', -0.5, -0.3],
  ['N3 apron probe mid-band (0.2, -1.25)', 0.2, -1.25],
]) {
  const w = toWorldB(lx, 0, ls);
  results.tests.push(pushProbe(nm, [w[0], 0.11, w[2]], 0, 2));
}
const yawTo = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
const bPush = (name, lx0, ls0, lxT, lsT) => {
  const f = toWorldB(lx0, 0, ls0), t = toWorldB(lxT, 0, lsT);
  return pushProbe(name, [f[0], 0.11, f[2]], yawTo(f, t), 3);
};
const pushSideDoor = bPush('N2 side door (s=3.1, east facade)', 0.3, 3.1, 1.9, 3.1);
const pushSvcDoor = bPush('N2 rear service door (s=7.3)', 0.3, 7.3, 1.9, 7.3);
const pushBack = bPush('N2 back wall corner (s=10)', 0.3, 8.5, 0.3, 10.4);
const pushFunE = bPush('N1 funnel wall east (s=1)', 0.2, 1.0, 1.4, 1.0);
const pushFunW = bPush('N1 funnel wall west (s=2)', -0.2, 2.0, -1.5, 2.0);
const pushPierOut = bPush('N1 portal pier from street', 0.0, -0.8, 0.9, -0.2);
results.tests.push(pushSideDoor, pushSvcDoor, pushBack, pushFunE, pushFunW, pushPierOut);

// boundary gaps from the FINAL foot points to the wall faces (lane-local);
// slanted funnel walls are judged by the PERPENDICULAR distance to the wall
// line — the character controller legitimately slides along them while pushed
const gap = (push, faceLx) => {
  const [lx] = toLocalB(push.stop[0], push.stop[2]);
  return Math.abs(faceLx - lx);
};
const gapPerp = (push, px, ps, nx, nz) => {
  const [lx, ls] = toLocalB(push.stop[0], push.stop[2]);
  return Math.abs(nx * (lx - px) + nz * (ls - ps));
};
const feN = [0.930, -0.368], fwN = [-0.962, -0.272];   // funnel wall unit normals
results.boundary.push(
  { wall: 'sideDoor(s3.1)@facade1.80', gapM: +gap(pushSideDoor, 1.80).toFixed(3), expect: R, pass: Math.abs(gap(pushSideDoor, 1.80) - R) <= 0.06 },
  { wall: 'svcDoor(s7.3)@facade1.80', gapM: +gap(pushSvcDoor, 1.80).toFixed(3), expect: R, pass: Math.abs(gap(pushSvcDoor, 1.80) - R) <= 0.06 },
  { wall: 'backWall@s10.0', gapM: +(() => { const [, ls] = toLocalB(pushBack.stop[0], pushBack.stop[2]); return Math.abs(10.0 - ls); })().toFixed(3), expect: R, pass: Math.abs((() => { const [, ls] = toLocalB(pushBack.stop[0], pushBack.stop[2]); return Math.abs(10.0 - ls); })() - R) <= 0.06 },
  { wall: 'funnelEast@s1', gapM: +gapPerp(pushFunE, eastFace(1.0), 1.0, feN[0], feN[1]).toFixed(3), expect: R, pass: Math.abs(gapPerp(pushFunE, eastFace(1.0), 1.0, feN[0], feN[1]) - R) <= 0.06 },
  { wall: 'funnelWest@s2', gapM: +gapPerp(pushFunW, westFace(2.0), 2.0, fwN[0], fwN[1]).toFixed(3), expect: R, pass: Math.abs(gapPerp(pushFunW, westFace(2.0), 2.0, fwN[0], fwN[1]) - R) <= 0.06 },
);

// ---- B coverage grid: down-rays over the whole corridor ------------------------
let samples = 0, misses = 0, badY = 0, yMin = 1e9, yMax = -1e9;
const holes = [];
for (let ls = -1.35; ls <= 9.45; ls += 0.15) {
  const we = eastFace(Math.max(ls, -1.35)) - R - 0.01;
  const ww = westFace(Math.max(ls, -1.35)) + R + 0.01;
  for (let lx = ww; lx <= we; lx += 0.15) {
    const w = toWorldB(lx, 0, ls);
    samples++;
    const ray = new RAPIER.Ray({ x: w[0], y: 2.0, z: w[2] }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 4.0, true);
    if (!hit) { misses++; if (holes.length < 12) holes.push([+lx.toFixed(2), +ls.toFixed(2)]); continue; }
    const y = 2.0 - hit.timeOfImpact;
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    if (y < 0.05 || y > 0.12) { badY++; if (holes.length < 12) holes.push([+lx.toFixed(2), +ls.toFixed(2), +y.toFixed(3)]); }
  }
}
results.coverage = { step: 0.15, lsRange: [-1.35, 9.45], samples, misses, badY, groundYRange: [+yMin.toFixed(3), +yMax.toFixed(3)], firstHoles: holes };

// ---- B surface profiles: adjacent-sample height steps <= 0.021 m ----------------
const groundY = (lx, ls) => {
  const w = toWorldB(lx, 0, ls);
  const ray = new RAPIER.Ray({ x: w[0], y: 2.0, z: w[2] }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 4.0, true);
  return hit ? 2.0 - hit.timeOfImpact : null;
};
const profile = (name, pts) => {
  const ys = pts.map(([lx, ls]) => [lx, ls, groundY(lx, ls)]);
  let maxStep = 0, worst = null, holesN = 0;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i][2] === null || ys[i - 1][2] === null) { holesN++; continue; }
    const d = Math.abs(ys[i][2] - ys[i - 1][2]);
    if (d > maxStep) { maxStep = d; worst = [ys[i - 1], ys[i]]; }
  }
  return { name, samples: ys.length, holes: holesN, maxStepM: +maxStep.toFixed(4),
    worst: worst && worst.map((q) => [+q[0].toFixed(3), +q[1].toFixed(3), +q[2].toFixed(3)]), pass: holesN === 0 && maxStep <= 0.021 };
};
{
  const portal = []; for (let ls = -0.35; ls <= 0.351; ls += 0.02) portal.push([0, ls]);
  const centre = []; for (let ls = -1.45; ls <= 9.451; ls += 0.06) centre.push([0, ls]);
  const eastEdge = []; for (let ls = 0; ls <= 9.401; ls += 0.06) eastEdge.push([eastFace(ls) - R - 0.05, ls]);
  const westEdge = []; for (let ls = 0; ls <= 9.401; ls += 0.06) westEdge.push([westFace(ls) + R + 0.05, ls]);
  results.profiles.push(profile('B portal axis (ls -0.35..0.35)', portal));
  results.profiles.push(profile('B centreline street->pocket', centre));
  results.profiles.push(profile('B east reachable edge', eastEdge));
  results.profiles.push(profile('B west reachable edge', westEdge));
}

// ---- A regression (original coordinates from the delivered v6 walk test) --------
const N05_A = [42.02, -9.83], N05_B = [42.57, -16.80];
const N06_A = [44.00, -9.67], N06_B = [44.87, -14.79];
const lineX = (p0, p1, z) => p0[0] + (p1[0] - p0[0]) * (p0[1] - z) / (p0[1] - p1[1]);
const designI = JSON.parse(await readFile(resolve(root, 'world/lane-a-polish/interfaces/measurements.json'), 'utf8')).design;
const WN = designI.measuredAnchors.newWallWestFace.north, WS = designI.measuredAnchors.newWallWestFace.south;
const wallX = (z) => WN[0] + (WS[0] - WN[0]) * (z - WN[1]) / (WS[1] - WN[1]);
const cyA = Math.cos(YAW_A), syA = Math.sin(YAW_A);
const toLocalA = (x, z) => [cyA * (x - T_A[0]) - syA * (z + 16.375), syA * (x - T_A[0]) + cyA * (z + 16.375)];

results.tests.push(walkLine('P3 laneAExcursion inward (regression)', route.laneAExcursion.map(([x, , z]) => [x, z])));
results.tests.push(walkLine('P3 laneAExcursion outward (regression)', [...route.laneAExcursion].reverse().map(([x, , z]) => [x, z])));
results.tests.push(walkLine('P3 east band street->portal (regression, was void)', [[43.9, -10.6], [44.05, -12.0], [44.15, -13.6], [44.3, -15.2], [44.4, -16.2]]));
for (const [nm, p] of [
  ['N3 void probe mouth-right (43.9,-10.6)', [43.9, 0.11, -10.6]],
  ['N3 void probe east strip (43.7,-12.0)', [43.7, 0.11, -12.0]],
  ['N3 void probe portal corner (44.0,-15.3)', [44.0, 0.11, -15.3]],
]) results.tests.push(pushProbe(nm, p, 0, 2));

const pushW = pushProbe('N1 push west into N05 wall @z-13.4', [43.4, 0.11, -13.4], Math.PI / 2, 3);
const pushE06 = pushProbe('N1 push east into N06 wall @z-13.4', [43.4, 0.11, -13.4], -Math.PI / 2, 3);
const pushEW = pushProbe('N1 push east into new mouth wall @z-15.6', [44.2, 0.11, -15.6], -Math.PI / 2, 3);
const pushDoor = pushProbe('N2 push into closed rear door', [43.4, 0.11, -21.3], Math.PI / 2, 3);
const pushEnd = pushProbe('N2 push into lane end band @-23.8', [43.65, 0.11, -23.5], 0, 3);
results.tests.push(pushW, pushE06, pushEW, pushDoor, pushEnd);
const dist = {
  n05West: +(pushW.stop[0] - lineX(N05_A, N05_B, pushW.stop[2])).toFixed(3),
  n06East: +(lineX(N06_A, N06_B, pushE06.stop[2]) - pushE06.stop[0]).toFixed(3),
  newWallEast: +(wallX(pushEW.stop[2]) - pushEW.stop[0]).toFixed(3),
  rearDoor: +(1.35 - toLocalA(pushDoor.stop[0], pushDoor.stop[2])[0]).toFixed(3),
  laneEnd: +(8.0 - toLocalA(pushEnd.stop[0], pushEnd.stop[2])[1]).toFixed(3),
};
for (const [k, v] of Object.entries(dist)) results.boundary.push({ wall: `A:${k}`, gapM: v, expect: R, pass: Math.abs(v - R) <= 0.06 });
// A portal threshold 2cm profile (original coordinates)
const portalPts = [];
for (let ls = -0.30; ls <= 0.301; ls += 0.02) {
  const w = [43.545 + 0.02506 * ls, -16.375 - 0.99969 * ls];
  const ray = new RAPIER.Ray({ x: w[0], y: 2.0, z: w[1] }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 4.0, true);
  portalPts.push([+w[0].toFixed(3), +w[1].toFixed(3), hit ? 2.0 - hit.timeOfImpact : null]);
}
{
  let maxStep = 0, holesN = 0;
  for (let i = 1; i < portalPts.length; i++) {
    if (portalPts[i][2] === null || portalPts[i - 1][2] === null) { holesN++; continue; }
    maxStep = Math.max(maxStep, Math.abs(portalPts[i][2] - portalPts[i - 1][2]));
  }
  results.profiles.push({ name: 'A portal axis (regression)', samples: portalPts.length, holes: holesN, maxStepM: +maxStep.toFixed(4), pass: holesN === 0 && maxStep <= 0.021 });
}

player.dispose();
await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'walktest-v7.json'), JSON.stringify(results, null, 1));

// ---- verdict ------------------------------------------------------------------
let fail = 0;
const ok = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) fail++; };
for (const t of results.tests.filter((t) => t.name.startsWith('P'))) {
  ok(t.reached && !t.fell && t.feetYMin > 0.085, `${t.name} (reached=${t.reached} feetYMin=${t.feetYMin}${t.fell ? ` FELL ${JSON.stringify(t.fell)}` : ''})`);
}
for (const t of results.tests.filter((t) => t.name.startsWith('N3'))) {
  ok(t.grounded && t.stop[1] > 0.08, `${t.name} -> grounded=${t.grounded} y=${t.stop[1]}`);
}
for (const b of results.boundary) ok(b.pass, `${b.wall}: gap=${b.gapM} (expect ${b.expect})`);
ok(misses === 0 && badY === 0, `B coverage grid: ${samples} samples, misses=${misses}, badY=${badY}, groundY=${results.coverage.groundYRange}`);
for (const pr of results.profiles)
  ok(pr.pass, `surface profile ${pr.name}: maxStep=${pr.maxStepM}m holes=${pr.holes}`, pr.worst ? JSON.stringify(pr.worst) : '');
if (holes.length) console.log('holes:', JSON.stringify(holes));
console.log(fail === 0 ? 'WALKTEST_V7_PASS' : `WALKTEST_V7_FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
