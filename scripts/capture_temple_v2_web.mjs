// Temple AXIS V2 WebGL evidence: the 10 lead cameras through the REAL page
// (vite dev server on 5298) + playwright + chrome — copy-adapted from
// capture_dadian_web.mjs. Every shot goes through the page's own 保存实测图
// button, shipping the client telemetry (pose verification, resources, route
// cruise). Asserts from the page record:
//   - the manifest triangle integrity check ran (loaded == manifest + doubled
//     peidian/gallery instances)
//   - every captured view's cameraCheck.pass is true
//   - the automated route cruise passed (gates + peidian loop + platform
//     attempt + east passage + court3 + houdian + return + 7 negatives + fall)
// Clay pairs for court2-pair and court3-axis.
//
// Run (dev server already up on 5298):
//   EVIDENCE_PORTS='529[89]' EVIDENCE_DIR=kit/out/temple-axis-v2/web \
//     node scripts/capture_temple_v2_web.mjs
import { chromium } from '../node_modules/playwright/index.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5298';

const SHOTS = [
  { view: 'court2-pair', clay: false },
  { view: 'court2-pair', clay: true },
  { view: 'peidian-west-front', clay: false },
  { view: 'gallery-link', clay: false },
  { view: 'stage-from-court', clay: false },
  { view: 'stage-3q', clay: false },
  { view: 'passage-east', clay: false },
  { view: 'court3-axis', clay: false },
  { view: 'court3-axis', clay: true },
  { view: 'houdian-front', clay: false },
  { view: 'houdian-3q', clay: false },
  { view: 'axis-aerial', clay: false },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/temple-v2.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已载入'), null, { timeout: 180000 });
  const rec = await page.evaluate(() => window.__templeV2Record());
  if (!rec.ready || !rec.routeCheck?.pass) {
    console.log(`FAIL page telemetry: ready=${rec.ready} route=${JSON.stringify(rec.routeCheck)}`);
    failures += 1;
  } else {
    console.log(`ok  page loaded: ${rec.resources.triangles} tris, route ${rec.routeCheck.summary}`);
  }
  for (const s of SHOTS) {
    try {
      await page.click(`button[data-view="${s.view}"]`);
      if (s.clay) await page.locator('button', { hasText: '灰模' }).click();
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => window.__templeV2Record());
      if (!before.cameraCheck?.pass) throw new Error(`cameraCheck failed for ${s.view}: ${JSON.stringify(before.cameraCheck)}`);
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
      if (s.clay) await page.locator('button', { hasText: '灰模' }).click(); // restore
      console.log(`ok  temlev2-${s.view}${s.clay ? ' clay' : ' pbr'} (dPos=${before.cameraCheck.dPos}, dFov=${before.cameraCheck.dFov})`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL temple-v2-${s.view}${s.clay ? ' clay' : ''}: ${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL page load: ${e.message.split('\n')[0]}`);
} finally {
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'TEMPLE_V2_WEB_PASS' : `TEMPLE_V2_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
