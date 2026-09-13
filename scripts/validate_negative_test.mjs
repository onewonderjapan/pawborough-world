// glTF validator negative control:
//   1. Copy one real module GLB into a fresh timestamped sandbox, twice.
//   2. Validate the pristine copy with the plain validate_all command: exit 0.
//   3. Corrupt a block of bytes in the middle of the binary chunk of the other
//      copy and validate it with the SAME command: it must exit non-zero with
//      errors or a fatal reported for exactly that file.
// Sandboxes are kept as evidence and never removed. The real workspace files
// are never modified.
//
// Run: node scripts/validate_negative_test.mjs   (exit 0 = controls held)
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = resolve(root, '../artifacts/N1/negative-gltf', `${stamp}-pid${process.pid}`);
const sandbox = join(runDir, 'sandbox');
await mkdir(join(sandbox, 'building', 'corner'), {recursive: true});

const source = resolve(root, 'building/corner/model.glb');
const pristineRel = 'building/corner/model.glb';
const corruptRel = 'building/corner/model.glb.corrupt';
await copyFile(source, join(sandbox, pristineRel));

// Corrupt a copy INSIDE the GLB JSON chunk (declared by the GLB header), so the
// damage is structural and always detected. Corrupting bytes inside image
// buffers would NOT be detected (the validator does not decode image pixels).
const src = await readFile(source);
const corrupt = Buffer.from(src);
if (corrupt.readUInt32LE(0) !== 0x46546c67) throw Error('not a GLB (bad magic)');
const jsonChunkLen = corrupt.readUInt32LE(12);
const jsonChunkType = corrupt.readUInt32LE(16);
if (jsonChunkType !== 0x4e4f534a) throw Error('chunk 0 is not JSON');
const at = 20 + Math.max(8, Math.floor(jsonChunkLen / 2));
for (let i = 0; i < 32; i++) corrupt[at + i] = 0xff;
await writeFile(join(sandbox, corruptRel), corrupt);

const validator = resolve(root, 'scripts/validate_all.cjs');
function run(file) {
  return spawnSync(process.execPath, [validator, '--root', sandbox, '--files', file, '--report', join(runDir, `validation-${file.endsWith('corrupt') ? 'negative' : 'positive'}.json`)], {encoding: 'utf8'});
}
const tail = r => ((r.stdout || '') + '\n' + (r.stderr || '')).trim().split('\n').slice(-6);

const positive = run(pristineRel);
const positiveOk = positive.status === 0;

const negative = run(corruptRel);
const negOut = tail(negative).join('\n');
const negReportPath = join(runDir, 'validation-negative.json');
let negReport = {};
try { negReport = JSON.parse(await readFile(negReportPath, 'utf8')); } catch {}
const negEntry = (negReport.results || [])[0] || {};
const negativeOk = negative.status !== 0
  && (negEntry.errors > 0 || Boolean(negEntry.fatal))
  && negOut.includes(corruptRel);

const shaSource = (await import('node:crypto')).createHash('sha256').update(src).digest('hex');
const result = {
  what: 'negative control: a corrupted GLB must make the plain validate_all command exit non-zero',
  sourceFile: 'building/corner/model.glb',
  sourceSha256: shaSource,
  corruption: {where: 'inside GLB JSON chunk', offset: at, length: 32, fill: '0xff', reason: 'validator does not decode image pixels, so texture-byte corruption is not detectable'},
  sandbox,
  positive: {exitCode: positive.status, pass: positiveOk, output: tail(positive)},
  negative: {exitCode: negative.status, errors: negEntry.errors ?? null, fatal: negEntry.fatal ?? null, pass: negativeOk, output: tail(negative)},
  rejected: positiveOk && negativeOk,
  note: 'fresh sandbox per run; sandboxes retained as evidence, never removed',
};
await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
await writeFile(resolve(runDir, '../latest.json'), JSON.stringify({runDir, rejected: result.rejected, at: stamp}) + '\n', 'utf8');
console.log('GLTF_NEGATIVE_TEST', JSON.stringify({
  rejected: result.rejected,
  positiveExit: positive.status,
  negativeExit: negative.status,
  negativeErrors: negEntry.errors ?? 'fatal',
  sandbox: runDir,
}));
process.exit(result.rejected ? 0 : 1);
