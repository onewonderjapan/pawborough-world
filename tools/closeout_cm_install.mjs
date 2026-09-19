// N step 4 — install VALIDATED candidates from the isolated directory into
// world/** (allowedChanges dirs only), retire stale variants (bytes preserved
// under artifacts/world-closeout/retired-cm/, never deleted), and write the
// provenance registry that gates manifest selection.
//
// Policy applied here (from DESIGN_SPEC acceptance.compression):
//   - candidates that failed tolerance are NOT installed — those assets keep
//     their original bytes as the honest fallback, reason recorded
//   - an existing cm whose decode-equivalence failed gets REPLACED by the
//     validated rebuild; the old bytes are preserved first (retired copy)
//   - originals are re-hashed afterwards and must equal the M baseline
//
// Run: node tools/closeout_cm_install.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const ART = resolve(root, 'artifacts/world-closeout');

const validate = JSON.parse(await readFile(resolve(ART, 'n-validate.json'), 'utf8'));
const candidates = validate.results.filter((r) => r.section === 'newCandidate');
const existing = validate.results.filter((r) => r.section === 'existingShipped');

const failedCandidates = candidates.filter((r) => !r.pass);
// allowedChanges grant for NEW/REPLACED derived cm in THIS batch — anything
// stale outside these dirs is recorded as a finding for the owner, never touched
const ALLOWED_WRITE = (rel) => /^world\/(fangbang-temple-v4|temple-axis-v3)\//.test(rel) || /^world\/street-props\//.test(rel);
const staleShipped = existing.filter((r) => !r.pass && ALLOWED_WRITE(r.originalRel));
const findings = existing.filter((r) => !r.pass && !ALLOWED_WRITE(r.originalRel)).map((r) => ({
  originalRel: r.originalRel,
  detail: r.triangles ? `triangle drift ${(r.triangles.drift * 100).toFixed(4)}% / posErr ${r.bounds?.positionErrorM}m vs current original` : r.error,
  disposition: 'outside this batch\'s allowedChanges write scope (or frozen v1) — recorded, untouched; remediation = rebuild candidate + registry-gated manifest regen once authorized',
}));
// v1 dataset is frozen and consumed by no current page (manifest.modules is
// legacy bookkeeping — no page code reads it); its stale lions cm is recorded,
// not touched.

const staleRels = new Set(staleShipped.map((r) => r.originalRel));
const passed = candidates.filter((r) => r.pass && !staleRels.has(r.originalRel));
const installed = [], replaced = [], skipped = [], alreadyInstalled = [];

for (const r of passed) {
  const cmRel = r.originalRel.replace(/\.glb$/, '.cm.glb');
  const src = resolve(ART, 'cm-candidates', cmRel);
  const dst = resolve(root, cmRel);
  try {
    await access(dst, constants.F_OK);
    const dstBytes = await readFile(dst);
    if (sha256(dstBytes) === r.provenance.outputSha256) { alreadyInstalled.push({ cmRel }); continue; }
    skipped.push({ cmRel, reason: 'target exists with DIFFERENT bytes — refusing to overwrite silently (use the stale-replacement path instead)' });
    continue;
  } catch { /* not installed yet */ }
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
  const b = await readFile(dst);
  if (sha256(b) !== r.provenance.outputSha256) throw new Error(`installed bytes differ from validated candidate: ${cmRel}`);
  installed.push({ originalRel: r.originalRel, cmRel, bytes: b.byteLength, sha256: r.provenance.outputSha256 });
}

for (const r of staleShipped) {
  const cmRel = r.originalRel.replace(/\.glb$/, '.cm.glb');
  const src = resolve(ART, 'cm-candidates', cmRel);
  const dst = resolve(root, cmRel);
  const oldBytes = await readFile(dst);
  const retireRel = `retired-cm/${cmRel}`;
  await mkdir(dirname(resolve(ART, retireRel)), { recursive: true });
  await writeFile(resolve(ART, retireRel), oldBytes);
  await copyFile(src, dst);
  const newBytes = await readFile(dst);
  if (sha256(newBytes) !== r.provenance?.outputSha256) {
    // for stale replacements the validating record is the candidate's own
    // (re-validated in the final pass); cross-check against the candidate file
    const cand = await readFile(src);
    if (sha256(newBytes) !== sha256(cand)) throw new Error(`replacement bytes mismatch: ${cmRel}`);
  }
  replaced.push({
    originalRel: r.originalRel, cmRel,
    retired: { path: `artifacts/world-closeout/${retireRel}`, sha256: sha256(oldBytes), bytes: oldBytes.byteLength,
      why: 'decoded stale vs current original (source moved on in a later batch); kept, not selected' },
    now: { sha256: sha256(newBytes), bytes: newBytes.byteLength },
  });
}

// fallback reasons for the delivery manifests (bytes stay original)
const fallbacks = [
  ...failedCandidates.map((r) => ({
    originalRel: r.originalRel,
    reason: `cm candidate failed decode tolerance: triangle drift ${(r.triangles.drift * 100).toFixed(4)}% > 0.1% (degenerate triangles removed by meshopt); kept original per spec — geometry is never edited to force a pass`,
  })),
  ...existing.filter((r) => !r.pass && r.originalRel === 'world/fangbang-temple/temple-axis/lions.glb').map((r) => ({
    originalRel: r.originalRel,
    reason: `frozen v1 cm variant failed decode tolerance (triangle drift ${(r.triangles?.drift * 100).toFixed(4)}%); dataset is frozen and the v1 module list is not consumed by any current page — recorded, asset untouched`,
  })),
];

// provenance registry gating future manifest selection
const registry = {
  note: 'selection registry: a .cm.glb may only be selected by a manifest when its recorded sourceSha256 equals the CURRENT original sha256. verified:decode = browser-decode equivalence proven this batch; verified:exact = built from these exact source bytes this batch.',
  generatedAt: new Date().toISOString(),
  entries: {},
};
// existing rows first so a same-asset newCandidate row (exact source
// provenance, fresh output sha) wins the registry slot
for (const r of [...validate.results].sort((a, b) => (a.section === 'newCandidate' ? 1 : 0) - (b.section === 'newCandidate' ? 1 : 0))) {
  if (!r.provenance) continue;
  registry.entries[r.originalRel] = {
    sourceSha256: r.provenance.sourceSha256,
    outputSha256: r.provenance.outputSha256,
    verified: !!r.pass,
    verifiedBy: r.provenance.verifiedEquivalentByDecode ? 'decode' : 'exact',
    tool: r.provenance.tool ?? null, toolVersion: r.provenance.toolVersion ?? null, args: r.provenance.args ?? null,
    failDetail: r.pass ? null : `triDrift=${r.triangles?.drift} posErrM=${r.bounds?.positionErrorM}`,
  };
}
await writeFile(resolve(ART, 'cm-provenance.json'), JSON.stringify(registry, null, 2) + '\n');

// originals must be untouched vs the M baseline
const baseline = JSON.parse(await readFile(resolve(ART, 'baseline.json'), 'utf8'));
const origEntries = baseline.files.filter((f) => f.class === 'originalGlb');
let origChecked = 0, origChanged = [];
for (const e of origEntries) {
  try { const b = await readFile(resolve(root, e.path)); origChecked++; if (sha256(b) !== e.sha256) origChanged.push(e.path); }
  catch { origChanged.push(e.path + ' (missing)'); }
}

const seenFb = new Set();
const fallbacksDedup = fallbacks.filter((f) => (seenFb.has(f.originalRel) ? false : (seenFb.add(f.originalRel), true)));
fallbacks.length = 0; fallbacks.push(...fallbacksDedup);
const report = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'N step 4 install + provenance registry',
  generatedAt: new Date().toISOString(),
  installed, alreadyInstalled, replaced, skipped, fallbacks, findings,
  registry: 'artifacts/world-closeout/cm-provenance.json',
  originals: { checked: origChecked, changed: origChanged, unchanged: origChanged.length === 0 },
};
await writeFile(resolve(ART, 'n-install.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`INSTALL installed=${installed.length} already=${alreadyInstalled.length} replaced=${replaced.length} skipped=${skipped.length} fallbacks=${fallbacks.length}`);
console.log(`ORIGINALS checked=${origChecked} changed=${origChanged.length}`);
for (const f of fallbacks) console.log(`  FALLBACK ${f.originalRel}`);
for (const f of findings) console.log(`  FINDING ${f.originalRel}`);
for (const c of origChanged) console.log(`  ORIG-CHANGED ${c}`);
