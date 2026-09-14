// R1/R3 fix-acceptance captures against the CLEAN BUILD preview (dist, not
// dev mode — lead review requires preview evidence). Every shot goes through
// the page's own 保存实测图 button, so each jpg carries the client's own
// record JSON: R3 honest byte/triangle fields, version fingerprint with the
// additional-asset hashes + on/off state, and blocks.activeIds.
//
// Run with the preview already up, e.g. on idle port 5385:
//   BASE_URL=http://127.0.0.1:5385 \
//   EVIDENCE_DIR=../artifacts/east-edge-fix-r1-r3-20260915/evidence/web \
//   node scripts/capture_fix_r1r3.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5284';

const SHOTS = [
  // east-edge candidate from the built dist: C0 + C1 + full view
  { url: '/?world=east-edge', w: 1280, h: 723, view: 'east-czero', clay: false, ph: true },
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-cone', clay: false, ph: true },
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'full-west', clay: false, ph: false },
  // assets=off on the SAME built dataset: gray boxes, candidate held back
  { url: '/?world=east-edge&assets=off', w: 1280, h: 723, view: 'east-czero', clay: false, ph: true },
  // base default dataset still loads from the same build
  { url: '/', w: 1280, h: 871, view: 'full-west', clay: false, ph: false },
  // laneb candidate still loads from the same build
  { url: '/?world=laneb', w: 1280, h: 871, view: 'lane-b-axis', clay: false, ph: false },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(BASE + s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('完整世界已载入'), null, { timeout: 60000 });
    if (s.ph) await page.check('#chk-placeholder');
    await page.click(`button[data-view="${s.view}"]`);
    if (s.clay) await page.locator('button', { hasText: '灰模' }).click();
    await page.waitForTimeout(600);
    await page.click('#btn-save, button:has-text("保存实测图")');
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    console.log(`ok  ${s.view}${s.clay ? ' clay' : ''} ${s.url}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${s.url}: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(failures === 0 ? 'FIX_R1R3_WEB_PASS' : `FIX_R1R3_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
