// C2 helper — headless cruise of the two dist preview instances through the
// REAL pages: wait for the page's own telemetry global (which only appears
// after the full load + in-page geometry/route checks), require routeCheck
// pass, and blank-frame-guard the rendered canvas (std < 2/255 or dominant
// > 95% fails). Exit non-zero on any failure.
//
// Run: node tools/cruise_dist.mjs --base-a http://127.0.0.1:5306 --base-b http://127.0.0.1:5307
import { chromium } from '../node_modules/playwright/index.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const CRUISES = [
  { base: arg('--base-a', 'http://127.0.0.1:5306'), url: '/fangbang.html', record: '__fangbangRecord' },
  { base: arg('--base-b', 'http://127.0.0.1:5307'), url: '/temple-v2.html', record: '__templeV2Record' },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let failures = 0;
const results = [];
for (const c of CRUISES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(c.base + c.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((g) => typeof window[g] === 'function', c.record, { timeout: 600000 });
    const rec = await page.evaluate((g) => window[g](), c.record);
    if (!rec.ready) throw new Error('page not ready');
    const route = rec.routeCheck?.summary ?? rec.routeCheck ?? null;
    const routePass = rec.routeCheck ? rec.routeCheck.pass === true : null;
    // blank-frame guard in the SAME task as the render trigger (R1-04)
    const frame = await page.evaluate(() => {
      const btn = document.querySelector('button[data-view]');
      if (btn) btn.click();
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
      for (const v of lum) { const k = Math.round(v); counts[k] = (counts[k] ?? 0) + 1; }
      const dom = Math.max(...Object.values(counts)) / lum.length;
      return { blank: std < 2 || dom > 0.95, std255: +std.toFixed(2), dominantShare: +dom.toFixed(3) };
    });
    if (frame.blank) throw new Error(`BLANK frame std=${frame.std255} dom=${frame.dominantShare}`);
    if (routePass === false) throw new Error(`routeCheck failed: ${JSON.stringify(route)}`);
    console.log(`ok  cruise ${c.url}: tris=${rec.resources.triangles} route=${routePass ? 'pass' : 'n/a'} frame(std=${frame.std255})`);
    results.push({ url: c.base + c.url, pass: true, triangles: rec.resources.triangles, routePass, frame });
  } catch (e) {
    failures += 1;
    console.log(`FAIL cruise ${c.url}: ${e.message.split('\n')[0]}`);
    results.push({ url: c.base + c.url, pass: false, error: e.message.split('\n')[0] });
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify({ cruises: results }));
process.exit(failures === 0 ? 0 : 1);
