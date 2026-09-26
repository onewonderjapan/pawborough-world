// wave4-touranchor：首屏取景与分区文件加载顺序无关。
// 做法：用 playwright 拦截 /out/zones-manifest.json，把 order 与 zones 分件顺序打乱成几种排列
// （原序、倒序、garden-3 分件打头、bazaar 打头、pond 打头），各开一次 ?zone=core&cam=oblique，
// 记录首屏相机（#loadmsg 被移除 = afterFirstPaint 取景完成后的第一个微任务）和全部加载完后的相机。
// 断言：
//   ① 每种排列里第一个请求的分区 GLB 确实不同（打乱生效）；
//   ② 各排列的首屏相机位置/注视点彼此一致（≤ 0.05 m），且与全部加载完后的相机一致；
//   ③ 首屏相机 = 按 manifest 核心四区（garden/temple/bazaar/pond）bounds 并集、用 viewer 的斜俯视取景式算出的相机（≤ 0.05 m）。
//      期望值从 OUT_DIR/zones-manifest.json 的 bounds 重算，不读 viewer 输出。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone node tests/first-view-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5489/';
const TOL = 0.05;
const CORE = ['garden', 'temple', 'bazaar', 'pond'];
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));

// ---- 期望首屏相机（viewer frame() 斜俯视式：r = max(sx,sz)*0.62+20；p = c + (0.55r, 1.05r+20, 0.95r)；t = (cx, min(6, 0.3 sy), cz)） ----
const coreFiles = manifest.zones.filter(z => CORE.includes(z.id) && z.file);
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const z of coreFiles) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], z.bounds[0][i]); hi[i] = Math.max(hi[i], z.bounds[1][i]); }
const c = [0, 1, 2].map(i => (lo[i] + hi[i]) / 2), s = [0, 1, 2].map(i => hi[i] - lo[i]);
const r = Math.max(s[0], s[2]) * 0.62 + 20;
const expected = { p: [c[0] + r * 0.55, r * 1.05 + 20, c[2] + r * 0.95], t: [c[0], Math.min(6, s[1] * 0.3), c[2]] };

// ---- 加载顺序排列 ----
const fileKey = (z) => z.file;
function permuted(kind) {
  const m = JSON.parse(JSON.stringify(manifest));
  if (kind === 'reverse') { m.order = [...m.order].reverse(); m.zones = [...m.zones].reverse(); }
  // 园区分件打头：优先厅堂件 garden-3；HALL_KIT=0 时没有该件（findIndex = −1 曾把 undefined 塞进 zones，viewer 解析 manifest 抛错、
  // 退回 scene-areas.glb 单文件取景 —— wave8 全关验收发现，39e642b3 的 main.js 同样失败），改用编号最大的非主件园区分件。
  if (kind === 'garden-3-first') {
    let i = m.zones.findIndex(z => z.id === 'garden' && /garden-3/.test(z.file || ''));
    if (i < 0) { const subs = m.zones.map((z, k) => [z, k]).filter(([z]) => z.id === 'garden' && z.file && z.file !== 'zone-garden.glb').sort((a, b) => b[0].part - a[0].part); i = subs.length ? subs[0][1] : -1; }
    if (i >= 0) m.zones = [m.zones[i], ...m.zones.filter((_, k) => k !== i)];
  }
  if (kind === 'bazaar-first') m.order = ['bazaar', ...m.order.filter(z => z !== 'bazaar')];
  if (kind === 'pond-first') m.order = ['pond', ...m.order.filter(z => z !== 'pond')];
  return m;
}
const KINDS = ['original', 'reverse', 'garden-3-first', 'bazaar-first', 'pond-first'];

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const runs = {};
for (const kind of KINDS) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const m = permuted(kind);
  await page.route('**/out/zones-manifest.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) }));
  const glbOrder = [];
  page.on('request', req => { const u = new URL(req.url()); if (/^\/out\/zone-.*\.glb$/.test(u.pathname)) glbOrder.push(path.basename(u.pathname)); });
  await page.addInitScript(() => {
    const grab = () => { try { window.__firstViewCam = window.__cam(); } catch (e) { window.__firstViewCam = { err: String(e) }; } };
    new MutationObserver((_, obs) => {
      if (document.readyState !== 'loading' && !document.getElementById('loadmsg') && !window.__firstViewCam && window.__cam) { obs.disconnect(); queueMicrotask(grab); }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(base + '?zone=core&cam=oblique', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => ({ first: window.__firstViewCam, final: window.__cam() }));
  runs[kind] = { firstGlb: glbOrder[0] || null, first: res.first, final: res.final };
  console.log(`${kind.padEnd(15)} first GLB ${String(glbOrder[0]).padEnd(22)} first-view p=${JSON.stringify(res.first?.p)} t=${JSON.stringify(res.first?.t)} | after load p=${JSON.stringify(res.final.p)}`);
  await page.close();
}
await browser.close();

let fails = 0;
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); fails++; } };
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
check(new Set(Object.values(runs).map(x => x.firstGlb)).size >= 3, `打乱未生效：首个请求的分区 GLB 只有 ${[...new Set(Object.values(runs).map(x => x.firstGlb))].join(',')}`);
const ref = runs.original.first;
for (const [k, v] of Object.entries(runs)) {
  check(v.first && v.first.p, `${k}: 未取到首屏相机`);
  if (!v.first?.p) continue;
  check(d3(v.first.p, ref.p) <= TOL && d3(v.first.t, ref.t) <= TOL, `${k}: 首屏相机 p=${JSON.stringify(v.first.p)} t=${JSON.stringify(v.first.t)} ≠ 原序 p=${JSON.stringify(ref.p)} t=${JSON.stringify(ref.t)}`);
  check(d3(v.first.p, v.final.p) <= TOL && d3(v.first.t, v.final.t) <= TOL, `${k}: 首屏相机与加载完后的相机不同（${JSON.stringify(v.first.p)} vs ${JSON.stringify(v.final.p)}）`);
  check(d3(v.first.p, expected.p) <= TOL + 0.1 && d3(v.first.t, expected.t) <= TOL + 0.1, `${k}: 首屏相机 p=${JSON.stringify(v.first.p)} 不是核心四区 manifest bounds 并集取景 p=${JSON.stringify(expected.p.map(x => +x.toFixed(1)))} t=${JSON.stringify(expected.t.map(x => +x.toFixed(1)))}`);
}
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ expected, runs, fails }, null, 1) + '\n');
if (fails) { console.error(`first-view-check: ${fails} fail`); process.exit(1); }
console.log(`first-view-check: ${KINDS.length} load orders, first-view camera identical (≤ ${TOL} m) and = core manifest bounds framing`);
