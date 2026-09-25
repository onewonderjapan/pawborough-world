// wave5-fangbangqa Q1：方浜中路行人眼高普查（只查不改）。
// 机位：OUT_DIR/fangbang-route.json mainStreet 从东端到首次抵达山门接点（junction.pointIndex），按弧长每 STEP m
// 取一个站点，眼高 = 路面 y + 1.6 m；每站两套朝向（toTemple = 沿路线前进方向，toEast = 反向），另加山门接缝 4 张。
// 每张图记录：背景色像素占比（看穿到空地/天空的下半幅）、近黑像素占比；每站左右水平探测射线首中距离与命中对象。
// 另导出场景审计原始数据（fangbang 各锚的局部包围盒 + 世界矩阵、材质贴图状态、路面竖直探测命中列表），
// 由 scripts/fangbang-eye-analyze.py 分析（Q1 FINDINGS 的数字来源）。
// 图片只写 SHOT_DIR（必须显式给，且不得位于仓库内——仓库是公开的）。
// 用法：PORT=5492 OUT_DIR=out-zone node scripts/server.mjs &
//       BASE=http://127.0.0.1:5492/ OUT_DIR=out-zone SHOT_DIR=/abs/outside/repo node scripts/fangbang-eye-survey.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AREA, '..', '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const SHOT_DIR = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : null;
if (!SHOT_DIR) { console.error('SHOT_DIR required (absolute path outside the repo)'); process.exit(2); }
if (SHOT_DIR === REPO || SHOT_DIR.startsWith(REPO + path.sep)) { console.error('SHOT_DIR must be outside the repo (public repo; images never committed)'); process.exit(2); }
const BASE = process.env.BASE || 'http://127.0.0.1:5492/';
const STEP = +(process.env.STEP || 15);
const EYE = 1.6;
const SHOTS = process.env.SHOTS !== '0';
const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const CHROME = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

const route = JSON.parse(fs.readFileSync(path.join(OUT, 'fangbang-route.json'), 'utf8'));
const ms = route.mainStreet;
const ji = route.junction.pointIndex;
// 弧长重采样（东端 -> 山门接点）
const line = ms.slice(0, ji + 1);
const cum = [0];
for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][2] - line[i - 1][2]));
const total = cum[cum.length - 1];
function at(s) {
  let i = 1;
  while (i < line.length - 1 && cum[i] < s) i++;
  const a = line[i - 1], b = line[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
  const p = [a[0] + (b[0] - a[0]) * t, (a[1] || 0) + ((b[1] || 0) - (a[1] || 0)) * t, a[2] + (b[2] - a[2]) * t];
  const d = [b[0] - a[0], b[2] - a[2]]; const n = Math.hypot(...d) || 1;
  return { p, dir: [d[0] / n, d[1] / n] };
}
// 切线用 ±4 m 弦（避开 0.5 m 折线抖动）
function tangent(s) {
  const a = at(Math.max(0, s - 4)).p, b = at(Math.min(total, s + 4)).p;
  const d = [b[0] - a[0], b[2] - a[2]]; const n = Math.hypot(...d) || 1;
  return [d[0] / n, d[1] / n];
}
const stations = [];
for (let s = 0, k = 0; s <= total + 1e-6; s += STEP, k++) {
  const { p } = at(s);
  stations.push({ key: `s${String(k).padStart(2, '0')}`, s: +s.toFixed(1), p: p.map(v => +v.toFixed(3)), dir: tangent(s).map(v => +v.toFixed(4)) });
}
if (total - stations[stations.length - 1].s > 3) {
  const { p } = at(total);
  stations.push({ key: `s${String(stations.length).padStart(2, '0')}`, s: +total.toFixed(1), p: p.map(v => +v.toFixed(3)), dir: tangent(total - 0.01).map(v => +v.toFixed(4)) });
}
// 山门接缝 4 机位（地图坐标，山门锚 = route.junction.at；路线在接点前的来向 = dirIn）
const J = [route.junction.at[0], 0, route.junction.at[1]];   // junction.at = [x, z]
const dirIn = tangent(total - 2);      // 走向山门的方向
const perp = [-dirIn[1], dirIn[0]];
const seam = [
  { key: 'seam-a-approach', eye: [J[0] - dirIn[0] * 12, EYE, J[2] - dirIn[1] * 12], look: [J[0], 3.5, J[2]] },
  { key: 'seam-b-north-corner', eye: [J[0] - dirIn[0] * 6 + perp[0] * 5, EYE, J[2] - dirIn[1] * 6 + perp[1] * 5], look: [J[0] + perp[0] * 9, 2.5, J[2] + perp[1] * 9] },
  { key: 'seam-c-south-corner', eye: [J[0] - dirIn[0] * 6 - perp[0] * 5, EYE, J[2] - dirIn[1] * 6 - perp[1] * 5], look: [J[0] - perp[0] * 9, 2.5, J[2] - perp[1] * 9] },
  { key: 'seam-d-lookback', eye: [J[0] + dirIn[0] * 1.5, EYE, J[2] + dirIn[1] * 1.5], look: [J[0] - dirIn[0] * 20, EYE, J[2] - dirIn[1] * 20] },
];

fs.mkdirSync(SHOT_DIR, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(new URL('?zone=core&batch=0', BASE).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
await page.click('[data-zone="fangbang"]');
await page.waitForFunction(() => (window.__zonesLoaded || []).filter(z => z.startsWith('fangbang')).length >= 1
  && !document.getElementById('hud').innerText.includes('…'), null, { timeout: 900000 });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '#bar,#hud,#labels,#info,#loadmsg{display:none!important}' });
const loaded = await page.evaluate(() => window.__zonesLoaded);
console.log('zones loaded', loaded);

// 页面内工具：射线、像素统计、场景审计
await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const scene = window.__scene;
  const infoOf = (o) => { for (let n = o; n; n = n.parent) { const u = n.userData || {}; if (u.id) return { id: u.id, zone: u.zone || '', module: u.module || '' }; const p = String(n.name || '').split('|'); if (p.length >= 4) return { id: p[1], zone: p[0], module: p[2] }; } return { id: '?', zone: '?', module: '' }; };
  const zoneOf = (o) => { for (let n = o; n; n = n.parent) if (String(n.name || '').startsWith('ZN-')) return n.name.slice(3); return '?'; };
  const meshes = [];
  scene.traverse(o => { if (o.isMesh && !o.isBatchedMesh && o.visible) meshes.push(o); });
  scene.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  rc.layers.enableAll();
  window.__probe = (origin, dir, far = 60) => {
    rc.set(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());
    rc.far = far;
    const h = rc.intersectObjects(meshes, false)[0];
    if (!h) return null;
    const inf = infoOf(h.object);
    return { d: +h.distance.toFixed(2), id: inf.id, zone: zoneOf(h.object), mesh: h.object.name, y: +h.point.y.toFixed(3) };
  };
  window.__probeDown = (x, z) => {
    rc.set(new THREE.Vector3(x, 6, z), new THREE.Vector3(0, -1, 0));
    rc.far = 12;
    return rc.intersectObjects(meshes, false).filter(h => h.point.y > -1 && h.point.y < 0.6).slice(0, 6).map(h => ({ y: +h.point.y.toFixed(4), id: infoOf(h.object).id, zone: zoneOf(h.object), mesh: h.object.name }));
  };
  window.__shotStats = () => {
    const c = document.querySelector('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // readPixels 行 0 = 画面底部；下半幅 = 行 0..h/2
    let bgLow = 0, nLow = 0, dark = 0, n = 0, s = 0, s2 = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; s += l; s2 += l * l; n++;
      if (l < 18) dark++;
      if (y < h / 2) { nLow++; if (Math.abs(r - 223) <= 6 && Math.abs(g - 232) <= 6 && Math.abs(b - 236) <= 6) bgLow++; }
    }
    return { bgLowFrac: +(bgLow / nLow).toFixed(4), darkFrac: +(dark / n).toFixed(4), std255: +Math.sqrt(s2 / n - (s / n) ** 2).toFixed(1) };
  };
  window.__fbAudit = () => {
    const anchors = [];
    scene.traverse(o => { const u = o.userData || {}; if (u.zone === 'fangbang' && typeof u.id === 'string' && u.id.startsWith('fangbang-')) anchors.push(o); });
    const out = [];
    for (const a of anchors) {
      a.updateMatrixWorld(true);
      const inv = a.matrixWorld.clone().invert();
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      const wlo = lo.clone(), whi = hi.clone();
      const parts = [];
      a.traverse(m => {
        if (!m.isMesh || !m.geometry) return;
        const pos = m.geometry.attributes.position; const v = new THREE.Vector3();
        const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        const plo = new THREE.Vector3(Infinity, Infinity, Infinity), phi = plo.clone().negate();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const w = v.clone().applyMatrix4(m.matrixWorld); wlo.min(w); whi.max(w);
          v.applyMatrix4(M); lo.min(v); hi.max(v); plo.min(v); phi.max(v);
        }
        const mat = m.material || {};
        parts.push({ mesh: m.name, mat: mat.name || '', lo: plo.toArray().map(x => +x.toFixed(3)), hi: phi.toArray().map(x => +x.toFixed(3)),
          map: mat.map ? { w: mat.map.image?.width || 0, h: mat.map.image?.height || 0, mip: (mat.map.mipmaps || []).length } : null,
          color: mat.color ? mat.color.toArray().map(x => +x.toFixed(3)) : null, side: mat.side, tris: (m.geometry.index ? m.geometry.index.count : pos.count) / 3 });
      });
      const e = a.matrixWorld.elements;
      out.push({ id: a.userData.id, module: a.userData.module, group: a.userData.group || '', v7id: a.userData.v7id || null,
        pos: [e[12], e[13], e[14]].map(x => +x.toFixed(4)), rotY: +Math.atan2(e[8], e[10]).toFixed(5),
        localLo: lo.toArray().map(x => +x.toFixed(3)), localHi: hi.toArray().map(x => +x.toFixed(3)),
        worldLo: wlo.toArray().map(x => +x.toFixed(3)), worldHi: whi.toArray().map(x => +x.toFixed(3)), parts });
    }
    return out;
  };
  // 非 fangbang 网格的世界顶点（供穿插检测）：只取与 fangbang 包围盒（外扩 2 m）相交的网格
  window.__otherVerts = (box) => {
    const B = new THREE.Box3(new THREE.Vector3(...box[0]), new THREE.Vector3(...box[1]));
    const res = [];
    for (const m of meshes) {
      const z = zoneOf(m);
      if (z.startsWith('fangbang')) continue;
      const bb = new THREE.Box3().setFromObject(m);
      if (!bb.intersectsBox(B)) continue;
      const pos = m.geometry.attributes.position; const v = new THREE.Vector3(); const arr = [];
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); if (B.containsPoint(v)) arr.push(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)); }
      if (arr.length) res.push({ id: infoOf(m).id, zone: z, mesh: m.name, v: arr });
    }
    return res;
  };
});

const shots = [];
async function shoot(key, eye, look) {
  await page.evaluate(([p, t]) => window.__viewAt(p, t), [eye, look]);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const st = await page.evaluate(() => window.__shotStats());
  const file = path.join(SHOT_DIR, `${key}.png`);
  if (SHOTS) await page.locator('canvas').screenshot({ path: file });
  return { key, eye: eye.map(v => +v.toFixed(3)), look: look.map(v => +v.toFixed(3)), file: SHOTS ? file : null, ...st };
}
const probes = [];
for (const st of stations) {
  const y = (st.p[1] || 0) + EYE;
  const eye = [st.p[0], y, st.p[2]];
  for (const [dirKey, sg] of [['toTemple', 1], ['toEast', -1]]) {
    const f = [st.dir[0] * sg, st.dir[1] * sg];
    const shot = await shoot(`${st.key}-${dirKey}`, eye, [eye[0] + f[0] * 20, y, eye[2] + f[1] * 20]);
    shots.push({ station: st.key, s: st.s, dir: dirKey, ...shot });
  }
  // 左右水平探测（相对 toTemple 前进方向；左 = 前进方向逆时针 90°）+ ±30° 斜向，y = 1.6 / 4.0
  const fw = st.dir, left = [fw[1], -fw[0]];
  const rot = (v, deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const pr = { station: st.key, s: st.s, p: st.p, dir: st.dir, rays: {} };
  for (const [side, base] of [['L', left], ['R', [-left[0], -left[1]]]]) {
    for (const deg of [-30, 0, 30]) {
      const d = rot(base, deg);
      for (const hy of [1.6, 4.0]) {
        pr.rays[`${side}${deg}@${hy}`] = await page.evaluate(([o, dd]) => window.__probe(o, dd), [[st.p[0], (st.p[1] || 0) + hy, st.p[2]], [d[0], 0, d[1]]]);
      }
    }
  }
  probes.push(pr);
  process.stdout.write(`${st.key} `);
}
console.log();
for (const sm of seam) shots.push({ station: 'seam', dir: sm.key, ...(await shoot(sm.key, sm.eye, sm.look)) });
// 路面竖直探测：路线每 1 m（到山门接点）
const ground = [];
for (let s = 0; s <= total; s += 1) {
  const { p } = at(s);
  ground.push({ s, x: +p[0].toFixed(2), z: +p[2].toFixed(2), hits: await page.evaluate(([x, z]) => window.__probeDown(x, z), [p[0], p[2]]) });
}
const audit = await page.evaluate(() => window.__fbAudit());
// fangbang 总包围盒
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const a of audit) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a.worldLo[i]); hi[i] = Math.max(hi[i], a.worldHi[i]); }
const others = await page.evaluate((b) => window.__otherVerts(b), [[lo[0] - 2, 0.15, lo[2] - 2], [hi[0] + 2, hi[1], hi[2] + 2]]);
await browser.close();
const doc = { base: BASE, outDir: path.relative(AREA, OUT), step: STEP, eye: EYE, routeLengthToJunction: +total.toFixed(1), junction: route.junction.at,
  zonesLoaded: loaded, stations, shots, probes, ground, audit, others };
fs.writeFileSync(path.join(SHOT_DIR, 'survey.json'), JSON.stringify(doc));
console.log(`survey: ${stations.length} stations, ${shots.length} shots, ${audit.length} anchors, ${others.length} other-zone meshes near fangbang -> ${SHOT_DIR}/survey.json`);
