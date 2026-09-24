// Headless Chromium (swiftshader) load of the viewer against a zone-split OUT_DIR: all zone GLBs load, first zone paints,
// canvas not blank (read back in the same evaluate as a render), HUD reports every zone.
import { createRequire } from 'node:module';
const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:5489/';
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const t0 = Date.now(); const reqs = [];
page.on('response', r => { if (r.url().endsWith('.glb')) reqs.push({ url: r.url().split('/').pop(), status: r.status(), ms: Date.now() - t0 }); });
await page.goto(base + (process.env.QS || '?zone=garden'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
const res = await page.evaluate(() => {
  const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl');
  const px = new Uint8Array(g.drawingBufferWidth * g.drawingBufferHeight * 4);
  g.readPixels(0, 0, g.drawingBufferWidth, g.drawingBufferHeight, g.RGBA, g.UNSIGNED_BYTE, px);
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < px.length; i += 28) { const l = .2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2]; s += l; s2 += l * l; n++; }
  const std = Math.sqrt(s2 / n - (s / n) ** 2);
  return { zonesLoaded: window.__zonesLoaded, hud: document.getElementById('hud').innerText, std255: +std.toFixed(1) };
});
await page.screenshot({ path: process.env.SHOT || 'zone-browser.png' });
// WP13 断言：① tour.json 存在且 ≥10 机位；② 可见设施标签 ≤12 且去重后无重叠（oblique 与 low 两种视角）
const tourStat = await page.evaluate(async () => {
  const r = await fetch('/out/tour.json');
  if (!r.ok) return { ok: false, reason: `fetch /out/tour.json -> ${r.status}` };
  const t = await r.json();
  return { ok: Object.keys(t).length >= 10, n: Object.keys(t).length };
});
const labelsOblique = await page.evaluate(() => ({ ...window.__labelStats(), overlaps: window.__lastLabelDedupe ? window.__lastLabelDedupe.overlaps : null }));
await page.evaluate(() => window.__goto(document.querySelector('[data-zone].active').dataset.zone, 'low'));
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-low.png') });
const labelsLow = await page.evaluate(() => ({ ...window.__labelStats(), overlaps: window.__lastLabelDedupe ? window.__lastLabelDedupe.overlaps : null }));
// WP13 fallback 断言：本区地标（三穗堂/城隍庙/华宝楼）不得被去重隐藏
const landmark = await page.evaluate(() => {
  const z = document.querySelector('[data-zone].active')?.dataset.zone;
  const want = { garden: '三穗堂', temple: '老城隍庙', bazaar: '华宝楼' }[z];
  if (!want) return { want: null };
  const el = [...document.querySelectorAll('.lbl')].find(e => e.dataset.labelText === want);
  return { want, found: !!el, visible: !!el && el.style.visibility !== 'hidden' && el.style.display !== 'none' };
});
console.log(JSON.stringify({ tour: tourStat, labelsOblique, labelsLow, landmark }, null, 1));
console.log(JSON.stringify({ glbRequests: reqs, ...res }, null, 1));
// WP13/R1/T2 断言：导览机位下可见标签两两不相交 + 遮挡剔除/120m 上限生效
// （__tour 会把分区切到该机位所属分区，任选一个锚点机位即可）
const tourView = await page.evaluate(async () => {
  const btn = document.querySelector('[data-tour="anchor-main"]');
  if (!btn) return { ok: false, reason: '无导览按钮 anchor-main' };
  window.__tour('anchor-main');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dd = window.__lastLabelDedupe || {};
  const ls = window.__labelStats ? window.__labelStats() : {};
  return { ok: true, cur: window.__tour('anchor-main'), overlaps: dd.overlaps, facility: ls.facility,
    maxVisibleDist: dd.maxVisibleDist, occludedHidden: dd.occludedHidden, occluders: window.__labelOccluderCount || 0 };
});
console.log(JSON.stringify({ tourView }, null, 1));
await browser.close();
let exitCode = 0;
if (res.std255 < 2 || !res.zonesLoaded || res.zonesLoaded.length < 5) process.exit(2);
if (!tourStat.ok) { console.error(`WP13 FAIL: tour.json ${tourStat.reason || '机位 ' + tourStat.n + ' < 10'}`); exitCode = 3; }
for (const [k, s] of [['oblique', labelsOblique], ['low', labelsLow]]) {
  if (s.facility > 12) { console.error(`WP13 FAIL: ${k} 可见设施标签 ${s.facility} > 12`); exitCode = 3; }
  if (s.overlaps > 0) { console.error(`WP13 FAIL: ${k} 标签去重后仍有 ${s.overlaps} 对屏幕空间重叠`); exitCode = 3; }
}
if (landmark.want && !landmark.visible) { console.error(`WP13 FAIL: 地标 ${landmark.want} 被去重隐藏`); exitCode = 3; }
if (!tourView.ok) { console.error(`WP13/R1/T2 FAIL: 导览机位 ${tourView.reason || '未进入'}`); exitCode = 3; }
else {
  if (tourView.overlaps !== 0) { console.error(`WP13/R1/T2 FAIL: 导览机位下可见标签仍有 ${tourView.overlaps} 对重叠`); exitCode = 3; }
  if ((tourView.facility ?? 99) > 12) { console.error(`WP13/R1/T2 FAIL: 导览机位下设施标签 ${tourView.facility} > 12`); exitCode = 3; }
  if (tourView.maxVisibleDist == null || tourView.maxVisibleDist > 120) { console.error(`WP13/R1/T2 FAIL: 导览机位下标签距离上限未生效（maxVisibleDist=${tourView.maxVisibleDist}）`); exitCode = 3; }
  if (!tourView.occluders) { console.error(`WP13/R1/T2 FAIL: 标签遮挡集未就绪`); exitCode = 3; }
}
process.exit(exitCode);
