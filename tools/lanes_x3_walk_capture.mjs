// X3 — lanes-v5 live verification + evidence capture.
// Boots fangbang.html?ds=fangbang-temple-v5 on a policy port, then:
//   1. reads the automatic mainStreet route check (regression, reused)
//   2. walks laneAExcursion / laneBExcursion with the real capsule through
//      window.__fangbangWalkRoute (in/out both lanes), plus closed-door and
//      seam probes
//   3. captures the 8 lane WebGL views through the page's own camera buttons
//   4. captures the 4 fixed-pose comparison shots on v5 and the SAME poses on
//      the v4 page (before), writing web/comparison/
// Blank-frame guarded in the same evaluate as the render trigger.
//
// Run: node tools/lanes_x3_walk_capture.mjs
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5350;

let proc = null, port = null, log = '';
for (const p of [PORT, 5351, 5354, 5355]) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`http://127.0.0.1:${p}/index.html`)).ok; } catch {}
  }
  if (up) { port = p; break; }
  try { proc.kill('SIGTERM'); } catch {}
}
if (!port) { console.error(`no free server port\n${log.slice(-1500)}`); process.exit(1); }
console.log(`dev server on 127.0.0.1:${port}`);
const shutdown = () => { try { proc.kill('SIGTERM'); } catch {} };
process.on('exit', shutdown);

const WEB = resolve(root, 'artifacts/lanes-construction/web');
const CMP = resolve(root, 'artifacts/lanes-construction/comparison');
await mkdir(WEB, { recursive: true });
await mkdir(CMP, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));

const BASE = `http://127.0.0.1:${port}`;
await page.goto(`${BASE}/fangbang.html?ds=fangbang-temple-v5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => typeof window.__fangbangRecord === 'function', null, { timeout: 240000 });
const rec = await page.evaluate(() => window.__fangbangRecord());
console.log(`v5 loaded: tris=${rec.resources?.triangles} expected=${rec.trianglesExpected?.total} routeCheck=${rec.routeCheck?.pass}`);

// ---- 2. lane walks ----------------------------------------------------------
const route = await (await fetch(`${BASE}/world/fangbang-temple-v5/route.json`)).json();
const walks = {};
walks.laneA = await page.evaluate((pts) => window.__fangbangWalkRoute(pts), route.laneAExcursion);
walks.laneAOut = await page.evaluate((pts) => window.__fangbangWalkRoute(pts), [...route.laneAExcursion].reverse());
walks.laneB = await page.evaluate((pts) => window.__fangbangWalkRoute(pts), route.laneBExcursion);
walks.laneBOut = await page.evaluate((pts) => window.__fangbangWalkRoute(pts), [...route.laneBExcursion].reverse());
// closed rear service door of lane A (west wall niche at s=4.9): walk from the
// lane centre into the door face — the solid bay must stop the capsule
walks.laneADoor = await page.evaluate((pts) => window.__fangbangWalkRoute(pts, { reachRadiusM: 0.4 }), [
  [43.6, 0, -19.0], [42.75, 0, -20.6],
]);
// side seam: walk across the module portal threshold (street -> module floor)
walks.laneASeam = await page.evaluate((pts) => window.__fangbangWalkRoute(pts, { reachRadiusM: 0.6 }), [
  [43.3, 0, -12.0], [43.55, 0, -16.0], [43.6, 0, -17.2], [43.7, 0, -19.5],
]);
const walkPass = (w) => w.legs.every((l) => l.reached) && !w.blocked && w.feetYMin >= -0.02;
const seamMax = Math.abs(walks.laneASeam.feetYMax - walks.laneASeam.feetYMin);
for (const [k, w] of Object.entries(walks)) console.log(`walk ${k}: ${walkPass(w) ? 'ok' : 'FAIL'} legs=${w.legs.length} feetY ${w.feetYMin}..${w.feetYMax}`);

// ---- 3. the 8 lane views ------------------------------------------------------
const laneViews = ['lane-a-street-look-in', 'lane-a-forward', 'lane-a-return', 'lane-a-detail',
  'lane-b-street-look-in', 'lane-b-forward', 'lane-b-return', 'lane-b-detail'];
const captureView = async (viewId, file) => {
  const guard = await page.evaluate((v) => {
    const btn = [...document.querySelectorAll('button[data-view]')].find((b) => b.dataset.view === v);
    if (!btn) return { missing: true };
    btn.click();
    const src = document.querySelector('#app canvas');
    if (!src) return { blank: true, std255: -1, dominantShare: 1 };
    const w = 160, h = 100;
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    const ctx = c2.getContext('2d');
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = [];
    for (let i = 0; i < w * h; i++) lum.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
    const counts = {};
    for (const vv of lum) { const k = Math.round(vv); counts[k] = (counts[k] ?? 0) + 1; }
    const dom = Math.max(...Object.values(counts)) / lum.length;
    return { blank: std < 2 || dom > 0.95, std255: +std.toFixed(2), dominantShare: +dom.toFixed(3) };
  }, viewId);
  await page.screenshot({ path: file });
  const ok = !guard.missing && !guard.blank;
  console.log(`${ok ? 'ok  ' : 'FAIL'} view ${viewId} std=${guard.std255 ?? '-'}`);
  return { view: viewId, ok, guard, file };
};
const viewReports = [];
for (const v of laneViews) viewReports.push(await captureView(v, resolve(WEB, `v5-${v}.png`)));

// ---- 4. the 4 fixed-pose comparison pairs ------------------------------------
const PAIRS = [
  { id: 'lane-a-mouth', pos: [41.6, 1.7, -6.2], target: [43.3, 1.2, -14.5] },
  { id: 'lane-b-mouth', pos: [60.2, 1.7, 9.6], target: [57.3, 1.2, 15.3] },
  { id: 'lane-a-return', pos: [43.6, 1.6, -23.2], target: [43.1, 1.4, -11.0] },
  { id: 'lane-b-return', pos: [53.7, 1.6, 22.0], target: [57.6, 1.4, 13.4] },
];
const v5Shots = {};
for (const pr of PAIRS) {
  await page.evaluate(({ pos, target }) => window.__fangbangView(pos, target, 'cmp'), pr);
  const f = resolve(CMP, `after-${pr.id}.png`);
  await page.screenshot({ path: f });
  v5Shots[pr.id] = f;
}
// same poses on the v4 page (before)
const page4 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page4.goto(`${BASE}/fangbang.html?ds=fangbang-temple-v4`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page4.waitForFunction(() => typeof window.__fangbangView === 'function', null, { timeout: 240000 });
const v4Shots = {};
for (const pr of PAIRS) {
  await page4.evaluate(({ pos, target }) => window.__fangbangView(pos, target, 'cmp'), pr);
  const f = resolve(CMP, `before-${pr.id}.png`);
  await page4.screenshot({ path: f });
  v4Shots[pr.id] = f;
}
console.log('comparison pairs captured:', Object.keys(v5Shots).length);

const recAfter = await page.evaluate(() => window.__fangbangRecord());
const report = {
  batch: 'pawborough-lanes-construction-night-20260920',
  stage: 'X3 v5 live verification + evidence capture',
  generatedAt: new Date().toISOString(),
  server: `http://127.0.0.1:${port} (vite dev, owned and stopped by this run)`,
  dataset: 'fangbang-temple-v5',
  mainStreetRouteCheck: { pass: rec.routeCheck?.pass ?? false, summary: rec.routeCheck?.summary ?? null },
  laneWalks: walks,
  laneWalkContract: {
        allLegsReached: Object.fromEntries(Object.entries(walks).map(([k, w]) => [k, walkPass(w)])),
    seamHeightDeltaM: +seamMax.toFixed(3),
    seamWithinContract: seamMax <= 0.02 + 0.35,
    noFall: Object.values(walks).every((w) => !w.blocked),
  },
  views: viewReports,
  comparisonPairs: Object.keys(PAIRS).length,
  resources: recAfter.resources,
  pass: viewReports.every((v) => v.ok) && Object.values(walks).every(walkPass) && (rec.routeCheck?.pass ?? false),
};
await writeFile(resolve(root, 'artifacts/lanes-construction/x3-live-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`X3 pass=${report.pass} seam=${report.laneWalkContract.seamHeightDeltaM}m`);
await browser.close();
shutdown();
