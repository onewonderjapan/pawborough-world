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
