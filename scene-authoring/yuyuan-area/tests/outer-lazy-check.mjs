// wave8-outerlazy（2026-09-26 机主「外围改后台懒加载」）：外围分区首帧后自动后台加载的浏览器检查（headless swiftshader）。
// 期望值一律从 OUT_DIR/zones-manifest.json 现算，不读 viewer 自己的判断：
//   首载件 = loadPolicy 既不是 deferred 也不是 on-demand 的件；deferred 件 = 外围；on-demand 件 = 方浜中路。
// 断言：
//   ① manifest 里外围件全是 loadPolicy=deferred（有外围件）；
//   ② 首载完成那一刻（window.__firstLoadReady 置 true 时快照）已加载的件 == 首载件，不含 deferred / on-demand 件；
//   ③ 每个 deferred 件的 GLB 请求开始时刻（Resource Timing startTime）晚于首帧（__loadTimes.firstFrameMs），首载件的请求全部早于它；
//   ④ 不做任何操作，deferred 件自动到齐（__ready 时 __zonesLoaded 含全部 deferred 件，场景里 ZN-outer 有网格）；on-demand 件仍未拉；
//   ⑤ viewer 报的首载字节 / deferred 字节 == manifest 现算值，且首载 ≤ 20 MB；
//   ⑥ 首屏相机（首载完成时）== 外围到齐后的相机（≤ 0.05 m）：外围后台加载不改首屏取景。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone node tests/outer-lazy-check.mjs  [REPORT=<json>]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5489/';
const FIRST_LOAD_CAP = 20000000, TOL = 0.05;
const m = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const files = m.zones.filter(z => z.file);
const POL = new Set(['deferred', 'on-demand']);
const rt = z => (z.cm ? z.cm.bytes : z.bytes);
const rtFile = z => (z.cm ? z.cm.file : z.file);
const keyOf = z => (files.filter(x => x.id === z.id).length > 1 ? `${z.id}#${z.part}` : z.id);   // web/main.js zoneLoad 键
const firstFiles = files.filter(z => !POL.has(z.loadPolicy));
const deferredFiles = files.filter(z => z.loadPolicy === 'deferred');
const onDemandFiles = files.filter(z => z.loadPolicy === 'on-demand');
const outerFiles = files.filter(z => z.id === 'outer');
const expFirstBytes = firstFiles.reduce((s, z) => s + rt(z), 0), expDeferredBytes = deferredFiles.reduce((s, z) => s + rt(z), 0);

let pass = 0, fails = 0;
const check = (ok, msg) => { if (ok) { pass++; console.log('PASS', msg); } else { fails++; console.error('FAIL:', msg); } };
check(outerFiles.length > 0 && outerFiles.every(z => z.loadPolicy === 'deferred'), `① manifest 外围 ${outerFiles.length} 件 loadPolicy 全为 deferred（${outerFiles.map(z => `${z.file}:${z.loadPolicy || '首载'}`).join(', ')}）`);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  let v = false;
  Object.defineProperty(window, '__firstLoadReady', {
    configurable: true,
    get: () => v,
    set: (x) => {
      v = x;
      if (x === true && !window.__atFirstLoad) {
        let cam = null; try { cam = window.__cam(); } catch (e) { cam = { err: String(e) }; }
        window.__atFirstLoad = { zones: [...(window.__zonesLoaded || [])], cam, t: performance.now() };
      }
    },
  });
});
const t0 = Date.now();
await page.goto(base + '?zone=core&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
await page.waitForTimeout(300);
const res = await page.evaluate(() => {
  const rtEntries = performance.getEntriesByType('resource').filter(e => /\/out\/zone-[^/]*\.glb$/.test(new URL(e.name).pathname))
    .map(e => ({ file: new URL(e.name).pathname.split('/').pop(), start: +e.startTime.toFixed(0), end: +e.responseEnd.toFixed(0) }));
  const zn = window.__scene.getObjectByName('ZN-outer');
  let outerMeshes = 0; if (zn) zn.traverse(o => { if (o.isMesh && !o.isBatchedMesh) outerMeshes++; });
  return { atFirst: window.__atFirstLoad, final: { zones: window.__zonesLoaded, cam: window.__cam() }, lt: window.__loadTimes, rtEntries, outerMeshes };
});
await browser.close();
console.log(JSON.stringify({ wallMs: Date.now() - t0, loadTimes: res.lt, atFirstZones: res.atFirst?.zones, finalZones: res.final.zones, outerMeshes: res.outerMeshes }, null, 1));

const expFirstKeys = firstFiles.map(keyOf).sort(), expDeferredKeys = deferredFiles.map(keyOf);
const atFirst = (res.atFirst?.zones || []).slice().sort();
check(JSON.stringify(atFirst) === JSON.stringify(expFirstKeys), `② 首载完成时已加载 [${atFirst}] == manifest 首载件 [${expFirstKeys}]`);
check(!atFirst.some(k => expDeferredKeys.includes(k) || onDemandFiles.map(keyOf).includes(k)), '② 首载完成时没有 deferred / on-demand 件');
const lt = res.lt || {};
const startOf = f => res.rtEntries.filter(e => e.file === f).map(e => e.start);
for (const z of deferredFiles) {
  const st = startOf(rtFile(z));
  check(st.length === 1 && lt.firstFrameMs != null && st[0] >= lt.firstFrameMs, `③ deferred ${rtFile(z)} 请求开始 ${st.join(',') || '无请求'} ms ≥ 首帧 ${lt.firstFrameMs} ms`);
}
const lateFirst = firstFiles.filter(z => { const st = startOf(rtFile(z)); return !(st.length === 1 && st[0] < lt.firstFrameMs); });
check(lateFirst.length === 0, `③ 首载 ${firstFiles.length} 件请求都早于首帧（例外 ${lateFirst.map(rtFile).join(',') || '无'}）`);
const finalZones = res.final.zones || [];
check(expDeferredKeys.every(k => finalZones.includes(k)) && res.outerMeshes > 0, `④ 无操作下 deferred 件自动到齐（${expDeferredKeys.join(',')}；ZN-outer 网格 ${res.outerMeshes}）`);
check(!onDemandFiles.some(z => finalZones.includes(keyOf(z))), `④ on-demand 件（${onDemandFiles.map(z => z.file).join(',') || '无'}）未被自动拉`);
check(lt.firstLoadBytes === expFirstBytes && expFirstBytes <= FIRST_LOAD_CAP, `⑤ viewer 首载 ${lt.firstLoadBytes} B == manifest 现算 ${expFirstBytes} B ≤ ${FIRST_LOAD_CAP}`);
check(lt.deferredBytes === expDeferredBytes, `⑤ viewer deferred ${lt.deferredBytes} B == manifest 现算 ${expDeferredBytes} B`);
check(lt.firstLoadMs != null && lt.firstFrameMs >= lt.firstLoadMs && lt.deferredLoadedMs >= lt.firstFrameMs, `⑤ 时刻有序：首载 ${lt.firstLoadMs} ≤ 首帧 ${lt.firstFrameMs} ≤ 外围到齐 ${lt.deferredLoadedMs} ms`);
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const c1 = res.atFirst?.cam, c2 = res.final.cam;
check(!!(c1 && c1.p && c2 && c2.p) && d3(c1.p, c2.p) <= TOL && d3(c1.t, c2.t) <= TOL, `⑥ 首屏相机 p=${JSON.stringify(c1?.p)} t=${JSON.stringify(c1?.t)} == 外围到齐后 p=${JSON.stringify(c2?.p)} t=${JSON.stringify(c2?.t)}`);
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ expected: { firstFiles: firstFiles.map(z => z.file), deferredFiles: deferredFiles.map(z => z.file), expFirstBytes, expDeferredBytes }, res, pass, fails }, null, 1) + '\n');
console.log(`outer-lazy-check: ${pass} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
