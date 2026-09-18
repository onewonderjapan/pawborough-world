// Fangbang↔temple BRIDGE V2 WebGL evidence (expansion batch N9): the three
// bridge views through the REAL page with ?ds=fangbang-temple-v2 (dev server
// on the fallback port 5300; 5296 occupied) + playwright + chrome
// (SwiftShader). Copy-adapted from capture_fangbang_web.mjs; the delivered
// script is untouched.
//
// Run:
//   EVIDENCE_PORTS='530[01]' EVIDENCE_DIR=kit/out/fangbang-temple-v2/web \
//     BASE_URL=http://127.0.0.1:5300 node scripts/capture_fangbang_v2_web.mjs
import { chromium } from '../node_modules/playwright/index.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5300';
const VIEWS = ['shanmen-from-road', 'axis-long', 'aerial-overview'];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/fangbang.html?ds=fangbang-temple-v2', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 600000 });
  const rec = await page.evaluate(() => window.__fangbangRecord());
  if (!rec.ready || !rec.routeCheck?.pass) {
    console.log(`FAIL page telemetry: ready=${rec.ready} route=${JSON.stringify(rec.routeCheck?.summary ?? rec.routeCheck)}`);
    failures += 1;
  } else {
    console.log(`ok  page loaded: ${rec.resources.triangles} tris, route ${rec.routeCheck.summary}`);
  }
  for (const view of VIEWS) {
    try {
      await page.click(`button[data-view="${view}"]`);
      await page.waitForTimeout(600);
      const before = await page.evaluate(() => window.__fangbangRecord());
      if (!before.cameraCheck?.pass) throw new Error(`cameraCheck failed for ${view}: ${JSON.stringify(before.cameraCheck)}`);
      const frameStats = await page.evaluate(() => {
        const src = document.querySelector('#app canvas');
        if (!src) return { blank: true, std255: 0, dominantShare: 1 };
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
      if (frameStats.blank) throw new Error(`BLANK frame: std=${frameStats.std255} dom=${frameStats.dominantShare}`);
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 20000 });
      console.log(`ok  fangbangv2-${view}-pbr (dPos=${before.cameraCheck.dPos}, dFov=${before.cameraCheck.dFov})`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL fangbangv2-${view}: ${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL page load: ${e.message.split('\n')[0]}`);
} finally {
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'FANGBANG_WEB_PASS' : `FANGBANG_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
