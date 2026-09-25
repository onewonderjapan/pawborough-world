// wave3-tourfix T2：导览机位渲染后复核（headless 浏览器真实渲染，补碰撞盒/包围盒几何代理的盲区）。
// 断言：每个导览机位下，目标在画面里实际露出的像素占比 ≥ 3%。
// 方法（web/target-mask.js window.__targetMask）：同一相机把场景另渲一遍——目标几何纯白、其余几何纯黑
// （照常写深度，遮挡真实）、背景黑、无色调映射，读回像素数非黑像素。目标从冻结源重算，不读 tour.json 的声明以外的东西：
//   - layout 对象机位（三穗堂/九曲桥/大假山/玉玲珑/华宝楼）与 anchor-jiuqu（九曲桥）：按节点归属 layout id
//     （同 render-control-passes.py 分割规则），目标像素 = 目标本体 + layout facadeBay.parentBuilding 指向它的立面开间；
//   - 锚点街景机位（targetObject = street:<route>，无对应 layout 对象）：体积目标 = tour-test 同一街廊盒
//     （tour-visibility.streetCorridorBox，nav-gap 锚点 + commercial-route 出发段），片元世界坐标落在盒内
//     （各半轴 +0.25 m 容差，接住地面/铺装厚度）即算——即走廊里露出来的街面与街边立面。
// wave4-touranchor 锚点街景新口径（anchor-* 六机位，常数 = tour-visibility.STREET_VIEW）：
//   目标 = 街廊盒里的街面 + 走廊盒两侧各 6 m 内的建筑立面像素（近竖直面，立面带盒 streetFacadeBand）；
//   断言：目标 ≥ 25%、天空（无几何像素）≤ 35%、画面下 1/3 近景墙（近竖直面、距相机 < 6 m）最大 4-连通区 < 40%；
//   锚点机位的 targetObject 必须是 street:<route>（非街景目标的锚点照样按其锚点首条路线的走廊量一遍，再判失败）。
//   其余五个地标机位口径不变（≥ 3%）。
//   桥头锚点规则（主控 D1 定，2026-09-25）：anchor-jiuqu 锚点就在九曲桥桥头，目标保持九曲桥（targetObject = jiuqu-bridge）——
//     目标像素按 layout id 掩膜（同地标机位）≥ 3%；另加与街景锚点同一组画面门槛：天空 ≤ 35%、画面下 1/3 近景墙最大连通区 < 40%
//     （画面统计用 street 掩膜的 G/B 通道，不设走廊）。只有这一个锚点、这一个目标适用；其余锚点仍必须是 street:<route>。
//   「顶棚」soffit（朝下面占比）只报告不判（主控 D2 定）：old-south→old-north 老街全程在过街楼通道下（reviewRepair
//     通道 road-428199190，净高 3.5 m），暗顶棚是这条老街的真实特征，不是机位问题；任何机位都拍得到它，判它等于判这条街不合格。
// 机位取自 TOUR（缺省 OUT_DIR/tour.json），用 window.__viewAt(p, t) 摆相机（与导览按钮同参：fov46，视口 1400×900）。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone [TOUR=<tour.json>] [SHOT_DIR=<目录>] [REPORT=<json>] node tests/tour-render-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streetCorridorBox, streetFacadeBand, facadeIds, STREET_VIEW } from '../scripts/tour-visibility.mjs';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5489/';
const shotDir = process.env.SHOT_DIR || null;
const MIN_SHARE = 0.03;
const STREET_PAD_M = 0.25;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const tour = JSON.parse(fs.readFileSync(process.env.TOUR || path.join(OUT, 'tour.json'), 'utf8'));
const idSet = [...new Set([...layout.objects.map(o => o.id), ...(layout.instances || []).map(i => i.id)])];
const bays = {};
for (const o of layout.objects) if (o.parentBuilding) (bays[o.parentBuilding] ||= []).push(o.id);

// street:A->B = 路线 A→B 第一段（折线供街廊截到拐点前）；street:cont:A->B = 末段顺势延伸（全长）—— 同 tour-test
const FACADE_IDS = facadeIds(layout);
const BRIDGE_ANCHORS = { 'anchor-jiuqu': 'jiuqu-bridge' }; // 桥头锚点规则（见文件头，D1）
const FRAME_ONLY = { obb: null, band: null, facadeIds: [], idSet: [], nearM: STREET_VIEW.NEAR_M, verticalNy: STREET_VIEW.VERTICAL_NY };
function streetSpec(key, tag) {
  const spec = String(tag).slice('street:'.length), cont = spec.startsWith('cont:');
  const [from, to] = (cont ? spec.slice(5) : spec).split('->');
  const r = routes.find(x => x.from === from && x.to === to);
  if (!r) throw new Error(`${key}: 路线 ${spec} 不在 commercial-route.json`);
  const [a, b] = cont ? r.points.slice(-2) : r.points.slice(0, 2);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const anchor = nav.anchors[key.slice('anchor-'.length)], dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], pts = cont ? null : r.points;
  return {
    street: {
      obb: streetCorridorBox(anchor, dir, pts), pad: STREET_PAD_M, band: streetFacadeBand(anchor, dir, pts),
      facadeIds: FACADE_IDS, idSet, nearM: STREET_VIEW.NEAR_M, verticalNy: STREET_VIEW.VERTICAL_NY,
    },
  };
}
// 锚点机位若不是街景目标（旧 anchor-jiuqu = 九曲桥），按该锚点在 commercial-route.json 的首条路线（出发优先，其次终点延伸）取走廊量一遍
function fallbackStreetTag(aKey) {
  const r = routes.find(x => x.from === aKey);
  if (r) return `street:${r.from}->${r.to}`;
  const e = routes.find(x => x.to === aKey);
  return e ? `street:cont:${e.from}->${e.to}` : null;
}
function targetSpec(key, v) {
  if (String(v.targetObject).startsWith('street:')) return { kind: 'street-view', tag: v.targetObject, ...streetSpec(key, v.targetObject) };
  if (BRIDGE_ANCHORS[key] && BRIDGE_ANCHORS[key] === v.targetObject)
    return { kind: 'bridge-anchor', ids: [v.targetObject, ...(bays[v.targetObject] || [])], idSet, frame: FRAME_ONLY };
  if (key.startsWith('anchor-')) {
    const tag = fallbackStreetTag(key.slice('anchor-'.length));
    if (!tag) throw new Error(`${key}: 锚点无路线，无法按街景口径量`);
    return { kind: 'street-view', tag, notStreetTarget: v.targetObject, ...streetSpec(key, tag) };
  }
  if (!layout.objects.some(o => o.id === v.targetObject)) throw new Error(`${key}: targetObject ${v.targetObject} 不在 layout`);
  return { kind: 'layout-id', ids: [v.targetObject, ...(bays[v.targetObject] || [])], idSet };
}

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base + '?zone=core&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true && typeof window.__targetMask === 'function', null, { timeout: 600000 });
await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });

const report = {};
let fails = 0;
for (const [key, v] of Object.entries(tour)) {
  const spec = targetSpec(key, v);
  const r = await page.evaluate(async ({ p, t, spec, png }) => {
    window.__viewAt(p, t);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const m = window.__targetMask({ ids: spec.ids, idSet: spec.idSet, obb: spec.obb, pad: spec.pad, street: spec.street, png });
    if (spec.frame) { const fm = window.__targetMask({ street: spec.frame }); m.sky = fm.sky; m.soffit = fm.soffit; m.nearMax = fm.nearMax; }
    let overlay = null;
    if (png) { // 截图 + 目标掩膜红色叠加（便于人工核对掩膜是否落在目标上）
      const src = document.querySelector('canvas');
      const c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, m.w, m.h);
      const img = new Image(); img.src = m.png; await img.decode();
      const mc = document.createElement('canvas'); mc.width = m.w; mc.height = m.h;
      const mctx = mc.getContext('2d'); mctx.drawImage(img, 0, 0);
      const md = mctx.getImageData(0, 0, m.w, m.h).data, od = ctx.getImageData(0, 0, m.w, m.h);
      for (let i = 0; i < md.length; i += 4) {
        if (md[i] > 127) { od.data[i] = Math.round(od.data[i] * 0.45 + 255 * 0.55); od.data[i + 1] = Math.round(od.data[i + 1] * 0.45); od.data[i + 2] = Math.round(od.data[i + 2] * 0.45); }
        else if (spec.street && md[i + 2] > 127) { od.data[i] = Math.round(od.data[i] * 0.45); od.data[i + 1] = Math.round(od.data[i + 1] * 0.45); od.data[i + 2] = Math.round(od.data[i + 2] * 0.45 + 255 * 0.55); }
      }
      ctx.putImageData(od, 0, 0);
      if (spec.street || spec.frame) { ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2; ctx.setLineDash([12, 8]); ctx.beginPath(); ctx.moveTo(0, m.h * 2 / 3); ctx.lineTo(m.w, m.h * 2 / 3); ctx.stroke(); }
      overlay = c.toDataURL('image/png');
    }
    return { ...m, overlay, cam: window.__cam() };
  }, { p: v.p, t: v.t, spec, png: !!shotDir });
  const why = [];
  if (spec.street) {
    if (spec.notStreetTarget) why.push(`锚点目标 ${spec.notStreetTarget} 非街景（应为 street:<route>，桥头锚点规则只认 ${JSON.stringify(BRIDGE_ANCHORS)}）`);
    if (r.share < STREET_VIEW.MIN_TARGET) why.push(`目标 ${(r.share * 100).toFixed(1)}% < ${STREET_VIEW.MIN_TARGET * 100}%`);
  } else if (r.share < MIN_SHARE) why.push(`目标 ${(r.share * 100).toFixed(2)}% < ${MIN_SHARE * 100}%`);
  if (spec.street || spec.frame) { // 街景锚点与桥头锚点共用的画面门槛
    if (r.sky > STREET_VIEW.MAX_SKY) why.push(`天空 ${(r.sky * 100).toFixed(1)}% > ${STREET_VIEW.MAX_SKY * 100}%`);
    if (r.nearMax >= STREET_VIEW.MAX_NEAR_COMPONENT) why.push(`下1/3近景墙连通区 ${(r.nearMax * 100).toFixed(1)}% ≥ ${STREET_VIEW.MAX_NEAR_COMPONENT * 100}%`);
  }
  const ok = !why.length;
  if (!ok) fails++;
  report[key] = { targetObject: v.targetObject, method: spec.kind, streetTag: spec.tag || null, targetIds: spec.ids || null, share: +r.share.toFixed(4), sky: r.sky != null ? +r.sky.toFixed(4) : null, soffit: r.soffit != null ? +r.soffit.toFixed(4) : null, nearMax: r.nearMax != null ? +r.nearMax.toFixed(4) : null, pixels: r.pixels, size: [r.w, r.h], meshesMatched: r.meshesMatched, cam: r.cam, pass: ok, fail: why };
  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, `${key}.png`) });
    fs.writeFileSync(path.join(shotDir, `${key}.mask.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(shotDir, `${key}.overlay.png`), Buffer.from(r.overlay.split(',')[1], 'base64'));
  }
  const extra = (spec.street || spec.frame) ? ` sky ${(r.sky * 100).toFixed(1).padStart(5)}% soffit ${(r.soffit * 100).toFixed(1).padStart(5)}% near1/3 ${(r.nearMax * 100).toFixed(1).padStart(5)}%` : '';
  console.log(`${key.padEnd(18)} ${String(v.targetObject).padEnd(34)} ${spec.kind.padEnd(14)} target ${(r.share * 100).toFixed(2).padStart(6)}%${extra} ${ok ? 'OK' : 'FAIL: ' + why.join('; ')} meshes ${JSON.stringify(r.meshesMatched)}`);
}
await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ minShare: MIN_SHARE, streetView: STREET_VIEW, streetPadM: STREET_PAD_M, tour: process.env.TOUR || path.join(OUT, 'tour.json'), views: report }, null, 1) + '\n');
if (fails) { console.error(`tour-render-check: ${fails}/${Object.keys(tour).length} views fail (landmarks < ${MIN_SHARE * 100}% target, or anchor street-view / bridge-anchor gates)`); process.exit(1); }
console.log(`tour-render-check: all ${Object.keys(tour).length} views pass (landmarks ≥ ${MIN_SHARE * 100}%; bridge anchor ≥ ${MIN_SHARE * 100}% + sky/near gates; street anchors target ≥ ${STREET_VIEW.MIN_TARGET * 100}%, sky ≤ ${STREET_VIEW.MAX_SKY * 100}%, near-wall < ${STREET_VIEW.MAX_NEAR_COMPONENT * 100}%)`);
