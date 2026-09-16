// SC-F2 review-shot captures: one front/three-quarter view per refined shop
// (130-133), captured through the REAL review client so each image ships with
// its own telemetry record. The four sc-front-* cameras stand across the lane
// from each storefront; the requirement is sign + complete display window in
// frame (lead review SC-F2: the old along-the-lane pair shots cannot serve as
// trade-goods acceptance images). Refined-only presentation (noph): framing
// views hide gray-box placeholders by default.
//
// Run: EVIDENCE_DIR=../artifacts/street-completion-review-fixes-20260915/web \
//      node tools/sc_f2_front_capture.mjs [baseUrl]   (default the 5285 preview)
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5285';
const SHOTS = [
  'sc-front-cloth',     // 130 棉布店 (布行)
  'sc-front-silk',      // 131 绸缎店 (绸庄)
  'sc-front-embroidery',// 132 绣品店 (绣坊)
  'sc-front-leather',   // 133 皮货店 (皮货)
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let failures = 0;
for (const view of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 871 } });
  try {
    await page.goto(`${BASE}/?world=street-completion`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('完整世界已载入'), null, { timeout: 90000 });
    await page.click(`button[data-view="${view}"]`);
    await page.waitForTimeout(600);
    await page.click('#btn-save, button:has-text("保存实测图")');
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
    console.log(`ok  ${view}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${view}: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(failures === 0 ? 'SC_F2_FRONTS_PASS' : `SC_F2_FRONTS_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
