// tools/portable/browser_check.mjs — 恢复后的真实浏览器证据（R4 重写版）：
//   - 显式 --browser-executable 参数（S1 实测可用：chromium-1234/chrome-linux/chrome
//     + --enable-unsafe-swiftshader --disable-dev-shm-usage）；
//   - 每个候选先做 WebGL 能力预检，没有渲染能力的立即换下一个，不盲等；
//   - 全程捕获 console / pageerror / requestfailed / HTTP>=400（favicon 404 除外）；
//   - 就绪 = window.__firstLoadReady 且 default 策略分区全部出现在 __zonesLoaded
//     且无模块/资产失败——不只读一个 true；
//   - 非空白判定：同一次 evaluate 内等两帧 requestAnimationFrame（真实渲染触发）
//     后 drawImage 回读 160x100 像素，规则固定 std255>=2 且 dominantShare<=0.95，
//     不放宽阈值；PNG 截图与像素数据（RGBA base64）落盘；
//   - GPU 类型从页面实际 WebGL renderer 读取（UNMASKED_RENDERER_WEBGL）落盘，
//     读不到则 rendererVerified:false，不做任何推断；
//   - 成功与失败都写 JSON 报告（非覆盖命名）；失败信息携带最小具体诊断。
// 不扫描/不启动任何用户 X display；不做非 headless 尝试。
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, nonClobberPath, parseArgs, writeJson } from './lib.mjs';

const NON_BLANK = { stdMin: 2, dominantMax: 0.95 };
const SWIFT_ARGS = ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];

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

export async function runBrowserCheck({ url, playwrightFrom, evidenceDir, label = 'core-cold-load', browserExecutable = null, readyTimeoutMs = 180000 }) {
  await fsp.mkdir(evidenceDir, { recursive: true });
  const pwIndex = path.join(playwrightFrom, 'node_modules', 'playwright', 'index.mjs');
  if (!(await exists(pwIndex))) throw new Error(`playwright not installed at ${pwIndex}`);
  const { chromium } = await import(pwIndex);

  const attempts = [];
  // headless + 继承的 DISPLAY 会让 Chrome GPU 进程去连外部 X 的 GLX 而失败
  //（本机实例：DISPLAY=:10.0 → BindToCurrentSequence failed → WebGL null，
  //  清掉 DISPLAY 后同一浏览器 SwiftShader 正常）。headless 一律不继承 DISPLAY。
  const headlessEnv = { ...process.env };
  delete headlessEnv.DISPLAY;
  if (browserExecutable) {
    attempts.push({ name: `explicit:${path.basename(browserExecutable)}`, opts: { headless: true, executablePath: browserExecutable, args: SWIFT_ARGS, env: headlessEnv } });
  }
  attempts.push({ name: 'playwright-default-headless', opts: { headless: true, args: SWIFT_ARGS, env: headlessEnv } });
  attempts.push({ name: 'channel-chrome-headless', opts: { headless: true, channel: 'chrome', args: SWIFT_ARGS, env: headlessEnv } });
  for (const exe of await discoverChromiumBuilds()) {
    attempts.push({ name: `cache-headless:${path.basename(path.dirname(path.dirname(exe)))}`, opts: { headless: true, executablePath: exe, args: SWIFT_ARGS, env: headlessEnv } });
  }

  const result = {
    tool: 'tools/portable/browser_check.mjs',
    url: (url.endsWith('/') ? url : url + '/') + '?zone=core&cam=oblique',
    browserExecutable, readyTimeoutMs,
    pass: false,
    diagnostics: { consoleTail: [], pageErrors: [], requestFailed: [], httpErrors: [], benignIgnored: [] },
  };
  const push = (arr, cap, item) => { if (arr.length < cap) arr.push(item); };

  const writeReport = async () => {
    const p = await nonClobberPath(path.join(evidenceDir, `${label}.json`));
    await writeJson(p, result);
    result.reportPath = p;
    return p;
  };

  let browser = null, used = null, launchErr = null;
  for (const a of attempts) {
    try {
      const b = await chromium.launch(a.opts);
      // WebGL 能力预检：启动成功不代表能渲染（软渲不可用时页面必然超时），
      // 这里 3 秒内判定，无渲染能力立即换下一策略。
      const probe = await b.newPage();
      const glOk = await probe.evaluate(() => !!(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'))).catch(() => false);
      await probe.close();
      if (!glOk) { await b.close().catch(() => {}); launchErr = `${a.name}: webgl context unavailable`; continue; }
      browser = b; used = a.name;
      break;
    } catch (e) { launchErr = `${a.name}: ${e.message?.split('\n')[0] || e}`; }
  }
  if (!browser) {
    result.error = `no webgl-capable browser: ${launchErr}`;
    const p = await writeReport();
    throw new Error(`${result.error} (report: ${p})`);
  }
  result.browser = used;

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (m.type() === 'error') push(result.diagnostics.consoleTail, 60, m.text().slice(0, 300)); });
    page.on('pageerror', (e) => push(result.diagnostics.pageErrors, 30, String(e).slice(0, 400)));
    page.on('requestfailed', (r) => push(result.diagnostics.requestFailed, 40, { url: r.url().slice(-140), error: r.failure()?.errorText || 'failed' }));
    page.on('response', (r) => {
      if (r.status() < 400) return;
      const u = r.url();
      if (u.endsWith('/favicon.ico')) { push(result.diagnostics.benignIgnored, 5, `favicon ${r.status()}`); return; }
      push(result.diagnostics.httpErrors, 40, { url: u.slice(-140), status: r.status() });
    });

    const t0 = Date.now();
    await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 有界等待一次（不盲重试）；期间持续取页面状态，超时给出最小具体诊断
    let ready = false, lastState = null;
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      ready = await page.evaluate(() => window.__firstLoadReady === true).catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 2000));
      lastState = await page.evaluate(() => ({
        zones: window.__zonesLoaded ?? null,
        loadmsg: (document.getElementById('loadmsg') || {}).textContent ?? null,
      })).catch(() => null);
    }
    result.readyMs = ready ? Date.now() - t0 : null;
    result.lastPageState = lastState;
    result.zonesLoaded = await page.evaluate(() => window.__zonesLoaded ?? null).catch(() => null);
    result.loadTimes = await page.evaluate(() => window.__loadTimes ?? null).catch(() => null);

    // 分区完成核验：default 策略分区必须全部加载
    // __zonesLoaded 的键可能带分件后缀（'garden#1'），按基础 id 比较
    const manifest = await fetch((url.endsWith('/') ? url : url + '/') + 'out/zones-manifest.json').then((r) => r.json());
    const loadedBase = new Set((result.zonesLoaded || []).map((z) => z.split('#')[0]));
    result.expectedZones = manifest.zones.filter((z) => (z.loadPolicy || 'default') === 'default').map((z) => z.id)
      .filter((v, i, a) => a.indexOf(v) === i);
    result.zonesMissing = result.expectedZones.filter((z) => !loadedBase.has(z));

    // GPU 类型：从页面实际 WebGL 读 renderer（不做 DISPLAY 等推断）
    result.webgl = await page.evaluate(() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
        if (!gl) return null;
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        const out = { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : null };
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return out;
      } catch { return null; }
    }).catch(() => null);
    result.rendererVerified = !!(result.webgl && result.webgl.renderer);

    // 非空白：同一次 evaluate 内等两帧 RAF（真实渲染触发）后回读像素
    // （浏览器上下文没有 Buffer，像素数组在 Node 侧再转 base64）
    const frameRaw = await page.evaluate(async ({ stdMin, dominantMax }) => {
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const src = document.querySelector('#app canvas');
      if (!src) return { blank: true, std255: -1, dominantShare: 1, reason: 'no canvas under #app' };
      const w = 160, h = 100;
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
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
        rgba: Array.from(d),
        rule: `std255 >= ${stdMin} AND dominantShare <= ${dominantMax}`,
      };
    }, NON_BLANK);
    const { rgba, ...frame } = frameRaw;
    result.frame = frame;
    result.frameRgbaBase64 = Buffer.from(new Uint8Array(rgba)).toString('base64');

    const shot = await nonClobberPath(path.join(evidenceDir, `${label}.png`));
    await page.screenshot({ path: shot, type: 'png' });
    result.screenshot = path.basename(shot);
    await page.close();

    // 通过条件：ready + 分区齐 + 无模块/资产失败 + 非空白（阈值不放宽）
    result.failures = [];
    if (!ready) result.failures.push('firstLoadReady not reached');
    if (result.zonesMissing.length) result.failures.push(`zones not loaded: ${result.zonesMissing.join(',')}`);
    if (result.diagnostics.pageErrors.length) result.failures.push(`pageErrors: ${result.diagnostics.pageErrors.slice(0, 3).join(' | ')}`);
    if (result.diagnostics.httpErrors.length) result.failures.push(`httpErrors: ${JSON.stringify(result.diagnostics.httpErrors.slice(0, 3))}`);
    if (result.diagnostics.requestFailed.length) result.failures.push(`requestFailed: ${JSON.stringify(result.diagnostics.requestFailed.slice(0, 3))}`);
    if (result.frame.blank) result.failures.push(`blank frame ${JSON.stringify({ std255: result.frame.std255, dominantShare: result.frame.dominantShare })}`);
    result.pass = result.failures.length === 0;
    await writeReport();
    if (!result.pass) {
      throw new Error(`[${used}] ${result.failures[0]} (+${result.failures.length - 1} more) — full report: ${result.reportPath}`);
    }
  } catch (e) {
    result.error = `[${used}] ${e.message || e}`;
    const p = await writeReport(); // 失败也完整写报告
    throw new Error(`${result.error} (report: ${p})`);
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args['playwright-from'] || !args['evidence-dir']) {
    console.error('FAIL --url --playwright-from --evidence-dir [--browser-executable <path>] required');
    process.exit(1);
  }
  const r = await runBrowserCheck({
    url: String(args.url),
    playwrightFrom: path.resolve(String(args['playwright-from'])),
    evidenceDir: path.resolve(String(args['evidence-dir'])),
    browserExecutable: args['browser-executable'] ? path.resolve(String(args['browser-executable'])) : null,
    readyTimeoutMs: args['ready-timeout-ms'] ? Number(args['ready-timeout-ms']) : 180000,
  });
  console.log(`BROWSER_${r.pass ? 'PASS' : 'FAIL'} browser=${r.browser} readyMs=${r.readyMs} renderer=${JSON.stringify(r.webgl?.renderer ?? null)} frame=${JSON.stringify({ blank: r.frame.blank, std255: r.frame.std255, dominantShare: r.frame.dominantShare })}`);
  process.exit(r.pass ? 0 : 1);
}
