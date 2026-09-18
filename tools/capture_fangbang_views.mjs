// E4 evidence — capture the fangbang page with ?props=1&skins=1 from given
// camera ids (button[data-view] clicks), blank-frame-guarded in the SAME
// evaluate as the render trigger (R1-04), screenshot to PNG.
//
// Run: node tools/capture_fangbang_views.mjs --base http://127.0.0.1:5310 \
//        --views junction-west,west-road-mid,eye-west,corner --out artifacts/street-props/web
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://127.0.0.1:5310');
const views = arg('--views', 'junction-west,west-road-mid,eye-west,corner').split(',');
const out = resolve(root, arg('--out', 'artifacts/street-props/web'));

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + '/fangbang.html?props=1&skins=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction((g) => typeof window[g] === 'function', '__fangbangRecord', { timeout: 300000 });
const available = await page.evaluate(() =>
  [...document.querySelectorAll('button[data-view]')].map((b) => b.dataset.view));
console.log('views available:', available.length);

await mkdir(out, { recursive: true });
const report = [];
let fails = 0;
for (const id of views) {
  const guard = await page.evaluate((v) => {
    const btn = [...document.querySelectorAll('button[data-view]')]
      .find((b) => b.dataset.view === v || b.dataset.view.endsWith(':' + v) || v.endsWith(b.dataset.view));
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
  const file = resolve(out, `props-web--${id.replace(/:/g, '__')}.png`);
  const shot = await page.screenshot({ path: file });
  const ok = !guard.missing && !guard.blank;
  if (!ok) fails += 1;
  report.push({ view: id, ok, guard: guard.missing ? 'missing-button' : guard, file, bytes: shot.byteLength });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} std=${guard.std255 ?? '-'} ${guard.missing ? 'BUTTON MISSING' : ''}`);
}
const rec = await page.evaluate((g) => window[g](), '__fangbangRecord');
await writeFile(resolve(out, 'capture-report.json'), JSON.stringify({
  base, url: base + '/fangbang.html?props=1&skins=1', views: report,
  propsStats: rec.propsStats ?? null, pass: fails === 0,
  generatedBy: 'tools/capture_fangbang_views.mjs',
}, null, 2) + '\n');
console.log(`CAPTURE_DONE views=${views.length} fails=${fails} propsLoaded=${rec.propsStats?.count ?? 0}`);
process.exit(fails === 0 ? 0 : 1);
