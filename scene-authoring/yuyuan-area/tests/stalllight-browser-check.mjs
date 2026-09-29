// wave14-stalllight 浏览器验收（独立 npm script test:stalllight-browser；需要浏览器/GPU，不入默认链）。
// 量什么：
//   V1 anchor-old-south（tour.json 机位，street:old-south->old-north 走廊主体掩膜）day/dusk/night 三档主体亮度；
//      门 G1：night 主体 ≥ OLD_SOUTH_NIGHT_MIN=21/255（基线 2.1/255 的 10 倍，tourfix 移交欠项）。
//   V2 接线：?light=night 下 __lighting.state().candidatesBySource['oldsouth-lamp'] = 6（6 盏檐灯全部进点光候选池）、
//      emissiveByGroup['oldsouth-lamp'] ≥ 1（olds-lantern 材质在 cm 件存活且命中发光组——gltfpack 内容合并吞名守卫）。
//   V3 pv07-bazaar-to-pond night 中帧（pv-cameras.json eye[frames>>1]，target 中帧）截图 + 「亮红像素」占比诊断：
//      亮红像素 = 亮度>120 且 R−G>25（高亮偏红 = 粉色大光斑的像素学特征）。
//      GATE=1 时门 G3：亮红像素占比 < PV07_RED_MAX（由基线/修后实测中间取值）；GATE=0 只输出数字（基线测量轮）。
// 用法：BASE=http://127.0.0.1:5486/ OUT_DIR=out-zone [GATE=1] [SHOT_DIR=<dir>] [REPORT=<json>] node tests/stalllight-browser-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streetCorridorBox, streetFacadeBand, facadeIds, STREET_VIEW } from '../scripts/tour-visibility.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5486/';
const GATE = process.env.GATE === '1';
const shotDir = process.env.SHOT_DIR || null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const OLD_SOUTH_NIGHT_MIN = 21;    // /255，G1 门 = 基线 2.1/255 的 10 倍（本单修复目标族：相对基线 ≥10×）。
                                   // 基线实测（a2bc8104 同源分区件 + 基线 presets，2026-09-29 本脚本 GATE=0 实测，
                                   // 见 artifacts/r0/browser-baseline-report.json + r0/shots-baseline/）:
                                   // day 13.7 / dusk 5.9 / night 2.1，与 tour-anchor-picture-check 冻结基线
                                   // （wave13-tourfix R1）逐位一致。修后实测 29.5（14.0×）。基线上此门红。
const PV07_RED_MAX = 0.145;        // G3 门（整幅亮红像素占比，R−G>25 且 lum>120）。基线实测 15.91%（亮红集中于
                                   // 下右地面光斑格 50–75%）；修后 13.29%（-2.6pp，像素差集中于摊位区格 5.8–9.0%），
                                   // 见 r0/browser-baseline-report.json 与 r1/browser-fixed-report.json。
                                   // 门 14.5%：基线必红、修后留 1.2pp 余量。剩余亮红 = 共享点光池参数（pointLights
                                   // intensity 60/distance 22 与 lantern 源共用，本单禁改）+ 合法暖色内容（灯笼/招牌/
                                   // 摊灯台面）；光斑核心实测琥珀 G/R=0.70 非粉，粉观感来自远场紫红边（夜环境光×浅色地面，
                                   // B/G≈1.05）——如实写入 SUMMARY 的 partial 项。

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const tour = JSON.parse(fs.readFileSync(path.join(OUT, 'tour.json'), 'utf8'));
const pv = JSON.parse(fs.readFileSync(path.join(OUT, 'pv-cameras.json'), 'utf8'));
const idSet = [...new Set([...layout.objects.map(o => o.id), ...(layout.instances || []).map(i => i.id)])];
const FACADE_IDS = facadeIds(layout);

const v = tour['anchor-old-south'];
if (!v) { console.error('tour.json 无 anchor-old-south'); process.exit(2); }
const spec = String(v.targetObject).slice('street:'.length);
const [from, to] = spec.split('->');
const r = routes.find(x => x.from === from && x.to === to);
if (!r) { console.error(`路线 ${spec} 不在 commercial-route.json`); process.exit(2); }
const [a, b] = r.points.slice(0, 2);
const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
const anchor = nav.anchors['old-south'], dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
const street = { obb: streetCorridorBox(anchor, dir, r.points), pad: 0.25, band: streetFacadeBand(anchor, dir, r.points), facadeIds: FACADE_IDS, idSet, nearM: STREET_VIEW.NEAR_M, verticalNy: STREET_VIEW.VERTICAL_NY };

const pv07 = pv.shots.find(s => s.id === 'pv07-bazaar-to-pond');
if (!pv07) { console.error('pv-cameras.json 无 pv07-bazaar-to-pond'); process.exit(2); }
const mid = pv07.frames >> 1;

// Chromium 解析（astra R2 可选项：去掉硬编码的个人缓存路径）：
//   1) 环境变量 CHROME_PATH 优先；
//   2) 否则用 playwright registry 默认（executablePath 存在即交给 playwright 自己管）；
//   3) registry 未下载时按 playwright 默认缓存目录（~/.cache/ms-playwright）动态取版本号最新的
//      chromium-*/chrome-linux/chrome——版本目录随 playwright 版本漂移，不硬编码具体 revision。
import os from 'node:os';
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
const launchArgs = ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
const exe = resolveChromiumExecutable();
const browser = await chromium.launch(exe ? { executablePath: exe, args: launchArgs } : { args: launchArgs });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

let fails = 0;
const fail = (m) => { console.error('FAIL ' + m); fails++; };
const ok = (m) => console.log('PASS ' + m);
const report = { gates: { oldSouthNightMin: OLD_SOUTH_NIGHT_MIN, pv07RedMax: PV07_RED_MAX, gate: GATE }, oldSouth: {}, wiring: null, pv07: {} };

// V1 anchor-old-south 三档
for (const light of ['day', 'dusk', 'night']) {
  await page.goto(base + '?zone=core&cam=oblique&light=' + light, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true && typeof window.__targetMask === 'function', null, { timeout: 600000 });
  await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => { const s = document.getElementById('t-light'); return !s || s.dataset.state === 'applied'; }, null, { timeout: 60000 }).catch(() => {});
  const res = await page.evaluate(async ({ p, t, street }) => {
    const hud = document.getElementById('hud');
    if (hud && !hud.dataset.base) { hud.dataset.base = hud.innerHTML; hud.innerHTML = ''; }
    window.__viewAt(p, t);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const src = document.querySelector('canvas');
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const mm = window.__targetMask({ ids: null, idSet: street.idSet, obb: null, pad: street.pad, street, png: true });
    const sc = document.createElement('canvas'); sc.width = mm.w; sc.height = mm.h;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    const sim = new Image(); sim.src = mm.png; await sim.decode();
    sctx.drawImage(sim, 0, 0);
    const sd = sctx.getImageData(0, 0, sc.width, sc.height).data;
    let sSum = 0, sN = 0;
    const sx = mm.w / cv.width, sy = mm.h / cv.height;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
      const mx = Math.min(sc.width - 1, (x * sx) | 0), my = Math.min(sc.height - 1, (y * sy) | 0);
      if (sd[(my * sc.width + mx) * 4] > 127) { sSum += lum; sN++; }
    }
    return { subjMean: sN ? sSum / sN / 255 : null, subjPx: sN, png: cv.toDataURL('image/png') };
  }, { p: v.p, t: v.t, street });
  const subj255 = res.subjMean != null ? res.subjMean * 255 : null;
  report.oldSouth[light] = { subj255: subj255 != null ? +subj255.toFixed(1) : null, subjPx: res.subjPx };
  console.log(`anchor-old-south ${light}: 主体 ${subj255 != null ? subj255.toFixed(1) : '—'}/255 (${res.subjPx}px)`);
  if (light === 'night') {
    if (subj255 == null) fail(`G1 night 主体区无像素`);
    else if (subj255 < OLD_SOUTH_NIGHT_MIN) fail(`G1 old-south night 主体 ${subj255.toFixed(1)}/255 < 门 ${OLD_SOUTH_NIGHT_MIN}（基线 2.1）`);
    else ok(`G1 old-south night 主体 ${subj255.toFixed(1)}/255 ≥ ${OLD_SOUTH_NIGHT_MIN}（基线 2.1，提升 ${(subj255 / 2.1).toFixed(1)}×）`);
  }
  if (shotDir) fs.writeFileSync(path.join(shotDir, `anchor-old-south-${light}.png`), Buffer.from(res.png.split(',')[1], 'base64'));
}

// V2 接线（night 页，锚点机位下）
{
  const st = await page.evaluate(() => window.__lighting.state());
  report.wiring = { candidatesBySource: st.candidatesBySource, emissiveByGroup: st.emissiveByGroup, pointLights: st.pointLights };
  const n = st.candidatesBySource['oldsouth-lamp'] || 0;
  if (n !== 6) fail(`V2 oldsouth-lamp 点光候选 ${n} ≠ 6（node-anchor 源未接上或节点名不匹配）`);
  else console.log('V2 oldsouth-lamp 点光候选 6/6');
  const em = (st.emissiveByGroup || {})['oldsouth-lamp'] || 0;
  if (em < 1) fail(`V2 emissiveByGroup.oldsouth-lamp = ${em}（olds-lantern 材质未命中——检查 cm 件材质名存活）`);
  else console.log(`V2 oldsouth-lamp 发光材质命中 ${em}`);
}

// V3 pv07 night 中帧
{
  const eye = pv07.eye[mid], tgt = Array.isArray(pv07.target) ? pv07.target[mid] : pv07.target;
  await page.goto(base + '?zone=core&cam=oblique&light=night', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.waitForFunction(() => { const s = document.getElementById('t-light'); return !s || s.dataset.state === 'applied'; }, null, { timeout: 60000 }).catch(() => {});
  const res = await page.evaluate(async ({ p, t }) => {
    const hud = document.getElementById('hud');
    if (hud && !hud.dataset.base) { hud.dataset.base = hud.innerHTML; hud.innerHTML = ''; }
    window.__viewAt(p, t);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const src = document.querySelector('canvas');
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let red = 0, n = 0;
    for (let i = 0; i < img.length; i += 4) {
      const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
      if (lum > 120 && img[i] - img[i + 1] > 25) red++;
      n++;
    }
    return { redRatio: red / n, png: cv.toDataURL('image/png') };
  }, { p: eye, t: tgt });
  report.pv07 = { frame: mid, redRatio: +res.redRatio.toFixed(4) };
  console.log(`pv07 night 中帧#${mid}: 亮红像素占比 ${(res.redRatio * 100).toFixed(2)}%`);
  if (GATE) {
    if (res.redRatio >= PV07_RED_MAX) fail(`G3 pv07 night 亮红像素 ${(res.redRatio * 100).toFixed(2)}% ≥ 门 ${PV07_RED_MAX * 100}%`);
    else console.log(`G3 pv07 night 亮红像素 ${(res.redRatio * 100).toFixed(2)}% < ${PV07_RED_MAX * 100}%`);
  }
  if (shotDir) fs.writeFileSync(path.join(shotDir, `pv07-night-mid.png`), Buffer.from(res.png.split(',')[1], 'base64'));
}

await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
console.log(`${GATE ? '[GATE] ' : ''}stalllight-browser-check: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
