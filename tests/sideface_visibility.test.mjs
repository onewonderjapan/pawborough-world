// Street-sidefaces visibility tests — for every evidence camera in
// world/street-sidefaces/cameras.json: a ray from the camera to its skin
// slab's face point must hit THAT skin slab FIRST among all colliders
// (delivered street/east-edge/street-completion records + the skins).
//
// Run: node tests/sideface_visibility.test.mjs   (exit 0 = every skin reads)
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const collision = JSON.parse(await readFile(resolve(root, 'world/street-sidefaces/collision-world.json'), 'utf8'));
const cameras = JSON.parse(await readFile(resolve(root, 'world/street-sidefaces/cameras.json'), 'utf8'));

const recs = [];
{
  const street = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
  recs.push(...street.colliders);
  for (const dir of ['world/east-edge', 'world/street-completion']) {
    for (const f of await readdir(resolve(root, dir))) {
      if (!f.startsWith('east-shop-')) continue;
      const c = JSON.parse(await readFile(resolve(root, dir, f, 'collision.json'), 'utf8'));
      recs.push(...c.colliders);
    }
  }
  recs.push(...collision.colliders); // the skins compete too
}
const boxes = recs.map((r) => {
  const o = r.obb ?? {};
  if (!o.pos) return null;
  const co = Math.cos(o.theta), si = Math.sin(o.theta);
  return {
    name: r.name,
    c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
        o.pos[2] - si * o.center[0] + co * o.center[2]],
    yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2],
  };
}).filter(Boolean);

function hitT(p, q, box) {
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const px = p[0] - box.c[0], pz = p[2] - box.c[2];
  const qx = q[0] - box.c[0], qz = q[2] - box.c[2];
  const pl = [c * px - s * pz, p[1] - box.c[1], s * px + c * pz];
  const ql = [c * qx - s * qz, q[1] - box.c[1], s * qx + c * qz];
  const d = [ql[0] - pl[0], ql[1] - pl[1], ql[2] - pl[2]];
  let tmin = 0, tmax = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (Math.abs(pl[a]) > box.half[a]) return null;
    } else {
      let t1 = (-box.half[a] - pl[a]) / d[a], t2 = (box.half[a] - pl[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

check('V0: one camera per skin slab', cameras.cameras.length === collision.colliders.length,
  `${cameras.cameras.length}/${collision.colliders.length}`);

for (const cam of cameras.cameras) {
  const skin = boxes.find((b) => b.name === cam.skinCollider);
  if (!skin) { check(`${cam.id}: skin collider found`, false, cam.skinCollider); continue; }
  // aim at the slab center (a point ON the skin)
  const target = [skin.c[0], skin.c[1], skin.c[2]];
  let best = { name: null, t: Infinity };
  for (const b of boxes) {
    const t = hitT(cam.positionGlb, target, b);
    if (t !== null && t < best.t) best = { name: b.name, t };
  }
  const first = best.name === cam.skinCollider;
  check(`${cam.id}: skin slab is the FIRST hit`, first,
    first ? `t=${best.t.toFixed(3)}` : `blocked by ${best.name} t=${best.t.toFixed(3)}`);
}

console.log(failures === 0 ? '\nSIDEFACE_VISIBILITY PASS' : `\nSIDEFACE_VISIBILITY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
