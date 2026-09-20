// world-ten-hour round 1 (PLAN task E) — error / recovery probe on the REAL
// page: resource failure (fatal with reason + NO infinite refetch), single
// retry via reload, mid-load overview return, fast entry switching, blur key
// clearing and long-pause dt behavior, no-WebGL fallback. Synthetic events are
// labeled as such in the report; production code swallows nothing.
// Run: node tools/error_recovery_probe.mjs --base http://127.0.0.1:5420
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5420');
const outDir = resolve(root, arg('out', 'artifacts/world-ten-hour/round-001/error-recovery'));
await mkdir(outDir, { recursive: true });

const checks = [];
const check = (ok, label, detail = '') => { checks.push({ ok, label, detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
const shots = [];
const GAME = `${base}/fangbang.html?ds=fangbang-temple-v7`;
const waitReady = (page, t = 600000) => page.waitForFunction(() => {
  const r = window.__fangbangRecord?.();
  if (r?.ready) return true;
  return (document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败')
    || !(document.querySelector('#fatal')?.hidden ?? true);
}, null, { timeout: t, polling: 250 });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
try {
  // ---- 1) resource failure mid-load: fatal with reason, NO refetch storm ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
    let plainV1 = 0;
    await page.route('**/building/plain-v1/model.glb', (route) => {
      plainV1++;
      if (plainV1 <= 2) return route.abort('failed');   // fail the FIRST placement attempts
      return route.continue();
    });
    await page.goto(`${GAME}&entry=mainStreet`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({
      fatal: !document.querySelector('#fatal')?.hidden,
      title: document.querySelector('#fatal-title')?.textContent,
      msg: document.querySelector('#fatal-msg')?.textContent?.slice(0, 140),
      detail: document.querySelector('#fatal-detail')?.textContent?.slice(0, 160),
      stage: document.querySelector('#stage')?.textContent,
      canvases: document.querySelectorAll('#app canvas').length,
    }));
    check(st.fatal, 'resource failure shows the fatal panel', st.title ?? '');
    check((st.msg + st.detail).includes('plain-v1'), 'fatal names the failed resource', st.msg);
    check(plainV1 === 1, 'exactly ONE attempt per placement — no infinite background refetch', `attempts=${plainV1}`);
    check(st.canvases <= 1, 'no duplicate canvases', `got ${st.canvases}`);
    check(errors.length === 0, 'no uncaught pageerrors during failure path', JSON.stringify(errors));
    await page.screenshot({ path: resolve(outDir, '01-resource-failure-fatal.png') });
    shots.push('01-resource-failure-fatal.png');

    // ---- 2) single user retry succeeds (failure removed for the reload) ----
    await page.unroute('**/building/plain-v1/model.glb');
    await page.click('#fatal-retry');
    await waitReady(page);
    const st2 = await page.evaluate(() => ({
      ready: window.__fangbangRecord?.()?.ready ?? false,
      canvases: document.querySelectorAll('#app canvas').length,
      fatal: !document.querySelector('#fatal')?.hidden,
    }));
    check(st2.ready && !st2.fatal, 'retry (location.reload) reaches ready', JSON.stringify(st2));
    check(st2.canvases === 1, 'retry leaves exactly one canvas', `got ${st2.canvases}`);
    await page.screenshot({ path: resolve(outDir, '02-after-retry-ready.png') });
    shots.push('02-after-retry-ready.png');
    await ctx.close();
  }

  // ---- 3) mid-load 返回场景总览 + 4) fast entry switching (same tab) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
    await page.route('**/world/fangbang-temple-v5/street-reviewed-lanes.glb', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));   // hold the big street GLB
      return route.continue();
    });
    await page.goto(`${GAME}&entry=laneA`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);                   // load is now mid-flight
    await page.click('#btn-overview');                 // leave mid-load like a player
    await page.waitForURL(/world-preview\.html/, { timeout: 15000 });
    await page.waitForTimeout(1200);
    check(errors.length === 0, 'mid-load overview return: no error storm on the abandoned page', JSON.stringify(errors.slice(0, 3)));
    // fast switch: straight into a different entry while the previous navigation
    // was cut — the fresh document must reach ready normally
    await page.goto(`${GAME}&entry=laneB`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.goto(`${GAME}&entry=templeFront`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const st = await page.evaluate(() => ({
      ready: window.__fangbangRecord?.()?.ready ?? false,
      anchor: window.__fangbangRecord?.()?.walking?.session?.explicitRelocations?.[0]?.anchorId ?? null,
      canvases: document.querySelectorAll('#app canvas').length,
      fatal: !document.querySelector('#fatal')?.hidden,
    }));
    check(st.ready && st.anchor === 'templeFront' && !st.fatal, 'fast entry switching lands on the last choice', JSON.stringify(st));
    check(st.canvases === 1, 'single canvas after fast switching');
    check(errors.length === 0, 'no pageerrors across fast switching', JSON.stringify(errors.slice(0, 3)));
    await page.screenshot({ path: resolve(outDir, '03-fast-switch-templeFront.png') });
    shots.push('03-fast-switch-templeFront.png');
    await ctx.close();
  }

  // ---- 5) blur clears keys (synthetic event, labeled) + 6) long pause dt ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${GAME}&entry=mainStreet`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.click('#btn-start');
    await page.waitForTimeout(800);
    const feet0 = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyW');
    // synthetic blur (labeled): the production window-blur listener must pause + clear keys
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(300);
    const paused = await page.evaluate(() => window.__fangbangRecord().paused);
    check(paused === true, 'blur while walking pauses the session (synthetic event)');
    const feetAtPause = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
    // hold a key AFTER pause, then resume: cleared input must not move the capsule
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(200);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyP');   // resume
    await page.waitForTimeout(200);
    const feetResume = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
    // long pause: dt must not accumulate — pause 3 s, resume, no jump
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(3000);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(120);
    const feetAfterLongPause = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
    await page.waitForTimeout(900);
    const feetSettled = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    check(dist(feetAtPause, feetResume) < 0.05, 'no residual movement after resume (keys were cleared)',
      `d=${dist(feetAtPause, feetResume).toFixed(3)}m (walk displacement from before the pause: ${dist(feet0, feetAtPause).toFixed(3)}m)`);
    check(dist(feetResume, feetAfterLongPause) < 0.05, '3s pause does not accumulate dt into a jump',
      `d=${dist(feetResume, feetAfterLongPause).toFixed(3)}m`);
    check(dist(feetAfterLongPause, feetSettled) < 0.05, 'capsule stays put after long-pause resume',
      `d=${dist(feetAfterLongPause, feetSettled).toFixed(3)}m`);
    await page.screenshot({ path: resolve(outDir, '04-after-blur-pause.png') });
    shots.push('04-after-blur-pause.png');
    await ctx.close();
  }

  // ---- 7) no-WebGL fallback (fresh browser with 3D disabled) ----
  {
    const nobrowser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome', headless: true,
      args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'],
    });
    const ctx = await nobrowser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${GAME}&entry=mainStreet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('#fatal')?.hidden, null, { timeout: 30000 });
    const st = await page.evaluate(() => ({
      title: document.querySelector('#fatal-title')?.textContent,
      msg: document.querySelector('#fatal-msg')?.textContent?.slice(0, 100),
      hasRetry: !!document.querySelector('#fatal-retry'),
      hasReturn: !!document.querySelector('#fatal a'),
      canvases: document.querySelectorAll('#app canvas').length,
    }));
    check(st.hasRetry && st.hasReturn && st.canvases === 0, 'no-WebGL: actionable fatal (retry + overview return), no canvas', JSON.stringify(st));
    await page.screenshot({ path: resolve(outDir, '05-no-webgl-fatal.png') });
    shots.push('05-no-webgl-fatal.png');
    await ctx.close();
    await nobrowser.close();
  }
} finally {
  await writeFile(resolve(outDir, 'error-recovery.json'), JSON.stringify({ checks, shots, at: new Date().toISOString() }, null, 1) + '\n');
  await browser.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`ERROR/RECOVERY PROBE: ${checks.length - failed.length}/${checks.length} pass, ${failed.length} fail`);
process.exit(failed.length ? 1 : 0);
