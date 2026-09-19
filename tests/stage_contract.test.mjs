// Yimen rear stage (仪门背面戏楼) contract tests — DESIGN_SPEC.stage:
// ridge strictly below the yimen ridge 7.7, raised floor NOT walkable and
// NOT temple-ground, exactly 4 columns + 1 rail colliders, center passage
// clear at x=0, collider footprints sane.
//
// Run: node tests/stage_contract.test.mjs   (exit 0 = contract holds)
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/yimen-stage');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const bytes = await readFile(resolve(KIT, 'yimen-stage.glb'));
const measure = JSON.parse(await readFile(resolve(KIT, 'measurements.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));
const glb = readGlb(bytes);

// S1 validator + budget + ridge assertion
{
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check('S1: gltf-validator 0 errors', (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors`);
  check('S1: triangles <= 9,000', measure.targets['yimen-stage.glb'].triangles <= 9000,
    `${measure.targets['yimen-stage.glb'].triangles}`);
  check('S1: stage ridge 7.4 recorded strictly below yimen 7.7',
    measure.design.ridgeBelowYimen.stage === 7.4
    && measure.design.ridgeBelowYimen.yimen === 7.7);
  check('S1: measurements sha matches bytes',
    measure.targets['yimen-stage.glb'].sha256 === createHash('sha256').update(bytes).digest('hex'));
}

// S2 floor: raised to 2.6, NOT walkable ground, no floor collider
{
  const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const m of glb.meshes) {
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
  check('S2: columns reach the ground, roof reaches the ridge zone',
    b.min[1] > -0.01 && b.min[1] < 0.05 && b.max[1] > 7.4 && b.max[1] < 7.9,
    `y ${b.min[1].toFixed(2)}..${b.max[1].toFixed(2)}`);
  // R1-01: NO visible mesh in the open under-stage zone
  // x in [-2.87,2.87], y in [0.10,2.40], z in [-8.90,-5.20] (GLB coords)
  let underStage = 0;
  for (const m of glb.meshes) {
    const p = m.positions, mt = m.matrix;
    for (let i = 0; i < p.length; i += 3) {
      const x = mt[0] * p[i] + mt[4] * p[i + 1] + mt[8] * p[i + 2] + mt[12];
      const y = mt[1] * p[i] + mt[5] * p[i + 1] + mt[9] * p[i + 2] + mt[13];
      const z = mt[2] * p[i] + mt[6] * p[i + 1] + mt[10] * p[i + 2] + mt[14];
      if (Math.abs(x) < 2.87 - 1e-4 && y > 0.10 + 1e-4 && y < 2.40 - 1e-4
        && z > -8.90 + 1e-4 && z < -5.20 - 1e-4) { underStage++; break; }
    }
  }
  check('S2: under-stage zone is open (R1-01: the old solid wood box is gone)',
    underStage === 0, `${underStage} meshes with vertices in the zone`);
  {
    // the passage CORE (|x| < 2.5, well inside the column inner faces) has no
    // wood below 2.4 — the columns (x ±3.0) legitimately reach the ground
    let coreWood = 0;
    for (const m of glb.meshes) {
      const p = m.positions, mt = m.matrix;
      for (let i = 0; i < p.length; i += 3) {
        const x = mt[0] * p[i] + mt[4] * p[i + 1] + mt[8] * p[i + 2] + mt[12];
        const y = mt[1] * p[i] + mt[5] * p[i + 1] + mt[9] * p[i + 2] + mt[13];
        const z = mt[2] * p[i] + mt[6] * p[i + 1] + mt[10] * p[i + 2] + mt[14];
        if (Math.abs(x) < 2.5 && y < 2.4 - 1e-4 && z > -8.9 && z < -5.2) { coreWood++; break; }
      }
    }
    check('S2: passage core (|x|<2.5) free of wood below the floor (columns carry the stage)',
      coreWood === 0, `${coreWood} meshes`);
  }
  const groundNodes = glb.gltf.nodes.map((n) => n.name ?? '').filter((n) => /^temple-ground__/.test(n));
  check('S2: NO temple-ground__ nodes (floor is not walkable ground)', groundNodes.length === 0,
    groundNodes.join(','));
  check('S2: no collider carries the floor (spec: 柱4+栏板1+台面底0)',
    !collision.colliders.some((c) => /floor/.test(c.name)));
  check('S2: floorNoCollider recorded', collision.floorNoCollider === true);
}

// S3 collision set: 4 columns + 1 rail + 2 flank walls (adoption batch:
  // the visible timber side boards y2.40-3.21 must be collidable); passage clear
{
  const cols = collision.colliders.filter((c) => c.name === 'stage-column');
  const rails = collision.colliders.filter((c) => c.name === 'stage-front-rail');
  const flanks = collision.colliders.filter((c) => c.name === 'stage-flank-wall');
  check('S3: exactly 4 columns + 1 rail + 2 flank walls',
    cols.length === 4 && rails.length === 1 && flanks.length === 2,
    `${cols.length}+${rails.length}+${flanks.length}`);
  const xs = cols.map((c) => c.obb.center[0]).sort((a, b) => a - b);
  check('S3: columns at x ±3.0', Math.abs(xs[0] + 3) < 1e-6 && Math.abs(xs[1] + 3) < 1e-6
    && Math.abs(xs[2] - 3) < 1e-6 && Math.abs(xs[3] - 3) < 1e-6, xs.join(','));
  const zs = [...new Set(cols.map((c) => c.obb.center[2]))].sort((a, b) => a - b);
  check('S3: column rows at z -5.6 / -8.6 (yimen-local)',
    zs.length === 2 && Math.abs(zs[0] + 8.6) < 1e-6 && Math.abs(zs[1] + 5.6) < 1e-6, zs.join(','));
  const rail = rails[0];
  check('S3: rail y 2.6..3.15 (camera guard)',
    Math.abs(rail.min[1] - 2.6) < 1e-6 && Math.abs(rail.max[1] - 3.15) < 1e-6);
  check('S3: center passage clear ±2.87 (2*(3.0-0.13) = spec 柱内侧)',
    collision.centerPassageClearX.join(',') === '-2.87,2.87');
  check('S3: flank walls cover the timber side boards (x ±3.015, y 2.40..3.21)',
    flanks.every((f) => Math.abs(Math.abs(f.center[0]) - 3.015) < 1e-6
      && Math.abs(f.center[1] - 2.805) < 1e-6 && Math.abs(f.size[0] - 0.37) < 1e-6),
    JSON.stringify(flanks.map((f) => f.center)));
  check('S3: all stage records authored at yimen origin (pos 0,0,0 — translation happens at world assembly)',
    collision.colliders.every((c) => (c.obb?.pos ?? [0, 0, 0]).every((v) => v === 0)));
}

// S4 the seam trim is recorded by the builder (the join loses part names);
// zero novel textures — shared frozen palette only
{
  check('S4: builder recorded the seam band over the yimen rear slope',
    /seam/i.test(measure.design.roofMethod));
  const dadianMaterials = JSON.parse(await readFile(resolve(root, 'kit/out/dadian/materials.json'), 'utf8'));
  const shared = new Set(Object.values(dadianMaterials).flatMap((m) => Object.values(m.textures ?? {})));
  const mine = Object.values(JSON.parse(await readFile(resolve(KIT, 'materials.json'), 'utf8')))
    .flatMap((m) => Object.values(m.textures ?? {}));
  check('S4: zero novel textures (shared palette only)', mine.every((t) => shared.has(t)));
}

console.log(failures === 0 ? '\nSTAGE_CONTRACT PASS' : `\nSTAGE_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
