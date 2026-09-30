// wave14-lantern R1：固定机位灯笼特写拍摄（night/day），产出 png + sidecar（lantern-rect.json）。
// 机位 = R1 before 侧车档案（artifacts/r1/shots/before/lantern-rect.json）：eye/tgt/fov46/canvas1400×900；
// after 沿用同一机位与同一 rect（灯身 r=0.3、H=0.63 几何尺寸 R1 未变——内层分层不改外形，同框像素级可比），
// 另在页面内独立投影校验（rectCheck）：灯心投影像素 + 灯身半径像素，证明灯身仍在 rect 中心 50% 取样区内。
// 用法: node run/shoot-closeup-r1.mjs --base http://127.0.0.1:5485/ --out <dir> \
//         --eye -160.73,3.1,-36.1 --tgt -162.08,3.2,-36.1 --lamp -162.08,3.2,-36.1 --rM 0.3 \
//         --rect-in <before>/lantern-rect.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { canvasPng, savePng, settle } from '../tests/perf-lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const A = process.argv;
const argv = (f, d) => (A.includes(f) ? A[A.indexOf(f) + 1] : d);
const BASE = argv('--base', 'http://127.0.0.1:5485/');
const OUT = argv('--out', 'shots');
const eye = argv('--eye', '-160.73,3.1,-36.1').split(',').map(Number);
const tgt = argv('--tgt', '-162.08,3.2,-36.1').split(',').map(Number);
const lamp = argv('--lamp', '-162.08,3.2,-36.1').split(',').map(Number);
const rM = +argv('--rM', '0.3');
const rectInPath = argv('--rect-in', null);
const W = 1400, H = 900, FOV = 46;
const R_LAMP = rM * 1.05 + 0.012;                    // 瓣鼓 +5% + 骨架棱外偏（build_tower.py LANTRN_PETAL/rib）

fs.mkdirSync(OUT, { recursive: true });
const rectIn = rectInPath ? JSON.parse(fs.readFileSync(rectInPath, 'utf8')) : null;

// 独立投影校验（Node 侧重算，不依赖页面内部状态）：
const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = (a) => { const l = Math.hypot(...a); return a.map(v => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const f = norm(sub(tgt, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
const d = dot(sub(lamp, eye), f);
const x = dot(sub(lamp, eye), r), y = dot(sub(lamp, eye), u);
const tanV = Math.tan(FOV / 2 * Math.PI / 180);                    // three.js fov 为竖直向；横竖向都按 H/2 缩放
const px = (W / 2) + (x / (d * tanV)) * (H / 2);
const py = (H / 2) - (y / (d * tanV)) * (H / 2);
const rPx = (R_LAMP / d) / tanV * (H / 2);

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
for (const mode of ['night', 'day']) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`${BASE}?zone=bazaar&light=${mode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  await page.evaluate(([e, t]) => window.__camPose(e, t), [eye, tgt]);
  await settle(page, 30);
  const png = await canvasPng(page);
  const file = path.join(OUT, `lantern-closeup-${mode}.png`);
  savePng(file, png);
  const sidecar = {
    lamp, eye, target: tgt, rect: rectIn ? rectIn.rect : null, canvas: [W, H], fov: FOV,
    distM: +Math.hypot(...sub(eye, tgt)).toFixed(3),
    rectCheck: { lampPx: [+px.toFixed(1), +py.toFixed(1)], lampRadiusPx: +rPx.toFixed(1), note: '灯身投影（瓣鼓+棱外偏半径）；须整体落在 rect 中心 50% 取样区内' },
    tag: 'after-r1',
  };
  fs.writeFileSync(path.join(OUT, 'lantern-rect.json'), JSON.stringify(sidecar, null, 1));
  console.log(`shot ${mode} -> ${file}  lampPx=(${px.toFixed(1)},${py.toFixed(1)}) rPx=${rPx.toFixed(1)}`);
  await page.close();
}
await browser.close();
console.log('shoot-closeup-r1: done');
