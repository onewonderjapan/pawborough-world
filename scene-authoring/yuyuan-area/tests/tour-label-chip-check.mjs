// wave13-tourfix U2/R1：标签 chip 遮挡检查（巡检报告第 16 条 + astra R1 必修1/必修2）——
//   「山门」「仪门」chip 压在门楣匾额文字上（pv02/pv03）；tour-huabaolou 左下角「信大祥」chip 被视口裁半。
// 检查机位：pv02-shanmen-arrive / pv03-temple-axis（out-zone/pv-cameras.json，取中帧 eye+target）
//   + tour.json 的 huabaolou（五对象取景机位）+ plaque-back（山门背面机位，必修2 场景）。viewport 1400×900。
// 四条门槛：
//   1) 匾额文字区：任何可见 chip 与「可见匾面」的投影矩形不相交（外扩 2px）——与查看器侧保留区
//      （web/main.js plaqueBoxes → dedupeLabels reserved）同口径。R1 必修2：匾额网格按三角形连通性
//      拆成独立匾面（仪门左右两匾不再合成一个横跨门洞的大盒，web/labels.js clusterTriangleFaces），
//      且只对可见匾面判交——文字面外法线背向相机、或被碰撞盒遮挡（门楼背面/隔楼观看）的匾面不判
//      （web/labels.js segBlockedByOccluders，碰撞数据 out-zone/collision-*.json 与查看器同源）。
//   2) 视口：与视口相交的 chip 必须完整在视口内（贴边即违规，与「裁半」同判）；完全出视口的
//      chip 用户不可见，不判。
//   3) 正向断言（R1 必修1，防「标签消失换通过」）：pv02 必须看到「山门」、pv03 必须看到「仪门」、
//      tour-huabaolou 必须看到「信大祥」——存在、可见、完整入画、不压可见匾面。空标签集不再能过。
//   4) plaque-back 场景（必修2）：山门背面机位（匾面不可见）下，正常标签（前院/大殿庭院/后院穿廊，
//      旧整组盒口径下会被背面匾额投影误隐藏）必须保留，且查看器 __lastReserved 为空。
// 负例注入（环境变量 LABELCHIP_NEG，需实测 FAIL——当前代码 + 注入故障跑同一检查）：
//   anchor-4m  恢复山门/仪门锚高 4m（window.__labelFault.anchorY）→ 压匾被保留区隐藏，门槛3 打红；
//   no-clamp   关闭 chip 视口内收（window.__labelFault.noClamp）→ 信大祥裁出视口，门槛2/3 打红；
//   labels-off 隐藏全部标签（工具栏 t-labels 开关）→ 门槛3 打红；
//   plaque-always 关闭匾面可见性判断、按旧整组盒口径建保留区（window.__labelFault.plaqueAlways）→
//                 plaque-back 场景正常标签被背面匾额投影误隐藏，门槛4 打红（必修2 场景负证）。
//   负例模式期待检查失败：全部机位仍 pass 则本脚本 EXIT 1（负例失效）。正常模式（不设 LABELCHIP_NEG）
//   期待全过，EXIT 0。
// 方法：headless 浏览器真实渲染，?zone=temple（设施标签可见），window.__viewAt 摆机位（查看器
//   PerspectiveCamera(46, w/h, 0.5, 4000) + OrbitControls target，up=(0,1,0)）；chip 矩形用
//   getBoundingClientRect（与用户所见一致）；匾额投影在本脚本用同参相机矩阵自算（同 web/main.js fov46）。
// 匾额世界盒在脚本内从 out-zone/zone-temple-*.glb 解析（三角形聚类 + 节点树合成世界变换），独立取得、
//   不依赖查看器 __plaqueBoxes；可见性判定（外法线/遮挡）与查看器共用 web/labels.js 实现。
// 用法：BASE=http://127.0.0.1:<port>/ OUT_DIR=out-zone [SHOT_DIR=<目录>] [LIGHT=night] [REPORT=<json>]
//       [LABELCHIP_NEG=anchor-4m|no-clamp|labels-off|plaque-always] node tests/tour-label-chip-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterTriangleFaces, plaqueFaceAxis, buildLabelOccluders, segBlockedByOccluders } from '../web/labels.js';

const require = createRequire(import.meta.url); // 从本包解析（devDependencies playwright）
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const base = process.env.BASE || 'http://127.0.0.1:5497/';
const shotDir = process.env.SHOT_DIR || null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const NEG = process.env.LABELCHIP_NEG || null;
const W = 1400, H = 900, FOV = 46; // 与 web/main.js 相机及本测试 viewport 一致

// 正向断言名单（必修1）：机位 → 必须可见的点名标签
const REQUIRED = {
  'pv02-shanmen-arrive': ['山门'],
  'pv03-temple-axis': ['仪门'],
  'tour-huabaolou': ['信大祥'],
};
// plaque-back 场景（必修2）：山门背面机位。旧整组盒口径下，背面山门匾额的投影区会误隐藏
// 门前院一排正常标签（离线探针实测：前院（香道/宝鼎）/大殿庭院/后院/穿廊 全中）；新口径必须保留。
const PLAQUE_BACK = {
  key: 'plaque-back-shanmen',
  p: [-74.3, 1.7, 1.7], t: [-74.3, 2.5, 9.7],
  keepAny: ['前院（香道/宝鼎）', '大殿庭院', '后院/穿廊'], // 至少一个必须保留
};

// ---------- GLB 解析：plaque 网格 → 独立匾面世界盒 + 文字面世界外法线（与 web/main.js prepare 同规则） ----------
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
  if (nd.matrix) {
    // glTF matrix 为列主序（astra R1 可选项修正：原按行主序误读；当前 GLB 无 matrix 节点，此修正保未来口径）
    const m = nd.matrix;
    return [
      [m[0], m[4], m[8], m[12]],
      [m[1], m[5], m[9], m[13]],
      [m[2], m[6], m[10], m[14]],
      [m[3], m[7], m[11], m[15]],
    ];
  }
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
const COMPONENTS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
function accessorReader(buffer, glb, binStart, accIdx) {
  const acc = glb.accessors[accIdx];
  const bv = glb.bufferViews[acc.bufferView];
  const off = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (bv.byteStride) throw new Error('interleaved accessor not supported');
  if (acc.componentType === 5126) return i => buffer.readFloatLE(off + i * 4);
  if (acc.componentType === 5123) return i => buffer.readUInt16LE(off + i * 2);
  if (acc.componentType === 5125) return i => buffer.readUInt32LE(off + i * 4);
  if (acc.componentType === 5121) return i => buffer.readUInt8(off + i);
  throw new Error('unsupported componentType ' + acc.componentType);
}
// 匾额盒与查看器同源：解析查看器实际加载的 zone-temple-*.glb（分区拆件），取
// /^(shanmen|yimen|dadian)-plaque/ 节点；R1 必修2：网格内按三角形质心连通性拆独立匾面
// （web/labels.js clusterTriangleFaces），每面一个世界盒 + 文字面世界外法线（plaqueFaceAxis 挤出方向）。
const PLAQUE_PAD_M = 0.15; // 匾额外扩（文字/边框余量）
const plaques = [];
for (const part of ['zone-temple-1.glb', 'zone-temple-2.glb', 'zone-temple-3.glb', 'zone-temple-4.glb']) {
  const f = path.join(OUT, part);
  if (!fs.existsSync(f)) continue;
  const buffer = fs.readFileSync(f);
  const glb = glbJson(buffer);
  const ln = buffer.readUInt32LE(12);
  const binStart = 20 + ln + 8; // JSON chunk 之后是 BIN chunk（8 字节头）
  const nodes = glb.nodes || [], meshes = glb.meshes || [];
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
    const mesh = meshes[nd.mesh];
    for (const prim of mesh.primitives) {
      const posAcc = glb.accessors[prim.attributes.POSITION];
      const nVert = posAcc.count;
      const posAt = accessorReader(buffer, glb, binStart, prim.attributes.POSITION);
      const idxAt = prim.indices != null ? accessorReader(buffer, glb, binStart, prim.indices) : i => i;
      const nTri = Math.floor((prim.indices != null ? glb.accessors[prim.indices].count : nVert) / 3);
      const cent = new Float32Array(nTri * 3);
      const triV = (t, fn) => {
        for (let k = 0; k < 3; k++) {
          const vi = idxAt(t * 3 + k);
          fn(k, posAt(vi * 3), posAt(vi * 3 + 1), posAt(vi * 3 + 2));
        }
      };
      for (let t = 0; t < nTri; t++) {
        let cx = 0, cy = 0, cz = 0;
        triV(t, (k, x, y, z) => { cx += x; cy += y; cz += z; });
        cent[t * 3] = cx / 3; cent[t * 3 + 1] = cy / 3; cent[t * 3 + 2] = cz / 3;
      }
      const clusterOf = clusterTriangleFaces(cent, nTri);
      const nClusters = Math.max(...clusterOf) + 1;
      const lo = Array.from({ length: nClusters }, () => [Infinity, Infinity, Infinity]);
      const hi = Array.from({ length: nClusters }, () => [-Infinity, -Infinity, -Infinity]);
      for (let t = 0; t < nTri; t++) {
        triV(t, (k, x, y, z) => {
          const cl = clusterOf[t];
          lo[cl][0] = Math.min(lo[cl][0], x); lo[cl][1] = Math.min(lo[cl][1], y); lo[cl][2] = Math.min(lo[cl][2], z);
          hi[cl][0] = Math.max(hi[cl][0], x); hi[cl][1] = Math.max(hi[cl][1], y); hi[cl][2] = Math.max(hi[cl][2], z);
        });
      }
      for (let cl = 0; cl < nClusters; cl++) {
        const corners = [];
        for (const x of [lo[cl][0], hi[cl][0]]) for (const y of [lo[cl][1], hi[cl][1]]) for (const z of [lo[cl][2], hi[cl][2]]) {
          corners.push([
            m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
            m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
            m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
          ]);
        }
        const wlo = [0, 1, 2].map(i => Math.min(...corners.map(c => c[i])) - PLAQUE_PAD_M);
        const whi = [0, 1, 2].map(i => Math.max(...corners.map(c => c[i])) + PLAQUE_PAD_M);
        const axis = plaqueFaceAxis(lo[cl], hi[cl]); // 局部文字面外法线（挤出方向）
        const wn = [
          m[0][0] * axis[0] + m[0][1] * axis[1] + m[0][2] * axis[2],
          m[1][0] * axis[0] + m[1][1] * axis[1] + m[1][2] * axis[2],
          m[2][0] * axis[0] + m[2][1] * axis[1] + m[2][2] * axis[2],
        ];
        const nl = Math.hypot(...wn) || 1;
        const wc = [0, 1, 2].map(i => (wlo[i] + whi[i]) / 2);
        plaques.push({ name: name.replace(/\.\d+$/, '') + (nClusters > 1 ? `#${cl}` : ''), min: wlo, max: whi, n: wn.map(v => v / nl), c: wc });
      }
    }
  }
}
if (!plaques.length) { console.error('tour-label-chip-check: temple GLB 中未找到 plaque 网格'); process.exit(2); }
console.log(`匾额独立匾面 ${plaques.length} 块（R1 必修2 拆分口径）：` + plaques.map(p => `${p.name}`).join(' | '));

// ---------- 匾额可见性（与查看器同判：文字面朝向 + 碰撞盒遮挡，共用 web/labels.js） ----------
const occluders = (() => {
  const ids = ['garden', 'temple', 'bazaar', 'pond', 'outer'];
  if (fs.existsSync(path.join(OUT, 'collision-fangbang.json'))) ids.push('fangbang');
  const records = [];
  for (const z of ids) {
    const f = path.join(OUT, `collision-${z}.json`);
    if (!fs.existsSync(f)) continue;
    records.push(...JSON.parse(fs.readFileSync(f, 'utf8')).colliders || []);
  }
  return buildLabelOccluders(records);
})();
function plaqueVisible(pl, eye) {
  const toEye = [eye[0] - pl.c[0], eye[1] - pl.c[1], eye[2] - pl.c[2]];
  if (pl.n[0] * toEye[0] + pl.n[1] * toEye[1] + pl.n[2] * toEye[2] <= 0) return false; // 背向相机（看到匾背）
  const probe = [pl.c[0] + pl.n[0] * 0.25, pl.c[1] + pl.n[1] * 0.25, pl.c[2] + pl.n[2] * 0.25];
  if (occluders.length && segBlockedByOccluders(occluders, eye, probe)) return false; // 被建筑遮挡
  return true;
}

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
  CAMS.push({ key: id, p: s.eye[mid], t: s.target[mid], required: REQUIRED[id] });
}
CAMS.push({ key: 'tour-huabaolou', p: tour.huabaolou.p, t: tour.huabaolou.t, required: REQUIRED['tour-huabaolou'] });
CAMS.push({ key: PLAQUE_BACK.key, p: PLAQUE_BACK.p, t: PLAQUE_BACK.t, keepAny: PLAQUE_BACK.keepAny, expectNoReserved: true });

// ---------- 浏览器 ----------
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(base + '?zone=temple&cam=oblique' + (process.env.LIGHT ? '&light=' + process.env.LIGHT : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true && typeof window.__viewAt === 'function', null, { timeout: 600000 });

if (NEG === 'anchor-4m') await page.evaluate(() => { window.__labelFault = { anchorY: { '山门': 4, '仪门': 4 } }; });
if (NEG === 'no-clamp') await page.evaluate(() => { window.__labelFault = { noClamp: true }; });
if (NEG === 'plaque-always') await page.evaluate(() => { window.__labelFault = { plaqueAlways: true }; });
if (NEG && !['anchor-4m', 'no-clamp', 'labels-off', 'plaque-always'].includes(NEG)) { console.error(`未知 LABELCHIP_NEG: ${NEG}`); process.exit(2); }

const results = {};
let fails = 0;
for (const cam of CAMS) {
  const chips = await page.evaluate(async ({ p, t, neg }) => {
    const hud = document.getElementById('hud');
    if (hud && !hud.dataset.base) { hud.dataset.base = hud.innerHTML; hud.innerHTML = ''; } // 信息卡不进画面（同巡检口径）
    if (neg === 'labels-off') {
      const b = document.getElementById('t-labels');
      if (b && b.classList.contains('active')) b.click(); // 工具栏关标签（负例③：隐藏全部标签）
    }
    window.__viewAt(p, t);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const chips = [...document.querySelectorAll('.lbl')]
      .filter(el => el.style.display !== 'none' && el.style.visibility !== 'hidden')
      .map(el => {
        const b = el.getBoundingClientRect();
        return { text: el.textContent, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
      })
      .filter(c => c.x1 > c.x0 && c.y1 > c.y0);
    return { chips, reserved: (window.__lastReserved || []).length, fault: !!window.__labelFault };
  }, { p: cam.p, t: cam.t, neg: NEG });
  // chip 是 DOM 层（不在 WebGL canvas 里），证据截图用整页（信息卡已内联隐藏；工具栏为查看器常态 UI）
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${cam.key}${NEG ? '-neg-' + NEG : ''}${process.env.LIGHT ? '-' + process.env.LIGHT : ''}.png`) });
  const chipList = chips.chips;
  const eye = cam.p;
  const plaqueRects = plaques
    .filter(pl => plaqueVisible(pl, eye))
    .map(pl => ({ name: pl.name, rect: projectBox(eye, cam.t, pl) }))
    .filter(p2 => p2.rect);
  const PAD = 2;
  const why = [];
  for (const c of chipList) {
    // 门槛 1：任何可见 chip 不得压「可见匾面」文字区（第 16 条点名在先，全 chip 口径防顶替占位；
    // R1 必修2：不可见匾面——背面/被遮挡——不判，其投影区允许被正常标签占用）
    for (const pl of plaqueRects) {
      const inter = !(c.x1 + PAD < pl.rect.x0 || c.x0 - PAD > pl.rect.x1 || c.y1 + PAD < pl.rect.y0 || c.y0 - PAD > pl.rect.y1);
      if (inter) why.push(`chip「${c.text}」压匾额 ${pl.name}`);
    }
    // 门槛 2（全体可见 chip）：与视口相交就必须完整在视口内；完全出视口的用户不可见，不判
    const vis = !(c.x1 < 0 || c.x0 > W || c.y1 < 0 || c.y0 > H);
    if (vis && (c.x0 < 0 || c.y0 < 0 || c.x1 > W || c.y1 > H)) why.push(`chip「${c.text}」裁出视口 [${c.x0.toFixed(0)},${c.y0.toFixed(0)},${c.x1.toFixed(0)},${c.y1.toFixed(0)}]`);
  }
  // 门槛 3（必修1 正向断言）：点名标签必须存在、可见、完整入画、不压可见匾面
  for (const txt of cam.required || []) {
    const c = chipList.find(x => x.text === txt);
    if (!c) { why.push(`正向断言：点名标签「${txt}」不存在或不可见（共 ${chipList.length} 个可见 chip）`); continue; }
    if (c.x0 < 0 || c.y0 < 0 || c.x1 > W || c.y1 > H) why.push(`正向断言：「${txt}」未完整入画 [${c.x0.toFixed(0)},${c.y0.toFixed(0)},${c.x1.toFixed(0)},${c.y1.toFixed(0)}]`);
    for (const pl of plaqueRects) {
      const inter = !(c.x1 + PAD < pl.rect.x0 || c.x0 - PAD > pl.rect.x1 || c.y1 + PAD < pl.rect.y0 || c.y0 - PAD > pl.rect.y1);
      if (inter) why.push(`正向断言：「${txt}」压匾额 ${pl.name}`);
    }
  }
  // 门槛 4（必修2 场景）：匾面不可见的背面机位，正常标签必须保留，且查看器未建任何保留区
  if (cam.keepAny) {
    const kept = chipList.filter(c => cam.keepAny.includes(c.text)).map(c => c.text);
    if (!kept.length) why.push(`plaque-back 场景：正常标签 ${cam.keepAny.join('/')} 全部消失（共 ${chipList.length} 个可见 chip）`);
    if (cam.expectNoReserved && chips.reserved !== 0) why.push(`plaque-back 场景：查看器仍建了 ${chips.reserved} 个保留区（匾面应不可见）`);
  }
  results[cam.key] = { chips: chipList.map(c => ({ text: c.text, rect: [Math.round(c.x0), Math.round(c.y0), Math.round(c.x1), Math.round(c.y1)] })), plaqueRects: plaqueRects.map(p2 => ({ name: p2.name, rect: [Math.round(p2.rect.x0), Math.round(p2.rect.y0), Math.round(p2.rect.x1), Math.round(p2.rect.y1)] })), viewerReserved: chips.reserved, pass: !why.length, fail: [...new Set(why)] };
  console.log(`${cam.key.padEnd(20)} chips=${chipList.length} 可见匾面=${plaqueRects.length} 查看器保留区=${chips.reserved} ${why.length ? 'FAIL: ' + [...new Set(why)].join('; ') : 'OK'}`);
  if (why.length) fails++;
}
await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ neg: NEG, plaques: plaques.map(p => ({ name: p.name, min: p.min, max: p.max, n: p.n })), cams: results }, null, 1) + '\n');
if (NEG) {
  if (fails) { console.log(`tour-label-chip-check [负例 ${NEG}]：注入故障后 ${fails}/${CAMS.length} 机位不达标——负例实测 FAIL（符合预期）`); process.exit(0); }
  console.error(`tour-label-chip-check [负例 ${NEG}]：注入故障后全部机位仍 pass——负例未生效，检查守不住该回归`); process.exit(1);
}
if (fails) { console.error(`tour-label-chip-check: ${fails}/${CAMS.length} 机位不达标（chip 不压可见匾面；chip 完整在视口内；点名标签存在且可见；背面匾额不误隐藏）`); process.exit(1); }
console.log(`tour-label-chip-check: all ${CAMS.length} 机位 pass`);
