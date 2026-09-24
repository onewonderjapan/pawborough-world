// WP13/T3 唯一入口出口证据：打开仓库根 index-v1.html → 截入口页 → 点「打开豫园区域预览」
// → 等分区加载完成 → 截进入后的区域画面。要求区域预览服务已在跑（BASE=… 或默认 5486）。
// 用法：BASE=http://127.0.0.1:5493/ SHOT_DIR=<目录> node scripts/entry-shots.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AREA, '..', '..');
const port = new URL(process.env.BASE || 'http://127.0.0.1:5486/').port;
const shotDir = process.env.SHOT_DIR || '.';
fs.mkdirSync(shotDir, { recursive: true });
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('file://' + path.join(REPO, 'index-v1.html'), { waitUntil: 'load' });
const cardOk = await page.evaluate(() => !!document.getElementById('yuyuan-area-entry') && !!document.getElementById('area-open'));
if (!cardOk) { console.error('FAIL: index-v1.html 无「豫园区域（全域候选）」入口卡片'); process.exit(2); }
await page.fill('#area-port', port);
await page.screenshot({ path: path.join(shotDir, 'entry-index-v1.png') });

await Promise.all([page.waitForURL('http://127.0.0.1:' + port + '/?zone=core'), page.click('#area-open')]);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.waitForTimeout(1000);
const stats = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  const px = new Uint8Array(g.drawingBufferWidth * g.drawingBufferHeight * 4);
  g.readPixels(0, 0, g.drawingBufferWidth, g.drawingBufferHeight, g.RGBA, g.UNSIGNED_BYTE, px);
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < px.length; i += 28) { const l = .2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2]; s += l; s2 += l * l; n++; }
  const m = s / n;
  return { std255: +Math.sqrt(s2 / n - m * m).toFixed(1), tourBtns: document.querySelectorAll('[data-tour]').length };
});
await page.screenshot({ path: path.join(shotDir, 'area-from-entry.png') });
await browser.close();
if (stats.std255 < 2) { console.error('FAIL: 进入后画面空白', stats); process.exit(2); }
console.log(JSON.stringify({ entry: 'ok', landedUrl: 'http://127.0.0.1:' + port + '/?zone=core', ...stats }, null, 1));
