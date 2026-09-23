// G4 预览端检查 + 取景导览实图：走真实 UI 事件路径（按钮点击），非只调 evaluate。
// 检查：导览 6 按钮生效、池带独立切换、标签按距离、残差独立开关、屋顶开关、点击 ID 溯源。
// 产出 renders-goal-04/*.png + render-checks.json + viewer-checks.json（有失败 exit 1）。
// 用法：先 PORT=5480 OUT_DIR=out-goal-04 npm run server，再 node scripts/render-g4.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = path.join(ROOT, process.env.RENDER_DIR || 'renders-goal-04');
const PORT = process.env.PORT || '5480';
const OUT = process.env.OUT_DIR || 'out';
fs.mkdirSync(OUTDIR, { recursive: true });

const tour = JSON.parse(fs.readFileSync(path.join(ROOT, OUT, 'tour.json'), 'utf8'));
const shots = [
  ['01-tour-overview', 'overview'],
  ['02-tour-garden', 'garden'],
  ['03-tour-pond-bridge', 'pond-bridge'],
  ['04-tour-temple', 'temple'],
  ['05-tour-main-street', 'main-street'],
  ['06-tour-stalls', 'stalls'],
];

const CHROME = (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath());
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
// 等 tour.json 按钮与残差数据就绪
await page.waitForFunction(`document.querySelectorAll('[data-tour]').length === ${Object.keys(tour).length}`, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);

let pass = 0, fail = 0;
const checks = {};
const check = (name, cond, detail = '') => {
  checks[name] = { ok: !!cond, detail: String(detail) };
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail); }
};

// 1) UI 结构：池带独立按钮 + 导览按钮组
check('pond-zone-button', await page.locator('button[data-zone="pond"]').count() === 1);
check('tour-buttons-6', await page.locator('#tourbtns button[data-tour]').count() === Object.keys(tour).length, `want ${Object.keys(tour).length}`);
check('tour-caption-nonwalk', (await page.locator('#tourcap').textContent()).includes('非行走'));

// 2) 逐导览机位：点按钮 → 空白守卫 → 截图
const results = [];
for (const [name, key] of shots) {
  await page.click(`button[data-tour="${key}"]`);
  await page.waitForTimeout(1400);
  const stats = await page.evaluate(() => window.__pixelStats());
  const cam = await page.evaluate(() => window.__cam());
  const file = path.join(OUTDIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  const blank = stats.std < 2.0 || stats.uniq < 12;
  results.push({ name, tour: key, ...stats, blank, bytes: fs.statSync(file).size, cam });
  check(`shot:${name}`, !blank, `std=${stats.std.toFixed(1)} uniq=${stats.uniq}`);
  check(`cam:${key}`, !!cam && Math.abs(cam.p[0] - tour[key].p[0]) < 0.5 && Math.abs(cam.p[1] - tour[key].p[1]) < 0.5, JSON.stringify(cam?.p));
}

// 3) 池带独立切换：机位取景框到池带（全域背景仍渲染，区域切换=取景+标签过滤，不隐藏节点）
const pondBBox = (() => {
  const layout = JSON.parse(fs.readFileSync(path.join(ROOT, OUT, 'layout.json'), 'utf8'));
  const pts = layout.zones.pond.polygon;
  return { x: [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0]))], z: [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))] };
})();
await page.click('button[data-zone="pond"]');
await page.waitForTimeout(900);
const pondView = await page.evaluate(() => {
  const cam = window.__cam();
  let hiddenNodes = 0, pondNodes = 0;
  window.__scene.traverse(o => {
    const nm = String(o.name || '');
    if (nm === 'ZN-pond') pondNodes++;
    if (nm.startsWith('ZN-') && o.visible === false) hiddenNodes++;
  });
  return { cam, pondNodes, hiddenNodes };
});
const inPond = pondView.cam.t[0] > pondBBox.x[0] - 10 && pondView.cam.t[0] < pondBBox.x[1] + 10 &&
  pondView.cam.t[2] > pondBBox.z[0] - 10 && pondView.cam.t[2] < pondBBox.z[1] + 10;
check('pond-zone-switch', inPond && pondView.pondNodes > 0 && pondView.hiddenNodes === 0, JSON.stringify({ pondView, pondBBox }));
await page.screenshot({ path: path.join(OUTDIR, '07-zone-pond.png'), fullPage: false });

// 4) 标签按距离：核心总览只显示区域级；低机位近景出现设施名
await page.click('button[data-zone="core"]');
await page.waitForTimeout(700);
const stCore = await page.evaluate(() => window.__labelStats());
check('labels-core-region-only', stCore.visible > 0 && stCore.facility === 0, JSON.stringify(stCore));
await page.evaluate(() => window.__tour('garden'));
await page.waitForTimeout(700);
const stGarden = await page.evaluate(() => window.__labelStats());
check('labels-garden-facility-near', stGarden.facility > 0, JSON.stringify(stGarden));

// 5) 残差独立开关：默认关，开后标记数>0 且不受标签开关影响；总览位截图保证标记在画面内
const resCount = await page.evaluate(() => window.__resMarkers().length);
check('residual-markers-data-driven', resCount >= 3, `count=${resCount}`);
await page.click('button[data-zone="core"]');
await page.waitForTimeout(900);
await page.click('#t-labels'); // 关标签
await page.evaluate(() => window.__res(true));
await page.waitForTimeout(600);
const resShown = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.lbl.res')];
  return { total: els.length, shown: els.filter(e => e.style.display === 'block' && e.style.visibility !== 'hidden').length, labelsOff: !document.getElementById('t-labels').classList.contains('active') };
});
check('residual-independent-of-labels', resShown.labelsOff === true && resShown.shown > 0, JSON.stringify(resShown));
await page.screenshot({ path: path.join(OUTDIR, '08-residual-overlay.png'), fullPage: false });
await page.evaluate(() => window.__res(false));
await page.click('#t-labels'); // 恢复标签

// 6) 屋顶开关 + 点击 ID 溯源继续工作
const roofCounts = await page.evaluate(() => {
  const before = [];
  window.__scene.traverse(o => { const p = String(o.name || '').split('|'); if (p[4] === 'roofpart' || o.userData?.roof) before.push(o); });
  return before.length;
});
check('roof-parts-present', roofCounts > 0, `roofparts=${roofCounts}`);
await page.click('#t-roofs');
await page.waitForTimeout(400);
const roofHidden = await page.evaluate(() => {
  let hidden = 0, shown = 0;
  window.__scene.traverse(o => { const p = String(o.name || '').split('|'); if (p[4] === 'roofpart' || o.userData?.roof) (o.visible === false ? hidden++ : shown++); });
  return { hidden, shown };
});
check('roof-toggle-hides', roofHidden.hidden > 0 && roofHidden.shown === 0, JSON.stringify(roofHidden));
await page.click('#t-roofs'); // 恢复
// 点击溯源：庙院导览位点击画面中心应命中带 ID 对象
await page.evaluate(() => window.__tour('temple'));
await page.waitForTimeout(700);
await page.mouse.click(800, 500);
await page.waitForTimeout(400);
const infoShown = await page.evaluate(() => {
  const el = document.getElementById('info');
  return { display: el.style.display, text: el.textContent.slice(0, 120) };
});
check('click-id-trace', infoShown.display === 'block' && /ID/.test(infoShown.text), JSON.stringify(infoShown));

await browser.close();
fs.writeFileSync(path.join(OUTDIR, 'render-checks.json'), JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(OUTDIR, 'viewer-checks.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), outDir: OUT, port: PORT,
  summary: { pass, fail }, checks,
}, null, 1));
const tripped = results.filter(r => r.blank);
if (tripped.length || fail) {
  console.error(`失败: fail=${fail}, 空白帧=${tripped.map(t => t.name).join(',') || '无'}`);
  process.exit(1);
}
console.log(`renders ok: ${results.length} shots, checks ${pass} pass / ${fail} fail`);
