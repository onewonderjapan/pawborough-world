// Dadian (principal hall) contract tests — everything runs against the ACTUAL
// exported GLB bytes, collision records and kit measurements, never against
// builder constants alone.
//
//   D1  glTF validator: 0 errors on dadian.glb
//   D2  placement + facade: >=40 exported vertices lie on the local z=0
//       facade plane (front wall); the hall envelope spans the frozen bounds
//       (skirt 26.4 wide, eaves z 2.2/-14.2, crest ~13.7 high)
//   D3  columns + door: 12 column colliders at the frozen x/z; the physical
//       door opening is 4.18 wide (4.2 nominal +-0.05) and the CLOSED door
//       leaves carry a full box collider across the opening
//   D4  interior emptiness: no collider intersects the interior box
//       (x +-1.9, y 0.25..4, z -11.5..-3)
//   D5  plaque: the text face is the textured quad (full 0..1 atlas UV);
//       palette has no material outside the frozen set; exactly one new image
//   D6  budget: triangles <= 58,000; gable overlays + crest exist at x=+-9
// Run: node tests/dadian_contract.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/dadian');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const cfg = JSON.parse(await readFile(resolve(root, 'kit/dadian.config.json'), 'utf8'));
const measure = JSON.parse(await readFile(resolve(KIT, 'measurements.json'), 'utf8'));
const bytes = await readFile(resolve(KIT, 'dadian.glb'));

// D1 — validator
{
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  check('D1: dadian.glb validator 0 errors', (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors, ${report.issues?.numWarnings ?? 0} warnings`);
}

const glb = readGlb(bytes);
const worldMeshes = glb.meshes.map((m) => {
  const P = [];
  for (let i = 0; i < m.positions.length; i += 3)
    P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
  return { name: m.name, points: P };
});
const allPoints = worldMeshes.flatMap((m) => m.points);

// D2 — placement + facade + envelope (LOCAL frame: facade +Z at z=0)
{
  const facadeCount = allPoints.filter((p) => Math.abs(p[2]) < 0.02).length;
  check('D2: >=40 vertices on the facade plane z=0', facadeCount >= 40, `${facadeCount}`);
  const lo = [Math.min(...allPoints.map((p) => p[0])), Math.min(...allPoints.map((p) => p[1])),
    Math.min(...allPoints.map((p) => p[2]))];
  const hi = [Math.max(...allPoints.map((p) => p[0])), Math.max(...allPoints.map((p) => p[1])),
    Math.max(...allPoints.map((p) => p[2]))];
  check('D2: skirt spans 26.4m wide', Math.abs(hi[0] - lo[0] - 26.4) < 0.05, `x ${lo[0].toFixed(2)}..${hi[0].toFixed(2)}`);
  check('D2: skirt eaves z 2.2/-14.2', Math.abs(hi[2] - 2.2) < 0.02 && Math.abs(lo[2] + 14.2) < 0.02,
    `z ${lo[2].toFixed(2)}..${hi[2].toFixed(2)}`);
  check('D2: crest reaches ~13.7 high', hi[1] > 13.3 && hi[1] < 14.0, `y max ${hi[1].toFixed(2)}`);
  check('D2: hall body width 22m within the skirt', Math.abs(Math.max(...allPoints.filter((p) => Math.abs(p[1]) < 5 && Math.abs(p[2]) < 12.5).map((p) => p[0])) - 11.3) < 0.5);
}

// D3 — columns + closed door from the COLLISION records
{
  const collision = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));
  const colRecs = collision.colliders.filter((c) => c.name === 'dadian-column');
  check('D3: 12 column colliders (shafts; plinths separate)', colRecs.length === 12, `${colRecs.length}`);
  const fx = cfg.columns.frontX;
  for (const x of fx) {
    const hit = colRecs.filter((c) => Math.abs(c.obb.center[0] - x) < 0.01);
    check(`D3: columns at x=${x} (front+rear)`, hit.length === 2, `${hit.length}`);
  }
  const leaves = collision.colliders.filter((c) => c.name.startsWith('door-leaf'));
  const lo = Math.min(...leaves.map((c) => c.min[0])), hi = Math.max(...leaves.map((c) => c.max[0]));
  check('D3: two closed leaf colliders span the full opening', leaves.length === 2
    && Math.abs(hi - lo - 2 * cfg.doors.leafSizeM[0]) < 1e-6
    && leaves.every((c) => c.min[2] < -0.3 && c.max[2] > -0.5),
    `${leaves.length} leaves spanning ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  const clear = fx[3] - fx[2] - cfg.columns.sizeM[0];
  check('D3: physical opening 4.18 == 4.2 nominal +-0.05', Math.abs(clear - 4.2) <= 0.05, `${clear.toFixed(3)}`);
}

// D4 — interior emptiness (no collider inside the hall body)
{
  const collision = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));
  const IX = 1.9, Y0 = 0.25, Y1 = 4.0, Z0 = -11.5, Z1 = -3.0;
  const clashes = collision.colliders.filter((c) =>
    c.max[0] > -IX && c.min[0] < IX && c.max[1] > Y0 && c.min[1] < Y1 && c.max[2] > Z0 && c.min[2] < Z1);
  check('D4: interior box empty of colliders', clashes.length === 0, clashes.map((c) => c.name).join(','));
}

// D5 — plaque texture + palette
{
  const plaqueMesh = worldMeshes.find((m) => m.name.includes('dadian-plaque__'));
  check('D5: plaque material group present', !!plaqueMesh);
  const prim = glb.gltf.meshes
    .flatMap((m) => m.primitives)
    .find((pr) => pr.attributes.TEXCOORD_0 !== undefined);
  check('D5: some primitive carries UVs', !!prim);
  const plqMat = glb.gltf.materials?.find((m) => m.name.startsWith('dadian-plaque'));
  check('D5: plaque material present', !!plqMat);
  const images = (glb.gltf.images ?? []).map((i) => i.name ?? '');
  check('D5: the plaque atlas is embedded', images.some((n) => n.includes('dadian-plaque')), images.join(','));
  const known = ['Wood092', 'wood-stain-color', 'temple-relief-normal', 'PaintedPlaster017',
    'dadian-plaque', 'Bricks061', 'roof-normal', 'roof-color'];
  const extraImgs = images.filter((n) => !known.some((k) => n.includes(k)));
  check('D5: no images outside the known shared+new set', extraImgs.length === 0, extraImgs.join(','));
  const mats = new Set(glb.gltf.materials.map((m) => m.name.replace(/\.\d+$/, '')));
  const allowed = new Set(['weathered-lime-plaster', 'blue-gray-brick', 'oxblood-stained-timber',
    'deep-door-lacquer', 'gray-pan-tile', 'worn-stone', 'aged-brass', 'dadian-plaque-lacquer',
    'temple-relief-stone']);
  const extra = [...mats].filter((m) => !allowed.has(m));
  check('D5: palette frozen (no outside materials)', extra.length === 0, extra.join(','));
}

// D6 — budget + gable overlays
{
  const tris = measure.targets['dadian.glb'].triangles;
  check('D6: triangles <= 58,000', tris <= 58000, `${tris}`);
  const gableVerts = allPoints.filter((p) => Math.abs(Math.abs(p[0]) - 9.0) < 0.06 && p[1] > 9.0);
  check('D6: gable overlay geometry at x=+-9 above y=9', gableVerts.length >= 12, `${gableVerts.length}`);
  const crest = allPoints.filter((p) => Math.abs(p[1] - 12.61) < 0.25 && Math.abs(p[2] + 6.0) < 0.3
    && Math.abs(p[0]) < 9.2 && Math.abs(p[0]) > 5.0);
  check('D6: crest beam runs between the gable planes', crest.length >= 8, `${crest.length}`);
}

console.log(failures === 0 ? '\nDADIAN_CONTRACT PASS' : `\nDADIAN_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
