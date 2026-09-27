// wave11-infocard：点击地标弹信息卡 —— headless 验收（工单 GOAL：先在未改代码上跑出失败）。
// 用法：先起服务 PORT=5496 OUT_DIR=out-zone node scripts/server.mjs &（只用 5496，不碰 5607）
//       BASE=http://127.0.0.1:5496/ OUT_DIR=out-zone [SHOT_DIR=<目录>] [REPORT=<json>] node tests/infocard-test.mjs
// 期望值全部从 baseline/layout.json 现算（不拿产物比产物）。类别/所在区域/模型来源三张映射按工单白名单
// 在本文件独立重写成 oracle —— 不 import web/infocard.js 的映射函数，映射本身也在被测范围；
// 唯一 import 的实现物是 KIT_IDS 常量表，用 modules/*/ids.json 等冻结源整表复核（T3）。
// 断言：
//   T1 8 个对象真实点击逐个弹卡，6 个白名单字段 + 名称逐项等于 baseline 现算值：
//      三穗堂 / 仰山堂 / 湖心亭 / 九曲桥 / 大假山 / 华宝楼 / 城隍庙大殿 / 上海老饭店
//      （方浜中路分区对象在 layout 里无名，按工单「若无名则换一个有名对象」换成上海老饭店）
//   T2 白名单：卡片 DOM 只有 h2 名称 + 6 组 dt/dd + 1 行固定数据边界说明，无任何其他文本节点
//   T3 KIT_IDS == 冻结源复核表（hall-kit/bazaar-tower-kit ids.json + assemble.py SANSUITANG_DIR + huxinting + rockery 目标 id）
//   T4 无名对象不弹卡；点空白不弹卡
//   T5 Esc 关卡
//   T6 步行模式不弹卡；退回轨道后恢复弹卡
//   T7 375px 手机宽度：卡片不溢出视口、页面无横向滚动
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5496/';
const SHOT_DIR = process.env.SHOT_DIR || null;
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const objs = new Map(layout.objects.map(o => [o.id, o]));

// ---------- oracle（独立于实现） ----------
function footprintArea(o) {
  const fp = o?.geometry?.footprint;
  if (!Array.isArray(fp) || fp.length < 3) return null;
  let a = 0;
  for (let i = 0; i < fp.length; i++) a += fp[i][0] * fp[(i + 1) % fp.length][1] - fp[(i + 1) % fp.length][0] * fp[i][1];
  return Math.abs(a) / 2;
}
const NOTE = '名称来自 OpenStreetMap；形制为本项目推断建模，年代与史实未核实。';
const FIELDS = ['类别', '所在区域', '高度', '层数', '占地面积', '模型来源'];
// 8 个点击对象：kind/area/source 按工单白名单与冻结套件表写死；数值字段运行时从 baseline 现算。
const TARGETS = [
  { id: 'bld-428179901', kind: '厅堂', area: '豫园', src: '套件：sansuitang', name: '三穗堂' },
  { id: 'bld-428179902', kind: '厅堂', area: '豫园', src: '套件：hall-kit', name: '仰山堂' },
  { id: 'huxin-ting', kind: '亭', area: '池带', src: '套件：huxinting', name: '湖心亭' },
  { id: 'jiuqu-bridge', kind: '桥', area: '池带', src: '程序化体块', name: '九曲桥' },
  { id: 'rockery-dajiashan', kind: '假山', area: '豫园', src: '套件：rockery', name: '大假山（示意）' },
  { id: 'bld-428202599', kind: '商城楼', area: '商城', src: '套件：bazaar-tower-kit', name: '华宝楼' },
  { id: 'temple-dadian', kind: '殿', area: '城隍庙', src: '套件：dadian', name: '大殿' },
  { id: 'bld-428202603', kind: '商城楼', area: '商城', src: '套件：bazaar-tower-kit', name: '上海老饭店' },
];
function expectedCard(t) {
  const o = objs.get(t.id);
  if (!o) throw new Error(`baseline 缺对象 ${t.id}`);
  const a = footprintArea(o);
  return {
    name: o.name,
    dts: FIELDS,
    dds: [t.kind, t.area, o.height == null ? '—' : `${o.height} m`, o.storeys == null ? '—' : String(o.storeys), a == null ? '—' : `${a.toFixed(1)} m²`, t.src],
    note: NOTE,
  };
}
// 点击世界锚点：footprint 质心 / 折线中点 / position / 石块质心；topY 取 height（缺省 8）
function clickPoint(o) {
  const g = o.geometry || {};
  let cx, cz;
  if (g.footprint) { const xs = g.footprint.map(p => p[0]), zs = g.footprint.map(p => p[1]); cx = xs.reduce((x, y) => x + y) / xs.length; cz = zs.reduce((x, y) => x + y) / zs.length; }
  else if (g.rocks) { const xs = g.rocks.map(r => r.x), zs = g.rocks.map(r => r.z); cx = xs.reduce((x, y) => x + y) / xs.length; cz = zs.reduce((x, y) => x + y) / zs.length; }
  else if (g.polyline) { const p = g.polyline[Math.floor(g.polyline.length / 2)]; cx = p[0]; cz = p[1]; }
  else if (g.position) { cx = g.position[0]; cz = g.position.length > 2 ? g.position[2] : g.position[1]; }
  else return null;
  const top = (o.height ?? o.deckY ?? 8);
  return { eye: [cx + 4, top + 130, cz + 4], target: [cx, 0.5, cz] };
}
const UNNAMED = 'road-694630311';   // 外围无名道路（至最近有名对象 ≥ 80m，顶视点击必命中它自身）

// ---------- T3 KIT_IDS 对冻结源 ----------
let fails = 0;
const fail = (m) => { console.error('FAIL', m); fails++; };
const ok = (m) => console.log('ok  ', m);
const report = { targets: {} };
const wantKits = {};
for (const i of JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'hall-kit', 'ids.json'), 'utf8')).ids) wantKits[i] = 'hall-kit';
for (const i of JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'bazaar-tower-kit', 'ids.json'), 'utf8')).ids) wantKits[i] = 'bazaar-tower-kit';
wantKits['bld-428179901'] = 'sansuitang';   // scripts/assemble.py: SANSUITANG_DIR=out-garden-kits/sansuitang-bld-428179901
wantKits['huxin-ting'] = 'huxinting';       // modules/huxinting/build.py 目标 layout 对象
wantKits['rockery-dajiashan'] = 'rockery';  // modules/rockery/build-rockery.py cluster
wantKits['rockery-yulinglong'] = 'rockery';
{
  let impl = null, importErr = null;
  try { impl = await import('../web/infocard.js'); } catch (e) { importErr = e; }
  const got = impl?.KIT_IDS || {};
  if (importErr) fail(`T3 web/infocard.js 无法 import：${importErr.message}`);
  const wk = Object.keys(wantKits).sort(), gk = Object.keys(got).sort();
  if (JSON.stringify(wk) !== JSON.stringify(gk)) fail(`T3 KIT_IDS 键不一致：缺 ${wk.filter(k => !(k in got))} 多 ${gk.filter(k => !(k in wantKits))}`);
  else if (wk.some(k => wantKits[k] !== got[k])) fail(`T3 KIT_IDS 值不一致：${wk.filter(k => wantKits[k] !== got[k]).map(k => `${k}:${got[k]}!=${wantKits[k]}`)}`);
  else ok(`T3 KIT_IDS 与冻结源一致（${wk.length} 个套件 id）`);
}

// ---------- 浏览器 ----------
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(BASE + '?zone=core&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
await page.waitForFunction(() => document.querySelectorAll('#labels .lbl').length > 0, null, { timeout: 60000 });

const aim = (cp) => page.evaluate(([e, t]) => window.__viewAt(e, t), [cp.eye, cp.target]);
const readCard = () => page.evaluate(() => {
  const el = document.getElementById('info');
  if (el.style.display !== 'block') return { open: false };
  return {
    open: true,
    name: el.querySelector(':scope > h2')?.textContent ?? null,
    dts: [...el.querySelectorAll(':scope > dl > dt')].map(d => d.textContent),
    dds: [...el.querySelectorAll(':scope > dl > dd')].map(d => d.textContent),
    note: el.querySelector(':scope > p.infocard-note')?.textContent ?? null,
    childTags: [...el.children].map(c => c.tagName + (c.className ? '.' + c.className : '')),
    text: el.textContent,
    activeLabels: [...document.querySelectorAll('#labels .lbl.lbl-card-active')].map(n => n.dataset.labelText),
  };
});

// ---------- T1 + T2 逐对象点击并核对 ----------
let firstOpened = null;
for (const t of TARGETS) {
  const o = objs.get(t.id);
  const cp = clickPoint(o);
  if (!cp) { fail(`T1 ${t.name} 无可算点击锚点`); continue; }
  await aim(cp);
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  const got = await readCard();
  const want = expectedCard(t);
  report.targets[t.id] = { want, got };
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `infocard-${t.id}.png`) });
  if (!got.open) { fail(`T1 ${t.name} 点击后卡片未弹出`); continue; }
  if (!firstOpened) firstOpened = t;
  if (got.name !== want.name) fail(`T1 ${t.id} 名称 ${JSON.stringify(got.name)} != ${JSON.stringify(want.name)}`);
  if (JSON.stringify(got.dts) !== JSON.stringify(want.dts) || JSON.stringify(got.dds) !== JSON.stringify(want.dds))
    fail(`T1 ${t.name} 字段不符：dt=${JSON.stringify(got.dts)} dd=${JSON.stringify(got.dds)} 期望 dd=${JSON.stringify(want.dds)}`);
  if (got.note !== want.note) fail(`T2 ${t.name} 固定说明不符：${JSON.stringify(got.note)}`);
  const tags = (got.childTags || []).join(',');
  if (tags !== 'H2,DL,P.infocard-note') fail(`T2 ${t.name} 卡片出现白名单外元素：${tags}`);
  const joined = (want.name + want.dts.flatMap((d, i) => [d, want.dds[i]]).join('') + want.note);
  if (got.text !== joined) fail(`T2 ${t.name} 卡片含白名单外文本：${JSON.stringify(got.text.slice(0, 200))}`);
  if (t.id === 'bld-428179901') {   // 工单：开卡时对应标签高亮
    const hl = got.activeLabels || [];
    if (!hl.includes(want.name)) fail(`T2 ${t.name} 开卡后未高亮对应标签：${JSON.stringify(hl)}`);
  }
  if (fails === 0 || report.targets[t.id].ok === undefined) report.targets[t.id].ok = !got._fail;
  if (got.name === want.name && JSON.stringify(got.dts) === JSON.stringify(want.dts) && JSON.stringify(got.dds) === JSON.stringify(want.dds) && got.note === want.note && tags === 'H2,DL,P.infocard-note' && got.text === joined)
    ok(`T1/T2 ${t.name}：名称 + 6 字段 + 固定说明逐项一致`);
}

// ---------- T5 Esc 关卡 ----------
if (firstOpened) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const got = await readCard();
  if (got.open) fail('T5 Esc 后卡片未关闭');
  else ok('T5 Esc 关闭卡片');
  {
    const hl = await page.evaluate(() => document.querySelectorAll('#labels .lbl.lbl-card-active').length);
    if (hl) fail(`T5 Esc 后标签高亮未清除（${hl} 个）`);
    else ok('T5 Esc 后标签高亮清除');
  }
} else fail('T5 无弹卡可测 Esc（T1 全败）');

// ---------- T4 无名对象 / 空白不弹卡 ----------
{
  const cp = clickPoint(objs.get(UNNAMED));
  await aim(cp);
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  let got = await readCard();
  if (got.open) fail(`T4 无名对象 ${UNNAMED} 弹了卡：${JSON.stringify(got.name)}`);
  else ok('T4 无名对象不弹卡');
  await page.mouse.click(120, 90);
  await page.waitForTimeout(80);
  got = await readCard();
  if (got.open) fail('T4 点空白后卡片仍在');
  else ok('T4 点空白不弹卡');
}

// ---------- T6 步行模式不弹，退回轨道恢复 ----------
{
  const cp = clickPoint(objs.get('bld-428202599'));   // 华宝楼
  await page.evaluate(() => window.__walk.enter());
  await page.waitForFunction(() => window.__walk.status().mode === 'walk' && window.__walk.status().physicsReady, null, { timeout: 300000 });
  await aim(cp);
  await page.waitForTimeout(150);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(120);
  let got = await readCard();
  if (got.open) fail('T6 步行模式点击对象弹了卡');
  else ok('T6 步行模式不弹卡');
  await page.evaluate(() => window.__walk.exit());
  await page.waitForFunction(() => window.__walk.status().mode === 'orbit', null, { timeout: 60000 });
  await aim(cp);
  await page.waitForTimeout(150);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(120);
  got = await readCard();
  if (!got.open || got.name !== '华宝楼') fail(`T6 退回轨道后未恢复弹卡：${JSON.stringify(got)}`);
  else ok('T6 退回轨道后恢复弹卡（华宝楼）');
}

// ---------- T7 375px 手机宽度 ----------
{
  const mp = await browser.newPage({ viewport: { width: 375, height: 667 } });
  await mp.goto(BASE + '?zone=garden&cam=oblique', { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  // 375px 下顶部工具条换行占上半屏（既有 UI 事实，本工单不动它）：
  // 把机位放低（26m）让三穗堂投影伸进下半屏，点 (187,520)（工具条以下、楼体投影内）。
  const o = objs.get('bld-428179901');   // 三穗堂
  const fp = o.geometry.footprint;
  const mx = fp.reduce((s2, p2) => s2 + p2[0], 0) / fp.length, mz = fp.reduce((s2, p2) => s2 + p2[1], 0) / fp.length;
  await mp.evaluate(([e, t]) => window.__viewAt(e, t), [[mx + 3, 26, mz + 3], [mx, 1, mz]]);
  await mp.waitForTimeout(120);
  await mp.mouse.click(Math.round(375 / 2), 520);
  await mp.waitForTimeout(100);
  const res = await mp.evaluate(() => {
    const el = document.getElementById('info');
    const r = el.getBoundingClientRect();
    return {
      open: el.style.display === 'block',
      name: el.querySelector(':scope > h2')?.textContent ?? null,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
  if (SHOT_DIR) await mp.screenshot({ path: path.join(SHOT_DIR, 'infocard-mobile-375.png') });
  report.mobile = res;
  if (!res.open || res.name !== '三穗堂') fail(`T7 手机宽度未弹三穗堂卡：${JSON.stringify(res)}`);
  else if (res.scrollW > 375) fail(`T7 手机宽度出现横向滚动：scrollWidth=${res.scrollW}`);
  else if (res.rect.x < 0 || res.rect.x + res.rect.w > 375 + 0.5) fail(`T7 卡片溢出视口：${JSON.stringify(res.rect)}`);
  else ok(`T7 375px：卡片 ${JSON.stringify(res.rect)}，scrollWidth ${res.scrollW}，无溢出`);
  await mp.close();
}

await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`infocard-test: ${fails} fail`); process.exit(1); }
console.log('infocard-test: all pass');
