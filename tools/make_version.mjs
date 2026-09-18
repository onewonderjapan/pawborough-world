// C0/C1 — v1.0 candidate version manifest + hub page.
// tools/make_version.mjs walks world/** and building/**, hashes every GLB/JSON,
// captures git head + tool versions + test-suite inventory, writes
// VERSION.json, and renders index-v1.html (pages/datasets/tris/sha/cameras/
// ownerAdopted verbatim) from the SAME data so the two can never disagree.
//
// Run: node tools/make_version.mjs
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (cmd) => { try { return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

// ---- inventory: world/** and building/** --------------------------------
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
const worldFiles = (await walk(resolve(root, 'world'), (n) => /\.(glb|json|blend)$/i.test(n))).sort();
const buildingFiles = (await walk(resolve(root, 'building'), (n) => /\.(glb|json)$/i.test(n))).sort();
const hashFile = async (p) => {
  const b = await readFile(p);
  return { path: relative(root, p).split('\\').join('/'), bytes: b.byteLength, sha256: sha(b) };
};
const worldHashes = [];
for (const p of worldFiles) worldHashes.push(await hashFile(p));
const buildingHashes = [];
for (const p of buildingFiles) buildingHashes.push(await hashFile(p));

// ---- per-dataset summaries (from each review-manifest) ------------------
const manifests = worldFiles.filter((p) => p.endsWith('/review-manifest.json'));
const datasets = [];
for (const mp of manifests) {
  const dir = relative(root, dirname(mp)).split('\\').join('/');
  let m;
  try { m = JSON.parse(await readFile(mp, 'utf8')); } catch { continue; }
  const files = worldHashes.filter((f) => f.path.startsWith(dir + '/'));
  const digest = sha(files.map((f) => f.sha256).join(''));
  let cameras = null;
  try {
    const c = JSON.parse(await readFile(resolve(root, dir, 'cameras.json'), 'utf8'));
    cameras = (c.cameras ?? []).length;
  } catch { /* no cameras in this dataset */ }
  datasets.push({
    id: m.datasetId ?? dir,
    path: dir + '/',
    placedTriangles: m.placedTriangles ?? null,
    ownerAdopted: m.ownerAdopted === true,
    status: m.status ?? null,
    cameras,
    files: files.length,
    totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    filesDigest: digest,
  });
}
datasets.sort((a, b) => a.path.localeCompare(b.path));

// ---- tool versions -------------------------------------------------------
let blender = null;
try { blender = execSync('blender --version', { encoding: 'utf8' }).split('\n')[0].trim(); } catch { /* offline */ }
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const tests = (await walk(resolve(root, 'tests'), (n) => n.endsWith('.test.mjs'))).sort();

const version = {
  batch: 'pawborough-v1-candidate-night-20260918',
  role: 'v1.0 CANDIDATE — not adopted; every ownerAdopted stays false until the owner rules (GATE.md)',
  generatedAt: new Date().toISOString(),
  git: {
    head: git('git rev-parse HEAD'),
    branch: git('git rev-parse --abbrev-ref HEAD'),
    subject: git('git log -1 --format=%s'),
  },
  tools: {
    node: process.version,
    blender,
    three: pkg.dependencies?.three ?? pkg.devDependencies?.three ?? null,
    rapier: pkg.dependencies?.['@dimforge/rapier3d-compat'] ?? null,
    vite: pkg.devDependencies?.vite ?? null,
    playwright: pkg.devDependencies?.playwright ?? '1.63.0 (installed --no-save)',
  },
  tests: {
    suiteFiles: tests.length,
    list: tests.map((p) => relative(root, p).split('\\').join('/')),
    lastFullRun: 'see artifacts/v1-candidate/verify-report.json (tools/verify_all.sh)',
  },
  counts: { worldFiles: worldHashes.length, buildingFiles: buildingHashes.length, datasets: datasets.length },
  datasets,
  worldFiles: worldHashes,
  buildingFiles: buildingHashes,
};
await writeFile(resolve(root, 'VERSION.json'), JSON.stringify(version, null, 2) + '\n');

// ---- hub page ------------------------------------------------------------
const PAGES = [
  { name: '方浜街道（街区行走）', url: 'http://127.0.0.1:5284/fangbang.html', ds: 'world/' },
  { name: '庙轴线 v2（temple-v2）', url: 'http://127.0.0.1:5290/temple-v2.html', ds: 'world/temple-axis-v2/' },
  { name: '庙入口组（temple-entry）', url: 'http://127.0.0.1:5292/temple-entry.html', ds: 'world/temple-shanmen/' },
  { name: '大殿（dadian）', url: 'http://127.0.0.1:5294/dadian.html', ds: 'world/temple-axis-v2/' },
  { name: '桥接世界 v2（现役）', url: 'http://127.0.0.1:5297/fangbang.html?ds=fangbang-temple-v2', ds: 'world/fangbang-temple-v2/' },
  { name: '桥接世界 v3（西延带升级，本批）', url: 'http://127.0.0.1:5304/fangbang.html?ds=fangbang-temple-v3', ds: 'world/fangbang-temple-v3/' },
  { name: 'v3 + 背面外皮全集（skins）', url: 'http://127.0.0.1:5304/fangbang.html?ds=fangbang-temple-v3&skins=1', ds: 'world/street-sidefaces/' },
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dsRows = datasets.map((d) => {
  const mb = (d.totalBytes / 1e6).toFixed(1);
  return `  <tr><td><code>${esc(d.id)}</code></td><td><code>${esc(d.path)}</code></td>`
    + `<td class="num">${d.placedTriangles ?? '—'}</td><td class="num">${d.files} / ${mb} MB</td>`
    + `<td class="num">${d.cameras ?? '—'}</td><td>${d.ownerAdopted ? 'true' : '<b>false</b>'}</td>`
    + `<td>${esc(d.status ?? '—')}</td><td class="sha">${esc(d.filesDigest.slice(0, 16))}…</td></tr>`;
}).join('\n');
const pageRows = PAGES.map((p) => {
  const d = datasets.find((x) => x.path === p.ds);
  return `  <tr><td>${esc(p.name)}</td><td><a href="${p.url}"><code>${esc(p.url)}</code></a></td>`
    + `<td><code>${esc(p.ds)}</code></td><td class="num">${d ? (d.placedTriangles ?? '—') : '—'}</td></tr>`;
}).join('\n');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>Pawborough v1.0 候选包 — 入口</title>
<style>
 body{font-family:system-ui,sans-serif;margin:2rem;max-width:1200px;color:#222;background:#faf9f7}
 h1{font-size:1.4rem} table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9rem}
 td,th{border:1px solid #ccc;padding:.35rem .5rem;text-align:left} .num{text-align:right}
 .sha{font-family:monospace;font-size:.8rem} code{font-size:.85em}
 .note{background:#fff3cd;padding:.6rem .9rem;border:1px solid #e0c870;font-size:.9rem}
 .meta{color:#666;font-size:.85rem}
</style>
<h1>Pawborough v1.0 候选包 — 入口（index-v1）</h1>
<p class="note">候选状态：所有数据集 ownerAdopted = <b>false</b>，待机主在 GATE.md 决策门逐项裁决后方可封版。生成时间 ${esc(version.generatedAt)} · head <code>${esc(version.git.head ?? '?')}</code></p>
<h2>页面（现役端口）</h2>
<table>
<tr><th>页面</th><th>URL</th><th>数据集</th><th>placedTriangles</th></tr>
${pageRows}
</table>
<h2>数据集（world/ 全集）</h2>
<table>
<tr><th>datasetId</th><th>路径</th><th>placedTris</th><th>files / bytes</th><th>机位</th><th>ownerAdopted</th><th>status</th><th>文件摘要(sha256 前16)</th></tr>
${dsRows}
</table>
<p class="meta">完整逐文件 sha256 见 <code>VERSION.json</code>（world/** ${worldHashes.length} 文件 + building/** ${buildingHashes.length} 文件）。一条命令校验：<code>bash tools/verify_all.sh</code>。机主决策清单见 <code>GATE.md</code>。</p>
`;
await writeFile(resolve(root, 'index-v1.html'), html);
console.log(`VERSION_READY head=${version.git.head} datasets=${datasets.length} worldFiles=${worldHashes.length} buildingFiles=${buildingHashes.length}`);
