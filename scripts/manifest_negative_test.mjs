// R2 negative control, rewritten to the N1 spec:
//   1. Build a COMPLETE isolated sandbox copy of the deliverable (all 13 module
//      GLBs + street-kit.glb + street-reviewed.glb, mirrored under world/ and
//      dist/, plus the manifest) — hardlinked from the real files where the
//      filesystem allows, so sandboxes stay cheap and are never deleted.
//   2. Run the SAME plain validate_manifest command on the pristine sandbox:
//      it must exit 0 (proves the sandbox is complete — no missing files).
//   3. Corrupt ONLY the corner module sha256 in the sandbox manifest, run the
//      same plain command again: it must exit non-zero, the failure must name
//      the corner hash mismatch, and no "missing file" failure may appear.
// A fresh timestamped sandbox is created per run; old sandboxes are kept as
// evidence and never removed. The real workspace and dist are never modified.
//
// Run: node scripts/manifest_negative_test.mjs   (exit 0 = all controls held)
import {createHash} from 'node:crypto';
import {copyFile, link, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = resolve(root, '../artifacts/N1/negative-manifest', `${stamp}-pid${process.pid}`);
const sandbox = join(runDir, 'sandbox');
await mkdir(join(sandbox, 'world'), {recursive: true});
await mkdir(join(sandbox, 'dist'), {recursive: true});

// linkOrCopy: hardlink when possible (same fs, zero extra bytes), else copy.
async function linkOrCopy(src, dest) {
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

const manifest = JSON.parse(await readFile(resolve(root, 'world/review-manifest.json'), 'utf8'));
const relFiles = new Set(['world/street-kit.glb', 'world/street-reviewed.glb']);
for (const m of manifest.modules) relFiles.add(m.path.replace(/^\.\//, ''));
// Mirror under both workspace root and dist/ exactly like the real layout.
for (const rel of relFiles) {
  const src = resolve(root, rel);
  await mkdir(dirname2(join(sandbox, rel)), {recursive: true});
  await mkdir(dirname2(join(sandbox, 'dist', rel)), {recursive: true});
  await linkOrCopy(src, join(sandbox, rel));
  await linkOrCopy(src, join(sandbox, 'dist', rel));
}
function dirname2(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '.' : p.slice(0, i);
}
await writeFile(join(sandbox, 'world/review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const validator = resolve(root, 'scripts/validate_manifest.cjs');
function run() {
  return spawnSync(process.execPath, [validator, '--root', sandbox, '--report', join(runDir, 'manifest-validation.json')], {encoding: 'utf8'});
}
function tail(r) {
  return ((r.stdout || '') + '\n' + (r.stderr || '')).trim().split('\n').slice(-10);
}

// --- step 1: pristine sandbox must PASS with exit 0
const positive = run();
const positiveOk = positive.status === 0;

// --- step 2: corrupt only corner's sha256, same plain command must fail
const victim = manifest.modules.find(m => m.id === 'corner');
if (!victim) throw Error('corner module missing from manifest');
const corrupted = structuredClone(manifest);
const bad = victim.sha256.slice(0, -1) + (victim.sha256.endsWith('0') ? '1' : '0');
corrupted.modules.find(m => m.id === victim.id).sha256 = bad;
await writeFile(join(sandbox, 'world/review-manifest.json'), JSON.stringify(corrupted, null, 2) + '\n', 'utf8');
const negative = run();
const negOut = tail(negative).join('\n');
const negativeOk = negative.status !== 0
  && negOut.includes('corner')
  && negOut.includes(bad)
  && !negOut.includes('missing file');

const result = {
  what: 'negative control: manifest sha256 corruption in a complete sandbox must be rejected by the plain validator command',
  validatorCommand: `node scripts/validate_manifest.cjs --root <sandbox> --report <run>/manifest-validation.json`,
  sandbox,
  hardlinkedInputs: relFiles.size,
  corruptedModule: victim.id,
  expectedSha256: victim.sha256,
  corruptedSha256: bad,
  positive: {exitCode: positive.status, pass: positiveOk, output: tail(positive)},
  negative: {exitCode: negative.status, pass: negativeOk, output: tail(negative)},
  rejected: positiveOk && negativeOk,
  note: 'fresh sandbox per run; old sandboxes are retained evidence and never removed',
};
await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
await writeFile(resolve(runDir, '../latest.json'), JSON.stringify({runDir, rejected: result.rejected, at: stamp}) + '\n', 'utf8');
console.log('NEGATIVE_TEST', JSON.stringify({
  rejected: result.rejected,
  positiveExit: positive.status,
  negativeExit: negative.status,
  module: victim.id,
  sandbox: runDir,
}));
process.exit(result.rejected ? 0 : 1);
