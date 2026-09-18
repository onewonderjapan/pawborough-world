// Debug probe: load one URL, print every console message / pageerror /
// failed request, then check what globals exist after 30 s.
import { chromium } from '../node_modules/playwright/index.mjs';

const URL = process.env.PROBE_URL ?? 'http://127.0.0.1:5304/fangbang.html';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[console.${msg.type()}] ${msg.text().slice(0, 20000)}`); });
page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 500)}`));
page.on('requestfailed', (req) => console.log(`[reqfail] ${req.url().slice(0, 160)} ${req.failure()?.errorText}`));
page.on('request', (req) => { if (/\.glb|manifest/.test(req.url())) console.log(`[req] ${req.url().slice(0, 180)}`); });
page.on('response', (res) => { console.log(`[http ${res.status()}] ${res.url().slice(0, 200)}`); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(15000);
const state = await page.evaluate(() => {
  const rec = typeof window.__fangbangRecord === 'function' ? window.__fangbangRecord() : null;
  return {
  rec: rec ? { actual: rec.resources.triangles, expected: rec.trianglesExpected, skins: rec.skins, meshes: rec.resources.meshes, routeCheck: rec.routeCheck } : null,
  hasRecord: typeof window.__fangbangRecord,
  hasView: typeof window.__fangbangView,
  notice: document.querySelector('#notice')?.textContent ?? null,
  bodyLen: document.body?.innerHTML.length ?? 0,
  };
});
console.log('STATE', JSON.stringify(state));
await browser.close();
