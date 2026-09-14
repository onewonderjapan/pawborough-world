// C0 same-camera comparison + evidence captures for the east-edge candidate.
//
// Drives the real review client (vite dev server) with playwright: the
// gray-box side loads the SAME derived dataset with &assets=off (the
// replacement block held back), the candidate side loads it applied; both run
// with 占位显示ON so the remaining street placeholders stay honest. Every shot
// goes through the page's own 保存实测图 button, so the posted record JSON is
// the client's own telemetry (camera position, resource counts, active block
// ids) — the machine-checkable proof of which dataset state produced it.
//
// Run (dev server already up):
//   EVIDENCE_DIR=world/east-edge/web-evidence node scripts/capture_eastedge_web.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5284';

const SHOTS = [
  // C0 comparison: same dataset, same camera, gray box vs candidate, 占位显示ON.
  // The page chrome eats ~151px of viewport height, so 723 viewport == the
  // spec's 572px canvas == the C0 vertical fov of 45 degrees, exact.
  { url: '/?world=east-edge&assets=off', w: 1280, h: 723, view: 'east-czero', clay: false },
  { url: '/?world=east-edge', w: 1280, h: 723, view: 'east-czero', clay: false },
  // C1 display view + clay
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-cone', clay: false },
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-cone', clay: true },
  // per-building front + west gable (the side C0 actually sees)
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-front-a', clay: false },
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-west-a', clay: false },
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-front-b', clay: false },
  { url: '/?world=east-edge', w: 1280, h: 871, view: 'east-west-b', clay: false },
  // clay at C0 for the candidate
  { url: '/?world=east-edge', w: 1280, h: 723, view: 'east-czero', clay: true },
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
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('完整世界已载入'), null, { timeout: 60000 });
    // 占位显示ON for every comparison/evidence shot (checkbox drives placeholderPref)
    await page.check('#chk-placeholder');
    await page.click(`button[data-view="${s.view}"]`);
    if (s.clay) {
      const clayBtn = page.locator('button', { hasText: '灰模' });
      await clayBtn.click();
    }
    await page.waitForTimeout(600); // let the static shadow map refresh land
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
console.log(failures === 0 ? 'EASTEDGE_WEB_PASS' : `EASTEDGE_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
