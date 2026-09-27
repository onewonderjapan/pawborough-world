// wave11-infocard R3（REVIEW-astra-R2 必修3）专项检查：HUXINTING=0 产物下，湖心亭的「模型来源」必须是「程序化体块」。
// 口径收紧（不再是「点不中就算不存在」）：
//   1) raw GLB 父链扫描：kitNodeFound 必须为 false 才允许继续（产物装了套件 → 直接 FAIL）；
//   2) 只有 raw GLB 确认湖心亭 id 不存在（idFound=false）时才允许「无卡 / 点不中」；
//   3) idFound=true（程序化占位在产物里）时必须真实点中：__pickDebug.id === 湖心亭 id，
//      卡片名称 === 湖心亭，来源 === 程序化体块 —— 点不中、无卡都算 FAIL。
// 用法：OUT_DIR=out-zone-nohx BASE=http://127.0.0.1:5496/ node tests/infocard-huxinting-off-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone-nohx');
const BASE = process.env.BASE || 'http://127.0.0.1:5496/';

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const ting = layout.objects.find(o => o.name === '湖心亭' && o.zone === 'pond');
if (!ting) { console.error('SETUP layout 里找不到湖心亭'); process.exit(2); }

// raw GLB 独立扫描：idFound = 产物里是否存在该 id 的节点（extras.id 或管道名）；kitNodeFound = 该 id 节点父链是否有 extras.module
function gltfOf(file) {
  const b = fs.readFileSync(file);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
const mf = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
let idFound = false, kitNodeFound = false;
for (const z of mf.zones) {
  if (!z.file || !fs.existsSync(path.join(OUT, z.file))) continue;
  const g = gltfOf(path.join(OUT, z.file));
  const par = new Array(g.nodes.length).fill(null);
  g.nodes.forEach((n, i) => (n.children || []).forEach(c => { par[c] = i; }));
  g.nodes.forEach((n, i) => {
    const pid = String(n.name || '').split('|');
    const id = (n.extras && n.extras.id != null) ? n.extras.id : (pid.length >= 4 ? pid[1] : null);
    if (id !== ting.id) return;
    idFound = true;
    for (let c = i; c != null; c = par[c]) {
      if (g.nodes[c].extras && g.nodes[c].extras.module != null) kitNodeFound = true;
    }
  });
}
console.log(`raw GLB 父链扫描（${OUT}）：idFound=${idFound}，kitNodeFound=${kitNodeFound}`);

let fails = 0;
const fail = m => { console.error('FAIL', m); fails++; };
const ok = m => console.log('ok  ', m);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(BASE + '?zone=pond&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
await page.waitForFunction(() => document.querySelectorAll('#labels .lbl').length > 0, null, { timeout: 60000 });

// 锚点：footprint / position
const g = ting.geometry || {};
let cx, cz;
if (g.footprint) { const xs = g.footprint.map(p => p[0]), zs = g.footprint.map(p => p[1]); cx = xs.reduce((a, b) => a + b) / xs.length; cz = zs.reduce((a, b) => a + b) / zs.length; }
else { cx = g.position[0]; cz = g.position.length > 2 ? g.position[2] : g.position[1]; }
const top = ting.height ?? 8;
await page.evaluate(([e, t]) => window.__viewAt(e, t), [[cx + 3, top + 110, cz + 3], [cx, 1, cz]]);
await page.waitForTimeout(150);
await page.mouse.click(700, 450);
await page.waitForTimeout(120);

const res = await page.evaluate(() => {
  const el = document.getElementById('info');
  const open = el.style.display === 'block';
  const dds = open ? [...el.querySelectorAll(':scope > dl > dd')].map(d => d.textContent) : null;
  return {
    open,
    name: open ? (el.querySelector(':scope > h2')?.textContent ?? null) : null,
    srcLabel: dds ? (dds[dds.length - 1] ?? null) : null,
    pick: window.__pickDebug ? { id: window.__pickDebug.id ?? null, name: window.__pickDebug.name ?? null } : 'undefined',
  };
});
console.log('got:', JSON.stringify(res));
if (kitNodeFound) {
  fail(`HUXINTING=0 产物里湖心亭节点父链有 extras.module（kitNodeFound=true）——产物装了套件，本专项的前提不成立`);
} else if (res.pick === 'undefined') {
  fail('__pickDebug 未写');
} else if (!idFound) {
  // 只有 raw GLB 确认不存在时才允许「无卡 / 点不中」
  if (res.pick.id !== ting.id && !res.open) ok(`raw GLB 无湖心亭 id，产物中也不可点（id=${res.pick.id}）——按「不存在」通过`);
  else fail(`raw GLB 无湖心亭 id 但运行时点了湖心亭（id=${res.pick.id}，open=${res.open}）——产物不一致`);
} else {
  // raw GLB 确认程序化占位存在 → 必须点中且 id / 名称 / 来源逐项正确；点不中 = FAIL（不许按「不存在」放过）
  const bads = [];
  if (res.pick.id !== ting.id) bads.push(`__pickDebug.id=${JSON.stringify(res.pick.id)} != ${ting.id}（点不中不许按「不存在」放过）`);
  if (!res.open) bads.push('点湖心亭后卡片未弹');
  else {
    if (res.name !== ting.name) bads.push(`卡片名称 ${JSON.stringify(res.name)} != ${JSON.stringify(ting.name)}`);
    if (res.srcLabel !== '程序化体块') bads.push(`来源 ${JSON.stringify(res.srcLabel)} != 程序化体块`);
  }
  if (bads.length) fail(`HUXINTING=0 湖心亭专项：${bads.join('；')}`);
  else ok(`湖心亭点中（id=${res.pick.id}），名称=${res.name}，来源=${res.srcLabel}（GLB 父链无 module）`);
}

await browser.close();
if (fails) { console.error(`infocard-huxinting-off-check: ${fails} fail`); process.exit(1); }
console.log('infocard-huxinting-off-check: pass');
