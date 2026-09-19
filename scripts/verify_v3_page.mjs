// B3 page verification, three modes through the REAL page on the preview
// server: ?ds=fangbang-temple-v3&skins=1 (full), ?ds=fangbang-temple-v3
// (no skins), and default (the delivered v2 bridge world — must be unchanged).
// Blank-frame guard on every mode (std < 2/255 or dominant > 95%).
//
// Run: BASE_URL=http://127.0.0.1:5304 node scripts/verify_v3_page.mjs
import { chromium } from '../node_modules/playwright/index.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5304';
const MODES = [
  { url: '/fangbang.html?ds=fangbang-temple-v3&skins=1', label: 'v3+skins' },
  { url: '/fangbang.html?ds=fangbang-temple-v3', label: 'v3' },
  { url: '/fangbang.html?ds=fangbang-temple-v3&revoke=block-west-shops', label: 'v3+revoke' },
  { url: '/fangbang.html', label: 'default' },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
for (const m of MODES) {
  try {
    await page.goto(BASE + m.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 600000 });
    const rec = await page.evaluate(() => window.__fangbangRecord());
    if (!rec.ready) throw new Error('page not ready');
    if (!rec.routeCheck?.pass) throw new Error(`routeCheck: ${JSON.stringify(rec.routeCheck?.summary ?? rec.routeCheck)}`);
    const frame = await page.evaluate(() => {
      const btn = document.querySelector(`button[data-view="${'shanmen-from-road'}"]`); if (btn) btn.click();
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
    const skins = rec.skins ? `skins=${rec.skins.count}/${rec.skins.uniqueGlbs}GLB tris=${rec.skins.placedTris}` : 'no-skins';
    console.log(`ok  ${m.label}: dataset=${rec.dataset} tris=${rec.resources.triangles}/${rec.trianglesExpected} ${skins} route=${rec.routeCheck.summary} frame(std=${frame.std255})`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${m.label}: ${e.message.split('\n')[0]}`);
  }
}
await page.close();
await browser.close();
console.log(failures === 0 ? 'V3_PAGE_PASS' : `V3_PAGE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
