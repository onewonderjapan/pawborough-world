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
//   S5 夜间：自发光按组命中（lantern / sign / shop-interior / window / lattice / stall / bazaar-window 在核心视图
//      各 ≥ 1 个材质——wave13 拆组后 lattice 5 + bazaar-window 6 = 原 lattice 11，实测口径见工单包 artifacts/b1/；
//      bazaar-window 组结构仍须出现在 state.emissiveByGroup，防查看器写死组清单）；白天 0 个材质被改；
//      点光池灯数 = presets.night.pointLights 且全部可见，候选（灯笼聚类 + 摊位锚点）≥ 20 且 = 本文件独立重算的候选数；
//      切导览机位后第一次 tick() 的灯位 = 独立重算的离焦点最近 N 个候选（三个机位连续切换，R1）；
//      九曲桥机位 night&plights=0 vs night&glow=0&plights=0：变亮 > 20/255 的像素 ≥ 0.5%（只差自发光）；
//      华宝楼机位 night vs night&glow=0&plights=0：变亮 > 20/255 的像素 ≥ 2%（夜间灯光整体看得见）。
//   S6 空白帧守卫：三档核心首屏亮度标准差 ≥ 8/255 且主色占比 < 95%；夜 < 黄昏 < 白天（平均亮度）。
//   S7 天空不下载贴图：首载期间没有 /lighting/ 下除 presets.json 以外的请求、没有图片类请求落在 /out/tex/ 以外；presets.json ≤ 16 KB。
// 用法：BASE=http://127.0.0.1:5491/ [OUT_DIR=out-zone] [ONLY=S5] [REPORT=<json>] [SHOT_DIR=<目录>] node tests/lighting-check.mjs
import { createRequire } from 'node:module';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glCounterInit, frameCounts } from './perf-lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5491/';
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;   // 例 ONLY=S5：只开 night 页跑夜间段（负对照用），其余段跳过
const want = (k) => !ONLY || ONLY.includes(k);
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


// Chromium 解析（wave14-viewerside R1 必修4：去个人绝对路径；CHROME_PATH 优先，否则 Playwright 自管/缓存扫描）
function resolveChromiumExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    if (fs.existsSync(chromium.executablePath())) return null;
  } catch { /* registry 未配置，走缓存扫描 */ }
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const revs = fs.readdirSync(cache)
      .map(d => { const m = /^chromium-(\d+)$/.exec(d); return m ? { d, rev: Number(m[1]) } : null; })
      .filter(Boolean).sort((a, b) => b.rev - a.rev);
    for (const { d } of revs) {
      const p = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 无默认缓存目录 */ }
  return null;
}

const exe = resolveChromiumExecutable();
// GPU_WEBGL=1：机器 swiftshader WebGL 全灭时的环境开关（headless:false + 外部 DISPLAY/XAUTHORITY），默认关闭。
const browser = await chromium.launch({ executablePath: exe, ...(process.env.GPU_WEBGL === '1' ? { headless: false } : {}), args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
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
  // R1：每个页面都必须真的落了预设（不是 3 s 超时后的旧灯光回退）——否则后面的 A/B 像素对照会拿两种灯光比
  const ls = await page.evaluate(() => (window.__lighting ? window.__lighting.state() : null));
  ok(ls && ls.preset && !ls.error, `page ${qs || '(default)'}: lighting presets applied (not legacy fallback)`, ls && { preset: ls.preset, error: ls.error, timedOut: ls.timedOut, lateApplied: ls.lateApplied, presetsMs: ls.presetsMs });
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
for (const n of (ONLY && !want('S1') ? ['night'] : [null, ...NAMES])) {
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
if (stats.day && stats.dusk && stats.night) ok(stats.night.mean < stats.dusk.mean && stats.dusk.mean < stats.day.mean, 'S6 mean luminance night < dusk < day', { day: stats.day.mean, dusk: stats.dusk.mean, night: stats.night.mean });

// ---------- S2 / S3：?shadow=0 ----------
if (pages.default) {
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
if (pages.default) { await pages.default.close(); delete pages.default; }   // 后面只用 night 页，默认页不再占 swiftshader

// ---------- S5：夜间 ----------
{
  const st = await lightState(pages.night);
  // wave13 拆组：商城楼 btk-winback 家族移入 bazaar-window 组（核心视图实测命中 6，lattice 5 = 厅堂/庙区背板）。
  const need = ['lantern', 'sign', 'shop-interior', 'window', 'lattice', 'stall', 'bazaar-window'];
  ok(st && need.every(g => (st.emissiveByGroup?.[g] || 0) >= 1), 'S5 night: every emissive group matched ≥ 1 material in core view', st && st.emissiveByGroup);
  // 组结构数据驱动：presets 全部发光组 id 都要被 state.emissiveByGroup 跟踪（防查看器按组名写死清单）。
  const allGroupIds = P.emissiveGroups.map(g => g.id);
  ok(st && st.emissiveByGroup && allGroupIds.every(g => g in st.emissiveByGroup), 'S5 night: every presets emissiveGroup id tracked in state (data-driven groups)', { presets: allGroupIds, state: st && Object.keys(st.emissiveByGroup || {}) });
  ok(st && st.pointLights === P.presets.night.pointLights && st.pointLightsVisible === st.pointLights, 'S5 night: point light pool = presets.night.pointLights, all placed', st && [st.pointLights, st.pointLightsVisible]);
  ok(st && st.candidates >= 20, 'S5 night: ≥ 20 point-light candidates (lantern clusters + stall anchors)', st && st.candidatesBySource);
  const onCand = await pages.night.evaluate(() => {
    const ls = []; window.__scene.traverse(o => { if (o.isPointLight && /^lighting-pool-/.test(o.name)) ls.push(o.position.toArray()); });
    return ls;
  });
  ok(onCand.length === P.presets.night.pointLights, 'S5 night: pool lights present in scene', onCand.length);
  // R1：切机位后第一次 tick() 的点光位置 = 独立算出的离焦点最近候选。
  // 候选在本文件里按 presets.json conventions 重算（灯笼材质世界顶点按 clusterM 分格取均值 + offsetY、摊位锚点 + offsetY），
  // 不调用 web/lighting.js 的任何函数；焦点 = 导览机位注视点（OUT_DIR/tour.json 的 t，轨道模式焦点 = controls.target）。
  // 三个导览机位连续切换、每次只 tick 一次（同一个同步 evaluate，中间没有 rAF）：连续三帧里至多一帧恰逢 reassignFrames 周期，
  // 所以只靠周期重分的实现必然有机位对不上（负对照记录见工单包 artifacts/r1/）。容差 1 m 覆盖阴影纹素对齐对焦点的偏移（≤ 0.3 m）。
  {
    const tourJson = JSON.parse(fs.readFileSync(path.join(OUT, 'tour.json'), 'utf8'));
    const seq = ['sansuitang', 'huabaolou', 'jiuqu-bridge'].map(k => ({ k, t: tourJson[k].t }));
    const res = await pages.night.evaluate(({ srcs, seq }) => {
      const base = (n) => String(n || '').replace(/\.\d{3}$/, '');
      const cand = [];
      window.__scene.updateMatrixWorld(true);
      for (const src of srcs) {
        if (src.kind === 'node-anchor') {
          const re = new RegExp(src.pattern);
          window.__scene.traverse(o => { if (re.test(o.name || '')) { const e = o.matrixWorld.elements; cand.push([e[12], e[13] + src.offsetY, e[14]]); } });
        } else {
          const cells = new Map();
          window.__scene.traverse(o => {
            if (!o.isMesh || o.isBatchedMesh || !o.geometry?.attributes?.position) return;
            const m = Array.isArray(o.material) ? o.material[0] : o.material;
            if (!m || !src.materials.includes(base(m.name))) return;
            const pa = o.geometry.attributes.position, e = o.matrixWorld.elements;
            for (let i = 0; i < pa.count; i++) {
              const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
              const w = e[3] * x + e[7] * y + e[11] * z + e[15];
              const X = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w, Y = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, Z = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
              const k = `${Math.floor(X / src.clusterM)},${Math.floor(Y / src.clusterM)},${Math.floor(Z / src.clusterM)}`;
              const c = cells.get(k) || [0, 0, 0, 0]; c[0] += X; c[1] += Y; c[2] += Z; c[3]++; cells.set(k, c);
            }
          });
          for (const c of cells.values()) cand.push([c[0] / c[3], c[1] / c[3] + src.offsetY, c[2] / c[3]]);
        }
      }
      const out = [];
      for (const { k, t } of seq) {
        window.__tour(k);
        window.__lighting.tick();   // 切机位后的第一次 tick
        const lights = []; window.__scene.traverse(o => { if (o.isPointLight && /^lighting-pool-/.test(o.name) && o.visible) lights.push(o.position.toArray()); });
        out.push({ k, t, lights });
      }
      return { cand, out, stateCandidates: window.__lighting.state().candidates };
    }, { srcs: P.pointLights.sources, seq });
    ok(res.cand.length === res.stateCandidates && res.cand.length >= 20, 'S5 night: independently recomputed candidates = viewer candidate count', { test: res.cand.length, viewer: res.stateCandidates });
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const n = P.presets.night.pointLights;
    for (const { k, t, lights } of res.out) {
      const ranked = res.cand.map(c => d3(c, t)).sort((x, y) => x - y);
      const kth = ranked[n - 1];
      const onCandidate = lights.every(l => res.cand.some(c => d3(c, l) < 1e-3));
      const maxD = Math.max(...lights.map(l => d3(l, t)));
      const distinct = new Set(lights.map(l => l.map(v => v.toFixed(3)).join(','))).size === lights.length;
      ok(lights.length === n && onCandidate && distinct && maxD <= kth + 1.0,
        `S5 night ${k}: first tick after camera switch places all ${n} pool lights on the ${n} nearest candidates`,
        { lights: lights.length, onCandidate, distinct, maxAssignedDist: +maxD.toFixed(2), nthNearest: +kth.toFixed(2) });
    }
  }
  // 自发光单独看：九曲桥导览机位（湖心亭窗 ht-win-glass、厅堂格扇背板在画面里），night&plights=0 vs night&glow=0&plights=0（两边都无点光，只差自发光）
  const { page: n0 } = await open('&light=night&plights=0');
  const { page: dark } = await open('&light=night&glow=0&plights=0');
  const pl = [await lightState(n0), await lightState(dark)].map(x => x && x.pointLights);
  const pn = [await lightState(n0), await lightState(dark)].map(x => x && x.preset);
  ok(pl[0] === 0 && pl[1] === 0 && pn[0] === 'night' && pn[1] === 'night', 'S5 night emissive A/B: both sides on the night preset with 0 point lights', { pointLights: pl, preset: pn });
  const a = await canvasAt(dark, 'jiuqu-bridge'), b = await canvasAt(n0, 'jiuqu-bridge');
  save('jiuqu-night-plights0.png', b); save('jiuqu-night-glow0-plights0.png', a);
  const d = await lumDiff(dark, a, b);
  stats.nightGlow = d;
  ok(d.brighter >= 0.005, 'S5 night jiuqu-bridge: emissive brightens ≥ 0.5% of pixels (>20/255), point lights off on both sides', d);
  await n0.close();
  // 华宝楼（商城楼套件）夜景整体：自发光 + 点光池 vs 两者都关（night&glow=0&plights=0）。
  // 只比自发光在这个机位不成立：套件楼上窗洞是 core__dark 整件的一部分（不改几何点不亮），底层店面玻璃 / 后壁被前排石库门挡住，
  // 实测 night vs glow=0 变亮像素仅 0.06%；点光池的灯位由上面的直接断言检查，这里只看整体夜间灯光看得见
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
