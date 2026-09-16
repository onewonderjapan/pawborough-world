// R2 lane-B texture-slot regression — compares EVERY textured material slot
// of the source lane-b module against the merged laneb candidate by resolving
// slot -> texture -> image and hashing the actual embedded image BYTES. The
// R2 bug reused an image index as a texture index and pointed the merged
// paving at plaster; this test pins each slot to identical image bytes
// (paving color/roughness/normal included) and records the comparison as
// lead-review evidence.
//
// Run: node tests/laneb_texture_slots.test.mjs   (exit 0 = contract holds)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EV = resolve(root, '../artifacts/fix-lead-review');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const sha = (u8) => createHash('sha256').update(u8).digest('hex');

// slot -> texture -> image, and the real bytes of that image
function slotImage(json, bin, slotTex) {
  const tex = json.textures[slotTex.index];
  const im = json.images[tex.source];
  const bv = json.bufferViews[im.bufferView];
  return {
    textureIndex: slotTex.index,
    imageIndex: tex.source,
    imageName: im.name ?? null,
    imageSha256: sha(bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength)),
    sampler: tex.sampler ?? 0,
    texCoord: slotTex.texCoord ?? null,
    extensions: slotTex.extensions ?? null,
  };
}
const SLOTS = (m) => [
  ['baseColor', m.pbrMetallicRoughness?.baseColorTexture],
  ['metallicRoughness', m.pbrMetallicRoughness?.metallicRoughnessTexture],
  ['normal', m.normalTexture],
  ['occlusion', m.occlusionTexture],
  ['emissive', m.emissiveTexture],
];

const mod = readGlb(await readFile(resolve(root, 'kit/out/lane-b/model.glb')));
const merged = readGlb(await readFile(resolve(root, 'world/laneb/laneb.glb')));

const slots = [];
let mismatches = 0;
for (const mm of mod.gltf.materials) {
  const mergedMat = merged.gltf.materials.find(m => m.name === mm.name + '.laneb');
  if (!mergedMat) { mismatches++; console.log(`FAIL material ${mm.name}.laneb missing from merged world`); continue; }
  for (const [slotName, modTex] of SLOTS(mm)) {
    const mergedTex = SLOTS(mergedMat).find(([n]) => n === slotName)[1];
    if (!modTex && !mergedTex) continue;
    if (!modTex || !mergedTex) { mismatches++; console.log(`FAIL ${mm.name}/${slotName}: slot presence differs`); continue; }
    const expected = slotImage(mod.gltf, mod.bin, modTex);
    const actual = slotImage(merged.gltf, merged.bin, mergedTex);
    const paramsKept = JSON.stringify({ texCoord: expected.texCoord, extensions: expected.extensions })
      === JSON.stringify({ texCoord: actual.texCoord, extensions: actual.extensions });
    const match = expected.imageSha256 === actual.imageSha256 && paramsKept;
    if (!match) mismatches++;
    slots.push({ material: mm.name, slot: slotName, expected, actual, match });
    if (mm.name === 'paving-frontage') {
      check(`paving-frontage ${slotName} resolves to the source ${expected.imageName}`,
        match && actual.imageName === expected.imageName,
        `${actual.imageName} (texture ${actual.textureIndex}, image ${actual.imageIndex})`);
    }
  }
}
check('every module texture slot matches the merged world by image byte hash',
  mismatches === 0, `${slots.length} slots compared, ${mismatches} mismatched`);

// non-regression on sharing: the merge must REUSE the frozen images/textures,
// not duplicate bytes
check('merged world keeps exactly the 18 shared images (zero duplicates appended)',
  merged.gltf.images.length === 18, String(merged.gltf.images.length));
check('merged world keeps exactly the 161 texture entries (matched, not appended)',
  merged.gltf.textures.length === 161, String(merged.gltf.textures.length));

const modSha = sha(await readFile(resolve(root, 'kit/out/lane-b/model.glb')));
const mergedSha = sha(await readFile(resolve(root, 'world/laneb/laneb.glb')));
const report = {
  what: 'laneb merged-world texture-slot comparison by embedded image byte hash (R2 fix evidence)',
  sourceModule: { path: 'kit/out/lane-b/model.glb', sha256: modSha },
  mergedWorld: { path: 'world/laneb/laneb.glb', sha256: mergedSha },
  comparedSlots: slots.length,
  mismatchedSlots: mismatches,
  slots,
};
await mkdir(EV, { recursive: true });
await writeFile(resolve(EV, 'texture-slot-comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(failures === 0 ? 'LANEB_TEXTURE_SLOTS PASS' : `LANEB_TEXTURE_SLOTS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
