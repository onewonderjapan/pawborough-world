// fangbang-temple bridge PASSAGE test — REAL Rapier + the production
// WalkController/CruiseDriver chain over the assembled bridge dataset.
// Positive: the capsule cruises east tail end -> main street -> west
// extension -> forecourt -> threshold -> temple axis -> stair foot (the
// 0.17m platform risers are a documented capsule limit from
// temple_dadian_passage — the honest terminus; the doors stay covered by a
// negative that spawns on the platform), then back east. Whole route
// y >= -0.05; joint seams (west junction, east tail seam) stall <= 1s.
// Negatives (route.json): seal wall, shop-165 placeholder, forecourt east
// open edge (falls — no synthetic slab), dadian closed doors.
// This is an AUTO cruise (driver log) — never a manual walk claim.
//
// Run: node tests/fangbang_bridge_passage.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { validateWorldInputs } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { buildPhysicsWorld, addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { CruiseDriver } from '../src/player/cruise.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

await RAPIER.init();
const B = 'world/fangbang-temple/';
const DS = JSON.parse(await readFile(resolve(root, '..', 'DESIGN_SPEC.json'), 'utf8'));
const T = DS.templePlacement.translationGlb;
const YAW = DS.templePlacement.yawRad;
const SY = Math.sin(YAW), CY = Math.cos(YAW);
const localZ = (wx, wz) => SY * (wx - T[0]) + CY * (wz - T[2]);
const j = (p) => readFile(resolve(root, p), 'utf8').then(JSON.parse);
const [manifest, instances, collision, route, blocks] = await Promise.all([
  'review-manifest.json', 'instances.json', 'collision-world.json', 'route.json', 'blocks.json',
].map((p) => j(B + p)));
validateWorldInputs({ manifest, instances, collision, route, blocks });

// ground exactly as the page builds it: A = assembly + west surface
// (WorldLoader), B = east tail surface (page-level GLB)
const glb = readGlb(await readFile(resolve(root, 'world/street-reviewed.glb')));
const west = readGlb(await readFile(resolve(root, B + 'west-extension/surface.glb')));
const east = readGlb(await readFile(resolve(root, 'world/street-completion/surface.glb')));
const gtA = collectGroundTriangles([...glb.meshes, ...west.meshes].filter((m) => /^(street-kit__|sctail__)/.test(m.name)));
const gtB = collectGroundTriangles(east.meshes.filter((m) => /^sctail__/.test(m.name)));
check('both ground trimeshes non-empty', gtA.triangleCount > 10000 && gtB.triangleCount > 500,
  `A=${gtA.triangleCount} B=${gtB.triangleCount}`);
const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles: gtA });
addGroundCollider(RAPIER, physics.world, gtB);

// temple-court ground (temple-ground__ faces inside the assets block), same
// as the page: the three court GLBs instanced by T + yaw (all offsets [0,0,0])
{
  const mul4 = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  };
  const rotY = [CY, 0, -SY, 0, 0, 1, 0, 0, SY, 0, CY, 0, 0, 0, 0, 1];
  const inst = [...rotY]; inst[12] = T[0]; inst[13] = T[1]; inst[14] = T[2];
  const M = mul4(inst, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).map((v, i) => v); // T·R
  const templeMeshes = [];
  for (const f of ['ground.glb', 'court-open.glb', 'dadian-court.glb']) {
    const g = readGlb(await readFile(resolve(root, B + 'temple-axis', f)));
    for (const m of g.meshes) if (/^temple-ground__/.test(m.name)) templeMeshes.push({ name: m.name, positions: m.positions, indices: m.indices, matrix: mul4(M, Array.from(m.matrix)) });
  }
  const gtT = collectGroundTriangles(templeMeshes);
  check('temple ground trimesh non-empty', gtT.triangleCount > 500, `${gtT.triangleCount}`);
  addGroundCollider(RAPIER, physics.world, gtT);
}

// refined shop walls via their delivered sidecars (same path blockViews uses)
for (const id of ['block-east-edge-shops', 'block-street-completion-shops']) {
  const blk = blocks.blocks.find((b) => b.id === id);
  for (const a of blk.assets) {
    const side = await j(a.collision.replace(/^\.\//, ''));
    for (const rec of side.colliders) addWallCollider(RAPIER, physics.world, rec);
  }
}
// active placeholder boxes for the loaded adjacent districts (BlockManager math)
const byId = new Map(blocks.placeholders.map((p) => [p.id, p]));
for (const bid of ['block-adjacent-east', 'block-adjacent-west']) {
  const blk = blocks.blocks.find((b) => b.id === bid);
  for (const pid of blk.placeholderIds) {
    const ph = byId.get(pid);
    if (ph.replacedBy) continue;
    addWallCollider(RAPIER, physics.world, {
      name: `placeholder:${ph.id}`, type: 'box',
      obb: { pos: [ph.glbPoint[0], 0, ph.glbPoint[1]], theta: ph.angleRad, center: [0, ph.heightM / 2, 0], size: [ph.widthM, ph.heightM, ph.depthM] },
    });
  }
}

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const dt = 1 / 60;

// --- 1. forward + return cruise ------------------------------------------------
{
  const c = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [route.entries.bridgeStart[0], 1.0, route.entries.bridgeStart[2]] } });
  let fell = false, minFeetY = 1e9;
  let jointStallS = 0, maxJointStallS = 0;
  let stillS = 0;
  const jointZone = (p) => (p[0] > -4 && p[0] < 1) || (p[0] > 84 && p[0] < 89);
  const drive = (driver) => {
    driver.tick(dt);
    c.step(dt);
    const p = c.feetPosition();
    minFeetY = Math.min(minFeetY, p[1]);
    if (p[1] < -0.05) fell = true;
  };
  const driver = new CruiseDriver({ controller: c, waypoints: route.mainStreet, reachRadius: 1.4, timeoutSteps: 60 * 900 });
  let guard = 60 * 1200;
  let last = c.feetPosition();
  while (!driver.done && guard-- > 0) {
    drive(driver);
    const p = c.feetPosition();
    if (Math.hypot(p[0] - last[0], p[2] - last[2]) < 0.008) {
      stillS += dt;
      if (jointZone(p)) {
        jointStallS += dt;
        maxJointStallS = Math.max(maxJointStallS, jointStallS);
      }
      const lz = localZ(p[0], p[2]);
      if (lz < -38 && stillS > 6) break;              // blocked at the riser: expected terminus
      if (stillS > 12 && !fell) break;
    } else { stillS = 0; if (!jointZone(p)) jointStallS = 0; }
    last = p;
  }
  const end = c.feetPosition();
  const stairFootLZ = localZ(route.stair.footGlb[0], route.stair.footGlb[2]);
  check('forward cruise reaches the stair foot (localZ <= stair foot + 0.5)',
    localZ(end[0], end[2]) <= stairFootLZ + 0.5 && !driver.blocked,
    `stop localZ=${localZ(end[0], end[2]).toFixed(2)} (stair foot ${stairFootLZ.toFixed(2)}) blocked=${JSON.stringify(driver.blocked)}`);
  check('no fall on the forward leg (y >= -0.05 throughout)', !fell && minFeetY >= -0.05, `minY ${minFeetY.toFixed(3)}`);
  check('joint seams stall <= 1s', maxJointStallS <= 1.0, `max ${maxJointStallS.toFixed(2)}s`);
  check('cruise marked auto (driver log)', driver.log.length > 40, `${driver.log.length}/${route.mainStreet.length - 1} waypoints`);

  const back = new CruiseDriver({ controller: c, waypoints: [...route.mainStreet].reverse(), reachRadius: 1.6, timeoutSteps: 60 * 900 });
  guard = 60 * 1200;
  minFeetY = 1e9;
  while (!back.done && guard-- > 0) { back.tick(dt); c.step(dt); minFeetY = Math.min(minFeetY, c.feetPosition()[1]); }
  const w0 = route.mainStreet[0];
  const f = c.feetPosition();
  check('return cruise reaches the east tail start', back.done && Math.hypot(f[0] - w0[0], f[2] - w0[2]) < 3.5,
    `stop=(${f[0].toFixed(1)},${f[2].toFixed(1)}) target=(${w0[0]},${w0[2]})`);
  check('no fall on the return leg', minFeetY >= -0.05, `minY ${minFeetY.toFixed(3)}`);
  c.dispose();
}

// --- 2. settle stations on the new west pavement ---------------------------------
{
  let settled = 0;
  const stations = [90, 60, 30, 0, -30, -60, -90, -120, -140];
  const centerW = await j('kit/out/fangbang-temple/west-extension-spec.json');
  for (const x of stations) {
    let q = centerW.samples[0];
    for (const s of centerW.samples) if (Math.abs(s.x - x) < Math.abs(q.x - x)) q = s;
    const c = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [q.x, 0.8, q.z] } });
    for (let i = 0; i < Math.round(2 / dt); i++) c.step(dt);
    const [, fy] = c.feetPosition();
    if (fy > -0.05 && fy < 0.4) settled += 1;
    c.dispose();
  }
  check('capsule settles on the pavement at all 9 stations', settled === 9, `${settled}/9`);
}

// --- 3. negatives ------------------------------------------------------------------
const runNeg = (neg, seconds = 4) => {
  const c = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [neg.spawn[0], 1.0, neg.spawn[2]] } });
  const start = c.feetPosition();
  c.yaw = Math.atan2(-neg.dir[0], -neg.dir[2]);
  for (let i = 0; i < Math.round(seconds / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const f = c.feetPosition();
  const out = { final: [f[0], f[2]], advanced: Math.hypot(f[0] - start[0], f[2] - start[2]), feetY: f[1] };
  c.dispose();
  return out;
};
{
  const n = route.negatives[0];
  const r = runNeg(n);
  check('negative: seal wall stops the capsule east of its plane',
    r.final[0] > n.barrierX - 0.2 && r.feetY >= -0.05, `finalX ${r.final[0].toFixed(2)} vs barrier ${n.barrierX}`);
}
{
  const n = route.negatives[1];
  const r = runNeg(n);
  const ph = byId.get(n.targetShop);
  const b = { x: ph.glbPoint[0], z: ph.glbPoint[1], theta: ph.angleRad, hw: ph.widthM / 2, hd: ph.depthM / 2 };
  const dx = r.final[0] - b.x, dz = r.final[1] - b.z;
  const lx = Math.cos(b.theta) * dx - Math.sin(b.theta) * dz;
  const lz = Math.sin(b.theta) * dx + Math.cos(b.theta) * dz;
  const gap = Math.hypot(Math.max(Math.abs(lx) - b.hw, 0), Math.max(Math.abs(lz) - b.hd, 0));
  check('negative: shop-165 placeholder stops the capsule at its face',
    gap > 0 && gap <= n.maxObbGapM && r.feetY >= -0.05, `obbGap ${gap.toFixed(2)}m`);
}
{
  const n = route.negatives[2];
  const r = runNeg(n, 5);
  check('negative: forecourt east edge is open and falls (no synthetic slab)',
    (r.feetY < -1.0 && r.advanced > 1.0) || (r.feetY >= -0.05 && r.advanced < n.maxAdvancedM),
    `advanced ${r.advanced.toFixed(2)} feetY ${r.feetY.toFixed(2)}`);
}
{
  const n = route.negatives[3];
  const r = runNeg(n);
  const lz = localZ(r.final[0], r.final[1]);
  check('negative: dadian closed doors stop the capsule (localZ > -44)',
    lz > n.localZLimit && r.feetY >= -0.05, `finalLocalZ ${lz.toFixed(3)}`);
}

console.log(failures === 0 ? 'FANGBANG_BRIDGE_PASSAGE PASS' : `FANGBANG_BRIDGE_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
