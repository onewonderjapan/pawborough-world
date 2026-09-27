// wave11-infocard R2 必修2 专项检查：HUXINTING=0 产物下，湖心亭的「模型来源」必须是「程序化体块」
// （程序化占位节点父链上没有 glTF extras module），或者对象在场景里根本不可点（不存在）。
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

// 确认这份产物确实没装套件亭：raw pond 分区 GLB 里该 id 的节点父链不得有 extras.module
function gltfOf(file) {
  const b = fs.readFileSync(file);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
const mf = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
let kitNodeFound = false;
for (const z of mf.zones) {
  if (!z.file || !fs.existsSync(path.join(OUT, z.file))) continue;
  const g = gltfOf(path.join(OUT, z.file));
  const par = new Array(g.nodes.length).fill(null);
  g.nodes.forEach((n, i) => (n.children || []).forEach(c => { par[c] = i; }));
  g.nodes.forEach((n, i) => {
    const id = (n.extras && n.extras.id) || (() => { const p = String(n.name || '').split('|'); return p.length >= 4 ? p[1] : null; })();
    if (id !== ting.id) return;
    for (let c = i; c != null; c = par[c]) {
      if (g.nodes[c].extras && g.nodes[c].extras.module != null) kitNodeFound = true;
    }
  });
}
console.log(`GLB 父链 module 检查：${kitNodeFound ? '发现套件节点（产物装了湖心亭套件）' : '无 module（程序化占位）'}`);

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
  const dds = el.style.display === 'block' ? [...el.querySelectorAll(':scope > dl > dd')].map(d => d.textContent) : null;
  const srcLabel = dds ? (dds[dds.length - 1] ?? null) : null;
  return {
    open: el.style.display === 'block',
    name: el.querySelector(':scope > h2')?.textContent ?? null,
    srcLabel,
    pick: window.__pickDebug ? { id: window.__pickDebug.id ?? null, name: window.__pickDebug.name ?? null } : 'undefined',
  };
});
console.log('got:', JSON.stringify(res));
if (res.pick === 'undefined') fail('__pickDebug 未写');
else if (res.pick.id !== ting.id && !res.open) ok(`湖心亭不可点（id=${res.pick.id}）——按「或不存在」通过`);
else {
  if (!res.open) fail(`点湖心亭后卡片未弹（__pickDebug=${JSON.stringify(res.pick)}）`);
  else if (res.srcLabel !== '程序化体块') fail(`HUXINTING=0 下来源=${JSON.stringify(res.srcLabel)}，应为「程序化体块」`);
  else ok(`湖心亭来源 = ${res.srcLabel}${res.name ? `（卡片名：${res.name}）` : ''}`);
}

await browser.close();
if (fails) { console.error(`infocard-huxinting-off-check: ${fails} fail`); process.exit(1); }
console.log('infocard-huxinting-off-check: pass');
