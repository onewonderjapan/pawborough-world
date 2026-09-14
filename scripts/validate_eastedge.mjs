// Validate the east-edge asset GLBs: gltf-validator must report ZERO errors
// (warnings are recorded item by item), and the evidence records the honest
// combined download bytes plus unique-image count by content sha across both
// standalone assets — no runtime texture sharing is claimed between separate
// GLBs (each embeds its own copies).
//
// Run: node scripts/validate_eastedge.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/east-edge/validation.json');
const ASSETS = ['east-shop-128', 'east-shop-129'];
const sha = (u8) => createHash('sha256').update(u8).digest('hex');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const reports = [];
const imageShas = new Map(); // content sha -> count across assets
let combinedBytes = 0;
let combinedTriangles = 0;

for (const id of ASSETS) {
  const bytes = await readFile(resolve(root, `world/east-edge/${id}/model.glb`));
  combinedBytes += bytes.byteLength;
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  const gltf = readGlb(bytes).gltf;
  const glb2 = readGlb(bytes);
  let tris = 0;
  for (const mesh of glb2.meshes) {
    tris += (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3;
  }
  combinedTriangles += tris;
  for (const im of gltf.images ?? []) {
    const bv = gltf.bufferViews[im.bufferView];
    const h = sha(glb2.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength));
    imageShas.set(h, (imageShas.get(h) ?? 0) + 1);
  }
  const msgs = report.issues?.messages ?? [];
  const errors = msgs.filter(m => m.severity === 0);
  const warnings = msgs.filter(m => m.severity === 1);
  check(`${id}: gltf-validator 0 errors`, (report.issues?.numErrors ?? errors.length) === 0,
    errors.map(e => e.message).join('; ') || `${warnings.length} warnings, ${report.issues?.numInfos ?? 0} infos`);
  for (const w of warnings) console.log(`     warn: ${w.message} (${w.pointer ?? ''})`);
  check(`${id}: byte budget ≤ 2.5MB`, bytes.byteLength <= 2_500_000, `${(bytes.byteLength / 1e6).toFixed(2)}MB`);
  reports.push({
    id, bytes: bytes.byteLength, sha256: sha(bytes), triangles: Math.round(tris),
    validator: {
      errors: report.issues?.numErrors ?? errors.length,
      warnings: warnings.map(w => `${w.message} (${w.pointer ?? ''})`),
      infos: report.issues?.numInfos ?? 0,
    },
    images: (gltf.images ?? []).length,
    materials: (gltf.materials ?? []).length,
    generator: gltf.asset?.generator ?? null,
  });
}

const uniqueImages = imageShas.size;
check('combined byte budget ≤ 5MB', combinedBytes <= 5_000_000, `${(combinedBytes / 1e6).toFixed(2)}MB`);
check('combined triangle budget ≤ 24k', combinedTriangles <= 24_000, `${combinedTriangles}`);

const evidence = {
  generatedBy: 'scripts/validate_eastedge.mjs',
  assets: reports,
  combinedDownloadBytes: combinedBytes,
  combinedTriangles: Math.round(combinedTriangles),
  uniqueImagesAcrossAssetsByContentSha: uniqueImages,
  imageCopiesPerAsset: ASSETS.length,
  note: 'each standalone GLB embeds its own image copies; runtime texture objects are per-asset (no auto-sharing claimed)',
};
await writeFile(OUT, JSON.stringify(evidence, null, 2) + '\n');
console.log(failures === 0 ? 'EASTEDGE_VALIDATION PASS' : `EASTEDGE_VALIDATION FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
