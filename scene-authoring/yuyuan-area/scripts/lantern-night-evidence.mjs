// wave14-lantern R2（主控接手）：夜间灯笼像素证据——几何/对象身份掩膜 + 同机位 R0 红 / R1 绿。
// 回应 REVIEW-astra R1 必修1：取样区不得由画面颜色选出、须排除前景遮挡、投影与可见性要有真实断言。
//
// 流程（同一页面 ?zone=bazaar&light=night&batch=0，batch=0 保留灯笼分件节点身份）：
//   1) 灯笼定位：遍历场景里的 lanterns-body 纸壳网格（btk-lantern-paper），顶点经 matrixWorld（assemble 放置后的世界变换）
//      按 1.2 m 连通聚簇 → 每只灯的中心与顶点集；数量必须等于设计账 40（14+26）。
//   2) 候选机位：每灯以「塔心→灯」水平外向为基准，方位 −75°…+75°（15° 步）× 距离 1.3/1.8/2.5 m × 眼高 0/−0.4 m；
//      目标 = 灯心。取样区 region = 该灯顶点投影包围盒外扩 6 px，必须整体在画内（边距 ≥ 8 px）。
//   3) 可见性（对象身份，两次 ID 渲染，全部材质换 MeshBasicMaterial，toneMapped=false，背景黑）：
//        L = 全场景渲染，灯笼分件（lanterns-* 节点）白、其余黑   → 「灯笼是最前表面」的像素；
//        S = 只渲染灯笼分件（其余网格 visible=false），白        → 灯笼无遮挡剪影；
//      前景遮挡率 occ = |S∖L| / |S|（region 内）。灯笼自身的骨架棱、盖、穗属于灯笼，不算遮挡。
//   4) 选定：occ ≤ 1% 且纸壳掩膜像素 ≥ 8000 的候选中，取掩膜像素最多者。
//   5) 掩膜冻结：P = 全场景渲染，纸壳（lanterns-body）白、其余（含本灯骨架/盖）黑；mask = P ∩ region。
//      掩膜只由几何与对象身份决定，与最终颜色无关；写入 artifacts（RLE，左上原点）。
//   6) 同机位美术渲染：R1（现行）→ R0 材质复现（纸壳改回 R0 口径：不透明 + lantern 冻结组发光 #ff7a3c × 3.0 × night.emissiveScale，
//      即 R0 灯身整体在 lantern 组内的状态；几何/机位/掩膜不变）→ 还原后复拍 R1'（与 R1 字节对照，证明还原干净）。
//      另拍白天同机位与一张沿街多灯重叠夜景（透明纸壳排序目视证据，不断言）。
// 用法: CHROME_PATH=<可选> DISPLAY=:0 XAUTHORITY=... node scripts/lantern-night-evidence.mjs --base http://127.0.0.1:5485/ --out <dir>
// 需要真 GPU WebGL（headless:false）；判据见 tests/lantern-night-pixel-check.mjs。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const A = process.argv;
const argv = (f, d) => (A.includes(f) ? A[A.indexOf(f) + 1] : d);
const BASE = argv('--base', 'http://127.0.0.1:5485/');
const OUT = argv('--out', 'lantern-evidence');
const W = 1400, H = 900, FOV = 46;             // 与查看器相机一致（main.js PerspectiveCamera(46, …, near 0.5)）
const OCC_MAX = 0.01, MASK_MIN = 8000, MARGIN = 8, PAD = 6;
fs.mkdirSync(OUT, { recursive: true });

function resolveChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { if (fs.existsSync(chromium.executablePath())) return undefined; } catch { /* registry 未配置 */ }
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const revs = fs.readdirSync(cache).map(d => /^chromium-(\d+)$/.exec(d)).filter(Boolean).sort((a, b) => b[1] - a[1]);
    for (const m of revs) { const p = path.join(cache, m[0], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; }
  } catch { /* 无缓存目录 */ }
  return undefined;
}
const presets = JSON.parse(fs.readFileSync(new URL('../lighting/presets.json', import.meta.url), 'utf8'));
const lanternGroup = presets.emissiveGroups.find(g => g.materials.includes('btk-lantern'));
const NIGHT_SCALE = presets.presets.night.emissiveScale;

const tanV = Math.tan(FOV / 2 * Math.PI / 180);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = (a) => { const l = Math.hypot(...a); return a.map(v => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
function projector(eye, tgt) {
  const f = norm(sub(tgt, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  return (p) => { const q = sub(p, eye), d = dot(q, f); return [W / 2 + dot(q, r) / (d * tanV) * (H / 2), H / 2 - dot(q, u) / (d * tanV) * (H / 2), d]; };
}

const browser = await chromium.launch({ executablePath: resolveChromium(), headless: false, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.warn('pageerror', String(e).slice(0, 200)));
await page.goto(`${BASE}?zone=bazaar&light=night&batch=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });

// ---------- 1) 灯笼定位 ----------
const towers = await page.evaluate(async () => {
  const THREE = await import('three');
  const scene = window.__scene;
  scene.updateMatrixWorld(true);
  const up = (o, re) => { for (let n = o; n; n = n.parent) if (re.test(n.name || '')) return true; return false; };
  const bodies = [];
  scene.traverse(o => { if (o.isMesh && up(o, /^lanterns-body/) && o.material && o.material.name === 'btk-lantern-paper') bodies.push(o); });
  const v = new THREE.Vector3(), CELL = 1.2;
  return bodies.map(mesh => {
    let owner = 'unknown';
    for (let n = mesh; n; n = n.parent) { const m = /bld-\d+/.exec(n.name || ''); if (m) { owner = m[0]; break; } }
    const pa = mesh.geometry.attributes.position, pts = [];
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld); pts.push([v.x, v.y, v.z]); }
    const parent = pts.map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const grid = new Map(), key = (p) => `${Math.floor(p[0] / CELL)},${Math.floor(p[2] / CELL)}`;
    pts.forEach((p, i) => { const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    pts.forEach((p, i) => {
      const cx = Math.floor(p[0] / CELL), cz = Math.floor(p[2] / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get(`${cx + dx},${cz + dz}`) || [])
        if (j > i && Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1], p[2] - pts[j][2]) < CELL) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    });
    const groups = new Map();
    pts.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(pts[i]); });
    const lamps = [...groups.values()].map(g => ({ center: [0, 1, 2].map(k => g.reduce((s, p) => s + p[k], 0) / g.length), verts: g }));
    const centroid = [0, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    return { owner, node: mesh.name, centroid, lamps };
  });
});
const nLamps = towers.reduce((s, t) => s + t.lamps.length, 0);
console.log(`towers: ${towers.map(t => `${t.owner}(${t.lamps.length})`).join(' ')}`);
if (nLamps !== 40) throw new Error(`灯笼簇数 ${nLamps} ≠ 设计账 40（14+26）`);

// ---------- 2) 候选机位 ----------
const cands = [];
for (const t of towers) for (const [li, l] of t.lamps.entries()) {
  const out = norm([l.center[0] - t.centroid[0], 0, l.center[2] - t.centroid[1]]);
  for (let a = -75; a <= 75; a += 15) for (const dist of [1.3, 1.8, 2.5]) for (const dy of [0, -0.4]) {
    const rad = a * Math.PI / 180;
    const dir = [out[0] * Math.cos(rad) - out[2] * Math.sin(rad), 0, out[0] * Math.sin(rad) + out[2] * Math.cos(rad)];
    const eye = [l.center[0] + dir[0] * dist, l.center[1] + dy, l.center[2] + dir[2] * dist];
    const proj = projector(eye, l.center);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of l.verts) { const [px, py] = proj(p); x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    const region = [Math.floor(x0) - PAD, Math.floor(y0) - PAD, Math.ceil(x1) + PAD, Math.ceil(y1) + PAD];
    if (region[0] < MARGIN || region[1] < MARGIN || region[2] > W - 1 - MARGIN || region[3] > H - 1 - MARGIN) continue;
    cands.push({ tower: t.owner, lamp: li, center: l.center, eye, tgt: l.center, azimuth: a, dist, dy, region });
  }
}
console.log(`candidates in frame: ${cands.length}`);

// ---------- 3) 可见性评估（页内 ID 渲染 + readPixels，只回传计数） ----------
const survey = await page.evaluate(async (cands) => {
  const THREE = await import('three');
  const scene = window.__scene;
  const gl = document.querySelector('#app canvas').getContext('webgl2');
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const mk = (hex) => { const m = new THREE.MeshBasicMaterial({ color: hex, side: THREE.FrontSide }); m.toneMapped = false; m.fog = false; return m; };
  const BLACK = mk(0x000000), WHITE = mk(0xffffff);
  const isLantern = (o) => { for (let n = o; n; n = n.parent) if (/^lanterns-/.test(n.name || '')) return true; return false; };
  const meshes = [];
  scene.traverse(o => { if ((o.isMesh || o.isBatchedMesh || o.isPoints || o.isLine || o.isSprite) && o.material) meshes.push({ o, mat: o.material, vis: o.visible, lan: isLantern(o) }); });
  const bg = scene.background, fog = scene.fog;
  scene.background = new THREE.Color(0); scene.fog = null;
  for (const e of meshes) e.o.material = e.lan ? WHITE : BLACK;
  const read = (rg) => {
    const [x0, y0, x1, y1] = rg, w = x1 - x0 + 1, h = y1 - y0 + 1, buf = new Uint8Array(w * h * 4);
    window.__renderOnce();
    gl.readPixels(x0, H - 1 - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const bits = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) for (let x = 0; x < w; x++) { const k = ((h - 1 - yy) * w + x) * 4; bits[yy * w + x] = buf[k] >= 128 ? 1 : 0; }
    return bits;
  };
  const res = [];
  try {
    if (W !== 1400 || H !== 900) throw new Error(`drawingBuffer ${W}x${H}`);
    for (const c of cands) {
      window.__camPose(c.eye, c.tgt);
      const L = read(c.region);
      for (const e of meshes) if (!e.lan) e.o.visible = false;
      const S = read(c.region);
      for (const e of meshes) e.o.visible = e.vis;
      let s = 0, hidden = 0;
      for (let i = 0; i < S.length; i++) if (S[i]) { s++; if (!L[i]) hidden++; }
      res.push({ sPx: s, occ: s ? hidden / s : 1 });
    }
  } finally {
    for (const e of meshes) { e.o.material = e.mat; e.o.visible = e.vis; }
    scene.background = bg; scene.fog = fog;
  }
  return res;
}, cands);
cands.forEach((c, i) => Object.assign(c, survey[i]));
const passing = cands.filter(c => c.occ <= OCC_MAX && c.sPx >= MASK_MIN);
console.log(`visibility: ${passing.length}/${cands.length} candidates with occ ≤ ${OCC_MAX * 100}% and silhouette ≥ ${MASK_MIN}px`);
fs.writeFileSync(path.join(OUT, 'candidate-survey.json'), JSON.stringify(cands.map(({ tower, lamp, azimuth, dist, dy, region, sPx, occ }) => ({ tower, lamp, azimuth, dist, dy, region, sPx, occ: +occ.toFixed(4) })), null, 0));
if (!passing.length) throw new Error('没有满足前景遮挡 ≤1% 的候选机位');
passing.sort((a, b) => b.sPx - a.sPx);
const best = passing[0];

// ---------- 5) 掩膜冻结（纸壳身份像素 ∩ region） ----------
const maskRows = await page.evaluate(async (c) => {
  const THREE = await import('three');
  const scene = window.__scene;
  const gl = document.querySelector('#app canvas').getContext('webgl2');
  const H = gl.drawingBufferHeight;
  const mk = (hex) => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.toneMapped = false; m.fog = false; return m; };
  const BLACK = mk(0x000000), WHITE = mk(0xffffff);
  const up = (o, re) => { for (let n = o; n; n = n.parent) if (re.test(n.name || '')) return true; return false; };
  const saved = [];
  scene.traverse(o => { if ((o.isMesh || o.isBatchedMesh || o.isPoints || o.isLine || o.isSprite) && o.material) { saved.push([o, o.material]); o.material = up(o, /^lanterns-body/) ? WHITE : BLACK; } });
  const bg = scene.background, fog = scene.fog;
  scene.background = new THREE.Color(0); scene.fog = null;
  try {
    window.__camPose(c.eye, c.tgt);
    window.__renderOnce();
    const [x0, y0, x1, y1] = c.region, w = x1 - x0 + 1, h = y1 - y0 + 1, buf = new Uint8Array(w * h * 4);
    gl.readPixels(x0, H - 1 - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const rows = [];
    for (let yy = 0; yy < h; yy++) {
      const runs = []; let s = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && buf[((h - 1 - yy) * w + x) * 4] >= 128;
        if (on && s < 0) s = x;
        if (!on && s >= 0) { runs.push(x0 + s, x0 + x - 1); s = -1; }
      }
      if (runs.length) rows.push([y0 + yy, runs]);
    }
    return rows;
  } finally {
    for (const [o, m] of saved) o.material = m;
    scene.background = bg; scene.fog = fog;
  }
}, best);
const maskPx = maskRows.reduce((s, [, r]) => { for (let i = 0; i < r.length; i += 2) s += r[i + 1] - r[i] + 1; return s; }, 0);

// ---------- 6) 同机位美术渲染 ----------
const shoot = (file) => page.evaluate(() => { window.__renderOnce(); return document.querySelector('#app canvas').toDataURL('image/png'); })
  .then(u => { const b = Buffer.from(u.split(',')[1], 'base64'); fs.writeFileSync(path.join(OUT, file), b); return b; });
const settle = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await page.evaluate(([e, t]) => window.__camPose(e, t), [best.eye, best.tgt]);
await settle(30);
const r1 = await shoot('closeup-night-R1.png');
const r0n = await page.evaluate(async ({ color, intensity }) => {
  const THREE = await import('three');
  const up = (o, re) => { for (let n = o; n; n = n.parent) if (re.test(n.name || '')) return true; return false; };
  const saved = [];
  window.__scene.traverse(o => {
    if (o.isMesh && up(o, /^lanterns-body/) && o.material && o.material.name === 'btk-lantern-paper') {
      const m = o.material.clone();
      m.transparent = false; m.opacity = 1; m.depthWrite = true;
      m.emissive = new THREE.Color(color); m.emissiveIntensity = intensity;
      saved.push([o, o.material]); o.material = m;
    }
  });
  window.__leadR0Saved = saved;
  return saved.length;
}, { color: lanternGroup.color, intensity: lanternGroup.intensity * NIGHT_SCALE });
await settle(10);
await shoot('closeup-night-R0mat.png');
await page.evaluate(() => { for (const [o, m] of window.__leadR0Saved) o.material = m; window.__leadR0Saved = null; });
await settle(10);
const r1b = await shoot('closeup-night-R1-restored.png');

// 沿街多灯重叠：灯最多的塔，沿灯列方向斜看
const big = towers.reduce((a, b) => (b.lamps.length > a.lamps.length ? b : a));
const row = [...big.lamps].sort((a, b) => a.center[0] - b.center[0]);
const rd = norm(sub(row[row.length - 1].center, row[0].center));
const streetEye = [row[0].center[0] - rd[0] * 4 + rd[2] * 5, 2.2, row[0].center[2] - rd[2] * 4 - rd[0] * 5];
const streetTgt = row[Math.floor(row.length / 2)].center;
await page.evaluate(([e, t]) => window.__camPose(e, t), [streetEye, streetTgt]);
await settle(30);
await shoot('street-overlap-night.png');
await page.close();

const pageDay = await browser.newPage({ viewport: { width: W, height: H } });
await pageDay.goto(`${BASE}?zone=bazaar&light=day&batch=0`, { waitUntil: 'domcontentloaded' });
await pageDay.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });
await pageDay.evaluate(([e, t]) => window.__camPose(e, t), [best.eye, best.tgt]);
await pageDay.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k >= 30 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
fs.writeFileSync(path.join(OUT, 'closeup-day-R1.png'), Buffer.from((await pageDay.evaluate(() => { window.__renderOnce(); return document.querySelector('#app canvas').toDataURL('image/png'); })).split(',')[1], 'base64'));
await browser.close();

const maskJson = {
  generatedBy: 'scripts/lantern-night-evidence.mjs',
  generatedAt: new Date().toISOString(),
  page: `${BASE}?zone=bazaar&light=night&batch=0`,
  camera: { eye: best.eye.map(x => +x.toFixed(4)), target: best.tgt.map(x => +x.toFixed(4)), fov: FOV, canvas: [W, H], near: 0.5, poseApi: 'window.__camPose' },
  lantern: { tower: best.tower, lampIndex: best.lamp, worldCenter: best.center.map(x => +x.toFixed(4)), source: 'lanterns-body 纸壳顶点 × matrixWorld，1.2 m 连通聚簇（全场 40 只 = 14+26）' },
  selection: { azimuthFromOutwardDeg: best.azimuth, distM: best.dist, eyeDyM: best.dy, candidates: cands.length, passing: passing.length, rule: `前景遮挡 ≤ ${OCC_MAX * 100}% 且剪影 ≥ ${MASK_MIN}px 的候选中取剪影最大者（与颜色无关）` },
  visibility: {
    region: best.region, regionMarginPx: Math.min(best.region[0], best.region[1], W - 1 - best.region[2], H - 1 - best.region[3]),
    silhouettePx: best.sPx, foregroundOcclusion: +best.occ.toFixed(5), occlusionMax: OCC_MAX,
    method: 'L = 全场景灯笼分件白/其余黑；S = 只渲染灯笼分件；occ = |S∖L|/|S|（region 内）。灯笼自身骨架/盖/穗不算遮挡。',
  },
  mask: {
    method: '全场景渲染：lanterns-body 纸壳白，其余全部（含本灯骨架、盖）黑；mask = 白 ∩ region。只由几何与对象身份决定，与最终颜色无关。',
    pixelCount: maskPx, minPixels: MASK_MIN, rle: { origin: 'top-left', rows: maskRows },
  },
  r0Emulation: { overriddenMeshes: r0n, material: `纸壳克隆：不透明、emissive ${lanternGroup.color} × ${lanternGroup.intensity} × night.emissiveScale ${NIGHT_SCALE}（= R0 灯身整体在 lantern 冻结组内的发光口径）` },
  restoreByteIdentical: r1.equals(r1b),
};
fs.writeFileSync(path.join(OUT, 'lantern-mask.json'), JSON.stringify(maskJson));
console.log(`chosen ${best.tower} lamp#${best.lamp} az=${best.azimuth} dist=${best.dist} dy=${best.dy} silhouette=${best.sPx}px occ=${(best.occ * 100).toFixed(2)}% mask=${maskPx}px restoreIdentical=${maskJson.restoreByteIdentical}`);
