/* Headless browser check for the batch gallery: loads the page over the local
 * server, waits until all 6 GLBs report loaded (window.__batchReady), clicks
 * through each unit, and saves a screenshot. Read-only verify, no CDN. */
const path = require('path');
const { chromium } = require(path.normalize('/home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/node_modules/playwright'));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:5440/preview/gallery.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction('window.__batchReady === true', { timeout: 60000 });
  const status = await page.textContent('#status');
  for (const id of ['shop-01-narrow', 'shop-02-double', 'shop-03-threebay', 'shop-04-recess', 'shop-05-corner', 'shop-06-endcap']) {
    await page.click(`.thumb[data-id="${id}"]`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `/tmp/gallery-${id}.png` });
  }
  // clay toggle sanity
  await page.click('#clayBtn');
  await page.waitForTimeout(400);
  await page.click('#matBtn');
  const stats = await page.textContent('#stats');
  console.log('GALLERY_OK', JSON.stringify({ status, stats, errors }));
  await browser.close();
  if (errors.length) process.exit(2);
})().catch(e => { console.error('GALLERY_FAIL', e.message); process.exit(1); });
