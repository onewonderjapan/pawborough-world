// N step 2 — build compression CANDIDATES in an ISOLATED output directory.
// Nothing under world/ or building/ is written here: every candidate lands in
// artifacts/world-closeout/cm-candidates/<same-relative-path>.cm.glb and is
// installed only after step-3 validation passes (see closeout_cm_validate.mjs).
// Codec/params mirror the shipped pipeline (tools/build_compressed_dist.mjs):
// gltfpack -cc -kn; GLBs carrying walkable-ground node names get -vpf -vt 14
// so meshes stay attached to their named nodes (ground extraction contract).
//
// Run: node tools/closeout_cm_build.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const GLTFPACK = process.env.GLTFPACK
  ?? '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack';

const closure = JSON.parse(await readFile(resolve(root, 'artifacts/world-closeout/n-closure.json'), 'utf8'));
const targets = closure.items.filter((i) => i.state === 'missingCm' && i.newCmAllowedInThisBatch)
  .map((i) => ({ originalRel: i.originalRel, cmRel: i.cmRel, reason: 'missingCm' }));
// stale-replacement targets: shipped cm siblings whose decode comparison
// against the CURRENT original failed (source moved on; old variant must be
// retired — preserved copy is made at install time, never deleted)
try {
  const prev = JSON.parse(await readFile(resolve(root, 'artifacts/world-closeout/n-validate.json'), 'utf8'));
  for (const r of prev.results.filter((x) => x.section === 'existingShipped' && x.pass === false)) {
    if (!targets.some((t) => t.originalRel === r.originalRel)) {
      targets.push({ originalRel: r.originalRel, cmRel: r.originalRel.replace(/\.glb$/, '.cm.glb'), reason: 'staleCm (decode mismatch vs current original)' });
    }
  }
} catch { /* no prior validation yet */ }
if (targets.length === 0) { console.log('nothing to build'); process.exit(0); }

const GROUND_PREFIX_RE = /^(street-kit__|sctail__|laneb__|temple-ground__)/;
async function glbHasGroundNames(path) {
  const buf = await readFile(path);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return (gltf.nodes ?? []).some((n) => n.name && GROUND_PREFIX_RE.test(n.name));
}

let toolVersion = '';
try { toolVersion = execFileSync(GLTFPACK, ['-h'], { encoding: 'utf8' }).split('\n')[0].trim(); } catch {}

const rows = [];
for (const t of targets) {
  const srcAbs = resolve(root, t.originalRel);
  const outAbs = resolve(root, 'artifacts/world-closeout/cm-candidates', t.cmRel);
  await mkdir(dirname(outAbs), { recursive: true });
  const ground = await glbHasGroundNames(srcAbs);
  const modeArgs = ground ? ['-vpf', '-vt', '14'] : [];
  const args = ['-cc', '-kn', ...modeArgs, '-i', srcAbs, '-o', outAbs];
  try {
    execFileSync(GLTFPACK, args, { stdio: 'pipe' });
    const ob = await readFile(outAbs);
    if (!ob.subarray(0, 4).equals(Buffer.from('glTF'))) throw new Error('output lacks glTF magic');
    const sb = await readFile(srcAbs);
    rows.push({
      originalRel: t.originalRel, candidateRel: `artifacts/world-closeout/cm-candidates/${t.cmRel}`,
      groundMode: ground, args,
      sourceSha256: sha256(sb), sourceBytes: sb.byteLength,
      outputSha256: sha256(ob), outputBytes: ob.byteLength,
      ratio: +(ob.byteLength / sb.byteLength).toFixed(3),
      tool: GLTFPACK, toolVersion,
      builtAt: new Date().toISOString(),
    });
    console.log(`ok ${t.originalRel} ${(sb.byteLength / 1e6).toFixed(1)}MB -> ${(ob.byteLength / 1e6).toFixed(1)}MB (x${(ob.byteLength / sb.byteLength).toFixed(2)})${ground ? ' [ground mode]' : ''}`);
  } catch (e) {
    rows.push({ originalRel: t.originalRel, error: String(e.message).slice(0, 300), args });
    console.log(`FAIL ${t.originalRel}: ${String(e.message).slice(0, 160)}`);
  }
}

const report = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'N step 2 candidates (isolated dir, world/ untouched)',
  generatedAt: new Date().toISOString(),
  gltfpack: GLTFPACK, toolVersion,
  codec: 'gltfpack -cc -kn (meshopt + KHR_mesh_quantization); ground-name files: -vpf -vt 14',
  built: rows.filter((r) => !r.error).length,
  failed: rows.filter((r) => r.error).length,
  rows,
};
await writeFile(resolve(root, 'artifacts/world-closeout/n-candidates.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`CANDIDATES built=${report.built} failed=${report.failed}`);
process.exit(report.failed > 0 ? 1 : 0);
