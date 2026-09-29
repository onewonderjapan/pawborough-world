// wave13-tourfix U2：标签 chip 遮挡检查（巡检报告第 16 条）——
//   「山门」「仪门」chip 压在门楣匾额文字上（pv02/pv03）；tour-huabaolou 左下角「信大祥」chip 被视口裁半。
// 检查机位：pv02-shanmen-arrive / pv03-temple-axis（out-zone/pv-cameras.json，取中帧 eye+target）
//   + tour.json 的 huabaolou（五对象取景机位）。viewport 1400×900。
// 两条门槛：
//   1) 匾额文字区：任何可见 chip 与匾额区（temple GLB 中命名为 plaque-face* 的网格，世界 AABB
//      经节点树合成）投影矩形不相交（外扩 2px）——与查看器侧的保留区隐去（web/main.js
//      plaqueBoxes → dedupeLabels reserved）同口径；查看器修好山门/仪门锚点后，「前院」「仪门戏楼」
//      等 chip 会顶替占位盖匾（实测），所以必须全 chip 口径而非只判点名 chip。
//   2) 视口：与视口相交的 chip 必须完整在视口内（贴边即违规，与「裁半」同判）；完全出视口的
//      chip 用户不可见，不判。
// 方法：headless 浏览器真实渲染，?zone=temple（设施标签可见），window.__viewAt 摆机位（查看器
//   PerspectiveCamera(46, w/h, 0.5, 4000) + OrbitControls target，up=(0,1,0)）；chip 矩形用
//   getBoundingClientRect（与用户所见一致）；匾额投影在本脚本用同参相机矩阵自算（同 web/main.js fov46）。
// 匾额世界盒在脚本内从 out-zone/temple.glb 解析（节点树合成世界变换），独立取得、不依赖产物标注。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone [SHOT_DIR=<目录>] [REPORT=<json>] node tests/tour-label-chip-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5497/';
const shotDir = process.env.SHOT_DIR || null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const W = 1400, H = 900, FOV = 46; // 与 web/main.js 相机及本测试 viewport 一致

// ---------- GLB 解析：plaque-face* 世界 AABB（TRD 节点树合成） ----------
function glbJson(buffer) {
  const ln = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + ln).toString('utf8'));
}
function matMul(a, b) { // 4x4 行主序
  const o = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r][c] += a[r][k] * b[k][c];
  return o;
}
function nodeMatrix(nd) {
  if (nd.matrix) return [0, 1, 2, 3].map(r => [nd.matrix[r * 4], nd.matrix[r * 4 + 1], nd.matrix[r * 4 + 2], nd.matrix[r * 4 + 3]]);
  const [x, y, z, w] = nd.rotation || [0, 0, 0, 1];
  const s = nd.scale || [1, 1, 1], t = nd.translation || [0, 0, 0];
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  return [
    [R[0][0] * s[0], R[0][1] * s[1], R[0][2] * s[2], t[0]],
    [R[1][0] * s[0], R[1][1] * s[1], R[1][2] * s[2], t[1]],
    [R[2][0] * s[0], R[2][1] * s[1], R[2][2] * s[2], t[2]],
    [0, 0, 0, 1],
  ];
}
// 匾额盒与查看器同源：解析查看器实际加载的 zone-temple-*.glb（分区拆件），取
// /^(shanmen|yimen|dadian)-plaque/ 整组节点（框+文字面）的世界 AABB——与 web/main.js
// prepare() 的 plaqueBoxes 收集同规则。
const PLAQUE_PAD_M = 0.15; // 匾额外扩（文字/边框余量）
const plaques = [];
for (const part of ['zone-temple-1.glb', 'zone-temple-2.glb', 'zone-temple-3.glb', 'zone-temple-4.glb']) {
  const f = path.join(OUT, part);
  if (!fs.existsSync(f)) continue;
  const glb = glbJson(fs.readFileSync(f));
  const nodes = glb.nodes || [], meshes = glb.meshes || [], accessors = glb.accessors || [];
  const world = new Map();
  const walk = (ni, parent) => {
    const m = matMul(parent, nodeMatrix(nodes[ni]));
    world.set(ni, m);
    for (const c of nodes[ni].children || []) walk(c, m);
  };
  for (const r of glb.scenes[glb.scene || 0].nodes) walk(r, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  for (const [ni, m] of world) {
    const nd = nodes[ni];
    if (nd.mesh == null) continue;
    const name = nodes[ni].name || meshes[nd.mesh].name || '';
    if (!/(shanmen|yimen|dadian)-plaque/.test(name)) continue;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const prim of meshes[nd.mesh].primitives) {
      const acc = accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], acc.min[i]); hi[i] = Math.max(hi[i], acc.max[i]); }
    }
    const corners = [];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      corners.push([
        m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
        m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
        m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
      ]);
    }
    const wlo = [0, 1, 2].map(i => Math.min(...corners.map(c => c[i])) - PLAQUE_PAD_M);
    const whi = [0, 1, 2].map(i => Math.max(...corners.map(c => c[i])) + PLAQUE_PAD_M);
    plaques.push({ name: name.replace(/\.\d+$/, ''), min: wlo, max: whi });
  }
}
if (!plaques.length) { console.error('tour-label-chip-check: temple.glb 中未找到 plaque-face* 网格'); process.exit(2); }
console.log(`匾额文字区 ${plaques.length} 块：` + plaques.map(p => `${p.name} x[${p.min[0].toFixed(1)},${p.max[0].toFixed(1)}] y[${p.min[1].toFixed(1)},${p.max[1].toFixed(1)}] z[${p.min[2].toFixed(1)},${p.max[2].toFixed(1)}]`).join(' | '));

// ---------- 匾额 → 屏幕包围盒（与查看器同参：fov46、up=(0,1,0)、lookAt(eye→target)） ----------
function lookAtMatrix(eye, tgt) { // 世界→相机
  const f = norm3([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
  // cross(f, up=(0,1,0)) = (f.y*0 - f.z*1, f.z*0 - f.x*0, f.x*1 - f.y*0) = (-f.z, 0, f.x)
  let r = norm3([-f[2], 0, f[0]]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0]; // 视线近竖直（本组机位不会发生）
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ]; // cross(r, f) = up'
  return [
    [r[0], r[1], r[2], -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2])],
    [u[0], u[1], u[2], -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2])],
    [-f[0], -f[1], -f[2], f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]],
    [0, 0, 0, 1],
  ];
  function norm3(v) { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
}
function projectBox(eye, tgt, box) { // → 屏幕包围盒；有顶点在相机背后时返回 null（视为不在画面，不判交）
  const vm = lookAtMatrix(eye, tgt);
  const tanY = Math.tan((FOV / 2) * Math.PI / 180), tanX = tanY * (W / H);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    const cx = vm[0][0] * x + vm[0][1] * y + vm[0][2] * z + vm[0][3];
    const cy = vm[1][0] * x + vm[1][1] * y + vm[1][2] * z + vm[1][3];
    const cz = vm[2][0] * x + vm[2][1] * y + vm[2][2] * z + vm[2][3];
    if (cz > -0.1) return null; // 近平面/背后
    const sx = (cx / -cz / tanX * 0.5 + 0.5) * W;
    const sy = (-cy / -cz / tanY * 0.5 + 0.5) * H;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  return { x0, y0, x1, y1 };
}

// ---------- 检查机位 ----------
const pv = JSON.parse(fs.readFileSync(path.join(OUT, 'pv-cameras.json'), 'utf8')).shots;
const tour = JSON.parse(fs.readFileSync(path.join(OUT, 'tour.json'), 'utf8'));
const CAMS = [];
for (const id of ['pv02-shanmen-arrive', 'pv03-temple-axis']) {
  const s = pv.find(x => x.id === id);
  if (!s) { console.error(`pv 机位缺失: ${id}`); process.exit(2); }
  const mid = Math.floor(s.frames / 2);
  CAMS.push({ key: id, p: s.eye[mid], t: s.target[mid] });
}
CAMS.push({ key: 'tour-huabaolou', p: tour.huabaolou.p, t: tour.huabaolou.t });

// ---------- 浏览器 ----------
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(base + '?zone=temple&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true && typeof window.__viewAt === 'function', null, { timeout: 600000 });

const results = {};
let fails = 0;
for (const cam of CAMS) {
  const chips = await page.evaluate(async ({ p, t }) => {
    const hud = document.getElementById('hud');
    if (hud && !hud.dataset.base) { hud.dataset.base = hud.innerHTML; hud.innerHTML = ''; } // 信息卡不进画面（同巡检口径）
    window.__viewAt(p, t);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const chips = [...document.querySelectorAll('.lbl')]
      .filter(el => el.style.display !== 'none' && el.style.visibility !== 'hidden')
      .map(el => {
        const b = el.getBoundingClientRect();
        return { text: el.textContent, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
      })
      .filter(c => c.x1 > c.x0 && c.y1 > c.y0);
    return { chips };
  }, { p: cam.p, t: cam.t });
  // chip 是 DOM 层（不在 WebGL canvas 里），证据截图用整页（信息卡已内联隐藏；工具栏为查看器常态 UI）
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${cam.key}.png`) });
  const chipList = chips.chips;
  const plaqueRects = plaques.map(pl => ({ name: pl.name, rect: projectBox(cam.p, cam.t, pl) })).filter(p2 => p2.rect);
  const PAD = 2;
  const why = [];
  for (const c of chipList) {
    // 门槛 1：任何可见 chip 不得压匾额文字区（第 16 条：山门/仪门点名在先，全 chip 口径防顶替占位）
    for (const pl of plaqueRects) {
      const inter = !(c.x1 + PAD < pl.rect.x0 || c.x0 - PAD > pl.rect.x1 || c.y1 + PAD < pl.rect.y0 || c.y0 - PAD > pl.rect.y1);
      if (inter) why.push(`chip「${c.text}」压匾额 ${pl.name}`);
    }
    // 门槛 2（全体可见 chip）：与视口相交就必须完整在视口内；完全出视口的用户不可见，不判
    const vis = !(c.x1 < 0 || c.x0 > W || c.y1 < 0 || c.y0 > H);
    if (vis && (c.x0 < 0 || c.y0 < 0 || c.x1 > W || c.y1 > H)) why.push(`chip「${c.text}」裁出视口 [${c.x0.toFixed(0)},${c.y0.toFixed(0)},${c.x1.toFixed(0)},${c.y1.toFixed(0)}]`);
  }
  results[cam.key] = { chips: chipList.map(c => ({ text: c.text, rect: [Math.round(c.x0), Math.round(c.y0), Math.round(c.x1), Math.round(c.y1)] })), plaqueRects: plaqueRects.map(p2 => ({ name: p2.name, rect: [Math.round(p2.rect.x0), Math.round(p2.rect.y0), Math.round(p2.rect.x1), Math.round(p2.rect.y1)] })), pass: !why.length, fail: [...new Set(why)] };
  console.log(`${cam.key.padEnd(16)} chips=${chipList.length} plaques画面内=${plaqueRects.length} ${why.length ? 'FAIL: ' + [...new Set(why)].join('; ') : 'OK'}`);
  if (why.length) fails++;
}
await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ plaques, cams: results }, null, 1) + '\n');
if (fails) { console.error(`tour-label-chip-check: ${fails}/${CAMS.length} 机位不达标（chip 不压匾额文字区；chip 完整在视口内）`); process.exit(1); }
console.log(`tour-label-chip-check: all ${CAMS.length} 机位 pass`);
