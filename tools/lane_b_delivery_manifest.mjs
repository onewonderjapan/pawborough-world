// Delivery manifest generator/verifier for the lane-b-polish batch
// (evidence-repair B7-R2, 2026-09-20; UP-G1 committed-tree fix 2026-09-21).
//
// The previous delivery-manifest.json included ITS OWN old hash as an entry
// (59/60 verified, the self-entry could never match after rewriting). Rules
// enforced here:
//   - the manifest EXCLUDES itself and the outer receipt (no hash cycle:
//     receipt records the manifest digest, the manifest never lists the receipt)
//   - fileCount/totalBytes are computed from the real entries, never asserted
//   - verify() re-reads every listed file: existence, bytes, sha256, path
//     safety and self-exclusion — tampered/missing/wrong-hash entries fail
//   - UP-G1 (2026-09-21 fix): the upstream generator walked the filesystem and
//     listed two gitignored *.blend1 Blender backups, so the manifest could
//     never verify against the committed tree. Generation for the committed
//     scope now filters to git-TRACKED files (git ls-files) and always drops
//     backup files; verifyManifest(root, m, {tracked}) flags entries git does
//     not track. The committed-tree guarantee is proven by exporting HEAD to a
//     fresh directory (git worktree add, LFS smudged from the local store) and
//     verifying there — see tests/lane-b-evidence.test.mjs
//   - the final commit hash lives in the TOP-LEVEL RUN_STATUS (outside this
//     workspace), never inside the manifest
//
// Delivery scopes (UP-G1 fix):
//   committed-source = this manifest: exactly the git-tracked, non-backup
//     files in MANIFEST_SCOPE; verifiable from a fresh checkout of HEAD.
//   portable-payload = the gitignored rebuildable dist closures
//     (dist-lane-b-polish, dist-world-playable). They are NOT part of the
//     committed tree; each has its own build-time verification
//     (scripts/build_lane_b_polish_dist.mjs DIST_RUN_OK, dist-world-playable
//     133-file package manifest) and is excluded from this manifest on purpose.
//
// CLI:
//   node tools/lane_b_delivery_manifest.mjs generate   # after all docs final
//   node tools/lane_b_delivery_manifest.mjs verify [dir]
//   node tools/lane_b_delivery_manifest.mjs receipt    # outer digest receipt
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);

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

// Temp/backup files are never formal deliverables. UP-G1 root cause: Blender
// writes *.blend1 next to the real *.blend on every re-save; .gitignore:31
// excludes them, so they are absent from any committed tree.
export function isBackupPath(rel) {
  return /\.(blend1|blend2)$/i.test(rel) || /(~|\.(bak|tmp))$/i.test(rel);
}

// Set of paths git tracks at rootDir (the committed-tree file universe), or
// null when rootDir is not a work tree / git is unavailable.
export async function gitTrackedFiles(rootDir) {
  try {
    const out = await execFile('git', ['-C', rootDir, 'ls-files', '-z'],
      { maxBuffer: 64 * 1024 * 1024 });
    return new Set(out.stdout.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

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
// opts.tracked (Set): when given, only git-tracked files enter the manifest
// (committed-source scope) and backup files are always dropped — an untracked
// scope.files entry is a hard error (a declared deliverable git does not carry).
// When omitted (fixture/scratch trees), no filtering happens.
export async function buildManifest(rootDir, { scope, meta = {}, tracked } = {}) {
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
  // UP-G1 rule: committed-source entries must be git-tracked, and backups are
  // never deliverables even if force-added to the index.
  const excluded = { backups: [], untracked: [] };
  if (tracked) {
    for (const rel of [...rels]) {
      if (isBackupPath(rel)) { excluded.backups.push(rel); rels.delete(rel); continue; }
      if (!tracked.has(rel)) {
        if ((scope.files ?? []).includes(rel))
          throw new Error(`declared scope file is not git-tracked (would repeat UP-G1): ${rel}`);
        excluded.untracked.push(rel);
        rels.delete(rel);
      }
    }
  }
  const files = {};
  let totalBytes = 0;
  for (const rel of [...rels].sort()) {
    const buf = await readFile(resolve(rootDir, rel));
    files[rel] = { bytes: buf.byteLength, sha256: sha256(buf) };
    totalBytes += buf.byteLength;
  }
  const m = {
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
  if (tracked) {
    m.scopeKind = meta.scopeKind ?? 'committed-source';
    m.trackedBasis = 'git ls-files at generation; backups (*.blend1 etc.) always excluded';
    m.excluded = excluded;
  }
  return m;
}

// Verify a manifest object against the real tree at rootDir. Every failure is
// collected; ok === errors.length === 0. opts.tracked (Set, optional): entries
// git does not track are flagged — the UP-G1 failure class (manifest listing
// files no checkout can ever contain).
export async function verifyManifest(rootDir, m, { tracked } = {}) {
  const errors = [];
  const push = (e) => errors.push(e);
  if (!m || typeof m !== 'object' || !m.files) { return { ok: false, errors: ['manifest: no files table'] }; }
  if (m.files[MANIFEST_REL]) push(`${MANIFEST_REL}: manifest must not include itself`);
  if (m.files[RECEIPT_REL]) push(`${RECEIPT_REL}: manifest must not include the outer receipt (hash cycle)`);
  let sum = 0;
  for (const [rel, entry] of Object.entries(m.files)) {
    if (!safeRelPath(rel)) { push(`${rel}: unsafe path`); continue; }
    if (rel === MANIFEST_REL || rel === RECEIPT_REL) continue;   // already flagged
    if (tracked && !tracked.has(rel)) push(`${rel}: not git-tracked (absent from any committed tree, UP-G1 class)`);
    if (isBackupPath(rel)) push(`${rel}: backup file listed as a deliverable (UP-G1 class)`);
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
    const tracked = await gitTrackedFiles(root);
    if (!tracked) {
      console.log('FAIL: committed-source generation needs git (tracked-file basis, UP-G1 rule)');
      process.exit(1);
    }
    const m = await buildManifest(root, { scope: MANIFEST_SCOPE, tracked });
    await writeFile(resolve(root, MANIFEST_REL), JSON.stringify(m, null, 1) + '\n');
    const ex = m.excluded;
    console.log(`manifest written: ${MANIFEST_REL} (${m.fileCount} files, ${m.totalBytes} bytes)`);
    console.log(`excluded: ${ex.backups.length} backup(s), ${ex.untracked.length} untracked` +
      (ex.backups.length + ex.untracked.length
        ? ` -> ${[...ex.backups, ...ex.untracked].join(', ')}` : ''));
  } else if (cmd === 'verify') {
    const dir = process.argv[3] ? resolve(process.argv[3]) : root;
    const m = JSON.parse(await readFile(resolve(root, MANIFEST_REL), 'utf8'));
    const tracked = dir === root ? await gitTrackedFiles(root) : undefined;
    const v = await verifyManifest(dir, m, { tracked });
    for (const e of v.errors) console.log(`FAIL ${e}`);
    console.log(v.ok ? `MANIFEST_VERIFY_PASS (${m.fileCount} files, ${m.totalBytes} bytes` +
      `${dir === root ? ', tracked-consistent' : ' in ' + dir})`
      : `MANIFEST_VERIFY_FAIL (${v.errors.length})`);
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
