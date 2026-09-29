// wave9-sharedtex：浏览器实测「运行时同内容贴图只被下载一次」+ 同机位像素对照（headless Chromium + swiftshader）。
// 口径 = 实际网络请求（page 'request' / 'response' 事件，含内存缓存命中也计一次请求，所以只会多算不会少算）：
//   进 ?zone=all（核心首载 → 外围 deferred 自动拉），__ready 后点「方浜中路」按钮（on-demand 件），全部件到齐后：
//   N1 每个 GLB / /out/tex/ 请求的 URL 只请求一次；
//   N2 所有下载内容里（GLB 响应体里内嵌的图 + tex/ 响应体），同一图内容（sha256）只出现一次；
//   N3 首载字节（__firstLoadReady 置 true 之前完成的 GLB + tex 响应体字节）== manifest 首载件的 GLB 字节 + 其外置图并集字节，≤ 20 MB；
//   N4 viewer __loadTimes.firstLoadBytes 与 N3 同值（viewer 口径含外置图）；
//   N5 场景里带贴图的材质数 > 0，且每个 map 的 image 已解码（宽高 > 0）——外置图真的挂上了。
// 像素：SHOT_DIR 下存各机位 canvas PNG；给 REF_DIR（改前同一脚本存的图）时逐像素比：
//   严格口径 = 任一通道差 > 0 的像素数；fixed-order 遍断言 ≤ PIXEL_TOL（默认 0），default 遍只报告（见下方像素段注释）。
// 用法：BASE=http://127.0.0.1:5493/ OUT_DIR=out-zone [SHOT_DIR=…] [REF_DIR=…] [REPORT=…] node tests/shared-texture-browser-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5493/';
const SHOT_DIR = process.env.SHOT_DIR || null, REF_DIR = process.env.REF_DIR || null;
const PIXEL_TOL = +(process.env.PIXEL_TOL || 0);
// 噪声底（只报告）：改前产物自己重跑、default 遍同机位与 REF_DIR 比出的差异像素数（NOISE_REPORTS = 那几次 REPORT json，逗号分隔，逐机位取最大）。
const NOISE = {};
for (const f of (process.env.NOISE_REPORTS || '').split(',').filter(Boolean)) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [k, v] of Object.entries(r.pixels || {})) NOISE[k] = Math.max(NOISE[k] ?? 0, v.diffPixels);
}
const FIRST_LOAD_CAP = 20000000;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let pass = 0, fails = 0;
const check = (c, msg) => { if (c) { pass++; console.log('PASS', msg); } else { fails++; console.error('FAIL:', msg); } };

function glbImages(buf) {
  const jl = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const o = 20 + jl, bin = o + 8 <= buf.length ? buf.subarray(o + 8, o + 8 + buf.readUInt32LE(o)) : null;
  return (json.images || []).map(im => {
    if (im.bufferView === undefined) return { name: im.name, uri: im.uri };
    const bv = json.bufferViews[im.bufferView];
    return { name: im.name, bytes: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) };
  });
}
// manifest 期望（磁盘口径）：首载件 GLB 字节 + 其引用的外置图并集字节
const m = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const POL = new Set(['deferred', 'on-demand']);
const firstFiles = m.zones.filter(z => z.file && !POL.has(z.loadPolicy)).map(z => (z.cm ? z.cm.file : z.file));
let expFirst = 0; const expTex = new Set();
for (const f of firstFiles) {
  const b = fs.readFileSync(path.join(OUT, f)); expFirst += b.length;
  for (const im of glbImages(b)) if (im.uri && !expTex.has(im.uri)) { expTex.add(im.uri); expFirst += fs.statSync(path.join(OUT, im.uri)).size; }
}

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  let v = false;
  Object.defineProperty(window, '__firstLoadReady', { configurable: true, get: () => v, set: (x) => { v = x; if (x === true && window.__firstReadyAt == null) window.__firstReadyAt = Date.now(); } });
});
const requests = new Map();   // path -> count
const bodies = [];            // { path, kind, buf, t }
const pending = [];
// 用 page.route 截获 GLB 与 tex/ 请求并原样转发：Playwright 的 response.body() 对 fetch→blob 的图片响应返回空，
// 截获则拿得到真实响应体；截获同时关掉浏览器 HTTP 缓存，重复请求一定打到网络，计数只会偏严。
const isAsset = p => /^\/out\/.*\.glb$/.test(p) || p.startsWith('/out/tex/');
await page.route(u => isAsset(u.pathname), async route => {
  const p = new URL(route.request().url()).pathname;
  requests.set(p, (requests.get(p) || 0) + 1);
  const job = (async () => {
    const resp = await route.fetch();
    const buf = await resp.body();
    bodies.push({ path: p, kind: p.endsWith('.glb') ? 'glb' : 'tex', buf, t: Date.now() });
    await route.fulfill({ response: resp, body: buf });
  })();
  pending.push(job.catch(e => bodies.push({ path: p, err: String(e) })));
  await job.catch(() => {});
});
await page.goto(BASE + '?zone=all&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
const firstReadyAt = await page.evaluate(() => window.__firstReadyAt);
const lt = await page.evaluate(() => window.__loadTimes);
await page.click('[data-zone="fangbang"]');
await page.waitForFunction(() => (window.__zonesLoaded || []).filter(k => k.startsWith('fangbang')).length >= 2, null, { timeout: 900000 });
await page.waitForTimeout(500);
await Promise.all(pending);

// N1 / N2
const dupUrls = [...requests.entries()].filter(([, n]) => n > 1);
check(dupUrls.length === 0, `N1 ${requests.size} 个 GLB / tex URL 各只请求一次（多次的：${dupUrls.map(([p, n]) => `${p}×${n}`).join(', ') || '无'}）`);
const seen = new Map();   // content sha -> [where]
for (const b of bodies.filter(b => b.buf)) {
  const items = b.kind === 'glb' ? glbImages(b.buf).filter(i => i.bytes).map(i => ({ h: sha(i.bytes), where: `${b.path.split('/').pop()}:${i.name}`, n: i.bytes.length })) : [{ h: sha(b.buf), where: b.path, n: b.buf.length }];
  for (const it of items) { if (!seen.has(it.h)) seen.set(it.h, []); seen.get(it.h).push(it); }
}
const dupContent = [...seen.values()].filter(v => v.length > 1);
const dupBytes = dupContent.reduce((s, v) => s + v[0].n * (v.length - 1), 0);
check(dupContent.length === 0, `N2 下载内容里 ${seen.size} 种图内容各只出现一次（重复 ${dupContent.length} 种，多下载 ${dupBytes} B；例 ${dupContent.slice(0, 3).map(v => `${v[0].where}×${v.length}`).join('、') || '无'}）`);
// N3 / N4
const firstBodies = bodies.filter(b => b.buf && b.t <= firstReadyAt);
const gotFirst = firstBodies.reduce((s, b) => s + b.buf.length, 0);
check(gotFirst === expFirst && gotFirst <= FIRST_LOAD_CAP, `N3 首载实下 ${gotFirst} B（${firstBodies.length} 个响应）== manifest 首载件 GLB + 外置图并集 ${expFirst} B ≤ ${FIRST_LOAD_CAP}`);
check(lt.firstLoadBytes === expFirst, `N4 viewer firstLoadBytes ${lt.firstLoadBytes} == ${expFirst}`);
// N5
const texState = await page.evaluate(() => {
  let mats = 0, bad = 0; const seenM = new Set();
  window.__scene.traverse(o => { if (!o.isMesh) return; for (const mt of [].concat(o.material)) { if (!mt || seenM.has(mt)) continue; seenM.add(mt);
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) { const t = mt[k]; if (!t) continue; mats++; const im = t.image || {}; if (!(im.width > 0 && im.height > 0)) bad++; } } });
  return { maps: mats, undecoded: bad, sharedTex: window.__sharedTex ? window.__sharedTex() : null };
});
check(texState.maps > 0 && texState.undecoded === 0, `N5 场景贴图槽 ${texState.maps} 个全部已解码（未解码 ${texState.undecoded}）`);
// N6 解码后贴图像素：逐（分区组 | 材质名 | 槽位）取 texture 解码像素的 sha256（位图画到 2D canvas 读回；KTX2 取 mipmaps[0] 数据），
//    与 TEX_REF（改前同一脚本 REPORT 里的 texPixels）逐项比 —— 贴图外置后 GPU 拿到的像素与内嵌时逐字节相同。
const texPixels = await page.evaluate(async () => {
  const out = {}; const cache = new Map();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  async function hashTex(t) {
    const src = t.source || t; if (cache.has(src.data || t.image)) return cache.get(src.data || t.image);
    let bytes;
    if (t.isCompressedTexture) bytes = t.mipmaps[0].data;
    else { const im = t.image; const c = new OffscreenCanvas(im.width, im.height); const g = c.getContext('2d'); g.drawImage(im, 0, 0); bytes = g.getImageData(0, 0, im.width, im.height).data; }
    const h = hex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 16);
    cache.set(src.data || t.image, h); return h;
  }
  const seenM = new Set();
  const jobs = [];
  window.__scene.traverse(o => {
    if (!o.isMesh || o.isBatchedMesh) return;
    let g = o; while (g && !String(g.name).startsWith('ZN-')) g = g.parent;
    for (const mt of [].concat(o.material)) {
      if (!mt || seenM.has(mt)) continue; seenM.add(mt);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        const t = mt[k]; if (!t) continue;
        const key = `${g ? g.name : '?'}|${mt.name}|${k}`;
        jobs.push(hashTex(t).then(h => { (out[key] = out[key] || []).push(`${h}:${t.name}:${t.flipY ? 1 : 0}:${t.colorSpace}:${t.wrapS}/${t.wrapT}:${t.minFilter}/${t.magFilter}`); }));
      }
    }
  });
  await Promise.all(jobs);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
});
const TEX_REF = process.env.TEX_REF ? JSON.parse(fs.readFileSync(process.env.TEX_REF, 'utf8')).texPixels : null;
if (TEX_REF) {
  const keys = [...new Set([...Object.keys(TEX_REF), ...Object.keys(texPixels)])];
  const bad = keys.filter(k => JSON.stringify(TEX_REF[k]) !== JSON.stringify(texPixels[k]));
  check(bad.length === 0, `N6 ${keys.length} 个（分区组 | 材质 | 槽位）解码像素 + 采样参数与改前全同（不同 ${bad.length}：${bad.slice(0, 3).join('、') || '无'}）`);
}

// 像素：固定机位
const VIEWS = [
  ['all-oblique', p => p.evaluate(() => window.__goto('all', 'oblique'))],
  ['core-oblique', p => p.evaluate(() => window.__goto('core', 'oblique'))],
  ['core-low', p => p.evaluate(() => window.__goto('core', 'low'))],
  ['temple-oblique', p => p.evaluate(() => window.__goto('temple', 'oblique'))],
  ['bazaar-low', p => p.evaluate(() => window.__goto('bazaar', 'low'))],
  ['tour-anchor-main', p => p.evaluate(() => { window.__goto('core', 'oblique'); window.__tour('anchor-main'); })],
  ['tour-sansuitang', p => p.evaluate(() => { window.__goto('core', 'oblique'); window.__tour('sansuitang'); })],
  ['tour-huabaolou', p => p.evaluate(() => { window.__goto('core', 'oblique'); window.__tour('huabaolou'); })],
  ['fangbang-street-east', p => p.evaluate(() => { window.__goto('fangbang', 'oblique'); window.__streetView('east'); })],
];
const settle = () => page.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k >= 12 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
async function diffVs(rf, url) {
  return page.evaluate(async ({ a, b }) => {
    const load = u => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { error: 'size' };
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height; const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0); const pa = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const pb = g.getImageData(0, 0, c.width, c.height).data;
    let diff = 0, maxd = 0, lumSum = 0, lumSq = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const dd = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (dd > 0) diff++; if (dd > maxd) maxd = dd;
      const l = .2126 * pb[i] + .7152 * pb[i + 1] + .0722 * pb[i + 2]; lumSum += l; lumSq += l * l;
    }
    const n = pa.length / 4, mean = lumSum / n;
    return { diffPixels: diff, maxChannelDiff: maxd, pixels: n, lumStd: +Math.sqrt(Math.max(0, lumSq / n - mean * mean)).toFixed(1) };
  }, { a: 'data:image/png;base64,' + fs.readFileSync(rf).toString('base64'), b: url });
}
// 两遍：
//   default     = 查看器原样渲染。three 的不透明排序先按 material.id，而 GLTFLoader 的材质要等贴图 Promise 兑现才创建，
//                 id 随异步完成顺序变 → 共面面（商铺招牌带 / 立面饰条）z-fighting 胜负随机。改前产物自己重跑就差 0–2216 像素，
//                 所以这一遍只报告（与 NOISE_REPORTS 噪声底并列），不断言；
//   fixed-order = 测试侧经 scene.onBeforeRender 把 renderer.sortObjects 关掉（改前 / 改后同一处理，查看器代码不动），
//                 绘制顺序 = 场景树顺序（分区按序加载，确定）→ 渲染确定；断言与改前逐像素相同（差异像素 ≤ PIXEL_TOL，默认 0）。
const pixels = {};
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
for (const mode of ['default', 'fixed-order']) {
  if (mode === 'fixed-order') await page.evaluate(() => { window.__scene.onBeforeRender = (r) => { r.sortObjects = false; }; });
  for (const [name, go] of VIEWS) {
    const shot = mode === 'default' ? name : `${name}.${mode}`;
    await go(page); await settle();
    const url = await page.evaluate(() => document.querySelector('#app canvas').toDataURL('image/png'));
    if (SHOT_DIR) fs.writeFileSync(path.join(SHOT_DIR, shot + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    if (!REF_DIR) continue;
    const rf = path.join(REF_DIR, shot + '.png');
    if (!fs.existsSync(rf)) { check(false, `P ${shot}: 缺改前图 ${rf}`); continue; }
    const d = await diffVs(rf, url);
    pixels[shot] = d;
    if (mode === 'default') {
      d.noiseFloor = NOISE[shot] ?? null;
      console.log(`INFO P ${shot}: 与改前同机位差异像素 ${d.diffPixels}（最大通道差 ${d.maxChannelDiff}/255）；改前自身重跑噪声底 ${d.noiseFloor ?? '未测'}（只报告）`);
    } else {
      check(!d.error && d.diffPixels <= PIXEL_TOL && d.lumStd >= 2, `P ${shot}: 与改前同机位差异像素 ${d.diffPixels}（最大通道差 ${d.maxChannelDiff}/255，亮度 std ${d.lumStd}）≤ ${PIXEL_TOL}`);
    }
  }
}
await browser.close();
const report = { base: BASE, requests: Object.fromEntries(requests), expFirst, gotFirst, loadTimes: lt, contents: seen.size, dupContents: dupContent.length, dupBytes,
  downloaded: { glb: bodies.filter(b => b.kind === 'glb').reduce((s, b) => s + (b.buf ? b.buf.length : 0), 0), tex: bodies.filter(b => b.kind === 'tex').reduce((s, b) => s + (b.buf ? b.buf.length : 0), 0) },
  texState, texPixels, pixels, pass, fails };
console.log(JSON.stringify({ downloaded: report.downloaded, contents: report.contents, dupContents: report.dupContents, dupBytes, requests: requests.size, sharedTex: texState.sharedTex ? Object.keys(texState.sharedTex.fetched).length : null }));
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
console.log(`shared-texture-browser-check: ${pass} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
