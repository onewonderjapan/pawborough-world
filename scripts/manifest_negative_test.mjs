// R2 negative case: build a THROWAWAY sandbox copy of the workspace world data
// with one corrupted manifest hash and prove the strict verifier rejects it.
// The real workspace and dist are never modified; the sandbox stays as evidence.
//
// Run: node scripts/manifest_negative_test.cjs
import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = resolve(root, '../artifacts/r2/negative-test/sandbox');
const evidence = resolve(root, '../artifacts/r2/negative-test/result.json');

await rm(sandbox, {recursive: true, force: true});
await mkdir(sandbox, {recursive: true});
const manifest = JSON.parse(await readFile(resolve(root, 'world/review-manifest.json'), 'utf8'));
// sandbox references only dist/, so copy the built dist tree (has every referenced file)
await cp(resolve(root, 'dist'), join(sandbox, 'dist'), {recursive: true});

// corrupt one byte of one module sha256
const victim = manifest.modules.find(m => m.id === 'corner') ?? manifest.modules[0];
const corrupted = structuredClone(manifest);
const bad = victim.sha256.slice(0, -1) + (victim.sha256.endsWith('0') ? '1' : '0');
corrupted.modules.find(m => m.id === victim.id).sha256 = bad;
await mkdir(join(sandbox, 'world'), {recursive: true});
await writeFile(join(sandbox, 'world/review-manifest.json'), JSON.stringify(corrupted, null, 2) + '\n', 'utf8');

const run = spawnSync(process.execPath, [resolve(root, 'scripts/validate_manifest.cjs'), '--root', sandbox, '--expect-fail'], {encoding: 'utf8'});
const out = ((run.stdout || '') + '\n' + (run.stderr || '')).trim().split('\n').slice(-8);
const result = {
  what: 'negative control: manifest sha256 corruption must be rejected with non-zero exit',
  sandbox,
  corruptedModule: victim.id,
  expectedSha256: victim.sha256,
  corruptedSha256: bad,
  exitCode: run.status,
  output: out,
  rejected: run.status === 0,
  note: 'sandbox is disposable; final workspace and dist were not touched',
};
await writeFile(evidence, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log('NEGATIVE_TEST', JSON.stringify({rejected: result.rejected, exitCode: run.status, module: victim.id}));
process.exit(result.rejected ? 0 : 1);
