// Peidian (side hall) contract tests — the kit build against the frozen
// DESIGN_SPEC.peidian numbers: validator-clean GLB, bounding box, column
// grid, closed-door width, BLANK plaque (no textures anywhere), triangle
// budget, monotone roof surface, ground naming, collision set.
//
// Run: node tests/peidian_contract.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/peidian');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const bytes = await readFile(resolve(KIT, 'peidian.glb'));
const measure = JSON.parse(await readFile(resolve(KIT, 'measurements.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));
const materials = JSON.parse(await readFile(resolve(KIT, 'materials.json'), 'utf8'));
const reimport = JSON.parse(await readFile(resolve(KIT, 'reimport-check.json'), 'utf8'));
const roof = JSON.parse(await readFile(resolve(KIT, 'roof-surface-samples.json'), 'utf8'));
const glb = readGlb(bytes);
const SW_GABLE = 3.45;
const DEPTH_C = 4.6;
const THICK_C = 0.1;
const EAVE_C = 3.9;
const RIDGE_C = 6.2;
const RIDGE_Z_C = -1.85;
const ZF_C = 1.5;   // side-wall band |x|

// world-space bounds from the raw meshes (matrix is column-major, same as
// groundMeshesOf in templeViewShared)
function boundsOf(g) {
  const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const m of g.meshes) {
    const p = m.positions, mt = m.matrix;
    for (let i = 0; i < p.length; i += 3) {
      const x = mt[0] * p[i] + mt[4] * p[i + 1] + mt[8] * p[i + 2] + mt[12];
      const y = mt[1] * p[i] + mt[5] * p[i + 1] + mt[9] * p[i + 2] + mt[13];
      const z = mt[2] * p[i] + mt[6] * p[i + 1] + mt[10] * p[i + 2] + mt[14];
      b.min[0] = Math.min(b.min[0], x); b.max[0] = Math.max(b.max[0], x);
      b.min[1] = Math.min(b.min[1], y); b.max[1] = Math.max(b.max[1], y);
      b.min[2] = Math.min(b.min[2], z); b.max[2] = Math.max(b.max[2], z);
    }
  }
  return b;
}
const BOUNDS = boundsOf(glb);

// C1 validator + budget + manifest integrity
{
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check('C1: gltf-validator 0 errors', (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors`);
  check('C1: triangles <= 14,000', measure.targets['peidian.glb'].triangles <= 14000,
    `${measure.targets['peidian.glb'].triangles}`);
  check('C1: sha in measurements matches the bytes',
    measure.targets['peidian.glb'].sha256 === (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'));
  check('C1: reimport mesh count sane', reimport.meshes >= 2, `${reimport.meshes}`);
}

// C2 bounding box: facade 6.6 wide (+ walls to ±3.6), depth -4.6 (+base 1.5),
// ridge 6.2 + beam
{
  const b = BOUNDS;
  check('C2: min x ~ -3.75 (base extent)', Math.abs(b.min[0] + 3.75) < 0.02, `${b.min[0].toFixed(3)}`);
  check('C2: max x ~ +3.75', Math.abs(b.max[0] - 3.75) < 0.02, `${b.max[0].toFixed(3)}`);
  check('C2: rear extent ~ -5.1 (rear overhang)', Math.abs(b.min[2] + 5.1) < 0.05, `${b.min[2].toFixed(3)}`);
  check('C2: front extent ~ +1.5 (base/eave line)', Math.abs(b.max[2] - 1.5) < 0.05, `${b.max[2].toFixed(3)}`);
  check('C2: top ~ ridge + beam 6.2+0.28', Math.abs(b.max[1] - (6.2 + 0.28)) < 0.05, `${b.max[1].toFixed(3)}`);
  check('C2: ground at y ~ 0', Math.abs(b.min[1]) < 0.01, `${b.min[1].toFixed(3)}`);
}

// C3 gallery columns at the frozen ±1.1 / ±3.3, z=0.9, 3.7 tall (collision)
{
  const cols = collision.colliders.filter((c) => c.name === 'peidian-column');
  check('C3: 4 gallery column colliders', cols.length === 4, `${cols.length}`);
  const xs = cols.map((c) => c.obb.center[0]).sort((a, b) => a - b);
  const want = [-3.3, -1.1, 1.1, 3.3];
  check('C3: column x at ±1.1/±3.3', want.every((v, i) => Math.abs(xs[i] - v) < 1e-6),
    xs.map((v) => v.toFixed(2)).join(','));
  check('C3: column z at 0.9', cols.every((c) => Math.abs(c.obb.center[2] - 0.9) < 1e-6));
  check('C3: column height 3.7', cols.every((c) => Math.abs(c.obb.size[1] - 3.7) < 1e-6));
}

// C4 closed door 1.6 wide (two 0.8 leaves), threshold stone
{
  const leaves = collision.colliders.filter((c) => c.name === 'door-leaf');
  check('C4: two closed leaves', leaves.length === 2, `${leaves.length}`);
  const total = leaves.reduce((s, c) => s + c.obb.size[0], 0);
  check('C4: leaves fill 1.6 m', Math.abs(total - 1.6) < 1e-6, `${total}`);
  check('C4: leaf height 2.6', leaves.every((c) => Math.abs(c.obb.size[1] - 2.6) < 1e-6));
  const thr = collision.colliders.find((c) => c.name === 'door-threshold');
  check('C4: stone threshold present', !!thr);
}

// C5 BLANK plaque: zero NEW images — every texture must come from the shared
// frozen palette (compare against the delivered dadian kit inventory), and the
// plaque face (aged-paper join) must exist
{
  const dadianMaterials = JSON.parse(await readFile(resolve(root, 'kit/out/dadian/materials.json'), 'utf8'));
  const shared = new Set(Object.values(dadianMaterials).flatMap((m) => Object.values(m.textures ?? {})));
  const mine = Object.values(materials).flatMap((m) => Object.values(m.textures ?? {}));
  const novel = mine.filter((t) => !shared.has(t));
  check('C5: zero novel textures (shared palette only, budget 0)', novel.length === 0,
    novel.join(','));
  check('C5: plaque face present (aged-paper join)', glb.meshes.some((m) => /aged-paper/.test(m.name)));
  check('C5: plaque carries no atlas (unlike dadian)', !mine.some((t) => /plaque/.test(t)));
}

// C6 roof surface: monotone fall, >=4 x >=24 grid, flat ridge at 6.2
{
  check('C6: gridX >= 4 columns', roof.gridX.length >= 4, `${roof.gridX.length}`);
  check('C6: >= 24 t samples front and rear', roof.front.length >= 24 && roof.rear.length >= 24,
    `${roof.front.length}/${roof.rear.length}`);
  let monotone = true, ridgeFlat = true;
  for (const leg of ['front', 'rear']) {
    for (let i = 0; i < roof.gridX.length; i++) {
      let prev = roof[leg][0].y[i];
      for (const row of roof[leg]) {
        if (row.y[i] > prev + 1e-9) monotone = false;
        prev = row.y[i];
      }
    }
    for (const row of roof[leg]) {
      if (row.t === 0) for (const y of row.y) if (Math.abs(y - 6.2) > 1e-6) ridgeFlat = false;
    }
  }
  check('C6: surface never rises toward the eave (both slopes, all columns)', monotone);
  check('C6: ridge stays flat at 6.2 (硬山, no hip falloff)', ridgeFlat);
}

// C7 ground naming + collision set (spec: 柱4 侧墙2 后墙1 闭门1 格扇面2 台基侧面3)
{
  const groundNodeNames = glb.gltf.nodes.map((n) => n.name ?? '')
    .filter((n) => /^temple-ground__/.test(n));
  check('C7: temple-ground__ node exported (exact contract name)',
    groundNodeNames.includes('temple-ground__worn-stone'), groundNodeNames.join(','));
  const count = (n) => collision.colliders.filter((c) => c.name === n).length;
  check('C7: 4 columns', count('peidian-column') === 4);
  check('C7: 2 gable walls (lower)', count('gable-wall-lower') === 2);
  check('C7: 1 rear wall', count('rear-wall') === 1);
  check('C7: closed door = 2 leaves', count('door-leaf') === 2);
  check('C7: 2 lattice bay backings', count('bay-backing') === 2);
  check('C7: base slab carries the side collision (skirts removed per R1-06)',
    count('peidian-base') === 1);
  check('C7: interiorVerifiedEmpty recorded', !!collision.interiorVerifiedEmpty);
}

  // R1-02: the wall corners must NOT carry thin full-height plaster slabs
  // (they used to reach the ridge soffit: 6.02 / 7.83). Corner bands now close
  // at the LOCAL roof soffit — the frozen roof puts its edge at the wall ends
  // ~1.2 m above the eave (the ridge sits INSIDE the depth), so the bound is
  // the roof slope line at that z, not the flat eave. Regression bound: the
  // corner plaster stays >= 1 m below the ridge.
  {
    const plasterNode = glb.meshes.find((m) => m.name === 'peidian-body__weathered-lime-plaster');
    const aPos2 = null; void aPos2;
    const f32raw = plasterNode.positions; // readGlb node: already-world Float32 locals
    const f32 = f32raw;
    const localRoofAt = (z) => EAVE_C + (RIDGE_C - EAVE_C) * Math.min(1, Math.max(0, (ZF_C - z) / (ZF_C - RIDGE_Z_C)));
    let worst = 0, worstAt = '', over = false;
    for (let i = 0; i < f32.length / 3; i++) {
      const x = f32[i * 3], y = f32[i * 3 + 1], z = f32[i * 3 + 2];
      if (Math.abs(Math.abs(x) - SW_GABLE) > 0.2) continue;
      let bound = null, at = '';
      if (Math.abs(z) < 0.3) { bound = localRoofAt(-0.3) - THICK_C + 0.20; at = `front z=${z.toFixed(2)}`; }
      else if (Math.abs(Math.abs(z) - DEPTH_C) < 0.3) { bound = localRoofAt(-(DEPTH_C - 0.3)) - THICK_C + 0.20; at = `rear z=${z.toFixed(2)}`; }
      if (bound !== null) {
        if (y > worst) { worst = y; worstAt = at; }
        if (y > bound) over = true;
      }
    }
    check('C8: corner bands cap at the local roof soffit, never the ridge (R1-02)',
      !over && worst < RIDGE_C - 1.0, `worst corner y ${worst.toFixed(3)} at ${worstAt}`);
  }

console.log(failures === 0 ? '\nPEIDIAN_CONTRACT PASS' : `\nPEIDIAN_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
