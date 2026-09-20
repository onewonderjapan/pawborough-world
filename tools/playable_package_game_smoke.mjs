// world-playable-night 20260920 — game smoke for the PORTABLE package (or any
// served base). Per the plan: real Chrome opens the homepage → each of the
// four start points reaches ready with its automatic route check passed and
// the explicit ?entry relocation recorded → back to the homepage → gallery;
// the two display budgets stay 694430 / 708066; and with WebGL disabled the
// game shows the actionable fatal panel while the homepage still works.
//
// Run: node tools/playable_package_game_smoke.mjs --url http://127.0.0.1:5411
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:5411');
const outPath = arg('out', 'artifacts/world-playable/package-run.json');
const EXPECT_BASE = 694430, EXPECT_ALLON = 708066;

const checks = [];
const check = (ok, label, detail = '') => {
  checks.push({ ok, label, detail: String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ` — ${detail}` : ''));
};

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

// wait for full load INCLUDING the automatic route check (honest ready gate).
// The fatal branch requires the panel to EXIST and be visible — a missing
// #fatal must time out, never pass silently.
async function loadGame(page, query, timeoutMs = 900000) {
  await page.goto(`${base}/fangbang.html?ds=fangbang-temple-v7${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const r = window.__fangbangRecord?.();
    if (r && r.ready && r.routeCheck) return true;
    if ((document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败')) return true;
    const f = document.querySelector('#fatal');
    return !!(f && !f.hidden);
  }, null, { timeout: timeoutMs, polling: 1000 });
    const state = await page.evaluate(() => {
    const r = window.__fangbangRecord ? window.__fangbangRecord() : null;
    const f = document.querySelector('#fatal');
    return { ready: r?.ready ?? false, route: r?.routeCheck?.pass ?? null, tris: r?.resources?.triangles ?? null,
      relocations: r?.walking?.session?.explicitRelocations ?? [],
      failed: (document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败'),
      fatal: f ? !f.hidden : false };
  });
  return state;
}

try {
  // ---- homepage first, then the four entries, then back home ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}/world-preview.html`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
    check(true, 'homepage opens from the package');
    const href = await page.getAttribute('#cta-explore', 'href');
    check(href.includes('entry=mainStreet'), 'homepage CTA carries the entry mapping', href);
    await page.close();
  }
  for (const id of ['mainStreet', 'laneA', 'laneB', 'templeFront']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 120)}`));
    const st = await loadGame(page, `&entry=${id}`);
    check(st.ready && !st.failed, `${id}: page ready`, `tris=${st.tris}`);
    check(st.route === true, `${id}: automatic route check PASS`);
    check(st.relocations.some((r) => r.anchorId === id && r.explicit === true),
      `${id}: explicit entry relocation recorded (not walk evidence)`, JSON.stringify(st.relocations.slice(0, 1)));
    check(st.tris === EXPECT_BASE, `${id}: default budget stays ${EXPECT_BASE}`, `got ${st.tris}`);
    if (id === 'mainStreet') {
      // 返回场景总览: real nav link, relative
      await page.click('#btn-overview');
      await page.waitForURL(/world-preview\.html/, { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
      check(true, '场景总览 returns to the homepage from the game');
      await page.click('a[href="#gallery"]');
      await page.waitForTimeout(400);
      const inView = await page.evaluate(() => {
        const g = document.querySelector('#gallery');
        return g && g.getBoundingClientRect().top < window.innerHeight;
      });
      check(inView, 'gallery section reachable from homepage');
    }
    if (problems.length) check(false, `${id}: no page errors`, problems.slice(0, 3).join(' | '));
    await page.close();
  }
  // ---- all-on configuration: ready + route + budget (once, dataset-level) ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const st = await loadGame(page, '&entry=mainStreet&skins=1&props=1');
    check(st.ready && st.route === true, 'all-on config ready + route PASS');
    check(st.tris === EXPECT_ALLON, `all-on budget stays ${EXPECT_ALLON}`, `got ${st.tris}`);
    await page.close();
  }
} catch (e) {
  check(false, 'smoke run completed', String(e?.message ?? e).slice(0, 300));
} finally {
  await browser.close();
}

// ---- no-WebGL environment: game fails with actionable panel, homepage works ----
{
  const noGl = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
      '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'],
  });
  try {
    const page = await noGl.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}/fangbang.html?ds=fangbang-temple-v7&entry=mainStreet`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#fatal:not([hidden])', { timeout: 30000 });
    const msg = await page.textContent('#fatal-msg');
    const homeHref = await page.getAttribute('#fatal a', 'href');
    check(!!msg && msg.length > 10, 'no-WebGL: fatal panel shows an explanation', msg);
    check(homeHref === 'world-preview.html', 'no-WebGL: way back to overview is relative', homeHref);
    check(await page.locator('#fatal-retry').isVisible(), 'no-WebGL: user-driven retry offered');
    await page.goto(`${base}/world-preview.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
    check(true, 'no-WebGL: homepage and gallery still usable');
    await page.close();
  } catch (e) {
    check(false, 'no-WebGL environment behavior', String(e?.message ?? e).slice(0, 200));
  } finally {
    await noGl.close();
  }
}

const failed = checks.filter((c) => !c.ok);
const out = {
  tool: 'tools/playable_package_game_smoke.mjs', base,
  env: { chrome: '/usr/bin/google-chrome', headless: true, swiftshader: true, at: new Date().toISOString() },
  budgets: { base: EXPECT_BASE, allOn: EXPECT_ALLON },
  pass: failed.length === 0, checks,
};
await mkdir(dirname(resolve(root, outPath)), { recursive: true });
await writeFile(resolve(root, outPath), JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`GAME_SMOKE_${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length} -> ${outPath}`);
process.exit(failed.length ? 1 : 0);
