// N6 cruise self-check: load the two expansion pages in headless chromium and
// wait for the automatic route cruise to finish, then assert PASS from the
// page's own record (window.__templeV2Record / window.__fangbangRecord).
// Run: node scripts/n6_cruise_check.mjs
import { chromium } from '../node_modules/playwright/index.mjs';

const TARGETS = process.env.DIST_CHECK === '1' ? [
  {
    name: 'DIST temple-v2 preview (5299)',
    url: 'http://127.0.0.1:5299/temple-v2.html',
    record: '__templeV2Record',
  },
  {
    name: 'DIST bridge v2 preview (5301, ?ds=)',
    url: 'http://127.0.0.1:5301/fangbang.html?ds=fangbang-temple-v2',
    record: '__fangbangRecord',
  },
] : [
  {
    name: 'temple-v2 (5298)',
    url: 'http://127.0.0.1:5298/temple-v2.html',
    record: '__templeV2Record',
  },
  {
    name: 'bridge v2 (?ds= on the fallback port 5300; 5296 occupied per fallback #9)',
    url: 'http://127.0.0.1:5300/fangbang.html?ds=fangbang-temple-v2',
    record: '__fangbangRecord',
  },
  {
    name: 'bridge v1 regression (?ds absent -> default dataset)',
    url: 'http://127.0.0.1:5300/fangbang.html',
    record: '__fangbangRecord',
    expectDataset: 'fangbang-temple',
  },
];

let failed = 0;
const { execSync } = await import('node:child_process');
const chromeCandidates = [
  process.env.CHROME_PATH,
  execSync('ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | sort | tail -1')
    .toString().trim() || undefined,
];
const executablePath = chromeCandidates.find(Boolean);
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const t of TARGETS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction((rec) => !!window[rec], t.record, { timeout: 180000 });
    // the cruise runs on load; give the record a beat to settle, then read it
    await page.waitForTimeout(1500);
    const rec = await page.evaluate((r) => window[r](), t.record);
    const route = rec.routeCheck ?? rec.lastRouteCheck;
    const datasetOk = t.expectDataset ? rec.dataset === t.expectDataset : true;
    const ok = !!route && route.pass === true && datasetOk && errors.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${t.name}`);
    console.log(`      dataset=${rec.dataset} route=${route ? route.pass : '—'} `
      + `${route?.summary ?? route?.error ?? ''} pageErrors=${errors.length}`);
    if (!ok) {
      failed++;
      if (route && route.results) console.log('      results:', JSON.stringify(route.results).slice(0, 900));
    }
  } catch (e) {
    failed++;
    let statsText = '';
    try { statsText = await page.evaluate(() => document.querySelector('#stats')?.textContent ?? ''); } catch {}
    let noticeText = '';
    try { noticeText = await page.evaluate(() => document.querySelector('#notice')?.textContent ?? ''); } catch {}
    console.log(`FAIL ${t.name}: ${String(e).slice(0, 300)}; pageErrors=${errors.slice(0, 3).join(' | ')}`);
    console.log(`      stats="${statsText.slice(0, 220)}" notice="${noticeText.slice(0, 160)}"`);
  }
  await page.close();
}
await browser.close();
process.exit(failed === 0 ? 0 : 1);
