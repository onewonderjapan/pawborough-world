// Player-experience batch (20260920) engineering self-check — headless
// Chrome + repo Playwright, run by the worker (NOT owner play, NOT the lead's
// machine check; environment is recorded in every report).
//   node tools/player_experience_check.mjs before   # baseline defect evidence
//   node tools/player_experience_check.mjs after    # full regression pass
// Captures into artifacts/player-experience/<mode>/:
//   - drawingBuffer vs container CSS size (1280x720 AND 390x740 narrow)
//   - first-screen UI, A-lane street-look-in view, walk HUD (real WebGL,
//     blank-guarded via canvas readback std-dev)
//   - after only: v5 base + skins&props states, safe-anchor walk-in/return
//     through the REAL page controller (keyboard W), V-switch pose retention
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] ?? 'after';
if (!['before', 'after'].includes(MODE)) { console.error('usage: node tools/player_experience_check.mjs before|after'); process.exit(2); }
const OUT = resolve(root, 'artifacts/player-experience', MODE);
await mkdir(OUT, { recursive: true });

const report = {
  mode: MODE, tool: 'tools/player_experience_check.mjs',
  env: { chrome: '/usr/bin/google-chrome', headless: true, swiftshader: true,
    startedAt: new Date().toISOString() },
  checks: [], pass: true,
};
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  report.checks.push({ name, pass: !!cond, detail: String(detail).slice(0, 400) });
  if (!cond) { failures += 1; report.pass = false; }
};

// ---- dev server (owned by this run) -----------------------------------------
const PORT = 5360;
let port = null, log = '';
let proc = null;
for (const p of [PORT, 5361, 5364, 5365]) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, env: { ...process.env, EVIDENCE_PORTS: '536[01]' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`http://127.0.0.1:${p}/index.html`)).ok; } catch {}
  }
  if (up) { port = p; break; }
  try { proc.kill('SIGTERM'); } catch {}
}
if (!port) { console.error(`no free server port\n${log.slice(-1200)}`); process.exit(1); }
process.on('exit', () => { try { proc.kill('SIGTERM'); } catch {} });
const BASE = `http://127.0.0.1:${port}`;
report.env.server = BASE;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

// Canvas readback guard: a REAL WebGL frame has luminance spread; a dead
// context renders flat. MUST run in the same JS task as the render that
// produced the frame (no preserveDrawingBuffer: the buffer is cleared once
// presented). Playwright only serializes the MAIN evaluate function, so the
// guard body is injected into a Function built per call site.
const GUARD_SRC = `
  const src = document.querySelector('#app canvas');
  if (!src) return { blank: true, std255: -1 };
  const w = 160, h = 100;
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  const ctx = c2.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let sum = 0, sum2 = 0, n = 0;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114);
    sum += lum; sum2 += lum * lum; n++;
    const key = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const dominant = Math.max(...counts.values()) / n;
  return { blank: std < 6, std255: +std.toFixed(2), dominantShare: +dominant.toFixed(3) };
`;
// prep: page-side statements to run FIRST in the same task (render trigger)
const runGuard = (pageCtx, prep = '') => pageCtx.evaluate(new Function(`${prep} const guard = () => { ${GUARD_SRC} }; return guard();`));
const measureCanvas = () => {
  const c = document.querySelector('#app canvas');
  const app = document.querySelector('#app');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return {
    cssSize: [Math.round(r.width), Math.round(r.height)],
    appSize: [Math.round(app.clientWidth), Math.round(app.clientHeight)],
    drawingBuffer: [c.width, c.height],
    dpr: window.devicePixelRatio,
  };
};

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));

// ---- load v5 (the candidate entry) -------------------------------------------
await page.goto(`${BASE}/fangbang.html?ds=fangbang-temple-v5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => typeof window.__fangbangRecord === 'function', null, { timeout: 240000 });
const rec0 = await page.evaluate(() => window.__fangbangRecord());
report.load = { triangles: rec0.resources?.triangles, routeCheck: rec0.routeCheck?.pass, framebuffer: rec0.framebuffer };
check('v5 page loaded + automatic route check passed', rec0.ready && rec0.routeCheck?.pass === true,
  `tris=${rec0.resources?.triangles} route=${rec0.routeCheck?.pass}`);

// ---- #1 drawingBuffer vs CSS (1280x720) --------------------------------------
// click renders synchronously (setView -> render), so click + readback share
// one JS task — the drawing buffer is still valid
const g1 = await runGuard(page, `const b = [...document.querySelectorAll('button[data-view]')].find((x) => x.dataset.view === 'lane-a-street-look-in'); if (b) b.click();`);
const m1280 = await page.evaluate(measureCanvas);
report.canvas1280 = m1280;
check('canvas drawingBuffer matches container CSS size at 1280x720 (±2px)',
  m1280.drawingBuffer[0] >= m1280.cssSize[0] - 2 && m1280.drawingBuffer[0] <= m1280.cssSize[0] * 1.5 + 2
  && m1280.drawingBuffer[1] >= m1280.cssSize[1] - 2 && m1280.drawingBuffer[1] <= m1280.cssSize[1] * 1.5 + 2,
  `css=${m1280.cssSize} buffer=${m1280.drawingBuffer}`);
check('buffer NOT the unfixed 300x150 default', m1280.drawingBuffer[0] !== 300 || m1280.drawingBuffer[1] !== 150);
check('lane-a-street-look-in renders a real WebGL frame', !g1.blank, `std=${g1.std255}`);
await page.screenshot({ path: resolve(OUT, `first-screen-1280.png`) });
report.shots = [`first-screen-1280.png`];

// narrow viewport: no horizontal overflow
await page.setViewportSize({ width: 390, height: 740 });
await page.waitForTimeout(700);
const mNarrow = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  const app = document.querySelector('#app');
  const r = c.getBoundingClientRect();
  return {
    cssSize: [Math.round(r.width), Math.round(r.height)],
    drawingBuffer: [c.width, c.height],
    scrollW: document.scrollingElement.scrollWidth, innerW: window.innerWidth,
    appSize: [app.clientWidth, app.clientHeight],
  };
});
report.canvasNarrow = mNarrow;
check('narrow viewport 390px: no horizontal overflow', mNarrow.scrollW <= mNarrow.innerW, `scrollW=${mNarrow.scrollW} innerW=${mNarrow.innerW}`);
check('narrow viewport drawingBuffer matches CSS', mNarrow.drawingBuffer[0] >= mNarrow.cssSize[0] - 2 && mNarrow.drawingBuffer[1] >= mNarrow.cssSize[1] - 2,
  `css=${mNarrow.cssSize} buffer=${mNarrow.drawingBuffer}`);
await page.screenshot({ path: resolve(OUT, 'narrow-390.png') });

await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(500);

if (MODE === 'after') {
  // ---- #3 player UI: engineering hidden by default --------------------------
  const ui = await page.evaluate(() => {
    const review = document.querySelector('#review');
    const visibleText = document.body.innerText;
    const jargon = ['GLB', 'frontline', 'automatic', '5296', '5297', '巡游', '灰模', '占位'].filter((t) => visibleText.includes(t));
    return {
      reviewOpen: review ? review.open : null,
      dataViewButtons: document.querySelectorAll('button[data-view]').length,
      jargonVisible: jargon,
      introVisible: !!document.querySelector('#intro') && getComputedStyle(document.querySelector('#intro')).display !== 'none',
      startBtn: !!([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '开始探索')),
      locationBtns: [...document.querySelectorAll('#intro [data-location]')].map((b) => b.textContent.trim()),
    };
  });
  report.ui = ui;
  check('review panel exists and is closed by default', ui.reviewOpen === false);
  check('19 engineering camera buttons live inside the review panel', ui.dataViewButtons === 19, `got ${ui.dataViewButtons}`);
  check('no engineering jargon in the default player-facing text', ui.jargonVisible.length === 0, ui.jargonVisible.join(','));
  check('intro entry screen with 开始探索 + location chips (主街/庙前/A弄/B弄)',
    ui.introVisible && ui.startBtn && ui.locationBtns.length >= 4 && ui.locationBtns.includes('主街'), ui.locationBtns.join('/'));
  // help dialog opens from the real header button and closes again
  await page.evaluate(() => document.querySelector('#btn-help')?.click());
  await page.waitForTimeout(200);
  const helpOpen = await page.evaluate(() => !document.querySelector('#help').hidden);
  await page.evaluate(() => document.querySelector('#help-close')?.click());
  await page.waitForTimeout(200);
  const helpClosed = await page.evaluate(() => document.querySelector('#help').hidden);
  check('操作说明 dialog opens and closes', helpOpen && helpClosed, `open=${helpOpen} closedAfter=${helpClosed}`);

  // Real-keyboard walk helper: hold a key through the page input chain, poll
  // the live feet position, release early on target / stall. NO hooks, NO
  // teleports — the same W/S chain a player uses. (Headless has no usable
  // mouse-look, so a return leg is S = walking back along the arrival
  // heading — real input, honestly labeled.)
  const feet = () => page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
  const walkByKey = async (key, { until, maxMs, label }) => {
    const t0 = Date.now();
    const start0 = await feet();
    let prev = start0, prevT = Date.now(), stalled = false;
    await page.keyboard.down(key);
    let cur = prev;
    while (Date.now() - t0 < maxMs) {
      await page.waitForTimeout(400);
      cur = await feet();
      if (until(cur)) break;
      if (Math.hypot(cur[0] - prev[0], cur[2] - prev[2]) < 0.08) {   // <0.2 m/s over 0.4 s
        if (Date.now() - prevT > 1600) { stalled = true; break; }
      } else prevT = Date.now();
      prev = cur;
    }
    await page.keyboard.up(key);
    await page.waitForTimeout(300);
    const end = await feet();
    return { start: start0, end, ms: Date.now() - t0, stalled, label };
  };

  // ---- #4 walk anchors through the REAL page controller ----------------------
  // frame A-lane street-look-in, then start walking from it
  await page.evaluate(() => { const b = [...document.querySelectorAll('button[data-view]')].find((x) => x.dataset.view === 'lane-a-street-look-in'); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '开始探索')?.click());
  await page.waitForTimeout(900);
  const walkA1 = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { mode: r.mode, feet: r.walking.capsuleFeet, paused: r.paused };
  });
  report.walkA_start = walkA1;
  const laneAAnchor = [43.096, -10.697];
  check('walk from A-lane framing spawns NEAR THE LANE (not the east end)',
    walkA1.mode === 'walk' && Math.hypot(walkA1.feet[0] - laneAAnchor[0], walkA1.feet[2] - laneAAnchor[1]) < 2.5,
    `feet=${walkA1.feet?.map((v) => +v.toFixed(2))}`);

  // A lane: portal mid-plane z=-16.375 (lanes-v2 config), 8 m body behind it.
  const aIn = await walkByKey('KeyW', { until: (f) => f[2] <= -20, maxMs: 16000, label: 'A-in' });
  report.walkA_in = aIn;
  check('keyboard W walks from the A anchor THROUGH the portal (z=-16.4) into the 8m lane body',
    aIn.end[2] <= -18 && aIn.end[1] > -0.05 && !aIn.stalled,
    `z ${walkA1.feet[2].toFixed(2)} -> ${aIn.end[2].toFixed(2)} y=${aIn.end[1].toFixed(2)} stalled=${aIn.stalled}`);
  await page.screenshot({ path: resolve(OUT, 'walk-a-in-lane.png') });

  // return leg: S = real-keyboard walk back along the heading, out to the street
  const aBack = await walkByKey('KeyS', { until: (f) => f[2] >= -12, maxMs: 16000, label: 'A-back' });
  report.walkA_back = aBack;
  check('keyboard S returns from inside lane A back out through the portal to the street',
    aBack.end[2] >= -12 && aBack.end[1] > -0.05,
    `z ${aIn.end[2].toFixed(2)} -> ${aBack.end[2].toFixed(2)} (S-reverse, no mouse-look in headless)`);

  // V switches to view, then the REAL header button re-enters walk: SAME position (no reset)
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(400);
  const backBtn = await page.evaluate(() => {
    const b = document.querySelector('#btn-framing');
    const t = b?.textContent?.trim();
    b?.click();
    return t;
  });
  await page.waitForTimeout(900);
  const walkA3 = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
  report.walkA_afterV = walkA3;
  check('V -> view -> real 行走 button re-enters walk and preserves the street position (no reset)',
    backBtn === '行走' && Math.hypot(walkA3[0] - aBack.end[0], walkA3[2] - aBack.end[2]) < 0.6,
    `btn=${backBtn} ${aBack.end.map((v) => +v.toFixed(2))} -> ${walkA3.map((v) => +v.toFixed(2))}`);

  // explicit location select: B lane (explicit relocation = teleport, never
  // walk evidence), then a real-keyboard walk THROUGH the old B portal
  // (s=0 plane at (57.418,14.2485), inward unit (-0.4631,0.8863)) into the
  // 10 m v5 lane body, and back out.
  const PORTAL_B = [57.418, 14.2485], IN_B = [-0.4631, 0.8863];
  const sAlong = (f) => (f[0] - PORTAL_B[0]) * IN_B[0] + (f[2] - PORTAL_B[1]) * IN_B[1];
  await page.evaluate(() => {
    const chip = document.querySelector('#locations-walk [data-location="laneB"]')
      ?? document.querySelector('#intro [data-location="laneB"]');
    if (chip) chip.click(); else window.__fangbangRelocate?.('laneB');
  });
  await page.waitForTimeout(600);
  const relocated = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { feet: r.walking.capsuleFeet, relocations: r.walking.session?.explicitRelocations ?? [] };
  });
  report.walkB_relocate = relocated;
  const laneBAnchor = [60.086, 9.144];
  check('explicit B-lane chip teleports to the B anchor and is recorded as an explicit relocation',
    Math.hypot(relocated.feet[0] - laneBAnchor[0], relocated.feet[2] - laneBAnchor[1]) < 2
    && relocated.relocations.length >= 1 && relocated.relocations.every((r) => r.explicit === true),
    `feet=${relocated.feet.map((v) => +v.toFixed(2))} relocations=${JSON.stringify(relocated.relocations)}`);

  const bIn = await walkByKey('KeyW', { until: (f) => sAlong(f) >= 5, maxMs: 18000, label: 'B-in' });
  report.walkB_in = bIn;
  check('keyboard W walks from the B anchor THROUGH the old portal (z≈14.25) into the v5 lane body (s>=5m)',
    sAlong(bIn.end) >= 3 && bIn.end[1] > -0.05 && !bIn.stalled,
    `s ${sAlong(bIn.start).toFixed(2)} -> ${sAlong(bIn.end).toFixed(2)} feet=${bIn.end.map((v) => +v.toFixed(2))} stalled=${bIn.stalled}`);
  await page.screenshot({ path: resolve(OUT, 'walk-b-in-lane.png') });

  const bBack = await walkByKey('KeyS', { until: (f) => sAlong(f) <= -1.5, maxMs: 18000, label: 'B-back' });
  report.walkB_back = bBack;
  check('keyboard S returns from inside lane B back OUT through the portal to the street side (s<=-1.5m)',
    sAlong(bBack.end) <= -1.2 && bBack.end[1] > -0.05,
    `s ${sAlong(bIn.end).toFixed(2)} -> ${sAlong(bBack.end).toFixed(2)} feet=${bBack.end.map((v) => +v.toFixed(2))}`);

  // pause semantics: P pauses + notice; P resumes; feet unchanged
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  const p1 = await page.evaluate(() => { const r = window.__fangbangRecord(); return { paused: r.paused, feet: r.walking.capsuleFeet }; });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  const p2 = await page.evaluate(() => window.__fangbangRecord().walking.capsuleFeet);
  report.pauseCheck = { p1, p2 };
  check('P pauses (W ignored) and P resumes without moving', p1.paused === true
    && Math.hypot(p2[0] - p1.feet[0], p2[2] - p1.feet[2]) < 0.05,
    `paused feet=${p1.feet.map((v)=>+v.toFixed(2))} resumed feet=${p2.map((v)=>+v.toFixed(2))}`);

  // walk HUD screenshot (real WebGL behind): one synchronous render, then
  // read back in the same task
  const gW = await runGuard(page, 'window.__fangbangRenderSync && window.__fangbangRenderSync();');
  check('walk mode renders a real WebGL frame', !gW.blank, `std=${gW.std255}`);
  await page.screenshot({ path: resolve(OUT, 'walk-hud.png') });

  // review panel open state screenshot (engineering view intact)
  await page.evaluate(() => { const d = document.querySelector('#review'); if (d) d.open = true; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, 'review-panel-open.png') });
  await page.evaluate(() => { const d = document.querySelector('#review'); if (d) d.open = false; });

  // ---- second state: skins + props ------------------------------------------
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page2.on('pageerror', (e) => console.log('PAGEERROR2', String(e).slice(0, 300)));
  await page2.goto(`${BASE}/fangbang.html?ds=fangbang-temple-v5&skins=1&props=1`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page2.waitForFunction(() => typeof window.__fangbangRecord === 'function', null, { timeout: 240000 });
  const rec2 = await page2.evaluate(() => window.__fangbangRecord());
  const m2 = await page2.evaluate(measureCanvas);
  report.skinsProps = { triangles: rec2.resources?.triangles, skins: rec2.skins?.count, props: rec2.propsStats?.count, canvas: m2, routeCheck: rec2.routeCheck?.pass };
  check('skins+props state loads with correct buffer size', rec2.ready && rec2.skins?.count > 0 && rec2.propsStats?.count > 0
    && m2.drawingBuffer[0] >= m2.cssSize[0] - 2, `skins=${rec2.skins?.count} props=${rec2.propsStats?.count} buffer=${m2.drawingBuffer}`);
  const g2 = await runGuard(page2, 'window.__fangbangRenderSync && window.__fangbangRenderSync();');
  check('skins+props renders a real WebGL frame', !g2.blank, `std=${g2.std255}`);
  await page2.screenshot({ path: resolve(OUT, 'v5-skins-props.png') });
  await page2.close();
} else {
  // before-mode: document the defect numbers plainly
  const before = await page.evaluate(() => ({
    stats: document.querySelector('#stats')?.textContent?.slice(0, 120),
    headerButtons: [...document.querySelectorAll('#views button')].length,
  }));
  report.beforeUi = before;
  await page.evaluate(() => { const b = [...document.querySelectorAll('button[data-view]')].find((x) => x.dataset.view === 'aerial-overview'); if (b) b.click(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, 'engineering-bar-before.png') });
}

await page.close();
await browser.close();

report.env.finishedAt = new Date().toISOString();
await writeFile(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(failures === 0 ? `PLAYER_EXPERIENCE_${MODE.toUpperCase()} PASS` : `PLAYER_EXPERIENCE_${MODE.toUpperCase()} FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
