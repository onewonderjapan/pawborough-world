// Street-sidefaces visibility tests — FULL dataset (M + A instances).
// From M1 route sample eyes (every 10 m), ray to each skin slab center:
// the FIRST collider hit must be that skin or the wall record it covers
// (the wall body sits directly behind the slab) — never pass through.
//
// Run: node tests/sideface_visibility.test.mjs   (exit 0 = no see-through)
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
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/sidefaces/plan-full.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/route.json'), 'utf8'));

// sample eyes along the route every 10 m at 1.6 m height
const eyes = [];
{
  const pts = route.mainStreet;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.round(d / 10));
    for (let k = 0; k < n; k++)
      eyes.push([a[0] + (b[0] - a[0]) * k / n, 1.6, a[2] + (b[2] - a[2]) * k / n]);
  }
  eyes.push([...pts[pts.length - 1]]);
}

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
  recs.push(...collision.colliders);
}
const boxes = recs.map((r) => {
  const o = r.obb ?? {};
  if (!o.pos) return null;
  const co = Math.cos(o.theta), si = Math.sin(o.theta);
  return { name: r.name,
    c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
        o.pos[2] - si * o.center[0] + co * o.center[2]],
    yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] };
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

const aColliders = collision.colliders.filter((c) => c.batch === 'A');
check('V0: A skin slabs present', aColliders.length === plan.instanceCount,
  `${aColliders.length}/${plan.instanceCount}`);

// for each A skin, from the 3 nearest eyes, ray to the slab center:
// the first hit among ALL boxes must be the skin or a delivered record of the
// same module (the wall the skin covers).
let tested = 0, failed = 0;
for (const col of aColliders) {
  const o = col.obb;
  const co = Math.cos(o.theta), si = Math.sin(o.theta);
  const sc = [o.pos[0] + co * o.center[0] + si * o.center[2],
              o.center[1] + (o.pos[1] ?? 0),
              o.pos[2] - si * o.center[0] + co * o.center[2]];
  const moduleName = col.name.replace('gableskin:', '').split(':')[0];
  const sorted = eyes.map((e) => ({ e, d: Math.hypot(e[0] - sc[0], e[2] - sc[2]) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
  let okAny = false, blockedBy = null;
  for (const { e, d } of sorted) {
    if (d < 2 || d > 90) continue;
    let best = { name: null, t: Infinity };
    for (const b of boxes) {
      const t = hitT(e, sc, b);
      if (t !== null && t < best.t) best = { name: b.name, t };
    }
    const isSkin = best.name === col.name;
    const isOwnWall = best.name?.startsWith(moduleName + ':');
    if (isSkin || isOwnWall) { okAny = true; break; }
    if (!blockedBy) blockedBy = `${best.name} @${d.toFixed(0)}m`;
  }
  tested++;
  if (!okAny) { failed++; if (failed <= 5) console.log(`FAIL ${col.name}: blocked by ${blockedBy}`); }
}
check(`V1: every A skin is first-hit (or own wall) from its nearest route eyes (${tested} skins)`,
  failed === 0, `${failed} see-through/blocked`);

console.log(failures === 0 ? '\nSIDEFACE_VISIBILITY PASS' : `\nSIDEFACE_VISIBILITY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
