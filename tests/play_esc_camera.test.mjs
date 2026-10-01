// 工单 D：Esc 解锁暂停后镜头保持当前画面 —— 真实浏览器回归。
// 真实 canvas click 指针锁定 → R 上车 → W 前进 → 鼠标 look → Escape →
// 两秒真实等待 → 断言镜头 position/quaternion、车身、脚点全部稳定；
// 点击继续重新锁鼠标并恢复游玩。不 mock 任何交互（keydown/pointerlock 全走真浏览器）。
//
// 运行前提：GPU Chrome（headless:false，GOAL QA 参数），area Playwright 1.63，
// chromium executable /home/baibai/.cache/ms-playwright/chromium-1234。
// 本测试自建 5538 端口 serve（OUT_DIR=out-zone），不碰 5492。
// Run: node tests/play_esc_camera.test.mjs   (exit 0 = contract holds)
// 可选 env：PB_EVIDENCE_DIR=<dir> 额外落两张截图；PB_ESC_PORT 覆盖端口。
import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const area = resolve(root, 'scene-authoring/yuyuan-area');
const PORT = Number(process.env.PB_ESC_PORT || 5538);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

let failures = 0;
let browser;
const pageErrors = [];
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const same = (a, b, eps = 1e-9) => Array.isArray(a)
  && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

// ---- serve（失败早退，不重试不换端口） ----
function waitForServer(url, timeoutMs = 20000) {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const ping = async () => {
      if (server.exitCode !== null) return rej(new Error('owned test server exited: ' + serverLog.slice(-300)));
      try {
        const r = await fetch(url + '/out/zones-manifest.json');
        if (r.ok && serverLog.includes('preview at http://127.0.0.1:' + PORT + '/')) return res();
      } catch { /* not up yet */ }
      if (Date.now() - t0 > timeoutMs) return rej(new Error(`server not ready at ${url}`));
      setTimeout(ping, 300);
    };
    ping();
  });
}

const server = spawn(process.execPath, ['scripts/server.mjs'], {
  cwd: area,
  env: { ...process.env, PORT: String(PORT), OUT_DIR: 'out-zone' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const stopServer = () => { try { server.kill('SIGTERM'); } catch { /* exited */ } };
process.on('exit', stopServer);

try {
  await waitForServer(URL_BASE);

  const { chromium } = await import(resolve(area, 'node_modules/playwright/index.mjs'));
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,                       // GOAL：真实 GPU Chrome，非 SwiftShader
    args: ['--disable-dev-shm-usage', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(URL_BASE + '/?play=1&at=center', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const s = window.__play?.status?.();
    return s && s.ready && s.bikePlaced && s.mode === 'play';
  }, null, { timeout: 60000 });

  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 640, y: 400 } });    // 真实 click → 锁定鼠标
  await page.waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 10000 });
  check('canvas click 后真实指针锁定', true);

  // R 上车（借车点已按真实支撑面布好），W 前进一小段
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__play?.status?.().riding === true, null, { timeout: 10000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const stRiding = await page.evaluate(() => ({ s: window.__play.status(), w: window.__walk.status() }));
  check('R 上车成功（骑乘中、车辆位置有效）', stRiding.s.riding === true && stRiding.s.vehicle?.pos?.length === 3,
    `feet=${JSON.stringify(stRiding.s.feet)} bike=${JSON.stringify(stRiding.s.vehicle?.pos)}`);

  // 鼠标 look（骑乘自由视角）
  await page.mouse.move(640, 400);
  await page.mouse.move(760, 360, { steps: 6 });
  await page.waitForTimeout(300);

  await page.keyboard.down('Space');
  await page.waitForTimeout(400);
  await page.keyboard.up('Space');
  await page.evaluate(() => window.addEventListener('keydown', e => {
    if (e.code === 'Escape') window.__qaEscapeCamera = window.__walk.status();
  }, { capture: true }));

  // ---- Escape：真浏览器退出指针锁 → lock-lost 暂停；镜头/车身/脚点冻结 ----
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__play?.status?.().paused === true, null, { timeout: 10000 });
  check('Escape 后暂停且真实指针解锁', await page.evaluate(() => document.pointerLockElement === null));
  const beforeEsc = await page.evaluate(() => window.__qaEscapeCamera);
  const afterEsc = await page.evaluate(() => window.__walk.status());
  check('Esc 前后镜头位置保持', same(beforeEsc.camera, afterEsc.camera, 0.01));
  check('Esc 前后镜头朝向保持', same(beforeEsc.cameraRotation, afterEsc.cameraRotation, 1e-5));

  const t0 = await page.evaluate(() => ({
    cam: window.__walk.status().camera,
    quat: window.__walk.status().cameraQuat,
    feet: window.__play.status().feet,
    bike: window.__play.status().vehicle?.pos ?? null,
    yaw: window.__play.status().yaw,
  }));
  await page.waitForTimeout(2000);                          // 两秒真实等待
  const t1 = await page.evaluate(() => ({
    cam: window.__walk.status().camera,
    quat: window.__walk.status().cameraQuat,
    feet: window.__play.status().feet,
    bike: window.__play.status().vehicle?.pos ?? null,
    yaw: window.__play.status().yaw,
  }));
  check('暂停 2s：镜头位置稳定', same(t0.cam, t1.cam), `${JSON.stringify(t0.cam)} vs ${JSON.stringify(t1.cam)}`);
  check('暂停 2s：镜头四元数稳定', same(t0.quat, t1.quat), `${JSON.stringify(t0.quat)} vs ${JSON.stringify(t1.quat)}`);
  check('暂停 2s：车身位置稳定', same(t0.bike ?? [], t1.bike ?? []),
    `${JSON.stringify(t0.bike)} vs ${JSON.stringify(t1.bike)}`);
  check('暂停 2s：脚点稳定', same(t0.feet ?? [], t1.feet ?? []), `${JSON.stringify(t0.feet)} vs ${JSON.stringify(t1.feet)}`);

  if (process.env.PB_EVIDENCE_DIR) {
    try {
      await mkdir(process.env.PB_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.PB_EVIDENCE_DIR, 'AFTER-ESC-PAUSED-2S.png') });
    } catch (e) { console.log('  [evidence] screenshot failed:', String(e).slice(0, 120)); }
  }

  // ---- 点击继续：重新锁鼠标 + 清键恢复 ----
  await canvas.click({ position: { x: 640, y: 400 } });
  await page.waitForFunction(() =>
    window.__play?.status?.().paused === false && document.pointerLockElement !== null,
  null, { timeout: 10000 });
  check('点击继续：暂停解除且重新锁定鼠标', true);
  const resumed = await page.evaluate(() => window.__play.status());
  check('恢复后仍在车上且位置未跳变', resumed.riding === true && Math.hypot(t0.feet[0] - resumed.feet[0], t0.feet[2] - resumed.feet[2]) < 1e-4 && Math.abs(t0.feet[1] - resumed.feet[1]) < 0.025,
    `feet=${JSON.stringify(resumed.feet)}`);

  // 下车（不回出生点：位置仍是骑乘结束点附近）
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__play?.status?.().riding === false, null, { timeout: 10000 });
  const after = await page.evaluate(() => window.__play.status());
  check('下车后不归出生点（脚点仍在原地附近）', same(t0.feet ?? [], after.feet ?? [], 1.2),
    `${JSON.stringify(after.feet)}`);

  await browser.close();
} catch (e) {
  console.log('FAIL 浏览器回归执行中断:', String(e?.message || e).slice(0, 300));
  console.log('  server log tail:', serverLog.slice(-400));
  failures += 1;

} finally {
  await browser?.close();
  stopServer();
}

if (pageErrors.length) { console.log('FAIL page errors:', pageErrors); failures++; }
console.log(failures === 0 ? 'PLAY_ESC_CAMERA PASS' : `PLAY_ESC_CAMERA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
