// Temple pilot WebGL evidence: 6 fixed cameras through the REAL pilot page
// (vite dev server on 5290) + playwright + chrome. Every shot goes through
// the page's own 保存实测图 button so each image ships with the client's own
// telemetry (camera pose + faithful-execution check, resources, passage
// results). The script additionally ASSERTS from the page record that:
//   - the page loaded the manifest triangle count exactly (integrity check ran)
//   - every captured view's cameraCheck.pass is true (position/target/fov
//     applied verbatim — catches the radians/polar-clamp class of regression)
//   - the automated doorway passage check passed (through + blocked + no
//     invisible plane)
// Clay pairs for front + quarter-left; doorway close-up included.
//
// Run (dev server already up on 5290):
//   node scripts/capture_temple_web.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5290';

const SHOTS = [
  { view: 'front', clay: false },
  { view: 'front', clay: true },
  { view: 'quarter-left', clay: false },
  { view: 'quarter-left', clay: true },
  { view: 'roof', clay: false },
  { view: 'doorway', clay: false },
  { view: 'street-eye', clay: false },
  { view: 'rear-inferred', clay: false },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/temple.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('样板已载入'), null, { timeout: 90000 });
  const rec = await page.evaluate(() => window.__templeRecord());
  if (!rec.ready || !rec.passageCheck?.pass) {
    console.log(`FAIL page telemetry: ready=${rec.ready} passage=${JSON.stringify(rec.passageCheck)}`);
    failures += 1;
  } else {
    console.log(`ok  page loaded: ${rec.resources.triangles} tris, passage ${rec.passageCheck.summary}`);
  }
  for (const s of SHOTS) {
    try {
      await page.click(`button[data-view="${s.view}"]`);
      if (s.clay) await page.locator('button', { hasText: '灰模' }).click();
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => window.__templeRecord());
      if (!before.cameraCheck?.pass) throw new Error(`cameraCheck failed for ${s.view}: ${JSON.stringify(before.cameraCheck)}`);
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
      if (s.clay) await page.locator('button', { hasText: '灰模' }).click(); // restore for next shot
      console.log(`ok  temple-${s.view}${s.clay ? ' clay' : ' pbr'} (dPos=${before.cameraCheck.dPos}, dFov=${before.cameraCheck.dFov})`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL temple-${s.view}${s.clay ? ' clay' : ''}: ${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL page load: ${e.message.split('\n')[0]}`);
} finally {
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'TEMPLE_WEB_PASS' : `TEMPLE_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
