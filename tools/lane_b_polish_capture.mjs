// Lane-B polish WebGL evidence — same-camera before/after pairs on the REAL
// player page (fangbang.html), plus the two-configuration triangle budget
// measured at runtime (base default, and skins+props all-on).
//
//   before = ?ds=fangbang-temple-v6   (delivered candidate; B verbatim from v5)
//   after  = ?ds=fangbang-temple-v7   (this batch's candidate)
//
// Four fixed poses applied identically through the page's own __fangbangView
// hook (street mouth, threshold/apron wall foot, east window+door closeup,
// look-back from the pocket) + one after-only oblique that reads window/door
// recess depth. 1280x720 viewport, dpr 1, page default lighting, headless
// Chrome + SwiftShader (repo Playwright). The entry card is dismissed through
// the page's own 取景 button (real UI click); blank/grey frames fail the
// non-empty check.
//
// Output: artifacts/lane-b-polish/{before,after,after-allskins}/*.png + web-capture.json
// Run: node tools/lane_b_polish_capture.mjs [--phase before|after|both]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/lane-b-polish');
const phase = process.argv.includes('--phase') ? process.argv[process.argv.indexOf('--phase') + 1] : 'both';
const runBefore = phase === 'before' || phase === 'both';
const runAfter = phase === 'after' || phase === 'both';

// lane-B local frame: yaw -0.4818 about +Y, holder T=[57.418,0.09,14.2485].
// world = T + (cos·lx + sin·ls, y, -sin·lx + cos·ls)
const lw = (lx, y, ls) => {
  const c = Math.cos(-0.4818), s = Math.sin(-0.4818);
  return [57.418 + c * lx + s * ls, y, 14.2485 - s * lx + c * ls];
};
// camera pose contract: page default fov 45; identical for both datasets.
const POSES = [
  { id: 'street-mouth', pos: lw(-0.55, 1.62, -2.90), target: [57.44, 1.15, 14.19] },
  { id: 'threshold-foot', pos: lw(0.15, 0.45, -1.15), target: [57.43, 0.12, 14.15] },
  { id: 'window-door', pos: lw(0.10, 1.90, 4.10), target: lw(1.74, 2.30, 4.70) },
  { id: 'pocket-lookback', pos: lw(-0.30, 1.60, 8.60), target: [57.6, 1.20, 13.2] },
  { id: 'window-oblique', pos: lw(0.05, 1.80, 3.55), target: lw(1.72, 1.95, 5.35), afterOnly: true },
];

const report = {
  tool: 'tools/lane_b_polish_capture.mjs',
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

async function shoot(dataset, dir, query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/fangbang.html?ds=${dataset}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__fangbangRecord === 'function' && window.__fangbangRecord().ready, null, { timeout: 300000 });
  const rec = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { ready: r.ready, routeCheck: r.routeCheck?.pass ?? null, triangles: r.resources?.triangles,
      framebuffer: r.framebuffer, dataset: r.dataset, version: r.version, expected: r.trianglesExpected };
  });
  await page.click('#btn-framing');
  await page.waitForTimeout(200);
  const uiClean = await page.evaluate(() => document.querySelector('#intro').style.display === 'none');
  await mkdir(resolve(OUT, dir), { recursive: true });
  const shots = [];
  for (const p of POSES) {
    if (dir === 'before' && p.afterOnly) continue;
    await page.evaluate((pp) => window.__fangbangView(pp.pos, pp.target, `lane-b-polish/${pp.id}`), p);
    await page.waitForTimeout(140);
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
  if (runBefore) {
    const { rec, shots } = await shoot('fangbang-temple-v6', 'before');
    report.pairs.push({ dataset: 'fangbang-temple-v6', dir: 'before', routeCheck: rec.routeCheck,
      triangles: rec.triangles, framebuffer: rec.framebuffer, shots });
    note(rec.ready && rec.routeCheck === true, 'v6 before: page ready + route check', `tris=${rec.triangles} fb=${rec.framebuffer}`);
    note(rec.framebuffer?.[0] >= 1278 && rec.framebuffer?.[1] >= 600, 'v6 before: drawingBuffer >= 1280 wide', String(rec.framebuffer));
    // blank/grey frame check: every shot must have real pixel variance
    for (const f of shots) {
      const buf = await readFile(resolve(OUT, f));
      note(buf.byteLength > 30000, `v6 before frame non-trivial ${f}`, `${buf.byteLength}B`);
    }
  }
  if (runAfter) {
    const { rec, shots } = await shoot('fangbang-temple-v7', 'after');
    report.pairs.push({ dataset: 'fangbang-temple-v7', dir: 'after', routeCheck: rec.routeCheck,
      triangles: rec.triangles, framebuffer: rec.framebuffer, shots });
    note(rec.ready && rec.routeCheck === true, 'v7 after: page ready + route check', `tris=${rec.triangles} fb=${rec.framebuffer}`);
    note(rec.framebuffer?.[0] >= 1278 && rec.framebuffer?.[1] >= 600, 'v7 after: drawingBuffer >= 1280 wide', String(rec.framebuffer));
    for (const f of shots) {
      const buf = await readFile(resolve(OUT, f));
      note(buf.byteLength > 30000, `v7 after frame non-trivial ${f}`, `${buf.byteLength}B`);
    }
    const allOn = await shoot('fangbang-temple-v7', 'after-allskins', '&skins=1&props=1');
    report.budgets = {
      base: { dataset: 'fangbang-temple-v7', triangles: report.pairs.find((p) => p.dir === 'after').triangles },
      skinsAndProps: { dataset: 'fangbang-temple-v7?skins=1&props=1', triangles: allOn.rec.triangles },
    };
    note(allOn.rec.ready && allOn.rec.routeCheck === true, 'v7 skins+props config loads + route check', `tris=${allOn.rec.triangles}`);
    report.allOnShots = allOn.shots;
  }
} finally {
  await browser.close();
  proc.kill();
}

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'web-capture.json'), JSON.stringify(report, null, 2) + '\n');
console.log(failures === 0 ? 'CAPTURE_PASS' : `CAPTURE_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
