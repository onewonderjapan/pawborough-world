// East-extension contract (adoption batch package J, G5): the built east
// extension must join the street tail seamlessly, follow the OSM 238219464
// design centerline with the 4.0 -> 8.5m width ease, keep the carriageway
// capsule-free, carry the sctail__ ground contract, and end at the sample end
// wall (11.2 x 3.4 x 0.3, 非历史) with its collider composed into the v4 world.
//
// Run: node tests/east_extension_contract.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const spec = JSON.parse(await readFile(resolve(root, 'kit/out/east-extension-spec.json'), 'utf8'));
const surfaceSpec = JSON.parse(await readFile(resolve(root, 'kit/out/east-band/east-extension/surface-spec.json'), 'utf8'));
const v4collision = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/collision-world.json'), 'utf8'));

// E1 — spec geometry: junction, monotone east, clip, width ease
{
  const s0 = spec.samples[0];
  check('E1: centerline starts at the built street-tail end [124.6, 27.65]',
    Math.abs(s0.x - 124.6) < 0.01 && Math.abs(s0.z - 27.65) < 0.01, `${s0.x}, ${s0.z}`);
  check('E1: start width 4.0 (matches the tail walk band)', Math.abs(s0.widthM - 4.0) < 0.01);
  check('E1: monotone east', spec.checks.monotoneEastPass);
  const endX = spec.checks.endXM;
  check('E1: clipped at x=236 (covers shop-142 by 6m)', Math.abs(endX - 236) <= 0.01, `${endX}`);
  const s8 = spec.samples.find((q) => q.s >= 8);
  check('E1: width eases 4.0 -> 8.5 within 8m of arc', Math.abs(s8.widthM - 8.5) < 0.05,
    `s=${s8.s} width=${s8.widthM}`);
  const after = spec.samples.filter((q) => q.s >= 8.5);
  check('E1: width constant 8.5 after the ease', after.every((q) => Math.abs(q.widthM - 8.5) < 1e-6));
}

// E2 — junction: independently re-measure the tail end edge from the GLB and
// compare with the built surface's recorded junction block
{
  const j = surfaceSpec.design.junction;
  check('E2: measured edge midpoint on [124.6, 27.65] (<= 0.02)', j.centerOffsetPass, `${j.centerOffsetM}m`);
  check('E2: measured edge half-width 2.0 (<= 0.02)', j.widthPass, `${j.widthVsSpecM}m off`);
  check('E2: top step 0.00 (<= 0.02)', j.topStepPass, `${j.topStepM}m`);
  check('E2: recorded tail edge half-width is 2.0m', Math.abs(j.tailEdgeHalfWidthM - 2.0) < 0.02,
    `${j.tailEdgeHalfWidthM}`);
}

// E3 — the built surface GLB
{
  const bytes = await readFile(resolve(root, 'kit/out/east-band/east-extension/model.glb'));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check('E3: surface.glb validator 0 errors 0 warnings',
    (report.issues.numErrors ?? 0) === 0 && (report.issues.numWarnings ?? 0) === 0,
    `${report.issues.numErrors}e/${report.issues.numWarnings}w`);
  const glb = readGlb(bytes);
  check('E3: surface within the 8000-tri budget', glb.totalTriangles <= 8000, `${glb.totalTriangles}`);
  const names = glb.meshes.map((m) => m.name);
  check('E3: ground contract — asphalt + stone carry sctail__ names',
    names.includes('sctail__quiet-gray-asphalt') && names.includes('sctail__worn-stone'),
    names.join(','));
  // lamps every 25m, drains every 40m (from the spec records)
  const lamps = surfaceSpec.lamps.length, drains = surfaceSpec.drains.length;
  const frontage = surfaceSpec.design.frontageM;
  check('E3: lamps every 25m', lamps === Math.floor((frontage - 1) / 25), `${lamps} over ${frontage}m`);
  check('E3: drains every 40m', drains === Math.floor((frontage - 1) / 40), `${drains} over ${frontage}m`);
  // the shipped v4 copy matches the built bytes
  const v4copy = await readFile(resolve(root, 'world/fangbang-temple-v4/east-extension/surface.glb'));
  check('E3: dataset copy byte-identical to the built GLB', Buffer.compare(bytes, v4copy) === 0);
}

// E4 — end wall: geometry + collider + perpendicularity
{
  const bytes = await readFile(resolve(root, 'kit/out/east-band/east-extension/seal-wall.glb'));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check('E4: seal-wall.glb validator 0 errors', (report.issues.numErrors ?? 0) === 0,
    `${report.issues.numErrors}e`);
  const glb = readGlb(bytes);
  check('E4: wall present with 12 triangles', glb.totalTriangles === 12, `${glb.totalTriangles}`);
  const rec = v4collision.colliders.find((c) => c.name === 'eastext-seal-wall:seal-wall');
  check('E4: wall collider composed into the v4 world', !!rec);
  if (rec) {
    const size = rec.obb.size;
    check('E4: wall 11.2 x 3.4 x 0.3 (t, h, l local)',
      Math.abs(size[0] - 0.3) < 1e-6 && Math.abs(size[1] - 3.4) < 1e-6 && Math.abs(size[2] - 11.2) < 1e-6,
      JSON.stringify(size));
    // perpendicular: the wall's long axis (local z rotated by theta) is within
    // 2 degrees of the spec end cross-section direction
    const th = rec.obb.theta;
    const along = [Math.sin(th), Math.cos(th)];
    const end = spec.samples[spec.samples.length - 1];
    const cross = [end.southNx, end.southNz];
    const dot = along[0] * cross[0] + along[1] * cross[1];
    check('E4: wall perpendicular to the road tangent (<= 2 deg)', dot >= Math.cos(2 * Math.PI / 180),
      `dot=${dot.toFixed(4)}`);
    // the wall straddles the road end: its center within 0.5m of the clip point
    const endX = spec.checks.endXM;
    check('E4: wall center within 0.5m of the x=236 clip', Math.abs(rec.obb.pos[0] - endX) <= 0.5,
      `${rec.obb.pos[0]}`);
  }
  // corridor check recorded and passing
  check('E4: carriageway corridor >= 3.6m', surfaceSpec.design.corridor.minFreeM >= 3.6,
    `${surfaceSpec.design.corridor.minFreeM}m`);
}

console.log(failures === 0 ? '\nEAST_EXTENSION_CONTRACT PASS' : `\nEAST_EXTENSION_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
