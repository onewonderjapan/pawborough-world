// G6 交付包验证：把 out-goal-06 整包复制到全新目录，从新目录以包内启动器方式运行服务端，
// playwright 打开核心总览 + 逐一点击四个分区（≥3 要求），空白守卫 + 机位断言 + 截图。
// 证据写入 out-goal-06/verification/（package-checks.json + 截图）；有失败 exit 1。
// 用法：node scripts/verify-g6-package.mjs   （自行复制包/启停服务/清理临时目录）
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, process.env.PKG_DIR || 'out-goal-06');
const VERDIR = path.join(PKG, 'verification');
// 随机高位端口：不与官方 5480/5481 或遗留进程抢占（EADDRINUSE 会让 fetch 打到别人的服务上）
const PORT = process.env.VERIFY_PORT || String(15480 + Math.floor(Math.random() * 100));
const BASE = `http://127.0.0.1:${PORT}/`;

fs.mkdirSync(VERDIR, { recursive: true });

// 1) 整包复制到全新目录（模拟机主拿到包后的独立运行环境）
const tmp = fs.mkdtempSync('/tmp/pawborough-g6-run-');
console.log('复制整包到新目录', tmp, '端口', PORT);
fs.cpSync(PKG, tmp, { recursive: true, filter: (s) => !s.includes(`${path.sep}verification`) });
const copied = (function count(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? count(path.join(dir, e.name)) : 1; return n; })(tmp);

// 2) 从新目录启动服务（等价 start.sh：node scripts/server.mjs，默认 OUT_DIR=out）
const srv = spawn('node', ['scripts/server.mjs'], { cwd: tmp, env: { ...process.env, PORT }, stdio: 'pipe' });
let srvLog = '', srvDead = null;
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
srv.on('error', (e) => { srvDead = String(e); });
srv.on('exit', (c) => { if (c !== 0 && c !== null) srvDead = `exit code ${c}: ${srvLog.slice(-300)}`; });
const waitListen = async () => {
  for (let i = 0; i < 60; i++) {
    if (srvDead) return false;
    try {
      const r = await fetch(BASE);
      if (r.ok) {
        const t = await r.text();
        if (t.includes('scene-areas.glb')) return true; // 确认应答的是本包页面
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};
const up = await waitListen();

let pass = 0, fail = 0;
const checks = {};
const check = (name, cond, detail = '') => {
  checks[name] = { ok: !!cond, detail: String(detail) };
  if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail); }
};
check('server-up-from-new-dir', up && !srvDead, (srvDead || srvLog).slice(-200));

// 3) 新目录发出的资源确为新目录文件：/out/tour.json 可取且与包内一致
let tourOk = false, tourCount = 0;
if (up) {
  const r = await fetch(BASE + 'out/tour.json');
  const t = await r.json();
  const local = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'tour.json'), 'utf8'));
  tourOk = r.ok && JSON.stringify(t) === JSON.stringify(local);
  tourCount = Object.keys(t).length;
}
check('serves-new-dir-tour', tourOk, `tourStops=${tourCount}`);

const CHROME = (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath());
const browserLogs = [];
const browser = up ? await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}) : null;
const shots = [];
if (browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('console', (m) => { if (m.type() === 'error') browserLogs.push('[console.error] ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => browserLogs.push('[pageerror] ' + String(e).slice(0, 400)));
  page.on('requestfailed', (r) => { if (!r.url().includes('favicon')) browserLogs.push('[reqfail] ' + r.url()); });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  } catch (e) {
    browserLogs.forEach(l => console.log('BROWSER', l));
    throw e;
  }
  await page.waitForFunction(`document.querySelectorAll('[data-tour]').length === ${tourCount}`, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  check('core-overview-loads', true);

  // 核心总览：非空白 + 分区/导览按钮齐备
  const st0 = await page.evaluate(() => window.__pixelStats());
  check('core-not-blank', st0.std >= 2.0 && st0.uniq >= 12, `std=${st0.std.toFixed(1)} uniq=${st0.uniq}`);
  check('zone-buttons-present', await page.locator('button[data-zone]').count() >= 6);
  check('tour-buttons-6', await page.locator('#tourbtns button[data-tour]').count() === tourCount, `want ${tourCount}`);
  await page.screenshot({ path: path.join(VERDIR, '01-core-overview.png') });
  shots.push('01-core-overview.png');

  // 逐分区：点击真实按钮 → 机位目标变化 + 非空白 + 截图
  const cam0 = await page.evaluate(() => window.__cam());
  for (const zone of ['garden', 'temple', 'bazaar', 'pond']) {
    await page.click(`button[data-zone="${zone}"]`);
    await page.waitForTimeout(1200);
    const cam = await page.evaluate(() => window.__cam());
    const st = await page.evaluate(() => window.__pixelStats());
    const moved = Math.hypot(cam.t[0] - cam0.t[0], cam.t[2] - cam0.t[2]) > 5;
    const notBlank = st.std >= 2.0 && st.uniq >= 12;
    check(`zone:${zone}`, moved && notBlank, `moved=${moved} std=${st.std.toFixed(1)} uniq=${st.uniq}`);
    const file = `02-zone-${zone}.png`;
    await page.screenshot({ path: path.join(VERDIR, file) });
    shots.push(file);
  }
  await browser.close();
} else {
  check('browser-launched', false, 'server 未启动，跳过 UI 检查');
}

// 4) 收尾：停服务、清理临时目录（临时目录为本轮自建 scratch，非工作区资产）
srv.kill('SIGTERM');
await new Promise(r => setTimeout(r, 400));
fs.rmSync(tmp, { recursive: true, force: true });

fs.writeFileSync(path.join(VERDIR, 'package-checks.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), package: path.basename(PKG), port: PORT,
  newDirRun: true, filesCopiedToNewDir: copied, cleanedUp: true,
  summary: { pass, fail }, checks, screenshots: shots,
  serverLog: srvLog.slice(-500), serverDead: srvDead, browserErrors: browserLogs,
}, null, 1));
if (fail) { console.error(`G6 包验证失败: ${fail}`); process.exit(1); }
console.log(`package ok: ${pass} pass / ${fail} fail（新目录 ${path.basename(tmp)} 实跑已清理）`);
