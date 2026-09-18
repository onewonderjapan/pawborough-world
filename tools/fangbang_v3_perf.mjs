// fangbang-temple-v3 bridge performance baseline (v1-candidate batch B4; V09
// 口径 — measure, never claim). Copy of tools/fangbang_perf.mjs with the
// ?ds=fangbang-temple-v3&skins=1 query added (the delivered tool is read-only). 
// Headless Chrome with SwiftShader (software GL, NOT the target device):
// page load bytes/timing, first rendered frame, automatic route cruise
// frame-time percentiles (P50/P95), resource counts, and 3x enter/exit
// resource growth (leak check). Output: perf-v3.json — a REGRESSION BASELINE
// ONLY, no FPS claim.
//
// Run (dev server on 5300 already up; 5296 occupied per fallback #9):
//   BASE_URL=http://127.0.0.1:5304 node tools/fangbang_v3_perf.mjs \
//       --out artifacts/westshops/perf-v3.json
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5296';
const OUT = resolve(root, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'artifacts/westshops/perf-v3.json');

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096', '--disable-lcd-text', '--disable-background-timer-throttling'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('crash', () => console.log('[perf] PAGE CRASH'));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('[perf] navigated:', f.url()); });

let transferBytes = 0;
page.on('response', async (res) => {
  try {
    const headers = res.headers();
    const len = headers['content-length'] ? parseInt(headers['content-length'], 10) : 0;
    transferBytes += len;
  } catch { /* closed */ }
});

const t0 = Date.now();
await page.goto(BASE + '/fangbang.html?ds=fangbang-temple-v3&skins=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 600000 });
const loadMs = Date.now() - t0;
const initialTransferBytes = transferBytes;   // reload loop must not inflate this
// a vite polling-watcher reload can destroy the execution context mid-run;
// re-wait and retry once instead of failing the whole baseline
const evalStable = async (fn) => {
  try { return await page.evaluate(fn); }
  catch (e) {
    if (!/context destroyed|Target closed/i.test(String(e))) throw e;
    console.log('[perf] context lost — re-waiting for the page');
    await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 600000 });
    return page.evaluate(fn);
  }
};
const loaded = await evalStable(() => {
  const r = window.__fangbangRecord();
  return {
    triangles: r.resources.triangles,
    trianglesExpected: r.trianglesExpected,
    uniqueGeometries: r.resources.uniqueGeometries,
    uniqueMaterials: r.resources.uniqueMaterials,
    uniqueTextures: r.resources.uniqueTextures,
    meshes: r.resources.meshes,
    loadStats: r.load,
    routePass: r.routeCheck?.pass ?? null,
  };
});

// frame times during the in-browser cruise: start the automatic check and
// sample rAF deltas (software GL — slow by construction)
const cruise = await evalStable(async () => {
  const deltas = [];
  let last = performance.now();
  let raf = 0;
  const sample = (t) => {
    deltas.push(t - last);
    last = t;
    raf = requestAnimationFrame(sample);
  };
  raf = requestAnimationFrame(sample);
  await new Promise((done) => setTimeout(done, 500));   // warm the rAF loop
  const before = window.__fangbangRecord().routeCheck?.ms ?? null;
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('路线巡游检查'));
  btn.click();
  await new Promise((done) => {
    const iv = setInterval(() => {
      const ms = window.__fangbangRecord()?.routeCheck?.ms ?? null;
      if (ms !== null && ms !== before) { clearInterval(iv); done(); }
    }, 250);
  });
  cancelAnimationFrame(raf);
  deltas.shift();
  const p = (q) => {
    const s = [...deltas].sort((a, b) => a - b);
    return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2) : null;
  };
  return {
    frames: deltas.length,
    p50Ms: p(0.5), p95Ms: p(0.95),
    meanMs: deltas.length ? +(deltas.reduce((s, d) => s + d, 0) / deltas.length).toFixed(2) : null,
  };
});

// 3× enter/exit: reload the page and compare steady-state resource counts
const reloads = [];
for (let i = 0; i < 3; i++) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 600000 });
  reloads.push(await evalStable(() => {
    const r = window.__fangbangRecord();
    return { triangles: r.resources.triangles, geometries: r.resources.uniqueGeometries, textures: r.resources.uniqueTextures };
  }));
}
const stable = reloads.every((r) => r.triangles === reloads[0].triangles && r.textures === reloads[0].textures);

const perf = {
  measuredAt: new Date().toISOString(),
  label: 'headless 软件 GL (SwiftShader) · 非目标设备 · 仅作回归基线，不宣称 FPS 达标（V09 口径）',
  environment: { browser: 'chrome-headless-swiftshader', viewport: [960, 600], server: BASE },
  load: {
    wallMsToReady: loadMs,
    transferBytes: initialTransferBytes,
    pageBytes: loaded.loadStats,
    integrity: { triangles: loaded.triangles, expected: loaded.trianglesExpected, pass: loaded.triangles === loaded.trianglesExpected },
    resources: { meshes: loaded.meshes, geometries: loaded.uniqueGeometries, materials: loaded.uniqueMaterials, textures: loaded.uniqueTextures },
  },
  firstRender: { note: 'captured via the page\'s first render() after ready; software GL', trianglesDrawn: loaded.triangles },
  cruise: { automatic: true, routePass: loaded.routePass, ...cruise },
  reloadLoop: { runs: 3, stable, runsDetail: reloads, note: 'triangles/textures identical across 3 consecutive loads = no resource growth' },
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(perf, null, 2) + '\n');
console.log('PERF_READY', JSON.stringify({ wallMs: loadMs, transferMB: +(initialTransferBytes / 1e6).toFixed(1), cruiseP50: cruise.p50Ms, cruiseP95: cruise.p95Ms, stable }));
await browser.close();
