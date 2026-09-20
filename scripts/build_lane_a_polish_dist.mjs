// Build the standalone dist for the lane-a-polish candidate — vite build to
// its OWN outDir (dist-lane-a-polish), then carry the full fangbang-temple-v6
// dependency closure so the page actually RUNS from the directory (not just
// compiled JS): dataset files + every site-root GLB/collision the v6 blocks
// and manifest reference + the optional skins/props datasets + building
// modules. A required-file gate fails the build on anything missing; a
// headless preview smoke (real page load + automatic route check) closes it.
//
// Run: node scripts/build_lane_a_polish_dist.mjs
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'dist-lane-a-polish';

// --emptyOutDir false: vite must never wipe the directory (prior deliverables
// and this batch's files coexist; the build only overwrites its own outputs)
const vite = spawnSync(process.execPath, ['node_modules/.bin/vite', 'build', '--outDir', OUT, '--emptyOutDir', 'false'], { cwd: root, stdio: 'inherit' });
if (vite.status !== 0) process.exit(vite.status ?? 1);
// gate: the BUILT html must reference bundled assets, never /src/*.js
{
  const html = await readFile(resolve(root, OUT, 'fangbang.html'), 'utf8');
  if (/\/src\/fangbangMain\.js/.test(html)) throw new Error('dist fangbang.html still points at source /src/fangbangMain.js');
  if (!/assets\/.*\.js/.test(html)) throw new Error('dist fangbang.html has no bundled script');
}

const m = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v6/review-manifest.json'), 'utf8'));
const blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v6/blocks.json'), 'utf8'));

const files = new Set([
  // NOTE: html entries come from the vite build itself (this script must not
  // overwrite the built fangbang.html with the source one)
  // dataset core (assembly GLB lives inside the dataset dir)
  'world/fangbang-temple-v6/review-manifest.json', 'world/fangbang-temple-v6/instances.json',
  'world/fangbang-temple-v6/collision-world.json', 'world/fangbang-temple-v6/route.json',
  'world/fangbang-temple-v6/cameras.json', 'world/fangbang-temple-v6/blocks.json',
  'world/fangbang-temple-v6/street-reviewed-lanes.glb',
  // dataset-level surfaces and walls the page loads from the manifest
  m.worldAssembly.path.slice(2),
  m.streetCompletion.surface.path.slice(2),
  m.streetCompletion.eastTailSurface.path.slice(2),
  m.westExtension.surface.path.slice(2), m.westExtension.sealWall.path.slice(2),
  ...(m.eastExtension ? [m.eastExtension.surface.path.slice(2), m.eastExtension.sealWall.path.slice(2)] : []),
  ...(m.templeAxis?.assets ?? []).flatMap((a) => [a.glb.replace('./', '')]),
]);
for (const b of blocks.blocks) {
  if (b.kind !== 'assets') continue;
  for (const a of b.assets ?? []) {
    for (const p of [a.glb, a.collision]) {
      if (p === undefined) continue;
      if (typeof p !== 'string' || !p.startsWith('./')) throw new Error(`asset path escapes site root: ${p}`);
      files.add(p.slice(2));
    }
  }
}
// collision sidecars referenced by the base world dataset files are inside the
// dataset dirs already; skins/props are single-flag configs — carried so the
// measured all-on configuration also runs from the dist
for (const extra of ['world/street-sidefaces/review-manifest.json', 'world/street-sidefaces/collision-world.json',
  'world/street-sidefaces/instances.json', 'world/street-props/review-manifest.json',
  'world/street-props/instances.json', 'world/street-props/collision.json'])
  files.add(extra);
const sk = JSON.parse(await readFile(resolve(root, 'world/street-sidefaces/review-manifest.json'), 'utf8'));
for (const k of sk.skins ?? []) files.add(k.glb.replace('./', ''));
const pr = JSON.parse(await readFile(resolve(root, 'world/street-props/review-manifest.json'), 'utf8'));
for (const [id, a] of Object.entries(pr.assets ?? {})) files.add(a.file.replace('./', ''));

// skip heavy authoring sources; the reopenable .blend stays in the workspace
const skip = (f) => f.endsWith('.blend') || f.endsWith('.blend1') || f.endsWith('.py');

const inventory = {};
const missing = [];
for (const f of files) {
  if (skip(f)) continue;
  const src = resolve(root, f), dst = resolve(root, OUT, f);
  try {
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    inventory[f] = (await stat(dst)).size;
  } catch { missing.push(f); }
}
if (missing.length) { console.error('DIST_INCOMPLETE', missing); process.exit(1); }
await writeFile(resolve(root, OUT, 'lane-a-polish-dist-inventory.json'), JSON.stringify({
  generatedBy: 'scripts/build_lane_a_polish_dist.mjs',
  dataset: 'fangbang-temple-v6', files: inventory,
  totalBytes: Object.values(inventory).reduce((s, v) => s + v, 0),
}, null, 2) + '\n');
console.log(`LANE_A_POLISH_DIST_READY files=${Object.keys(inventory).length} bytes=${Object.values(inventory).reduce((s, v) => s + v, 0)}`);

// ---- runability gate: serve the dist, load the candidate page headless -----
const port = 5376;
const prev = spawn(process.execPath, ['node_modules/.bin/vite', 'preview', '--outDir', OUT,
  '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
prev.stdout.on('data', (d) => { log += d; });
prev.stderr.on('data', (d) => { log += d; });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { up = (await fetch(`http://127.0.0.1:${port}/fangbang.html`)).ok; } catch {}
}
if (!up) { console.error('preview server failed:\n' + log); prev.kill(); process.exit(1); }
const { chromium } = await import('../node_modules/playwright/index.mjs');
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
// fail FAST on fatal page errors / failed resource loads — a dead page must
// never burn the full ready timeout
const loadConfig = async (query) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  const onErr = (m) => problems.push(m);
  // the compressed-manifest probe (.cm.json HEAD) is an OPTIONAL capability
  // check with a documented plain-JSON fallback — its miss is not fatal
  const optional = (u) => /\/review-manifest\.cm\.json$/.test(new URL(u).pathname);
  page.on('pageerror', (e) => onErr(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('requestfailed', (r) => { if (!optional(r.url())) onErr(`requestfailed ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !optional(r.url())) onErr(`http${r.status()} ${new URL(r.url()).pathname}`); });
  try {
    await page.goto(`http://127.0.0.1:${port}/fangbang.html?ds=fangbang-temple-v6${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const r = window.__fangbangRecord?.();
      if (r && r.ready) return true;
      // the page reports its own fatal load state: fail as soon as it's shown
      const st = document.querySelector('#stage')?.textContent ?? '';
      return st.startsWith('载入失败');
    }, null, { timeout: 240000, polling: 500 });
    const failed = await page.evaluate(() => (document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败'));
    if (failed || problems.length) throw new Error(`early: ${problems.slice(0, 4).join(' | ') || 'page reported 载入失败'}`);
    await page.waitForFunction(() => window.__fangbangRecord()?.ready === true, null, { timeout: 240000, polling: 500 });
    const rec = await page.evaluate(() => {
      const r = window.__fangbangRecord();
      return { ready: r.ready, route: r.routeCheck?.pass ?? null, tris: r.resources?.triangles };
    });
    await page.close();
    return rec;
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error(`${problems.slice(0, 4).join(' | ') || ''} ${String(e?.message ?? e)}`.trim());
  }
};
let ok = false, detail = '', budgets = null;
try {
  const base = await loadConfig('');
  const allOn = await loadConfig('&skins=1&props=1');
  budgets = { base: base.tris, skinsAndProps: allOn.tris };
  ok = base.ready && base.route === true && base.tris === 698704
    && allOn.ready && allOn.route === true && allOn.tris === 712340;
  detail = `base ready=${base.ready} route=${base.route} tris=${base.tris}; all-on ready=${allOn.ready} route=${allOn.route} tris=${allOn.tris}`;
} catch (e) { detail = String(e?.message ?? e); }
await browser.close();
prev.kill();
if (budgets) await writeFile(resolve(root, OUT, 'lane-a-polish-dist-run.json'), JSON.stringify({
  gate: 'headless Chrome + SwiftShader over vite preview of dist-lane-a-polish',
  budgets, note: 'all-on is the separate skins+props single-flag configuration, recorded as its own number (it exceeds the 700k base ceiling and is NOT claimed under it)',
}, null, 2) + '\n');
console.log(`DIST_RUN_${ok ? 'OK' : 'FAIL'} ${detail}`);
process.exit(ok ? 0 : 1);
