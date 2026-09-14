// Street-completion evidence captures: the batch's 8 fixed cameras through the
// real review client (vite dev server) + playwright. Same pattern as
// capture_eastedge_web.mjs: every shot goes through the page's own
// 保存实测图 button, so each image ships with the client's own telemetry JSON
// (camera position, resource counts, active block ids, dataset tag).
//
// sc-czero is captured twice — &assets=off (six gray boxes) vs candidate —
// the same-camera six-building comparison the lead asked for.
//
// Run (dev server already up on 5284):
//   EVIDENCE_DIR=../artifacts/lead-review/web node scripts/capture_street_completion_web.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5284';

const SHOTS = [
  // the C0-style six-tail comparison: same dataset, same camera, off/on
  { url: '/?world=street-completion&assets=off', w: 1280, h: 723, view: 'sc-czero', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 723, view: 'sc-czero', clay: false },
  // the batch's other fixed views
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-roof-north', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-roof-south', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-ground-seam', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-pair-cloth-silk', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-pair-embroidery-leather', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-lane-b', clay: false },
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-catwall', clay: false },
  // clay comparison at the czero camera
  { url: '/?world=street-completion', w: 1280, h: 723, view: 'sc-czero', clay: true },
  // clay for the ground-seam view (S3 joint, geometry-only reading)
  { url: '/?world=street-completion', w: 1280, h: 871, view: 'sc-ground-seam', clay: true },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failures = 0;
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  try {
    await page.goto(BASE + s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('完整世界已载入'), null, { timeout: 90000 });
    await page.check('#chk-placeholder');
    await page.click(`button[data-view="${s.view}"]`);
    if (s.clay) {
      const clayBtn = page.locator('button', { hasText: '灰模' });
      await clayBtn.click();
    }
    await page.waitForTimeout(600);
    await page.click('#btn-save, button:has-text("保存实测图")');
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 15000 });
    console.log(`ok  ${s.view}${s.clay ? ' clay' : ''} @${s.w}x${s.h} ${s.url.includes('assets=off') ? '[graybox]' : '[candidate]'}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${s.view} ${s.url}: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(failures === 0 ? 'STREET_COMPLETION_WEB_PASS' : `STREET_COMPLETION_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
