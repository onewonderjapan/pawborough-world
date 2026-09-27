// wave11-lighting：灯光 / 阴影成本测量（headless swiftshader —— 只作同机相对比较，不代表 W2 真显卡）。
// 每个配置（QS）开一个新页面，测：
//   首载字节：首载完成（window.__firstLoadReady）前所有 HTTP 响应的 body 字节，按类别（glb / tex / js / json / 其他）汇总，
//             另列「非场景资产」= js + json + 其他（灯光改动只可能动这一类）；
//   每帧绘制：tests/perf-lib.mjs 的独立 WebGL 计数（apiCalls / subDraws / triangles，静止机位 10 帧中位数）；
//   帧时：rAF 间隔中位数 / P90（新旧代码都能测）；另在有 window.__renderOnce（wave11 起 main.js 提供）时，
//         强制连续 render 20 次、每次后 readPixels 1 像素（等 GPU 做完），取中位数与 P90（ms），只隔离渲染本身。
// 机位：core-oblique（首屏）、tour huabaolou（最重）、tour sansuitang（眼高）。
// 用法：BASE=http://127.0.0.1:5491/ CONFIGS='day-shadow=&light=day,day-noshadow=&shadow=0' REPORT=<json> node scripts/lighting-perf.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { glCounterInit, frameCounts } from '../tests/perf-lib.mjs';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5491/';
const CONFIGS = (process.env.CONFIGS || 'default=').split(',').map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
const VIEWS = [['core-oblique', null], ['tour-huabaolou', 'huabaolou'], ['tour-sansuitang', 'sansuitang']];
const REPS = +(process.env.REPS || 20);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const report = { base: BASE, note: 'swiftshader：只作同机相对比较', reps: REPS, configs: {} };
for (const [name, qs] of CONFIGS) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(glCounterInit);
  const bytes = { glb: 0, tex: 0, js: 0, json: 0, other: 0 }, files = {};
  let firstDone = false;
  page.on('response', async (r) => {
    if (firstDone) return;
    try {
      const u = new URL(r.url()); const b = (await r.body()).length;
      const p = u.pathname;
      const k = /\.glb$/.test(p) ? 'glb' : /^\/out\/tex\//.test(p) ? 'tex' : /\.m?js$/.test(p) ? 'js' : /\.json$/.test(p) ? 'json' : 'other';
      if (firstDone) return;
      bytes[k] += b; files[p] = b;
    } catch { /* redirects / aborted */ }
  });
  const t0 = Date.now();
  await page.goto(BASE + '?zone=core&cam=oblique' + qs, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });
  firstDone = true;
  const firstLoadWallMs = Date.now() - t0;
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  const rec = { qs, firstLoadWallMs, firstLoadBytes: { ...bytes, nonScene: bytes.js + bytes.json + bytes.other }, firstLoadFiles: files, views: {} };
  rec.lighting = await page.evaluate(() => (window.__lighting ? window.__lighting.state() : null));
  for (const [vn, tour] of VIEWS) {
    if (tour) {
      await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
      await page.evaluate((k) => window.__tour(k), tour);
    }
    const counts = await frameCounts(page);
    const timing = await page.evaluate(async (reps) => {
      const out = {};
      // rAF 间隔（新旧代码都能测；headless 下含合成开销）
      const ts = []; let last = null;
      await new Promise(res => { const f = (t) => { if (last !== null) ts.push(t - last); last = t; if (ts.length >= reps) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      ts.sort((a, b) => a - b);
      out.rafMedianMs = +ts[Math.floor(ts.length / 2)].toFixed(1); out.rafP90Ms = +ts[Math.floor(ts.length * 0.9)].toFixed(1);
      // 强制渲染 + readPixels 同步（只隔离渲染本身；需要 window.__renderOnce）
      if (typeof window.__renderOnce === 'function') {
        const gl = document.querySelector('#app canvas').getContext('webgl2');
        const px = new Uint8Array(4);
        const rs = [];
        for (let i = 0; i < reps + 3; i++) {
          const t = performance.now();
          window.__renderOnce();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          if (i >= 3) rs.push(performance.now() - t);
        }
        rs.sort((a, b) => a - b);
        out.renderMedianMs = +rs[Math.floor(rs.length / 2)].toFixed(1); out.renderP90Ms = +rs[Math.floor(rs.length * 0.9)].toFixed(1);
      }
      return out;
    }, REPS);
    rec.views[vn] = { apiCalls: counts.apiCalls, subDraws: counts.subDraws, triangles: counts.triangles, ...timing };
    console.log(name.padEnd(16), vn.padEnd(16), JSON.stringify(rec.views[vn]));
  }
  console.log(name.padEnd(16), 'first-load bytes', JSON.stringify(rec.firstLoadBytes));
  report.configs[name] = rec;
  await page.close();
}
await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
