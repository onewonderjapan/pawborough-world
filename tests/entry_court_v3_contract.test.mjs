// D2 entry-court v3 contract — the court-open + incense road + bronze burner
// variant as REAL exported data: default-rerun equivalence proof, the
// walkable-surface naming contract (temple-ground__worn-stone), the +0.01
// road height, the burner collision box, validator cleanliness, frozen files
// untouched.
//
// Run: node tests/entry_court_v3_contract.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/temple-axis-v3-assets');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

// C1 — default-rerun equivalence (court-open semantics preserved)
{
  const p = JSON.parse(await readFile(resolve(root, 'kit/out/court-open-equivalence/equivalence-proof.json'), 'utf8'));
  check('C1: court-open default rerun geometrically equivalent',
    p.equivalent === true && p.checks.triangles_equal === true
    && p.checks['bounds_within_1e-4'] === true
    && p.checks.vertex_count_within_weld_tolerance === true,
    `tris ${p.delivered.triangles} -> ${p.rerun.triangles}`);
  const a = JSON.parse(await readFile(resolve(root, 'kit/out/court-open/collision.json'), 'utf8'));
  const b = JSON.parse(await readFile(resolve(root, 'kit/out/court-open-equivalence/collision.json'), 'utf8'));
  check('C1: default rerun collision records identical',
    JSON.stringify(a.colliders) === JSON.stringify(b.colliders), `${a.colliders.length} records`);
}

// C2 — the v3 GLB: validator clean, road naming, road height, burner collision
{
  const bytes = await readFile(resolve(KIT, 'entry-court-v3.glb'));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check('C2: entry-court-v3.glb validator 0 errors 0 warnings',
    (report.issues.numErrors ?? 0) === 0 && (report.issues.numWarnings ?? 0) === 0,
    `${report.issues.numErrors}e/${report.issues.numWarnings}w`);
  const glb = readGlb(bytes);
  const m = JSON.parse(await readFile(resolve(KIT, 'measurements.json'), 'utf8'));
  check('C2: triangles match the kit build and stay sane',
    glb.totalTriangles === m.targets['entry-court-v3.glb'].triangles && glb.totalTriangles <= 5000,
    `${glb.totalTriangles}`);
  // walkable-surface contract: the road faces are named temple-ground__worn-stone
  const road = glb.meshes.filter((mesh) => mesh.name === 'temple-ground__worn-stone');
  check('C2: incense road faces named temple-ground__worn-stone', road.length === 1,
    road.map((x) => x.name).join(','));
  if (road.length === 1) {
    // the worn-stone mesh joins ALL stone-material walkable faces (court
    // borders, yimen floor...). Isolate the ROAD by its footprint: vertices
    // in the forecourt band (|x| <= 1.5, z 0..7) are the road slabs only.
    let maxY = -1e9, roadAny = false;
    for (let i = 0; i < road[0].positions.length; i += 3) {
      const x = road[0].positions[i], y = road[0].positions[i + 1], z = road[0].positions[i + 2];
      if (Math.abs(x) <= 1.51 && z >= -0.01 && z <= 7.01) {
        roadAny = true;
        maxY = Math.max(maxY, y);
      }
    }
    check('C2: road slabs present in the forecourt band', roadAny);
    check('C2: road top at +0.01 (<= 1cm proud of the court surface)',
      maxY <= 0.011 && maxY >= 0.009, `maxY ${maxY.toFixed(4)}`);
  }
  // zero NEW images: the variant carries exactly the court-open texture set
  {
    const base = readGlb(await readFile(resolve(root, 'world/temple-axis-v2/court-open.glb')));
    check('C2: no new images vs court-open',
      (glb.gltf.images ?? []).length === (base.gltf.images ?? []).length,
      `${(base.gltf.images ?? []).length} -> ${(glb.gltf.images ?? []).length}`);
  }
  // burner: collision box per spec 1.1 x 1.3 x 1.1 at (0, 0.65, -12)
  const c = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));
  const block = c.colliders.find((r) => r.name === 'burner-vessel-block');
  check('C2: burner vessel collision box per spec', !!block
    && block.obb.size.every((v, i) => Math.abs(v - [1.1, 1.3, 1.1][i]) < 1e-6)
    && block.obb.center.every((v, i) => Math.abs(v - [0, 0.65, -12][i]) < 1e-6),
    block ? JSON.stringify(block.obb) : 'missing');
  // burner bronze geometry really exists in the GLB
  const bronze = glb.meshes.filter((mesh) => /entry-court__bronze/.test(mesh.name));
  check('C2: bronze burner meshes exported', bronze.length === 1
    && bronze[0].indices.length / 3 >= 300, bronze.map((x) => x.name).join(','));
  // provenance
  const used = JSON.parse(await readFile(resolve(KIT, 'config-used.json'), 'utf8'));
  check('C2: v3 build provenance records buildCutoffWall=false',
    used.buildCutoffWall === false);
}

// C3 — frozen sources untouched
{
  const v2m = JSON.parse(await readFile(resolve(root, 'world/temple-axis-v2/review-manifest.json'), 'utf8'));
  const co = await readFile(resolve(root, 'world/temple-axis-v2/court-open.glb'));
  check('C3: delivered court-open.glb untouched', v2m.assets.courtOpen.sha256 === sha(co));
}

console.log(failures === 0 ? '\nENTRY_COURT_V3_CONTRACT PASS' : `\nENTRY_COURT_V3_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
