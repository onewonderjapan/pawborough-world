// wave7-outerkit 联系表取图：同一组机位（全部从 baseline/layout.json 现算）对任一 OUT_DIR 的查看器截图，
// 每个样板一张航拍（斜俯 ~35°）+ 一张街道眼高（1.6 m，机位在楼外空地 / 路面、视线不穿别栋），另加两张区域总览。
// 图片只写到 SHOTDIR（工单包 artifacts/ 下），不进仓库。
// 用法：BASE=http://127.0.0.1:5492/ SHOTDIR=<dir> TAG=before node modules/outer-kit/contact-shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5492/';
const SHOTDIR = process.env.SHOTDIR; const TAG = process.env.TAG || 'shot';
if (!SHOTDIR) throw new Error('SHOTDIR required');
fs.mkdirSync(SHOTDIR, { recursive: true });
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'outer-kit', 'ids.json'), 'utf8')).ids;
const SOLID = new Set(['outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'waterside', 'stage']);
const ring = (fp) => { const r = fp.map(p => [p[0], p[1]]); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop(); return r; };
const solids = layout.objects.filter(o => SOLID.has(o.kind) && o.geometry && o.geometry.footprint).map(o => ({ id: o.id, r: ring(o.geometry.footprint) }));
const roads = [];
for (const o of layout.objects) if (o.kind === 'road' && o.geometry.polyline) for (let i = 1; i < o.geometry.polyline.length; i++) roads.push([o.geometry.polyline[i - 1], o.geometry.polyline[i], (o.geometry.width || 4) / 2]);
const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
const cross = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); };
const blocked = (p, q, skip) => solids.some(s => s.id !== skip && s.r.some((a, i) => cross(p, q, a, s.r[(i + 1) % s.r.length])));
function cams(o) {
  const r = ring(o.geometry.footprint);
  const xs = r.map(p => p[0]), zs = r.map(p => p[1]);
  const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  const R = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;
  const h = o.height || 6.4;
  const d = R + 22;
  const aerial = { p: [c[0] + d * 0.62, h + R * 0.9 + 24, c[1] + d * 0.78], t: [c[0], h * 0.5, c[1]] };
  // 街道眼高：对每条 ≥ 3 m 的边，沿外法线退 12–32 m 放机位（不在别栋内、离别栋 ≥ 1.5 m、到该边两端 + 中点视线不穿别栋），
  // 优先路面上、边长长、距离近；看向该边中点
  let ar = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; ar += p[0] * q[1] - q[0] * p[1]; }
  const sg = ar > 0 ? 1 : -1;
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 3) continue;
    const n = [sg * (b[1] - a[1]) / len, -sg * (b[0] - a[0]) / len], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const dist of [6, 8, 12, 16, 20, 26, 32, 40]) for (const lat of [0, -0.3, 0.3]) {
      const p = [m[0] + n[0] * dist + (b[0] - a[0]) * lat, m[1] + n[1] * dist + (b[1] - a[1]) * lat];
      if (solids.some(s => inside(p, s.r) || s.r.some((q, j) => segDist(p, q, s.r[(j + 1) % s.r.length]) < 1.5))) continue;
      const ends = [[a[0] * 0.9 + b[0] * 0.1, a[1] * 0.9 + b[1] * 0.1], [a[0] * 0.1 + b[0] * 0.9, a[1] * 0.1 + b[1] * 0.9], m];
      if (ends.some(q => blocked(p, q, o.id))) continue;
      const onRoad = roads.some(([a1, b1, hw]) => segDist(p, a1, b1) <= hw);
      const score = Math.abs(dist - Math.max(12, 1.6 * h)) - (onRoad ? 8 : 0) - Math.min(len, 20) * 0.3 + Math.abs(lat) * 4;
      if (!best || score < best.score) best = { score, p, onRoad, m, dist, edge: i };
    }
  }
  const street = best ? { p: [best.p[0], 1.6, best.p[1]], t: [best.m[0], Math.min(h * 0.55, 5), best.m[1]], onRoad: best.onRoad, edge: best.edge, dist: best.dist } : null;
  return { aerial, street, c, R };
}
const plan = ids.map(id => ({ id, ...cams(layout.objects.find(o => o.id === id)) }));
fs.writeFileSync(path.join(SHOTDIR, `cams-${TAG}.json`), JSON.stringify(plan, null, 1));

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.goto(BASE + '?zone=all&cam=oblique', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
await page.click('#t-labels');
await page.addStyleTag({ content: '#bar,#hud,#info,#loadmsg,#labels{display:none!important}' });
const frame = async () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
const shot = async (v, file) => {
  await page.evaluate(([p, t]) => window.__viewAt(p, t), [v.p, v.t]);
  await frame(); await page.waitForTimeout(150); await frame();
  const st = await page.evaluate(() => window.__pixelStats());
  await page.screenshot({ path: path.join(SHOTDIR, file) });
  return { file, std: +st.std.toFixed(1) };
};
const out = [];
for (const s of plan) {
  out.push(await shot(s.aerial, `${TAG}-${s.id}-aerial.png`));
  if (s.street) out.push(await shot(s.street, `${TAG}-${s.id}-street.png`));
}
// 总览：外围北片（z<0）/ 南片（z>0）各一张（同机位）
out.push(await shot({ p: [150, 150, -330], t: [60, 0, -180] }, `${TAG}-overview-a.png`));
out.push(await shot({ p: [60, 140, 340], t: [110, 0, 180] }, `${TAG}-overview-b.png`));
const loaded = await page.evaluate(() => ({ zones: window.__zonesLoaded, bytes: window.__loadedBytes }));
await browser.close();
fs.writeFileSync(path.join(SHOTDIR, `shots-${TAG}.json`), JSON.stringify({ base: BASE, loaded, shots: out }, null, 1));
const blank = out.filter(s => s.std < 2);
console.log(`contact-shots ${TAG}: ${out.length} shots, blank ${blank.length}, zones ${loaded.zones.join(',')}`);
process.exit(blank.length ? 2 : 0);
