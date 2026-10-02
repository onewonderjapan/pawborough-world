// wave11-lighting R1（Codex astra 审查 P1）：lighting/presets.json 读不到 / 不合法时，查看器必须回退旧灯光且场景照常加载。
// 用 playwright route 拦截 /lighting/presets.json，三种情况各开一个新页面（顺序，不并行）：
//   hang    请求一直挂起（不应答）；
//   empty   返回 200 `{}`（合法 JSON、字段全缺）；
//   missing 返回真实 presets.json 删掉顶层 pointLights（合法 JSON、缺一个必要字段）；
//   slow    15 s 后才返回真实 presets.json（迟到升级：先按旧灯光加载，应答到了再切到 day 预设）；
//   late-night  ?light=night，presets.json 扣住到超时回退之后才放行（R2）：升级后实际 = 夜晚、下拉框 = 夜晚、地址栏 light=night，
//               再在下拉框直接选「白天」→ 实际 = 白天、下拉框 = 白天、地址栏 light=day；
//   late-select 无 ?light，扣住 presets.json；超时回退后（旧灯光）在下拉框选「夜晚」，再放行：实际 = 夜晚、下拉框 = 夜晚、地址栏 light=night（R2）。
//   late-invalid 扣住到超时回退之后再放行 `{}`：仍是旧灯光、error 非空、lateApplied = false（R2：初始化成功后才记 lateApplied）。
//   late-* 用例由测试手动放行应答（不是定时），保证「选择发生在应答之前」；负对照 = 200bb246 的 web/lighting.js + web/main.js。
// 断言（每种情况）：
//   F1 分区清单 /out/zones-manifest.json 在导航后 ≤ 60 s 内被请求（挂起时不能卡住加载；查看器超时为 3 s）；
//   F2 window.__ready（首载 + 外围分区全部到齐）且已加载分区 ≥ 4 个；
//   F3 没有 pageerror、没有 console.error（favicon 404 除外）；
//   F4 回退状态：__lighting.state() preset = null、error 非空、阴影贴图关、场景里没有任何 castShadow 网格、点光 0、
//      色调映射 = ACES（旧口径）、曝光 = 1.05、背景 = 纯色；
//   F5 渲染循环活着：再等 6 帧后 canvas 非空白（亮度标准差 ≥ 8/255）且仍无 pageerror。
//   slow 另断言：分区清单在预设应答发出之前就被请求；之后 ≤ 120 s 内 preset = day、阴影开、投影网格 > 0、lateApplied、无报错。
// 负对照：换回 e4aea1d2 的 web/lighting.js 跑 hang / empty / missing，三种情况都必须失败（记录见工单包 artifacts/r1/）；
// slow 是 R1 新增的行为（e4aea1d2 会一直等应答，清单在应答之后才请求），不适用「先失败」。
// 用法：BASE=http://127.0.0.1:5491/ [CASES=hang,empty,missing] [READY_TIMEOUT_MS=900000] [REPORT=<json>] node tests/lighting-fallback-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5491/';
const CASES = (process.env.CASES || 'hang,empty,missing,slow,late-night,late-select,late-invalid').split(',').filter(Boolean);
const LATE = CASES.filter(c => c.startsWith('late-'));
const SLOW_MS = 15000;
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'lighting', 'presets.json'), 'utf8'));
const missing = { ...real }; delete missing.pointLights;
const BODIES = { empty: '{}', missing: JSON.stringify(missing), slow: JSON.stringify(real) };
const ACES = 4;   // THREE.ACESFilmicToneMapping

let fails = 0, passes = 0;
const report = { base: BASE, cases: {} };
const ok = (c, cond, msg, data) => {
  (report.cases[c].checks ||= []).push({ pass: !!cond, msg, data });
  if (cond) { passes++; console.log('ok  ', c.padEnd(8), msg); } else { fails++; console.error('FAIL', c.padEnd(8), msg, data !== undefined ? JSON.stringify(data) : ''); }
};

const exe = process.env.CHROME_PATH || chromium.executablePath();
const browser = await chromium.launch({ executablePath: exe, headless: process.env.GPU_WEBGL !== '1', args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
for (const c of CASES.filter(c => !c.startsWith('late-'))) {
  report.cases[c] = {};
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url || '')) consoleErrors.push(m.text().slice(0, 300)); });
  let fulfilledAt = null;
  const t0 = Date.now();
  await page.route('**/lighting/presets.json', route => {
    if (c === 'hang') return;   // 永不应答
    const send = () => { fulfilledAt = Date.now() - t0; route.fulfill({ status: 200, contentType: 'application/json', body: BODIES[c] }).catch(() => {}); };
    if (c === 'slow') setTimeout(send, SLOW_MS); else send();
  });
  let manifestAt = null;
  page.on('request', r => { if (manifestAt === null && new URL(r.url()).pathname === '/out/zones-manifest.json') manifestAt = Date.now() - t0; });
  await page.goto(BASE + '?zone=core&cam=oblique', { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 60000;
  while (manifestAt === null && Date.now() < deadline) await page.waitForTimeout(500);
  report.cases[c].manifestRequestedMs = manifestAt;
  ok(c, manifestAt !== null, 'F1 zones-manifest requested ≤ 60 s after navigation', { ms: manifestAt });
  if (manifestAt === null) { report.cases[c].pageErrors = pageErrors; await page.close(); continue; }
  let ready = true;
  try { await page.waitForFunction(() => window.__ready === true, null, { timeout: +(process.env.READY_TIMEOUT_MS || 900000), polling: 1000 }); } catch { ready = false; }
  const zones = await page.evaluate(() => window.__zonesLoaded || []);
  ok(c, ready && zones.length >= 4, 'F2 __ready and ≥ 4 zones loaded', { ready, zones: zones.length, readyMs: Date.now() - t0 });
  const st = await page.evaluate(() => {
    let s = null; try { s = window.__lighting ? window.__lighting.state() : null; } catch (e) { s = { stateError: String(e).slice(0, 200) }; }
    let casters = 0; window.__scene.traverse(o => { if (o.isMesh && o.castShadow) casters++; });
    return { s, casters };
  });
  const s = st.s || {};
  if (c === 'slow') {
    ok(c, fulfilledAt === null || manifestAt < fulfilledAt, 'S1 zones-manifest requested before the late presets response', { manifestAt, fulfilledAt });
    let applied = true;
    try { await page.waitForFunction(() => window.__lighting?.state().preset === 'day', null, { timeout: 120000, polling: 1000 }); } catch { applied = false; }
    const s2 = await page.evaluate(() => { const s = window.__lighting.state(); let casters = 0; window.__scene.traverse(o => { if (o.isMesh && o.castShadow) casters++; }); return { ...s, casters }; });
    ok(c, applied && s2.lateApplied === true && s2.timedOut === true && s2.error === null && s2.shadowMapEnabled === true && s2.casters > 0 && s2.toneMapping === 'neutral' && s2.background === 'sky-texture',
      'S2 late presets applied after timeout (day, shadows on, casters > 0, neutral, sky)', { applied, preset: s2.preset, lateApplied: s2.lateApplied, timedOut: s2.timedOut, presetsMs: s2.presetsMs, error: s2.error, shadowMap: s2.shadowMapEnabled, casters: s2.casters, toneMapping: s2.toneMapping, background: s2.background });
    report.cases[c].state = s2;
  } else
  ok(c, st.s && s.preset === null && !!s.error && s.shadowMapEnabled === false && st.casters === 0 && s.pointLights === 0 &&
    s.toneMapping === ACES && Math.abs(s.exposure - 1.05) < 1e-9 && s.background === 'color',
    'F4 legacy fallback state (no preset, error set, no shadows, no point lights, ACES 1.05, colour background)',
    { stateError: s.stateError, preset: s.preset, error: s.error, shadowMap: s.shadowMapEnabled, casters: st.casters, pointLights: s.pointLights, toneMapping: s.toneMapping, exposure: s.exposure, background: s.background });
  await page.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k >= 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const img = await page.evaluate(async () => {
    const url = document.querySelector('#app canvas').toDataURL('image/png');
    const im = new Image(); im.src = url; await im.decode();
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width, im.height).data;
    let a = 0, a2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; a += l; a2 += l * l; n++; }
    return { mean: +(a / n).toFixed(2), std: +Math.sqrt(Math.max(0, a2 / n - (a / n) ** 2)).toFixed(2) };
  });
  ok(c, img.std >= 8, 'F5 render loop alive, canvas not blank', img);
  ok(c, pageErrors.length === 0 && consoleErrors.length === 0, 'F3 no pageerror / console.error', { pageErrors: pageErrors.slice(0, 3), pageErrorCount: pageErrors.length, consoleErrors: consoleErrors.slice(0, 3), consoleErrorCount: consoleErrors.length });
  if (c !== 'slow') report.cases[c].state = s;
  report.cases[c].image = img;
  await page.close();
}
// ---------- R2：迟到升级时的预设选择同步 ----------
for (const c of LATE) {
  report.cases[c] = {};
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url || '')) consoleErrors.push(m.text().slice(0, 300)); });
  let release = null;
  const held = new Promise(r => { release = r; });
  await page.route('**/lighting/presets.json', async route => { await held; await route.fulfill({ status: 200, contentType: 'application/json', body: c === 'late-invalid' ? '{}' : JSON.stringify(real) }).catch(() => {}); });
  const qs = c === 'late-night' ? '&light=night' : '';
  await page.goto(BASE + '?zone=core&cam=oblique' + qs, { waitUntil: 'domcontentloaded' });
  let timedOut = true;
  try { await page.waitForFunction(() => window.__lighting && window.__lighting.state().timedOut === true, null, { timeout: 180000, polling: 500 }); } catch { timedOut = false; }
  const view = () => page.evaluate(() => {
    const st = window.__lighting.state(), sel = document.getElementById('t-light');
    return { preset: st.preset, requested: st.requested, lateApplied: st.lateApplied, error: st.error, select: sel ? sel.value : null, selectState: sel ? sel.dataset.state || null : null, url: new URL(location.href).searchParams.get('light') };
  });
  const before = await view();
  ok(c, timedOut && before.preset === null, 'L0 presets held past the 3 s timeout: legacy lighting (preset null)', { timedOut, ...before });
  if (c === 'late-select') {
    await page.selectOption('#t-light', 'night');
    const mid = await view();
    report.cases[c].whilePending = mid;
    ok(c, mid.preset === null && mid.select === 'night', 'L1 select night while presets pending: still legacy, selection kept', mid);
  }
  release();
  if (c === 'late-invalid') {
    let settledLate = true;
    try { await page.waitForFunction(() => /invalid/.test(window.__lighting.state().error || ''), null, { timeout: 180000, polling: 500 }); } catch { settledLate = false; }
    const v = await view();
    report.cases[c].afterInvalid = v;
    ok(c, settledLate && v.preset === null && v.lateApplied === false && v.selectState === 'fallback', 'L5 late invalid response: stays legacy, error = invalid, lateApplied false, dropdown marked fallback', { settledLate, ...v });
    ok(c, pageErrors.length === 0 && consoleErrors.length === 0, 'F3 no pageerror / console.error', { pageErrors: pageErrors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 3) });
    await page.close();
    continue;
  }
  let upgraded = true;
  try { await page.waitForFunction(() => window.__lighting.state().preset !== null, null, { timeout: 180000, polling: 500 }); } catch { upgraded = false; }
  const after = await view();
  report.cases[c].afterUpgrade = after;
  ok(c, upgraded && after.lateApplied === true && after.preset === 'night' && after.select === 'night' && after.url === 'night',
    'L2 late upgrade: actual preset = night, dropdown = night, URL light=night', { upgraded, ...after });
  ok(c, after.selectState === 'applied', 'L3 dropdown marked applied after upgrade', after.selectState);
  if (c === 'late-night') {
    await page.selectOption('#t-light', 'day');
    const back = await view();
    report.cases[c].afterSelectDay = back;
    ok(c, back.preset === 'day' && back.select === 'day' && back.url === 'day', 'L4 choosing day in the dropdown switches back: actual = day, dropdown = day, URL light=day', back);
  }
  ok(c, pageErrors.length === 0 && consoleErrors.length === 0, 'F3 no pageerror / console.error', { pageErrors: pageErrors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 3) });
  await page.close();
}
await browser.close();
report.passes = passes; report.fails = fails;
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
console.log(`lighting-fallback-check: ${passes} pass, ${fails} fail`);
if (fails) process.exit(1);
