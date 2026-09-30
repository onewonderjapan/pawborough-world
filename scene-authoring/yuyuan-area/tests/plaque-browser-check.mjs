// wave13-plaquefix：商城楼大匾在查看器里真的被画出来、点得到（浏览器专项，需起服务：BASE=http://127.0.0.1:<端口>/）。
//
// 查的是查看器（默认 meshopt cm 件 + prepare() 的 FrontSide 剔除策略 + 运行时合批 + 灯光预设），真相从外部来：
//   - 匾位置：assemble 产物 raw 分区 GLB（cm 由此压缩）按 params features.plaques 尺寸认出板；
//   - 外侧方向：baseline/layout.json 该楼 footprint 外法线（不看 GLB 绕序）。见 tests/plaque-lib.mjs。
// 对象：华宝楼二层 8×2、悦宾楼二层 5×1.4、和丰楼四层 4.8×1.5（和丰一层 7.5×1.5 挂在一层披檐下，静态测试覆盖）。
// 断言（?zone=bazaar，light=day 与 night 各一遍；BATCH=0 时加 &batch=0 走不合批路径）：
//   B1 拾取：相机放在匾中心沿外法线 D=12 m、同高，看向匾中心；Raycaster（layers 全开 = 查看器点选同口径，
//      three 对 FrontSide 材质不命中背面）从屏幕中心打出去，第一个命中必须是该楼锚节点下的 plaques__dark*，
//      距离 = D ± 0.5（不是后面的窗背板 / 格心）；
//   B2 像素：把 btk-dark* 材质临时染成不受色调映射的纯品红再渲染一帧，屏幕中心像素必须是品红（匾真的画出来了，
//      不只是射线命中）；随后恢复原材质。
// 红态：6c6270fb 产物（rpanel 绕序朝内 → prepare() FrontSide 剔除）三块匾 B1 / B2 全红（day / night），见工单包 artifacts/red-plaque-browser-*.log。
// SHOTDIR=<目录>：另存三处人眼机位截图（华宝楼广场 / 悦宾楼街面 / 和丰楼）到该目录（只放工单包，不进仓库）。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadInputs, panelTriangles, bigPlaques } from './plaque-lib.mjs';

const require = createRequire(import.meta.url);   // 经本模块 node_modules（worktree 链到仓库共享依赖）解析，不依赖 ~/pawborough-world 软链
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5490/';
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');

// Chromium 解析（wave14-viewerside R1 必修4：去个人绝对路径；CHROME_PATH 优先，否则 Playwright 自管/缓存扫描）
function resolveChromiumExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    if (fs.existsSync(chromium.executablePath())) return null;
  } catch { /* registry 未配置，走缓存扫描 */ }
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const revs = fs.readdirSync(cache)
      .map(d => { const m = /^chromium-(\d+)$/.exec(d); return m ? { d, rev: Number(m[1]) } : null; })
      .filter(Boolean).sort((a, b) => b.rev - a.rev);
    for (const { d } of revs) {
      const p = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 无默认缓存目录 */ }
  return null;
}

const exe = resolveChromiumExecutable();
const LIGHTS = (process.env.LIGHTS || 'day,night').split(',');
const BATCH0 = process.env.BATCH === '0';
const SHOTDIR = process.env.SHOTDIR || '';
const TAG = process.env.SHOTTAG || '';
const D = 12;

let pass = 0, fail = 0;
const ok = (msg, cond, data) => { if (cond) { pass++; console.log('PASS', msg); } else { fail++; console.log('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };

const inp = loadInputs(OUT);
const all = bigPlaques(inp, panelTriangles(inp.files, inp.ids.ids));
const TARGETS = [['bld-428202599', 0, 'huabao'], ['bld-428202602', 0, 'yuebin'], ['bld-389701812', 1, 'hefeng']].map(([id, k, key]) => {
  const p = all.find(q => q.id === id && q.index === k);
  return p && p.board.n ? { id, key, name: p.name, size: `${p.wM}×${p.hM}`, c: p.board.center, n: p.board.outward } : { id, key, missing: true };
});
for (const t of TARGETS) ok(`truth ${t.id} ${t.key} 大匾在 raw GLB 中定位到`, !t.missing && t.n, t);
// 人眼机位（截图用）：沿外法线退 dist、沿墙切向偏 along、视点高 eyeY（地面约 0），看匾中心。
// 华宝楼 / 和丰楼隔中心广场相对（约 28 m），悦宾楼大匾朝东对着约 6 m 宽的街，所以悦宾取街面斜看。
const VIEWS = { huabao: { dist: 22, along: 6, eyeY: 1.7 }, yuebin: { dist: 5, along: 15, eyeY: 1.7 }, hefeng: { dist: 25, along: 0, eyeY: 4.0 } };

// GPU_WEBGL=1：机器 swiftshader WebGL 全灭时的环境开关（headless:false + 外部 DISPLAY/XAUTHORITY），默认关闭。
const browser = await chromium.launch({ executablePath: exe, ...(process.env.GPU_WEBGL === '1' ? { headless: false } : {}), args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  for (const light of LIGHTS) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${BASE}?zone=bazaar&light=${light}${BATCH0 ? '&batch=0' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
    const st = await page.evaluate(() => window.__lighting?.state?.());
    ok(`[${light}] 灯光预设已应用`, st && st.preset === light, st && { preset: st.preset, error: st.error });
    for (const t of TARGETS.filter(q => !q.missing)) {
      const eye = [t.c[0] + t.n[0] * D, t.c[1], t.c[2] + t.n[2] * D];
      const r = await page.evaluate(async ({ eye, c, id }) => {
        const THREE = await import('three');
        const scene = window.__scene;
        window.__viewAt(eye, c);
        window.__renderOnce();
        const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 4000);
        camera.position.set(...eye); camera.lookAt(...c); camera.updateMatrixWorld();
        const ray = new THREE.Raycaster(); ray.layers.enableAll();
        ray.setFromCamera(new THREE.Vector2(0, 0), camera);
        const names = (o) => { const a = []; for (let n = o; n; n = n.parent) a.push(String(n.userData?.name || n.name || '')); return a; };
        const hits = ray.intersectObjects(scene.children, true).filter(h => !h.object.isBatchedMesh).slice(0, 3)
          .map(h => ({ d: +h.distance.toFixed(3), chain: names(h.object).slice(0, 3).join(' < '), anchor: names(h.object).includes(id), mat: h.object.material?.name, side: h.object.material?.side }));
        // B2：btk-dark* 临时染品红（不受色调映射 / 光照）
        const mats = new Set();
        scene.traverse(o => { if (o.isMesh && o.material && /^btk-dark(\.\d+)?$/.test(o.material.name)) mats.add(o.material); });
        const saved = [...mats].map(m => [m, m.color.clone(), m.emissive.clone(), m.emissiveIntensity, m.toneMapped]);
        for (const m of mats) { m.color.setRGB(1, 0, 1); m.emissive.setRGB(1, 0, 1); m.emissiveIntensity = 1; m.toneMapped = false; m.needsUpdate = true; }
        window.__renderOnce();
        const gl = document.querySelector('canvas').getContext('webgl2');
        const px = new Uint8Array(4); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (const [m, col, em, ei, tm] of saved) { m.color.copy(col); m.emissive.copy(em); m.emissiveIntensity = ei; m.toneMapped = tm; m.needsUpdate = true; }
        window.__renderOnce();
        return { hits, px: [...px], tinted: mats.size };
      }, { eye, c: t.c, id: t.id });
      const h0 = r.hits[0];
      ok(`[${light}] B1 ${t.name} ${t.size} 匾中心拾取命中 plaques__dark（该楼、距 ${D} m）`,
        !!h0 && /plaques__dark/.test(h0.chain) && h0.anchor && Math.abs(h0.d - D) <= 0.5, r.hits);
      ok(`[${light}] B2 ${t.name} ${t.size} 匾中心像素被画出（btk-dark 染品红后中心像素为品红）`,
        r.px[0] > 200 && r.px[2] > 200 && r.px[1] < 80, { px: r.px, tintedMaterials: r.tinted });
    }
    if (SHOTDIR) {
      for (const t of TARGETS.filter(q => !q.missing)) {
        const v = VIEWS[t.key];
        const eye = [t.c[0] + t.n[0] * v.dist + t.n[2] * v.along, v.eyeY, t.c[2] + t.n[2] * v.dist - t.n[0] * v.along];
        await page.evaluate(({ eye, c }) => { window.__viewAt(eye, c); window.__renderOnce(); }, { eye, c: t.c });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTDIR, `${TAG}${t.key}-${light}${BATCH0 ? '-batch0' : ''}.png`) });
      }
    }
    ok(`[${light}] 无页面错误`, errs.length === 0, errs);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`plaque-browser: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
