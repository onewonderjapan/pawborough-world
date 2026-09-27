// Unique G2 continuous forward + return check. Actual raw GLB, production
// AreaWalkPhysics/WalkController/CruiseDriver; all writes stay in ART_DIR.
// Existing commercial pins are read unchanged, never updated here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { AreaWalkPhysics } from '../src/areaWalkPhysics.js';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';
import { WalkController } from '../../../src/player/WalkController.js';
import { CruiseDriver } from '../../../src/player/cruise.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
if (!process.env.ART_DIR) throw new Error('ART_DIR must explicitly point outside the workspace');
const ART = path.resolve(process.env.ART_DIR);
const REPO = path.resolve(AREA, '../..');
if (ART === REPO || ART.startsWith(REPO + path.sep)) throw new Error('ART_DIR must be outside workspace');
fs.mkdirSync(ART, { recursive: true });
const json = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const manifest = json('zones-manifest.json');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const sourceHashes = [];
for (const e of manifest.zones.filter(e => e.file)) {
  const b = fs.readFileSync(path.join(OUT, e.file));
  assert.equal(hash(b), e.sha256, `real GLB hash ${e.file}`);
  assert.ok(b.length <= 12000000, `raw part budget ${e.file}`);
  sourceHashes.push({ file: e.file, bytes: b.length, sha256: hash(b) });
}
const pinBytes = fs.readFileSync(path.join(AREA, 'baseline/commercial-route.pinned.json'));
const pin = JSON.parse(pinBytes);
const commercial = json('commercial-route.json');
for (const r of pin.routes) assert.deepEqual(commercial.routes.find(c => c.from === r.from && c.to === r.to)?.points, r.points);
const fg = json('fangbang-route.json');
const layout = json('layout.json');
const nav = json('nav-gap.json');
const zones = ['garden', 'pond', 'temple', 'bazaar', 'outer'];
await RAPIER.init();
const world = new AreaWalkPhysics({ RAPIER, manifest,
  readJson: async f => json(f), readBytes: async f => fs.readFileSync(path.join(OUT, f)) });
await world.loadZones(zones);
const physics = world.physics;
const capsule = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const activationController = new WalkController({ RAPIER, physics, capsule: { ...capsule, spawn: [nav.anchors.center[0], .06, nav.anchors.center[1]] } });
activationController.setMoveInput(1, 0);
for (let i = 0; i < 60; i++) activationController.step(1 / 60);
activationController.pause();
const before = activationController.feetPosition();
const oldWorld = physics.world;
await Promise.all([world.loadZone('fangbang'), world.loadZone('fangbang')]);
assert.equal(world.physics.world, oldWorld);
assert.deepEqual(activationController.feetPosition(), before);
assert.equal(activationController.paused, true);
assert.equal(world.events.filter(e => e.zone === 'fangbang' && e.state === 'active').length, 1);
const activation = { feetBefore: before, feetAfter: activationController.feetPosition(), feetDelta: 0,
  sameController: true, sameWorld: true, pausedPreserved: true, activationCount: 1 };
activationController.dispose();

// A missing raw part must reject before activation; retries cannot mark it ready.
const negative = new AreaWalkPhysics({ RAPIER, manifest, readJson: async f => json(f),
  readBytes: async f => { if (f.includes('fangbang')) throw new Error('injected missing actual raw GLB'); return fs.readFileSync(path.join(OUT, f)); } });
await negative.loadZones(['garden']);
const previousCounts = negative.status();
await assert.rejects(negative.loadZone('fangbang'), /missing actual raw GLB/);
assert.deepEqual(negative.status(), previousCounts);
negative.physics.dispose();

const groundHandles = new Set(world.groundColliders.map(c => c.handle));
const wallHandles = new Set(physics.colliders.map(c => c.handle));
const groundY = (x, z, top = 2) => {
  const hit = physics.world.castRay(new RAPIER.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 4, true,
    undefined, undefined, undefined, undefined, c => groundHandles.has(c.handle));
  return hit ? top - hit.timeOfImpact : null;
};
const boxes = [...world.zones.values()].flatMap(p => p.file.colliders).map(obbToWorld);
const validCache = new Map();
function valid(x, z) {
  const key = `${x},${z}`;
  if (validCache.has(key)) return validCache.get(key);
  const y = groundY(x, z);
  // Search real paved surfaces including the existing bridge deck, never the
  // outer background plane. This is planning only; actual walking checks follow.
  let ok = y !== null && y > -.2 && y < 1.5;
  if (ok) for (const b of boxes) {
    if (b.center[1] + b.halfExtents[1] < y + .3 || b.center[1] - b.halfExtents[1] > y + 1.9) continue;
    const dx = x - b.center[0], dz = z - b.center[2], c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const qx = Math.max(Math.abs(c * dx - s * dz) - b.halfExtents[0], 0);
    const qz = Math.max(Math.abs(s * dx + c * dz) - b.halfExtents[2], 0);
    if (qx * qx + qz * qz < .55 ** 2) { ok = false; break; }
  }
  validCache.set(key, ok); return ok;
}
function search(start, end) {
  const quant = p => p.map(v => Math.round(v * 2));
  const s = quant(start), e = quant(end), key = p => p.join(',');
  const sk = key(s), ek = key(e);
  const nodes = new Map([[sk, { p: s, g: 0, f: Math.hypot(s[0] - e[0], s[1] - e[1]), from: null }]]);
  const open = [nodes.get(sk)], closed = new Set();
  let found = null;
  while (open.length) {
    open.sort((a, b) => b.f - a.f);
    const n = open.pop(), nk = key(n.p);
    if (closed.has(nk)) continue;
    closed.add(nk);
    if (nk === ek) { found = n; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = [n.p[0] + dx, n.p[1] + dz], k = key(p);
      if (p[0] < -500 || p[0] > -80 || p[1] < -390 || p[1] > 90 || closed.has(k) || !valid(p[0] / 2, p[1] / 2)) continue;
      if (dx && dz && (!valid(n.p[0] / 2 + dx / 2, n.p[1] / 2) || !valid(n.p[0] / 2, n.p[1] / 2 + dz / 2))) continue;
      const g = n.g + Math.hypot(dx, dz);
      if (!nodes.has(k) || nodes.get(k).g > g) {
        const next = { p, g, f: g + Math.hypot(p[0] - e[0], p[1] - e[1]), from: n };
        nodes.set(k, next); open.push(next);
      }
    }
  }
  assert.ok(found, `real-ground link ${start} -> ${end}`);
  const points = [];
  while (found) { points.push(found.p.map(v => v / 2)); found = found.from; }
  points.reverse(); points[0] = start; points[points.length - 1] = end;
  return points;
}
const streetStart = fg.mainStreet.findIndex(p => p[0] < 138 && p[0] >= 54);
assert.ok(streetStart >= 0);
const roadFork = fg.junction.pointIndex - 3;
assert.deepEqual(fg.mainStreet[roadFork], [-72.222, 0, 22.082]);
const to2 = p => [p[0], p[2]];
const temple = fg.mainStreet.slice(streetStart).map(to2);
const templeExit = fg.mainStreet.slice(roadFork).map(to2).reverse();
const linkWest = search(to2(fg.mainStreet[roadFork]), nav.anchors.main);
const center = pin.routes.find(r => r.from === 'main' && r.to === 'center').points;
const jiuqu = pin.routes.find(r => r.from === 'main' && r.to === 'jiuqu').points;
const gardenPath = layout.objects.find(o => o.id === 'path-gate-sansuitang').geometry.polyline;
const bridge = layout.objects.find(o => o.id === 'jiuqu-bridge').geometry.polyline;
const westStep = layout.objects.find(o => o.id === 'jiuqu-bridge-step-w').geometry;
const eastStep = layout.objects.find(o => o.id === 'jiuqu-bridge-step-e').geometry;
const stepAt = (g, d) => [g.position[0] + Math.sin(g.rotY) * d, g.position[1] + Math.cos(g.rotY) * d];
// Reuse the independently verified bridge entrance definition: centre of
// the last existing tread, not an inferred point beyond the landing.
const stairBottom = g => stepAt(g, -(0.18 + (g.stepCount - 1) * .32));
const westBack = stepAt(westStep, -2.4);
const westApproach = search(nav.anchors.jiuqu, westBack);
const eastBottom = stairBottom(eastStep);
const acrossStep = (g, d, across) => {
  const p = stepAt(g, d);
  return [p[0] + Math.cos(g.rotY) * across, p[1] - Math.sin(g.rotY) * across];
};
// Actual road reaches the western side at d=-.75; join through the lowest
// existing tread edge instead of approaching the .4225m upper tread side.
const eastLowEdge = acrossStep(eastStep, -1.14, -1.0);
const eastExit = acrossStep(eastStep, -.75, -1.5);
const gardenApproach = search(eastExit, gardenPath[0]);
const linkGarden = [...westApproach, stairBottom(westStep), ...bridge,
  eastBottom, eastLowEdge, eastExit, ...gardenApproach];
const segments = [
  ['street-to-temple-rear', temple], ['temple-rear-to-existing-shanmen-exit', templeExit],
  ['existing-west-street-link', linkWest], ['pinned-bazaar-center', center],
  ['pinned-center-return', [...center].reverse()], ['pinned-jiuqu-approach', jiuqu],
  ['existing-paved-garden-link', linkGarden], ['existing-garden-gate-to-sansuitang', gardenPath],
];
const points = [];
const stations = [];
for (const [name, pts] of segments) {
  for (const p of pts) if (!points.length || Math.hypot(p[0] - points.at(-1)[0], p[1] - points.at(-1)[1]) > 1e-9) points.push([...p]);
  stations.push({ name, waypoint: points.length - 1, xz: points.at(-1) });
}
const route = { schema: 1, topology: 'temple interior visited; returns through existing south Shanmen before bazaar/garden; no new north/west exit',
  points, stations, links: { west: linkWest, garden: linkGarden }, pinSha256: hash(pinBytes), sourceHashes };
fs.writeFileSync(path.join(ART, 'THROUGH-ROUTE.json'), JSON.stringify(route, null, 2) + '\n');
const start = points[0], sy = groundY(...start);
assert.notEqual(sy, null);
const controller = new WalkController({ RAPIER, physics, capsule: { ...capsule, spawn: [start[0], sy + .05, start[1]] } });
const shape = new RAPIER.Capsule(.6, .35);
const results = [], stationSnapshots = [];
function deviation(feet, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((feet[0] - ax) * dx + (feet[2] - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(feet[0] - ax - t * dx, feet[2] - az - t * dz));
  }
  return best;
}
for (const [direction, pts] of [['forward', points], ['return', [...points].reverse()]]) {
  const driver = new CruiseDriver({ controller, waypoints: pts.map(([x, z]) => [x, 0, z]), reachRadius: .18, timeoutSteps: 60 * 1200 });
  const trace = [];
  let steps = 0, failure = null, minSupportClearance = Infinity, maxDeviation = 0;
  const capture = (name) => stationSnapshots.push({ direction, name, steps, feet: controller.feetPosition(), eye: controller.eyePosition(), yaw: controller.yaw });
  capture('start');
  let previousWaypoint = 0, stalledSteps = 0, lastProgressFeet = controller.feetPosition();
  while (!driver.done) {
    driver.tick(1 / 60); controller.step(1 / 60); steps++;
    const feet = controller.feetPosition();
    const gy = groundY(feet[0], feet[2], feet[1] + .2);
    const pos = controller.body.translation();
    const wall = physics.world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape,
      undefined, undefined, controller.collider, undefined, c => wallHandles.has(c.handle));
    if (!feet.every(Number.isFinite)) failure = 'nonfinite feet';
    else if (gy === null) failure = 'missing actual GLB support';
    else if (feet[1] - gy < -.05) failure = `below support by ${(feet[1] - gy).toFixed(6)}m`;
    else if (wall) failure = `capsule intersects wall handle ${wall.handle}`;
    minSupportClearance = Math.min(minSupportClearance, gy === null ? -Infinity : feet[1] - gy);
    if (steps % 30 === 0) maxDeviation = Math.max(maxDeviation, deviation(feet, pts));
    if (steps % 60 === 0 || failure) trace.push({ steps, feet, supportY: gy, waypoint: driver.i });
    if (driver.i !== previousWaypoint) {
      previousWaypoint = driver.i;
      for (const st of stations) {
        const target = direction === 'forward' ? st.waypoint : points.length - 1 - st.waypoint;
        if (driver.i === target + 1) capture(st.name);
      }
    }
    if (Math.hypot(feet[0] - lastProgressFeet[0], feet[2] - lastProgressFeet[2]) > .02) { stalledSteps = 0; lastProgressFeet = feet; }
    else stalledSteps++;
    if (stalledSteps >= 600) failure = `no horizontal progress for 10 simulated seconds at waypoint ${driver.i}`;
    if (failure) break;
  }
  capture('end');
  const feet = controller.feetPosition(), end = pts.at(-1);
  const endpointError = Math.hypot(feet[0] - end[0], feet[2] - end[1]);
  const pass = !failure && driver.done && !driver.blocked && endpointError <= 1 && maxDeviation <= 2;
  results.push({ direction, pass, steps, simulatedSeconds: steps / 60, minSupportClearance, maxDeviation, endpointError,
    failure, driver: driver.status(), trace });
  console.log(direction, pass ? 'PASS' : 'FAIL', { steps, failure, endpointError, maxDeviation, finalFeet: feet });
  if (!pass) break;
}
assert.equal(hash(fs.readFileSync(path.join(AREA, 'baseline/commercial-route.pinned.json'))), hash(pinBytes));
const report = { time: new Date().toISOString(), pass: results.length === 2 && results.every(r => r.pass),
  coverage: 'S1 offline real-GLB/Rapier production input chain; browser/human/W2 claims require separate evidence',
  thresholds: { radius: .35, belowSupportM: -.05, endpointErrorM: 1, maxDeviationM: 2 },
  activation, missingRawNegative: true, sourceHashes, pinSha256: hash(pinBytes), topology: route.topology,
  results, stationSnapshots, zoneEvents: world.events };
fs.writeFileSync(path.join(ART, process.env.RUN_TAG ? `THROUGH-WALK-CHECK-${process.env.RUN_TAG}.json` : 'THROUGH-WALK-CHECK.json'), JSON.stringify(report, null, 2) + '\n');
controller.dispose(); physics.dispose();
if (!report.pass) process.exitCode = 1;
