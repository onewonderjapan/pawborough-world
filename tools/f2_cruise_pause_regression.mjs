// F2-01 regression — the REAL button path, no synthetic state writes.
//
// Lead reproduction (final-lead-review-20260914 REVIEW.md F2-01): walk mode →
// P pause → click 路线巡游（物理链） reset to spawn and printed 巡游中, but the
// page stayed paused and the capsule hung at spawn height until P was pressed
// again. The fix: a cruise click clears the page pause and controller pause
// together, drops leftover key input, and announces a fresh run from the
// legal spawn.
//
// This script drives headless Chromium against the built preview (vite
// preview of dist/) using ONLY real UI interaction: button clicks and native
// keyboard events. It covers the three lead-required start paths:
//   A) paused start     — P pause → cruise click → must land+advance with NO
//                         further P press (the exact reported bug)
//   B) unpaused start   — cruise click while walking → reset to spawn and go
//   C) framing-mode start — cruise click from view mode → enters walk, lands,
//                         advances, counted as a reset
// It intentionally does NOT run the cruise to completion (23/23 long-run
// evidence already exists from the lead review); "advances along the physics
// chain without P" is the behavior under test.
//
// Run: node tools/f2_cruise_pause_regression.mjs [--port 5297] [--world laneb]
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const PORT = parseInt(arg('--port', '5297'), 10);
const WORLD = arg('--world', 'laneb');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, arg('--out', '../artifacts/fix-f2'));
const SHOTS = join(OUT, 'web');
await mkdir(SHOTS, { recursive: true });
const log = (s) => console.log(`[f2-01] ${s}`);

// spawn point from the dataset route (WorldLoader: entries.west, +1.0 m feet height)
const route = JSON.parse(await readFile(resolve(root, WORLD === 'laneb' ? 'world/laneb/route.json' : 'world/route.json'), 'utf8'));
const SPAWN = { x: route.entries.west[0], y: route.entries.west[1] + 1.0, z: route.entries.west[2] };

const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: 'pipe', detached: true,
  env: { ...process.env, EVIDENCE_DIR: SHOTS, EVIDENCE_PORTS: '528[45]|529[0-9]' },
});
const killServer = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } };
process.on('exit', killServer);
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
server.stderr.on('data', (d) => { serverOut += d; });
for (let i = 0; i < 60 && !serverOut.includes('Local:'); i++) await new Promise(r => setTimeout(r, 300));
if (!serverOut.includes('Local:')) { console.error(serverOut); killServer(); process.exit(1); }
log(`preview on ${PORT}, world=${WORLD}, spawn feet=(${SPAWN.x},${SPAWN.y},${SPAWN.z})`);

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, pass: Boolean(cond), detail: String(detail) });
  log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
}
const record = () => page.evaluate(() => JSON.parse(document.querySelector('#record').textContent));
const notice = () => page.evaluate(() => document.querySelector('#notice').textContent);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
// capture the current frame through the real evidence endpoint; returns saved jpg name
async function shot() {
  const before = new Set(await readdir(SHOTS).catch(() => []));
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(700);
  const fresh = (await readdir(SHOTS).catch(() => [])).filter(f => f.endsWith('.jpg') && !before.has(f));
  return fresh[0] ?? null;
}
// wait until predicate over record() holds; returns last record
async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  let rec = await record();
  while (Date.now() - t0 < timeoutMs) {
    rec = await record();
    if (pred(rec)) return rec;
    await page.waitForTimeout(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

let result = { ok: false };
try {
  await page.goto(`http://127.0.0.1:${PORT}/?world=${WORLD}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('完整世界已载入'), null, { timeout: 90000 });
  check('world ready', (await record()).ready === true);

  // ---- shared prologue: enter walk mode, land, walk a few meters east ----
  await page.click('#btn-walk');
  await page.waitForTimeout(1500);
  const landed = await waitFor(r => r.walking.capsuleFeet[1] < 0.3, 8000, 'initial landing');
  check('prologue: walk mode landed on ground', landed.mode === 'walk' && landed.walking.capsuleFeet[1] < 0.3, `feet=${landed.walking.capsuleFeet.map(v => +v.toFixed(2))}`);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const walked = await record();
  check('prologue: walked ~2m east of spawn', walked.walking.capsuleFeet[0] - SPAWN.x > 1.5, `x=${walked.walking.capsuleFeet[0].toFixed(2)} (spawn ${SPAWN.x})`);

  // ==== CASE A: paused start — the reported F2-01 bug path ====
  // W is held DOWN across the P press and the cruise click: proves residual
  // input is dropped and no further P is needed.
  await page.keyboard.down('KeyW');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  const paused = await record();
  check('A: P paused the page', paused.paused === true && paused.mode === 'walk');
  const beforePause = paused.walking.capsuleFeet;
  await page.waitForTimeout(700);
  const heldWhilePaused = await record();
  check('A: frozen while paused even with W held', dist2(heldWhilePaused.walking.capsuleFeet, beforePause) < 0.05, `drift=${dist2(heldWhilePaused.walking.capsuleFeet, beforePause).toFixed(3)}m`);

  await page.getByText('路线巡游（物理链）').click();
  await page.waitForTimeout(350);
  const justClicked = await record();
  check('A: page pause cleared by cruise click alone (no P pressed)', justClicked.paused === false, `paused=${justClicked.paused}`);
  check('A: notice announces fresh run from legal spawn', (await notice()).includes('从合法出生点'), await notice());
  check('A: capsule reset to spawn', dist2(justClicked.walking.capsuleFeet, [SPAWN.x, 0, SPAWN.z]) < 1.0, `feet=${justClicked.walking.capsuleFeet.map(v => +v.toFixed(2))}`);
  // NO KeyP from here on — the capsule must land and advance by itself
  const afterLand = await waitFor(r => r.paused === false && r.walking.capsuleFeet[1] < 0.3, 10000, 'landing after cruise click (no P)');
  check('A: landed from spawn height without P', afterLand.walking.capsuleFeet[1] < 0.3, `feetY=${afterLand.walking.capsuleFeet[1].toFixed(3)}`);
  const advA = await waitFor(r => r.paused === false && r.walking.capsuleFeet[0] - SPAWN.x > 2.0, 30000, '2m advance without P');
  const dxA = advA.walking.capsuleFeet[0] - SPAWN.x, dzA = advA.walking.capsuleFeet[2] - SPAWN.z;
  check('A: advanced ≥2m along route without P', dxA > 2.0, `dx=${dxA.toFixed(2)} dz=${dzA.toFixed(2)}`);
  check('A: motion follows route (eastward), not stale input', Math.abs(dzA) < dxA);
  await page.keyboard.up('KeyW');
  const shotA = await shot();
  check('A: cruise frame captured', shotA !== null, shotA);

  // ==== CASE B: unpaused start — cruise click while walking normally ====
  const beforeB = (await record()).walking.capsuleFeet;
  await page.getByText('路线巡游（物理链）').click();
  await page.waitForTimeout(350);
  const justB = await record();
  check('B: stayed unpaused', justB.paused === false && justB.mode === 'walk');
  check('B: reset back to spawn from mid-route', dist2(justB.walking.capsuleFeet, [SPAWN.x, 0, SPAWN.z]) < 1.0, `from x=${beforeB[0].toFixed(2)} to x=${justB.walking.capsuleFeet[0].toFixed(2)}`);
  const advB = await waitFor(r => r.paused === false && r.walking.capsuleFeet[1] < 0.3 && r.walking.capsuleFeet[0] - SPAWN.x > 2.0, 35000, 'case B 2m advance');
  check('B: new run advances (fresh CruiseDriver working)', advB.walking.capsuleFeet[0] - SPAWN.x > 2.0, `dx=${(advB.walking.capsuleFeet[0] - SPAWN.x).toFixed(2)}`);

  // ==== CASE C: framing-mode start — cruise click straight from view mode ====
  await page.click('#btn-walk'); // back to view mode
  await page.waitForTimeout(400);
  const inView = await record();
  check('C: back in view mode', inView.mode === 'view' && inView.paused === false);
  const resetsBeforeC = inView.walking.walkResets;
  await page.getByText('路线巡游（物理链）').click();
  await page.waitForTimeout(350);
  const justC = await record();
  check('C: cruise click entered walk mode unpaused', justC.mode === 'walk' && justC.paused === false);
  check('C: counted as walk-mode reset', justC.walking.walkResets === resetsBeforeC + 1, `${resetsBeforeC} -> ${justC.walking.walkResets}`);
  const advC = await waitFor(r => r.paused === false && r.walking.capsuleFeet[1] < 0.3 && r.walking.capsuleFeet[0] - SPAWN.x > 2.0, 35000, 'case C 2m advance');
  check('C: advanced from spawn without any P', advC.walking.capsuleFeet[0] - SPAWN.x > 2.0, `dx=${(advC.walking.capsuleFeet[0] - SPAWN.x).toFixed(2)}`);
  const shotC = await shot();
  check('C: cruise frame captured', shotC !== null, shotC);

  check('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  result = { ok: checks.every(c => c.pass), checks, consoleErrors, spawn, at: new Date().toISOString() };
} catch (e) {
  result = { ok: false, checks, consoleErrors, error: String(e).slice(0, 400), at: new Date().toISOString() };
  log(`ABORTED: ${result.error}`);
} finally {
  await browser.close();
  killServer();
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(join(OUT, `f2-01-cruise-pause-regression-${stamp}.json`), JSON.stringify({ what: 'F2-01 real-button-path regression (paused / unpaused / framing-mode cruise starts)', world: WORLD, port: PORT, verdict: result.ok ? 'PASS' : 'FAIL', ...result }, null, 2) + '\n');
log(result.ok ? 'F2-01 REGRESSION PASS' : 'F2-01 REGRESSION FAIL');
process.exit(result.ok ? 0 : 1);
