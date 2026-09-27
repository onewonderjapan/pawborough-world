// tools/portable/browser_check.mjs — 恢复后的真实浏览器证据：
// headless Chromium 冷加载 core 视图，等待 window.__firstLoadReady，
// canvas 回读像素判定非空白（lum std255 >= 2 且 dominantShare <= 0.95），
// 证据截图落盘。可独立运行，也被 restore.mjs 调用。
//
//   node tools/portable/browser_check.mjs --url http://127.0.0.1:5603/ \
//        --playwright-from <恢复目录>/scene-authoring/yuyuan-area --evidence-dir <目录>
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exists, nonClobberPath, parseArgs, writeJson } from './lib.mjs';

async function discoverChromiumBuilds() {
  const dir = path.join(os.homedir(), '.cache', 'ms-playwright');
  const entries = await fsp.readdir(dir).catch(() => []);
  const out = [];
  for (const e of entries.filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const exe = path.join(dir, e, 'chrome-linux', 'chrome');
    if (await exists(exe)) out.push(exe);
  }
  return out;
}

async function discoverDisplays() {
  const entries = await fsp.readdir('/tmp/.X11-unix').catch(() => []);
  return entries
    .filter((x) => /^X\d+$/.test(x))
    .map((x) => ':' + x.slice(1))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

const NON_BLANK = { stdMin: 2, dominantMax: 0.95 };
const READY_TIMEOUT_MS = 300000;

export async function runBrowserCheck({ url, playwrightFrom, evidenceDir, label = 'core-cold-load' }) {
  await fsp.mkdir(evidenceDir, { recursive: true });
  const pwIndex = path.join(playwrightFrom, 'node_modules', 'playwright', 'index.mjs');
  if (!(await exists(pwIndex))) throw new Error(`playwright not installed at ${pwIndex}`);
  const { chromium } = await import(pwIndex);

  // 启动策略（依次回退，全部失败才报错）：
  //   A. playwright 注册表默认浏览器，headless + swiftshader 软渲；
  //   B. 系统 Chrome（channel/executablePath），headless；
  //   C. ~/.cache/ms-playwright 里现成的 chromium 构建，headless；
  //   D. 有 X display 时（/tmp/.X11-unix），非 headless 用真机 GPU —— 软渲不可用的
  //      机器上这是更强的证据（真实 GPU 渲染，非 SwiftShader）。
  const swiftArgs = ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
  const attempts = [
    { name: 'playwright-default-headless', opts: { headless: true, args: swiftArgs } },
    { name: 'channel-chrome-headless', opts: { headless: true, channel: 'chrome', args: swiftArgs } },
    { name: 'system-chrome-headless', opts: { headless: true, executablePath: '/usr/bin/google-chrome', args: swiftArgs } },
  ];
  for (const d of await discoverChromiumBuilds()) {
    attempts.push({ name: `cache-headless:${path.basename(d)}`, opts: { headless: true, executablePath: d, args: swiftArgs } });
  }
  for (const d of await discoverDisplays()) {
    // 非 headless 用真机 GPU：显式带已发现的构建可执行文件（注册表构建可能缺失），
    // 再回退 playwright 自身默认。
    for (const exe of [...(await discoverChromiumBuilds()).slice(0, 2), undefined]) {
      attempts.push({
        name: `gpu-display${d}${exe ? ':' + path.basename(path.dirname(path.dirname(exe))) : ':default'}`, opts: {
          headless: false, args: ['--disable-dev-shm-usage', '--no-sandbox'],
          ...(exe ? { executablePath: exe } : {}),
          env: { ...process.env, DISPLAY: d },
        },
      });
    }
  }
  let browser = null, used = null, lastErr = null;
  for (const a of attempts) {
    try {
      const b = await chromium.launch(a.opts);
      // WebGL 能力预检：本机软渲不可用时会“启动成功但渲染失败”，这里立即换下一策略，
      // 避免在无渲染能力的浏览器上空等 ready 超时。
      const probePage = await b.newPage();
      const glOk = await probePage.evaluate(() => {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      }).catch(() => false);
      await probePage.close();
      if (!glOk) { await b.close().catch(() => {}); lastErr = new Error(`${a.name}: WebGL context unavailable`); continue; }
      browser = b;
      used = a.name;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!browser) throw new Error(`no browser launchable: ${lastErr?.message || lastErr}`);

  const entry = url.endsWith('/') ? url : url + '/';
  const result = { tool: 'tools/portable/browser_check.mjs', url: entry + '?zone=core&cam=oblique', browser: used, pass: false };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const t0 = Date.now();
    await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: READY_TIMEOUT_MS });
    result.readyMs = Date.now() - t0;
    result.loadTimes = await page.evaluate(() => window.__loadTimes ?? null);
    result.zonesLoaded = await page.evaluate(() => window.__zonesLoaded ?? null);
    // 非空白判定：同一 evaluate 内触发渲染 + drawImage 回读（R1-04 模式）
    result.frame = await page.evaluate(({ stdMin, dominantMax }) => {
      const src = document.querySelector('#app canvas');
      if (!src) return { blank: true, std255: -1, dominantShare: 1, reason: 'no canvas under #app' };
      const w = 160, h = 100;
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      const ctx = c2.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const lum = [];
      for (let i = 0; i < w * h; i++) lum.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
      const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
      const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
      const counts = {};
      for (const v of lum) { const k = Math.round(v); counts[k] = (counts[k] ?? 0) + 1; }
      const dom = Math.max(...Object.values(counts)) / lum.length;
      return {
        blank: std < stdMin || dom > dominantMax,
        std255: +std.toFixed(2), dominantShare: +dom.toFixed(3),
        rule: `std255 >= ${stdMin} AND dominantShare <= ${dominantMax}`,
      };
    }, NON_BLANK);
    const shot = await nonClobberPath(path.join(evidenceDir, `${label}.jpg`));
    await page.screenshot({ path: shot, quality: 70, type: 'jpeg' });
    result.screenshot = path.basename(shot);
    result.pass = result.frame.blank === false;
    await page.close();
  } catch (e) {
    // 失败也带上所用启动策略，便于定位是哪种渲染路径不行
    const err = new Error(`[${used}] ${e.message || e}`);
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
  const recPath = await nonClobberPath(path.join(evidenceDir, `${label}.json`));
  await writeJson(recPath, result);
  result.reportPath = recPath;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args['playwright-from'] || !args['evidence-dir']) {
    console.error('FAIL --url --playwright-from --evidence-dir required');
    process.exit(1);
  }
  const r = await runBrowserCheck({
    url: String(args.url),
    playwrightFrom: path.resolve(String(args['playwright-from'])),
    evidenceDir: path.resolve(String(args['evidence-dir'])),
  });
  console.log(`BROWSER_${r.pass ? 'PASS' : 'FAIL'} browser=${r.browser} readyMs=${r.readyMs} frame=${JSON.stringify(r.frame)}`);
  process.exit(r.pass ? 0 : 1);
}
