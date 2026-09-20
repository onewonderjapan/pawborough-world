// world-ten-hour round 2 (PLAN task F) — long-run stability driver.
// Drives the REAL page through the REAL input chain only: Playwright keyboard
// (WASD/P) + pointer-locked mouse deltas for steering (exactly what a player's
// mouse produces through the page's own mousemove handler). Never touches
// controller state, never writes positions — the only capsible truth is
// record().walking.capsuleFeet. World-facing ops are real UI (P, V, #btn-walk,
// #fatal-retry) or labeled synthetic events (window blur) as in round 1's
// error probe.
//
// Per segment (default 120s) it persists RAW evidence:
//   - trajectory samples every ~2s: capsuleFeet, mode/paused, resources
//     (triangles/unique geoms/mats/texs), render stats, JS heap
//   - the complete requestAnimationFrame gap list for the segment (raw pairs),
//     plus max gap with timestamp+phase (long stalls are never hidden by P95)
//   - heap after an explicit gc() when the browser was launched with
//     --js-flags=--expose-gc (post-GC plateau per segment = leak observation;
//     transient spikes before GC are recorded too, never treated as leaks)
//   - ops events (pause/resume, view switches, blur cycles, steering stalls,
//     waypoint hits), screenshots every 5 min, os.loadavg() interference note
//
// SwiftShader software rendering is the machine baseline — numbers are
// software-baseline numbers and say so everywhere.
//
// Run: node tools/longrun_driver.mjs --entry mainStreet --config default \
//        --minutes 35 --track mainAB --label s1 --out <dir>
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const base = arg('base', 'http://127.0.0.1:5420');
const entry = arg('entry', 'mainStreet');                    // mainStreet|laneA|laneB|templeFront
const config = arg('config', 'default');                     // default|allOn
const minutes = +arg('minutes', '35');
const segmentS = +arg('segment', '120');
const trackName = arg('track', 'mainAB');
const label = arg('label', 'longrun');
const outDir = resolve(root, arg('out', `artifacts/world-ten-hour/round-002/longrun/${label}`));
const endOps = (arg('ops', 'pv,blur') + '').split(',').filter(Boolean); // ops interleaved during route walking
const opsEveryS = +arg('ops-every', '300');                  // pv/blur cycle period during walking
const useGc = has('gc');
const qs = config === 'allOn' ? '&skins=1&props=1' : '';
const gameUrl = `${base}/fangbang.html?ds=fangbang-temple-v7&entry=${entry}${qs}`;

await mkdir(resolve(outDir, 'segments'), { recursive: true });
await mkdir(resolve(outDir, 'shots'), { recursive: true });

// ---- route tracks (world data is read-only; read-only use) ----------------
const route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v7/route.json'), 'utf8'));
function nearestMainIdx(p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < route.mainStreet.length; i++) {
    const d = Math.hypot(route.mainStreet[i][0] - p[0], route.mainStreet[i][2] - p[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function buildTrack(name, startPos) {
  // startPos = the capsule feet AFTER 开始探索 — the walk spawn is the walk
  // session's validated safe point (NOT the route start), so the track always
  // begins at the street point nearest the real spawn.
  const ms = route.mainStreet;
  const startIdx = nearestMainIdx(startPos ?? ms[0]);
  const detourAt = {
    [nearestMainIdx(route.laneAExcursion[0])]: route.laneAExcursion,
    [nearestMainIdx(route.laneBExcursion[0])]: route.laneBExcursion,
  };
  const pts = [];
  const pushDetour = (i) => {
    const exc = detourAt[i];
    for (const p of exc) pts.push({ x: p[0], z: p[2], label: `detour@ms${i}-${pts.length}` });
    for (let j = exc.length - 2; j >= 0; j--) pts.push({ x: exc[j][0], z: exc[j][2], label: `detourBack@ms${i}-${pts.length}` });
  };
  if (name === 'mainAB') {
    // west along the street (with A/B out-and-back detours) to the temple
    // stair foot, then back east — the honest continuous 主街+A/B load
    for (let i = startIdx; i < ms.length; i++) {
      if (detourAt[i] && i !== startIdx) pushDetour(i);
      pts.push({ x: ms[i][0], z: ms[i][2], label: i === ms.length - 1 ? 'ms-end' : `ms-${i}` });
    }
    for (let i = ms.length - 2; i >= startIdx; i--) pts.push({ x: ms[i][0], z: ms[i][2], label: `back-${i}` });
    return pts;
  }
  if (name === 'laneALoop') {
    // spawn near laneA: the excursion first, then west to the terminus
    for (const p of route.laneAExcursion) pts.push({ x: p[0], z: p[2], label: `detourA-${pts.length}` });
    for (let j = route.laneAExcursion.length - 2; j >= 0; j--) {
      const p = route.laneAExcursion[j];
      pts.push({ x: p[0], z: p[2], label: `detourAback-${pts.length}` });
    }
    for (let i = startIdx; i < ms.length; i++) pts.push({ x: ms[i][0], z: ms[i][2], label: i === ms.length - 1 ? 'ms-end' : `ms-${i}` });
    return pts;
  }
  if (name === 'templeLoop') {
    // spawn at templeFront: short east stroll + return — walking is context
    // here, P/V transitions are the payload
    const pts2 = [];
    for (let i = Math.max(0, startIdx - 25); i <= startIdx; i++) pts2.push({ x: ms[i][0], z: ms[i][2], label: `tloop-${i}` });
    return pts2;
  }
  throw new Error(`unknown track ${name}`);
}

// ---- harness ---------------------------------------------------------------
const events = [];
const note = (kind, detail = '') => {
  const e = { t: Date.now(), kind, detail: String(detail).slice(0, 400) };
  events.push(e);
  console.log(`[${label}] ${kind} ${e.detail}`);
};
const anomalies = [];
const anomaly = (kind, detail) => { anomalies.push({ t: Date.now(), kind, detail: String(detail).slice(0, 400) }); note(`ANOMALY:${kind}`, detail); };

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: useGc
    ? ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--js-flags=--expose-gc']
    : ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => anomaly('pageerror', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') note('console-error', m.text().slice(0, 200)); });

// frame-gap sampler installed before any page script: raw rAF gaps, capped
// buffer flushed per segment by the driver (splice is atomic vs the page).
await page.addInitScript(`
  window.__frames = { n: 0, last: null, buf: [], g250: 0, g1000: 0, g5000: 0, max: 0, maxAt: 0 };
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((t) => {
    const s = window.__frames;
    s.n++;
    if (s.last !== null) {
      const gap = t - s.last;
      s.buf.push(t, gap);
      if (s.buf.length > 24000) s.buf.splice(0, s.buf.length - 12000);
      if (gap > 250) { s.g250++; if (gap > 1000) { s.g1000++; if (gap > 5000) s.g5000++; } }
      if (gap > s.max) { s.max = gap; s.maxAt = t; }
    }
    s.last = t;
    cb(t);
  });
`);

const withTimeout = async (fn, ms, what) => {
  const t0 = Date.now();
  let r;
  try { r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`driver-timeout ${what} after ${ms}ms`)), ms))]); }
  catch (e) {
    if (String(e).startsWith('Error: driver-timeout')) anomaly('mainThreadBlocked', `${what}: ${e}`);
    else throw e;
    return null;
  }
  const took = Date.now() - t0;
  if (took > 3000) note('slowDriverCall', `${what} took ${took}ms`);
  return r;
};

const rec = () => page.evaluate(() => {
  const r = window.__fangbangRecord ? window.__fangbangRecord() : null;
  const mem = performance.memory ?? null;
  const f = document.querySelector('#fatal');
  return r ? {
    ready: r.ready, mode: r.mode, paused: r.paused,
    feet: r.walking?.capsuleFeet ?? null, pose: r.walking?.session?.pose ?? null,
    heading: r.walking?.headingRad ?? null,
    res: r.resources ?? null, render: r.render ?? null,
    hud: document.querySelector('#hud-state')?.textContent ?? null,
    fatal: f ? !f.hidden : false, fatalMsg: f && !f.hidden ? (document.querySelector('#fatal-msg')?.textContent ?? '').slice(0, 120) : null,
    heapUsed: mem ? mem.usedJSHeapSize : null, heapTotal: mem ? mem.totalJSHeapSize : null,
  } : { ready: false, fatal: f ? !f.hidden : false };
});

const waitReady = (timeoutMs = 300000) => page.waitForFunction(() => {
  // honest gate: ready AND the startup routeCheck sweep finished — the check
  // drives the MAIN capsule synchronously, so walking before it ends fights it
  if (window.__fangbangRecord?.()?.ready && window.__fangbangRecord().routeCheck) return true;
  if ((document.querySelector('#stage')?.textContent ?? '').startsWith('载入失败')) return true;
  const f = document.querySelector('#fatal');
  return !!(f && !f.hidden);
}, null, { timeout: timeoutMs, polling: 500 });

// ---- steering: real mouse deltas while pointer-locked ----------------------
const steerState = { wpIdx: 0, wpHits: 0, meters: 0, lastFeet: null, stallS: 0, lastMoveT: Date.now(), walkingT: 0 };
let track = [];
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const KEY_SENS = 0.0023; // page's mousemove multiplier

async function steerTick(keysDown) {
  if (!track.length || steerState.wpIdx >= track.length) return;
  if (steerState.unstickUntil && Date.now() < steerState.unstickUntil) return; // straight walk-out phase
  const r = await rec();
  if (!r || !r.ready || r.mode !== 'walk' || r.paused || !r.feet) {
    if (!steerState.lastSkip || Date.now() - steerState.lastSkip > 15000) {
      steerState.lastSkip = Date.now();
      note('steerSkip', `ready=${r?.ready} mode=${r?.mode} paused=${r?.paused} feet=${JSON.stringify(r?.feet)?.slice(0, 60)}`);
    }
    return;
  }
  const [fx, , fz] = r.feet;
  let wp = track[steerState.wpIdx];
  let dist = Math.hypot(wp.x - fx, wp.z - fz);
  // skip degenerate/too-close waypoints (spawn may sit on wp 0)
  while (dist < 1.5 && steerState.wpIdx < track.length - 1) {
    steerState.wpHits++;
    note('waypoint', `${wp.label} dist=${dist.toFixed(1)}`);
    steerState.wpIdx++;
    wp = track[steerState.wpIdx];
    dist = Math.hypot(wp.x - fx, wp.z - fz);
  }
  // honest terminus: the capsule cannot climb the 0.17m platform riser, so
  // "pressed against the stair foot" IS arrival (same rule as routeCheck)
  if (wp.label === 'ms-end' && (dist < 4 || steerState.stallS > 2)) {
    steerState.wpHits++;
    note('terminus', `stair foot reached (dist=${dist.toFixed(1)}) — switching to the return leg`);
    steerState.wpIdx++;
    steerState.stallS = 0;
    return;
  }
  const poseYaw = r.heading; // live aim (record diagnostics), not the event-time session snapshot
  if (poseYaw !== null && Number.isFinite(poseYaw)) {
    const desired = Math.atan2(-(wp.x - fx), -(wp.z - fz));
    const dyaw = norm(desired - poseYaw);
    if (Math.abs(dyaw) > 0.02) {
      // synthetic mousemove batches (test-env injection, labeled): the page's
      // own document mousemove handler applies movementX*0.0023 to the aim —
      // the same math a physical mouse under pointer lock produces
      const px = Math.max(-400, Math.min(400, -dyaw / KEY_SENS));
      const steps = 8, per = px / steps;
      await page.evaluate(({ per, steps }) => {
        for (let i = 0; i < steps; i++) document.dispatchEvent(new MouseEvent('mousemove', { movementX: per, movementY: 0 }));
      }, { per, steps });
    }
  }
  if (dist >= 1.5 && !keysDown.w) { await page.keyboard.down('KeyW'); keysDown.w = true; }
  // stall watch: held W but not moving
  const now = Date.now();
  if (steerState.lastFeet) {
    const moved = Math.hypot(fx - steerState.lastFeet[0], fz - steerState.lastFeet[1]);
    steerState.meters += moved;
    if (moved < 0.02) {
      steerState.stallS += (now - steerState.lastMoveT) / 1000;
      if (steerState.stallS > 8 && steerState.stallS - (steerState.lastStallLogged ?? 0) > 8) {
        steerState.lastStallLogged = steerState.stallS;
        anomaly('walkStall', `held-W but still ${steerState.stallS.toFixed(0)}s at [${fx.toFixed(1)},${fz.toFixed(1)}] near ${wp.label}`);
        // unstick like a player: turn ~180° and walk straight briefly
        const turn = Math.PI + (Math.random() - 0.5) * 0.6;
        const px = -turn / KEY_SENS, steps = 8, per = px / steps;
        await page.evaluate(({ per, steps }) => {
          for (let i = 0; i < steps; i++) document.dispatchEvent(new MouseEvent('mousemove', { movementX: per, movementY: 0 }));
        }, { per, steps });
        steerState.unstickUntil = now + 2200;
        steerState.stallS = 0;
        steerState.lastStallLogged = 0;
      }
    } else { steerState.stallS = 0; steerState.lastStallLogged = 0; }
  }
  steerState.lastFeet = [fx, fz];
  steerState.lastMoveT = now;
}

// ---- interleaved ops -------------------------------------------------------
let opCounts = { pause: 0, viewSwitch: 0, blur: 0, entrySwitch: 0, fatalPlanned: 0 };
async function doPvCycle() {
  const r = await rec();
  if (!r?.ready || r.mode !== 'walk') return;
  await page.keyboard.press('KeyP');            // pause
  await page.waitForTimeout(1500);
  opCounts.pause++;
  await page.keyboard.press('KeyP');            // resume
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyV');            // exit to view (V; releases pointer lock)
  await page.waitForTimeout(1500);
  opCounts.viewSwitch++;
  // 行走模式 lives inside the (default-closed) 审查工具 panel — open it like a
  // player, then click the button for real
  const reviewOpen = await page.evaluate(() => document.querySelector('#review')?.open ?? false);
  if (!reviewOpen) { await page.click('#review summary', { timeout: 15000 }); await page.waitForTimeout(400); }
  await page.click('#btn-walk', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const after = await rec();
  if (after.mode !== 'walk') anomaly('pvCycleDidNotReturn', `mode=${after.mode}`);
}
async function doBlurCycle() {
  // labeled synthetic: production window-blur listener must pause + clear keys
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(1200);
  const r = await rec();
  if (!r?.paused) anomaly('blurDidNotPause', `paused=${r?.paused}`);
  opCounts.blur++;
  await page.keyboard.press('KeyP');            // resume like a player
  await page.waitForTimeout(500);
  const after = await rec();
  if (after.paused) anomaly('resumeAfterBlurFailed', 'still paused');
}
async function doFailRecoveryCycle() {
  // test-env-only injection: fail a FATAL resource mid-run, then recover via
  // the page's own single retry (location.reload)
  await page.route('**/building/plain-v1/model.glb', (rt) => rt.abort('failed'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const f = document.querySelector('#fatal'); return f && !f.hidden; }, null, { timeout: 90000, polling: 500 });
  const st = await rec();
  if (!st.fatal) { anomaly('failRecoveryNoFatal', JSON.stringify(st).slice(0, 200)); await page.unroute('**/building/plain-v1/model.glb'); return; }
  opCounts.fatalPlanned++;
  await page.screenshot({ path: resolve(outDir, 'shots/fatal-midrun.png') });
  await page.unroute('**/building/plain-v1/model.glb');
  await page.click('#fatal-retry');
  await waitReady();
  const after = await rec();
  if (!after.ready) anomaly('failRecoveryNotReady', JSON.stringify(after).slice(0, 200));
  else note('failRecovered', 'ready after single retry');
  // walk session restarts at the ENTRY anchor after reload — rejoin the track
  // at the waypoint nearest the new spawn (honest: a reload is a walk reset)
  await page.click('#btn-start');
  await page.waitForTimeout(1000);
  const f = (await rec()).feet;
  if (f && track.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < track.length; i++) {
      const d = Math.hypot(track[i].x - f[0], track[i].z - f[2]);
      if (d < bd) { bd = d; bi = i; }
    }
    steerState.wpIdx = bi;
    note('failRecoveryRejoin', `respawn feet=${JSON.stringify(f)} -> wp ${bi} (${track[bi].label}) dist=${bd.toFixed(1)}`);
  }
  steerState.lastFeet = null;
}
async function doEntrySwitch(toEntry) {
  // player path: overview page -> pick entry -> start
  await page.goto(`${base}/world-preview.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#entries button'), null, { timeout: 30000 });
  await page.locator('#entries button', { hasText: toEntry === 'mainStreet' ? '主街' : toEntry === 'laneA' ? 'A弄' : toEntry === 'laneB' ? 'B弄' : '庙前' }).first().click();
  await page.click('#cta-explore');
  await page.waitForURL(/fangbang\.html/, { timeout: 30000 });
  await waitReady();
  const st = await rec();
  if (!st.ready) anomaly('entrySwitchNotReady', toEntry);
  opCounts.entrySwitch++;
  await page.click('#btn-start');
  await page.waitForTimeout(1200);
}

// ---- main ------------------------------------------------------------------
const report = {
  label, base, entry, config, track: trackName, minutes, gameUrl,
  startedAt: new Date().toISOString(),
  env: { renderer: 'headless Chrome + SwiftShader (SOFTWARE baseline)', viewport: '1280x900',
    gcExposed: useGc, host: 'linux arm64', note: 'dev-server long-run; all numbers software-baseline' },
  segments: [], events, anomalies, opCounts,
  steering: steerState,
};
const deadline = Date.now() + minutes * 60000;
try {
  note('navigate', gameUrl);
  await page.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitReady();
  let r = await rec();
  if (!r.ready) { anomaly('initialReadyFail', r.fatalMsg ?? r.hud ?? 'not ready'); throw new Error('page not ready at start'); }
  note('ready', `tris=${r.res?.triangles} feet=${JSON.stringify(r.feet)}`);
  await page.click('#btn-start');
  await page.waitForTimeout(1500);
  r = await rec();
  if (r.mode !== 'walk') anomaly('startDidNotEnterWalk', `mode=${r.mode}`);
  track = buildTrack(trackName, r.feet ?? undefined);
  note('track', `${trackName}: ${track.length} waypoints`);

  const keysDown = { w: false, a: false, d: false };
  let segIdx = 0, segStart = Date.now(), segSamples = [], nextShotAt = Date.now() + 5 * 60000, nextOpsAt = Date.now() + opsEveryS, lastSampleAt = 0;
  while (Date.now() < deadline) {
    const now = Date.now();
    if (now - lastSampleAt >= 2000) {
      lastSampleAt = now;
      const s = await withTimeout(rec, 30000, 'sample');
      if (s) {
        s.t = now; s.wall = new Date(now).toISOString();
        if (s.fatal && !segSamples.some((x) => x.fatal)) anomaly('fatalPanel', s.fatalMsg ?? 'fatal shown');
        if (s.feet && s.feet[1] < -0.5 && !segSamples.some((x) => x.feet && x.feet[1] < -0.5))
          anomaly('capsuleBelowFloor', `feet=${JSON.stringify(s.feet)} (fall or under-geometry)`);
        segSamples.push(s);
      }
      await withTimeout(() => steerTick(keysDown), 30000, 'steer');
    }
    if (now >= nextOpsAt) {
      nextOpsAt = now + opsEveryS * 1000;
      for (const op of endOps) {
        if (op === 'pv') await withTimeout(doPvCycle, 60000, 'pv');
        else if (op === 'blur') await withTimeout(doBlurCycle, 60000, 'blur');
        else if (op === 'failRecovery') await withTimeout(doFailRecoveryCycle, 240000, 'failRecovery');
        else if (op.startsWith('entry:')) await withTimeout(() => doEntrySwitch(op.slice(6)), 240000, 'entrySwitch');
      }
      // any op may have exited walk mode page-side (exitWalk/blur/reload clear
      // the page's key state) — re-arm so steerTick re-issues a real KeyW down
      keysDown.w = false;
      if (keysDown.a) { await page.keyboard.up('KeyA').catch(() => {}); keysDown.a = false; }
      if (keysDown.d) { await page.keyboard.up('KeyD').catch(() => {}); keysDown.d = false; }
    }
    if (now >= nextShotAt) {
      nextShotAt = now + 5 * 60000;
      await page.screenshot({ path: resolve(outDir, `shots/t+${Math.round((now - Date.parse(report.startedAt)) / 60000)}m.png`) });
    }
    if (now - segStart >= segmentS * 1000) {
      // segment boundary: flush raw frame gaps, gc + post-GC heap, write file
      const frames = await withTimeout(() => page.evaluate(() => {
        const s = window.__frames;
        return { n: s.n, buf: s.buf.splice(0, s.buf.length), g250: s.g250, g1000: s.g1000, g5000: s.g5000, max: s.max, maxAt: s.maxAt };
      }), 30000, 'frame-flush');
      const memBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
      let heapAfterGc = null, gcMs = null;
      if (useGc) {
        const g = await withTimeout(() => page.evaluate(() => {
          if (typeof gc !== 'function') return null;
          const t0 = performance.now(); gc();
          return { ms: +(performance.now() - t0).toFixed(1), heap: performance.memory?.usedJSHeapSize ?? null };
        }), 30000, 'gc');
        if (g) { gcMs = g.ms; heapAfterGc = g.heap; }
      }
      const gaps = frames ? frames.buf.filter((_, i) => i % 2 === 1) : [];
      const sorted = [...gaps].sort((a, b) => a - b);
      const p = (q) => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1) : null;
      const seg = {
        idx: segIdx, tStart: new Date(segStart).toISOString(), tEnd: new Date(now).toISOString(),
        samples: segSamples, sampleCount: segSamples.length,
        frames: frames ? { total: frames.n, g250: frames.g250, g1000: frames.g1000, g5000: frames.g5000, maxGapMs: +frames.max.toFixed(1), rawPairs: frames.buf } : null,
        gapStats: { count: gaps.length, p50: p(0.5), p99: p(0.99), max: gaps.length ? +Math.max(...gaps).toFixed(1) : null },
        heap: { beforeGc: memBefore, afterGc: heapAfterGc, gcMs },
        loadavg: os.loadavg().map((v) => +v.toFixed(2)),
      };
      const segFile = `segments/seg-${String(segIdx).padStart(3, '0')}.json`;
      segStart = Date.now(); segSamples = []; segIdx++;
      report.segments.push({ idx: seg.idx, file: segFile, gapStats: seg.gapStats, heap: seg.heap, frames: frames ? { total: frames.n, g250: frames.g250, g1000: frames.g1000, g5000: frames.g5000, maxGapMs: seg.frames.maxGapMs } : null });
      await writeFile(resolve(outDir, segFile), JSON.stringify(seg, null, 1) + '\n');
      note('segment', `#${seg.idx} samples=${seg.sampleCount} maxGap=${seg.gapStats.max}ms p99=${seg.gapStats.p99}ms heapAfterGc=${heapAfterGc} wp=${steerState.wpHits}/${track.length}`);
    }
    await page.waitForTimeout(400);
  }
  // final flush
  const frames = await withTimeout(() => page.evaluate(() => ({ n: window.__frames.n, buf: window.__frames.buf.splice(0, window.__frames.buf.length), g250: window.__frames.g250, g1000: window.__frames.g1000, g5000: window.__frames.g5000, max: window.__frames.max, maxAt: window.__frames.maxAt })), 30000, 'frame-flush-final');
  if (frames && frames.buf.length) {
    await writeFile(resolve(outDir, 'segments/seg-final.json'), JSON.stringify({ idx: 'final', tStart: new Date(segStart).toISOString(), tEnd: new Date().toISOString(), samples: segSamples, frames, loadavg: os.loadavg().map((v) => +v.toFixed(2)) }, null, 1) + '\n');
    report.segments.push({ idx: 'final', file: 'segments/seg-final.json', frames: { total: frames.n, g250: frames.g250, g1000: frames.g1000, g5000: frames.g5000, maxGapMs: +frames.max.toFixed(1) } });
  }
  await page.screenshot({ path: resolve(outDir, 'shots/final.png') });
} catch (e) {
  anomaly('driverFatal', String(e).slice(0, 300));
  await page.screenshot({ path: resolve(outDir, 'shots/driver-fatal.png') }).catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.durationS = +((Date.now() - Date.parse(report.startedAt)) / 1000).toFixed(1);
  report.steering = steerState;
  // honest exit rules (PLAN F): route completion / transition counts / valid sampling
  const segSampleS = report.segments.length * segmentS;
  report.exitRules = {
    wallDurationS: report.durationS,
    routeWaypointsHit: steerState.wpHits,
    routeWaypointsTotal: track.length,
    routeCompletionFrac: track.length ? +(steerState.wpHits / track.length).toFixed(3) : null,
    metersWalked: +steerState.meters.toFixed(1),
    transitions: opCounts,
    anomalyCount: anomalies.length,
    anomalies: anomalies.slice(0, 40),
  };
  await writeFile(resolve(outDir, 'longrun.json'), JSON.stringify(report, null, 1) + '\n');
  await browser.close();
  console.log(`LONGRUN DONE -> ${outDir} (${report.durationS}s, wp ${steerState.wpHits}/${track.length}, ${(steerState.meters / 1000).toFixed(2)}km walked, anomalies=${anomalies.length})`);
}
