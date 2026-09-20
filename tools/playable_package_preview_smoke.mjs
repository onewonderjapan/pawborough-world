// world-playable-night 20260920 — homepage smoke (dev server OR portable
// package). Checks the player homepage end-to-end without 3D: four derived
// start points, interactive SVG map, CTA hrefs (default stays plain), hero
// image, gallery images, config radio, no workspace-path leakage, and both
// 1280px / 390px layouts without horizontal overflow.
//
// Run: node tools/playable_package_preview_smoke.mjs --url http://127.0.0.1:5410/world-preview.html
import { chromium } from '../node_modules/playwright/index.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const url = arg('url', 'http://127.0.0.1:5410/world-preview.html');
const expectEntries = arg('entries', '4') === '4';
const checks = [];
const check = (ok, label, detail = '') => {
  checks.push({ ok, label, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ` — ${detail}` : ''));
};

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed ${r.url()}`));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  await page.waitForFunction(() => document.querySelector('#entries button, .map-error'), null, { timeout: 20000 });
  const nEntries = await page.locator('#entries button').count();
  check(!expectEntries || nEntries === 4, 'four start points listed', `got ${nEntries}`);

  const mapDots = await page.locator('#map [data-map-entry]').count();
  check(!expectEntries || mapDots === 4, 'map has four selectable dots', `got ${mapDots}`);

  const heroOk = await page.evaluate(() => { const i = document.querySelector('#hero-img'); return i && i.complete && i.naturalWidth > 100; });
  check(heroOk, 'hero image rendered');

  const cta0 = await page.getAttribute('#cta-explore', 'href');
  check(cta0 === 'fangbang.html?ds=fangbang-temple-v7&entry=mainStreet',
    'default CTA targets candidate with mainStreet', cta0);

  if (mapDots === 4) {
    await page.click('#map [data-map-entry="laneB"]');
    const cta1 = await page.getAttribute('#cta-explore', 'href');
    check(cta1.includes('entry=laneB'), 'map click selects laneB', cta1);
    const pressed = await page.getAttribute('#map [data-map-entry="laneB"]', 'aria-pressed');
    check(pressed === 'true', 'map dot reflects selection');
    await page.keyboard.press('Tab');
  }

  await page.click('details.opts summary');
  await page.click('input[name="cfg"][value="allOn"]');
  const cta2 = await page.getAttribute('#cta-explore', 'href');
  check(cta2.includes('skins=1&props=1') && cta2.includes('entry=laneB'), 'all-on option appends skins+props only', cta2);
  await page.click('input[name="cfg"][value="default"]');
  const cta3 = await page.getAttribute('#cta-explore', 'href');
  check(!cta3.includes('skins'), 'default config stays plain', cta3);

  // gallery: all imgs eventually load (scroll through to trigger lazy)
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.gallery img')];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 100);
  }, null, { timeout: 30000 });
  const nGallery = await page.locator('.gallery img').count();
  check(nGallery >= 8, 'gallery images all load', `count ${nGallery}`);

  // source kit table populated
  const srcRows = await page.locator('#src-table tr').count();
  check(srcRows === 4, 'production sources table rows', `got ${srcRows}`);

  // no workspace/absolute path leakage in attributes
  const leaks = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[href],[src]'))
      for (const v of [el.getAttribute('href'), el.getAttribute('src')])
        if (v && /(file:\/\/|\/home\/|C:\\)/.test(v)) out.push(v);
    return out;
  });
  check(leaks.length === 0, 'no absolute/workspace paths in DOM', leaks.join(' | '));

  // 1280 no horizontal overflow
  const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow1280 <= 1, '1280px no horizontal overflow', `delta ${overflow1280}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow390 <= 1, '390px no horizontal overflow', `delta ${overflow390}`);
  const narrowText = await page.evaluate(() => document.body.innerText);
  check(narrowText.includes('开始探索'), 'narrow layout keeps primary CTA');
  await page.screenshot({ path: arg('shot', '/tmp/world-preview-390.png'), fullPage: false });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: arg('shot-desktop', '/tmp/world-preview-1280.png'), fullPage: false });
} catch (e) {
  check(false, 'smoke run completed', String(e?.message ?? e));
} finally {
  await browser.close();
}
if (problems.length) check(false, 'no page errors / failed requests', problems.slice(0, 4).join(' | '));
else check(true, 'no page errors / failed requests');
const failed = checks.filter((c) => !c.ok);
console.log(`PREVIEW_SMOKE_${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
