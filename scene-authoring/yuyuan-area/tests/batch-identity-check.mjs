// wave4-drawcalls：运行时合批（web/batching.js）不破坏按对象身份的消费者 —— 同机位 A/B：默认（合批）对 ?batch=0（改前渲染路径）。
// 断言：
//   I0 合批确实生效：默认页 __batchStats().batches > 0，且核心视图每帧 WebGL 绘制调用 < batch=0 的一半；
//   I1 点选溯源：核心视图 5×4 网格屏幕点逐个真实鼠标点击，#info 面板显示的对象 ID 两边逐点相同（且命中 ≥ 8 个）；
//   I2 导览目标着色（web/target-mask.js window.__targetMask，tour-render-check 的同一钩子）：每个导览机位
//      目标像素占比两边相差 ≤ 0.002（绝对值），layout-id 目标的 meshesMatched 逐 id 相同；
//   I3 可见性：屋顶按钮（产物里有 roof 标记节点时）与通用「原网格 visible=false → __batchSync」两边一致，画面确有变化，恢复后 < 1%；
//   I4 标签遮挡剔除：导览机位 anchor-main 下 __lastLabelDedupe（遮挡隐藏数 / ghost 数 / 重叠对）与 __labelStats 两边相同；
//   I5 按需加载方浜中路：两边点「方浜中路」，等 fangbang 两件加载完，合批页 fangbang 件已合批、
//      每帧绘制调用 < batch=0、三角面 ≤ batch=0、canvas 非边缘差异 < 1%；
//   I6 步行：两边 __walk.spawnAt('main')，物理墙数 / 地面三角数相同、脚点着地。
// 用法：BASE=http://127.0.0.1:5494/ OUT_DIR=out-zone [SHOT_DIR=<目录>] [REPORT=<json>] node tests/batch-identity-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streetCorridorBox } from '../scripts/tour-visibility.mjs';
import { glCounterInit, settle, frameCounts, canvasPng, pixelDiff, savePng, PIX_MAX } from './perf-lib.mjs';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5494/';
const SHOT_DIR = process.env.SHOT_DIR || null;
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

// 目标规格与 tests/tour-render-check.mjs 同源（layout 冻结源 + nav-gap 锚点 + commercial-route）
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const tour = JSON.parse(fs.readFileSync(path.join(OUT, 'tour.json'), 'utf8'));
const idSet = [...new Set([...layout.objects.map(o => o.id), ...(layout.instances || []).map(i => i.id)])];
const bays = {};
for (const o of layout.objects) if (o.parentBuilding) (bays[o.parentBuilding] ||= []).push(o.id);
function targetSpec(key, v) {
  if (String(v.targetObject).startsWith('street:')) {
    const spec = String(v.targetObject).slice('street:'.length), cont = spec.startsWith('cont:');
    const [from, to] = (cont ? spec.slice(5) : spec).split('->');
    const r = routes.find(x => x.from === from && x.to === to);
    const [a, b] = cont ? r.points.slice(-2) : r.points.slice(0, 2);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { obb: streetCorridorBox(nav.anchors[key.slice('anchor-'.length)], [(b[0] - a[0]) / l, (b[1] - a[1]) / l], cont ? null : r.points), pad: 0.25 };
  }
  return { ids: [v.targetObject, ...(bays[v.targetObject] || [])], idSet };
}

let fails = 0;
const fail = (m) => { console.error('FAIL', m); fails++; };
const ok = (m) => console.log('ok  ', m);
const report = {};
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;   // 例 ONLY=I3,I5 只跑这几段
const want = (k) => !ONLY || ONLY.includes(k);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
async function openPage(qs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(glCounterInit);
  await page.goto(BASE + qs, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  await page.waitForFunction(() => window.__tour && document.querySelectorAll('[data-tour]').length > 0, null, { timeout: 60000 });
  await settle(page, 20);
  return page;
}
const B = await openPage('?zone=core&cam=oblique');            // 合批（默认）
const U = await openPage('?zone=core&cam=oblique&batch=0');    // 改前渲染路径
const both = async (fn) => Promise.all([fn(B), fn(U)]);

// ---------- I0 合批生效 ----------
if (want('I0')) {
  const [fb, fu] = await both(frameCounts);
  report.I0 = { batched: fb, unbatched: fu };
  if (!fb.batch || !(fb.batch.batches > 0)) fail(`I0 合批未生效：__batchStats=${JSON.stringify(fb.batch)}`);
  else if (!(fb.apiCalls * 2 < fu.apiCalls)) fail(`I0 合批后每帧绘制调用 ${fb.apiCalls} 未降到 batch=0 (${fu.apiCalls}) 的一半以下`);
  else ok(`I0 合批生效：${fb.batch.batches} 批 / ${fb.batch.batchedMeshes} 网格；每帧调用 ${fu.apiCalls} → ${fb.apiCalls}`);
}

// ---------- I1 点选溯源 ----------
if (want('I1')) {
  const pts = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) pts.push([Math.round(140 + i * 280), Math.round(200 + j * 190)]);
  const pick = async (page) => {
    const out = [];
    for (const [x, y] of pts) {
      await page.evaluate(() => { const el = document.getElementById('info'); el.style.display = 'none'; el.innerHTML = ''; });
      await page.mouse.click(x, y);
      out.push(await page.evaluate(() => {
        const el = document.getElementById('info');
        if (el.style.display !== 'block') return null;
        const dt = [...el.querySelectorAll('dt')].find(d => d.textContent === 'ID');
        return dt ? dt.nextElementSibling.textContent : el.querySelector('h2')?.textContent || null;
      }));
    }
    return out;
  };
  const [pb, pu] = await both(pick);
  const same = pb.every((v, i) => v === pu[i]);
  const hits = pb.filter(Boolean).length;
  report.I1 = { points: pts, batched: pb, unbatched: pu };
  if (!same) fail(`I1 点选 ID 不一致：${JSON.stringify(pts.map((p, i) => [p, pb[i], pu[i]]).filter(r => r[1] !== r[2]))}`);
  else if (hits < 8) fail(`I1 点选命中太少（${hits}/20），样本不足`);
  else ok(`I1 点选溯源 ${hits}/20 点命中，两边 ID 逐点相同`);
}

// ---------- I2 导览目标着色 ----------
if (want('I2')) {
  report.I2 = {};
  for (const [key, v] of Object.entries(tour)) {
    const spec = targetSpec(key, v);
    const run = (page) => page.evaluate(async ({ p, t, spec }) => {
      window.__viewAt(p, t);
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const m = window.__targetMask(spec);
      return { share: m.share, meshesMatched: m.meshesMatched };
    }, { p: v.p, t: v.t, spec });
    const [mb, mu] = await both(run);
    report.I2[key] = { batched: mb, unbatched: mu };
    const dShare = Math.abs(mb.share - mu.share);
    const sameMatched = JSON.stringify(Object.entries(mb.meshesMatched).sort()) === JSON.stringify(Object.entries(mu.meshesMatched).sort());
    if (dShare > 0.002 || !sameMatched) fail(`I2 ${key}: 目标占比 ${(mb.share * 100).toFixed(3)}% vs ${(mu.share * 100).toFixed(3)}%，meshesMatched ${JSON.stringify(mb.meshesMatched)} vs ${JSON.stringify(mu.meshesMatched)}`);
    else ok(`I2 ${key.padEnd(16)} 目标占比 ${(mb.share * 100).toFixed(2)}% = ${(mu.share * 100).toFixed(2)}%，meshesMatched 相同`);
  }
  // 掩膜之后主画面照常（合批恢复可见、原网格不漏画）
  await both(p => p.evaluate(() => window.__goto('core', 'oblique')));
  await both(p => settle(p, 20));
  const [fb, fu] = await both(frameCounts);
  if (!(fb.apiCalls * 2 < fu.apiCalls)) fail(`I2 掩膜后合批页每帧调用 ${fb.apiCalls} 没回到合批水平（batch=0 ${fu.apiCalls}）`);
}

// ---------- I3 可见性开关（屋顶按钮 + 通用原网格 visible） ----------
// I3a 屋顶按钮：main.js 按 infoOf().roof（节点名第 5 段 roofpart / userData.roof）改原网格 visible，再 syncVisibility。
//     当前产物里带这两种标记的节点数为 0（改前即如此，按钮无效果）——只报告数量，不据此判失败。
// I3b 通用：两边把名字含 roof 的节点（屋面件的组节点或网格）visible=false，合批页调 __batchSync()，
//     合批对 batch=0 非边缘差异 < 1%，合批页前后画面确有变化（> 0.5% 像素），恢复后与原图 < 1%。
if (want('I3')) {
  await both(p => p.evaluate(() => window.__goto('core', 'oblique')));
  await both(p => settle(p, 20));
  const roofFlagged = await B.evaluate(() => { let n = 0; window.__scene.traverse(o => { if (String(o.name).split('|')[4] === 'roofpart' || o.userData?.roof) n++; }); return n; });
  if (roofFlagged > 0) {
    const on = await canvasPng(B);
    await both(p => p.click('#t-roofs'));
    await both(p => settle(p, 20));
    const [offB, offU] = await both(canvasPng);
    const dOff = await pixelDiff(B, offU, offB), dToggle = await pixelDiff(B, on, offB);
    await both(p => p.click('#t-roofs'));
    await both(p => settle(p, 20));
    if (dOff.share >= PIX_MAX || dToggle.rawShare <= 0.005) fail(`I3a 屋顶按钮：合批对 batch=0 ${(dOff.share * 100).toFixed(3)}%，开关改变 ${(dToggle.rawShare * 100).toFixed(3)}%`);
    else ok(`I3a 屋顶按钮 ${roofFlagged} 个节点：合批对 batch=0 ${(dOff.share * 100).toFixed(3)}%`);
  } else console.log(`note I3a 屋顶按钮：产物中带 roofpart/userData.roof 标记的节点 0 个（改前同样），按钮无可见效果，不判`);
  const on = await canvasPng(B);
  const hide = (page, v) => page.evaluate((v) => { let n = 0; window.__scene.traverse(o => { if (!o.isBatchedMesh && /roof/i.test(o.name)) { o.visible = v; n++; } }); window.__batchSync?.(); return n; }, v);
  const [nB, nU] = await Promise.all([hide(B, false), hide(U, false)]);
  await both(p => settle(p, 20));
  const [offB, offU] = await both(canvasPng);
  const dOff = await pixelDiff(B, offU, offB);
  const dToggle = await pixelDiff(B, on, offB);
  await Promise.all([hide(B, true), hide(U, true)]);
  await both(p => settle(p, 20));
  const back = await canvasPng(B);
  const dBack = await pixelDiff(B, on, back);
  report.I3 = { roofFlaggedNodes: roofFlagged, hiddenByName: [nB, nU], hiddenVsBatch0: dOff.share, hiddenVsBatch0Raw: dOff.rawShare, toggleChangedRaw: dToggle.rawShare, restoredVsBefore: dBack.share };
  if (SHOT_DIR) { savePng(path.join(SHOT_DIR, 'roofs-hidden.png'), offB); savePng(path.join(SHOT_DIR, 'roofs-hidden.batch0.png'), offU); savePng(path.join(SHOT_DIR, 'roofs-hidden.diff-vs-batch0.png'), dOff.png); }
  if (nB !== nU || nB === 0) fail(`I3b 按名隐藏的屋面网格数 ${nB} vs ${nU}`);
  else if (dOff.share >= PIX_MAX) fail(`I3b 隐藏屋面后合批对 batch=0 非边缘差异 ${(dOff.share * 100).toFixed(3)}% ≥ 1%`);
  else if (dToggle.rawShare <= 0.005) fail(`I3b 隐藏屋面前后合批页画面几乎没变（${(dToggle.rawShare * 100).toFixed(3)}%）——合批实例没跟随原网格隐藏`);
  else if (dBack.share >= PIX_MAX) fail(`I3b 恢复后与原图差异 ${(dBack.share * 100).toFixed(3)}% ≥ 1%`);
  else ok(`I3b 隐藏 ${nB} 个屋面节点：合批对 batch=0 ${(dOff.share * 100).toFixed(3)}%，画面改变 ${(dToggle.rawShare * 100).toFixed(1)}% 像素，恢复 ${(dBack.share * 100).toFixed(3)}%`);
}

// ---------- I4 标签遮挡剔除 ----------
if (want('I4')) {
  const run = (page) => page.evaluate(async () => {
    window.__tour('anchor-main');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { dedupe: window.__lastLabelDedupe, stats: window.__labelStats(), occluders: window.__labelOccluderCount };
  });
  const [lb, lu] = await both(run);
  report.I4 = { batched: lb, unbatched: lu };
  if (JSON.stringify(lb) !== JSON.stringify(lu)) fail(`I4 标签遮挡结果不一致：${JSON.stringify(lb)} vs ${JSON.stringify(lu)}`);
  else if (!lb.occluders) fail('I4 遮挡集未就绪');
  else ok(`I4 标签遮挡剔除一致：${JSON.stringify(lb.dedupe)}，遮挡盒 ${lb.occluders}`);
}

// ---------- I5 按需加载方浜中路 ----------
if (want('I5')) {
  await both(p => p.click('button[data-zone="fangbang"]'));
  await both(p => p.waitForFunction(() => (window.__zonesLoaded || []).filter(z => z.startsWith('fangbang')).length >= 2, null, { timeout: 900000 }));
  await both(p => settle(p, 30));
  const [fb, fu] = await both(frameCounts);
  const [pb, pu] = await both(canvasPng);
  const d = await pixelDiff(B, pu, pb);
  const fbZones = Object.keys(fb.batch?.perZone || {}).filter(k => k.startsWith('ZN-fangbang'));
  report.I5 = { batched: fb, unbatched: fu, pixelDiff: { share: d.share, rawShare: d.rawShare }, fangbangBatchedParts: fbZones };
  if (SHOT_DIR) { savePng(path.join(SHOT_DIR, 'fangbang.png'), pb); savePng(path.join(SHOT_DIR, 'fangbang.batch0.png'), pu); savePng(path.join(SHOT_DIR, 'fangbang.diff-vs-batch0.png'), d.png); }
  if (fbZones.length < 2) fail(`I5 方浜中路件未合批：${JSON.stringify(fbZones)}`);
  else if (!(fb.apiCalls < fu.apiCalls)) fail(`I5 方浜中路视图每帧调用 ${fb.apiCalls} 不低于 batch=0 ${fu.apiCalls}`);
  else if (fb.triangles > fu.triangles) fail(`I5 方浜中路视图三角面 ${fb.triangles} > batch=0 ${fu.triangles}`);
  else if (d.share >= PIX_MAX) fail(`I5 方浜中路视图非边缘差异 ${(d.share * 100).toFixed(3)}% ≥ 1%`);
  else ok(`I5 方浜中路按需加载：调用 ${fu.apiCalls} → ${fb.apiCalls}，三角 ${fu.triangles} → ${fb.triangles}，差异 ${(d.share * 100).toFixed(3)}%`);
}

// ---------- I6 步行 ----------
if (want('I6')) {
  const run = (page) => page.evaluate(async () => {
    const s0 = await window.__walk.spawnAt('main');
    for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));
    const s = window.__walk.status();
    window.__walk.exit();
    return { wallCount: s0.wallCount, groundTriangleCount: s0.groundTriangleCount, grounded: s.grounded, feet: s.feet.map(v => +v.toFixed(2)) };
  });
  const [wb, wu] = await both(run);
  report.I6 = { batched: wb, unbatched: wu };
  if (wb.wallCount !== wu.wallCount || wb.groundTriangleCount !== wu.groundTriangleCount) fail(`I6 步行物理不一致：${JSON.stringify(wb)} vs ${JSON.stringify(wu)}`);
  else if (!wb.grounded) fail(`I6 合批页步行未着地：${JSON.stringify(wb)}`);
  else ok(`I6 步行：墙 ${wb.wallCount} / 地面三角 ${wb.groundTriangleCount} 两边相同，着地 feet ${JSON.stringify(wb.feet)}`);
}

await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`batch-identity-check: ${fails} fail`); process.exit(1); }
console.log('batch-identity-check: all pass');
