// Quick headless smoke of fangbang.html: page loads, integrity holds, the
// automatic route check passes. (Full evidence capture lives in
// capture_fangbang_web.mjs.)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5296';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
try {
  await page.goto(BASE + '/fangbang.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 300000 });
  const notice = await page.evaluate(() => document.querySelector('#notice').textContent);
  console.log('notice:', notice);
  if (notice.includes('载入失败')) throw new Error('page load failed: ' + notice);
  const rec = await page.evaluate(() => window.__fangbangRecord());
  console.log('triangles:', rec.resources.triangles, 'expected:', rec.trianglesExpected);
  console.log('loadStats:', JSON.stringify(rec.load));
  console.log('route:', rec.routeCheck.pass ? 'PASS' : 'FAIL', rec.routeCheck.summary);
  console.log('routeDetail:', JSON.stringify(rec.routeCheck.results, null, 1).slice(0, 1600));
  console.log(rec.routeCheck.pass && rec.ready ? 'FANGBANG_SMOKE_PASS' : 'FANGBANG_SMOKE_FAIL');
  process.exit(rec.routeCheck.pass && rec.ready ? 0 : 1);
} catch (e) {
  const notice = await page.evaluate(() => document.querySelector('#notice')?.textContent).catch(() => '?');
  console.log('SMOKE_ERROR', e.message.split('\n')[0], '| notice:', notice);
  process.exit(1);
} finally {
  await page.close();
  await browser.close();
}
