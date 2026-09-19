// C4 helper — headless first-frame comparison, original vs compressed
// variant (?compressed=1) of the same page. Reports transfer bytes and wall
// time to the page's ready telemetry (which includes the full geometry
// integrity reconciliation), so the delta is measured, never claimed.
//
// Run: node tools/firstframe_compare.mjs --base-original URL --base-compressed URL
import { chromium } from '../node_modules/playwright/index.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const RUNS = [
  { label: 'original', base: arg('--base-original', 'http://127.0.0.1:5306'), url: '/fangbang.html?ds=fangbang-temple-v3&skins=1' },
  { label: 'compressed', base: arg('--base-compressed', 'http://127.0.0.1:5308'), url: '/fangbang.html?ds=fangbang-temple-v3&skins=1&compressed=1' },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = [];
for (const run of RUNS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let transferBytes = 0;
  page.on('response', async (res) => {
    try {
      const len = res.headers()['content-length'];
      if (len) transferBytes += parseInt(len, 10);
    } catch { /* closed */ }
  });
  const t0 = Date.now();
  await page.goto(run.base + run.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 600000 });
  const wallMs = Date.now() - t0;
  const rec = await page.evaluate(() => window.__fangbangRecord());
  out.push({
    label: run.label, url: run.base + run.url,
    readyMs: wallMs, transferMB: +(transferBytes / 1e6).toFixed(1),
    triangles: rec.resources.triangles,
    routePass: rec.routeCheck?.pass ?? null,
  });
  console.log(JSON.stringify(out[out.length - 1]));
  await page.close();
}
await browser.close();
const ok = out.length === 2 && out.every((r) => r.triangles > 0) && out.every((r) => r.routePass !== false);
console.log(ok ? 'FIRSTFRAME_COMPARE_PASS' : 'FIRSTFRAME_COMPARE_FAIL');
process.exit(ok ? 0 : 1);
