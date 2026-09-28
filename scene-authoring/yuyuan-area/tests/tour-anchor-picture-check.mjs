// wave13-tourfix U1：导览锚点画面质量渲染复核（近墙占比 + 暗度），补 tour-render-check 两个盲区：
//   1) 近墙占比：tour-render-check 的近景墙只判「画面下 1/3 最大连通区」（STREET_VIEW.MAX_NEAR_COMPONENT），
//      gold 的白墙占上半幅、old-south 的贴脸墙不在下 1/3，都漏判。这里按整幅口径：
//      近竖直面（|n_y| < VERTICAL_NY）且距相机 < NEAR_M 的像素占全画幅 < 25%（全体 anchor-* 机位，day 档量）。
//   2) 暗度：机位躲在桥洞/过街楼里三档近全黑（报告第 11 条 anchor-old-south）。两条渲染门槛：
//      day 档整幅平均亮度 ≥ 60/255；
//      night 档主体区（街景目标 = 街廊盒 + 立面带；桥头锚点 = 九曲桥 ids 掩膜）平均亮度 ≥
//      同档「参照锚点」（未被本单点名的 anchor-main / anchor-center / anchor-jiuqu）主体区亮度的中位数。
//      参照集取不在修复名单内的锚点：门槛与修复后机位无关（不随被修锚点自我漂移），语义 = 不低于验收合格锚点的典型水平。
//   修复名单（巡检报告第 11 条）：anchor-old-south / anchor-old-north / anchor-gold。
//   不放宽 tour-render-check 任何现有门槛；本文件只新增检查。soffit 沿旧例只报告不判（主控 D2）。
// 方法：同 tour-render-check——headless 浏览器真实渲染，window.__viewAt / window.__targetMask（target-mask.js 的
// nearFull = 整幅近景墙像素占比）；亮度读渲染画布（含色调映射，与用户所见一致）。1400×900，fov46。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone [TOUR=<tour.json>] [SHOT_DIR=<目录>] [REPORT=<json>] node tests/tour-anchor-picture-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streetCorridorBox, streetFacadeBand, facadeIds, STREET_VIEW } from '../scripts/tour-visibility.mjs';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5497/';
const shotDir = process.env.SHOT_DIR || null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const MIN_DAY_MEAN = 60 / 255;        // day 档整幅平均亮度下限
const MAX_NEAR_FULL = 0.25;           // 整幅近墙占比上限（近竖直面、距相机 < STREET_VIEW.NEAR_M）
const FIXED_ANCHORS = ['anchor-old-south', 'anchor-old-north', 'anchor-gold']; // 修复名单（暗度门槛适用）
const LIGHTS = ['day', 'dusk', 'night']; // dusk 只记录不判（GOAL 量化门槛只覆盖 day/night）

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const tour = JSON.parse(fs.readFileSync(process.env.TOUR || path.join(OUT, 'tour.json'), 'utf8'));
const idSet = [...new Set([...layout.objects.map(o => o.id), ...(layout.instances || []).map(i => i.id)])];
const bays = {};
for (const o of layout.objects) if (o.parentBuilding) (bays[o.parentBuilding] ||= []).push(o.id);
const FACADE_IDS = facadeIds(layout);
const BRIDGE_ANCHORS = { 'anchor-jiuqu': 'jiuqu-bridge' };
const anchors = Object.keys(tour).filter(k => k.startsWith('anchor-'));
const REF_ANCHORS = anchors.filter(k => !FIXED_ANCHORS.includes(k));

function streetSpec(key, tag) {
  const spec = String(tag).slice('street:'.length), cont = spec.startsWith('cont:');
  const [from, to] = (cont ? spec.slice(5) : spec).split('->');
  const r = routes.find(x => x.from === from && x.to === to);
  if (!r) throw new Error(`${key}: 路线 ${spec} 不在 commercial-route.json`);
  const [a, b] = cont ? r.points.slice(-2) : r.points.slice(0, 2);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const anchor = nav.anchors[key.slice('anchor-'.length)], dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], pts = cont ? null : r.points;
  return { street: { obb: streetCorridorBox(anchor, dir, pts), pad: 0.25, band: streetFacadeBand(anchor, dir, pts), facadeIds: FACADE_IDS, idSet, nearM: STREET_VIEW.NEAR_M, verticalNy: STREET_VIEW.VERTICAL_NY } };
}
function targetSpec(key, v) {
  if (String(v.targetObject).startsWith('street:')) return { kind: 'street-view', ...streetSpec(key, v.targetObject) };
  if (BRIDGE_ANCHORS[key] && BRIDGE_ANCHORS[key] === v.targetObject)
    return { kind: 'bridge-anchor', ids: [v.targetObject, ...(bays[v.targetObject] || [])], idSet };
  // 非街景目标的锚点（违规形态）也按其路线走廊量画面（同 tour-render-check 的 notStreetTarget 口径）
  const aKey = key.slice('anchor-'.length);
  const r = routes.find(x => x.from === aKey);
  const tag = r ? `street:${r.from}->${r.to}` : null;
  if (!tag) throw new Error(`${key}: 锚点无出发路线`);
  return { kind: 'street-view-fallback', ...streetSpec(key, tag) };
}

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const stats = {}; // key@light -> {wholeMean, subjMean, nearFull, share, sky}
for (const light of LIGHTS) {
  await page.goto(base + '?zone=core&cam=oblique&light=' + light, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true && typeof window.__targetMask === 'function', null, { timeout: 600000 });
  await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => { const s = document.getElementById('t-light'); return !s || s.dataset.state === 'applied'; }, null, { timeout: 60000 }).catch(() => {});
  for (const key of anchors) {
    const v = tour[key];
    const spec = targetSpec(key, v);
    const frameOnly = { obb: null, band: null, facadeIds: [], idSet: [], nearM: STREET_VIEW.NEAR_M, verticalNy: STREET_VIEW.VERTICAL_NY };
    const r = await page.evaluate(async ({ key, p, t, spec, frameOnly }) => {
      const hud = document.getElementById('hud');
      if (hud && !hud.dataset.base) { hud.dataset.base = hud.innerHTML; hud.innerHTML = ''; } // 信息卡不进画面（同巡检口径）
      window.__viewAt(p, t);
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const src = document.querySelector('canvas');
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0);
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const mm = window.__targetMask({ ids: spec.ids, idSet: spec.idSet, obb: spec.obb, pad: spec.pad, street: spec.street, png: true });
      const fm = window.__targetMask({ street: frameOnly }); // 桥头锚点等非街景目标的画面统计（近墙/天空），同 tour-render-check
      const sc = document.createElement('canvas'); sc.width = mm.w; sc.height = mm.h;
      const sctx = sc.getContext('2d', { willReadFrequently: true });
      const sim = new Image(); sim.src = mm.png; await sim.decode();
      sctx.drawImage(sim, 0, 0);
      const sd = sctx.getImageData(0, 0, sc.width, sc.height).data;
      let sum = 0, n = 0, sSum = 0, sN = 0;
      const sx = mm.w / cv.width, sy = mm.h / cv.height;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        sum += lum; n++;
        const mx = Math.min(sc.width - 1, (x * sx) | 0), my = Math.min(sc.height - 1, (y * sy) | 0);
        if (sd[(my * sc.width + mx) * 4] > 127) { sSum += lum; sN++; } // 主体区 = 目标掩膜非零（街景 R 通道 / 桥 ids 白色）
      }
      return { wholeMean: sum / n / 255, subjMean: sN ? sSum / sN / 255 : null, subjPx: sN, share: mm.share, sky: fm.sky, nearMax: fm.nearMax, nearFull: fm.nearFull, png: cv.toDataURL('image/png') };
    }, { key, p: v.p, t: v.t, spec, frameOnly });
    stats[key + '@' + light] = { wholeMean: r.wholeMean, subjMean: r.subjMean, subjPx: r.subjPx, share: r.share, sky: r.sky, nearMax: r.nearMax, nearFull: r.nearFull };
    if (shotDir) {
      fs.writeFileSync(path.join(shotDir, `${key}-${light}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    }
    console.log(`${key.padEnd(18)} ${light.padEnd(5)} whole ${(r.wholeMean * 255).toFixed(1).padStart(5)}/255 subj ${r.subjMean != null ? (r.subjMean * 255).toFixed(1).padStart(5) + '/255' : '   —   '} nearFull ${(r.nearFull * 100).toFixed(1).padStart(5)}% share ${(r.share * 100).toFixed(1)}%`);
  }
}
await browser.close();

// ---------- 门槛判定 ----------
const median = (arr) => { const a = arr.filter(x => x != null).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const report = { gates: { minDayMean: MIN_DAY_MEAN, maxNearFull: MAX_NEAR_FULL, fixedAnchors: FIXED_ANCHORS, refAnchors: REF_ANCHORS }, views: {} };
let fails = 0;
const nightRefMedian = median(REF_ANCHORS.map(k => stats[k + '@night']?.subjMean));
console.log(`night 参照锚点（${REF_ANCHORS.join('/')}）主体区亮度中位数: ${nightRefMedian != null ? (nightRefMedian * 255).toFixed(1) + '/255' : '—'}`);
for (const key of anchors) {
  const why = [];
  const d = stats[key + '@day'], n8 = stats[key + '@night'];
  if (d.nearFull >= MAX_NEAR_FULL) why.push(`近墙占比(整幅,<6m) ${(d.nearFull * 100).toFixed(1)}% ≥ ${MAX_NEAR_FULL * 100}%`);
  if (FIXED_ANCHORS.includes(key)) {
    if (d.wholeMean < MIN_DAY_MEAN) why.push(`day 整幅平均亮度 ${(d.wholeMean * 255).toFixed(1)}/255 < ${MIN_DAY_MEAN * 255}`);
    if (n8.subjMean == null) why.push('night 主体区无像素');
    else if (nightRefMedian == null) why.push('night 参照锚点主体亮度缺失');
    else if (n8.subjMean < nightRefMedian) why.push(`night 主体区 ${(n8.subjMean * 255).toFixed(1)}/255 < 参照中位数 ${(nightRefMedian * 255).toFixed(1)}/255`);
  }
  const ok = !why.length;
  if (!ok) fails++;
  report.views[key] = { day: { wholeMean: +d.wholeMean.toFixed(4), nearFull: +d.nearFull.toFixed(4) }, dusk: { wholeMean: +stats[key + '@dusk'].wholeMean.toFixed(4), subjMean: stats[key + '@dusk'].subjMean != null ? +stats[key + '@dusk'].subjMean.toFixed(4) : null }, night: { wholeMean: +n8.wholeMean.toFixed(4), subjMean: n8.subjMean != null ? +n8.subjMean.toFixed(4) : null, sky: n8.sky != null ? +n8.sky.toFixed(4) : null }, pass: ok, fail: why };
  console.log(`${key.padEnd(18)} ${ok ? 'OK' : 'FAIL: ' + why.join('; ')}`);
}
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`tour-anchor-picture-check: ${fails}/${anchors.length} anchors fail (near-wall full-frame < ${MAX_NEAR_FULL * 100}%; day mean ≥ ${MIN_DAY_MEAN * 255}/255; night subject ≥ median of ${REF_ANCHORS.join('/')})`); process.exit(1); }
console.log(`tour-anchor-picture-check: all ${anchors.length} anchors pass`);
