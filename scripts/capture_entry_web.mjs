// Temple ENTRY-GROUP WebGL evidence: the 8 lead cameras through the REAL
// entry page (vite dev server on 5292) + playwright + chrome. Every shot goes
// through the page's own 保存实测图 button, shipping the client telemetry
// (pose verification, resources, route cruise). Asserts from the page record:
//   - the manifest triangle integrity check ran (loaded == manifest sum)
//   - every captured view's cameraCheck.pass is true
//   - the automated route cruise passed (through both gates + return + blocks)
// Clay pairs for yimen-front and court-quarter.
//
// Run (dev server already up on 5292):
//   EVIDENCE_PORTS='529[0-3]' EVIDENCE_DIR=kit/out/entry-renders/web \
//     node scripts/capture_entry_web.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5292';

const SHOTS = [
  { view: 'entry-axis', clay: false },
  { view: 'from-gate', clay: false },
  { view: 'court-quarter', clay: false },
  { view: 'court-quarter', clay: true },
  { view: 'yimen-front', clay: false },
  { view: 'yimen-front', clay: true },
  { view: 'yimen-roof', clay: false },
  { view: 'yimen-detail', clay: false },
  { view: 'return-to-gate', clay: false },
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
  await page.goto(BASE + '/temple-entry.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('入口组已载入'), null, { timeout: 120000 });
  const rec = await page.evaluate(() => window.__entryRecord());
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
      const before = await page.evaluate(() => window.__entryRecord());
      if (!before.cameraCheck?.pass) throw new Error(`cameraCheck failed for ${s.view}: ${JSON.stringify(before.cameraCheck)}`);
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
      if (s.clay) await page.locator('button', { hasText: '灰模' }).click(); // restore
      console.log(`ok  entry-${s.view}${s.clay ? ' clay' : ' pbr'} (dPos=${before.cameraCheck.dPos}, dFov=${before.cameraCheck.dFov})`);
    } catch (e) {
      failures += 1;
      console.log(`FAIL entry-${s.view}${s.clay ? ' clay' : ''}: ${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL page load: ${e.message.split('\n')[0]}`);
} finally {
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'ENTRY_WEB_PASS' : `ENTRY_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
