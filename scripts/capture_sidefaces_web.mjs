// Street-sidefaces WebGL evidence (package 2, M5): loads the bridge page with
// ?ds=fangbang-temple-v2&skins=1 (dev server on the fallback port 5300; 5296
// occupied), drives the page camera to each calibrated sideface camera pose
// via window.__fangbangView, and saves each shot through the page's own
// 保存实测图 button (client telemetry ships in the record; skins counted).
//
// Run:
//   EVIDENCE_PORTS='530[01]' EVIDENCE_DIR=kit/out/street-sidefaces/web \
//     BASE_URL=http://127.0.0.1:5300 node scripts/capture_sidefaces_web.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5300';
const cams = JSON.parse(await readFile(resolve(root, 'world/street-sidefaces/cameras.json'), 'utf8'));

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/fangbang.html?ds=fangbang-temple-v2&skins=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 240000 });
  const rec = await page.evaluate(() => window.__fangbangRecord());
  if (!rec.ready || !rec.routeCheck?.pass || rec.skins?.count !== 10) {
    console.log(`FAIL page telemetry: ready=${rec.ready} skins=${JSON.stringify(rec.skins)} route=${rec.routeCheck?.pass}`);
    failures += 1;
  } else {
    console.log(`ok  page loaded: ${rec.resources.triangles} tris incl. ${rec.skins.triangles} skin tris, route PASS`);
  }
  for (const c of cams.cameras) {
    try {
      await page.evaluate(([pos, target, label]) => window.__fangbangView(pos, target, label),
        [c.positionGlb, c.targetGlb, `sideface-${c.id}`]);
      await page.waitForTimeout(400);
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
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
      console.log(`ok  sideface-${c.id} (calibrated ${c.calibratedDistanceM}m)`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL sideface-${c.id}: ${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL page load: ${e.message.split('\n')[0]}`);
} finally {
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'SIDEFACES_WEB_PASS' : `SIDEFACES_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
