// Official review harness: isolated browser, real simulation, incremental steps.
// No teleport, collection writes, body transforms or simulation fast-forward.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../scene-authoring/yuyuan-area/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
const port = Number(arg('--port') ?? 5971);
const variant = arg('--variant') ?? 'full';
const output = path.resolve(arg('--output') ?? '/tmp/pawborough-standard-play');
const route = JSON.parse(await fs.readFile(path.join(root, 'docs/playtest-20261003/official-route.json'), 'utf8'));
const resume = arg('--resume') ? JSON.parse(await fs.readFile(arg('--resume'), 'utf8')) : null;
if (!route.variants[variant]) throw Error('Unknown route variant');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
// A recovery fixture must be exported from this reviewer's actual progress.
// The production save validator, not the harness, places the restored player.
if (resume) await page.addInitScript(save => {
  if (!localStorage.getItem('pawborough.play.walk.v2')) localStorage.setItem('pawborough.play.walk.v2', JSON.stringify(save));
}, resume.save);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
const state = async () => page.evaluate(() => {
  const s = window.__play?.status();
  const actor = window.__scene?.getObjectByName('play-gray-cat');
  const held = s && window.__scene?.getObjectByName(`play-held-${s.heldItem ?? s.basketItem}`);
  return { ...s, actorVisible: actor?.visible, foodUuid: held?.uuid, camera: window.__cam?.() };
});
const emit = async (kind, data) => {
  const row = { time: new Date().toISOString(), kind, ...data };
  await fs.appendFile(path.join(output, 'events.jsonl'), JSON.stringify(row) + '\n', 'utf8');
  return row;
};
const snapshot = async name => {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file });
  await emit('snapshot', { name, file, state: await state() });
  return file;
};
await page.goto(arg('--base') ?? route.baseUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__walk?.controller && window.__play?.status().atlasReady && window.__play.status().foodsReady,
  undefined, { timeout: 60000 });
// Geometry warmup changes loading only. The normal center spawn stays intact.
await page.evaluate(() => window.__walk.zonePhysics.loadZones(['garden', 'pond', 'temple', 'bazaar', 'outer', 'fangbang']));
await page.waitForTimeout(500);
const renderer = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
});
if (!/NVIDIA.*GB10/.test(renderer)) throw Error(`Hardware GPU unavailable: ${renderer}`);
await emit('boot', { routeId: route.id, baseCommit: route.baseCommit, variant, renderer, state: await state() });

async function go(points, label) {
  const begin = Date.now();
  let progressAt = begin, previous = (await state()).feet;
  // On a retry, rejoin a nearby valid waypoint instead of replaying the whole
  // completed leg backwards. The physical controller still tests every move.
  let first = 0;
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i].x - previous[0], points[i].z - previous[2]) <
    Math.hypot(points[first].x - previous[0], points[first].z - previous[2])) first = i;
  if (Math.hypot(points[first].x - previous[0], points[first].z - previous[2]) > 2) first = 0;
  for (let i = first; i < points.length; i++) {
    const goal = points[i];
    while (true) {
      const s = await state(), f = s.feet;
      if (!f || f[1] < -.1 || s.paused || s.riding || s.eating) throw Error(`Navigation unsafe ${label}: ${JSON.stringify({ feet: f, paused: s.paused, riding: s.riding, eating: s.eating })}`);
      const d = Math.hypot(goal.x - f[0], goal.z - f[2]);
      if (d <= .16) break;
      if (Math.hypot(f[0] - previous[0], f[2] - previous[2]) > .06) { progressAt = Date.now(); previous = f; }
      if (Date.now() - progressAt > 5000 || Date.now() - begin > 240000) throw Error(`Navigation stalled ${label} waypoint ${i} at ${f}`);
      await page.evaluate(g => {
        const c = window.__walk.controller, f = c.feetPosition();
        const yaw = Math.atan2(f[0] - g.x, f[2] - g.z);
        let delta = c.yaw - yaw; delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        c.look(delta, 0); // same view input as mouse; no body transform
        c.setRunning(Math.hypot(g.x - f[0], g.z - f[2]) > 2);
        c.setMoveInput(1, 0); // production controller owns all displacement
      }, goal);
      await page.waitForTimeout(40);
    }
  }
  await page.evaluate(() => { const c = window.__walk.controller; c.setMoveInput(0, 0); c.setRunning(false); });
  await emit('arrived', { label, elapsedMs: Date.now() - begin, state: await state() });
}
async function take(id) {
  await page.waitForTimeout(700);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.keyboard.press('e');
    try { await page.waitForFunction(id => window.__play.status().heldItem === id, id, { timeout: 2000 }); break; }
    catch { await emit('cold-preparation-or-take-retry', { id, attempt, state: await state() }); }
  }
  if ((await state()).heldItem !== id) throw Error(`Could not take ${id}`);
  await snapshot(`${id}-held`);
}
async function eat(id, journal = false) {
  await page.keyboard.press('f');
  await page.waitForFunction(id => window.__play.status().eating?.foodId === id, id, { timeout: 5000 });
  await page.waitForTimeout(1000);
  await snapshot(`${id}-eating-default-view`);
  if (journal) {
    await page.keyboard.press('b'); await page.waitForSelector('.pb-atlas:not([hidden])');
    const before = await state(); await page.waitForTimeout(1000); const after = await state();
    await emit('atlas-eating-pause', { beforeElapsed: before.eating?.elapsed, afterElapsed: after.eating?.elapsed });
    if (Math.abs((before.eating?.elapsed ?? 0) - (after.eating?.elapsed ?? 0)) > .03) throw Error('Atlas did not freeze eating');
    await snapshot('atlas-during-meal'); await page.keyboard.press('Escape');
  }
  await page.waitForFunction(id => window.__play.status().tasted.includes(id) && !window.__play.status().eating, id, { timeout: 15000 });
  await emit('tasted', { id, state: await state() });
}
let index = resume?.index ?? 0, busy = false;
const sequence = route.variants[variant];
if (resume && route.checkpoints.find(c => c.id === sequence[index])?.action !== 'final' && Math.hypot((await state()).feet[0] - resume.save.feet[0],
  (await state()).feet[2] - resume.save.feet[2]) > 1) {
  // The game's validator rejected a blocked pose. Restart the guide at the
  // actual safe spawn, preserving legitimately earned collection progress.
  index = 0;
  await emit('recovery-safe-spawn-restart', { requestedIndex: resume.index, state: await state() });
}
async function step() {
  const id = sequence[index]; if (!id) return { complete: true, state: await state() };
  const cp = route.checkpoints.find(c => c.id === id);
  await emit('checkpoint-start', { id, title: cp.title, state: await state() });
  if (index > 0 && cp.action !== 'final') await go(route.legs[`${sequence[index - 1]}>${id}`].waypoints, id);
  if (cp.action === 'meal' || cp.action === 'journalMeal') { await take(cp.foodId); await eat(cp.foodId, cp.action === 'journalMeal'); }
  if (cp.action === 'take') await take(cp.foodId);
  if (cp.action === 'bike') {
    const s = await state(); const pos = s.vehicle?.pos;
    if (!pos) throw Error('Bicycle unavailable');
    await go([{ x: pos[0], y: pos[1], z: pos[2] }], 'bike-near-center');
    const uuid = (await state()).foodUuid;
    await page.keyboard.press('r'); await page.waitForFunction(() => window.__play.status().riding);
    await snapshot('bike-mounted');
    if ((await state()).basketItem !== 'boboji') throw Error('Held skewer did not transfer to basket');
    await page.keyboard.down('w'); await page.waitForTimeout(2200); await page.keyboard.up('w');
    await page.keyboard.press('Escape'); const paused = await state(); await snapshot('bike-escape');
    await page.waitForTimeout(700); await emit('bike-paused', { paused, later: await state() });
    await page.keyboard.press('p');
    await page.keyboard.down('s'); await page.waitForTimeout(4200); const reverse = await state(); await page.keyboard.up('s');
    if (!(reverse.rideSpeed < 0)) throw Error('Bicycle did not enter reverse');
    await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.up('Space');
    await page.keyboard.press('r'); await page.waitForFunction(() => !window.__play.status().riding);
    const restored = await state();
    await emit('bike-transfer', { beforeUuid: uuid, afterUuid: restored.foodUuid, reverseSpeed: reverse.rideSpeed, state: restored });
    if (uuid !== restored.foodUuid || restored.heldItem !== 'boboji') throw Error('Bike returned wrong food instance');
    await eat('boboji'); await go([{ ...route.checkpoints[0].point }], 'return-plaza');
  }
  if (cp.action === 'seam') {
    await go([{ x: -95.5, y: .09, z: 20.75 }, { x: -98, y: .02, z: 20.75 }], 'seam-two-directions');
    await snapshot('seam-two-directions');
  }
  if (cp.action === 'final') {
    await page.keyboard.press('b'); await page.waitForSelector('.pb-atlas:not([hidden])'); await snapshot('atlas-final');
    await page.setViewportSize({ width: 360, height: 800 }); await snapshot('atlas-mobile');
    await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1280, height: 720 });
    const before = await state(); await page.reload();
    await page.waitForFunction(() => window.__play?.status?.()?.atlasReady && window.__play?.status?.()?.foodsReady);
    const after = await state(); if (before.stamps !== after.stamps) throw Error('Reload lost collection');
    await emit('reload-preserved', { before, after });
    await page.goto(route.baseUrl + '&light=night'); await page.waitForFunction(() => window.__play?.status?.()?.atlasReady && window.__play?.status?.()?.foodsReady);
    await snapshot('night-plaza');
  }
  const shot = await snapshot(id); index++;
  const result = { id, title: cp.title, complete: index === sequence.length, next: sequence[index] ?? null, screenshot: shot, state: await state(), errors };
  await emit('checkpoint-complete', result); return result;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (req.url === '/status') return res.end(JSON.stringify({ variant, index, next: sequence[index], busy, state: await state(), errors }));
  if (req.method !== 'POST' || req.url !== '/step') { res.statusCode = 404; return res.end('{"error":"unknown operation"}'); }
  if (busy) { res.statusCode = 409; return res.end('{"error":"step running"}'); }
  busy = true;
  try { res.end(JSON.stringify({ ok: true, ...await step() })); }
  catch (e) {
    await page.evaluate(() => window.__walk?.controller?.clearKeys());
    const shot = await snapshot(`blocked-${sequence[index]}`);
    const row = { ok: false, checkpoint: sequence[index], error: String(e), screenshot: shot, state: await state() };
    await emit('checkpoint-blocked', row); res.end(JSON.stringify(row));
  } finally { busy = false; }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, port, variant, output, renderer })));
const close = async () => { server.close(); await browser.close(); process.exit(0); };
process.on('SIGTERM', close); process.on('SIGINT', close);
