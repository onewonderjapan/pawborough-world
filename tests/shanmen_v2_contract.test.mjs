// D1 shanmen v2 contract — lions-v2 + wing-window ornaments-v2 as REAL exported
// data: equivalence proofs for the DEFAULT rerun (fallback #6 caliber), the v2
// budgets, the spec collision guard boxes, validator cleanliness, and the
// delivered dataset left byte-untouched.
//
// Run: node tests/shanmen_v2_contract.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V2KIT = resolve(root, 'kit/out/shanmen-v2-assets');
const EQ = resolve(root, 'kit/out/shanmen-v1-equivalence-proof');
const DS = resolve(root, 'world/temple-shanmen');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

// S1 — default-rerun equivalence proofs (v1 semantics preserved)
for (const id of ['lions', 'ornaments']) {
  const txt = await readFile(resolve(EQ, `${id}-equivalence.json`), 'utf8');
  const p = JSON.parse(txt);
  const ok = p.equivalent === true
    && p.checks.triangles_equal === true
    && p.checks.materials_equal === true
    && p.checks.primitives_equal === true
    && p.checks.vertex_count_within_weld_tolerance === true
    && p.checks['bounds_within_1e-4'] === true;
  check(`S1: ${id} default rerun geometrically equivalent (fallback #6 caliber)`,
    ok,
    `tris ${p.delivered.triangles} -> ${p.rerun.triangles}, verts ${p.delivered.vertices} -> ${p.rerun.vertices}`);
}
{
  const a = JSON.parse(await readFile(resolve(root, 'kit/out/temple-shanmen/collision.json'), 'utf8'));
  const b = JSON.parse(await readFile(resolve(root, 'kit/out/shanmen-v1-equivalence/collision.json'), 'utf8'));
  check('S1: default rerun collision records identical to delivered build',
    JSON.stringify(a.colliders) === JSON.stringify(b.colliders), `${a.colliders.length} records`);
}

// S2 — v2 assets: validator-clean, budgets, real geometry checks
for (const [file, trisMax] of [['lions-v2.glb', 7000], ['ornaments-v2.glb', 2400]]) {
  const bytes = await readFile(resolve(V2KIT, file));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check(`S2: ${file} validator 0 errors 0 warnings`,
    (report.issues.numErrors ?? 0) === 0 && (report.issues.numWarnings ?? 0) === 0,
    `${report.issues.numErrors}e/${report.issues.numWarnings}w`);
  const glb = readGlb(bytes);
  check(`S2: ${file} triangles within budget`, glb.totalTriangles <= trisMax,
    `${glb.totalTriangles} <= ${trisMax}`);
  check(`S2: ${file} zero images (new-image budget 0)`, (glb.gltf.images ?? []).length === 0);
}
{
  // lions-v2: two-guard spec collision (0.62 x 1.35 x 0.75 at the spec centers)
  const c = JSON.parse(await readFile(resolve(V2KIT, 'collision.json'), 'utf8'));
  for (const [side, sx] of [['w', -2.15], ['e', 2.15]]) {
    const rec = c.colliders.find((r) => r.name === `lion2-${side}-guard`);
    check(`S2: lion2-${side}-guard present with spec size/center`, !!rec
      && Math.abs(rec.obb.center[0] - sx) < 1e-6 && Math.abs(rec.obb.center[1] - 0.675) < 1e-6
      && Math.abs(rec.obb.center[2] - 1.0) < 1e-6
      && rec.obb.size.every((v, i) => Math.abs(v - [0.62, 1.35, 0.75][i]) < 1e-6),
      rec ? JSON.stringify(rec.obb) : 'missing');
  }
  // the v2 build kept the clear-corridor contract (same 29 records as v1 modulo
  // the guard swap: 2 plinth records out, 2 guard records in)
  check('S2: v2 build collision count = 29 (plinth out, guard in)', c.colliders.length === 29,
    `${c.colliders.length}`);
  const CORRIDOR = { x: 1.45, y0: 0.25, y1: 2.85, z0: -3.55, z1: -0.05 };
  const blocked = c.colliders.filter((r) => !(r.max[0] <= -CORRIDOR.x || r.min[0] >= CORRIDOR.x)
    && !(r.max[1] <= CORRIDOR.y0 || r.min[1] >= CORRIDOR.y1)
    && !(r.max[2] <= CORRIDOR.z0 || r.min[2] >= CORRIDOR.z1));
  check('S2: clear approach corridor still empty', blocked.length === 0, blocked.join(','));
  // ornaments-v2: single joined window assembly on both wings (the joiner
  // merges by group+material into one named mesh)
  {
    const bytes = await readFile(resolve(V2KIT, 'ornaments-v2.glb'));
    const glb = readGlb(bytes);
    const om = glb.meshes[0];
    check('S2: ornaments-v2 is the window assembly (shanmen-ornament group)',
      glb.meshes.length === 1 && /^shanmen-ornament__/.test(om.name)
      && om.indices.length / 3 >= 200,
      `${om.name} tris ${om.indices.length / 3}`);
  }
}

// S3 — the delivered dataset is byte-untouched
{
  const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
  for (const id of ['temple', 'ground', 'lions', 'ornaments']) {
    const bytes = await readFile(resolve(DS, `${id}.glb`));
    check(`S3: delivered ${id}.glb untouched`, manifest.assets[id].sha256 === sha(bytes));
  }
}
// S4 — build provenance recorded (strict keys, versions logged)
{
  const m = JSON.parse(await readFile(resolve(V2KIT, 'measurements.json'), 'utf8'));
  check('S4: v2 build records the variant versions',
    m.design.variants.lionsVersion === 'v2' && m.design.variants.windowsVersion === 'v2');
}

console.log(failures === 0 ? '\nSHANMEN_V2_CONTRACT PASS' : `\nSHANMEN_V2_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
