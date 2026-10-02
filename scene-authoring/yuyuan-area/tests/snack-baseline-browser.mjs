// M00/M14 comparison probe. Real Chromium frames and input, never accelerated physics steps.
// BASE=http://127.0.0.1:5492/ ART_DIR=/absolute/outbox node tests/snack-baseline-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:5492/';
const art = process.env.ART_DIR;
const prefix = process.env.PREFIX || 'M00';
if (!art || !path.isAbsolute(art)) throw new Error('ART_DIR must be an absolute path');
fs.mkdirSync(art, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.WALK_CHROME || '/usr/bin/google-chrome',
  headless: process.env.GPU_WEBGL !== '1',
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...(process.env.GPU_WEBGL === '1' ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])],
});
const viewport = { width: 1280, height: 720 };
const errors = [];
const requests = [];
const makePage = async () => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  return page;
};
const views = [
  { id: 'center', tourKey: 'anchor-center' },
  { id: 'snack-street', tourKey: 'anchor-main' },
  { id: 'bridge-bank', tourKey: 'jiuqu-bridge' },
];
const renderFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const world = await makePage();
await world.goto(new URL('?at=center&light=day', base).href, { waitUntil: 'domcontentloaded' });
await world.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
await world.waitForSelector('[data-tour="anchor-center"]', { timeout: 10000 });
const worldLoad = await world.evaluate(() => ({ ...window.__loadTimes, zones: window.__zonesLoaded }));
await world.evaluate(() => { document.getElementById('bar').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
const viewsReport = [];
for (const preset of ['day', 'dusk']) {
  await world.evaluate(name => window.__lighting.set(name), preset);
  await world.waitForFunction(name => window.__lighting.state().preset === name, preset, { timeout: 10000 });
  for (const view of views) {
    await world.evaluate(key => window.__tour(key), view.tourKey);
    await renderFrames(world);
    await world.screenshot({ path: path.join(art, `${prefix}-${view.id}-${preset}.png`) });
    const camera = await world.evaluate(() => window.__cam());
    viewsReport.push({ preset, view: view.id, tourKey: view.tourKey, eye: camera.p, look: camera.t, lighting: await world.evaluate(() => window.__lighting.state()) });
  }
}
const worldArtStatus = await world.evaluate(() => window.__worldArtStyle?.status() ?? null);
await world.close();
if (process.env.SKIP_PLAY === '1') {
  const report = { schemaVersion: 1, base, chromeVersion: browser.version(), viewport,
    mode: 'fixed-view art capture; no movement or performance claim', worldLoad, views: viewsReport, worldArt: worldArtStatus, errors };
  fs.writeFileSync(path.join(art, `${prefix}-browser-baseline.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await browser.close();
  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ screenshots: viewsReport.length, worldArt: worldArtStatus }, null, 2));
  process.exit(0);
}

const play = await makePage();
await play.goto(new URL('?play=1&at=center&light=day', base).href, { waitUntil: 'domcontentloaded' });
await play.waitForFunction(() => {
  const s = window.__play?.status();
  return window.__ready && s?.ready && s.mode === 'play' && s.feet?.length === 3 && s.foodsReady && s.bikePlaced && s.closedFacadesReady;
}, undefined, { timeout: 120000 });
await play.bringToFront();
await play.waitForTimeout(3000);
const before = await play.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const geometry = new Set(), material = new Set(), texture = new Set();
  window.__scene.traverse(object => {
    if (object.geometry) geometry.add(object.geometry.uuid);
    for (const m of (Array.isArray(object.material) ? object.material : object.material ? [object.material] : [])) {
      material.add(m.uuid);
      for (const value of Object.values(m)) if (value?.isTexture) texture.add(value.uuid);
    }
  });
  return {
    play: window.__play.status(),
    walk: window.__walk.status(),
    load: { ...window.__loadTimes },
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
    webgl2: !!gl,
    visibility: document.visibilityState,
    resourceCounts: { geometry: geometry.size, material: material.size, texture: texture.size },
    foodRequests: [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(s => s.includes('/resources/foods/handheld/')))].length,
  };
});
await play.screenshot({ path: path.join(art, `${prefix}-play-center.png`) });
const sample = play.evaluate(() => new Promise(resolve => {
  const times = [];
  let hiddenSamples = 0;
  let start = 0, previous = 0;
  const tick = t => {
    if (!start) start = t;
    if (previous && t - start > 250) { times.push(t - previous); if (document.visibilityState !== 'visible') hiddenSamples++; }
    previous = t;
    if (t - start < 8000) requestAnimationFrame(tick);
    else resolve({ times, hiddenSamples });
  };
  requestAnimationFrame(tick);
}));
await play.keyboard.down('w');
await play.waitForTimeout(3000);
await play.keyboard.up('w');
await play.keyboard.down('s');
await play.waitForTimeout(3000);
await play.keyboard.up('s');
const captured = await sample;
const samples = captured.times.filter(v => Number.isFinite(v) && v > 0).sort((a,b) => a-b);
const quantile = q => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * q))] ?? null;
const after = await play.evaluate(() => ({ play: window.__play.status(), walk: window.__walk.status() }));
await play.screenshot({ path: path.join(art, `${prefix}-play-after-route.png`) });
const report = {
  schemaVersion: 1,
  base,
  chromeVersion: browser.version(),
  viewport,
  deviceScaleFactor: 1,
  backgroundPolicy: 'disable browser background timer/renderer/occluded-window throttling; all gameplay assets ready, then 3s warmup',
  mode: process.env.GPU_WEBGL === '1' ? 'headed-display-real-renderer' : 'headless-swiftshader',
  route: 'center spawn; production keyboard W 3s, S 3s; RAF samples 8s; no teleport',
  worldLoad,
  worldArt: await play.evaluate(() => window.__worldArtStyle?.status() ?? null),
  views: viewsReport,
  before,
  after,
  frameTimes: { sampleCount: samples.length, hiddenSamples: captured.hiddenSamples, p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: samples.at(-1) ?? null, over100ms: samples.filter(v => v > 100).length },
  requests: { count: requests.length, unique: new Set(requests).size },
  errors,
};
fs.writeFileSync(path.join(art, `${prefix}-browser-baseline.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
await play.close();
await browser.close();
if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
if (!before.webgl2 || !samples.length) throw new Error('No WebGL2 or frame samples');
console.log(JSON.stringify({ renderer: before.renderer, p50Ms: quantile(.5), p95Ms: quantile(.95), frames: samples.length, foodRequests: before.foodRequests, screenshots: viewsReport.length + 2 }, null, 2));
