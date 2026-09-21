// REL-04: capture REAL first-person evidence at the templeFront spawn.
//   production: the FIXED production path (?entry=templeFront -> 开始探索),
//            yaw from the page's own anchor derivation (inward gate axis).
//   legacy  : TEST INJECTION yaw=-pi reproducing the pre-fix degenerate rule
//            (its production capture is kept separately as
//            temple-front-before-legacy-production.jpg, taken while
//            entryAnchors.js was temporarily reverted).
//   inward : TEST INJECTION via __fangbangSetFacing(templeYawRad) - facing
//            along the gate axis INTO the temple.
//   outward: TEST INJECTION via __fangbangSetFacing(templeYawRad + PI) - facing
//            out through the door toward Fangbang road.
//   ref    : the existing 'shanmen-from-road' framing camera (view mode).
// Every injected shot is labeled testInjected:true in the receipt.
// Run: node tools/temple_front_facing_shots.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/world-reliability/temple-front');
await mkdir(OUT, { recursive: true });
const BASE = process.env.GAME_URL || 'http://127.0.0.1:5430/fangbang.html?ds=fangbang-temple-v7';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}&entry=templeFront`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const b = document.querySelector('#btn-start');
  return b && b.disabled === false;
}, null, { timeout: 300000 });
await page.waitForFunction(() => typeof window.__fangbangSetFacing === 'function', null, { timeout: 120000 });

const manifestYaw = await page.evaluate(async () => {
  const m = await fetch('./world/fangbang-temple-v7/review-manifest.json').then((r) => r.json());
  return m.mapRegistration.templePlacement.yawRad;
});

const shots = [];
// PRODUCTION (post-fix): 开始探索 with the page's own templeFront anchor yaw
await page.click('#btn-start');
await page.waitForTimeout(1200);
const productionYaw = await page.evaluate(() => window.__fangbangRecord().walking.headingRad);
await page.screenshot({ path: resolve(OUT, 'temple-front-after-production.jpg'), type: 'jpeg', quality: 88 });
shots.push({ label: 'after-production', yaw: productionYaw, testInjected: false, file: 'temple-front-after-production.jpg' });

// LEGACY (test injection): the pre-fix degenerate facing (-pi), for comparison
await page.evaluate((y) => window.__fangbangSetFacing(y), -Math.PI);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, 'temple-front-legacy-test-injected.jpg'), type: 'jpeg', quality: 88 });
shots.push({ label: 'legacy-test-injected', yaw: -Math.PI, testInjected: true, file: 'temple-front-legacy-test-injected.jpg' });

// INWARD (test injection): along the gate axis into the temple
await page.evaluate((y) => window.__fangbangSetFacing(y), manifestYaw);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, 'temple-front-inward-test-injected.jpg'), type: 'jpeg', quality: 88 });
shots.push({ label: 'inward-test-injected', yaw: manifestYaw, testInjected: true, file: 'temple-front-inward-test-injected.jpg' });

// OUTWARD (test injection): out through the door toward Fangbang road
await page.evaluate((y) => window.__fangbangSetFacing(y), manifestYaw + Math.PI);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, 'temple-front-outward-test-injected.jpg'), type: 'jpeg', quality: 88 });
shots.push({ label: 'outward-test-injected', yaw: manifestYaw + Math.PI, testInjected: true, file: 'temple-front-outward-test-injected.jpg' });

// REFERENCE: the existing framing camera (view mode)
await page.evaluate((y) => window.__fangbangSetFacing(y), productionYaw); // restore production facing
await page.evaluate(() => { document.querySelector('#btn-framing')?.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#views [data-view]')].find((b) => b.dataset.view === 'shanmen-from-road');
  if (btn) btn.click();
});
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(OUT, 'reference-shanmen-from-road.jpg'), type: 'jpeg', quality: 88 });
shots.push({ label: 'reference-shanmen-from-road', view: 'shanmen-from-road', testInjected: false, file: 'reference-shanmen-from-road.jpg' });

await browser.close();
const receipt = { manifestYaw, productionYawRad: productionYaw, legacyBeforeCapture: 'temple-front-before-legacy-production.jpg (production path with entryAnchors.js temporarily reverted, yaw -3.1416)', shots, baseUrl: BASE };
await writeFile(resolve(OUT, 'receipt.json'), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(receipt, null, 1));
