// world-playable-night 20260920 — protected-tree baseline + verify.
// Captures the delivered world/building/kit sources and the core physics /
// controller / viewer sources this batch must not modify, then re-verifies
// at acceptance. Pure hashing: no writes outside artifacts/world-playable/.
//
//   node tools/playable_package_protect.mjs generate   -> artifacts/world-playable/protection/protected-baseline.json
//   node tools/playable_package_protect.mjs verify     -> exit 0 / 1, mismatch list on stdout
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/world-playable/protection/protected-baseline.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const SCOPES = [
  { path: 'world', note: 'delivered world datasets (fangbang-temple-v7 candidate + all frozen predecessors)', locked: true },
  { path: 'building', note: 'legacy building assets', locked: true },
  { path: 'kit/textures', note: 'shared kit textures', locked: true },
  { path: 'kit-src', note: 'kit/*.py *.json *.md build sources (kit/out renders and __pycache__ excluded)', locked: true },
  { path: 'src/world', note: 'world loading / collision / physics adapter core', locked: true },
  { path: 'src/player', note: 'walk controller / anchors / session core', locked: true },
  { path: 'src-file:src/fangbangMain.js', note: 'fangbang page main', locked: false },
  { path: 'src-file:src/templeViewShared.js', note: 'shared view/evidence helpers', locked: true },
  { path: 'file:fangbang.html', note: 'game page shell', locked: false },
  { path: 'file:vite.config.js', note: 'build input config', locked: false },
];
// locked:false = the plan's explicit minimal-change window for THIS batch only
// (?entry= param, error states, build inputs); changes there are REPORTED, not
// failed. Everything locked must verify byte-exact.
const EXCLUDE = [/^kit\/out\//, /__pycache__/, /\.blend1$/, /\.cache\//];

async function walk(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

async function collect() {
  const files = [];
  for (const s of SCOPES) {
    if (s.path.startsWith('src-file:') || s.path.startsWith('file:')) {
      files.push(resolve(root, s.path.slice(s.path.indexOf(':') + 1)));
    } else files.push(...await walk(resolve(root, s.path)));
  }
  return [...new Set(files)].sort();
}

async function build() {
  const files = [];
  for (const s of SCOPES) {
    const scoped = [];
    if (s.path.startsWith('src-file:') || s.path.startsWith('file:')) {
      scoped.push(resolve(root, s.path.slice(s.path.indexOf(':') + 1)));
    } else scoped.push(...await walk(resolve(root, s.path)));
    for (const f of scoped) files.push({ f, locked: !!s.locked });
  }
  const seen = new Set();
  const entries = [];
  let totalBytes = 0;
  for (const { f, locked } of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    const rel = relative(root, f).replaceAll('\\', '/');
    if (EXCLUDE.some((re) => re.test(rel))) continue;
    const b = await readFile(f);
    entries.push({ path: rel, bytes: b.length, sha256: sha(b), locked });
    totalBytes += b.length;
  }
  entries.sort((a, b2) => a.path.localeCompare(b2.path));
  let head = null, dirty = null;
  try { head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch {}
  try { dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }) || null; } catch {}
  return {
    batch: 'world-playable-night-20260920',
    role: 'protection baseline — locked files must not change; locked:false files are this batch\'s documented minimal-change window (entry params / error states / build inputs) and are reported on change',
    baselineCommit: head,
    workingTreeCleanAtBaseline: dirty === null,
    generatedAt: new Date().toISOString(),
    scopes: SCOPES.map((s) => ({ note: s.note, locked: !!s.locked })),
    excludes: ['kit/out/** (2.2G historical render output)', '**/__pycache__/**', '**/*.blend1 (gitignored blender backups)', '.cache/**'],
    fileCount: entries.length,
    totalBytes,
    files: entries,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'generate') {
    const m = await build();
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(m, null, 1) + '\n', 'utf8');
    const locked = m.files.filter((f) => f.locked).length;
    console.log(`PROTECT_BASELINE_OK ${m.fileCount} files (${locked} locked) ${(m.totalBytes / 1e6).toFixed(1)} MB -> ${relative(root, OUT)}`);
  } else if (cmd === 'verify') {
    const m = JSON.parse(await readFile(OUT, 'utf8'));
    const errors = [], allowedChanged = [];
    for (const e of m.files) {
      let status = 'ok';
      try {
        const b = await readFile(resolve(root, e.path));
        if (b.length !== e.bytes) status = `bytes ${b.length} != ${e.bytes}`;
        else if (sha(b) !== e.sha256) status = 'sha mismatch';
      } catch { status = 'missing'; }
      if (status !== 'ok') {
        if (e.locked) errors.push(`${e.path}: ${status}`);
        else allowedChanged.push(`${e.path}: ${status} (this batch's documented minimal-change window)`);
      }
    }
    for (const a of allowedChanged) console.log('ALLOWED_CHANGE', a);
    if (errors.length) { for (const e of errors) console.log('FAIL', e); console.log(`PROTECT_VERIFY_FAIL (${errors.length} locked mismatches)`); process.exitCode = 1; }
    else console.log(`PROTECT_VERIFY_PASS ${m.fileCount} files, locked 0 mismatch, ${allowedChanged.length} allowed-change files unchanged-since-baseline`);
  } else {
    console.log('usage: node tools/playable_package_protect.mjs generate|verify');
    process.exitCode = 2;
  }
}
export { build as buildProtectionBaseline };
