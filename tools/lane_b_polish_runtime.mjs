// Lane-B polish runtime baseline — EVIDENCE-REPAIR rewrite (B7-R1, 2026-09-20).
// Real fangbang.html?ds=fangbang-temple-v7 pages on this workspace's own vite
// server, driven through the page's own input path in headless Chrome +
// SwiftShader (declared SOFTWARE baseline; no machine settings touched).
//
// What the previous version got wrong (withdrawn; originals snapshotted under
// artifacts/lane-b-polish/evidence-repair/previous/): steering read tgt[2] on
// [x,z] targets so the turn branch never fired and the "loop" went straight
// with no completion assertions; only the 60 fastest sorted frames were kept;
// the first-frame field mixed clock bases; cpuSubmitMs>0 stood in for a real
// render check; the P/V resource read used r.blocks (null).
//
// This version:
//   - route built from v7 route.json PRODUCTION coordinates only (mainStreet
//     slice + laneAExcursion/laneBExcursion in/out): street-west -> A in/out
//     -> street-east -> B in/out -> street-east home (>= 90 s of walking);
//     the only teleport is the DECLARED safe spawn (mainStreet anchor) before
//     the loop starts — zero teleports while the load runs
//   - closed-loop steering: displacement heading while moving (ground truth),
//     input-accumulated yaw model while stationary; mouse turn through the
//     page's own look() (movementX * 0.0023); every non-finite target aborts
//   - full time-ordered frame samples [t, visible, focus, phase] kept and
//     dumped raw; stats recomputed from the raw samples in Node and rechecked
//     by tests against the saved artifact; walking stats use ONLY the
//     walk-loop phase (load/auto-cruise/entry/P/V phases excluded with counts)
//   - load clock on ONE base (navigation timeOrigin): navigation->ready,
//     navigation->first valid frame (pixel-verified non-blank, not
//     cpuSubmitMs>0), ready->first valid frame = recomputable difference
//   - 3x P/V + A/B explicit-entry cycles in their own phase, asserting real
//     mode/paused/pose/key-clearing, reading record.walking.blocks.active /
//     .epoch and record.walking.session; geometry/material/texture counts
//     reconciled exactly per location; heap reported as fluctuation only
//   - the server is spawned by this tool and identity-checked (served
//     route.json sha256 == workspace file) before any page runs
//
// All synthetic input is TEST INJECTION, honestly labeled — this is not a
// manual play claim (manualWalkClaim stays false).
// Output: artifacts/lane-b-polish/runtime-baseline.json (+ raw/ dumps).
// Run: node tools/lane_b_polish_runtime.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';
import {
  yawError, steeringDx, makeWaypointer, evaluateWalk, frameIntervalStats,
  LOOK_SENSITIVITY, TURN_DEADBAND,
} from './lane_b_route_steer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'artifacts/lane-b-polish');
const RAW_DIR = resolve(OUT_DIR, 'evidence-repair/raw');
const OUT = resolve(OUT_DIR, 'runtime-baseline.json');
const TICK_MS = 160;                 // control-loop cadence
const EXPECTED_TRI = { default: 694430, 'skins+props': 708066 };

const report = {
  tool: 'tools/lane_b_polish_runtime.mjs',
  task: 'B7-R1 runtime evidence repair (previous route-performance claim withdrawn, see evidence-repair/previous/README.md)',
  injections: {
    declared: 'synthetic test injection through the page input path — NOT manual play',
    keyboard: 'KeyboardEvent keydown/keyup on window, always paired',
    mouse: 'MouseEvent mousemove with movementX on document (page look path, 0.0023 rad/px)',
    pointerLockShim: 'canvas.requestPointerLock stub + document.pointerLockElement getter (headless pointer-lock stand-in)',
    manualWalkClaim: false,
  },
  env: {
    chrome: '/usr/bin/google-chrome', headless: true, swiftshader: true, softwareBaselineOnly: true,
    declaration: 'SwiftShader software rendering baseline; rAF intervals measure frame pacing only; per-frame CPU submit (cpuSubmitMs) is NOT GPU completion; no hardware 60FPS claim is made from this data',
    viewport: [1280, 720], dpr: 1,
    clockBase: 'navigation timeOrigin (performance.now, rAF timestamps and navigation-timing entries share it)',
    startedAt: new Date().toISOString(),
  },
  configs: [], pass: true,
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- dev server (owned by this run; identity-checked before use) -----------
const PORTS = [5402, 5403];          // 5401 is the lead's static preview — never touched
// pre-flight: if something already listens there, do NOT touch it (it may be
// another project's server) — fail loudly instead
for (const p of PORTS) {
  let occupied = false;
  try { occupied = (await fetch(`http://127.0.0.1:${p}/fangbang.html`, { signal: AbortSignal.timeout(800) })).ok; } catch {}
  if (occupied) { console.error(`port ${p} already serves something — refusing to touch it`); process.exit(1); }
}
const killServer = async () => {
  if (!proc || proc.exitCode !== null) return;
  proc.kill();
  for (let i = 0; i < 20 && proc.exitCode === null; i++) await new Promise((r) => setTimeout(r, 200));
  if (proc.exitCode === null) { proc.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 300)); }
};
let port = null, proc = null, log = '';
for (const p of PORTS) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, env: { ...process.env, EVIDENCE_PORTS: '540[23]' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
    // only OUR process counts: a foreign server on this port must never be
    // adopted as our startup success
    try { up = (await fetch(`http://127.0.0.1:${p}/fangbang.html`)).ok && proc.exitCode === null; } catch {}
  }
  if (up) { port = p; break; }
  await killServer();
}
if (!port) { console.error('vite dev server failed on 5402/5403:\n' + log); process.exit(1); }
if (proc.exitCode !== null) { console.error('vite server process died during startup'); process.exit(1); }
console.log(`dev server on :${port} (pid ${proc.pid})`);

// identity check: the served bytes must BE this workspace's v7 dataset
const servedRoute = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/world/fangbang-temple-v7/route.json`)).arrayBuffer());
const localRoute = await readFile(resolve(root, 'world/fangbang-temple-v7/route.json'));
const servedSha = sha256(servedRoute), localSha = sha256(localRoute);
if (servedSha !== localSha) {
  console.error(`server identity check FAILED: served route.json sha ${servedSha} != workspace ${localSha}`);
  await killServer(); process.exit(1);
}
const servedHtml = await (await fetch(`http://127.0.0.1:${port}/fangbang.html`)).text();
if (!servedHtml.includes('/src/fangbangMain.js')) {
  console.error('server identity check FAILED: /fangbang.html is not the bridge page');
  await killServer(); process.exit(1);
}
console.log(`server identity OK (route.json sha256 ${servedSha.slice(0, 12)}…)`);
const route = JSON.parse(servedRoute.toString('utf8'));

// ---- declared route from PRODUCTION coordinates (no invented waypoints) ----
const toXZ = (p) => [p[0], p[2]];   // route.json [x,y,z] -> steering [x,z]
const nearestIdx = (pts, q) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - q[0], pts[i][2] - q[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return { index: best, distM: +bd.toFixed(2) };
};
const ms = route.mainStreet.map(toXZ);
const laneA = route.laneAExcursion.map(toXZ);
const laneB = route.laneBExcursion.map(toXZ);
const iSpawn = nearestIdx(route.mainStreet, route.entries.bridgeStart);   // bridgeStart lies ON the route
const iA = nearestIdx(route.mainStreet, route.laneAExcursion[0]);         // street point nearest the A mouth
const iB = nearestIdx(route.mainStreet, route.laneBExcursion[0]);         // street point nearest the B mouth
const slice = (a, b) => (a <= b ? ms.slice(a, b + 1) : ms.slice(b, a + 1).reverse());
const LEGS = [
  { name: 'street-west', reach: 1.4, pts: slice(iSpawn.index, iA.index) },
  { name: 'laneA-in', reach: 1.0, pts: laneA },
  { name: 'laneA-out', reach: 1.0, pts: [...laneA].reverse().slice(1) },
  // connectors back onto the street are walked THROUGH the mouth's own street
  // point (ms[iA]/ms[iB]) first — cutting the corner diagonally walls in
  { name: 'street-east-A-to-B', reach: 1.4, pts: slice(iA.index, iB.index) },
  { name: 'laneB-in', reach: 1.0, pts: laneB },
  { name: 'laneB-out', reach: 1.0, pts: [...laneB].reverse().slice(1) },
  { name: 'street-east-home', reach: 1.4, pts: slice(iB.index, iSpawn.index) },
];
const routeLenM = LEGS.reduce((s, l) => s + l.pts.slice(1).reduce((t, p, i) =>
  t + Math.hypot(p[0] - l.pts[i][0], p[1] - l.pts[i][1]), 0), 0);
console.log(`route: ${LEGS.map((l) => `${l.name}(${l.pts.length})`).join(' ')} ~${routeLenM.toFixed(0)}m`);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

// ---- page input helpers (all labeled synthetic injections) ------------------
const key = (page, code, type = 'keydown') =>
  page.evaluate(({ code, type }) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true })), { code, type });
const mouseTurn = (page, dx) =>
  page.evaluate((dx) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0, bubbles: true })), dx);

const keysDown = new Set();
const keyDown = async (page, code) => { await key(page, code, 'keydown'); keysDown.add(code); };
const keyUp = async (page, code) => { await key(page, code, 'keyup'); keysDown.delete(code); };
const releaseAllKeys = async (page) => { for (const c of [...keysDown]) await keyUp(page, c); };

// rAF sampler installed at domContentLoaded: full time-ordered samples with
// visible/focus/phase flags + ready detection via the page's own start button
// + first VALID frame proof (pixel-verified non-blank, 3 patches).
const SAMPLER = `(() => {
  window.__evSamples = []; window.__evPhase = 'load';
  window.__evReady = null; window.__evFirstValid = null; window.__evSamplerAt = null;
  let gl = null;
  const patch = (x, y, w, h) => { const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(x | 0, y | 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const distinct = (bufs) => { const s = new Set();
    for (const px of bufs) for (let i = 0; i < px.length; i += 4) s.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    return s.size; };
  const tick = (t) => {
    window.__evSamples.push([+t.toFixed(2), document.visibilityState === 'visible' ? 1 : 0,
      document.hasFocus() ? 1 : 0, window.__evPhase]);
    if (window.__evSamplerAt === null) window.__evSamplerAt = +t.toFixed(1);
    const btn = document.querySelector('#btn-start');
    if (window.__evReady === null && btn && !btn.disabled && btn.textContent === '开始探索')
      window.__evReady = { tMs: +t.toFixed(1) };
    if (window.__evFirstValid === null && window.__evReady !== null) {
      const c = document.querySelector('#app canvas') ?? document.querySelector('canvas');
      if (c && !gl) gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        try {
          const d = distinct([patch(w / 2 - 16, h * 0.25 - 16, 32, 32), patch(w / 2 - 16, h / 2 - 16, 32, 32), patch(w / 2 - 16, h * 0.75 - 16, 32, 32)]);
          if (d >= 4) window.__evFirstValid = { tMs: +t.toFixed(1), distinctColors: d,
            check: '3x 32x32 RGBA patches (center column at 25/50/75% height) >= 4 distinct colors; blank/unrendered canvas never passes' };
        } catch {}
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

async function runConfig(name, query) {
  const cfgFailures = [];
  const fail = (msg) => { cfgFailures.push(msg); console.log(`FAIL [${name}] ${msg}`); };
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(`http://127.0.0.1:${port}/fangbang.html?ds=fangbang-temple-v7${query}`,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(SAMPLER);   // before ready: catches the whole load
  await page.waitForFunction(() => typeof window.__fangbangRecord === 'function'
    && window.__fangbangRecord()?.ready === true && window.__fangbangRecord()?.routeCheck, null, { timeout: 300000 });
  const recordExposedAt = await page.evaluate(() => +performance.now().toFixed(1));

  const env = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const c = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      navigationToDomContentLoadedMs: +nav.domContentLoadedEventEnd.toFixed(1),
      rendererString: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory ?? null,
      canvasCss: [c.clientWidth, c.clientHeight], drawingBuffer: [c.width, c.height],
    };
  });
  const firstRec = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { load: r.load, triangles: r.resources?.triangles, framebuffer: r.framebuffer,
      routeCheck: { pass: r.routeCheck?.pass, summary: r.routeCheck?.summary, ms: r.routeCheck?.ms },
      ready: r.ready, mode: r.mode,
      sampler: { readyAt: window.__evReady?.tMs ?? null, firstValidAt: window.__evFirstValid,
        samplerInstalledAt: window.__evSamplerAt, samplesSoFar: window.__evSamples.length } };
  });
  const loadClock = {
    navigationToDomContentLoadedMs: env.navigationToDomContentLoadedMs,
    navigationToReadyMs: firstRec.sampler.readyAt,
    navigationToFirstValidFrameMs: firstRec.sampler.firstValidAt?.tMs ?? null,
    readyToFirstValidFrameMs: (firstRec.sampler.readyAt !== null && firstRec.sampler.firstValidAt)
      ? +(firstRec.sampler.firstValidAt.tMs - firstRec.sampler.readyAt).toFixed(1) : null,
    firstValidFrameProof: firstRec.sampler.firstValidAt ?? null,
    navigationToRecordExposedMs: recordExposedAt,
    domContentLoadedToReadyMs: firstRec.sampler.readyAt !== null
      ? +(firstRec.sampler.readyAt - env.navigationToDomContentLoadedMs).toFixed(1) : null,
  };

  // pointer-lock shim (headless stand-in; labeled test instrumentation)
  await page.evaluate(() => {
    const c = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    c.requestPointerLock = () => {};
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => c });
  });

  // ---- DECLARED safe spawn: explicit mainStreet anchor, then enter walk ------
  const anchors = await page.evaluate(() => window.__fangbangRecord().safeAnchors
    .filter((a) => a.validation?.ok).map((a) => ({ id: a.id, position: a.position, yaw: a.yawRad })));
  const anchorIds = anchors.map((a) => a.id);
  const spawnAnchor = anchors.find((a) => a.id === 'mainStreet') ?? anchors[0];
  if (!spawnAnchor) { fail('no validated safe anchor for spawn'); await page.close(); return { config: name, fatal: 'no anchor' }; }
  await page.evaluate((id) => window.__fangbangRelocate(id), spawnAnchor.id);
  await page.evaluate(() => window.__fangbangStartWalk());
  await page.waitForTimeout(400);
  let rec = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    const s = r.walking.session;
    return { mode: r.mode, paused: r.paused, feet: r.mode === 'walk' ? r.camera.feet : null,
      pose: s?.pose ?? null, spawnCount: s?.spawnCount ?? null,
      relocations: s ? s.explicitRelocations.length : 0 };
  });
  if (rec.mode !== 'walk' || rec.paused) fail(`spawn: mode=${rec.mode} paused=${rec.paused}`);
  // yaw model starts from the page's own recorded spawn pose (finite-checked)
  let yawModel = rec.pose?.yaw;
  if (!Number.isFinite(yawModel)) { fail('spawn pose yaw not finite'); yawModel = 0; }

  // ---- walk loop (phase walk-loop; no teleports inside) ----------------------
  await page.evaluate(() => { window.__evPhase = 'walk-loop'; });
  const waypointer = makeWaypointer(LEGS);
  const trajectory = [];
  let lastFeet = rec.feet, teleportsInLoop = 0, pauseEvents = 0, stillTicks = 0, stallAbort = null;
  await keyDown(page, 'KeyW');
  const t0 = Date.now();
  const LOOP_BUDGET_S = 600;   // wall budget: software rendering can starve physics to ~35% speed
  while (!waypointer.done && (Date.now() - t0) / 1000 < LOOP_BUDGET_S) {
    rec = await page.evaluate(() => {
      const r = window.__fangbangRecord();
      return { mode: r.mode, paused: r.paused, feet: r.camera.feet, pose: r.walking.session.pose };
    });
    const feet = rec.feet;
    if (!feet || !feet.every(Number.isFinite)) { fail(`non-finite feet at tick ${trajectory.length}`); break; }
    const moved = Math.hypot(feet[0] - lastFeet[0], feet[2] - lastFeet[2]);
    if (moved > 5) teleportsInLoop++;   // walking covers <=0.35m/tick; a jump this size is a teleport
    // heading: displacement while moving (ground truth); accumulated model when still
    if (moved > 0.12) yawModel = Math.atan2(-(feet[0] - lastFeet[0]), -(feet[2] - lastFeet[2]));
    if (rec.paused) {
      pauseEvents++;
      await page.evaluate(() => { window.__evPhase = 'walk-paused'; });
      await key(page, 'KeyP');   // attempt one honest resume, recorded as an event
      await page.waitForTimeout(200);
      await page.evaluate(() => { if (!window.__fangbangRecord().paused) window.__evPhase = 'walk-loop'; });
    }
    if (rec.mode !== 'walk') { fail(`left walk mode mid-loop (mode=${rec.mode})`); break; }
    const t = waypointer.update([feet[0], feet[2]], Date.now());
    if (t) {
      let err;
      try {
        err = yawError([feet[0], feet[2]], yawModel, t.target);
      } catch (e) {
        fail(`steering target invalid: ${e.message}`);
        break;
      }
      if (Math.abs(err) > TURN_DEADBAND) {
        const dx = steeringDx(err, { sensitivity: LOOK_SENSITIVITY });
        await mouseTurn(page, dx);
        yawModel -= dx * LOOK_SENSITIVITY;   // same arithmetic as controller.look()
      }
    }
    const sample = { tMs: Date.now() - t0, wallClockMs: Date.now(),
      feet: feet.map((v) => +v.toFixed(3)), yaw: +yawModel.toFixed(4), paused: rec.paused,
      moved: +moved.toFixed(3), leg: waypointer.done ? LEGS[LEGS.length - 1].name : waypointer.legName,
      index: waypointer.waypointIndex, dist: t ? +t.dist.toFixed(2) : null,
      completed: waypointer.done };
    if (!Number.isFinite(sample.yaw) || !sample.feet.every(Number.isFinite)) { fail('non-finite trajectory sample'); break; }
    trajectory.push(sample);
    stillTicks = moved < 0.02 && !rec.paused ? stillTicks + 1 : 0;
    if (stillTicks * (TICK_MS + 40) > 8000) {   // >8 s unmoved while unpaused: hard stop
      stallAbort = { leg: waypointer.legName, index: waypointer.waypointIndex,
        at: feet.map((v) => +v.toFixed(2)), stillS: +((stillTicks * (TICK_MS + 40)) / 1000).toFixed(1) };
      fail(`stalled >8s at leg ${stallAbort.leg} wp ${stallAbort.index} near ${JSON.stringify(stallAbort.at)} — aborting loop`);
      break;
    }
    lastFeet = feet;
    await page.waitForTimeout(TICK_MS);
  }
  await keyUp(page, 'KeyW');
  const loopWallS = +((Date.now() - t0) / 1000).toFixed(1);
  if (!waypointer.done) fail(`route NOT completed in ${loopWallS}s (stopped at leg ${waypointer.legName} wp ${waypointer.waypointIndex}/${LEGS.find((l) => l.name === waypointer.legName)?.pts.length}${stallAbort ? ` — stalled ${stallAbort.stillS}s` : ''})`);
  // mark completion ON the dumped sample so the artifact and the verdict share
  // one input (tests re-run evaluateWalk over the dumped trajectory)
  if (trajectory.length) trajectory[trajectory.length - 1].completed = waypointer.done;
  const walkVerdict = evaluateWalk({ samples: trajectory,
    legNames: LEGS.map((l) => l.name), minValidWalkS: 90, stallFailS: 8 });
  walkVerdict.failures.forEach((f) => fail(`walk: ${f}`));
  console.log(`[${name}] walk loop: ${waypointer.done ? 'COMPLETED' : 'INCOMPLETE'} wall=${loopWallS}s moving=${walkVerdict.stats?.movingS}s dist=${walkVerdict.stats?.distanceM}m reached=${waypointer.reachedCount} pauses=${pauseEvents}`);
  await page.evaluate(() => { window.__evPhase = 'pv-cycles'; });

  // ---- 3x P/V + A/B explicit-entry cycles (own phase; real state asserts) ----
  const laneAAnchor = anchors.find((a) => a.id === 'laneA'), laneBAnchor = anchors.find((a) => a.id === 'laneB');
  const resNow = () => page.evaluate(() => {
    const r = window.__fangbangRecord();
    return {
      mode: r.mode, paused: r.paused,
      feet: r.mode === 'walk' ? r.camera.feet : r.camera.position,
      resources: { triangles: r.resources?.triangles, geometries: r.resources?.uniqueGeometries,
        materials: r.resources?.uniqueMaterials, textures: r.resources?.uniqueTextures },
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      blocks: r.walking?.blocks ? { activeCount: r.walking.blocks.active.length,
        active: r.walking.blocks.active, epoch: r.walking.blocks.epoch } : null,
      session: r.walking?.session ? { mode: r.walking.session.mode, paused: r.walking.session.paused,
        spawnCount: r.walking.session.spawnCount, relocations: r.walking.session.explicitRelocations.length,
        pose: r.walking.session.pose, pendingAnchorId: r.walking.session.pendingAnchorId } : null,
      walkResets: r.walking?.walkResets,
    };
  });
  const cycles = [];
  if (!laneAAnchor || !laneBAnchor) fail(`A/B anchors missing (have ${anchorIds.join(',')})`);
  for (let i = 0; i < 3 && laneAAnchor && laneBAnchor; i++) {
    const c = { cycle: i + 1, asserts: [] };
    const a = (ok, label) => { c.asserts.push({ ok, label }); if (!ok) fail(`pv cycle ${i + 1}: ${label}`); };
    // P pause: real paused flag + frozen capsule
    const beforeP = await resNow();
    const spawnCountBefore = beforeP.session.spawnCount;
    await keyDown(page, 'KeyP'); await page.waitForTimeout(120); await keyUp(page, 'KeyP');
    await page.waitForTimeout(300);
    let s = await resNow();
    a(s.mode === 'walk' && s.paused === true, `P pauses (mode=${s.mode} paused=${s.paused})`);
    const frozenAt = s.feet;
    await page.waitForTimeout(400);
    s = await resNow();
    a(Math.hypot(s.feet[0] - frozenAt[0], s.feet[2] - frozenAt[2]) < 0.02, `paused capsule frozen (moved ${Math.hypot(s.feet[0] - frozenAt[0], s.feet[2] - frozenAt[2]).toFixed(3)}m)`);
    // W pressed while paused must be ignored (paused guard) — keydown/keyup pair
    await keyDown(page, 'KeyW'); await page.waitForTimeout(200); await keyUp(page, 'KeyW');
    // P resume: clean input -> no drift without W
    await keyDown(page, 'KeyP'); await page.waitForTimeout(120); await keyUp(page, 'KeyP');
    await page.waitForTimeout(400);
    s = await resNow();
    a(s.mode === 'walk' && s.paused === false, `P resumes (mode=${s.mode} paused=${s.paused})`);
    a(Math.hypot(s.feet[0] - frozenAt[0], s.feet[2] - frozenAt[2]) < 0.05, `no drift after resume without W (moved ${Math.hypot(s.feet[0] - frozenAt[0], s.feet[2] - frozenAt[2]).toFixed(3)}m)`);
    // V to view: pose captured at the real standing spot, mode flips
    const feetBeforeV = s.feet;
    await keyDown(page, 'KeyV'); await page.waitForTimeout(120); await keyUp(page, 'KeyV');
    await page.waitForTimeout(250);
    s = await resNow();
    a(s.mode === 'view', `V exits to view (mode=${s.mode})`);
    const pose = s.session.pose;
    a(pose && Number.isFinite(pose.yaw) && pose.feet.every(Number.isFinite), 'V captures finite pose');
    a(Math.hypot(pose.feet[0] - feetBeforeV[0], pose.feet[2] - feetBeforeV[2]) < 0.1, `V pose == standing spot (d=${pose ? Math.hypot(pose.feet[0] - feetBeforeV[0], pose.feet[2] - feetBeforeV[2]).toFixed(3) : 'n/a'}m)`);
    // re-enter walk — the page's own contract: a PENDING explicit location
    // always wins (cycles 2+: the previous cycle's B relocate), otherwise the
    // first entry spawns at the camera-nearest validated anchor (cycle 1:
    // everWalked still false because the initial spawn came through an explicit
    // anchor). Either way it must be a real, finite walking state.
    const expectedAnchor = i === 0
      ? anchors.reduce((best, an) => {
          const d = Math.hypot(an.position[0] - feetBeforeV[0], an.position[2] - feetBeforeV[2]);
          return !best || d < best.d ? { ...an, d } : best;
        }, null)
      : laneBAnchor;
    await page.evaluate(() => window.__fangbangStartWalk());
    await page.waitForTimeout(300);
    s = await resNow();
    a(s.mode === 'walk' && s.paused === false, `re-enter walk (mode=${s.mode} paused=${s.paused})`);
    a(s.session.spawnCount === spawnCountBefore + 1, `re-enter = one explicit/pending spawn (${s.session.spawnCount} vs ${spawnCountBefore})`);
    const dEnter = Math.hypot(s.feet[0] - expectedAnchor.position[0], s.feet[2] - expectedAnchor.position[2]);
    a(dEnter < 0.3, `re-enter lands on the expected anchor ${expectedAnchor.id} (d=${dEnter.toFixed(2)}m)`);
    await page.waitForTimeout(300);
    // A/B explicit entries: real teleport + real walking at each mouth
    for (const [tag, anchor] of [['A', laneAAnchor], ['B', laneBAnchor]]) {
      const relBefore = (await resNow()).session.relocations;
      await page.evaluate((id) => window.__fangbangRelocate(id), anchor.id);
      await page.waitForTimeout(300);
      s = await resNow();
      const d = Math.hypot(s.feet[0] - anchor.position[0], s.feet[2] - anchor.position[2]);
      a(s.session.relocations === relBefore + 1 && d < 0.5, `${tag} explicit entry lands at anchor (d=${d.toFixed(2)}m relocations ${relBefore}->${s.session.relocations})`);
      const startWalk = s.feet;
      await keyDown(page, 'KeyW'); await page.waitForTimeout(1500); await keyUp(page, 'KeyW');
      s = await resNow();
      const walked = Math.hypot(s.feet[0] - startWalk[0], s.feet[2] - startWalk[2]);
      a(walked > 1.0, `${tag} mouth actually walkable from anchor (moved ${walked.toFixed(2)}m)`);
      c[`after${tag}`] = await resNow();
    }
    cycles.push(c);
  }
  // resource reconciliation: same location, cross-cycle exact counts; heap = fluctuation
  const reconciliation = { byLocation: {}, heap: { samples: [], rangeMB: null }, monotonicGrowth: false };
  for (const tag of ['afterA', 'afterB']) {
    const series = { triangles: [], geometries: [], materials: [], textures: [], blocksActive: [], blockEpoch: [] };
    for (const c of cycles) if (c[tag]) {
      series.triangles.push(c[tag].resources.triangles);
      series.geometries.push(c[tag].resources.geometries);
      series.materials.push(c[tag].resources.materials);
      series.textures.push(c[tag].resources.textures);
      series.blocksActive.push(c[tag].blocks.activeCount);
      series.blockEpoch.push(c[tag].blocks.epoch);
    }
    const flat = (xs) => xs.every((v) => v === xs[0]);
    reconciliation.byLocation[tag] = { ...series,
      stable: flat(series.triangles) && flat(series.geometries) && flat(series.materials) && flat(series.textures) };
    const grows = (xs) => xs.some((v, i) => i > 0 && v > xs[i - 1]);
    if (grows(series.geometries) || grows(series.materials) || grows(series.textures)) reconciliation.monotonicGrowth = true;
    if (!reconciliation.byLocation[tag].stable)
      fail(`resource counts not stable at ${tag}: ${JSON.stringify(series)}`);
  }
  for (const c of cycles) for (const tag of ['afterA', 'afterB']) if (c[tag]?.heapMB !== null && c[tag]?.heapMB !== undefined)
    reconciliation.heap.samples.push(c[tag].heapMB);
  if (reconciliation.heap.samples.length)
    reconciliation.heap.rangeMB = [Math.min(...reconciliation.heap.samples), Math.max(...reconciliation.heap.samples)];
  if (reconciliation.monotonicGrowth) fail('monotonic geometry/material/texture growth over P/V cycles');
  console.log(`[${name}] pv cycles: resources ${JSON.stringify(reconciliation.byLocation)} heap=${JSON.stringify(reconciliation.heap.rangeMB)}`);
  await releaseAllKeys(page);
  await page.evaluate(() => { window.__evPhase = 'post'; });
  await page.waitForTimeout(400);

  // ---- full raw samples out; stats recomputed in Node from raw --------------
  const raw = await page.evaluate(() => ({ samples: window.__evSamples,
    readyAt: window.__evReady?.tMs ?? null, firstValid: window.__evFirstValid ?? null }));
  const walkStats = frameIntervalStats(raw.samples, { phase: 'walk-loop' });
  const pausedStats = frameIntervalStats(raw.samples, { phase: 'walk-paused' });
  const phaseCounts = {};
  for (const s of raw.samples) phaseCounts[s[3]] = (phaseCounts[s[3]] ?? 0) + 1;
  const walkPhaseTs = raw.samples.filter((s) => s[3] === 'walk-loop').map((s) => s[0]);
  const walkSpanS = walkPhaseTs.length > 1 ? +((walkPhaseTs[walkPhaseTs.length - 1] - walkPhaseTs[0]) / 1000).toFixed(1) : 0;
  const final = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { mode: r.mode, paused: r.paused, triangles: r.resources.triangles,
      routeCheck: r.routeCheck?.pass, ready: r.ready, session: r.walking.session };
  });
  await page.close();

  // ---- config-level gates ------------------------------------------------------
  if (firstRec.ready !== true) fail('page ready flag not true');
  if (firstRec.routeCheck?.pass !== true) fail(`routeCheck not pass (${firstRec.routeCheck?.summary})`);
  if (firstRec.triangles !== EXPECTED_TRI[name]) fail(`triangles ${firstRec.triangles} != expected ${EXPECTED_TRI[name]}`);
  if (loadClock.navigationToReadyMs === null) fail('ready never detected in page clock');
  if (loadClock.navigationToFirstValidFrameMs === null) fail('first VALID (pixel-checked) frame never found');
  // the order's requirement is >=90 s of valid CONTINUOUS walking with honest
  // stats — under SwiftShader the open-street render can drop rAF to a few Hz,
  // so the frame gate checks sampling span + continuity, never a fake FPS bar
  if (walkSpanS < 90) fail(`walk-loop sampled span ${walkSpanS}s < 90s`);
  if (walkStats.kept < 1.5 * walkSpanS) fail(`frame sampling not continuous (${walkStats.kept} intervals over ${walkSpanS}s)`);
  if (walkVerdict.stats && walkVerdict.stats.movingS < 90) fail(`valid walking seconds ${walkVerdict.stats.movingS}s < 90s`);
  if (pauseEvents > 0) fail(`${pauseEvents} unexpected pause event(s) during walk loop`);
  if (teleportsInLoop > 0) fail(`${teleportsInLoop} teleport-like jump(s) during walk loop`);

  return {
    config: name, fileTag: name === 'skins+props' ? 'skins-props' : name,
    rawOut: {
      frames: { config: name, readyAtPageMs: raw.readyAt, firstValid: raw.firstValid, samples: raw.samples },
      trajectory: { config: name, legs: LEGS, indices: { spawn: iSpawn, laneAMouth: iA, laneBMouth: iB },
        spawnAnchorId: spawnAnchor.id, samples: trajectory,
        reachEvents: waypointer.reachedAt, verdict: walkVerdict, loopWallS },
    },
    query, failures: cfgFailures,
    server: { port, pid: proc.pid, routeJsonServedSha256: servedSha, routeJsonMatchesWorkspace: servedSha === localSha },
    env, budget: { triangles: firstRec.triangles, expected: EXPECTED_TRI[name], ready: firstRec.ready, routeCheck: firstRec.routeCheck },
    load: { ...loadClock, pageLoadStats: firstRec.load, samplerInstalledAtPageMs: firstRec.sampler.samplerInstalledAt },
    framebuffer: firstRec.framebuffer,
    walkLoop: {
      declaredRoute: { legs: LEGS.map((l) => ({ name: l.name, points: l.pts.length, reachM: l.reach })),
        totalWaypoints: LEGS.reduce((s, l) => s + l.pts.length, 0), approxLengthM: +routeLenM.toFixed(1),
        spawnAnchor: spawnAnchor.id, connectors: 'street<->lane mouths walked live (A0/B0 to nearest mainStreet points)',
        teleportsDuringLoop: 0 },
      indices: { spawn: iSpawn, laneAMouth: iA, laneBMouth: iB },
      waypointsReached: waypointer.reachedCount, loopWallS,
      verdict: walkVerdict, pauseEvents,
      framePacingNote: 'SwiftShader software rendering of the open 694k-triangle street costs far more than the occluded dead-end view the withdrawn baseline sampled; when rAF drops to a few Hz the page clamps dt to 0.25 s (8 fixed physics steps max per frame), so effective walking speed degrades while every simulated step is still the full Rapier-corrected chain. Intervals here are the honest software baseline, not a hardware FPS claim.',
      frames: { recomputedFromRawSamples: true, walkLoopPhaseOnly: walkStats,
        walkPausedPhase: pausedStats.kept ? pausedStats : null,
        phaseSampleCounts: phaseCounts, walkLoopSpanS: walkSpanS },
    },
    pvCycles: { cycles: cycles.map((c) => ({ cycle: c.cycle, assertsPassed: c.asserts.every((x) => x.ok),
      assertsFailed: c.asserts.filter((x) => !x.ok).map((x) => x.label),
      afterA: { resources: c.afterA?.resources, blocks: c.afterA?.blocks, heapMB: c.afterA?.heapMB },
      afterB: { resources: c.afterB?.resources, blocks: c.afterB?.blocks, heapMB: c.afterB?.heapMB } })),
      reconciliation },
    final,
    keyPairing: { allReleased: keysDown.size === 0 },
    rawFiles: { frames: `evidence-repair/raw/${name === 'skins+props' ? 'skins-props' : name}-frames.json`,
      trajectory: `evidence-repair/raw/${name === 'skins+props' ? 'skins-props' : name}-trajectory.json` },
  };
}

let failures = 0;
try {
  for (const [name, query] of [['default', ''], ['skins+props', '&skins=1&props=1']]) {
    if (proc.exitCode !== null) { report.pass = false; console.error('server died mid-run'); break; }
    const cfg = await runConfig(name, query);
    report.configs.push(cfg);
    const ok = cfg.failures?.length === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${cfg.failures?.length ?? 0} failure(s)`);
    if (!ok) { failures += cfg.failures.length; report.pass = false; }
    await mkdir(RAW_DIR, { recursive: true });
    await writeFile(resolve(RAW_DIR, `${cfg.fileTag}-frames.json`), JSON.stringify(cfg.rawOut.frames, null, 1) + '\n');
    await writeFile(resolve(RAW_DIR, `${cfg.fileTag}-trajectory.json`), JSON.stringify(cfg.rawOut.trajectory, null, 1) + '\n');
    delete cfg.rawOut;   // raw lives in its own file; the summary points at it
  }
} finally {
  await browser.close();
  await killServer();
  console.log('worker browser closed, dev server stopped');
}

report.env.finishedAt = new Date().toISOString();
report.rawSamplesNote = 'full time-ordered frame samples and the complete trajectory (monotonic time, feet, yaw/target index, reach events, pauses, stillness) are dumped under artifacts/lane-b-polish/evidence-repair/raw/ and rechecked by tests/lane-b-evidence.test.mjs';
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 1) + '\n');
console.log(failures === 0 ? 'RUNTIME_BASELINE_PASS' : `RUNTIME_BASELINE_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
