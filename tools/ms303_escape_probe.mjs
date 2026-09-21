// REL-03 follow-up: is the [-130.5, 28.1] pocket enterable/escapable?
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
const TT = [-127.817, 0, 27.057], TYAW = 0.16703;
const _c = Math.cos(TYAW), _s = Math.sin(TYAW);
const templeFrame = [_c, 0, -_s, 0, 0, 1, 0, 0, _s, 0, _c, 0, TT[0], 0, TT[2], 1];
const groundSources = [
  [resolve(root, 'world/fangbang-temple-v5/street-reviewed-lanes.glb'), /street-kit__/, null],
  [resolve(root, 'world/fangbang-temple-v4/west-extension/surface.glb'), /sctail__/, null],
  [resolve(root, 'world/street-completion/surface.glb'), /sctail__/, null],
  [resolve(root, 'world/fangbang-temple-v3/temple-axis/ground.glb'), /temple-ground__/, templeFrame],
  [resolve(root, 'world/fangbang-temple-v4/temple-axis/court-open.glb'), /temple-ground__/, templeFrame],
  [resolve(root, 'world/fangbang-temple-v3/temple-axis/court3.glb'), /temple-ground__/, templeFrame],
];
const groundMeshes = [];
for (const [path, re, frame] of groundSources) {
  const glb = readGlb(await readFile(path));
  groundMeshes.push(...glb.meshes.filter((m) => re.test(m.name)).map((m) => ({ name: m.name,
    positions: m.positions, indices: m.indices ?? Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i),
    matrix: frame ?? m.matrix })));
}
const gt = collectGroundTriangles(groundMeshes);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
for (const rec of collision.colliders) addWallCollider(RAPIER, world, rec);
addGroundCollider(RAPIER, world, gt);
world.step();
const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const dt = 1 / 60;

// walk from `from` toward `to`, report final state (no waypoint logic)
function push(from, to, maxS = 12) {
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [from[0], 1.0, from[2]] } });
  let t = 0, stall = 0;
  while (t < maxS) {
    const p0 = c.feetPosition();
    const d = Math.hypot(p0[0] - to[0], p0[2] - to[2]);
    if (d < 0.25) break;
    c.yaw = Math.atan2(-(to[0] - p0[0]), -(to[2] - p0[2]));
    c.setMoveInput(1, 0);
    c.step(dt); t += dt;
    const p1 = c.feetPosition();
    if (Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 0.006) { stall += dt; if (stall > 1.2) break; }
    else stall = 0;
  }
  const f = c.feetPosition();
  const dist = Math.hypot(f[0] - to[0], f[2] - to[2]);
  c.dispose();
  return { from: [from[0], from[2]], to: [to[0], to[2]], at: [+f[0].toFixed(2), +f[2].toFixed(2)],
    distToTarget: +dist.toFixed(2), stuck: stall > 1.2 };
}

const P = [-130.5, 28.1];
const out = { pocket: P, probes: {} };
out.probes.enter_fromGateFront = push([-129.0, 0, 28.6], P);       // from the gate front area
out.probes.enter_fromNE = push([-128.0, 0, 30.0], P);              // from NE street corner
out.probes.enter_fromW = push([-133.0, 0, 28.0], P);               // from west street
out.probes.enter_fromLionSide = push([-131.6, 0, 29.6], P);        // from NW of the lion
// escape: stand AT the pocket, push each direction
for (const [label, tgt] of Object.entries({
  escape_N: [-130.5, 0, 32.0], escape_S: [-130.5, 0, 24.0], escape_E_gate: [-127.8, 0, 27.06],
  escape_W_street: [-134.0, 0, 28.0], escape_NE: [-128.5, 0, 31.0], escape_SE: [-129.0, 0, 24.5],
})) out.probes[label] = push([P[0], 0, P[1]], tgt);
console.log(JSON.stringify(out, null, 1));
