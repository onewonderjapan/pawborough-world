// wave4-drawcalls：浏览器 draw call / 三角面口径检查（headless swiftshader；数字只看口径，不代表真实帧时）。
// 独立计数：页面启动前给 WebGL 上下文打桩（drawElements/drawArrays/…Instanced/drawRangeElements +
// WEBGL_multi_draw 的四个 multiDraw* 方法），每个 rAF 记一次增量 = 一帧里真正发给 WebGL 的调用数。
// 这份计数不经过 three.js 的 renderer.info，所以能拿来核对 web/perf.js 报的数。
//   apiCalls  = WebGL 绘制 API 调用次数（一次 multiDraw 算 1，与 three 的 info.render.calls 同口径）
//   subDraws  = 子绘制数（multiDraw 的 drawcount 逐个算；无 multi_draw 时与 apiCalls 相等）
//   triangles = 本帧 TRIANGLES 模式下的三角面数（multiDraw 各段 counts 相加）
// 断言：
//   P1 ?perf=1 的 report.renderer.drawCalls / triangles 与独立计数的一帧相符（±3%）——修前是两帧之和（2×），失败；
//   B1 核心视图（?zone=core&cam=oblique，首屏机位）与园区全开视图（?zone=garden&cam=oblique，其余分区照常全部加载）
//      每帧 apiCalls 与 subDraws 都 ≤ BUDGET（默认 1200）；
//   B2 每个视图三角面 ≤ 同机位 ?batch=0（运行时合批关闭，= 改前渲染路径）；
//   B3 同机位 canvas 逐像素差异：?batch=0 对默认（合批）非边缘差异像素 < 1%（口径见 pixelDiff）；
//   B4（给 BEFORE_DIR 时）与改前代码存下的 canvas 图逐像素比，同一口径 < 1%。
// 用法：BASE=http://127.0.0.1:5494/ [PERF=0] [BUDGET=1200] [VIEWS=core-oblique,garden-oblique,...]
//       [SHOT_DIR=<目录>] [BEFORE_DIR=<目录>] [REPORT=<json>] [AB=0] node tests/perf-drawcalls-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { glCounterInit, settle, frameCounts, canvasPng, pixelDiff, savePng, CH_TOL, EDGE_GRAD, PIX_MAX } from './perf-lib.mjs';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5494/';
const BUDGET = +(process.env.BUDGET || 1200);
const RUN_PERF = process.env.PERF !== '0';
const AB = process.env.AB !== '0';
const SHOT_DIR = process.env.SHOT_DIR || null;
const BEFORE_DIR = process.env.BEFORE_DIR || null;
// 视图：URL 参数 + 可选导览机位（__tour）。budget=true 的视图参与 B1 预算断言。
const ALL_VIEWS = {
  'core-oblique': { qs: '?zone=core&cam=oblique', budget: true },
  'garden-oblique': { qs: '?zone=garden&cam=oblique', budget: true },
  'core-low': { qs: '?zone=core&cam=low' },
  'temple-oblique': { qs: '?zone=temple&cam=oblique' },
  'tour-anchor-main': { qs: '?zone=core&cam=oblique', tour: 'anchor-main' },
  'tour-sansuitang': { qs: '?zone=core&cam=oblique', tour: 'sansuitang' },
  'tour-huabaolou': { qs: '?zone=core&cam=oblique', tour: 'huabaolou' },
};
const VIEWS = (process.env.VIEWS ?? Object.keys(ALL_VIEWS).join(',')).split(',').filter(Boolean);
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
async function openPage(qs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(glCounterInit);
  const t0 = Date.now();
  await page.goto(BASE + qs, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  return { page, loadMs: Date.now() - t0 };
}
async function gotoView(page, v) {
  if (v.tour) {
    await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
    await page.evaluate((k) => window.__tour(k), v.tour);
  }
}
let fails = 0;
const fail = (m) => { console.error('FAIL', m); fails++; };
const report = { base: BASE, budget: BUDGET, pixelRule: { chTol: CH_TOL, edgeGrad: EDGE_GRAD, maxNonEdgeShare: PIX_MAX }, views: {} };

// ---------- 各视图：默认（合批）与 ?batch=0 ----------
for (const name of VIEWS) {
  const v = ALL_VIEWS[name];
  if (!v) { fail(`unknown view ${name}`); continue; }
  const r = { qs: v.qs, tour: v.tour || null };
  const { page, loadMs } = await openPage(v.qs);
  await gotoView(page, v);
  r.batched = await frameCounts(page);
  r.batched.loadMs = loadMs;
  r.batched.loadedBytes = await page.evaluate(() => window.__loadedBytes ?? null);
  const png = await canvasPng(page);
  if (SHOT_DIR) { savePng(path.join(SHOT_DIR, `${name}.png`), png); await page.screenshot({ path: path.join(SHOT_DIR, `${name}.page.png`) }); }
  if (v.budget) {
    if (r.batched.apiCalls > BUDGET) fail(`B1 ${name}: 每帧 WebGL 绘制调用 ${r.batched.apiCalls} > ${BUDGET}`);
    if (r.batched.subDraws > BUDGET) fail(`B1 ${name}: 每帧子绘制 ${r.batched.subDraws} > ${BUDGET}`);
  }
  if (AB) {
    const { page: p0, loadMs: l0 } = await openPage(v.qs + '&batch=0');
    await gotoView(p0, v);
    r.unbatched = await frameCounts(p0);
    r.unbatched.loadMs = l0;
    const png0 = await canvasPng(p0);
    if (r.batched.triangles > r.unbatched.triangles) fail(`B2 ${name}: 三角面 ${r.batched.triangles} > batch=0 的 ${r.unbatched.triangles}`);
    const d = await pixelDiff(page, png0, png);
    if (d.error) fail(`B3 ${name}: ${d.error}`);
    else {
      r.pixelDiffVsBatch0 = { share: d.share, rawShare: d.rawShare, diffPixels: d.diffPixels, edgePixels: d.edgePixels };
      if (d.share >= PIX_MAX) fail(`B3 ${name}: 非边缘差异像素 ${(d.share * 100).toFixed(3)}% ≥ 1%`);
      if (SHOT_DIR) { savePng(path.join(SHOT_DIR, `${name}.batch0.png`), png0); savePng(path.join(SHOT_DIR, `${name}.diff-vs-batch0.png`), d.png); }
    }
    await p0.close();
  }
  if (BEFORE_DIR) {
    const bf = path.join(BEFORE_DIR, `${name}.png`);
    if (!fs.existsSync(bf)) fail(`B4 ${name}: 缺改前图 ${bf}`);
    else {
      const d = await pixelDiff(page, 'data:image/png;base64,' + fs.readFileSync(bf).toString('base64'), png);
      if (d.error) fail(`B4 ${name}: ${d.error}`);
      else {
        r.pixelDiffVsBefore = { share: d.share, rawShare: d.rawShare, diffPixels: d.diffPixels, edgePixels: d.edgePixels };
        if (d.share >= PIX_MAX) fail(`B4 ${name}: 与改前非边缘差异像素 ${(d.share * 100).toFixed(3)}% ≥ 1%`);
        if (SHOT_DIR) savePng(path.join(SHOT_DIR, `${name}.diff-vs-before.png`), d.png);
      }
    }
  }
  await page.close();
  report.views[name] = r;
  console.log(name.padEnd(18), 'batched', JSON.stringify({ api: r.batched.apiCalls, sub: r.batched.subDraws, tris: r.batched.triangles }),
    r.unbatched ? 'batch=0 ' + JSON.stringify({ api: r.unbatched.apiCalls, sub: r.unbatched.subDraws, tris: r.unbatched.triangles }) : '',
    r.pixelDiffVsBatch0 ? `diff ${(r.pixelDiffVsBatch0.share * 100).toFixed(3)}% (raw ${(r.pixelDiffVsBatch0.rawShare * 100).toFixed(3)}%)` : '',
    r.pixelDiffVsBefore ? `vsBefore ${(r.pixelDiffVsBefore.share * 100).toFixed(3)}% (raw ${(r.pixelDiffVsBefore.rawShare * 100).toFixed(3)}%)` : '');
}

// ---------- P1：?perf=1 的 renderer 口径 = 一帧 ----------
if (RUN_PERF) {
  const { page } = await openPage('?perf=1');
  const ref = await (async () => { const { page: p2 } = await openPage(''); const f = await frameCounts(p2); await p2.close(); return f; })();
  await page.waitForFunction(() => typeof window.__perfResult === 'function' && window.__perfResult() !== null, null, { timeout: 900000, polling: 2000 });
  const perf = await page.evaluate(() => window.__perfResult());
  report.perf = perf;
  report.perfReferenceFrame = ref;
  const rel = (a, b) => Math.abs(a - b) / Math.max(1, b);
  const rc = perf.renderer || {};
  console.log('perf.renderer', JSON.stringify(rc), 'independent 1 frame', JSON.stringify({ api: ref.apiCalls, tris: ref.triangles }));
  if (!(rel(rc.drawCalls, ref.apiCalls) <= 0.03)) fail(`P1 perf drawCalls ${rc.drawCalls} ≠ 一帧 WebGL 调用 ${ref.apiCalls}（比值 ${(rc.drawCalls / ref.apiCalls).toFixed(2)}）`);
  if (!(rel(rc.triangles, ref.triangles) <= 0.03)) fail(`P1 perf triangles ${rc.triangles} ≠ 一帧三角面 ${ref.triangles}（比值 ${(rc.triangles / ref.triangles).toFixed(2)}）`);
  if (perf.walkError) fail(`P1 perf 步行巡游出错：${perf.walkError}`);
  await page.close();
}
await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`perf-drawcalls-check: ${fails} fail`); process.exit(1); }
console.log('perf-drawcalls-check: all pass');
