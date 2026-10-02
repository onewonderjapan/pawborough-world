// M03: material pilot applies before batching; missing styling data must not block the world.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5613/';
const gpu = process.env.GPU_WEBGL === '1';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: !gpu,
  args: ['--no-sandbox', ...(gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(base);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const active = await page.evaluate(() => window.__worldArtStyle?.status());
  assert.ok(active?.ready, 'pilot data must be ready before the scene is batched');
  assert.ok(active.matchedMeshes > 0, 'actual world materials must match the scoped family rules');
  assert.ok(active.uniqueVariants < active.matchedMeshes, 'world materials must be shared across meshes');
  await page.close();
  const failed = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await failed.route('**/inputs/world-art-style.json', route => route.abort('failed'));
  await failed.goto(base);
  await failed.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const fallback = await failed.evaluate(() => window.__worldArtStyle?.status());
  assert.equal(fallback.ready, false);
  assert.ok(fallback.error);
  assert.equal(fallback.matchedMeshes, 0);
  assert.equal(fallback.uniqueVariants, 0);
  await failed.close();
  console.log('WORLD_ART_BROWSER PASS', JSON.stringify(active));
} finally { await browser.close(); }
