// SC-F1 contract: the 128/129 display-window visible solid faces carry
// matching collision. Lead review found a real gap — a Rapier ray from the
// display-window centre (y=1.5m, from 0.5m outside the facade, 1m inward)
// passed through BOTH delivered east-shop-128/129 collision sidecars, because
// kit/components.py display_window_on_wall emitted no collider records.
//
// This test drives the REAL production path: the delivered world-space
// sidecars (world/east-edge/east-shop-*/collision.json), real Rapier, and
// addWallCollider (the same obbToWorld math the browser runs). It reproduces
// the lead probe plus targeted negative/positive controls, and pins the
// geometry story: GLB triangle counts still match the manifest (visual
// geometry untouched — collision is sidecar-only).
//
// Run: node tests/sc_f1_display_collision.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { readGlb } from '../src/world/glbReader.js';
import { addWallCollider } from '../src/world/physics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const manifest = JSON.parse(await readFile(resolve(root, 'world/east-edge/review-manifest.json'), 'utf8'));
const FACES = ['display-window-reveal', 'display-window-counter-face', 'display-window-counter-top'];

// per-building probe definitions in ASSET-LOCAL GLB coords (facade plane z=0,
// inward = -z, +z = toward the street). Values come from the frozen configs
// (bay width 10.7m for both): display window centre u = widthM * uRatio,
// lead probe height y=1.5m.
const PROBES = {
  'east-shop-128': {
    displayU: 10.7 * 0.19, doorU: 10.7 * -0.22, doorY: 2.1 / 2,
    wallU: 10.7 * -0.108, // solid facade band between the door edge (-0.169W) and the reveal edge (-0.048W)
  },
  'east-shop-129': {
    displayU: 10.7 * 0.15, doorU: 10.7 * -0.27, doorY: 2.1 / 2,
    wallU: 10.7 * -0.1505, // between the door edge (-0.219W) and the reveal edge (-0.083W)
  },
};

for (const a of manifest.eastEdgeAssets.assets) {
  const id = a.id;
  const sidecarPath = resolve(root, a.collision.replace('./', ''));
  const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
  const [ox, oy, oz] = a.positionGlb;
  const theta = a.rotationYRad;
  const c = Math.cos(theta), s = Math.sin(theta);
  // asset-local (x, z) -> world, same rotation convention as obbToWorld
  const toWorld = (lx, ly, lz) => [ox + c * lx + s * lz, oy + ly, oz - s * lx + c * lz];
  const inwardDir = [-s, 0, -c]; // local -z rotated into world
  const outwardDir = [s, 0, c];

  const colliders = sidecar.colliders.map((record) => addWallCollider(RAPIER, world, record));
  world.step(); // prime the query pipeline, exactly like buildPhysicsWorld does
  const nameOf = new Map(colliders.map((cl) => [cl.handle, cl.record.name]));
  const hitName = (origin, dir, maxToi) => {
    const h = world.castRay(new RAPIER.Ray({ x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0], y: dir[1], z: dir[2] }), maxToi, true);
    return h ? { toi: h.timeOfImpact, name: nameOf.get(h.collider.handle) ?? '(other)' } : null;
  };

  console.log(`\n=== ${id} (${sidecar.colliders.length} colliders, yaw ${theta.toFixed(4)} rad) ===`);

  // SC-F1 core: the lead probe must now hit the visible display-window face
  const dc = toWorld(PROBES[id].displayU, 1.5, 0);
  const start = [dc[0] + outwardDir[0] * 0.5, dc[1], dc[2] + outwardDir[2] * 0.5];
  const dh = hitName(start, inwardDir, 1.0);
  check(`${id}: lead probe (window centre y=1.5m, 0.5m out, 1m in) hits`,
    dh !== null && FACES.some((f) => dh.name.endsWith(f)), dh ? `${dh.name} @ ${dh.toi.toFixed(3)}m` : 'NO HIT');
  check(`${id}: hit is at the visible face (within 0.55m, i.e. at/just proud of the facade)`,
    dh !== null && dh.toi < 0.55, dh ? `${dh.toi.toFixed(3)}m` : '');

  // closed door stays closed: unchanged collider in front of the door panel
  const dpc = toWorld(PROBES[id].doorU, PROBES[id].doorY, 0);
  const ph = hitName([dpc[0] + outwardDir[0] * 0.5, dpc[1], dpc[2] + outwardDir[2] * 0.5], inwardDir, 1.0);
  check(`${id}: closed front door still blocks (front-door-panel)`,
    ph !== null && ph.name.endsWith('front-door-panel'), ph ? `${ph.name} @ ${ph.toi.toFixed(3)}m` : 'NO HIT');

  // solid facade band between door and window keeps its wall colliders
  const wc = toWorld(PROBES[id].wallU, 1.5, 0);
  const wh = hitName([wc[0] + outwardDir[0] * 0.5, wc[1], wc[2] + outwardDir[2] * 0.5], inwardDir, 1.0);
  check(`${id}: facade band between door and window still blocked by wall`,
    wh !== null && wh.name.includes('front-wall'), wh ? `${wh.name} @ ${wh.toi.toFixed(3)}m` : 'NO HIT');

  // the three matching thin-box records exist, one per visible solid face
  const names = sidecar.colliders.map((cl) => cl.name);
  for (const f of FACES) check(`${id}: sidecar has ${id}:${f}`, names.includes(`${id}:${f}`));

  // visual geometry untouched: real GLB triangle count still equals the manifest
  const glbPath = resolve(root, a.glb.replace('./', ''));
  const glbBuf = await readFile(glbPath);
  const glb = readGlb(glbBuf);
  const tris = glb.meshes.reduce((t, m) => t + m.indices.length / 3, 0);
  check(`${id}: GLB triangles unchanged and match manifest`, tris === a.triangles, `${tris} vs ${a.triangles}`);
  const sha = createHash('sha256').update(glbBuf).digest('hex');
  check(`${id}: manifest sha256 matches the delivered GLB bytes`, sha === a.sha256);

  for (const cl of colliders) removeCl(world, cl);
}

function removeCl(world, cl) {
  world.removeCollider(cl.collider, false);
  world.removeRigidBody(cl.body);
}

console.log(failures === 0 ? '\nSC_F1_RAYCHECK_PASS' : `\nSC_F1_RAYCHECK_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
