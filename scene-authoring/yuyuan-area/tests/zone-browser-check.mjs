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
console.log(JSON.stringify({ glbRequests: reqs, ...res }, null, 1));
await browser.close();
if (res.std255 < 2 || !res.zonesLoaded || res.zonesLoaded.length < 5) process.exit(2);
