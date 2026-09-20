// Lane-B polish runtime baseline — REAL page (fangbang.html) on the v7
// candidate, driven through the page's own input path in headless Chrome +
// SwiftShader (declared SOFTWARE baseline; no machine settings touched).
//
// Per configuration (default; skins=1&props=1):
//   - clean load: navigationStart -> domContentLoaded -> ready -> first valid
//     frame (first rAF after ready with a real render), plus the page's own
//     load stats (asset bytes, shader compile ms)
//   - >= 90 s continuous REAL loop walk: main street east<->west with lane A
//     and lane B excursions, driven by synthetic WASD keydown/keyup + mousemove
//     (movementX) through the page's own handlers; frame intervals from rAF
//     timestamps (NOT cpuSubmitMs inverses); visibility/focus-flagged frames
//     excluded and counted; P50/P95 + raw samples recorded
//   - 3 x P (pause/resume) + V (view) -> walk round trips with A/B entrance
//     relocations; renderer resources (geometries/materials/textures/triangles)
//     sampled after each cycle to detect monotonic growth
// Environment recorded: viewport, drawingBuffer, WebGL renderer string,
// hardwareConcurrency, SwiftShader software declaration.
//
// Output: artifacts/lane-b-polish/runtime-baseline.json
// Run: node tools/lane_b_polish_runtime.mjs
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/lane-b-polish/runtime-baseline.json');
const LOOK = 0.0023;                      // page mouse sensitivity (rad per px)

const report = {
  tool: 'tools/lane_b_polish_runtime.mjs',
  env: { chrome: '/usr/bin/google-chrome', headless: true, swiftshader: true,
    softwareBaselineOnly: true, viewport: [1280, 720], dpr: 1,
    startedAt: new Date().toISOString() },
  configs: [], pass: true,
};

// ---- dev server (owned by this run) ------------------------------------------
let port = null, log = '', proc = null;
for (const p of [5370, 5371, 5372, 5373]) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, env: { ...process.env, EVIDENCE_PORTS: '537[0-3]' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`http://127.0.0.1:${p}/fangbang.html`)).ok; } catch {}
  }
  if (up) { port = p; break; }
  proc.kill();
}
if (!port) { console.error('vite dev server failed:\n' + log); process.exit(1); }
console.log(`dev server on :${port}`);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const key = (page, code, type = 'keydown') =>
  page.evaluate(({ code, type }) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true })), { code, type });
const mouseTurn = (page, dx) =>
  page.evaluate((dx) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0, bubbles: true })), dx);

async function runConfig(name, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/fangbang.html?ds=fangbang-temple-v7${query}`, { waitUntil: 'domcontentloaded' });
  const domLoadedAt = Date.now();
  await page.waitForFunction(() => typeof window.__fangbangRecord === 'function' && window.__fangbangRecord().ready, null, { timeout: 300000 });
  const readyAtMs = Date.now() - t0;

  // rAF sampler: frame timestamps + visibility/focus flags + first valid frame
  await page.evaluate(() => {
    window.__samples = [];
    window.__firstFrameAfterReady = null;
    const origin = performance.timeOrigin;
    const tick = (t) => {
      const rec = window.__fangbangRecord?.();
      if (rec?.ready && rec.render?.cpuSubmitMs > 0 && window.__firstFrameAfterReady === null)
        window.__firstFrameAfterReady = +(t + origin - performance.timeOrigin).toFixed(1);   // ms since timeOrigin
      window.__samples.push([+(t).toFixed(2), document.visibilityState === 'visible' ? 1 : 0, document.hasFocus() ? 1 : 0]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(250);   // let the sampler catch the first post-ready frame
  const env = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const c = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      navigationStartMs: 0, domContentLoadedMs: +nav.domContentLoadedEventEnd.toFixed(0),
      rendererString: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory ?? null,
      canvasCss: [c.clientWidth, c.clientHeight], drawingBuffer: [c.width, c.height],
    };
  });
  const rec0 = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { load: r.load, triangles: r.resources?.triangles, framebuffer: r.framebuffer,
      firstFrameAfterReady: window.__firstFrameAfterReady };
  });

  // pointer-lock shim so the page's own mousemove look path accepts synthetic
  // turns in headless (external harness instrumentation; no source changes)
  await page.evaluate(() => {
    const c = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    c.requestPointerLock = () => {};
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => c });
  });

  // enter walk + hold W (real input handlers)
  await page.evaluate(() => window.__fangbangStartWalk());
  await page.waitForTimeout(300);
  const anchors = await page.evaluate(() => window.__fangbangRecord().safeAnchors.map((a) => ({ id: a.id, pos: a.position })));
  await key(page, 'KeyW');
  // ---- >= 90 s real loop walk: street <-> lane A <-> lane B ------------------
  const route = await page.evaluate(async () => (await (await fetch('./world/fangbang-temple-v7/route.json')).json()));
  const loop = [
    ...route.laneBExcursion.map(([x, , z]) => [x, z]).reverse(),        // pocket -> street
    [80, 24], [65, 19],                                                 // street west
    ...route.laneAExcursion.map(([x, , z]) => [x, z]),                  // into A
    ...route.laneAExcursion.map(([x, , z]) => [x, z]).reverse(),        // back out
    [50, 8], [60, 12],                                                  // street east
    ...route.laneBExcursion.map(([x, , z]) => [x, z]),                  // into B
  ];
  const WALK_SECONDS = 95;
  const tStart = Date.now();
  const getFeet = () => page.evaluate(() => window.__fangbangRecord().camera.feet);
  let wi = 1, lastFeet = null, lastDist = null, lookSign = 1;
  while ((Date.now() - tStart) / 1000 < WALK_SECONDS) {
    const feet = await getFeet();
    // heading from real movement (page yaw: forward = (-sin yaw, -cos yaw))
    let heading = null;
    if (lastFeet && Math.hypot(feet[0] - lastFeet[0], feet[2] - lastFeet[2]) > 0.05)
      heading = Math.atan2(-(feet[0] - lastFeet[0]), -(feet[2] - lastFeet[2]));
    const tgt = loop[wi % loop.length];
    const dist = Math.hypot(tgt[0] - feet[0], tgt[1] - feet[2]);
    if (dist < 1.4) { wi++; lastDist = null; }
    else if (heading !== null) {
      if (lastDist !== null && dist > lastDist + 0.35) lookSign = -lookSign;   // turning the wrong way
      const want = Math.atan2(-(tgt[0] - feet[0]), -(tgt[2] - feet[2]));
      let d = want - heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > 0.12)
        await mouseTurn(page, lookSign * Math.max(-140, Math.min(140, d / 0.0023)));
    }
    lastDist = dist; lastFeet = feet;
    await page.waitForTimeout(180);
  }
  await key(page, 'KeyW', 'keyup');

  // ---- 3 x P/V round trips with A/B entrance relocations ----------------------
  const cycles = [];
  const resNow = () => page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { triangles: r.resources?.triangles, geometries: r.resources?.uniqueGeometries,
      materials: r.resources?.uniqueMaterials, textures: r.resources?.uniqueTextures,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      blocks: r.blocks?.active()?.length ?? r.blocks?.activeIds?.length ?? null, epoch: r.blocks?.epoch ?? null };
  });
  for (let i = 0; i < 3; i++) {
    // P pause + resume
    await key(page, 'KeyP'); await page.waitForTimeout(150);
    await key(page, 'KeyP'); await page.waitForTimeout(150);
    // V view-mode (pose kept) -> re-enter walk
    await key(page, 'KeyV'); await page.waitForTimeout(200);
    await page.evaluate(() => window.__fangbangStartWalk()); await page.waitForTimeout(200);
    // A/B entrance relocation round trip (explicit entry, real anchor set)
    const aId = anchors.find((a) => /a/i.test(a.id) && !/b/i.test(a.id))?.id ?? anchors[0]?.id;
    const bId = anchors.find((a) => /b/i.test(a.id))?.id ?? anchors[anchors.length - 1]?.id;
    for (const id of [aId, bId].filter(Boolean)) {
      await page.evaluate((id) => window.__fangbangRelocate(id), id);
      await page.waitForTimeout(250);
    }
    cycles.push({ cycle: i + 1, resources: await resNow() });
  }
  const monotonic = (() => {
    const tri = cycles.map((c) => c.resources.triangles);
    const geo = cycles.map((c) => c.resources.geometries);
    const grows = (arr) => arr.length > 1 && arr.some((v, i) => i > 0 && v > arr[i - 1]);
    return { triangles: tri, geometries: geo, monotonicGrowth: grows(tri) || grows(geo) };
  })();

  // frame-interval stats from rAF timestamps (exclude hidden/unfocused frames)
  const stats = await page.evaluate(({ originFilter }) => {
    const s = window.__samples.filter((x) => x[0] >= originFilter);
    const good = [], flagged = [];
    for (let i = 1; i < s.length; i++) {
      if (!s[i][1] || !s[i - 1][1] || !s[i][2] || !s[i - 1][2]) { flagged.push(s[i]); continue; }
      good.push(s[i][0] - s[i - 1][0]);
    }
    good.sort((a, b) => a - b);
    const q = (p) => good.length ? +good[Math.min(good.length - 1, Math.floor(p * good.length))].toFixed(2) : null;
    return { frames: good.length + flagged.length, flaggedHiddenOrBlur: flagged.length,
      intervals: good, p50Ms: q(0.5), p95Ms: q(0.95), maxMs: good.length ? +good[good.length - 1].toFixed(2) : null };
  }, { originFilter: 0 });

  const finalRec = await page.evaluate(() => {
    const r = window.__fangbangRecord();
    return { mode: r.mode, paused: r.paused, triangles: r.resources?.triangles,
      session: r.session, walkResets: r.walking?.walkResets };
  });
  await page.close();

  return {
    config: name, query,
    load: { readyAfterMs: readyAtMs, domContentLoadedAfterMs: domLoadedAt - t0, firstValidFrameAfterReadyMs: rec0.firstFrameAfterReady,
      pageLoadStats: rec0.load },
    env, triangles: rec0.triangles, framebuffer: rec0.framebuffer,
    walkLoop: { secondsTarget: WALK_SECONDS, waypoints: loop.length, stats: { frames: stats.frames, flaggedHiddenOrBlur: stats.flaggedHiddenOrBlur, p50Ms: stats.p50Ms, p95Ms: stats.p95Ms, maxMs: stats.maxMs },
      rawSampleCount: stats.intervals.length,
      rawFirst60: stats.intervals.slice(0, 60) },
    pvCycles: cycles, monotonic,
    final: finalRec,
  };
}

let failures = 0;
const note = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  -- ' + detail : ''}`);
  if (!ok) { failures++; report.pass = false; }
};

try {
  for (const [name, query] of [['default', ''], ['skins+props', '&skins=1&props=1']]) {
    const cfg = await runConfig(name, query);
    report.configs.push(cfg);
    note(cfg.load.readyAfterMs > 0 && cfg.triangles > 0, `${name}: page ready + counted`, `ready=${cfg.load.readyAfterMs}ms tris=${cfg.triangles}`);
    note(cfg.env.rendererString?.length > 0, `${name}: renderer recorded`, String(cfg.env.rendererString));
    const w = cfg.walkLoop.stats;
    note(w.frames >= 90 * 20, `${name}: loop walk sampled enough real frames`, `frames=${w.frames} flagged=${w.flaggedHiddenOrBlur}`);
    note(w.p50Ms !== null && w.p95Ms !== null, `${name}: frame intervals P50/P95 from rAF timestamps`, `P50=${w.p50Ms}ms P95=${w.p95Ms}ms (SwiftShader software baseline)`);
    note(!cfg.monotonic.monotonicGrowth, `${name}: no monotonic resource growth over 3 P/V + A/B cycles`, JSON.stringify(cfg.monotonic));
  }
} finally {
  await browser.close();
  proc.kill();
}

report.env.finishedAt = new Date().toISOString();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 1) + '\n');
console.log(failures === 0 ? 'RUNTIME_BASELINE_PASS' : `RUNTIME_BASELINE_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
