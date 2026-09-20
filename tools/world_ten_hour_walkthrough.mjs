// world-ten-hour round 1 — task B PLAYER walkthrough (real browsing, not the
// existing 26/26 smoke): homepage → entry select → start explore → walk →
// P-pause → resume → framing toggle → back to overview → history.back →
// invalid ?entry fallback → 390 / 1920 layouts → gallery images.
// Every stage screenshots the real page; findings feed the ≤3 player issues.
//
// Run: node tools/world_ten_hour_walkthrough.mjs --base http://127.0.0.1:5420
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5420');
const outDir = resolve(root, arg('out', 'artifacts/world-ten-hour/round-001/walkthrough'));
await mkdir(outDir, { recursive: true });

const shots = [];
const events = [];
const note = (kind, label, detail = '') => { events.push({ t: new Date().toISOString(), kind, label, detail: String(detail).slice(0, 500) }); console.log(`${kind} ${label}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name) => {
  const p = resolve(outDir, name);
  await page.screenshot({ path: p });
  shots.push(name);
  note('shot', name);
};
const errorsOf = (page) => {
  page.on('pageerror', (e) => note('pageerror', String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') note('console-error', m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => note('requestfailed', r.url().slice(0, 200)));
};
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const gameRecord = (page) => page.evaluate(() => {
  const r = window.__fangbangRecord ? window.__fangbangRecord() : null;
  const f = document.querySelector('#fatal');
  return {
    ready: r?.ready ?? null, mode: r?.mode ?? null, paused: r?.paused ?? null,
    tris: r?.resources?.triangles ?? null,
    relocations: r?.walking?.session?.explicitRelocations ?? [],
    hud: document.querySelector('#hud-state')?.textContent ?? null,
    hudHidden: document.querySelector('#hud')?.hidden ?? null,
    introHidden: document.querySelector('#intro')?.hidden ?? null,
    startDisabled: document.querySelector('#btn-start')?.disabled ?? null,
    startText: document.querySelector('#btn-start')?.textContent ?? null,
    stage: document.querySelector('#stage')?.textContent ?? null,
    notice: document.querySelector('#notice')?.textContent ?? null,
    fatalVisible: f ? !f.hidden : false,
    pointerLocked: document.pointerLockElement != null,
  };
});

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const waitReady = (page, timeoutMs = 600000) => page.waitForFunction(() => {
  const r = window.__fangbangRecord?.();
  if (r && r.ready && r.routeCheck) return true;
  if ((document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败')) return true;
  const f = document.querySelector('#fatal');
  return !!(f && !f.hidden);
}, null, { timeout: timeoutMs, polling: 1000 });

const report = { base, startedAt: new Date().toISOString(), stages: [] };
try {
  // ---- 1) homepage 1280x900, select 主街, click CTA like a player ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  errorsOf(page);
  await page.goto(`${base}/world-preview.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
  await shot(page, '01-home-1280.png');
  note('info', 'homepage overflowX', await overflowX(page));
  const entryLabels = await page.locator('#entries button').allTextContents();
  note('info', 'entry buttons', JSON.stringify(entryLabels));
  await page.locator('#entries button', { hasText: '主街' }).first().click();
  const cta = await page.getAttribute('#cta-explore', 'href');
  note('info', 'CTA after selecting 主街', cta);
  // gallery reachable from homepage (player path: 先看场景)
  const galleryImgs = await page.evaluate(() =>
    [...document.querySelectorAll('#gallery img')].map((i) => ({ ok: i.complete && i.naturalWidth > 50, src: i.src.split('/').pop() })));
  note('info', 'gallery images', JSON.stringify(galleryImgs));
  report.stages.push({ stage: 'homepage', entryLabels, cta, galleryImgs, overflowX: await overflowX(page) });

  await page.click('#cta-explore');
  await page.waitForURL(/fangbang\.html/, { timeout: 30000 });
  note('info', 'navigated to game', page.url());

  // ---- 2) intro screen → start → walk; pause P; resume; WASD pose; framing toggle ----
  await waitReady(page);
  let st = await gameRecord(page);
  note('info', 'game ready', JSON.stringify(st));
  await shot(page, '02-game-intro.png');
  report.stages.push({ stage: 'game-ready', ...st });

  if (!st.fatalVisible && st.ready) {
    await page.click('#btn-start');
    await page.waitForTimeout(1500);
    st = await gameRecord(page);
    note('info', 'after 开始探索', JSON.stringify(st));
    await shot(page, '03-walking.png');
    // hold W for a real walk step (pose must change), then pause with P
    const feet0 = await page.evaluate(() => window.__fangbangRecord?.()?.walking?.capsuleFeet ?? null);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    const feet1 = await page.evaluate(() => window.__fangbangRecord?.()?.walking?.capsuleFeet ?? null);
    note('info', 'feet before/after W', JSON.stringify({ feet0, feet1 }));
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    st = await gameRecord(page);
    note('info', 'after P', JSON.stringify(st));
    await shot(page, '04-paused.png');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    st = await gameRecord(page);
    note('info', 'after P resume', JSON.stringify(st));
    // framing toggle: V exits walk into framing (HUD instruction), the header
    // button — now labeled 行走 — goes back (pointer lock is off in view mode)
    const feetBeforeV = await page.evaluate(() => window.__fangbangRecord?.()?.walking?.capsuleFeet ?? null);
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(400);
    st = await gameRecord(page);
    note('info', 'framing on (V)', JSON.stringify(st));
    await shot(page, '05-framing.png');
    await page.click('#btn-framing');
    await page.waitForTimeout(400);
    st = await gameRecord(page);
    note('info', 'walk again (header button)', JSON.stringify(st));
    await shot(page, '06-back-to-walk.png');
    // regression UP-B1 (world-ten-hour 20260921): the framing→walk round trip
    // must KEEP the pose (notice 继续上一次的位置行走, feet unchanged) instead
    // of re-spawning at the entry anchor
    const feetBack = st && (await page.evaluate(() => window.__fangbangRecord?.()?.walking?.capsuleFeet ?? null));
    const d = feetBeforeV && feetBack
      ? Math.hypot(feetBeforeV[0] - feetBack[0], feetBeforeV[2] - feetBack[2]) : null;
    note(st?.notice?.includes('继续上一次') && d !== null && d < 0.5 ? 'PASS' : 'FAIL',
      'UP-B1: framing→walk keeps the pose', JSON.stringify({ feetBeforeV, feetBack, horizDistM: d && +d.toFixed(3), notice: st?.notice }));
    note(st?.hud?.includes('Esc 释放鼠标') ? 'PASS' : 'FAIL',
      'UP-B2: walk HUD names Esc to release the mouse', st?.hud ?? '');
    // exit walk again so the pointer lock is off for the overview round-trip
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(300);
    report.stages.push({ stage: 'in-game-walk', feet0, feet1, ...st });
  }

  // ---- 3) 场景总览 return → homepage; then history.back → fresh game intro ----
  await page.click('#btn-overview');
  await page.waitForURL(/world-preview\.html/, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
  await shot(page, '07-back-home.png');
  note('info', 'returned to homepage', page.url());
  await page.goBack();
  await page.waitForURL(/fangbang\.html/, { timeout: 30000 });
  await page.waitForTimeout(2000);
  st = await gameRecord(page);
  note('info', 'history.back → game intro state', JSON.stringify(st));
  await shot(page, '08-back-into-game.png');
  report.stages.push({ stage: 'roundtrip', url: page.url(), ...st });
  await page.close();

  // ---- 4) invalid ?entry → safe default ----
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  errorsOf(page2);
  await page2.goto(`${base}/fangbang.html?ds=fangbang-temple-v7&entry=bogus-anchor`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitReady(page2);
  st = await gameRecord(page2);
  note('info', 'invalid entry load', JSON.stringify(st));
  await shot(page2, '09-invalid-entry.png');
  report.stages.push({ stage: 'invalid-entry', ...st });
  await page2.close();

  // ---- 5) 390 narrow: homepage + game early intro layout ----
  const ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p390 = await ctx390.newPage();
  errorsOf(p390);
  await p390.goto(`${base}/world-preview.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await p390.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
  await p390.screenshot({ path: resolve(outDir, '10-home-390.png'), fullPage: true });
  shots.push('10-home-390.png');
  note('info', '390 homepage overflowX', await overflowX(p390));
  const touchNote = await p390.evaluate(() => document.querySelector('[data-touch-note],#touch-note,.touch-note')?.textContent ?? null);
  note('info', 'touch note text', touchNote ?? '(none)');
  await p390.goto(`${base}/fangbang.html?ds=fangbang-temple-v7&entry=mainStreet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p390.waitForTimeout(5000);
  await p390.screenshot({ path: resolve(outDir, '11-game-early-390.png') });
  shots.push('11-game-early-390.png');
  note('info', '390 game overflowX', await overflowX(p390));
  report.stages.push({ stage: 'narrow-390', homeOverflowX: await overflowX(p390), touchNote });
  await ctx390.close();

  // ---- 6) 1920 wide homepage ----
  const p1920 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await p1920.goto(`${base}/world-preview.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await p1920.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 20000 });
  await p1920.screenshot({ path: resolve(outDir, '12-home-1920.png') });
  shots.push('12-home-1920.png');
  note('info', '1920 overflowX', await overflowX(p1920));
  report.stages.push({ stage: 'wide-1920', overflowX: await overflowX(p1920) });
  await p1920.close();
} finally {
  report.finishedAt = new Date().toISOString();
  report.shots = shots;
  report.events = events;
  await writeFile(resolve(outDir, 'walkthrough.json'), JSON.stringify(report, null, 1) + '\n');
  await browser.close();
}
console.log(`WALKTHROUGH DONE — ${shots.length} shots, ${events.filter((e) => e.kind.startsWith('pageerror') || e.kind.startsWith('requestfailed')).length} hard errors`);
