// wave11-lighting：查看器灯光预设 / 阴影 / 天空 / 夜间自发光的浏览器检查（headless swiftshader）。
// 期望值从 lighting/presets.json 独立重算（太阳方向按 conventions 的方位角 / 高度角公式在本文件里重写一遍，不 import web/lighting.js）。
// 断言：
//   S0 presets.json：day / dusk / night 三档齐、default = day；每档 sun / ambient / sky / exposure / emissiveScale / pointLights 字段齐；
//      pointLights ≤ pointLights.max ≤ 8（实测上限，见 docs/PERF-W2.md 灯光段）；emissiveGroups 材质名不重复。
//   S1 预设落地：无 ?light 时 = day；?light=dusk / night 各自生效；太阳方向（≤ 1e-3）、太阳 / 环境光强度与颜色、曝光、
//      色调映射 = neutral、背景 = 天空贴图（不是纯色）逐项等于 presets.json。
//   S2 阴影：默认开（shadowMap.enabled、太阳 castShadow、投影网格 > 0，且场景里每个 BatchedMesh 都 cast + receive）；
//      ?shadow=0 全关（shadowMap 关、没有任何网格 castShadow）。
//   S3 阴影看得见：三穗堂 / 华宝楼导览机位，默认 vs ?shadow=0 同机位 canvas：亮度下降 > 20/255 的像素 ≥ 2%。
//   S4 绘制预算：核心首屏（?zone=core&cam=oblique）开阴影后每帧 WebGL 绘制调用（独立计数，含阴影通道）≤ 1200（同 perf-drawcalls B1）。
//   S5 夜间：自发光按组命中（lantern / sign / shop-interior / window / lattice / stall 在核心区各 ≥ 1 个材质）；白天 0 个材质被改；
//      点光池灯数 = presets.night.pointLights，全部可见且都在候选位置上，候选（灯笼聚类 + 摊位锚点）≥ 20；
//      九曲桥机位 night vs night&glow=0：变亮 > 20/255 的像素 ≥ 0.5%（自发光看得见）；
//      华宝楼机位 night vs night&glow=0&plights=0：变亮 > 20/255 的像素 ≥ 2%（夜间灯光整体看得见，切机位后点光当帧跟上）。
//   S6 空白帧守卫：三档核心首屏亮度标准差 ≥ 8/255 且主色占比 < 95%；夜 < 黄昏 < 白天（平均亮度）。
//   S7 天空不下载贴图：首载期间没有 /lighting/ 下除 presets.json 以外的请求、没有图片类请求落在 /out/tex/ 以外；presets.json ≤ 16 KB。
// 用法：BASE=http://127.0.0.1:5491/ [REPORT=<json>] [SHOT_DIR=<目录>] node tests/lighting-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glCounterInit, frameCounts } from './perf-lib.mjs';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5491/';
const SHOT_DIR = process.env.SHOT_DIR || null;
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
const PRESETS_FILE = path.join(ROOT, 'lighting', 'presets.json');
const P = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
let fails = 0, passes = 0;
const report = { checks: [] };
const ok = (cond, msg, data) => { report.checks.push({ pass: !!cond, msg, data }); if (cond) passes++; else { fails++; console.error('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };

// ---------- S0 ----------
const NAMES = ['day', 'dusk', 'night'];
ok(P.default === 'day', 'S0 default = day', P.default);
for (const n of NAMES) {
  const p = P.presets?.[n];
  ok(p && p.sun && p.ambient && p.sky && typeof p.exposure === 'number' && typeof p.emissiveScale === 'number' && Number.isInteger(p.pointLights), `S0 preset ${n} fields`, p ? Object.keys(p) : null);
  ok(p && p.pointLights <= P.pointLights.max, `S0 ${n} pointLights ≤ max`, p && [p.pointLights, P.pointLights.max]);
}
ok(P.pointLights.max <= 8, 'S0 pointLights.max ≤ 8', P.pointLights.max);
const allMats = P.emissiveGroups.flatMap(g => g.materials);
ok(new Set(allMats).size === allMats.length, 'S0 emissiveGroups material names unique', allMats.length);
ok(fs.statSync(PRESETS_FILE).size <= 16384, 'S7 presets.json ≤ 16 KB', fs.statSync(PRESETS_FILE).size);

// 独立重算的太阳方向（presets conventions：方位角从北 -z 顺时针到东 +x）
const sunDir = (s) => { const az = s.azimuthDeg * Math.PI / 180, el = s.elevationDeg * Math.PI / 180; return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]; };
const hex = (h) => h.toLowerCase().replace('#', '');

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
async function open(qs, { counter = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  if (counter) await page.addInitScript(glCounterInit);
  const reqs = [];
  let first = true;
  page.on('request', r => { if (first) reqs.push(new URL(r.url()).pathname); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '?zone=core&cam=oblique' + qs, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });
  first = false;
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
  return { page, reqs, errors };
}
const settle = (page) => page.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k >= 8 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
const lightState = (page) => page.evaluate(() => (window.__lighting ? window.__lighting.state() : null));
const shadowFlags = (page) => page.evaluate(() => {
  let batches = 0, batchesShadow = 0, casters = 0;
  window.__scene.traverse(o => { if (o.isBatchedMesh) { batches++; if (o.castShadow && o.receiveShadow) batchesShadow++; } if (o.isMesh && o.castShadow) casters++; });
  return { batches, batchesShadow, casters };
});
async function canvasAt(page, tour) {
  if (tour) await page.evaluate((k) => window.__tour(k), tour); else await page.evaluate(() => window.__goto('core', 'oblique'));
  await settle(page);
  return page.evaluate(() => document.querySelector('#app canvas').toDataURL('image/png'));
}
async function imgStats(page, url) {
  return page.evaluate(async (url) => {
    const im = new Image(); im.src = url; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width, im.height).data;
    let s = 0, s2 = 0, n = 0; const hist = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; s2 += l * l; n++;
      const k = (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4); hist.set(k, (hist.get(k) || 0) + 1);
    }
    return { mean: +(s / n).toFixed(2), std: +Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)).toFixed(2), dominant: +(Math.max(...hist.values()) / n).toFixed(4) };
  }, url);
}
// b 相对 a 的亮度变化：darker = a−b > 20/255 的像素占比，brighter = b−a > 20/255
async function lumDiff(page, aUrl, bUrl) {
  return page.evaluate(async ({ aUrl, bUrl }) => {
    const load = async (u) => { const im = new Image(); im.src = u; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
    const A = await load(aUrl), B = await load(bUrl);
    let dk = 0, br = 0; const n = A.length / 4;
    for (let i = 0; i < A.length; i += 4) {
      const la = 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2], lb = 0.2126 * B[i] + 0.7152 * B[i + 1] + 0.0722 * B[i + 2];
      if (la - lb > 20) dk++; else if (lb - la > 20) br++;
    }
    return { darker: +(dk / n).toFixed(4), brighter: +(br / n).toFixed(4) };
  }, { aUrl, bUrl });
}
const save = (name, url) => { if (SHOT_DIR) fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(url.split(',')[1], 'base64')); };

// ---------- S1 / S2 / S4 / S6：三档各开一页 ----------
const pages = {};
const stats = {};
for (const n of [null, ...NAMES]) {
  const key = n || 'default';
  const { page, reqs, errors } = await open(n ? '&light=' + n : '', { counter: n === null });
  pages[key] = page;
  const st = await lightState(page);
  const expectName = n || 'day';
  const p = P.presets[expectName];
  ok(st && st.preset === expectName, `S1 ${key}: preset = ${expectName}`, st && st.preset);
  if (st) {
    const sd = sunDir(p.sun);
    ok(st.sunDir.every((v, i) => Math.abs(v - sd[i]) <= 1e-3), `S1 ${key}: sun direction = presets`, { got: st.sunDir, want: sd.map(v => +v.toFixed(4)) });
    ok(Math.abs(st.sun.intensity - p.sun.intensity) < 1e-6 && st.sun.color === '#' + hex(p.sun.color), `S1 ${key}: sun intensity / colour`, st.sun);
    ok(Math.abs(st.hemi.intensity - p.ambient.intensity) < 1e-6 && st.hemi.sky === '#' + hex(p.ambient.sky) && st.hemi.ground === '#' + hex(p.ambient.ground), `S1 ${key}: ambient`, st.hemi);
    ok(Math.abs(st.exposure - p.exposure) < 1e-6 && st.toneMapping === 'neutral', `S1 ${key}: exposure / tone mapping`, [st.exposure, st.toneMapping]);
    ok(st.background === 'sky-texture', `S1 ${key}: background = sky texture`, st.background);
  }
  ok(!errors.length, `${key}: no page errors`, errors);
  if (n === null) {
    const f = await shadowFlags(page);
    ok(st && st.shadowMapEnabled && st.sun.castShadow && st.shadowCasters > 0, 'S2 default: shadow map on, sun casts, casters > 0', st && { enabled: st.shadowMapEnabled, cast: st.sun.castShadow, casters: st.shadowCasters });
    ok(f.batches > 0 && f.batchesShadow === f.batches, 'S2 default: every BatchedMesh casts + receives', f);
    const fc = await frameCounts(page);
    stats.coreFrame = fc;
    ok(fc.apiCalls <= 1200 && fc.subDraws <= 1200, 'S4 core first view: per-frame WebGL draws (incl. shadow pass) ≤ 1200', { api: fc.apiCalls, sub: fc.subDraws });
    const bad = reqs.filter(r => (r.startsWith('/lighting/') && r !== '/lighting/presets.json') || (/\.(png|jpe?g|webp|hdr|exr|ktx2)$/i.test(r) && !r.startsWith('/out/tex/') && !r.startsWith('/out/')));
    ok(bad.length === 0 && reqs.includes('/lighting/presets.json'), 'S7 first load: only presets.json under /lighting/, no sky image download', bad);
  }
  if (n === 'day' || n === null) ok(st && st.matchedMaterials === 0, `S5 ${key}: no emissive change in day`, st && st.matchedMaterials);
  const core = await canvasAt(page, null);
  stats[key] = await imgStats(page, core);
  save(`core-${key}.png`, core);
  ok(stats[key].std >= 8 && stats[key].dominant < 0.95, `S6 ${key}: core view not blank`, stats[key]);
  // swiftshader 下每个打开的页面都在 rAF 里持续渲染（含阴影通道）；后面用不到的页面立即关掉，免得几页同时抢 CPU
  if (key !== 'default' && key !== 'night') { await page.close(); delete pages[key]; }
}
ok(stats.night.mean < stats.dusk.mean && stats.dusk.mean < stats.day.mean, 'S6 mean luminance night < dusk < day', { day: stats.day.mean, dusk: stats.dusk.mean, night: stats.night.mean });

// ---------- S2 / S3：?shadow=0 ----------
{
  const { page } = await open('&shadow=0');
  const st = await lightState(page);
  const f = await shadowFlags(page);
  ok(st && !st.shadowMapEnabled && f.casters === 0, 'S2 ?shadow=0: shadow map off, no casters', { enabled: st && st.shadowMapEnabled, casters: f.casters });
  for (const tour of ['sansuitang', 'huabaolou']) {
    const a = await canvasAt(pages.default, tour), b = await canvasAt(page, tour);
    save(`${tour}-shadow.png`, a); save(`${tour}-noshadow.png`, b);
    const d = await lumDiff(page, b, a);   // 开阴影相对关阴影变暗
    stats['shadow-' + tour] = d;
    ok(d.darker >= 0.02, `S3 ${tour}: shadows darken ≥ 2% of pixels (>20/255)`, d);
  }
  await page.close();
}
await pages.default.close(); delete pages.default;   // 后面只用 night 页，默认页不再占 swiftshader

// ---------- S5：夜间 ----------
{
  const st = await lightState(pages.night);
  const need = ['lantern', 'sign', 'shop-interior', 'window', 'lattice', 'stall'];
  ok(st && need.every(g => (st.emissiveByGroup?.[g] || 0) >= 1), 'S5 night: every emissive group matched ≥ 1 material in core', st && st.emissiveByGroup);
  ok(st && st.pointLights === P.presets.night.pointLights && st.pointLightsVisible === st.pointLights, 'S5 night: point light pool = presets.night.pointLights, all placed', st && [st.pointLights, st.pointLightsVisible]);
  ok(st && st.candidates >= 20, 'S5 night: ≥ 20 point-light candidates (lantern clusters + stall anchors)', st && st.candidatesBySource);
  const onCand = await pages.night.evaluate(() => {
    const ls = []; window.__scene.traverse(o => { if (o.isPointLight && /^lighting-pool-/.test(o.name)) ls.push(o.position.toArray()); });
    return ls;
  });
  ok(onCand.length === P.presets.night.pointLights, 'S5 night: pool lights present in scene', onCand.length);
  // 自发光单独看：九曲桥导览机位（湖心亭窗 ht-win-glass、厅堂格扇背板在画面里），night vs night&glow=0（点光两边相同）
  const { page: g0 } = await open('&light=night&glow=0');
  const a = await canvasAt(g0, 'jiuqu-bridge'), b = await canvasAt(pages.night, 'jiuqu-bridge');
  save('jiuqu-night.png', b); save('jiuqu-night-glow0.png', a);
  const d = await lumDiff(g0, a, b);
  stats.nightGlow = d;
  ok(d.brighter >= 0.005, 'S5 night jiuqu-bridge: emissive brightens ≥ 0.5% of pixels (>20/255)', d);
  await g0.close();
  // 华宝楼（商城楼套件）夜景整体：自发光 + 点光池 vs 两者都关（night&glow=0&plights=0）。
  // 只比自发光在这个机位不成立：套件楼上窗洞是 core__dark 整件的一部分（不改几何点不亮），底层店面玻璃 / 后壁被前排石库门挡住，
  // 实测 night vs glow=0 变亮像素仅 0.06%；点光池切机位后当帧重分（web/lighting.js），广场与店面由点光照亮
  const { page: dark } = await open('&light=night&glow=0&plights=0');
  const c = await canvasAt(dark, 'huabaolou'), e = await canvasAt(pages.night, 'huabaolou');
  save('huabaolou-night.png', e); save('huabaolou-night-dark.png', c);
  const d2 = await lumDiff(dark, c, e);
  stats.nightLightsHuabaolou = d2;
  ok(d2.brighter >= 0.02, 'S5 night huabaolou: emissive + point-light pool brighten ≥ 2% of pixels (>20/255)', d2);
  await dark.close();
}
for (const p of Object.values(pages)) await p.close();
await browser.close();
report.stats = stats; report.passes = passes; report.fails = fails;
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
console.log(`lighting-check: ${passes} pass, ${fails} fail`);
if (fails) process.exit(1);
