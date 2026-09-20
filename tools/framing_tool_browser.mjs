// world-ten-hour round 1 (PLAN task C) — browser verification of the 取景工具
// on the REAL page: visibility rules, save → restore round trip, persistence
// across reload, additive import with visible skips, two-step delete, PNG
// export (canvas-resolution, non-blank), and the six presets rendered +
// screenshot-verified (no black/in-wall frames).
// Run: node tools/framing_tool_browser.mjs --base http://127.0.0.1:5420
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5420');
const outDir = resolve(root, arg('out', 'artifacts/world-ten-hour/round-001/framing-browser'));
await mkdir(outDir, { recursive: true });

const checks = [];
const check = (ok, label, detail = '') => { checks.push({ ok, label, detail: String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
const shots = [];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  const cam = () => page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { mode: r.mode, pos: r.camera.position, target: r.camera.target, fov: r.camera.fovDeg };
  });
  const waitReady = () => page.waitForFunction(() => {
    const r = window.__fangbangRecord?.();
    return r && r.ready && r.routeCheck;
  }, null, { timeout: 600000, polling: 1000 });

  await page.goto(`${base}/fangbang.html?ds=fangbang-temple-v7&entry=mainStreet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitReady();
  await page.evaluate(() => localStorage.removeItem('pawborough.fangbang.framing.v1'));   // clean slate
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady();

  // 1) visibility: view mode + ready → visible; walk → hidden; V → visible
  check(await page.evaluate(() => document.querySelector('#framing').hidden === false), 'panel visible in ready view mode');
  await page.click('#btn-start');
  await page.waitForTimeout(600);
  check(await page.evaluate(() => document.querySelector('#framing').hidden === true), 'panel hidden while walking');
  await page.keyboard.press('KeyV');   // exit walk, keep pose
  await page.waitForTimeout(400);
  check(await page.evaluate(() => document.querySelector('#framing').hidden === false), 'panel visible again in framing (V)');
  check((await page.textContent('#notice')).includes('从当前位置继续'), 'exit notice still promises pose keeping');

  // open the collapsible panel for the interaction tests
  await page.click('#framing > summary');
  check(await page.evaluate(() => document.querySelector('#framing').open), 'panel opens (collapsible details)');

  // 2) save the current view via the UI
  await page.fill('#ft-name', '走查机位甲');
  await page.click('#ft-save');
  await page.waitForTimeout(200);
  let list = await page.evaluate(() => [...document.querySelectorAll('#ft-list li span')].map((s) => s.textContent));
  check(list.includes('走查机位甲'), 'saved view appears in the list', JSON.stringify(list));
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pawborough.fangbang.framing.v1')));
  check(stored?.views?.length === 1 && stored.views[0].name === '走查机位甲', 'store persisted in the dedicated namespace', JSON.stringify(Object.keys(stored ?? {})));
  check(!JSON.stringify(stored).includes('password') && !JSON.stringify(stored).includes('token'), 'store carries no secret-like fields');
  const savedCam = await cam();

  // 3) move the camera far away, then restore → pose must match the save
  await page.locator('#ft-presets button').last().click();   // shanmen-from-road: far from the saved east-junction view
  await page.waitForTimeout(400);
  const movedCam = await cam();
  check(Math.hypot(movedCam.pos[0] - savedCam.pos[0], movedCam.pos[2] - savedCam.pos[2]) > 20, 'preset actually moved the camera far away', `d=${Math.hypot(movedCam.pos[0] - savedCam.pos[0], movedCam.pos[2] - savedCam.pos[2]).toFixed(1)}m`);
  await page.locator('#ft-list li', { hasText: '走查机位甲' }).locator('button', { hasText: '恢复' }).click();
  await page.waitForTimeout(300);
  const backCam = await cam();
  const drift = Math.hypot(backCam.pos[0] - savedCam.pos[0], backCam.pos[1] - savedCam.pos[1], backCam.pos[2] - savedCam.pos[2])
    + Math.hypot(backCam.target[0] - savedCam.target[0], backCam.target[1] - savedCam.target[1], backCam.target[2] - savedCam.target[2]);
  check(drift < 0.02, 'restore returns the exact saved pose', `drift=${drift.toFixed(4)}`);
  check((await page.textContent('#notice')).includes('显式定位，非行走'), 'restore notice is explicit-framing, not walking');

  // 4) additive import: one good + one colliding + one foreign-dataset entry
  const importPayload = JSON.stringify({
    views: [
      { schemaVersion: 1, dataset: 'fangbang-temple-v7', name: '导入机位乙', position: [-125.7, 1.6, 39.5], target: [-127.8, 4.5, 27.1], fovDeg: 50, display: { clay: false } },
      { schemaVersion: 1, dataset: 'fangbang-temple-v7', name: '走查机位甲', position: [0, 1.6, 0], target: [0, 2, -5], fovDeg: 55, display: { clay: false } },
      { schemaVersion: 1, dataset: 'some-other-world', name: '异世界机位', position: [1, 1.6, 1], target: [0, 2, -5], fovDeg: 55, display: { clay: false } },
    ],
  });
  await page.setInputFiles('#ft-import-file', { name: 'views.json', mimeType: 'application/json', buffer: Buffer.from(importPayload) });
  await page.waitForTimeout(400);
  list = await page.evaluate(() => [...document.querySelectorAll('#ft-list li span')].map((s) => s.textContent));
  check(list.includes('导入机位乙') && list.includes('走查机位甲（2）'), 'import is additive; collision suffixed, original kept', JSON.stringify(list));
  const errText = await page.textContent('#ft-error');
  check(errText.includes('数据集') && errText.includes('跳过 1'), 'foreign-dataset entry skipped with a visible reason', errText.trim().slice(0, 120));

  // 5) two-step delete: first click arms (cancelable), second deletes
  const delBtn = page.locator('#ft-list li', { hasText: '走查机位甲（2）' }).locator('button', { hasText: '删除' });
  await delBtn.click();
  check(await delBtn.textContent() === '确认删除', 'first delete click arms a confirm, not a delete');
  await page.waitForTimeout(200);
  await delBtn.click();
  await page.waitForTimeout(200);
  list = await page.evaluate(() => [...document.querySelectorAll('#ft-list li span')].map((s) => s.textContent));
  check(!list.includes('走查机位甲（2）') && list.includes('走查机位甲'), 'confirmed click deletes exactly the target view');

  // 6) PNG export: user click → download, canvas resolution, non-blank
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#ft-png')]);
  const pngPath = resolve(outDir, download.suggestedFilename());
  await download.saveAs(pngPath);
  shots.push(download.suggestedFilename());
  const png = await readFile(pngPath);
  check(png.length > 20000 && png.subarray(1, 4).toString() === 'PNG', 'exported PNG is a real file', `${png.length} B`);
  const dims = await page.evaluate(() => window.__fangbangRecord().framebuffer);
  // read PNG IHDR for exact canvas resolution (bytes 16-24)
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  check(Math.abs(w - dims[0]) <= 2 && Math.abs(h - dims[1]) <= 2, 'PNG resolution matches the WebGL canvas', `png ${w}x${h} vs canvas ${dims[0]}x${dims[1]}`);

  // 7) persistence across reload + restore after reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady();
  list = await page.evaluate(() => [...document.querySelectorAll('#ft-list li span')].map((s) => s.textContent));
  check(list.includes('走查机位甲') && list.includes('导入机位乙'), 'saves survive a reload', JSON.stringify(list));
  await page.click('#framing > summary');   // details render closed after reload

  // 8) six presets: render each, screenshot, no black frame
  const presetCount = await page.locator('#ft-presets button').count();
  check(presetCount === 6, 'six curated presets offered', `got ${presetCount}`);
  for (let i = 0; i < presetCount; i++) {
    const btn = page.locator('#ft-presets button').nth(i);
    const label = await btn.textContent();
    await btn.click();
    await page.waitForTimeout(500);
    const shotName = `preset-${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: resolve(outDir, shotName), clip: { x: 0, y: 40, width: 1280, height: 800 } });
    shots.push(shotName);
    // the page's own honest render check: count distinct colors of a downscale
    const colors = await page.evaluate(async () => {
      window.__fangbangRenderSync();   // fresh draw; the buffer is read in this same task
      const c = document.querySelector('#app canvas');
      const s = document.createElement('canvas'); s.width = 64; s.height = 64;
      const g = s.getContext('2d');
      g.drawImage(c, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      const set = new Set();
      for (let k = 0; k < d.length; k += 4) set.add(`${d[k] >> 4},${d[k + 1] >> 4},${d[k + 2] >> 4}`);
      return set.size;
    });
    check(colors >= 8, `preset renders non-blank: ${label}`, `colorBuckets=${colors}`);
  }
  await page.screenshot({ path: resolve(outDir, '00-framing-panel.png') });
  shots.push('00-framing-panel.png');

  check(problems.length === 0, 'no pageerrors during the whole flow', JSON.stringify(problems));

  // JSON export path (user click → download)
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#ft-export-json')]);
  const jsonPath = resolve(outDir, dl2.suggestedFilename());
  await dl2.saveAs(jsonPath);
  shots.push(dl2.suggestedFilename());
  const jsonText = await readFile(jsonPath, 'utf8');
  check(jsonText.includes('走查机位甲') && jsonText.includes('"views"'), 'JSON export carries the saved views', `${jsonText.length} B`);
} finally {
  await writeFile(resolve(outDir, 'framing-browser.json'), JSON.stringify({ checks, shots, at: new Date().toISOString() }, null, 1) + '\n');
  await browser.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`FRAMING BROWSER VERIFY: ${checks.length - failed.length}/${checks.length} pass, ${failed.length} fail`);
process.exit(failed.length ? 1 : 0);
