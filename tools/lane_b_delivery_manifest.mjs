// Delivery manifest generator/verifier for the lane-b-polish batch
// (evidence-repair B7-R2, 2026-09-20).
//
// The previous delivery-manifest.json included ITS OWN old hash as an entry
// (59/60 verified, the self-entry could never match after rewriting). Rules
// enforced here:
//   - the manifest EXCLUDES itself and the outer receipt (no hash cycle:
//     receipt records the manifest digest, the manifest never lists the receipt)
//   - fileCount/totalBytes are computed from the real entries, never asserted
//   - verify() re-reads every listed file: existence, bytes, sha256, path
//     safety and self-exclusion — tampered/missing/wrong-hash entries fail
//   - the final commit hash lives in the TOP-LEVEL RUN_STATUS (outside this
//     workspace), never inside the manifest
//
// CLI:
//   node tools/lane_b_delivery_manifest.mjs generate   # after all docs final
//   node tools/lane_b_delivery_manifest.mjs verify
//   node tools/lane_b_delivery_manifest.mjs receipt    # outer digest receipt
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_REL = 'artifacts/lane-b-polish/delivery-manifest.json';
export const RECEIPT_REL = 'artifacts/lane-b-polish/evidence-repair/delivery-receipt.json';

// The declared delivery scope: batch artifacts (including the evidence-repair
// raw data and the previous/ retraction snapshots), the v7 dataset, the B
// module sources, and the batch tools/tests. dist-lane-b-polish stays out
// (gitignored, rebuildable via scripts/build_lane_b_polish_dist.mjs).
export const MANIFEST_SCOPE = {
  dirs: ['artifacts/lane-b-polish', 'world/fangbang-temple-v7', 'world/lane-b-polish'],
  files: [
    'kit/build_lane_b_v3.py',
    'kit/build_lanes_interfaces_v3.py',
    'kit/build_lane_b_polish_review_scene.py',
    'scripts/make_fangbang_v7_dataset.mjs',
    'scripts/build_lane_b_polish_dist.mjs',
    'tools/lane_b_polish_capture.mjs',
    'tools/lane_b_polish_measure.py',
    'tools/lane_b_polish_runtime.mjs',
    'tools/lane_b_polish_walktest.mjs',
    'tools/lane_b_route_steer.mjs',
    'tools/lane_b_delivery_manifest.mjs',
    'tests/lane-b-polish.test.mjs',
    'tests/lane-b-evidence.test.mjs',
  ],
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function walkFiles(absDir, base, out) {
  for (const ent of await readdir(absDir, { withFileTypes: true })) {
    if (ent.name === '.DS_Store') continue;
    const p = join(absDir, ent.name);
    if (ent.isDirectory()) await walkFiles(p, base, out);
    else if (ent.isFile()) out.push(relative(base, p));
  }
  return out;
}

export function safeRelPath(p) {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/')
    && !p.split('/').includes('..') && !p.includes('\\') && !p.includes('\0');
}

// Build (not write) a manifest for `rootDir` from a scope {dirs, files}.
export async function buildManifest(rootDir, { scope, meta = {} }) {
  const rels = new Set();
  for (const d of scope.dirs ?? []) {
    if (!safeRelPath(d)) throw new Error(`unsafe scope dir ${d}`);
    const abs = resolve(rootDir, d);
    if (!(await stat(abs)).isDirectory()) throw new Error(`scope dir not a directory: ${d}`);
    for (const f of await walkFiles(abs, rootDir, [])) rels.add(f);
  }
  for (const f of scope.files ?? []) {
    if (!safeRelPath(f)) throw new Error(`unsafe scope file ${f}`);
    await stat(resolve(rootDir, f));   // must exist
    rels.add(f);
  }
  // the manifest NEVER lists itself or the receipt (hash-cycle prevention)
  rels.delete(MANIFEST_REL);
  rels.delete(RECEIPT_REL);
  const files = {};
  let totalBytes = 0;
  for (const rel of [...rels].sort()) {
    const buf = await readFile(resolve(rootDir, rel));
    files[rel] = { bytes: buf.byteLength, sha256: sha256(buf) };
    totalBytes += buf.byteLength;
  }
  return {
    batch: meta.batch ?? 'lane-b-polish (2026-09-20) + evidence repair (B7-R1/R2)',
    candidate: meta.candidate ?? 'fangbang-temple-v7',
    status: meta.status ?? 'delivered_for_lead_review',
    ownerAdopted: false,
    note: meta.note ?? 'delivery files + evidence-repair raw run data; dist-lane-b-polish excluded (rebuildable, gitignored); commit hash recorded in the top-level RUN_STATUS outside this workspace, not here',
    excludes: [MANIFEST_REL, RECEIPT_REL],
    files,
    fileCount: Object.keys(files).length,
    totalBytes,
  };
}

// Verify a manifest object against the real tree at rootDir. Every failure is
// collected; ok === errors.length === 0.
export async function verifyManifest(rootDir, m) {
  const errors = [];
  const push = (e) => errors.push(e);
  if (!m || typeof m !== 'object' || !m.files) { return { ok: false, errors: ['manifest: no files table'] }; }
  if (m.files[MANIFEST_REL]) push(`${MANIFEST_REL}: manifest must not include itself`);
  if (m.files[RECEIPT_REL]) push(`${RECEIPT_REL}: manifest must not include the outer receipt (hash cycle)`);
  let sum = 0;
  for (const [rel, entry] of Object.entries(m.files)) {
    if (!safeRelPath(rel)) { push(`${rel}: unsafe path`); continue; }
    if (rel === MANIFEST_REL || rel === RECEIPT_REL) continue;   // already flagged
    if (!entry || !Number.isInteger(entry.bytes) || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) {
      push(`${rel}: malformed entry`); continue;
    }
    let st;
    try { st = await stat(resolve(rootDir, rel)); } catch {
      push(`${rel}: missing`); continue;
    }
    if (!st.isFile()) { push(`${rel}: not a regular file`); continue; }
    if (st.size !== entry.bytes) push(`${rel}: bytes ${st.size} != recorded ${entry.bytes}`);
    const buf = await readFile(resolve(rootDir, rel));
    const actual = sha256(buf);
    if (actual !== entry.sha256) push(`${rel}: sha256 mismatch (recorded ${entry.sha256.slice(0, 12)}…, actual ${actual.slice(0, 12)}…)`);
    sum += entry.bytes;
  }
  if (m.fileCount !== Object.keys(m.files).length)
    push(`fileCount ${m.fileCount} != ${Object.keys(m.files).length} entries`);
  if (m.totalBytes !== sum) push(`totalBytes ${m.totalBytes} != sum of entries ${sum}`);
  return { ok: errors.length === 0, errors };
}

// ---- CLI (only when run directly, never on import) ------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'generate') {
    const m = await buildManifest(root, { scope: MANIFEST_SCOPE });
    await writeFile(resolve(root, MANIFEST_REL), JSON.stringify(m, null, 1) + '\n');
    console.log(`manifest written: ${MANIFEST_REL} (${m.fileCount} files, ${m.totalBytes} bytes)`);
  } else if (cmd === 'verify') {
    const m = JSON.parse(await readFile(resolve(root, MANIFEST_REL), 'utf8'));
    const v = await verifyManifest(root, m);
    for (const e of v.errors) console.log(`FAIL ${e}`);
    console.log(v.ok ? `MANIFEST_VERIFY_PASS (${m.fileCount} files, ${m.totalBytes} bytes)` : `MANIFEST_VERIFY_FAIL (${v.errors.length})`);
    process.exit(v.ok ? 0 : 1);
  } else if (cmd === 'receipt') {
    const buf = await readFile(resolve(root, MANIFEST_REL));
    const m = JSON.parse(buf.toString('utf8'));
    const receipt = {
      note: 'outer receipt: digest of the delivery manifest; NOT listed inside the manifest (no hash cycle). Final commit hash goes to the top-level RUN_STATUS, not into the manifest or this receipt.',
      manifestPath: MANIFEST_REL,
      manifestBytes: buf.byteLength,
      manifestSha256: sha256(buf),
      fileCount: m.fileCount,
      totalBytes: m.totalBytes,
      generatedAt: new Date().toISOString(),
    };
    await writeFile(resolve(root, RECEIPT_REL), JSON.stringify(receipt, null, 1) + '\n');
    console.log(`receipt written: ${RECEIPT_REL} (manifest sha256 ${receipt.manifestSha256})`);
  } else {
    console.log('usage: node tools/lane_b_delivery_manifest.mjs generate|verify|receipt');
    process.exit(cmd ? 1 : 0);
  }
}
