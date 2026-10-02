// M07 DOM-only integration oracle; the actual game pause/camera cycle is checked separately.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5613/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: process.env.GPU_WEBGL !== '1',
  args: ['--no-sandbox', ...(process.env.GPU_WEBGL === '1' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
let failures = 0;
const check = (name, pass) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); if (!pass) failures++; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(base);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  await page.evaluate(async () => {
    const [{ mountAtlas }, { createOverlayController }, { createFoodRegistry }] = await Promise.all([
      import('/web/play/atlas.js'), import('/web/play/overlay-controller.js'), import('/web/play/catalog.js'),
    ]);
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/web/play/atlas.css'; document.head.appendChild(link);
    await new Promise(ok => { link.onload = ok; });
    const json = path => fetch(path).then(r => r.json());
    const [catalog, assets, vendors, profiles] = await Promise.all(['food-catalog','play-foods','play-vendors','food-pose-profiles'].map(s => json(`/inputs/${s}.json`)));
    const registry = createFoodRegistry({ catalog, assets, vendors, profiles });
    const state = { mode: 'play', paused: false, pausedReason: null, focused: true };
    const overlay = createOverlayController({ captureState: () => state, pause: () => { state.paused = true; state.pausedReason = 'overlay'; }, resume: () => { state.paused = false; state.pausedReason = null; }, clearInput() {}, isFocused: () => true });
    window.__componentGameEsc = 0;
    window.addEventListener('keydown', e => { if (e.key === 'Escape') window.__componentGameEsc++; });
    const atlas = mountAtlas({ root: document.body, registry, overlay, getSnapshot: () => ({ discovered: ['xiaolongbao'], tasted: [], requiredCount: 3 }), actions: { track: () => true } });
    window.__componentAtlas = atlas; window.__componentOverlay = overlay;
  });
  await page.keyboard.press('b');
  await page.locator('.pb-atlas-card').nth(1).focus(); await page.keyboard.press('Enter');
  check('keyboard food selection retains card focus',await page.locator('.pb-atlas-card').nth(1).evaluate(el => el===document.activeElement));
  await page.locator('.pb-atlas-card').nth(2).click();
  check('unseen food cannot reveal a precise target', await page.locator('.pb-atlas-track-btn').isDisabled());
  await page.keyboard.press('Escape');
  check('Escape is consumed before game listeners', await page.evaluate(() => window.__componentGameEsc === 0));
  check('Escape closes atlas', await page.locator('.pb-atlas').evaluate(el => el.hidden));

  await page.keyboard.press('b');
  await page.evaluate(() => { const input = document.createElement('input'); input.className = 'component-editable'; document.querySelector('.pb-atlas-dialog').appendChild(input); input.focus(); });
  await page.keyboard.press('Escape');
  check('Escape closes atlas from editable focus', await page.locator('.pb-atlas').evaluate(el => el.hidden));
  await page.evaluate(() => { window.__componentAtlas.close(); document.querySelector('.component-editable')?.remove(); });
  await page.keyboard.press('b');
  let contained = true;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    if (!await page.evaluate(() => document.querySelector('.pb-atlas-dialog').contains(document.activeElement))) { contained = false; break; }
  }
  check('Tab trap excludes hidden controls and confirmation', contained);
  await page.evaluate(() => window.__componentAtlas.close());
  await page.keyboard.press('b');
  await page.evaluate(() => window.__componentAtlas.dispose());
  check('dispose releases overlay ownership', await page.evaluate(() => !window.__componentOverlay.isOpen()));
  await page.close();
} finally { await browser.close(); }
if (failures) throw new Error(`ATLAS_COMPONENT_BROWSER FAIL (${failures})`);
console.log('ATLAS_COMPONENT_BROWSER PASS');
