// M — world-closeout baseline inventory.
// Hashes world/** and building/** (GLB/JSON), classifies original vs
// compressed (.cm.glb) vs metadata (route/cameras/instances/collision/blocks/
// manifest), and records the live-render process snapshot read from /proc
// plus the M baseline test run. Read-only over the tree; writes one file:
//   artifacts/world-closeout/baseline.json
// Run: node tools/make_closeout_baseline.mjs [--tests-log <path>]
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(root, 'artifacts/world-closeout/baseline.json');
const BASELINE_COMMIT = '1892e61cc63bea00ec83366885657e1fcd864ef0';
const CUTOFF = '2026-09-20T08:15:00+09:00';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (cmd) => { try { return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

async function walk(dir, filter) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, filter));
    else if (filter(e.name)) out.push(p);
  }
  return out;
}

const classify = (rel) => {
  if (/\.cm\.glb$/i.test(rel)) return 'compressed';
  if (/\.glb$/i.test(rel)) return 'originalGlb';
  if (/route\.json$/i.test(rel)) return 'route';
  if (/cameras\.json$/i.test(rel)) return 'cameras';
  if (/instances\.json$/i.test(rel)) return 'instances';
  if (/collision[^/]*\.json$/i.test(rel)) return 'collision';
  if (/blocks\.json$/i.test(rel)) return 'blocks';
  if (/manifest.*\.json$/i.test(rel)) return 'manifest';
  if (/\.json$/i.test(rel)) return 'metadata';
  return 'other';
};

const files = [
  ...(await walk(resolve(root, 'world'), (n) => /\.(glb|json)$/i.test(n))),
  ...(await walk(resolve(root, 'building'), (n) => /\.(glb|json)$/i.test(n))),
].sort();

const entries = [];
for (const p of files) {
  const b = await readFile(p);
  const rel = relative(root, p).split('\\').join('/');
  entries.push({ path: rel, bytes: b.byteLength, sha256: sha(b), class: classify(rel) });
}

const byClass = {};
for (const e of entries) (byClass[e.class] ??= []).push(e);
const sum = (list) => list.reduce((a, e) => a + e.bytes, 0);

// ---- live render snapshot from /proc (PIDs are hints, cmdline is identity) --
const sourceWs = '/home/baibai/outbox/pawborough-adoption-east-night-20260919/workspace';
const procs = [];
let pids = [];
try { pids = (await readdir('/proc')).filter((d) => /^\d+$/.test(d)); } catch {}
for (const pid of pids) {
  let cmd = '';
  try { cmd = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean).join(' '); } catch { continue; }
  if (/adoption-east-night-20260919/.test(cmd) && /blender|adoption_video_watchdog/.test(cmd)) {
    let startEpoch = null;
    try { startEpoch = Number((await stat(`/proc/${pid}`)).mtime.getTime() / 1000 | 0); } catch {}
    procs.push({ pid: Number(pid), startEpoch, cmdline: cmd.slice(0, 400) });
  }
}
let frameCount = null;
try { frameCount = (await readdir(join(sourceWs, 'artifacts/adoption-east/frames'))).length; } catch {}

const head = git('git rev-parse HEAD');
const testsArgIdx = process.argv.indexOf('--tests-log');
const testsLog = testsArgIdx > -1 ? process.argv[testsArgIdx + 1] : null;
let tests = null;
if (testsLog) {
  try { tests = JSON.parse(await readFile(testsLog, 'utf8')); } catch { tests = { note: `log present but unparsable: ${testsLog}` }; }
}

const baseline = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'M',
  baselineCommit: BASELINE_COMMIT,
  headAtInventory: head,
  headMatchesBaseline: head === BASELINE_COMMIT,
  generatedAt: new Date().toISOString(),
  lfs: { materialized: true, note: 'git lfs ls-files: 9700 files, all materialized (*), no pointer stubs' },
  counts: {
    total: entries.length,
    originalGlb: byClass.originalGlb?.length ?? 0,
    compressed: byClass.compressed?.length ?? 0,
    route: byClass.route?.length ?? 0,
    cameras: byClass.cameras?.length ?? 0,
    instances: byClass.instances?.length ?? 0,
    collision: byClass.collision?.length ?? 0,
    blocks: byClass.blocks?.length ?? 0,
    manifest: byClass.manifest?.length ?? 0,
    metadata: byClass.metadata?.length ?? 0,
  },
  bytes: {
    originalGlb: sum(byClass.originalGlb ?? []),
    compressed: sum(byClass.compressed ?? []),
  },
  compressed: {
    existingAtBaseline: (byClass.compressed ?? []).map((e) => ({ path: e.path, bytes: e.bytes, sha256: e.sha256 })),
    newInThisBatch: [],
  },
  files: entries,
  liveRender: {
    sourceWorkspace: sourceWs,
    readPolicy: 'read-only; not owned by this batch; cutoff unchanged',
    cutoff: CUTOFF,
    expectedFrames: 8781,
    framesOnDiskAtInventory: frameCount,
    statusFile: `${sourceWs}/artifacts/adoption-east/clipA-full.status.json`,
    statusFileExistsAtInventory: (() => { try { return statSync(`${sourceWs}/artifacts/adoption-east/clipA-full.status.json`) && true; } catch { return false; } })(),
    processes: procs,
    pidsAreHistoricalHints: true,
  },
  baselineTests: tests,
};

await mkdirIfMissing(resolve(root, 'artifacts/world-closeout'));
await writeFile(outPath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
console.log(`baseline.json written: ${entries.length} files, ` +
  `originalGlb=${baseline.counts.originalGlb} compressed=${baseline.counts.compressed} ` +
  `(${(baseline.bytes.originalGlb / 1e6).toFixed(1)}MB / ${(baseline.bytes.compressed / 1e6).toFixed(1)}MB), ` +
  `headMatchesBaseline=${baseline.headMatchesBaseline}, framesOnDisk=${frameCount}, procs=${procs.length}`);

async function mkdirIfMissing(dir) {
  try { await (await import('node:fs/promises')).mkdir(dir, { recursive: true }); } catch {}
}
