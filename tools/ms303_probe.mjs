// REL-03 (world-reliability 20260921) — ms-303 wedge probe.
// Builds the v7 physics world from the SAME sources the page assembles
// (street assembly + street-completion tails + temple-axis grounds, walls
// from the dataset collision-world.json) and drives the PRODUCTION capsule
// through the mainStreet west-end waypoints BOTH directions, plus focused
// legs around the long-run stall point [-130.5, 28.1].
// Run: node tools/ms303_probe.mjs   → JSON report on stdout
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
await RAPIER.init();

const collision = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v7/collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v7/route.json'), 'utf8'));
const ms = route.mainStreet;

// temple placement (identical to the page: mapRegistration.templePlacement)
const TT = [-127.817, 0, 27.057], TYAW = 0.16703;
const _c = Math.cos(TYAW), _s = Math.sin(TYAW);
const templeFrame = [_c, 0, -_s, 0, 0, 1, 0, 0, _s, 0, _c, 0, TT[0], 0, TT[2], 1]; // column-major

const groundSources = [
  [resolve(root, 'world/fangbang-temple-v5/street-reviewed-lanes.glb'), /street-kit__/, null],
  [resolve(root, 'world/fangbang-temple-v4/west-extension/surface.glb'), /sctail__/, null],
  [resolve(root, 'world/street-completion/surface.glb'), /sctail__/, null],
  [resolve(root, 'world/fangbang-temple-v3/temple-axis/ground.glb'), /temple-ground__/, templeFrame],
  [resolve(root, 'world/fangbang-temple-v4/temple-axis/court-open.glb'), /temple-ground__/, templeFrame],
  [resolve(root, 'world/fangbang-temple-v3/temple-axis/dadian-court-v2.glb'), /temple-ground__/, templeFrame],
  [resolve(root, 'world/fangbang-temple-v3/temple-axis/court3.glb'), /temple-ground__/, templeFrame],
];
const groundMeshes = [];
for (const [path, re, frame] of groundSources) {
  const glb = readGlb(await readFile(path));
  const hits = glb.meshes.filter((m) => re.test(m.name));
  if (!hits.length) { console.error(`WARN no ground faces in ${path}`); continue; }
  groundMeshes.push(...hits.map((m) => ({ name: m.name, positions: m.positions,
    indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
    matrix: frame ?? m.matrix })));
}
const gt = collectGroundTriangles(groundMeshes);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, gt);
world.step();

const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const dt = 1 / 60;

// drive the production capsule along waypoints (same contract as the page's
// __fangbangWalkRoute / routeCheck CruiseDriver): hold W toward the current
// waypoint, advance on reach, stall = <6 mm progress for 1.2 s
function walkLeg(pts, { reach = 1.4, timeoutS = 60, log = [] } = {}) {
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [pts[0][0], 1.0, pts[0][2]] } });
  let wi = 1, t = 0, stall = 0, stalledAt = null, minDist = Infinity;
  const start = c.feetPosition();
  while (t < timeoutS) {
    const p0 = c.feetPosition();
    if (wi >= pts.length) break;
    const tgt = pts[wi];
    const d = Math.hypot(p0[0] - tgt[0], p0[2] - tgt[2]);
    minDist = Math.min(minDist, d);
    if (d <= reach) { wi += 1; stall = 0; continue; }
    c.yaw = Math.atan2(-(tgt[0] - p0[0]), -(tgt[2] - p0[2]));
    c.setMoveInput(1, 0);
    c.step(dt);
    t += dt;
    const p1 = c.feetPosition();
    if (p1[1] < -0.05) { log.push({ fell: true, at: p1.map(v => +v.toFixed(2)) }); break; }
    if (Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 0.006) {
      stall += dt;
      if (stall > 1.2) { stalledAt = p1.map(v => +v.toFixed(2)); break; }
    } else stall = 0;
  }
  const end = c.feetPosition();
  c.dispose();
  return {
    reached: wi >= pts.length, stalledAt, stallS: +stall.toFixed(2),
    start: [start[0], start[2]].map(v => +v.toFixed(2)),
    end: [end[0], end[2]].map(v => +v.toFixed(2)),
    feetY: +end[1].toFixed(3), minDist: +minDist.toFixed(2),
  };
}

const report = { groundTriangles: gt.triangleCount, walls: collision.colliders.length, legs: {} };

// 1. the long-run stall: held W at [-130.5,28.1] targeting back-301 = ms[301]
report.legs.fromStall_to_ms301 = walkLeg([[-130.5, 0, 28.1], ms[301]]);
// 2. through-the-gate zigzag, forward (ms-299 → … → ms-308) and back
const seg = ms.slice(299, 309).map(p => [p[0], 0, p[2]]);
report.legs.forward_299_308 = walkLeg(seg);
report.legs.backward_308_299 = walkLeg([...seg].reverse());
// 3. focused single legs
report.legs.ms302_to_ms303 = walkLeg([ms[302], ms[303]]);
report.legs.ms303_to_ms304 = walkLeg([ms[303], ms[304]]);
report.legs.ms304_to_ms303 = walkLeg([ms[304], ms[303]]);
report.legs.ms303_to_ms302 = walkLeg([ms[303], ms[302]]);
report.legs.ms301_to_ms300 = walkLeg([ms[301], ms[300]]);
report.legs.ms300_to_ms301 = walkLeg([ms[300], ms[301]]);
// 4. street-level pass: does the main street flow through without the zigzag?
report.legs.ms298_to_ms305_direct = walkLeg([ms[298], ms[299], ms[300], ms[304], ms[305]]);

console.log(JSON.stringify(report, null, 1));
