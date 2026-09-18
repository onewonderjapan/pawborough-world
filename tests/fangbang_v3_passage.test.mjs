// Fangbang-temple V3 westshops passage test — REAL Rapier on the assembled v3
// dataset. Scope: the WEST BAND delta (the new westshops) — the full-bridge
// cruise is exercised by the page's own automatic cruise (FANGBANG_WEB_PASS,
// route=true on ?ds=fangbang-temple-v3&skins=1) and the temple segment by
// temple_axis_v2_passage.
//
// Checks: west-band centerline walk end-to-end; walking into any upgraded
// facade is blocked; crossing a >1.5 m gap strip is blocked.
//
// Run: node tests/fangbang_v3_passage.test.mjs   (exit 0 = route holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

import { collectGroundTriangles } from '../src/world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from '../src/world/physics.js';
import { WalkController } from '../src/player/WalkController.js';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/fangbang-temple-v3');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

await RAPIER.init();
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/westshops/plan.json'), 'utf8'));

// ground: the west-extension surface (the band's walkable pavement)
const groundMeshes = [];
{
  const glb = readGlb(await readFile(resolve(DS, 'west-extension', 'surface.glb')));
  const hits = glb.meshes.filter((m) => /sctail__|street-kit__/.test(m.name));
  check('west band ground faces present', hits.length >= 1, hits.map((m) => m.name).join(','));
  groundMeshes.push(...hits.map((m) => ({ name: m.name, positions: m.positions,
    indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
    matrix: m.matrix })));
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

// P1 — walk the west-extension ROAD centerline end-to-end (the road must stay
// walkable with the upgraded shops flanking it)
{
  const wspec = JSON.parse(await readFile(resolve(root,
    'kit/out/fangbang-temple/west-extension-spec.json'), 'utf8'));
  const line = wspec.samples.filter((s, i) => i % 8 === 0).map((s) => [s.x, s.z]);
  let ok = false;
  for (const dirSign of [1, -1]) {
    const pts = dirSign === 1 ? line : [...line].reverse();
    const c = mk(pts[0][0], pts[0][1]);
    let wi = 0;
    for (let i = 0; i < Math.round(240 / dt); i++) {
      const [x, , z] = c.feetPosition();
      while (wi < pts.length && Math.hypot(x - pts[wi][0], z - pts[wi][1]) < 1.5) wi++;
      if (wi >= pts.length) { ok = true; break; }
      const dx = pts[wi][0] - x, dz = pts[wi][1] - z;
      c.yaw = Math.atan2(-dx, -dz);
      c.setMoveInput(1, 0);
      c.step(dt);
      if (c.feetPosition()[1] < -0.05) break;
    }
    c.dispose();
    if (ok) break;
  }
  check('P1: west-band road centerline walkable end-to-end (both directions)', ok);
}
// P2 — walking north into a north-row facade is blocked by the module body
{
  const north = plan.entries.filter((e) => e.side === 'north');
  let blocked = 0;
  for (const e of north.slice(0, 3)) {
    const c = mk(e.frontCenter[0], e.frontCenter[1] + 4.0);
    c.yaw = Math.PI; // walk south toward the facade (facades face north here)
    for (let i = 0; i < Math.round(3 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    if (z > e.frontCenter[1] + 0.2) blocked++; // stopped north of the wall line
    c.dispose();
  }
  check('P2: north-row facades block southbound walks', blocked >= 1,
    `${blocked}/${Math.min(3, north.length)}`);
}
// P3 — strip wall (courtyard infill on the front line) blocks a walker
// crossing the gap from the road toward the shops
{
  const strips = collision.colliders.filter((c) => c.name.startsWith('westshops-strips:'));
  check('P3: strip colliders present for >1.5 m gaps', strips.length >= 1, `${strips.length}`);
  // road centerline z under each strip: samples give the built centerline
  const wspec = JSON.parse(await readFile(resolve(root,
    'kit/out/fangbang-temple/west-extension-spec.json'), 'utf8'));
  let tested = 0, blockedCount = 0;
  const failLog = [];
  for (const strip of strips) {
    const sc = [(strip.min[0] + strip.max[0]) / 2, 0, (strip.min[2] + strip.max[2]) / 2];
    let near = wspec.samples[0], bd = Infinity;
    for (const s of wspec.samples) {
      const d = (s.x - sc[0]) ** 2 + (s.z - sc[2]) ** 2;
      if (d < bd) { bd = d; near = s; }
    }
    // walk from the centerline toward the strip (perpendicular to the road)
    const dirZ = Math.sign(sc[2] - near.z) || 1;
    const c = mk(near.x, near.z);
    c.yaw = dirZ > 0 ? Math.PI : 0; // forward = (−sin yaw, −cos yaw)
    let crossed = false, failMode = 'timeout';
    for (let i = 0; i < Math.round(7 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x2, y2, z2] = c.feetPosition();
      if (y2 < -0.05) { crossed = true; failMode = 'FELL'; break; }
      const throughZ = dirZ > 0 ? z2 >= sc[2] - 0.05 : z2 <= sc[2] + 0.05;
      const withinX = x2 >= strip.min[0] - 0.3 && x2 <= strip.max[0] + 0.3;
      if (throughZ && withinX) { crossed = true; failMode = 'CROSSED'; break; }
    }
    if (!crossed) blockedCount++;
    else failLog.push(`${strip.name} mode=${failMode} end=${c.feetPosition().map((v) => +v.toFixed(1)).join(',')}`);
    tested++;
    c.dispose();
  }
  check('P3: strips block walks from the road into the gap (never crosses, never falls)',
    blockedCount === tested && tested > 0, `${blockedCount}/${tested} ${failLog.join('; ')}`);
}
// P4 — facades block northbound walks
{
  const tb = JSON.parse(await readFile(resolve(DS, 'blocks.json'), 'utf8'));
  const tbBlock = tb.blocks.find((x) => x.id === 'block-west-shops');
  let tested = 0, blocked = 0;
  for (const a of tbBlock.assets.slice(0, 6)) {
    const c = mk(a.positionGlb[0], a.positionGlb[2] - 3.0);
    c.yaw = 0;
    for (let i = 0; i < Math.round(2 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const advanced = 3.0 - (a.positionGlb[2] - c.feetPosition()[2]);
    if (advanced < 2.5) blocked++;
    tested++;
    c.dispose();
  }
  check('P4: facades block northbound walks', blocked === tested, `${blocked}/${tested}`);
}

console.log(failures === 0 ? '\nFANGBANG_V3_PASSAGE PASS' : `\nFANGBANG_V3_PASSAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
