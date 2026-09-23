// WP13/T1 tour.json headless 验收：加载 viewer 后逐机位 window.__tour(key)，
// 断言每个机位渲染非空白（亮度 std ≥ 2/255 且主色占比 < 95%），并逐张截图到 SHOT_DIR。
// WP13/R1/T2 新增断言（导览机位下）：
//   - 标签遮挡剔除已就绪（collision-* 加载，__labelOccluderCount > 0）；
//   - 可见标签两两不相交（__lastLabelDedupe.overlaps === 0）；
//   - 可见设施标签 ≤ 12；
//   - 距离上限：__lastLabelDedupe.maxVisibleDist ≤ 120 m；
//   - 遮挡剔除真实生效（全部机位合计被墙挡隐藏的标签 > 0）。
// 用法：BASE=http://127.0.0.1:<port>/ [SHOT_DIR=artifacts/r1/renders-new] node tests/tour-browser-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:5489/';
const shotDir = process.env.SHOT_DIR || null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base + '?zone=core&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
const keys = await page.evaluate(() => [...document.querySelectorAll('[data-tour]')].map(b => b.dataset.tour));
if (keys.length < 10) { console.error('tour buttons < 10:', keys); process.exit(2); }
let fails = 0, t2fails = 0, occludedTotal = 0;
const report = {};
for (const key of keys) {
  const stats = await page.evaluate(async (k) => {
    const cur = window.__tour(k);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    const px = new Uint8Array(g.drawingBufferWidth * g.drawingBufferHeight * 4);
    g.readPixels(0, 0, g.drawingBufferWidth, g.drawingBufferHeight, g.RGBA, g.UNSIGNED_BYTE, px);
    let s = 0, s2 = 0, n = 0; const cnt = new Map();
    for (let i = 0; i < px.length; i += 28) {
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      const l = .2126 * r + .7152 * gg + .0722 * b;
      s += l; s2 += l * l; n++;
      const kk = (r >> 4) + ',' + (gg >> 4) + ',' + (b >> 4);
      cnt.set(kk, (cnt.get(kk) || 0) + 1);
    }
    const mean = s / n;
    let dom = 0; for (const v of cnt.values()) dom = Math.max(dom, v);
    const dd = window.__lastLabelDedupe || {};
    const ls = window.__labelStats ? window.__labelStats() : {};
    return { cur, std255: +Math.sqrt(s2 / n - mean * mean).toFixed(1), domShare: +(dom / n).toFixed(3),
      overlaps: dd.overlaps, maxVisibleDist: dd.maxVisibleDist, occludedHidden: dd.occludedHidden, occludedGhost: dd.occludedGhost,
      distCapHidden: dd.distCapHidden, facility: ls.facility, occluders: window.__labelOccluderCount || 0 };
  }, key);
  const ok = stats.cur === key && stats.std255 >= 2 && stats.domShare < 0.95;
  // R1/T2 断言
  const t2ok = stats.overlaps === 0
    && (stats.facility ?? 99) <= 12
    && stats.maxVisibleDist != null && stats.maxVisibleDist <= 120
    && stats.occluders > 0;
  occludedTotal += (stats.occludedHidden || 0) + (stats.occludedGhost || 0);
  report[key] = { ...stats, ok, t2ok };
  console.log(key, JSON.stringify(stats), ok ? 'OK' : 'BLANK/FAIL', t2ok ? 'T2-OK' : 'T2-FAIL');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, key + '.png') });
  if (!ok) fails++;
  if (!t2ok) t2fails++;
}
const occReady = await page.evaluate(() => window.__labelOccluderCount || 0);
if (!occReady) { console.error('R1/T2 FAIL: 标签遮挡集未就绪（collision-* 未加载）'); t2fails++; }
if (occludedTotal <= 0) { console.error('R1/T2 FAIL: 11 个导览机位下没有任何标签被遮挡剔除（遮挡逻辑未生效）'); t2fails++; }
await browser.close();
if (fails) { console.error(`tour-browser-check: ${fails}/${keys.length} blank fail`); process.exit(2); }
if (t2fails) { console.error(`tour-browser-check(R1/T2): ${t2fails} fail`); process.exit(3); }
console.log(`tour-browser-check: ${keys.length} views non-blank; T2 occlusion/dist-cap/no-overlap all pass (occluded ${occludedTotal})`);
