// Full browser gate (adoption batch, verification-chain fix): EVERY page
// surface this batch touches, through a preview server built from THIS
// workspace's dist/ plus a dev server for dev-only pages, with the two-state
// compressed contract and a HARD routeCheck requirement:
//
//   v4 + skins + props   (default-compressed, then ?compressed=0)
//   v3 dataset           (both states)
//   temple-v2            (original-state dataset — probe must keep it original)
//   temple-v3 (dev page) (both states)
//
// Every scenario FAILS unless the page's own record carries
// routeCheck.pass === true (no routeCheck -> failure, never a silent pass).
// Build attribution: before any page loads, the tool hashes the preview
// server's review-manifest.json for the v4 dataset and requires byte
// equality with dist/ on disk — a stale foreign server fails the gate.
//
// Run: node tools/full_browser_gate.mjs [--dev-port 5320] [--preview-port 5321]
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const DEV = `http://127.0.0.1:${arg('--dev-port', 5320)}`;
const PREVIEW = `http://127.0.0.1:${arg('--preview-port', 5321)}`;
const sha = (b) => createHash('sha256').update(b).digest('hex');

const startServer = (args) => {
  const p = spawn(process.execPath, ['node_modules/.bin/vite', ...args],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
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

// --- build attribution: the preview server must serve THIS build --------------
{
  const served = Buffer.from(await (await fetch(`${PREVIEW}/world/fangbang-temple-v4/review-manifest.json`)).arrayBuffer());
  const disk = await readFile(resolve(root, 'dist/world/fangbang-temple-v4/review-manifest.json'));
  const ok = served.equals(disk);
  console.log(`${ok ? 'ok  ' : 'FAIL'} build-attribution: preview serves THIS dist (sha ${sha(served).slice(0, 12)}…)`);
  if (!ok) { shutdown(); process.exit(1); }
}

const SCENARIOS = [
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1`, record: '__fangbangRecord', expect: 'cm', ds: 'fangbang-temple-v4' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1&compressed=0`, record: '__fangbangRecord', expect: 'original', ds: 'fangbang-temple-v4' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v3`, record: '__fangbangRecord', expect: 'cm', ds: 'fangbang-temple-v3' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v3&compressed=0`, record: '__fangbangRecord', expect: 'original', ds: 'fangbang-temple-v3' },
  { base: PREVIEW, url: `/temple-v2.html`, record: '__templeV2Record', expect: 'original', ds: 'temple-axis-v2' },
  { base: DEV, url: `/temple-v3.html`, record: '__templeV3Record', expect: 'original', ds: 'temple-axis-v3' },
  { base: DEV, url: `/temple-v3.html?compressed=0`, record: '__templeV3Record', expect: 'original', ds: 'temple-axis-v3' },
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
    // HARD requirement: the page's own route check ran and passed
    const rc = rec.routeCheck;
    const rcPass = !!rc && rc.pass === true;
    if (!rcPass) throw new Error(`routeCheck missing or failed: ${JSON.stringify(rc?.summary ?? rc?.error ?? rc).slice(0, 200)}`);
    // two-state fetch reconciliation
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    const worldGlbs = urls.filter((u) => /\/world\/.*\.glb(\?|$)/.test(u) || /\/building\/.*\.glb(\?|$)/.test(u));
    const cm = worldGlbs.filter((u) => /\.cm\.glb(\?|$)/.test(u));
    const plain = worldGlbs.filter((u) => !/\.cm\.glb(\?|$)/.test(u));
    const manifestName = s.expect === 'cm' ? 'review-manifest.cm.json' : 'review-manifest.json';
    const refs = new Set();
    // v4 pages pull skins (street-sidefaces) and props (street-props) from
    // their OWN datasets — their manifests join the allowed set. sidefaces
    // has a cm manifest; props has none, so its plain fetches are legitimate
    // in BOTH states (the shim's per-URL fallback).
    const refSources = [`world/${s.ds}/${manifestName}`, `world/${s.ds}/blocks.json`,
      `world/street-sidefaces/${manifestName}`, 'world/street-props/review-manifest.json'];
    for (const f of refSources) {
      try {
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
      } catch { /* optional file */ }
    }
    // reconcile with BOTH sides normalized to the plain .glb name: a fetch
    // entry may be the successful .cm.glb OR the shim's 404->fallback attempt
    // (both are legitimate outcomes for keptOriginal datasets like props)
    const toPlain = (u) => decodeURIComponent(u).replace(/\.cm\.glb(\?|$)/, '.glb');
    const refPlain = new Set([...refs].map((p) => p.replace('./', '/').replace(/\.cm\.glb$/, '.glb')));
    const checked = s.expect === 'cm' ? [...plain, ...cm] : plain;
    const bad = checked.filter((u) => {
      const p = toPlain(u);
      return ![...refPlain].some((r) => p.endsWith(r));
    });
    const stateOk = s.expect === 'cm'
      ? cm.length >= 5
      : plain.length >= 5 && cm.length === 0;
    const ok = stateOk && bad.length === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: expect=${s.expect} cm=${cm.length} plain=${plain.length}${bad.length ? ` bad=${bad.length} e.g. ${bad.slice(0, 4).map((u) => u.slice(-60)).join(' | ')}` : ''} routeCheck=pass tris=${rec.resources?.triangles ?? '?'}`);
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
console.log(failures === 0 ? 'BROWSER_GATE_PASS' : `BROWSER_GATE_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
