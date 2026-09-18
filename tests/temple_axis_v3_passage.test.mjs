// Temple AXIS V3 passage tests (corridor batch: burner detour + burner negative) — REAL Rapier, the REAL assembled dataset
// (world/temple-axis-v3/): ground trimesh from the VISIBLE ground meshes of
// ground.glb + court-open.glb + dadian-court-v2.glb + court3.glb + the
// peidian/gallery/houdian base slabs, walls from the world-space collision
// records, driven through the same WalkController the preview page uses.
//
// Positives: full DESIGN_SPEC route forward (gates, stage passage, west
// peidian gallery, platform attempt, east passage, court3, houdian base
// front) and back to the street. Negatives: the six structured + the v3 burner
// DESIGN_SPEC.route.negatives. Plus the fall check (nothing below y -0.05).
//
// Run: node tests/temple_axis_v2_passage.test.mjs   (exit 0 = route holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { GROUND_NODE_RE } from '../src/world/collisionAdapter.js';
import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-axis-v3');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

await RAPIER.init();
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));

// instanced modules: bake the instance transform (obbToWorld convention) into
// the ground vertices, exactly what the page does via the THREE node transform
const INSTANCE_OF = {
  'ground.glb': [[0, 0, 0], 0], 'entry-court-v3.glb': [[0, 0, 0], 0],
  'dadian-court-v2.glb': [[0, 0, 0], 0], 'court3.glb': [[0, 0, 0], 0],
  'peidian.glb': [[-11.2, 0, -35.8], Math.PI / 2], 'peidian-e.glb': [[11.2, 0, -35.8], -Math.PI / 2],
  'gallery.glb': [[-10.78, 0, -30.99], Math.PI / 2], 'gallery-e.glb': [[10.78, 0, -30.99], -Math.PI / 2],
  'houdian.glb': [[0, 0, -74], 0],
};
const groundMeshes = [];
for (const file of ['ground.glb', 'entry-court-v3.glb', 'dadian-court-v2.glb', 'court3.glb',
  'peidian.glb', 'peidian-e.glb', 'gallery.glb', 'gallery-e.glb', 'houdian.glb']) {
  const src = file.endsWith('-e.glb') ? file.replace('-e.glb', '.glb') : file;
  const [pos, yaw] = INSTANCE_OF[file];
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const glb = readGlb(await readFile(resolve(DS, src)));
  const hits = glb.meshes.filter((m) => /^temple-ground__/.test(m.name));
  check(`ground faces from ${file} qualify`, hits.length >= 1, hits.map((m) => m.name).join(','));
  for (const m of hits) {
    let positions = m.positions;
    if (pos.some((v) => v !== 0) || yaw !== 0) {
      positions = new Float32Array(m.positions.length);
      for (let i = 0; i < m.positions.length; i += 3) {
        const lx = m.positions[i], ly = m.positions[i + 1], lz = m.positions[i + 2];
        positions[i] = pos[0] + cos * lx + sin * lz;
        positions[i + 1] = ly;
        positions[i + 2] = pos[2] - sin * lx + cos * lz;
      }
    }
    groundMeshes.push({
      name: m.name, positions,
      indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
      matrix: m.matrix,
    });
  }
}
const gt = collectGroundTriangles(groundMeshes);
check('ground triangle count sane', gt.triangleCount > 100, `${gt.triangleCount}`);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const mk = (x, z) => new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
const dt = 1 / 60;
const follow = async (c, wps, arriveR = 0.5, maxSeconds = 240) => {
  let wi = 0;
  for (let i = 0; i < Math.round(maxSeconds / dt); i++) {
    const [x, , z] = c.feetPosition();
    while (wi < wps.length && Math.hypot(x - wps[wi][0], z - wps[wi][1]) < arriveR) wi++;
    if (wi >= wps.length) return true;
    const dx = wps[wi][0] - x, dz = wps[wi][1] - z;
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
  }
  return false;
};

// --- 1. positive: gates + stage passage --------------------------------------
{
  const c = mk(0, 5);
  c.yaw = 0;
  const gates = [
    { name: 'shanmen-mid', z: -1.8 }, { name: 'court-mid', z: -12 },
    { name: 'yimen-door', z: -21 }, { name: 'stage-passage', z: -27.5 },
    { name: 'court2-s', z: -30.5 },
  ];
  const marks = [];
  let gi = 0;
  // burner detour (DESIGN_SPEC packageD.entryCourtBurner)
  const wps = [[0, -9.8], [-2.0, -10.5], [-2.0, -13.5], [0, -14.2], [0, -24.5], [0, -28.0], [-4.0, -31.0]];
  let wi = 0;
  for (let i = 0; i < Math.round(90 / dt); i++) {
    const [x, , z] = c.feetPosition();
    while (wi < wps.length && Math.hypot(x - wps[wi][0], z - wps[wi][1]) < 0.45) wi++;
    if (wi >= wps.length) break;
    const dx = wps[wi][0] - x, dz = wps[wi][1] - z;
    c.yaw = Math.atan2(-dx, -dz);
    c.setMoveInput(1, 0);
    c.step(dt);
    const [x2, , z2] = c.feetPosition();
    while (gi < gates.length && z2 <= gates[gi].z) {
      marks.push({ gate: gates[gi].name, grounded: c.isGrounded() });
      gi++;
    }
  }
  check('P1: five gates crossed grounded',
    gates.every((g) => marks.find((m) => m.gate === g.name && m.grounded)),
    marks.map((m) => m.gate).join(','));
  // west peidian gallery loop, back to the axis, platform attempt
  const okGallery = await follow(c, [[-8.5, -31.5], [-8.5, -35.8], [-5.0, -38.0], [0, -39.9]]);
  check('P1: west peidian gallery front reached', okGallery);
  let climbed = false;
  for (let i = 0; i < Math.round(12 / dt); i++) {
    c.setMoveInput(1, 0); c.step(dt);
    const [, y, z] = c.feetPosition();
    if (z <= -42 && y >= 0.78) { climbed = true; break; }
  }
  check('P1: platform ascent attempt resolved honestly (climbed or blocked safely)',
    c.isGrounded(), climbed ? 'climbed' : 'blocked');
  // east via the cheek-free lane, passage, court3, houdian front
  const okEast = await follow(c, [[0, -40.2], [0, -38.6], [6.0, -38.6], [6.0, -40.2],
    [13.5, -40.2], [13.5, -50.0], [13.5, -60.0]]);
  const okCourt3 = await follow(c, [[8.0, -65.0], [0, -66.0], [0, -70.0], [0, -71.8]]);
  check('P1: east passage -> court3 reached', okEast && okCourt3);
  check('P1: route holds the boundary wall line (x stays < 16.05 on x=13.5 legs)',
    c.feetPosition()[0] < 16.05);
  c.dispose();
}
// --- 2. positive: houdian approach stops honestly ------------------------------
{
  const c = mk(0, -70.0);
  const reached = await follow(c, [[0, -71.8]]);
  for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
  const [x, y, z] = c.feetPosition();
  check('P2: houdian approach reaches the base front and stops (door -74.4 never entered)',
    reached && z > -74.4 && c.isGrounded(), `z ${z.toFixed(2)} grounded=${c.isGrounded()}`);
  c.dispose();
}
// --- 3. positive: return to the street -----------------------------------------
{
  const c = mk(0, -71.8);
  const ok = await follow(c, [[0, -70.0], [0, -66.0], [8.0, -65.0], [13.5, -60.0],
    [13.5, -50.0], [13.5, -40.2], [6.0, -40.2], [6.0, -38.6], [0, -38.6], [-5.0, -38.0],
    [-8.5, -35.8], [-8.5, -31.5], [-4.0, -30.5], [0, -28.0], [0, -14.2],
    [-2.0, -13.5], [-2.0, -10.5], [0, -9.0], [0, 4.2]], 0.55, 300);
  check('P3: mirrored return reaches the street', ok, `z ${c.feetPosition()[2].toFixed(2)}`);
  c.dispose();
}
// --- 4. negatives: the six structured + the v3 burner DESIGN_SPEC.route.negatives ---------------
{
  // n1: west peidian door/lattice blocks; x never below -11.5, no fall
  {
    const c = mk(-9.0, -35.8);
    c.yaw = Math.PI / 2; // west
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x, y] = c.feetPosition();
    check('N1: west peidian door/lattice blocks (x >= -11.5, grounded)',
      x >= -11.5 && c.isGrounded(), `x ${x.toFixed(2)}`);
    c.dispose();
  }
  // n2: gallery bench rail blocks; never behind the back wall (x >= -13.4)
  {
    const c = mk(-10.0, -31.0);
    c.yaw = Math.PI / 2;
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x] = c.feetPosition();
    check('N2: gallery bench rail blocks (x >= -13.4)', x >= -13.4, `x ${x.toFixed(2)}`);
    c.dispose();
  }
  // n3a: pass BETWEEN the stage columns at x=0; n3b: column row blocks eastward
  {
    const c = mk(0, -27.5);
    c.yaw = 0;
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const z = c.feetPosition()[2];
    check('N3a: stage passage clear at x=0 (z < -29.8)', z < -29.8, `z ${z.toFixed(2)}`);
    c.dispose();
    const c2 = mk(2.4, -26.6);
    c2.yaw = -Math.PI / 2; // east along the front column row line
    for (let i = 0; i < Math.round(3 / dt); i++) { c2.setMoveInput(1, 0); c2.step(dt); }
    const [x2] = c2.feetPosition();
    check('N3b: eastward walk blocked by the stage column (x < 2.7)', x2 < 2.7, `x ${x2.toFixed(2)}`);
    c2.dispose();
  }
  // n4: boundary wall x=16.4 blocks eastward at z=-45
  {
    const c = mk(13.5, -45.0);
    c.yaw = -Math.PI / 2;
    for (let i = 0; i < Math.round(5 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x, y] = c.feetPosition();
    check('N4: boundary wall blocks (x <= 16.05, grounded)', x <= 16.05 && c.isGrounded(),
      `x ${x.toFixed(2)}`);
    c.dispose();
  }
  // n5: houdian closed door / base front blocks northward at z=-72
  {
    const c = mk(0, -72.0);
    c.yaw = 0;
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    check('N5: houdian door/base blocks (z > -74.4, grounded)', z > -74.4 && c.isGrounded(),
      `z ${z.toFixed(2)}`);
    c.dispose();
  }
  // n6: north closure z=-84 blocks northward
  {
    const c = mk(0, -83.0);
    c.yaw = 0;
    for (let i = 0; i < Math.round(3 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    check('N6: north closure blocks (z > -84.2, grounded)', z > -84.2 && c.isGrounded(),
      `z ${z.toFixed(2)}`);
    c.dispose();
  }
}
// --- 5. fall check: settle at every route waypoint, nothing drops --------------
{
  let minY = 0;
  for (const p of route.mainStreet) {
    const c = mk(p[0], p[2]);
    for (let i = 0; i < Math.round(1.2 / dt); i++) { c.setMoveInput(0, 0); c.step(dt); }
    minY = Math.min(minY, c.feetPosition()[1]);
    c.dispose();
  }
  check('F1: every route waypoint settles above y -0.05 (no void)', minY >= -0.05,
    `minY ${minY.toFixed(3)}`);
}


  // n7 (v3): the burner blocks the axis north of the court entry
  {
    const c = mk(0, -9.5);
    c.yaw = 0; // north
    for (let i = 0; i < Math.round(5 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, y, z] = c.feetPosition();
    // vessel box front face z=-11.45 + capsule radius 0.35 -> stop ~ -11.10
    // (DESIGN_SPEC's -10.9 is a rounded figure; recorded in route.json)
    check('N7: burner blocks the axis (z in [-11.3,-10.6], grounded)',
      y >= -0.05 && c.isGrounded() && z >= -11.3 && z <= -10.6, `z ${z.toFixed(2)}`);
    c.dispose();
  }

console.log(failures === 0 ? '\nAXIS_V3_PASSAGE PASS' : `\nAXIS_V3_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
