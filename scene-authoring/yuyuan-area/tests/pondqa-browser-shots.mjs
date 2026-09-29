// wave10-pondqa 浏览器同机位截图（headless Chromium / SwiftShader，查看器真实材质与加载顺序）。
// 读 tests/pondqa-shots.mjs 的 shots JSON（地图系 = 查看器世界系），逐镜 window.__viewAt(pos, tgt) 后截图；
// 另截 ?zone=pond 默认斜俯一张（只加载池带分件时的样子）。标签层隐藏，只看几何与材质。图片只写 SHOT_DIR（工单包 artifacts/）。
// 用法：BASE=http://127.0.0.1:<port>/ SHOTS=<shots.json> SHOT_DIR=<dir> [FILTER=<re>] node tests/pondqa-browser-shots.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:5491/';
const dir = process.env.SHOT_DIR;
fs.mkdirSync(dir, { recursive: true });
const shots = JSON.parse(fs.readFileSync(process.env.SHOTS, 'utf8')).shots.filter((s) => !process.env.FILTER || new RegExp(process.env.FILTER).test(s.name));
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const report = [];
const stdOf = () => {
  const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl');
  const px = new Uint8Array(g.drawingBufferWidth * g.drawingBufferHeight * 4);
  g.readPixels(0, 0, g.drawingBufferWidth, g.drawingBufferHeight, g.RGBA, g.UNSIGNED_BYTE, px);
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < px.length; i += 28) { const l = .2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2]; s += l; s2 += l * l; n++; }
  return +Math.sqrt(s2 / n - (s / n) ** 2).toFixed(1);
};
async function open(qs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base + qs, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  await page.addStyleTag({ content: '.lbl{display:none!important}' });
  return page;
}
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
{
  const page = await open('?zone=pond&cam=oblique');
  await frame(page);
  const f = path.join(dir, `browser-zone-pond-oblique.png`);
  const std255 = await page.evaluate(stdOf);
  await page.screenshot({ path: f });
  report.push({ shot: 'zone-pond-oblique', file: f, std255, zonesLoaded: await page.evaluate(() => window.__zonesLoaded) });
  await page.close();
}
{
  const page = await open('?zone=core&cam=oblique');
  for (const s of shots) {
    await page.evaluate(([p, t]) => window.__viewAt(p, t), [s.pos, s.tgt]);
    await frame(page);
    const f = path.join(dir, `browser-${s.name}.png`);
    const std255 = await page.evaluate(stdOf);
    await page.screenshot({ path: f });
    report.push({ shot: s.name, file: f, std255 });
    console.log('SHOT', s.name, std255);
  }
  report.push({ zonesLoaded: await page.evaluate(() => window.__zonesLoaded) });
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(dir, 'browser-report.json'), JSON.stringify(report, null, 1));
const blank = report.filter((r) => r.std255 !== undefined && r.std255 < 2);
if (blank.length) { console.error('BLANK', blank.map((b) => b.shot)); process.exit(1); }
console.log('browser shots', report.length);
