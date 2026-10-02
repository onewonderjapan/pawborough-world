// M01: metadata readiness must precede legacy save use; catalog failure must not eat the old save.
// BASE=http://127.0.0.1:5613/ node tests/snack-catalog-browser-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PlayGameState, EAT_SECONDS, STORAGE_KEY } from '../web/play/state.js';

const base = process.env.BASE || 'http://127.0.0.1:5613/';
const seedState = new PlayGameState();
seedState.take('xiaolongbao');
seedState.startEat();
seedState.eatTick(EAT_SECONDS);
const seed = JSON.stringify(seedState.toSave({ feet: null, yaw: 0 }));
const browser = await chromium.launch({
  executablePath: process.env.WALK_CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const open = async (breakCatalog = false) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: seed });
  if (breakCatalog) await page.route('**/inputs/food-catalog.json', route => route.abort('failed'));
  await page.goto(new URL('?play=1&at=center', base).href);
  await page.waitForFunction(() => window.__ready && window.__play?.status().mode === 'play', undefined, { timeout: 120000 });
  return page;
};

try {
  const normal = await open();
  await normal.waitForFunction(() => window.__play?.status().catalogReady === true, undefined, { timeout: 12000 });
  const ready = await normal.evaluate(() => ({
    status: window.__play.status(),
    foods: window.__play.state().foods.map(f => f.id),
    registryConfigured: window.__play.state().catalogConfigured,
  }));
  assert.equal(ready.registryConfigured, true);
  assert.deepEqual(ready.foods, ['xiaolongbao', 'congyoubing', 'youdunzi']);
  assert.deepEqual(ready.status.tasted, ['xiaolongbao']);
  await normal.close();

  const broken = await open(true);
  await broken.waitForFunction(() => !!window.__play?.status().catalogError, undefined, { timeout: 12000 });
  const failed = await broken.evaluate(key => ({
    status: window.__play.status(),
    saved: localStorage.getItem(key),
  }), STORAGE_KEY);
  assert.equal(failed.status.mode, 'play');
  assert.equal(failed.status.catalogReady, false);
  assert.equal(failed.status.stallsReady, 0);
  assert.equal(failed.saved, seed, 'catalog error must not overwrite the legacy collection');
  await broken.close();
  console.log('SNACK_CATALOG_BROWSER PASS');
} finally {
  await browser.close();
}
