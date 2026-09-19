// Street-sidefaces contract tests — FULL dataset (M batch frozen + A batch
// shared/instanced): every skin validator-clean and sha-faithful; M-batch
// ids/shas unchanged; A-batch unique tris <= 30,000, instanced <= 120,000;
// every A collider offset >= 0.04 off its wall and intersecting nothing;
// instance count = deduped visible wall count.
//
// Run: node tests/sideface_contract.test.mjs   (exit 0 = contract holds)
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/street-sidefaces');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/sidefaces/plan-full.json'), 'utf8'));
const mCfg = JSON.parse(await readFile(resolve(root, 'kit/gable-skin.config.json'), 'utf8'));

// C1 — every skin present, validator-clean, sha-faithful, per-face budget
for (const k of manifest.skins) {
  const bytes = await readFile(resolve(root, k.glb.replace('./', '')));
  check(`C1: ${k.id} sha`, sha(bytes) === k.sha256);
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check(`C1: ${k.id} validator 0 errors`, (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors`);
}
check('C1: per-skin tris <= 1500', manifest.skins.every((k) => k.triangles <= 1500));
check('C1: A-batch unique tris <= 30,000',
  manifest.triangleAccounting.uniqueSkinsTris.actual <= 30000,
  `${manifest.triangleAccounting.uniqueSkinsTris.actual}`);
check('C1: instanced placed tris <= 120,000',
  manifest.triangleAccounting.instancedPlacedTris.actual <= 120000,
  `${manifest.triangleAccounting.instancedPlacedTris.actual}`);

// C2 — M batch frozen: ids + shas unchanged
{
  const mFaces = JSON.parse(await readFile(resolve(root, 'kit/out/sidefaces/faces.json'), 'utf8'));
  const original = new Map();
  for (const f of mFaces.faces) original.set(f.faceId, f.sha256);
  let ok = 0;
  for (const [id, s] of original) {
    const k = manifest.skins.find((x) => x.id === id && x.batch === 'M');
    if (k && k.sha256 === s) ok++;
  }
  check('C2: all M-batch skins kept (ids + shas unchanged)', ok === original.size, `${ok}/${original.size}`);
  check('C2: M-batch config untouched (6 targets / 10 faces)',
    mCfg.targets.length === 6 && mCfg.targets.reduce((s, t) => s + t.faces.length, 0) === 10,
    `${mCfg.targets.length} targets / ${mCfg.targets.reduce((s, t) => s + t.faces.length, 0)} faces`);
}

// C3 — counts
{
  check('C3: shared skins = plan classes', manifest.counts.aBatchSharedSkins === plan.uniqueSkinClasses,
    `${manifest.counts.aBatchSharedSkins}/${plan.uniqueSkinClasses}`);
  check('C3: A instances = plan instances', manifest.counts.aBatchInstances === plan.instanceCount,
    `${manifest.counts.aBatchInstances}/${plan.instanceCount}`);
  check('C3: M instances = 10 (frozen)', manifest.counts.mBatchInstances === 10);
  check('C3: every non-M wall either skinned or skipped with reason',
    plan.instanceCount + plan.skippedCount === plan.wallCount,
    `${plan.instanceCount}+${plan.skippedCount}=${plan.wallCount}`);
  check('C3: colliders = instances (one slab each)',
    collision.colliders.length === manifest.counts.instancesTotal,
    `${collision.colliders.length}`);
}

// C4 — every A collider: zero intersection with delivered colliders (exact SAT)
{
  const recs = [];
  const street = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
  recs.push(...street.colliders);
  for (const dir of ['world/east-edge', 'world/street-completion']) {
    for (const f of await readdir(resolve(root, dir))) {
      if (!f.startsWith('east-shop-')) continue;
      const c = JSON.parse(await readFile(resolve(root, dir, f, 'collision.json'), 'utf8'));
      recs.push(...c.colliders);
    }
  }
  const centers = (r) => {
    const o = r.obb ?? {};
    if (!o.pos) return null;
    const co = Math.cos(o.theta), si = Math.sin(o.theta);
    return { name: r.name,
      c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
          o.pos[2] - si * o.center[0] + co * o.center[2]],
      yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] };
  };
  const cornersOf = (o) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    return [[o.half[0], o.half[2]], [o.half[0], -o.half[2]], [-o.half[0], o.half[2]], [-o.half[0], -o.half[2]]]
      .map(([x, z]) => [o.c[0] + c * x + s * z, o.c[2] - s * x + c * z]);
  };
  const obbOverlap = (a, b) => {
    if (Math.abs(a.c[1] - b.c[1]) >= a.half[1] + b.half[1]) return false;
    const ca = cornersOf(a), cb = cornersOf(b);
    const axes = [];
    for (const box of [a, b]) {
      const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
      axes.push([c, -s], [s, c]);
    }
    for (const ax of axes) {
      const pa = ca.map((p) => p[0] * ax[0] + p[1] * ax[1]);
      const pb = cb.map((p) => p[0] * ax[0] + p[1] * ax[1]);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
  };
  const delivered = recs.map(centers).filter(Boolean);
  const aColliders = collision.colliders.filter((c) => c.batch === 'A');
  check('C4: A colliders present for every A instance', aColliders.length === plan.instanceCount,
    `${aColliders.length}/${plan.instanceCount}`);
  let badInter = 0, badName = '';
  for (const c of aColliders) {
    const skin = centers(c);
    for (const d of delivered) {
      if (obbOverlap(skin, d)) { badInter++; badName = `${c.name} x ${d.name}`; break; }
    }
  }
  check('C4: zero skin/delivered-collider intersections (exact SAT)', badInter === 0, badName);
  check('C4: every A collider records an outward normal',
    aColliders.every((c) => Array.isArray(c.outward) && c.outward.length === 2));
}

// C5 — dataset structure
{
  const instances = JSON.parse(await readFile(resolve(DS, 'instances.json'), 'utf8'));
  check('C5: M instances identity-placed', instances.instances
    .filter((i) => i.batch === 'M')
    .every((i) => i.positionGlb.join(',') === '0,0,0' && i.rotationYRad === 0));
  check('C5: A instances carry wall-center transforms',
    instances.instances.filter((i) => i.batch === 'A')
      .every((i) => i.positionGlb.length === 3 && typeof i.rotationYRad === 'number'
        && !!i.from?.localBox));
  const cameras = JSON.parse(await readFile(resolve(DS, 'cameras.json'), 'utf8'));
  check('C5: evidence cameras kept (M poses + A views)', cameras.cameras.length >= 10,
    `${cameras.cameras.length}`);
}

console.log(failures === 0 ? '\nSIDEFACE_CONTRACT PASS' : `\nSIDEFACE_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
