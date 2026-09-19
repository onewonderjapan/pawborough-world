// S1 — lanes-construction batch: install/apply the two authorized v3 cm
// corrections. Same policy as tools/closeout_cm_install.mjs, scoped by THIS
// batch's allowedChanges ("world/fangbang-temple-v3/review-manifest.cm.json
// and two defective cm references/variants ONLY for S1 correction"):
//   - westshops-strips: stale cm replaced by the decode-validated rebuild;
//     old bytes preserved under artifacts/lanes-construction/tails/retired-cm/
//   - lions: over-tolerance cm reverted to the original GLB (N fallback
//     policy "keep original, record reason"); defective cm bytes preserved
//     under retired-cm/, no deletion anywhere
//   - registry entries for exactly these two sources updated; originals
//     re-hashed and must be unchanged
//
// Run: node tools/lanes_s1_cm_install.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const TAILS = resolve(root, 'artifacts/lanes-construction/tails');
const RETIRED = resolve(TAILS, 'retired-cm');

const validate = JSON.parse(await readFile(resolve(TAILS, 's1-cm-validate.json'), 'utf8'));
const strips = validate.results.find((r) => r.section === 'staleCmRebuildCandidate');
const lions = validate.results.find((r) => r.section === 'lionsRevertReconfirm');
if (!strips?.pass) { console.error('westshops-strips candidate not validated PASS — refusing install'); process.exit(1); }

const retired = [];
const retire = async (rel, note) => {
  const src = resolve(root, rel);
  const dst = resolve(RETIRED, rel);
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
  const b = await readFile(src);
  retired.push({ rel, sha256: sha256(b), bytes: b.byteLength, note });
};

// 1. westshops-strips: retire stale cm, install validated candidate in place
const stripsRel = 'world/fangbang-temple-v3/westshops-strips.cm.glb';
const stripsCandRel = 'artifacts/lanes-construction/tails/cm-candidates/world/fangbang-temple-v3/westshops-strips.cm.glb';
await retire(stripsRel, 'stale variant (built from superseded source, triDrift 0.4 / posErr 59.42m); bytes preserved, never deleted');
const candBytes = await readFile(resolve(root, stripsCandRel));
if (sha256(candBytes) !== strips.provenance.cmSha256) { console.error('candidate bytes changed since validation'); process.exit(1); }
await copyFile(resolve(root, stripsCandRel), resolve(root, stripsRel));

// 2. lions: revert to original — move the over-tolerance cm out of the
//    manifest path (bytes preserved under retired-cm/, file not deleted)
const lionsCmRel = 'world/fangbang-temple-v3/temple-axis/lions.cm.glb';
await retire(lionsCmRel, 'over-tolerance variant (triDrift 0.5624% > 0.1%); manifest reverted to original GLB, bytes preserved');
await rename(resolve(root, lionsCmRel), resolve(RETIRED, lionsCmRel));

// 3. manifest update — recompute entries from on-disk bytes
const manifestRel = 'world/fangbang-temple-v3/review-manifest.cm.json';
const manifestPath = resolve(root, manifestRel);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entryFor = (id) => manifest.modules.find((m) => m.id === id);

const stripsOrig = await readFile(resolve(root, 'world/fangbang-temple-v3/westshops-strips.glb'));
const newStripsEntry = entryFor('westshops-strips');
newStripsEntry.path = '././world/fangbang-temple-v3/westshops-strips.cm.glb';
newStripsEntry.bytes = candBytes.byteLength;
newStripsEntry.sha256 = sha256(candBytes);
newStripsEntry.triangles = strips.triangles.cm;

const lionsOrig = await readFile(resolve(root, 'world/fangbang-temple-v3/temple-axis/lions.glb'));
const newLionsEntry = entryFor('temple-axis-shanmen-lions');
newLionsEntry.path = '././world/fangbang-temple-v3/temple-axis/lions.glb';
newLionsEntry.bytes = lionsOrig.byteLength;
newLionsEntry.sha256 = sha256(lionsOrig);
newLionsEntry.triangles = lions.triangles.original;

// templeAxis.assets carries the same lions record — keep both true
const lionsAsset = manifest.templeAxis.assets.find((a) => a.id === 'shanmen-lions');
lionsAsset.glb = '././world/fangbang-temple-v3/temple-axis/lions.glb';
lionsAsset.bytes = lionsOrig.byteLength;
lionsAsset.sha256 = sha256(lionsOrig);
lionsAsset.triangles = lions.triangles.original;

manifest.compressedVariant = {
  ...(manifest.compressedVariant ?? {}),
  s1Correction: {
    batch: 'pawborough-lanes-construction-night-20260920',
    date: new Date().toISOString().slice(0, 10),
    westshopsStrips: 'stale cm replaced by decode-validated rebuild of the CURRENT original (registry-gated); old variant retired with bytes preserved',
    lions: 'over-tolerance cm (triDrift 0.5624%) reverted to the original GLB per keep-original fallback; defective variant retired with bytes preserved',
    validation: 'artifacts/lanes-construction/tails/s1-cm-validate.json (production loader, browser decode)',
  },
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// 4. registry update — exactly these two sources
const regRel = 'artifacts/world-closeout/cm-provenance.json';
const regPath = resolve(root, regRel);
const reg = JSON.parse(await readFile(regPath, 'utf8'));
reg.entries['world/fangbang-temple-v3/westshops-strips.glb'] = {
  sourceSha256: sha256(stripsOrig),
  outputSha256: sha256(candBytes),
  verified: true,
  verifiedBy: 'decode',
  tool: 'gltfpack (N4 toolchain)',
  toolVersion: null,
  args: ['-cc', '-kn', '-i', 'world/fangbang-temple-v3/westshops-strips.glb', '-o', 'artifacts/lanes-construction/tails/cm-candidates/world/fangbang-temple-v3/westshops-strips.cm.glb'],
  failDetail: null,
  s1Correction: 'rebuilt + decode-validated in lanes-construction-20260920 (prior variant failed triDrift=0.4 posErrM=59.424499, retired)',
};
const lionsEntry = reg.entries['world/fangbang-temple-v3/temple-axis/lions.glb'];
lionsEntry.verified = false;
lionsEntry.failDetail = 'triDrift=0.005624 posErrM=0.000138 (reconfirmed 2026-09-20) — REVERTED: manifest points to the original GLB; over-tolerance cm retired (bytes preserved), no replacement possible within meshopt quantization';
lionsEntry.s1Correction = 'lanes-construction-20260920: keep-original fallback applied, defective cm removed from manifest path';
await writeFile(regPath, JSON.stringify(reg, null, 2) + '\n');

// 5. originals must be byte-identical to the closeout baseline
const baseline = JSON.parse(await readFile(resolve(root, 'artifacts/world-closeout/baseline.json'), 'utf8'));
const baseSha = new Map(baseline.files.map((f) => [f.path, f.sha256]));
let checked = 0, bad = [];
for (const rel of ['world/fangbang-temple-v3/westshops-strips.glb', 'world/fangbang-temple-v3/temple-axis/lions.glb']) {
  const got = sha256(await readFile(resolve(root, rel)));
  if (got !== baseSha.get(rel)) bad.push(`${rel}: drifted from closeout baseline`);
  else checked++;
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }

const report = {
  batch: 'pawborough-lanes-construction-night-20260920',
  stage: 'S1 install/apply of two authorized v3 cm corrections',
  generatedAt: new Date().toISOString(),
  installed: [{ rel: stripsRel, sha256: sha256(candBytes), bytes: candBytes.byteLength, validation: 'decode PASS (triDrift 0 posErr 0.00097m)' }],
  reverted: [{ rel: 'world/fangbang-temple-v3/temple-axis/lions.glb', reason: 'cm over tolerance (triDrift 0.5624%), keep-original fallback' }],
  retired,
  manifestsUpdated: [manifestRel],
  registryUpdated: [regRel],
  originalsVerifiedUnchanged: checked,
  note: 'v3 review-manifest.cm.json triangles/asset records updated to true on-disk values; no file deleted — retired bytes under artifacts/lanes-construction/tails/retired-cm/',
};
await writeFile(resolve(TAILS, 's1-install.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`installed ${stripsRel} (validated); lions reverted to original; ${retired.length} variants retired; originals ${checked} byte-checked OK`);
