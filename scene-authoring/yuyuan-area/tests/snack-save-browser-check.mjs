// M02 actual browser: legacy migration, refresh while riding, eating, new trip, fallback and quota.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LEGACY_STORAGE_KEY, STORAGE_KEY_V2 } from '../web/play/save-migration.js';
const base = process.env.BASE || 'http://127.0.0.1:5613/';
const gpu = process.env.GPU_WEBGL === '1';
const oldSave = changes => ({ schemaVersion: 1, sceneVersion: 'play-snacks-20261001', actorId: 'gray-cat',
  feet: null, yaw: 0, pitch: 0, heldItem: null, basketItem: null, eating: null,
  tasted: ['xiaolongbao'], goalIndex: 1, vehicle: { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false }, ...changes });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: !gpu,
  args: ['--no-sandbox', ...(gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const open = async ({ legacy, partialV2 = null, quota = false }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const raw = JSON.stringify(legacy);
  await page.addInitScript(({ key, v2, raw, partialV2, quota }) => {
    // Only seed once; reload must consume the version that the app actually persisted.
    if (!sessionStorage.getItem('seeded-M02')) {
      localStorage.setItem(key, raw);
      if (partialV2) localStorage.setItem(v2, JSON.stringify(partialV2));
      sessionStorage.setItem('seeded-M02', '1');
    }
    if (quota) {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) { if (k === v2) throw new DOMException('test quota', 'QuotaExceededError'); return set.call(this, k, v); };
    }
  }, { key: LEGACY_STORAGE_KEY, v2: STORAGE_KEY_V2, raw, partialV2, quota });
  await page.goto(new URL('?play=1&at=center', base).href);
  await ready(page);
  return { page, raw };
};
const ready = page => page.waitForFunction(() => {
  const s = window.__play?.status();
  return s?.mode === 'play' && s.feet?.length === 3 && s.catalogReady && s.foodsReady && s.bikePlaced;
}, undefined, { timeout: 120000 });
const read = page => page.evaluate(({ oldKey, newKey }) => ({ status: window.__play.status(),
  oldRaw: localStorage.getItem(oldKey), saved: JSON.parse(localStorage.getItem(newKey) || 'null') }), { oldKey: LEGACY_STORAGE_KEY, newKey: STORAGE_KEY_V2 });

try {
  const { page, raw } = await open({ legacy: oldSave({ heldItem: 'congyoubing' }) });
  let x = await read(page);
  assert.deepEqual(x.status.tasted, ['xiaolongbao']);
  assert.equal(x.status.heldItem, 'congyoubing');
  assert.equal(x.oldRaw, raw);
  assert.equal(x.saved.schemaVersion, 2);
  assert.deepEqual(x.saved.discovered.sort(), ['congyoubing', 'xiaolongbao']);
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__play.status().riding, undefined, { timeout: 10000 });
  x = await read(page);
  assert.equal(x.saved.basketItem, 'congyoubing');
  assert.equal(x.saved.heldItem, null);
  await page.reload(); await ready(page);
  await page.waitForFunction(() => window.__play.status().riding, undefined, { timeout: 10000 });
  assert.equal((await read(page)).oldRaw, raw);
  await page.keyboard.press('r');
  await page.waitForFunction(() => !window.__play.status().riding && window.__play.status().heldItem === 'congyoubing', undefined, { timeout: 10000 });
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__play.status().tasted.includes('congyoubing'), undefined, { timeout: 10000 });
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__play.status().riding, undefined, { timeout: 10000 });
  await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w');
  await page.locator('#p-reset').click();
  await page.waitForFunction(() => { const s = window.__play.status(); return !s.riding && s.feet && Math.hypot(s.feet[0] + 157.75, s.feet[2] + 22.25) < .4; }, undefined, { timeout: 10000 });
  x = await read(page);
  assert.deepEqual(x.status.tasted.sort(), ['congyoubing', 'xiaolongbao']);
  assert.equal(x.oldRaw, raw);
  assert.equal(x.status.heldItem, null);
  assert.equal(await page.locator('#p-reset').textContent(), '新散步');
  await page.close();

  const fallback = await open({ legacy: oldSave({ tasted: ['xiaolongbao', 'congyoubing', 'youdunzi'] }),
    partialV2: { schemaVersion: 2, actorId: 'gray-cat', catalogEdition: 'incomplete' } });
  x = await read(fallback.page);
  assert.equal(x.status.stamps, 3);
  assert.ok(x.saved.milestones.includes('legacy-three-tastes'));
  assert.equal(x.oldRaw, fallback.raw);
  await fallback.page.close();

  const delayed = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const delayedRaw = JSON.stringify(oldSave({ heldItem: 'congyoubing' }));
  await delayed.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: LEGACY_STORAGE_KEY, raw: delayedRaw });
  let releaseCatalog;
  const catalogHeld = new Promise(resolve => { releaseCatalog = resolve; });
  await delayed.route('**/inputs/food-catalog.json', async route => { await catalogHeld; await route.continue(); });
  try {
    await delayed.goto(new URL('?play=1&at=center', base).href);
    await delayed.waitForFunction(() => window.__play?.status().mode === 'play' && window.__play.status().feet?.length === 3, undefined, { timeout: 120000 });
    assert.equal(await delayed.locator('#p-reset').isDisabled(), true, 'new trip must wait for existing collection restoration');
    releaseCatalog();
    await ready(delayed);
    assert.equal(await delayed.locator('#p-reset').isDisabled(), false);
    await delayed.locator('#p-reset').click();
    await delayed.waitForFunction(() => window.__play.status().heldItem === null, undefined, { timeout: 10000 });
    x = await read(delayed);
    assert.deepEqual(x.status.tasted, ['xiaolongbao']);
    assert.equal(x.oldRaw, delayedRaw);
  } finally { releaseCatalog(); await delayed.close(); }

  const quota = await open({ legacy: oldSave(), quota: true });
  await quota.page.waitForFunction(() => window.__play.status().saveError === 'quota-exceeded', undefined, { timeout: 10000 });
  x = await read(quota.page);
  assert.deepEqual(x.status.tasted, ['xiaolongbao']);
  assert.equal(x.oldRaw, quota.raw);
  assert.equal(x.saved, null);
  assert.match(await quota.page.locator('#play-msg').innerText(), /保存/, 'storage failure must remain visible after the entering-play notice');
  await quota.page.close();
  console.log('SNACK_SAVE_BROWSER PASS: v1->v2, ride refresh, eating, new trip collection, partial-v2 fallback, quota preservation');
} finally { await browser.close(); }
