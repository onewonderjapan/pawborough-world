// B4 — fangbang-temple-v3 WebGL evidence: all 8 delivered bridge cameras
// through the REAL page with ?ds=fangbang-temple-v3&skins=1 (dev server on
// 5304; 5302-5303 occupied per DESIGN_SPEC fallback). Copy-adapted from
// capture_fangbang_v2_web.mjs; the delivered script is untouched.
//
// Run:
//   EVIDENCE_PORTS='530[45]' EVIDENCE_DIR=../artifacts/westshops/web \
//     BASE_URL=http://127.0.0.1:5304 node scripts/capture_westshops_web.mjs
import { chromium } from '../node_modules/playwright/index.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5304';
const cams = JSON.parse(await readFile(resolve(ROOT, 'world/fangbang-temple-v3/cameras.json'), 'utf8'));
const VIEWS = cams.cameras.map((c) => c.id);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/fangbang.html?ds=fangbang-temple-v3&skins=1', { waitUntil: 'domcontentloaded' });
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
      // R1-04: view + pixel read in the SAME task (WebGL buffer not preserved across tasks)
      const frameStats = await page.evaluate(([view]) => {
        const btn = document.querySelector(`button[data-view="${view}"]`); if (btn) btn.click();
        const src = document.querySelector('#app canvas');
        if (!src) return { blank: true, std255: -1, dominantShare: 1, error: 'no canvas' };
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
      }, [view]);
      if (frameStats.blank) throw new Error(`BLANK frame: std=${frameStats.std255} dom=${frameStats.dominantShare}`);

      const before = await page.evaluate(() => window.__fangbangRecord());
      if (!before.cameraCheck?.pass) throw new Error(`cameraCheck failed for ${view}: ${JSON.stringify(before.cameraCheck)}`);
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 20000 });
      console.log(`ok  fangbangv3-${view}-pbr (dPos=${before.cameraCheck.dPos}, dFov=${before.cameraCheck.dFov})`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL fangbangv3-${view}: ${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL page load: ${e.message.split('\n')[0]}`);
} finally {
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'WESTSHOPS_WEB_PASS' : `WESTSHOPS_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
