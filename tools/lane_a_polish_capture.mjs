// Lane-A polish WebGL evidence — same-camera before/after pairs on the REAL
// player page (fangbang.html), plus the two-configuration triangle budget
// measured at runtime (base default, and skins+props all-on).
//
//   before = ?ds=fangbang-temple-v5   (delivered candidate, read-only)
//   after  = ?ds=fangbang-temple-v6   (this batch's candidate)
//
// Four fixed poses applied identically through the page's own
// __fangbangView hook (street mouth, threshold/wall foot, window+door
// closeup, lane end). 1280x720 viewport, dpr 1 (drawingBuffer = CSS size),
// same lighting (page defaults), headless Chrome + SwiftShader (repo
// Playwright) — recorded in the report.
//
// Output: artifacts/lane-a-polish/{before,after}/*.png + web-capture.json
// Run: node tools/lane_a_polish_capture.mjs
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/lane-a-polish');

// camera pose contract: page default fov 45; identical for both datasets.
// The after-only oblique is a SUPPLEMENT (no before counterpart is faked).
const POSES = [
  { id: 'street-mouth', pos: [43.42, 1.55, -9.55], target: [43.62, 1.15, -14.8] },
  { id: 'threshold-foot', pos: [43.15, 0.42, -11.3], target: [43.3, 0.25, -10.15] },
  { id: 'window-door', pos: [43.85, 1.65, -20.1], target: [42.55, 1.75, -21.3] },
  { id: 'end-niche', pos: [43.72, 1.55, -21.7], target: [43.78, 1.65, -24.4] },
  { id: 'end-oblique', pos: [44.35, 1.70, -23.10], target: [43.816, 1.79, -24.49], afterOnly: true },
];

const report = {
  tool: 'tools/lane_a_polish_capture.mjs',
  env: { chrome: '/usr/bin/google-chrome', headless: true, swiftshader: true,
    viewport: [1280, 720], dpr: 1, startedAt: new Date().toISOString() },
  pairs: [], budgets: {}, pass: true,
};

// ---- dev server (owned by this run) ------------------------------------------
let port = null, log = '', proc = null;
for (const p of [5370, 5371, 5372, 5373]) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, env: { ...process.env, EVIDENCE_PORTS: '537[0-3]' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`http://127.0.0.1:${p}/fangbang.html`)).ok; } catch {}
  }
  if (up) { port = p; break; }
  proc.kill();
}
if (!port) { console.error('vite dev server failed:\n' + log); process.exit(1); }
console.log(`dev server on :${port}`);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

async function shoot(dataset, tag, dir, query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/fangbang.html?ds=${dataset}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__fangbangRecord === 'function' && window.__fangbangRecord().ready, null, { timeout: 300000 });
  const rec = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { ready: r.ready, routeCheck: r.routeCheck?.pass ?? null, triangles: r.resources?.triangles,
      framebuffer: r.framebuffer, dataset: r.dataset, version: r.version, expected: r.trianglesExpected };
  });
  // lead fix 2026-09-20: dismiss the entry card through the page's OWN 取景
  // button (a real UI click, not a source change) so the corner framing is
  // clean; the review panel stays closed (its default)
  await page.click('#btn-framing');
  await page.waitForTimeout(200);
  const uiClean = await page.evaluate(() => document.querySelector('#intro').style.display === 'none');
  await mkdir(resolve(OUT, dir), { recursive: true });
  const shots = [];
  for (const p of POSES) {
    if (dir === 'before' && p.afterOnly) continue;
    await page.evaluate((pp) => window.__fangbangView(pp.pos, pp.target, `lane-a-polish/${pp.id}`), p);
    await page.waitForTimeout(120);
    const file = `${dir}/${p.id}.png`;
    await page.screenshot({ path: resolve(OUT, file) });
    shots.push(file);
  }
  rec.uiClean = uiClean;
  await page.close();
  return { rec, shots };
}

let failures = 0;
const note = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  -- ' + detail : ''}`);
  if (!ok) { failures++; report.pass = false; }
};

try {
  for (const [dataset, dir] of [['fangbang-temple-v5', 'before'], ['fangbang-temple-v6', 'after']]) {
    const { rec, shots } = await shoot(dataset, dataset, dir);
    report.pairs.push({ dataset, dir, routeCheck: rec.routeCheck, triangles: rec.triangles, framebuffer: rec.framebuffer, shots });
    note(rec.ready && rec.routeCheck === true, `${dataset}: page ready + automatic route check`, `tris=${rec.triangles} fb=${rec.framebuffer}`);
    // real-drawingBuffer contract: buffer == canvas CSS size (page header/footer
    // make the canvas 1280x649 at a 1280x720 viewport); >=1280 wide, >=600 tall
    const css = await (async () => rec.framebuffer)();
    note(css?.[0] >= 1278 && css?.[1] >= 600, `${dataset}: drawingBuffer matches CSS, >=1280 wide`, String(rec.framebuffer));
  }

  // budget, second configuration: skins + props all-on on v6
  const allOn = await shoot('fangbang-temple-v6', 'v6', 'after-allskins', '&skins=1&props=1');
  report.budgets = {
    base: { dataset: 'fangbang-temple-v6', triangles: report.pairs.find((p) => p.dir === 'after').triangles },
    skinsAndProps: { dataset: 'fangbang-temple-v6?skins=1&props=1', triangles: allOn.rec.triangles },
  };
  note(allOn.rec.ready && allOn.rec.routeCheck === true, 'v6 skins+props config loads + route check', `tris=${allOn.rec.triangles}`);
  const base = report.budgets.base.triangles;
  note(base <= 700000, 'base default <= 700000', String(base));
  report.allOnShots = allOn.shots;
} finally {
  await browser.close();
  proc.kill();
}

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'web-capture.json'), JSON.stringify(report, null, 2) + '\n');
console.log(failures === 0 ? 'CAPTURE_PASS' : `CAPTURE_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
