// world-ten-hour round 3 (PLAN task G) — source-project index.
// Indexes every real .blend source in the read-only asset trees (world/,
// building/, kit/) with bytes + sha256 + git-tracking status, marks the ones
// the homepage 制作资料 table already covers (galleryManifest.sources), maps
// each to the production/reopen command that is actually documented in THIS
// repo (never invented), and — with --verify — headless-reopens a small
// representative sample through the real Blender binary to prove the sources
// still open (read-only; never saves). *.blend1 backups are listed separately
// as backups, NOT sources (the UP-G1 lesson: backups are not deliverables).
//
// Run: node tools/source_project_index.mjs [--out artifacts/world-ten-hour/round-003/source-index.json]
//      node tools/source_project_index.mjs --verify   (adds real Blender reopens)
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const verify = process.argv.includes('--verify');
const outPath = resolve(root, arg('out', 'artifacts/world-ten-hour/round-003/source-index.json'));
const BLENDER = process.env.BLENDER_BIN || resolve(root, '../../.local/bin/blender'); // host install; NOT a package dependency

const TREES = ['world', 'building', 'kit'];
// production / reopen commands documented in this repo (docs, scripts, delivery
// notes) — a source is only mapped to a command the repo itself states
const COMMAND_NOTES = {
  'world/scene.blend': '历史主街全景源工程（历史批次；本候选未重打统一全景）。核对方式：blender --background world/scene.blend',
  'world/lane-a-polish/review/scene.blend': 'A弄精修评审场景（lane-a-polish 批次；dist 由 scripts/build_lane_a_polish_dist.mjs 打包）',
  'world/lane-b-polish/review/scene.blend': 'B弄口修整评审场景（lane-b-polish 批次 = v7 来源；dist 由 scripts/build_lane_b_polish_dist.mjs 打包，交付清单 tools/lane_b_delivery_manifest.mjs）',
};

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- git-tracked files (LFS pointer in HEAD is fine; tracking is the fact) --
let trackedSet = new Set();
try {
  const { stdout } = await execFileP('git', ['ls-files', 'world', 'building', 'kit'], { cwd: root, maxBuffer: 64e6 });
  trackedSet = new Set(stdout.split('\n').filter(Boolean));
} catch (e) { console.error('git ls-files failed:', String(e).slice(0, 200)); }

const sources = [];
const backups = [];
for (const tree of TREES) {
  for (const p of await walk(resolve(root, tree))) {
    const rel = relative(root, p).replaceAll('\\', '/');
    if (rel.endsWith('.blend1')) { backups.push(rel); continue; }
    if (!rel.endsWith('.blend')) continue;
    const b = await readFile(p);
    sources.push({
      path: rel,
      bytes: b.length,
      sha256: sha256(b),
      gitTracked: trackedSet.has(rel),
      reopenNote: COMMAND_NOTES[rel] ?? null,
    });
  }
}
sources.sort((a, b) => a.path.localeCompare(b.path));
backups.sort();

// homepage 制作资料 coverage (galleryManifest.sources paths must match disk)
let gallerySources = {};
try {
  const gm = JSON.parse(await readFile(resolve(root, 'src/worldPreview/galleryManifest.json'), 'utf8'));
  gallerySources = gm.sources ?? {};
} catch { /* stays empty — homepage coverage reported as 0 */ }
for (const s of sources) {
  const g = gallerySources[s.path];
  if (g) {
    s.onHomepage = true;
    s.homepageShaMatch = g.sha256 === s.sha256 && g.bytes === s.bytes;
  } else s.onHomepage = false;
}

// ---- real reopen verification (sample; read-only) ----------------------------
const reopen = [];
if (verify) {
  const sample = [
    'world/scene.blend',
    'world/lane-b-polish/review/scene.blend',
    'building/plain-v1/model.blend',
  ].filter((p) => sources.some((s) => s.path === p));
  for (const rel of sample) {
    const expr = `import bpy; print('REOPEN_OK objects=%d meshes=%d' % (len(bpy.data.objects), len(bpy.data.meshes)))`;
    try {
      const { stdout } = await execFileP(BLENDER, ['--background', resolve(root, rel), '--python-expr', expr],
        { cwd: root, timeout: 180000, maxBuffer: 8e6 });
      const line = stdout.split('\n').find((l) => l.includes('REOPEN_OK')) ?? null;
      reopen.push({ path: rel, ok: !!line, detail: line ?? 'no REOPEN_OK line' });
    } catch (e) {
      reopen.push({ path: rel, ok: false, detail: String(e.message ?? e).slice(0, 200) });
    }
  }
}

const index = {
  tool: 'tools/source_project_index.mjs',
  generatedAt: new Date().toISOString(),
  scope: 'read-only index of .blend sources in world/, building/, kit/; *.blend1 listed separately as backups (not deliverables)',
  counts: { sources: sources.length, backups: backups.length, onHomepage: sources.filter((s) => s.onHomepage).length, verified: reopen.length },
  untracked: sources.filter((s) => !s.gitTracked).map((s) => s.path),
  homepageCoverage: { covered: sources.filter((s) => s.onHomepage).map((s) => s.path), shaMismatch: sources.filter((s) => s.onHomepage && s.homepageShaMatch === false).map((s) => s.path) },
  reopenVerification: reopen,
  sources,
  backups,
};
await writeFile(outPath, JSON.stringify(index, null, 1) + '\n');
console.log(`SOURCE_INDEX_OK ${outPath}`);
console.log(`sources=${index.counts.sources} backups=${index.counts.backups} onHomepage=${index.counts.onHomepage} untracked=${index.untracked.length}`);
if (reopen.length) for (const r of reopen) console.log(`${r.ok ? 'REOPEN_PASS' : 'REOPEN_FAIL'} ${r.path} ${r.detail}`);
const bad = index.homepageCoverage.shaMismatch;
if (bad.length) console.log(`HOMEPAGE_SHA_MISMATCH ${bad.join(', ')}`);
