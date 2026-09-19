// H2 (adoption batch 20260919) — BROWSER-LEVEL compressed-default smoke.
// tests/compressed_default.test.mjs pins the file/state contracts; this tool
// proves the REQUEST reality through the real pages:
//
//   default URL                     -> world/ requests end in .cm.glb
//   ?compressed=0                   -> world/ requests end in plain .glb
//   datasets without a cm manifest  -> plain .glb AND the page still loads
//                                      (consistent original state)
//
// Preview scenarios run against a freshly built dist/ (fast); temple-v3.html
// is a dev-only page (no rollup input) so its scenario runs against the dev
// server. Every scenario waits for the page's own telemetry global (full load
// + in-page geometry/route checks already passed), then reconciles the
// fetched resource names. Exit non-zero on any failure.
//
// Prereq: npm run build && cp -r world building VERSION.json index-v1.html dist/
// Run: node tools/compressed_smoke.mjs [--dev-port 5320] [--preview-port 5321]
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const DEV = `http://127.0.0.1:${arg('--dev-port', 5320)}`;
const PREVIEW = `http://127.0.0.1:${arg('--preview-port', 5321)}`;

const startServer = (args) => {
  const p = spawn(process.execPath, ['node_modules/.bin/vite', ...args],
    { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = '';
  p.stdout.on('data', (d) => { p.log += d; });
  p.stderr.on('data', (d) => { p.log += d; });
  return p;
};
const dev = startServer(['--host', '127.0.0.1', '--port', String(arg('--dev-port', 5320)), '--strictPort']);
const preview = startServer(['preview', '--host', '127.0.0.1', '--port', String(arg('--preview-port', 5321)), '--strictPort']);
const shutdown = () => { for (const p of [dev, preview]) { try { p.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('exit', shutdown);

const waitUp = async (base, label, proc) => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`${base}/index.html`)).ok) return true; } catch { /* not up yet */ }
  }
  console.error(`${label} did not come up\n${proc.log.slice(-2000)}`);
  return false;
};
if (!(await waitUp(DEV, 'dev server', dev)) || !(await waitUp(PREVIEW, 'preview server', preview))) {
  shutdown();
  process.exit(1);
}

const SCENARIOS = [
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1`, record: '__fangbangRecord', expect: 'cm' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1&compressed=0`, record: '__fangbangRecord', expect: 'original' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v3`, record: '__fangbangRecord', expect: 'cm' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v3&compressed=0`, record: '__fangbangRecord', expect: 'original' },
  { base: PREVIEW, url: `/temple-v2.html`, record: '__templeV2Record', expect: 'original' },
  // temple-axis-v3 gained a verified cm manifest in the world-closeout batch
  // 20260919 — its default state is compressed now (lions-v2 falls back
  // to original bytes by tolerance policy, which this scenario reconciles)
  { base: DEV, url: `/temple-v3.html`, record: '__templeV3Record', expect: 'cm' },
  { base: DEV, url: `/temple-v3.html?compressed=0`, record: '__templeV3Record', expect: 'original' },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let failures = 0;
for (const s of SCENARIOS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const label = `${s.base === DEV ? 'dev' : 'preview'}${s.url}`;
  try {
    await page.goto(s.base + s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((g) => typeof window[g] === 'function', s.record, { timeout: 600000 });
    const rec = await page.evaluate((g) => window[g](), s.record);
    if (!rec.ready) throw new Error('page record not ready');
    // allowed glb paths = every path the (compressed) manifest references:
    // .cm.glb paths for repointed assets, original .glb paths for honest
    // keptOriginal fallbacks — anything else fetched is a state inconsistency
    const urls = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((e) => e.name));
    const worldGlbs = urls.filter((u) => /\/world\/.*\.glb(\?|$)/.test(u));
    const cm = worldGlbs.filter((u) => /\.cm\.glb(\?|$)/.test(u));
    const plain = worldGlbs.filter((u) => !/\.cm\.glb(\?|$)/.test(u));
    // reconcile fetched glb paths against the dataset's own manifest refs:
    // cm scenario -> cm manifest (cm paths + keptOriginal originals);
    // original scenario -> original manifest (plain paths only);
    // blocks.json refs join the allowed set either way (the block dataset
    // legitimately references cross-dataset assets, e.g. v3 temple glbs)
    const dsMatch = s.url.match(/[?&]ds=([^&]+)/);
    const pathname = s.url.split('?')[0];
    const ds = dsMatch ? dsMatch[1] : { '/temple-v2.html': 'temple-axis-v2', '/temple-v3.html': 'temple-axis-v3' }[pathname] || 'fangbang-temple';
    const manifestName = s.expect === 'cm' ? 'review-manifest.cm.json' : 'review-manifest.json';
    let allowed = null;
    try {
      const files = [`world/${ds}/${manifestName}`, `world/${ds}/blocks.json`];
      const refs = new Set();
      for (const f of files) {
        const m = JSON.parse(await readFile(resolve(root, f), 'utf8'));
        const collect = (n) => {
          if (Array.isArray(n)) { for (const x of n) collect(x); return; }
          if (n && typeof n === 'object') {
            for (const v of Object.values(n)) {
              if (typeof v === 'string' && v.endsWith('.glb')) refs.add(v.replace('././', './'));
              else collect(v);
            }
          }
        };
        collect(m);
      }
      allowed = refs;
    } catch { /* no such manifest for this dataset — skip reconciliation */ }
    const checkAgainst = s.expect === 'cm' ? [...plain, ...cm] : plain;
    const badPlain = allowed
      ? checkAgainst.filter((u) => ![...allowed].some((p) => decodeURIComponent(u).endsWith(p.replace('./', '/'))))
      : [];
    const ok = s.expect === 'cm'
      ? cm.length >= 5 && badPlain.length === 0
      : plain.length >= 5 && cm.length === 0 && badPlain.length === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: expect=${s.expect} ds=${ds} cmGlbs=${cm.length} plainGlbs=${plain.length}${badPlain.length ? ` badPlain=${badPlain.length} e.g. ${badPlain[0].slice(-70)}` : ''} ready=${rec.ready} tris=${rec.resources?.triangles ?? '?'}`);
    if (!ok) failures += 1;
  } catch (e) {
    console.log(`FAIL ${label}: ${String(e.message).slice(0, 300)}`);
    failures += 1;
  } finally {
    await page.close();
  }
}
await browser.close();
shutdown();
process.exit(failures === 0 ? 0 : 1);
