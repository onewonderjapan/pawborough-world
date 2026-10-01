// Reproducible G2 browser evidence: real render+raw physics, one capsule for
// the forward/return journey. Accelerated fixed steps are NOT hardware FPS.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const ART = path.resolve(process.env.ART_DIR || (() => { throw new Error('ART_DIR required outside workspace'); })());
const BASE = process.env.BASE || 'http://127.0.0.1:5601/';
const route = JSON.parse(fs.readFileSync(path.join(ART, 'THROUGH-ROUTE.json'), 'utf8'));
// 浏览器：WALK_CHROME 环境变量优先，否则 Playwright 自带；GPU_WEBGL=1 时 headless:false 走真 GPU（需外部 DISPLAY/XAUTHORITY）。
const GPU = process.env.GPU_WEBGL === '1';
const browser = await chromium.launch({ ...(process.env.WALK_CHROME ? { executablePath: process.env.WALK_CHROME } : {}),
  headless: !GPU, args: GPU ? ['--no-sandbox'] : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const renderFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const requests = [], errors = [];
page.on('request', r => { if (r.url().includes('/out/')) requests.push({ at: Date.now(), file: new URL(r.url()).pathname }); });
page.on('pageerror', e => errors.push(e.message));
let release;
const held = new Promise(resolve => { release = resolve; });
await page.route('**/zone-fangbang-*.cm.glb', async r => { await held; await r.continue(); });
await page.goto(BASE);
await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
const firstLoad = await page.evaluate(() => ({ ...window.__loadTimes, zones: window.__zonesLoaded }));
assert.ok(firstLoad.firstLoadBytes <= 20000000);
assert.ok(!firstLoad.firstLoadZones.includes('fangbang'));
assert.ok(!requests.some(r => /zone-fangbang/.test(r.file)), 'Fangbang stays on demand before walk');
await page.evaluate(async () => {
  await window.__walk.spawnAt('center');
  const c = window.__walk.controller;
  c.yaw = -Math.PI / 2; c.setMoveInput(1, 0);
  for (let i = 0; i < 60; i++) c.step(1 / 60);
  c.pause(); window.__activationController = c;
});
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const before = await page.evaluate(() => window.__walk.status());
release();
await page.waitForFunction(() => window.__walk.status().zones.includes('fangbang') && !window.__walk.zonePhysics.status().pending.length, undefined, { timeout: 120000 });
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const after = await page.evaluate(() => ({ ...window.__walk.status(), sameController: window.__activationController === window.__walk.controller }));
assert.ok(after.sameController); assert.ok(after.paused);
assert.deepEqual(after.feet, before.feet);
assert.deepEqual(after.camera, before.camera);
assert.deepEqual(after.cameraRotation, before.cameraRotation);
assert.equal(after.yaw, before.yaw);
const repeated = await page.evaluate(async () => {
  const w = window.__walk.zonePhysics, before = w.status(); await w.loadZone('fangbang');
  return { before, after: w.status(), activations: w.events.filter(e => e.zone === 'fangbang' && e.state === 'active').length };
});
assert.deepEqual(repeated.before, repeated.after); assert.equal(repeated.activations, 1);
const activation = { before, after, feetDelta: 0, cameraDelta: 0, cameraRotationDelta: 0, repeated,
  requestMode: 'natural onFeet proximity; real compressed responses delayed until paused pose captured' };
fs.writeFileSync(path.join(ART, 'BROWSER-ACTIVATION.json'), JSON.stringify({ time: new Date().toISOString(), firstLoad, activation, requests }, null, 2) + '\n');

await page.unroute('**/zone-fangbang-*.cm.glb');
await page.goto(new URL('?zone=fangbang&walk=1&at=fangbang-street', BASE).href);
await page.waitForFunction(() => window.__walk?.status().anchor === 'fangbang-street' && window.__walk.status().physicsReady && window.__walk.status().zones.includes('fangbang'), undefined, { timeout: 120000 });
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const setup = await page.evaluate(async route => {
  const { CruiseDriver } = await import('/vendor-src/player/cruise.js');
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  const c = window.__walk.controller, z = window.__walk.zonePhysics, physics = z.physics;
  c.pause();
  const grounds = new Set(z.groundColliders.map(c => c.handle)), walls = new Set(physics.colliders.map(c => c.handle));
  const shape = new RAPIER.Capsule(.6, .35);
  const origTeleport = c.teleport.bind(c); let teleportCalls = 0;
  c.teleport = (...args) => { teleportCalls++; return origTeleport(...args); };
  const run = { controller: c, body: c.body, world: physics.world, route, direction: 'forward', steps: 0,
    minClearance: Infinity, maxDeviation: 0, trace: [], failure: null, CruiseDriver, RAPIER, grounds, walls, shape,
    teleportCalls: () => teleportCalls };
  run.driver = new CruiseDriver({ controller: c, waypoints: route.points.map(([x, z]) => [x, 0, z]), reachRadius: .18, timeoutSteps: 72000 });
  window.__throughRun = run;
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { initial: window.__walk.status(), initialPlacement: 'production fangbang-street anchor only',
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
}, route);
const shotTargets = [
  { name: 'shanmen-approach', waypoint: route.points.findIndex(p => Math.hypot(p[0] + 72.222, p[1] - 22.082) < .01) },
  ...route.stations.filter(s => ['street-to-temple-rear', 'pinned-bazaar-center', 'existing-garden-gate-to-sansuitang'].includes(s.name)),
];
await renderFrame();
await page.screenshot({ path: path.join(ART, 'through-forward-start.png') });
const results = [];
for (const direction of ['forward', 'return']) {
  if (direction === 'return') await page.evaluate(() => {
    const r = window.__throughRun; r.direction = 'return'; r.steps = 0; r.trace = []; r.minClearance = Infinity; r.maxDeviation = 0;
    r.driver = new r.CruiseDriver({ controller: r.controller, waypoints: [...r.route.points].reverse().map(([x, z]) => [x, 0, z]), reachRadius: .18, timeoutSteps: 72000 });
  });
  const shot = new Set();
  let status;
  do {
    status = await page.evaluate(() => {
      const r = window.__throughRun, c = r.controller, physics = window.__walk.zonePhysics.physics;
      const pts = r.direction === 'forward' ? r.route.points : [...r.route.points].reverse();
      c.resume();
      for (let i = 0; i < 240 && !r.driver.done && !r.failure; i++) {
        r.driver.tick(1 / 60); c.step(1 / 60); r.steps++;
        const f = c.feetPosition(), top = f[1] + .2;
        const h = physics.world.castRay(new r.RAPIER.Ray({ x: f[0], y: top, z: f[2] }, { x: 0, y: -1, z: 0 }), 4, true,
          undefined, undefined, c.collider, undefined, cc => r.grounds.has(cc.handle));
        const y = h ? top - h.timeOfImpact : null;
        const wall = physics.world.intersectionWithShape(c.body.translation(), { x: 0, y: 0, z: 0, w: 1 }, r.shape,
          undefined, undefined, c.collider, undefined, cc => r.walls.has(cc.handle));
        if (!f.every(Number.isFinite)) r.failure = 'nonfinite feet';
        else if (y === null || f[1] - y < -.05) r.failure = 'actual support failure';
        else if (wall) r.failure = 'capsule intersects wall';
        r.minClearance = Math.min(r.minClearance, y === null ? -Infinity : f[1] - y);
        if (r.steps % 60 === 0) {
          let dev = Infinity;
          for (let j = 1; j < pts.length; j++) {
            const a = pts[j - 1], b = pts[j], dx = b[0] - a[0], dz = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((f[0] - a[0]) * dx + (f[2] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
            dev = Math.min(dev, Math.hypot(f[0] - a[0] - dx * t, f[2] - a[1] - dz * t));
          }
          r.maxDeviation = Math.max(r.maxDeviation, dev);
          r.trace.push({ step: r.steps, feet: f, supportY: y, waypoint: r.driver.i });
        }
      }
      c.pause();
      return { ...r.driver.status(), steps: r.steps, failure: r.failure, waypoint: r.driver.i, feet: c.feetPosition() };
    });
    for (const target of shotTargets) {
      const waypoint = direction === 'forward' ? target.waypoint : route.points.length - 1 - target.waypoint;
      if (status.waypoint >= waypoint && !shot.has(target.name)) {
        shot.add(target.name);
        await renderFrame();
        await page.screenshot({ path: path.join(ART, `through-${direction}-${target.name}.png`) });
      }
    }
  } while (!status.done && !status.failure);
  await renderFrame();
  const result = await page.evaluate(() => {
    const r = window.__throughRun, c = r.controller;
    const end = r.direction === 'forward' ? r.route.points.at(-1) : r.route.points[0], f = c.feetPosition();
    return { direction: r.direction, driver: r.driver.status(), steps: r.steps, failure: r.failure,
      minSupportClearance: r.minClearance, maxDeviation: r.maxDeviation, endpointError: Math.hypot(f[0] - end[0], f[2] - end[1]), trace: r.trace,
      sameController: c === window.__walk.controller, sameBody: c.body === r.body, sameWorld: window.__walk.zonePhysics.physics.world === r.world,
      midJourneyTeleportCalls: r.teleportCalls(), final: window.__walk.status() };
  });
  result.pass = !result.failure && result.driver.done && !result.driver.blocked && result.endpointError <= 1 && result.maxDeviation <= 2
    && result.sameController && result.sameBody && result.sameWorld && result.midJourneyTeleportCalls === 0;
  results.push(result); console.log(direction, result.pass ? 'PASS' : 'FAIL', { steps: result.steps, failure: result.failure, endpointError: result.endpointError });
  await page.screenshot({ path: path.join(ART, `through-${direction}-end.png`) });
  if (!result.pass) break;
}
const report = { time: new Date().toISOString(), pass: results.length === 2 && results.every(r => r.pass) && errors.length === 0,
  method: 'S1 Chromium SwiftShader rendering; accelerated 60Hz CruiseDriver -> production WalkController against actual raw zone GLB/Rapier. Not human walk or W2 performance.',
  setup, activation, firstLoad, topology: route.topology, results, requests, errors };
fs.writeFileSync(path.join(ART, 'THROUGH-BROWSER-CHECK.json'), JSON.stringify(report, null, 2) + '\n');
await browser.close();
assert.ok(report.pass, 'continuous browser forward/return proof');
