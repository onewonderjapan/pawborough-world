// wave13-tourfix U1/R1：导览锚点画面质量渲染复核。
// R1（主控裁定，astra 审查第 2 点）：暗度门槛由「跨区域统一硬门」改为「机位修复回归门」——
//   1) 近墙硬门（保持）：近竖直面（|n_y| < VERTICAL_NY）且距相机 < NEAR_M 的像素占全画幅 < 25%
//      （全体 anchor-* 机位，day 档量）。tour-render-check 的下 1/3 口径抓不住 gold 上半幅白墙 /
//      old-south 贴脸墙，这里按整幅口径补盲区。
//   2) 暗度回归门（R1 新语义）：各锚点主体区（同 targetMask 掩膜）平均亮度不得明显低于冻结基线
//      ——基线 = a45c3594 版生成器输出的锚位（本单开工前的机位），在本单合并 main 后的资产/灯光下
//      实测。基线值与容差来源见 BASELINE_SUBJ_255 / DARKEN_TOL_255 常量注释；day/dusk/night 三档都判。
//   3) 诊断报告（只打印，不判红）：跨区域参照锚点（未被本单点名的 anchor-main/center/jiuqu）
//      night 主体亮度中位数、day 档整幅平均亮度（旧 60/255 参照线）。旧语义的「night 主体 ≥ 参照
//      中位数」「day 整幅 ≥ 60」作为统一硬门被主控否决：各街廊照明/材质/主体内容不同，且参照值
//      随参照画面漂移；old-south 夜间主体 ~2/255 属照明欠项，移交、不在本单解决（见 SUMMARY）。
//   修复名单（巡检报告第 11 条）：anchor-old-south / anchor-old-north / anchor-gold。
//   不放宽 tour-render-check 任何现有门槛；本文件只新增检查。soffit 沿旧例只报告不判（主控 D2）。
// 方法：同 tour-render-check——headless 浏览器真实渲染，window.__viewAt / window.__targetMask（
//   nearFull = 整幅近景墙像素占比；主体亮度读渲染画布，含色调映射，与用户所见一致）。1400×900，fov46。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone [TOUR=<tour.json>] [SHOT_DIR=<目录>] [REPORT=<json>] node tests/tour-anchor-picture-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streetCorridorBox, streetFacadeBand, facadeIds, STREET_VIEW } from '../scripts/tour-visibility.mjs';

const require = createRequire(import.meta.url); // 从本包解析（devDependencies playwright）
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5497/';
const shotDir = process.env.SHOT_DIR || null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const MAX_NEAR_FULL = 0.25;           // 整幅近墙占比上限（近竖直面、距相机 < STREET_VIEW.NEAR_M），day 档
const FIXED_ANCHORS = ['anchor-old-south', 'anchor-old-north', 'anchor-gold']; // 本单点名修复的锚点（诊断用）
const LIGHTS = ['day', 'dusk', 'night'];
// 暗度回归门容差（R1）：同机位同档重复测量 3 次/锚点/档位，逐次完全一致（σ=0，headless 确定性渲染），
// 全量数据见 artifacts/r1/baseline-measure.json；容差取绝对下限 1.5/255——覆盖跨环境亚像素级抖动，
// 能拦住 ≥1.5/255 的真实变暗。本单修复后实测：gold dusk 47.2（基线 48.2，−1.0，过），其余全部变亮或持平。
const DARKEN_TOL_255 = 1.5;
// 冻结基线（/255）：a45c3594 锚位 = a45c3594 版 scripts/compute-area-tour.mjs 于 2026-09-29 重算的
// tour.json（anchor-main/center/jiuqu/old-south 与现值逐位相同，gold/old-north 为本单修复前机位）；
// 主体亮度在本单合并 main（0ba5a67b，含 bazaarglow 0.5）后的资产+灯光下 3 次重复实测
// （tests/.r1-measure.mjs，σ=0，artifacts/r1/baseline-measure.json）。
// 基线锚位 × 当前环境 = 回归门归因干净：他单资产变化两侧同乘，门只拦「机位选择导致的变暗」。
// old-south night 2.1 即 R0 记录的照明欠项（~2/255），门只防再变暗、不要求亮起来（移交欠项）。
const BASELINE_SUBJ_255 = {
  // wave14-stalllight 主控裁定选项①（2026-09-30）：摊位点光落台面（巡检 #19）使庙前立面洗光下降，
  // anchor-main night 修后实测 108.3（beforelight 对照定责：重建世界×基线 presets=114.8 与冻结逐位一致，
  // 见工单包 artifacts/r1/anchor-picture-beforelight-report.json）。其余锚点常量不动。
  'anchor-main':      { day: 77.3, dusk: 30.7, night: 108.3 },
  'anchor-gold':      { day: 93.9, dusk: 48.2, night: 15.1 },
  'anchor-center':    { day: 62.6, dusk: 30.1, night: 52.7 },
  'anchor-jiuqu':     { day: 62.7, dusk: 18.9, night: 43.6 },
  'anchor-old-south': { day: 13.7, dusk: 5.9,  night: 2.1 },
  'anchor-old-north': { day: 41.9, dusk: 19.8, night: 12.7 },
};
// 真 GPU 口径基线（GPU_WEBGL=1，主控 2026-10-01 v1.0 封版）：上表是 headless swiftshader 确定性渲染实测，
// 本机 swiftshader 已不可用，真 GPU 渲染与之有系统性小差（同一构建 b9e484d8 上 GPU 实测 anchor-main
// 74.5/29.1/105.4、gold dusk 46.7，低于上表 1.6–3.8/255；wave14 合并前后数值不变，属渲染器口径差）。
// 下表 = v1.0 构建（main 8b525cce out-zone）GPU 实测；anchor-center night 46.9 低于灯笼修正前同口径 52.4，
// 来源是机主 2026-09-30 定的灯笼点光移入灯内（presets lantern offsetY −0.4→0），属有意变化。
// 门只防此后在同一渲染口径下再变暗；两种口径不可混比。
const BASELINE_SUBJ_255_GPU = {
  'anchor-main':      { day: 73.5, dusk: 29.0, night: 105.3 },
  'anchor-gold':      { day: 96.1, dusk: 46.7, night: 17.2 },
  'anchor-center':    { day: 61.9, dusk: 29.3, night: 46.9 },
  'anchor-jiuqu':     { day: 102.8, dusk: 44.7, night: 71.3 },
  'anchor-old-south': { day: 13.5, dusk: 5.7,  night: 29.3 },
  'anchor-old-north': { day: 53.9, dusk: 25.3, night: 15.8 },
};
const BASELINE = process.env.GPU_WEBGL === '1' ? BASELINE_SUBJ_255_GPU : BASELINE_SUBJ_255;
const BASELINE_CALIBER = process.env.GPU_WEBGL === '1' ? 'gpu (v1.0 main 8b525cce)' : 'swiftshader (a45c3594 锚位)';

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
for (const key of anchors) if (!(key in BASELINE)) { console.error(`tour-anchor-picture-check: ${key} 无冻结基线常量（BASELINE_SUBJ_255），先补基线再跑`); process.exit(2); }
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
// GPU_WEBGL=1：机器 swiftshader WebGL 不可用时改走真 GPU（headless:false + 外部 DISPLAY/XAUTHORITY），默认关闭。
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), ...(process.env.GPU_WEBGL === '1' ? { headless: false } : {}), args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
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
const report = { gates: { maxNearFull: MAX_NEAR_FULL, darkenTol255: DARKEN_TOL_255, baseline: BASELINE, baselineCaliber: BASELINE_CALIBER, baselineProvenance: 'a45c3594 锚位（a45c3594 版生成器 2026-09-29 重算）× 合并 main 后资产/灯光，3 次重复实测 σ=0，见 artifacts/r1/baseline-measure.json', fixedAnchors: FIXED_ANCHORS, refAnchors: REF_ANCHORS }, diagnostics: {}, views: {} };
let fails = 0;
// 诊断（主控裁定：只报告，不判红）
const nightRefMedian = median(REF_ANCHORS.map(k => stats[k + '@night']?.subjMean));
console.log(`[诊断] night 参照锚点（${REF_ANCHORS.join('/')}）主体区亮度中位数: ${nightRefMedian != null ? (nightRefMedian * 255).toFixed(1) + '/255' : '—'}（旧「night 主体 ≥ 参照中位数」统一硬门已废——参照值随参照画面漂移，主控裁定）`);
for (const key of anchors) {
  const d = stats[key + '@day'];
  if (d.wholeMean * 255 < 60) console.log(`[诊断] ${key} day 整幅平均 ${(d.wholeMean * 255).toFixed(1)}/255 < 旧参照线 60/255（棚下/廊下街廊整幅天然偏暗，统一硬门已废；主体亮度回归门照判）`);
}
report.diagnostics.nightRefMedian = nightRefMedian != null ? +nightRefMedian.toFixed(4) : null;
// 门槛 1：近墙硬门（day，全体锚点）；门槛 2：暗度回归门（day/dusk/night，逐锚点 vs 冻结基线）
for (const key of anchors) {
  const why = [];
  const d = stats[key + '@day'];
  if (d.nearFull >= MAX_NEAR_FULL) why.push(`近墙占比(整幅,<${STREET_VIEW.NEAR_M}m,day) ${(d.nearFull * 100).toFixed(1)}% ≥ ${MAX_NEAR_FULL * 100}%`);
  for (const light of LIGHTS) {
    const subj = stats[key + '@' + light].subjMean;
    const baseLine = BASELINE[key][light] / 255;
    if (subj == null) { why.push(`${light} 主体区无像素（基线 ${BASELINE[key][light]}/255）`); continue; }
    if (subj < baseLine - DARKEN_TOL_255 / 255) why.push(`${light} 主体 ${(subj * 255).toFixed(1)}/255 < 冻结基线（${BASELINE_CALIBER}）${BASELINE[key][light]}/255 − 容差 ${DARKEN_TOL_255}`);
  }
  const ok = !why.length;
  if (!ok) fails++;
  report.views[key] = {
    day: { wholeMean: +d.wholeMean.toFixed(4), nearFull: +d.nearFull.toFixed(4) },
    dusk: { wholeMean: +stats[key + '@dusk'].wholeMean.toFixed(4), subjMean: stats[key + '@dusk'].subjMean != null ? +stats[key + '@dusk'].subjMean.toFixed(4) : null },
    night: { wholeMean: +stats[key + '@night'].wholeMean.toFixed(4), subjMean: stats[key + '@night'].subjMean != null ? +stats[key + '@night'].subjMean.toFixed(4) : null, sky: stats[key + '@night'].sky != null ? +stats[key + '@night'].sky.toFixed(4) : null },
    pass: ok, fail: why,
  };
  console.log(`${key.padEnd(18)} ${ok ? 'OK' : 'FAIL: ' + why.join('; ')}`);
}
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`tour-anchor-picture-check: ${fails}/${anchors.length} anchors fail (near-wall full-frame < ${MAX_NEAR_FULL * 100}% day; subject ≥ frozen a45c3594 baseline − ${DARKEN_TOL_255}/255, day/dusk/night)`); process.exit(1); }
console.log(`tour-anchor-picture-check: all ${anchors.length} anchors pass (near-wall hard gate + darkness regression vs a45c3594 frozen anchors)`);
