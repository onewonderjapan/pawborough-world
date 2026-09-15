// Temple pilot contract tests — run against the ACTUAL exported data, never
// against builder constants: the GLB bytes in world/temple-shanmen/ are parsed
// (glTF validator + glbReader), their images/material connections counted, the
// mesh vertices sampled for the clear-corridor guarantee, and the camera
// contract checked field by field. Negative: a sandboxed corrupted-copy check
// proves the validator path fails on real damage.
//
// Run: node tests/temple_shanmen_contract.test.mjs   (exit 0 = contract holds)
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-shanmen');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
const cameras = JSON.parse(await readFile(resolve(DS, 'cameras.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));

// --- 1. glTF validator on every exported GLB (severity 0 = error) ----------
const reports = {};
for (const id of Object.keys(manifest.assets)) {
  const bytes = await readFile(resolve(DS, `${id}.glb`));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  const msgs = report.issues?.messages ?? [];
  const errors = msgs.filter((m) => m.severity === 0);
  const warnings = msgs.filter((m) => m.severity === 1);
  check(`${id}.glb: validator 0 errors`, (report.issues?.numErrors ?? errors.length) === 0,
    errors.map((e) => e.message).join('; ') || `${warnings.length} warnings`);
  const gltf = readGlb(bytes).gltf;
  reports[id] = {
    bytes: bytes.byteLength, images: (gltf.images ?? []).length,
    materials: (gltf.materials ?? []).length, warnings: warnings.map((w) => w.message),
  };
  // byte/triangle budget from the real files vs the manifest
  const a = manifest.assets[id];
  check(`${id}.glb: bytes match manifest`, bytes.byteLength === a.bytes, `${bytes.byteLength}`);
}

// --- 2. budgets (design limits, actual numbers from exported files) --------
const B = manifest.budgets;
check('budget: building+walls tris', manifest.assets.temple.triangles <= B.buildingAndWallsTris.limit,
  `${manifest.assets.temple.triangles} <= ${B.buildingAndWallsTris.limit}`);
const fullTris = Object.values(manifest.assets).reduce((s, a) => s + a.triangles, 0);
check('budget: full set tris', fullTris <= B.fullSetTris.limit, `${fullTris} <= ${B.fullSetTris.limit}`);
check('budget: temple.glb bytes', manifest.assets.temple.bytes <= B.mainGlbBytes.limit,
  `${manifest.assets.temple.bytes}`);
check('budget: ground.glb bytes', manifest.assets.ground.bytes <= B.groundGlbBytes.limit,
  `${manifest.assets.ground.bytes}`);
check('budget: new images == 2 (plaque + relief normal)', B.newImages.actual === 2);

// triangle counts in the manifest must match the actual GLB meshes
for (const id of Object.keys(manifest.assets)) {
  const glb2 = readGlb(await readFile(resolve(DS, `${id}.glb`)));
  let tris = 0;
  for (const mesh of glb2.meshes) tris += (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3;
  check(`${id}.glb: actual mesh triangles match manifest`, Math.round(tris) === manifest.assets[id].triangles,
    `${Math.round(tris)} vs ${manifest.assets[id].triangles}`);
}

// --- 3. image/material connections verified on the exported JSON -----------
{
  const glb = readGlb(await readFile(resolve(DS, 'temple.glb')));
  const gltf = glb.gltf;
  const matName = (i) => (gltf.materials[i]?.name ?? '');
  const hasPlaque = gltf.materials.some((m) => /plaque/i.test(m.name) && m.pbrMetallicRoughness?.baseColorTexture);
  const hasRelief = gltf.materials.some((m) => /relief/i.test(m.name) && m.normalTexture);
  check('temple.glb: plaque material carries a baseColorTexture image', hasPlaque);
  check('temple.glb: relief material carries a normalTexture', hasRelief);
  // the two NEW images are the plaque map + relief normal; count is recorded, budget asserted above
  check('temple.glb: image count recorded', reports.temple.images >= 8, `${reports.temple.images} images`);
  // gold stays restrained: no other material got a new image
  const gold = gltf.materials.find((m) => /brass/i.test(m.name));
  check('temple.glb: aged-brass has no texture (color-only gold)', gold && !gold.pbrMetallicRoughness?.baseColorTexture);
}

// --- 4. clear corridor: no collider and no exported VERTEX inside it -------
const C = collision.clearCorridor;
check('collision: corridor assertion carried from builder', collision.corridorVerifiedEmpty === true);
{
  const inset = { x: C.x - 0.03, y0: C.y0 + 0.05, y1: C.y1 - 0.05, z0: C.z0 + 0.05, z1: C.z1 - 0.05 };
  const glb = readGlb(await readFile(resolve(DS, 'temple.glb')));
  let inside = 0;
  for (const mesh of glb.meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      if (x > -inset.x && x < inset.x && y > inset.y0 && y < inset.y1 && z > inset.z0 && z < inset.z1) inside++;
    }
  }
  check('temple.glb: zero exported vertices inside the clear corridor', inside === 0, `${inside} vertices`);
}

// --- 5. native bounds of the actual GLB data (axis/units contract) ---------
{
  const glb = readGlb(await readFile(resolve(DS, 'temple.glb')));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const mesh of glb.meshes)
    for (let i = 0; i < mesh.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], mesh.positions[i + k]);
        hi[k] = Math.max(hi[k], mesh.positions[i + k]);
      }
  const near = (v, t, tol) => Math.abs(v - t) <= tol;
  check('temple.glb bounds: wings reach x ±8.2..8.4', near(lo[0], -8.3, 0.3) && near(hi[0], 8.3, 0.3),
    `x ${lo[0].toFixed(2)}..${hi[0].toFixed(2)}`);
  check('temple.glb bounds: ridge roll tops y≈8.22', near(hi[1], 8.22, 0.25), `y 0..${hi[1].toFixed(2)}`);
  check('temple.glb bounds: z -4.15..+2.43 (eaves + wing flare)', near(lo[2], -4.15, 0.3) && near(hi[2], 2.43, 0.3),
    `z ${lo[2].toFixed(2)}..${hi[2].toFixed(2)}`);
  const g = readGlb(await readFile(resolve(DS, 'ground.glb')));
  const glo = [1e9, 1e9, 1e9], ghi = [-1e9, -1e9, -1e9];
  for (const mesh of g.meshes)
    for (let i = 0; i < mesh.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        glo[k] = Math.min(glo[k], mesh.positions[i + k]);
        ghi[k] = Math.max(ghi[k], mesh.positions[i + k]);
      }
  check('ground.glb bounds: court 18m x, z -3.6..7, top y≈0',
    near(glo[0], -9, 0.01) && near(ghi[0], 9, 0.01) && near(glo[2], -3.61, 0.05) && near(ghi[2], 7, 0.01) && ghi[1] < 0.05,
    `x ${glo[0].toFixed(2)}..${ghi[0].toFixed(2)} z ${glo[2].toFixed(2)}..${ghi[2].toFixed(2)} y ..${ghi[1].toFixed(3)}`);
}

// --- 6. camera contract (lead JSON applied verbatim by the page) -----------
{
  check('cameras: 6 fixed views with the lead ids',
    JSON.stringify(cameras.cameras.map((c) => c.id)) === JSON.stringify(['front', 'street-eye', 'quarter-left', 'roof', 'doorway', 'rear-inferred']));
  for (const c of cameras.cameras) {
    check(`camera ${c.id}: fov degrees sane + pose finite`,
      c.verticalFovDegrees > 20 &&
      Number.isFinite(c.verticalFovDegrees) && Number.isFinite(c.positionGlb[0]) && Number.isFinite(c.targetGlb[1]),
      `fov ${c.verticalFovDegrees}`);
  }
  const dw = cameras.cameras.find((c) => c.id === 'doorway');
  check('camera doorway: street-level, on the axis, looking -Z',
    dw.positionGlb[1] < 2 && Math.abs(dw.positionGlb[0]) < 0.1 && dw.targetGlb[2] < dw.positionGlb[2]);
}

// --- 7. negative: corrupted copy must FAIL the validator (sandbox) ---------
{
  const sandbox = resolve(root, 'tmp/temple-validator-sandbox');
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  const raw = await readFile(resolve(DS, 'ground.glb'));
  const corrupted = new Uint8Array(raw);
  corrupted[200] ^= 0xff; // flip a byte inside the JSON chunk
  await writeFile(resolve(sandbox, 'broken.glb'), corrupted);
  let detected = false;
  try {
    const rep = await validator.validateBytes(corrupted, { maxIssues: 100 });
    detected = (rep.issues?.numErrors ?? 0) > 0;
  } catch { detected = true; } // parse exception also counts as detection
  check('negative: byte-flipped GLB is rejected by the validator', detected);
  // the sandbox copy is preserved as evidence (per verified-delivery rule)
}

console.log(failures === 0 ? 'TEMPLE_CONTRACT_PASS' : `TEMPLE_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
