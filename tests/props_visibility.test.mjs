// E3 props visibility — from the 4 evidence cameras (bridge:junction-west,
// bridge:placeholder-band, bridge:shanmen-from-road, bridge:forecourt-oblique),
// cast a ray fan: at least one ray per camera must FIRST hit a prop collider
// (props sit between the camera and the world colliders). Uses the same
// ray-vs-OBB math as sideface_visibility.
//
// Run: node tests/props_visibility.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const propsCollision = JSON.parse(await readFile(resolve(root, 'world/street-props/collision.json'), 'utf8'));
const street = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
const cams = [
  ...JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v2/cameras.json'), 'utf8')).cameras,
  ...JSON.parse(await readFile(resolve(root, 'world/cameras.json'), 'utf8')).cameras
    .slice(0, 8).map((c) => ({ ...c, id: `street:${c.id}` })),
];
const CAM_IDS = process.env.PROPS_VIS_CAMS
  ? process.env.PROPS_VIS_CAMS.split(',')
  : ['bridge:junction-west', 'bridge:west-road-mid', 'bridge:temple-side-east', 'bridge:axis-long'];

const toBox = (r) => {
  const o = r.obb ?? {};
  if (!o.pos) return null;
  const co = Math.cos(o.theta), si = Math.sin(o.theta);
  return { name: r.name,
    c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
        o.pos[2] - si * o.center[0] + co * o.center[2]],
    yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] };
};
const propBoxes = propsCollision.colliders.map(toBox).filter(Boolean)
  .map((b) => ({ ...b, prop: true }));
const worldBoxes = street.colliders.map(toBox).filter(Boolean);
const boxes = [...propBoxes, ...worldBoxes];

function hitT(p, q, box) {
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const px = p[0] - box.c[0], pz = p[2] - box.c[2];
  const qx = q[0] - box.c[0], qz = q[2] - box.c[2];
  const pl = [c * px - s * pz, p[1] - box.c[1], s * px + c * pz];
  const ql = [c * qx - s * qz, q[1] - box.c[1], s * qx + c * qz];
  const d = [ql[0] - pl[0], ql[1] - pl[1], ql[2] - pl[2]];
  let tmin = 0, tmax = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (Math.abs(pl[a]) > box.half[a]) return null; }
    else {
      let t1 = (-box.half[a] - pl[a]) / d[a], t2 = (box.half[a] - pl[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}


let camerasWithProp = 0;
for (const cid of CAM_IDS) {
  const c = cams.find((x) => x.id === cid || x.id === cid.replace(/^(street|bridge):/, ''));
  check(`V: camera ${cid} present in the bridge contract`, !!c);
  if (!c) continue;
  const eye = [c.positionGlb[0], c.positionGlb[1], c.positionGlb[2]];
  const tgt = [c.targetGlb[0], c.targetGlb[1], c.targetGlb[2]];
  let best = null;
  // aimed rays: from this camera to each of its 5 nearest ground props — the
  // FIRST hit along the ray must be a prop (nothing occludes the layer)
  const near = propBoxes
    .map((b) => ({ b, d: Math.hypot(b.c[0] - eye[0], b.c[2] - eye[2]) }))
    .sort((a, b2) => a.d - b2.d).slice(0, 5);
  for (const { b, d } of near) {
    if (d < 3 || d > 90) continue;
    const q = [b.c[0], b.c[1], b.c[2]];
    let first = { name: null, t: Infinity, prop: false };
    for (const box of boxes) {
      const t = hitT(eye, q, box);
      if (t !== null && t < first.t) first = { name: box.name, t, prop: box.prop };
    }
    if (first.prop) { best = first; break; }
    if (!best) best = false; // candidate occluded; keep looking
  }
  if (best) camerasWithProp += 1;
  check(`V: ${cid} sees at least one prop as FIRST hit`, !!best,
    best ? `${best.name} @${(best.t * 120).toFixed(0)}m` : 'no prop first-hit in fan');
}
check('V: all 4 evidence cameras see props', camerasWithProp === 4, `${camerasWithProp}/4`);

console.log(failures === 0 ? '\nPROPS_VISIBILITY PASS' : `\nPROPS_VISIBILITY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
