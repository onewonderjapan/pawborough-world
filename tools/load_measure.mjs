// world-ten-hour round 1 (PLAN task D) — load measurement for the playable
// page under a FIXED environment: same machine, headless Chrome + SwiftShader,
// fixed viewport and display config. Captures per-load:
//   - network: every response (url, status, wire bytes via CDP
//     encodedDataLength, fromCache), per-URL request counts → duplicate
//     fetches and revalidation cost
//   - timing: navigation → ready (page's own honest gate), navigation → first
//     valid frame with a PIXEL PROOF (distinct colors of the real canvas,
//     like the runtime baseline — no rAF-only claims)
//   - a fixed-pose screenshot for before/after visual comparison
// Cold = fresh browser context (empty cache); warm = second load in the same
// context. Dev-server numbers are RELATIVE (before/after under identical
// conditions), never absolute production claims.
//
// Run: node tools/load_measure.mjs --base http://127.0.0.1:5420 --tag before
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5420');
const tag = arg('tag', 'run');
const config = arg('config', 'default');           // default | allOn
const outDir = resolve(root, arg('out', `artifacts/world-ten-hour/round-001/load-measure/${tag}`));
await mkdir(outDir, { recursive: true });
const qs = config === 'allOn' ? '&skins=1&props=1' : '';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

async function measureLoad(page, label) {
  const responses = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', (e) => {
    responses.push({ url: e.response.url.slice(0, 200), status: e.response.status,
      mime: e.response.mimeType, fromDiskCache: e.response.fromDiskCache, requestId: e.requestId });
  });
  const sizes = new Map();
  cdp.on('Network.loadingFinished', (e) => sizes.set(e.requestId, e.encodedDataLength ?? 0));
  const failed = [];
  cdp.on('Network.loadingFailed', (e) => failed.push({ error: e.errorText, canceled: e.canceled }));

  const t0 = Date.now();
  await page.goto(`${base}/fangbang.html?ds=fangbang-temple-v7&entry=mainStreet${qs}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  const navStart = await page.evaluate(() => performance.timeOrigin);
  // the page's own ready gate (all assets applied) — stage text flips at ready
  await page.waitForFunction(() => {
    const r = window.__fangbangRecord?.();
    if (r?.ready) return true;
    return (document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败');
  }, null, { timeout: 600000, polling: 200 });
  const readyAt = Date.now();
  // first VALID frame: pixels of the real canvas, not a frame-count claim
  const proof = await page.evaluate(() => new Promise((res) => {
    window.__fangbangRenderSync();
    const c = document.querySelector('#app canvas');
    const s = document.createElement('canvas'); s.width = 64; s.height = 64;
    const g = s.getContext('2d');
    g.drawImage(c, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let k = 0; k < d.length; k += 4) colors.add(`${d[k] >> 4},${d[k + 1] >> 4},${d[k + 2] >> 4}`);
    res({ distinctColors: colors.size, canvasW: c.width, canvasH: c.height });
  }));
  const rec = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { tris: r.resources?.triangles ?? r.trianglesExpected, load: {
      allAssetsReadyMs: r.load?.allAssetsReadyMs ?? null, shaderCompileMs: r.load?.shaderCompileMs ?? null,
      sharedAssetSources: r.load?.sharedAssetSources ?? null },
      uniqueGeometries: r.resources?.uniqueGeometries ?? null,
      uniqueMaterials: r.resources?.uniqueMaterials ?? null,
      uniqueTextures: r.resources?.uniqueTextures ?? null,
      framebuffer: r.framebuffer };
  });
  await page.screenshot({ path: resolve(outDir, `pose-${label}.png`) });
  await cdp.detach();

  const perUrl = new Map();
  let wireBytes = 0, cacheBytes = 0, requests = 0;
  for (const r of responses) {
    const b = sizes.get(r.requestId) ?? 0;
    requests++;
    const cur = perUrl.get(r.url) ?? { count: 0, bytes: 0, statuses: [] };
    cur.count++; cur.bytes += r.fromDiskCache ? 0 : b; cur.statuses.push(r.status);
    perUrl.set(r.url, cur);
    if (r.fromDiskCache) cacheBytes += b; else wireBytes += b;
  }
  const dup = [...perUrl.entries()].filter(([, v]) => v.count > 1)
    .map(([u, v]) => ({ url: u.slice(-90), count: v.count, wireBytes: v.bytes, statuses: v.statuses }))
    .sort((a, b) => b.count - a.count);
  return {
    label, config, navStart, readyAt, navToReadyMs: readyAt - t0,
    firstValidFrame: proof, tris: rec.tris,
    uniqueGeometries: rec.uniqueGeometries, uniqueMaterials: rec.uniqueMaterials, uniqueTextures: rec.uniqueTextures,
    pageLoad: rec.load,
    requests, wireBytes, cacheBytes,
    uniqueUrls: perUrl.size,
    urls: Object.fromEntries([...perUrl.entries()].map(([u, v]) => [u, v])),
    duplicateFetches: dup,
    failed: failed.length,
    screenshot: `pose-${label}.png`,
  };
}

const report = { base, tag, config, startedAt: new Date().toISOString(), env: {
  browser: 'headless Chrome + SwiftShader (software)', viewport: '1280x900', note: 'vite dev server — RELATIVE before/after comparison only, no production/absolute claims',
}, loads: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  report.loads.push(await measureLoad(page, 'cold'));
  report.loads.push(await measureLoad(page, 'warm'));
  await ctx.close();
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(outDir, 'load-measure.json'), JSON.stringify(report, null, 1) + '\n');
  await browser.close();
}
for (const l of report.loads) {
  console.log(`${l.label}: navToReady=${l.navToReadyMs}ms wire=${(l.wireBytes / 1048576).toFixed(2)}MB cache=${(l.cacheBytes / 1048576).toFixed(2)}MB requests=${l.requests} unique=${l.uniqueUrls} dupUrls=${l.duplicateFetches.length} tris=${l.tris} colors=${l.firstValidFrame?.distinctColors}`);
  for (const d of l.duplicateFetches.slice(0, 12)) console.log(`   x${d.count} ${d.wireBytes}B ${d.url}`);
}
console.log(`LOAD MEASURE DONE -> ${outDir}`);
