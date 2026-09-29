// wave13-nightbalance：夜景亮度平衡工单的 before/after 出图（查看器端）。
// 机位全部从运行产物重算（不写死坐标）：tour.json 导览机位 + pv-cameras.json（build-pv-shots.py 产物）首/中/末帧。
// 每张画布直截 PNG（无 DOM UI）+ 全画面平均亮度 + 可选目标掩膜检色（web/target-mask.js，同 lighting-shots 口径）。
// 与 lighting-shots.mjs 的差异：机位源多 pv-cameras.json；支持 --pick x,y（真实点击后读 window.__pickDebug 取证）。
// 用法：BASE=http://127.0.0.1:5496/ OUT_DIR=out-zone SHOT_DIR=<目录> [QS='&light=night'] [TAG=before]
//       [VIEWS=garden-ground,pond,sansuitang,tianyu,outer,garden-aerial] [PICK=x,y] node scripts/nightbalance-shots.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);   // playwright 从仓库 node_modules 解析（main 186b250f 同法）
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5496/';
const QS = process.env.QS || '';
const TAG = process.env.TAG || 'shot';
const SHOT_DIR = process.env.SHOT_DIR;
if (!SHOT_DIR) throw new Error('SHOT_DIR required');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const tour = JSON.parse(fs.readFileSync(path.join(OUT, 'tour.json'), 'utf8'));
const pvDoc = JSON.parse(fs.readFileSync(path.join(OUT, 'pv-cameras.json'), 'utf8'));
const idSet = [...new Set([...layout.objects.map(o => o.id), ...(layout.instances || []).map(i => i.id)])];
const bays = {};
for (const o of layout.objects) if (o.parentBuilding) (bays[o.parentBuilding] ||= []).push(o.id);
const withBays = (ids) => ids.flatMap(id => [id, ...(bays[id] || [])]);
const tourView = (k) => { if (!tour[k]) throw new Error(`tour ${k} missing`); return { p: tour[k].p, t: tour[k].t }; };
const pvView = (id, k) => {
  const s = pvDoc.shots.find(x => x.id === id);
  if (!s) throw new Error(`pv shot ${id} missing`);
  const i = k < 0 ? s.eye.length + k : k;
  return { p: s.eye[i], t: s.target[i] };
};

// 五个区域 ×（园林地面 aerial 复用 pv16）：机位固定，before/after 与三档联系表共用
const VIEWS = {
  'garden-ground': { ...tourView('dajiashan'), checks: { ground: ['ground'] } },
  'garden-aerial': { ...pvView('pv16-night-finale', -1), checks: { ground: ['ground'], water: ['water-62072388'] } },
  pond: { ...tourView('jiuqu-bridge'), checks: { water: ['water-62072388'] } },
  sansuitang: { ...tourView('sansuitang'), checks: { sansuitang: withBays(['bld-428179901']) } },
  tianyu: { ...pvView('pv06-bazaar-orbit', -1), checks: { tianyu: withBays(['bld-428202601']) } },
  outer: { ...pvView('pv01-aerial-reveal', -1), checks: { ground: ['ground'] } },
};
const want = (process.env.VIEWS || Object.keys(VIEWS).join(',')).split(',').filter(Boolean);
const [pickX, pickY] = (process.env.PICK || '').split(',').map(Number);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE + '?zone=core&cam=oblique' + QS, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true && typeof window.__targetMask === 'function', null, { timeout: 900000 });
const report = { base: BASE, qs: QS, tag: TAG, lighting: await page.evaluate(() => (window.__lighting ? window.__lighting.state() : null)), views: {} };
for (const name of want) {
  const v = VIEWS[name];
  if (!v) throw new Error(`unknown view ${name}`);
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
      let cnt = 0, r2 = 0, g2 = 0, b2 = 0;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const i = (y * m.w + x) * 4;
        if (md[i] <= 127) continue;
        r2 += d[i]; g2 += d[i + 1]; b2 += d[i + 2]; cnt++;
      }
      out.color[k] = { share: +m.share.toFixed(4), pixels: cnt, meanSrgb: cnt ? [r2 / cnt, g2 / cnt, b2 / cnt].map(x => +(x / 255).toFixed(4)) : null };
    }
    return out;
  }, { p: v.p, t: v.t, checks: v.checks || null, idSet });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.${TAG}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  delete r.png;
  report.views[name] = { cam: { p: v.p, t: v.t }, ...r };
  console.log(name.padEnd(14), `lum ${r.meanLum} std ${r.stdLum}`, Object.entries(r.color).map(([k, c]) => `${k} rgb ${(c.meanSrgb || [0]).map(x => (x * 255).toFixed(0)).join(',')} share ${c.share}`).join(' | '));
}
if (Number.isFinite(pickX) && Number.isFinite(pickY)) {
  // 真实点击触发 infocard 轨道拾取 → window.__pickDebug（nightqa 同法）
  await page.mouse.click(pickX, pickY);
  await page.waitForTimeout(400);
  report.pick = await page.evaluate(() => window.__pickDebug || null);
  console.log('pick', JSON.stringify(report.pick));
}
report.pageErrors = errors;
await browser.close();
fs.writeFileSync(path.join(SHOT_DIR, `${TAG}.json`), JSON.stringify(report, null, 1) + '\n');
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
