// wave11-lighting：查看器灯光对照出图（6 个代表机位 × 预设），同机位改前 / 改后可比。
// 机位全部从运行产物重算，不写死坐标：
//   sansuitang / jiuqu / huabao-plaza = OUT_DIR/tour.json 的导览机位（sansuitang / jiuqu-bridge / huabaolou）；
//   huxinting = control-shots.json 镜头⑩ huxinting-across-pond 终帧；shanmen = 镜头⑪ fangbang-eastbound 终帧；
//   fangbang = 镜头① fangbang-westbound 第 8 帧（街中西行，方浜分区按需加载）。
// 每张图另记：画面平均亮度 / 标准差（空白帧守卫），以及「浏览器检色」——同一相机的目标掩膜（web/target-mask.js，
// 与 tour-render-check 同一钩子）里目标像素的平均 sRGB 与 V=max(R,G,B)，外加目标掩膜屏幕包围盒下 55% 的「立面带」均值
// （眼高机位下屋面在上、格扇立面在下；与 render_facade.py 的立面区是近似口径，不是同一口径）。
//   三穗堂检色：sansuitang 机位，目标 bld-428179901 + 其立面开间；厅堂检色：halls 机位（镜头⑥终帧），目标 = modules/hall-kit/ids.json 全部 id。
// 用法：BASE=http://127.0.0.1:5491/ OUT_DIR=out-zone SHOT_DIR=<目录> [QS='&light=dusk'] [TAG=after-dusk] [VIEWS=a,b] node scripts/lighting-shots.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5491/';
const QS = process.env.QS || '';
const TAG = process.env.TAG || 'shot';
const SHOT_DIR = process.env.SHOT_DIR;
if (!SHOT_DIR) throw new Error('SHOT_DIR required');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const tour = JSON.parse(fs.readFileSync(path.join(OUT, 'tour.json'), 'utf8'));
const shots = JSON.parse(fs.readFileSync(path.join(OUT, 'control-shots.json'), 'utf8')).shots;
const hallIds = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'hall-kit', 'ids.json'), 'utf8')).ids;
const idSet = [...new Set([...layout.objects.map(o => o.id), ...(layout.instances || []).map(i => i.id)])];
const bays = {};
for (const o of layout.objects) if (o.parentBuilding) (bays[o.parentBuilding] ||= []).push(o.id);
const withBays = (ids) => ids.flatMap(id => [id, ...(bays[id] || [])]);
const shotFrame = (id, k) => {
  const s = shots.find(x => x.id === id);
  if (!s) throw new Error(`control shot ${id} missing`);
  const i = k < 0 ? s.eye.length + k : k;
  return { p: s.eye[i], t: s.target[i] };
};
const tourView = (k) => { if (!tour[k]) throw new Error(`tour ${k} missing`); return { p: tour[k].p, t: tour[k].t }; };

const VIEWS = {
  sansuitang: { ...tourView('sansuitang'), checks: { sansuitang: withBays(['bld-428179901']) } },
  huxinting: { ...shotFrame('huxinting-across-pond', -1) },
  jiuqu: { ...tourView('jiuqu-bridge') },
  'huabao-plaza': { ...tourView('huabaolou') },
  shanmen: { ...shotFrame('fangbang-eastbound', -1), fangbang: true },
  fangbang: { ...shotFrame('fangbang-westbound', 8), fangbang: true },
  // 厅堂检色专用机位（不进 6 机位联系表）：镜头⑥ garden-corridor-walk 终帧，两侧厅堂入画
  halls: { ...shotFrame('garden-corridor-walk', -1), checks: { halls: withBays(hallIds) } },
};
const want = (process.env.VIEWS || Object.keys(VIEWS).join(',')).split(',').filter(Boolean);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE + '?zone=core&cam=oblique' + QS, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true && typeof window.__targetMask === 'function', null, { timeout: 900000 });
const report = { base: BASE, qs: QS, tag: TAG, lighting: await page.evaluate(() => (window.__lighting ? window.__lighting.state() : null)), views: {} };
let fangbangLoaded = false;
for (const name of want) {
  const v = VIEWS[name];
  if (!v) throw new Error(`unknown view ${name}`);
  if (v.fangbang && !fangbangLoaded) {
    // 等到按钮回调真正切到方浜分区（ensureZone → 碰撞刷新 → setZone 重新取景）之后再摆相机，否则取景会被覆盖
    await page.click('[data-zone="fangbang"]');
    await page.waitForFunction(() => document.querySelector('[data-zone="fangbang"]')?.classList.contains('active'), null, { timeout: 600000 });
    await page.waitForTimeout(500);
    fangbangLoaded = true;
  }
  const r = await page.evaluate(async ({ p, t, checks, idSet }) => {
    window.__viewAt(p, t);
    for (let i = 0; i < 6; i++) await new Promise(res => requestAnimationFrame(res));
    const canvas = document.querySelector('#app canvas');
    const png = canvas.toDataURL('image/png');
    const img = new Image(); img.src = png; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; s2 += l * l; n++; }
    const out = { png, meanLum: +(s / n).toFixed(2), stdLum: +Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)).toFixed(2), color: {} };
    for (const [k, ids] of Object.entries(checks || {})) {
      const m = window.__targetMask({ ids, idSet, png: true });
      const mi = new Image(); mi.src = m.png; await mi.decode();
      const mc = document.createElement('canvas'); mc.width = m.w; mc.height = m.h;
      const mx = mc.getContext('2d'); mx.drawImage(mi, 0, 0);
      const md = mx.getImageData(0, 0, m.w, m.h).data;
      // 掩膜是绘图缓冲尺寸；canvas 截图同尺寸（DPR=1）
      let y0 = Infinity, y1 = -Infinity;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x += 2) if (md[(y * m.w + x) * 4] > 127) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const acc = (lo) => {
        let r = 0, g = 0, b = 0, v = 0, cnt = 0;
        for (let y = Math.max(0, lo); y <= y1; y++) for (let x = 0; x < m.w; x++) {
          const i = (y * m.w + x) * 4;
          if (md[i] <= 127) continue;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; v += Math.max(d[i], d[i + 1], d[i + 2]); cnt++;
        }
        return cnt ? { pixels: cnt, meanSrgb: [r / cnt, g / cnt, b / cnt].map(x => +(x / 255).toFixed(4)), meanV: +(v / cnt / 255).toFixed(4) } : { pixels: 0 };
      };
      out.color[k] = { share: +m.share.toFixed(4), whole: acc(0), facadeBand: y1 >= y0 ? acc(Math.round(y0 + 0.45 * (y1 - y0))) : { pixels: 0 } };
    }
    return out;
  }, { p: v.p, t: v.t, checks: v.checks || null, idSet });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.${TAG}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  delete r.png;
  report.views[name] = { cam: { p: v.p, t: v.t }, ...r };
  console.log(name.padEnd(14), `lum ${r.meanLum} std ${r.stdLum}`, Object.entries(r.color).map(([k, c]) => `${k} V ${c.whole.meanV} facadeV ${c.facadeBand.meanV} share ${c.share}`).join(' | '));
}
report.pageErrors = errors;
await browser.close();
fs.writeFileSync(path.join(SHOT_DIR, `${TAG}.json`), JSON.stringify(report, null, 1) + '\n');
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
