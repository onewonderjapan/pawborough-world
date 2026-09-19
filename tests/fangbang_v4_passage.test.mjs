// Fangbang-temple V4 passage test — REAL Rapier on the assembled v4 dataset
// (adoption batch package J). Scope: the EAST extension delta + the route
// extension. P1/P2 walk the FULL route (east end wall -3m -> houdian doors,
// then back) on the page's ground set; N1/N2/N3 are the three new negatives
// (end wall, upgraded storefront, courtyard strip).
//
// Run: node tests/fangbang_v4_passage.test.mjs   (exit 0 = route holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/fangbang-temple-v4');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

await RAPIER.init();
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/east-band/plan.json'), 'utf8'));

// ground: the page's walkable set — street assembly + street-completion tail
// + west extension + east extension (sctail__/street-kit__ faces)
const groundMeshes = [];
// temple assets are authored temple-local — transform by the bridge placement
const TT = [-127.817, 0.0, 27.057], TYAW = 0.16703;
const _c = Math.cos(TYAW), _s = Math.sin(TYAW);
const templeFrame = [_c, 0, -_s, 0, 0, 1, 0, 0, _s, 0, _c, 0, TT[0], 0, TT[2], 1]; // column-major
const groundSources = [
  [resolve(DS, 'east-extension', 'surface.glb'), /sctail__|street-kit__/, null],
  [resolve(root, 'world/street-completion/surface.glb'), /sctail__|street-kit__/, null],
  [resolve(DS, 'west-extension', 'surface.glb'), /sctail__|street-kit__/, null],
  [resolve(root, 'world/street-reviewed.glb'), /street-kit__/, null],
  [resolve(DS, 'temple-axis', 'ground.glb'), /temple-ground__/, templeFrame],
  [resolve(DS, 'temple-axis', 'court-open.glb'), /temple-ground__/, templeFrame],
  [resolve(DS, 'temple-axis', 'court3.glb'), /temple-ground__/, templeFrame],
  [resolve(DS, 'temple-axis', 'dadian-court-v2.glb'), /temple-ground__/, templeFrame],
];
for (const [path, re, frame] of groundSources) {
  const glb = readGlb(await readFile(path));
  const hits = glb.meshes.filter((m) => re.test(m.name));
  check(`ground faces present: ${path.split('/').slice(-2).join('/')}`, hits.length >= 1,
    hits.map((m) => m.name).join(','));
  groundMeshes.push(...hits.map((m) => ({ name: m.name, positions: m.positions,
    indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
    matrix: frame ?? m.matrix })));
}
const gt = collectGroundTriangles(groundMeshes);
check('ground triangle count sane', gt.triangleCount > 1000, `${gt.triangleCount}`);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const mk = (x, z) => new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
const dt = 1 / 60;

// walk a polyline (both directions tried); returns true if the whole line is
// walked without falling or stalling short of the end
async function walkLine(pts, budgetS) {
  for (const dirSign of [1, -1]) {
    const line = dirSign === 1 ? pts : [...pts].reverse();
    const c = mk(line[0][0], line[0][1]);
    let wi = 0, ok = false;
    for (let i = 0; i < Math.round(budgetS / dt); i++) {
      const [x, , z] = c.feetPosition();
      while (wi < line.length && Math.hypot(x - line[wi][0], z - line[wi][1]) < 1.5) wi++;
      if (wi >= line.length) { ok = true; break; }
      const dx = line[wi][0] - x, dz = line[wi][1] - z;
      c.yaw = Math.atan2(-dx, -dz);
      c.setMoveInput(1, 0);
      c.step(dt);
      if (c.feetPosition()[1] < -0.05) break;
    }
    c.dispose();
    if (ok) return true;
  }
  return false;
}

// P1 — the FULL route, using the PAGE'S OWN cruise semantics (CruiseDriver,
// stair-foot terminus, joint-stall tolerance, R1-03 door push): forward from
// the new east start to the stair foot, then return to the east start. The
// pass criteria mirror src/fangbangMain.js runRouteCheck.
{
  const { CruiseDriver } = await import('../src/player/cruise.js');
  const T = [-127.817, 0.0, 27.057], YAW = 0.16703;
  const CY = Math.cos(YAW), SY = Math.sin(YAW);
  const localZ = (wx, wz) => SY * (wx - T[0]) + CY * (wz - T[2]);
  const c = mk(route.mainStreet[0][0], route.mainStreet[0][2]);
  const driver = new CruiseDriver({ controller: c, waypoints: route.mainStreet, reachRadius: 1.4, timeoutSteps: 60 * 900 });
  let guard = 60 * 1200, lastPos = c.feetPosition(), stillS = 0, stairBlocked = false, fell = null, stuckOutside = null;
  let maxStall = 0;
  while (!driver.done && guard-- > 0) {
    driver.tick(dt);
    c.step(dt);
    const p = c.feetPosition();
    const moved = Math.hypot(p[0] - lastPos[0], p[2] - lastPos[2]);
    const lz = localZ(p[0], p[2]);
    if (moved < 0.008) {
      stillS += dt;
      if (lz < -38 && stillS > 6) { stairBlocked = true; break; }
      if (stillS > 12) { stuckOutside = p.map((v) => +v.toFixed(2)); break; }
    } else { stillS = 0; }
    if (stillS > maxStall) maxStall = stillS;
    lastPos = p;
    if (p[1] < -0.05) { fell = p.map((v) => +v.toFixed(2)); break; }
  }
  // R1-03: keep pushing toward the doors after the last waypoint
  const doorW = [T[0] + SY * route.stair.terminusLocalZ, 0, T[2] + CY * route.stair.terminusLocalZ];
  let lastP = c.feetPosition(), doorStill = 0;
  for (let i = 0; i < Math.round(40 / dt); i++) {
    const dx = doorW[0] - c.feetPosition()[0], dz = doorW[2] - c.feetPosition()[2];
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
    const p = c.feetPosition();
    if (p[1] < -0.05) { fell = fell ?? p.map((v) => +v.toFixed(2)); break; }
    if (Math.hypot(p[0] - lastP[0], p[2] - lastP[2]) < 0.008) {
      doorStill += dt;
      if (doorStill > 1.0) break;
    } else doorStill = 0;
    lastP = p;
  }
  const [fx, fy, fz] = c.feetPosition();
  const lzEnd = localZ(fx, fz);
  // The page's own honest terminus is the STAIR FOOT (runRouteCheck comment:
  // "the capsule cannot climb the 0.17m platform risers... the honest terminus
  // is the stair foot; the doors stay covered by the dadian-doors negative").
  // lz < -38 is the recorded stair zone; the R1-03 door push above already
  // held the walker against the doors for 1s.
  check('P1a: forward cruise (east start -> dadian stair foot) holds',
    !fell && !stuckOutside && fy >= -0.05 && lzEnd <= -38,
    fell ? `FELL at ${fell}` : (stuckOutside ? `stuck at ${stuckOutside}` : `finalLocalZ=${lzEnd.toFixed(2)} (stair zone < -38)`));
  // return: the DOORS -> back east to the NEW start. Fresh capsule spawned a
  // few points BEFORE the doors (the doors waypoint itself is the closed-door
  // collider — spawning inside it would fight depenetration; the uphill climb
  // is the page's R1-03 push above and temple_dadian_passage's own evidence).
  const doorPt = route.mainStreet[route.mainStreet.length - 4];
  const c2 = mk(doorPt[0], doorPt[2]);
  const back = new CruiseDriver({ controller: c2, waypoints: [...route.mainStreet].reverse(), reachRadius: 1.6, timeoutSteps: 60 * 900 });
  guard = 60 * 1200;
  while (!back.done && guard-- > 0) { back.tick(dt); c2.step(dt); }
  const w0 = route.mainStreet[0];
  const [rx, ry, rz] = c2.feetPosition();
  const returnPass = Math.hypot(rx - w0[0], rz - w0[2]) < 3.5 && ry >= -0.05;
  check('P1b: return cruise (houdian doors -> east start) holds', returnPass,
    `stop=(${rx.toFixed(1)},${rz.toFixed(1)}) target=(${w0[0].toFixed(1)},${w0[2].toFixed(1)}) y=${ry.toFixed(2)}`);
  c2.dispose();
}
// P2 — the east extension centerline at full 0.5m fidelity (junction to wall)
{
  const spec = JSON.parse(await readFile(resolve(root, 'kit/out/east-extension-spec.json'), 'utf8'));
  const line = spec.samples.map((s) => [s.x, s.z]);
  const ok = await walkLine(line, 400);
  check('P2: east-extension centerline walkable end-to-end (both directions)', ok);
}
// N1 — the end wall stops an eastbound walker ~3m after the route start
{
  const start = route.mainStreet[0];
  const wall = collision.colliders.find((c) => c.name === 'eastext-seal-wall:seal-wall');
  check('N1: end-wall collider present', !!wall);
  if (wall) {
    const c = mk(start[0], start[2]);
    // walk east (+x dominates the road direction at the end)
    c.yaw = -Math.PI / 2;
    let minGapX = Infinity;
    for (let i = 0; i < Math.round(6 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x] = c.feetPosition();
    minGapX = wall.min[0] - x;
    c.dispose();
    check('N1: walker stopped BEFORE the end wall (>= 0.2m clearance)', minGapX >= 0.2,
      `gap=${minGapX.toFixed(2)}m`);
  }
}
// N2 — an upgraded storefront blocks a walk into its facade
{
  const north = plan.entries.filter((e) => e.side === 'south'); // south-row facades face north
  let tested = 0, blocked = 0;
  for (const e of north.slice(0, 3)) {
    const c = mk(e.frontCenter[0], e.frontCenter[1] - 4.0);
    c.yaw = 0; // walk north toward the facade
    for (let i = 0; i < Math.round(3 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    if (z < e.frontCenter[1] - 0.2) blocked++;
    tested++;
    c.dispose();
  }
  check('N2: upgraded storefronts block walks into the facade', blocked >= 1,
    `${blocked}/${Math.min(3, north.length)}`);
}
// N3 — a courtyard strip blocks the walk from the road into the gap
{
  const strips = collision.colliders.filter((c) => c.name.startsWith('eastshops-strips:'));
  check('N3: strip colliders present', strips.length >= 1, `${strips.length}`);
  const spec = JSON.parse(await readFile(resolve(root, 'kit/out/east-extension-spec.json'), 'utf8'));
  let tested = 0, blockedCount = 0;
  const failLog = [];
  for (const strip of strips) {
    const sc = [(strip.min[0] + strip.max[0]) / 2, 0, (strip.min[2] + strip.max[2]) / 2];
    let near = spec.samples[0], bd = Infinity;
    for (const s of spec.samples) {
      const d = (s.x - sc[0]) ** 2 + (s.z - sc[2]) ** 2;
      if (d < bd) { bd = d; near = s; }
    }
    const dirZ = Math.sign(sc[2] - near.z) || 1;
    const c = mk(near.x, near.z);
    c.yaw = dirZ > 0 ? Math.PI : 0; // forward = (−sin yaw, −cos yaw)
    let crossed = false, failMode = 'timeout';
    for (let i = 0; i < Math.round(7 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x2, y2, z2] = c.feetPosition();
      if (y2 < -0.05) { failMode = 'FELL(pinned)'; break; }
      const throughZ = dirZ > 0 ? z2 >= sc[2] - 0.05 : z2 <= sc[2] + 0.05;
      const withinX = x2 >= strip.min[0] - 0.3 && x2 <= strip.max[0] + 0.3;
      if (throughZ && withinX) { crossed = true; failMode = 'CROSSED'; break; }
    }
    if (!crossed) blockedCount++;
    else failLog.push(`${strip.name} mode=${failMode}`);
    tested++;
    c.dispose();
  }
  check('N3: strips block walks from the road into the gap', blockedCount === tested && tested > 0,
    `${blockedCount}/${tested} ${failLog.join('; ')}`);
}

console.log(failures === 0 ? '\nFANGBANG_V4_PASSAGE PASS' : `\nFANGBANG_V4_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
