// Fangbang↔temple bridge WebGL evidence: the 8 lead cameras through the REAL
// page (dev server on 5296) + playwright + chrome (SwiftShader). Every shot
// goes through the page's own 保存实测图 button, shipping the client
// telemetry (pose verification, resources, the automatic route cruise).
// Name contract: fangbang-<view>-(pbr|clay) with the F3 -ph/-noph suffix.
//
// Run (dev server already up on 5296):
//   EVIDENCE_PORTS='529[67]' EVIDENCE_DIR=kit/out/fangbang-temple/web \
//     node scripts/capture_fangbang_web.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5296';
const VIEWS = [
  'junction-west', 'west-road-mid', 'placeholder-band', 'shanmen-from-road',
  'forecourt-oblique', 'axis-long', 'temple-side-east', 'aerial-overview',
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/fangbang.html', { waitUntil: 'domcontentloaded' });
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
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 20000 });
      console.log(`ok  fangbang-${view}-pbr (dPos=${before.cameraCheck.dPos}, dFov=${before.cameraCheck.dFov})`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL fangbang-${view}: ${e.message.split('\n')[0]}`);
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
