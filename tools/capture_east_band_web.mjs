// D5 evidence — capture ALL 10 temple-axis-v3 contract views from the REAL
// page through headless Chromium (swiftshader): click each view button,
// blank-frame-guard the canvas in the SAME evaluate as the render trigger
// (R1-04), then screenshot the composited page to PNG.
//
// Run: node tools/capture_east_band_web.mjs --base http://127.0.0.1:5306 --out artifacts/east-band/web
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://127.0.0.1:5306');
const out = resolve(root, arg('--out', 'artifacts/east-band/web'));

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + '/fangbang.html?ds=fangbang-temple-v4', { waitUntil: 'domcontentloaded' });
await page.waitForFunction((g) => typeof window[g] === 'function', '__fangbangRecord', { timeout: 300000 });
const viewIds = await page.evaluate(() =>
  [...document.querySelectorAll('button[data-view]')].map((b) => b.dataset.view));

await mkdir(out, { recursive: true });
const report = [];
let fails = 0;
for (const id of viewIds) {
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
    for (let i = 0; i < w * h; i++)
      lum.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
    const counts = {};
    for (const vv of lum) { const k = Math.round(vv); counts[k] = (counts[k] ?? 0) + 1; }
    const dom = Math.max(...Object.values(counts)) / lum.length;
    return { blank: std < 2 || dom > 0.95, std255: +std.toFixed(2), dominantShare: +dom.toFixed(3) };
  }, id);
  const file = resolve(out, `eastband-web--${id.replace(/:/g, '__')}.png`);
  const shot = await page.screenshot({ path: file });
  const ok = !guard.missing && !guard.blank;
  if (!ok) fails += 1;
  report.push({ view: id, ok, guard, file, bytes: shot.byteLength });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} std=${guard.std255 ?? '-'} dom=${guard.dominantShare ?? '-'}`);
}
await writeFile(resolve(out, 'capture-report.json'), JSON.stringify({
  base, views: report, pass: fails === 0, generatedBy: 'tools/capture_east_band_web.mjs',
}, null, 2) + '\n');
await browser.close();
console.log(`CAPTURE_DONE views=${viewIds.length} fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);
