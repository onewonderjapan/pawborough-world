// wave12-towerwin：商城楼楼上窗背板 btk-winback 夜间点亮的专项检查（lighting-check S5 的盲区补丁，浏览器专项）。
// 背景：S5 只断言「每组至少命中 1 个材质」，给 lattice 组新加的材质名漏接时它照样全绿——
// btk-winback 不在 presets 里 / 被压缩管线合并掉名字，S5 都发现不了。本检查用 A/B 差分 + raw GLB 独立期望值堵这个洞。
// 断言（?zone=bazaar&light=night）：
//   T1 raw GLB 独立期望：解析 OUT_DIR/zone-*.glb（assemble 未压缩分区件，cm 由此压缩而来），统计材质名
//      （去 Blender 重名后缀 .NNN）= btk-winback 的条目数；断言总数 > 0 且只出现在 bazaar 分件
//      （商城楼套件只在 bazaar 区，期望值与页面加载集无关）。不读 __lighting 的任何数字。
//   T2 A/B 差分：同一页面加载两遍——B 侧用仓库 lighting/presets.json 原文；A 侧经请求拦截把 lattice 组的
//      btk-winback 临时去掉（不改仓库文件）。断言 emissiveByGroup.lattice：B − A = T1 期望值（新材质必须
//      一个不少地真的接上）且 B > A。仅 merge main、presets 未加 btk-winback 时 B = A → 红
//      （红证据：工单包 artifacts/w3/red-test.log + towerwin-night-check-red.patch）。
//      注意「接上」含压缩路径：查看器默认加载 meshopt cm 件，若压缩把 btk-winback 的名字合并掉（gltfpack
//      默认按内容合并材质），B − A 会小于期望值——这是本检查要拦的另一种漏接。
//   T3 两页都必须真的落在 night 预设（非旧灯光回退）、A/B 其余各组的命中数一致（拦截只许影响 lattice）。
// 用法：BASE=http://127.0.0.1:5497/ [OUT_DIR=out-zone] node tests/towerwin-night-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5497/';
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const PRESETS_FILE = path.join(ROOT, 'lighting', 'presets.json');
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

let fails = 0, passes = 0;
const ok = (cond, msg, data) => { if (cond) { passes++; console.log('PASS', msg); } else { fails++; console.error('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };
const baseName = (n) => String(n || '').replace(/\.\d{3}$/,'');

// ---------- T1：raw GLB 独立期望 ----------
function glbJson(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const clen = b.readUInt32LE(12);
  return JSON.parse(b.slice(20, 20 + clen).toString('utf8'));
}
const zoneFiles = fs.readdirSync(OUT).filter(f => /^zone-.*\.glb$/.test(f) && !f.endsWith('.cm.glb'));
const perFile = {};
for (const f of zoneFiles) {
  const n = (glbJson(path.join(OUT, f)).materials || []).filter(m => baseName(m.name) === 'btk-winback').length;
  if (n) perFile[f] = n;
}
const nonBazaar = Object.keys(perFile).filter(f => !/^zone-bazaar(-\d+)?\.glb$/.test(f));
const EXPECTED = Object.values(perFile).reduce((a, b) => a + b, 0);
ok(EXPECTED > 0, 'T1 raw GLB: btk-winback materials exist in assemble zone GLBs', perFile);
ok(nonBazaar.length === 0, 'T1 raw GLB: btk-winback only in bazaar parts', nonBazaar);
if (!EXPECTED) { console.error('T1 dead end, aborting'); process.exit(1); }

// ---------- A/B 两页 ----------
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const PRESET_URL = '**/lighting/presets.json';
async function openNight({ stripWinback }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });   // 独立 context：HTTP 缓存不得短路拦截
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (stripWinback) {
    await page.route(PRESET_URL, route => {
      const j = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
      const g = j.emissiveGroups.find(g => g.id === 'lattice');
      g.materials = g.materials.filter(m => m !== 'btk-winback');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
    });
  }
  await page.goto(BASE + '?zone=bazaar&light=night', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });   // deferred outer 到齐后再读数，两页口径一致
  const st = await page.evaluate(() => window.__lighting.state());
  await ctx.close();
  return { st, errors };
}

const B = await openNight({ stripWinback: false });   // 仓库 presets 原文
ok(B.st && B.st.preset === 'night' && !B.st.error && !B.st.timedOut, 'T3 B: night preset applied (not legacy fallback)', B.st && { preset: B.st.preset, error: B.st.error, timedOut: B.st.timedOut });
ok(B.errors.length === 0, 'T3 B: no page errors', B.errors);
const A = await openNight({ stripWinback: true });    // 同一份 presets 去掉 btk-winback
ok(A.st && A.st.preset === 'night' && !A.st.error, 'T3 A: night preset applied with stripped presets', A.st && { preset: A.st.preset, error: A.st.error });

if (A.st && B.st) {
  const groups = Object.keys(B.st.emissiveByGroup || {});
  const others = groups.filter(g => g !== 'lattice').every(g => (B.st.emissiveByGroup[g] || 0) === (A.st.emissiveByGroup[g] || 0));
  ok(others, 'T3 A/B: stripping affects only the lattice group', { B: B.st.emissiveByGroup, A: A.st.emissiveByGroup });
  const delta = (B.st.emissiveByGroup?.lattice || 0) - (A.st.emissiveByGroup?.lattice || 0);
  ok(delta > 0, 'T2 lattice: count with btk-winback > count without', { with: B.st.emissiveByGroup?.lattice, without: A.st.emissiveByGroup?.lattice });
  ok(delta === EXPECTED, `T2 lattice: delta = raw GLB expectation (${EXPECTED}) — every new backing material actually lights at night`, { delta, expected: EXPECTED, perFile });
}

await browser.close();
console.log(`towerwin-night-check: ${passes} pass, ${fails} fail`);
if (fails) process.exit(1);
