// REL-01 (world-reliability 20260921) — safe-fall recovery tests.
// Two layers, mirroring the production wiring:
//   1. REAL Rapier worlds with hand-built ground triangle soup (the exact
//      format collectGroundTriangles/addGroundCollider consume): a walkable
//      strip that ENDS in void, like the bridge east tail / mid-street north
//      edge from the long-run evidence. The REAL WalkController falls off and
//      the REAL WalkSession.observeWalk() chain must recover exactly once,
//      land stably on the last verified safe pose, and never mis-fire on
//      normal walking, jumping, step-downs, pauses or low-framerate dt.
//   2. DOM-free WalkSession unit checks (fake controller): the pending-anchor
//      everWalked fix at the authoritative layer, recovery event fields,
//      anchor fallback and the validateSafe veto.
// Run: node tests/walk_session_recovery.test.mjs   (exit 0 = contract holds)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';

import { addGroundCollider, addWallCollider } from '../src/world/physics.js';
import { createGroundSampler } from '../src/world/groundSampler.js';
import { WalkController } from '../src/player/WalkController.js';
import { WalkSession } from '../src/player/walkSession.js';

await RAPIER.init();

// ---- hand-built ground: strip x∈[-20,20], z∈[-3,3] at y=0, void beyond ----
function stripSoup(x0, x1, z0, z1, y) {
  const positions = new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  return { positions, indices };
}
const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };

function makeWorld(soups, walls = []) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  for (const s of soups) addGroundCollider(RAPIER, world, s);
  for (const w of walls) addWallCollider(RAPIER, world, w);
  world.step();
  return world;
}

function mkSession(anchors, { validateSafe = null, floorY = -0.5, now = () => Date.now() } = {}) {
  return new WalkSession({
    getAnchors: () => anchors,
    now,
    recovery: {
      floorY,
      validateSafe: validateSafe ?? ((feet) => SAMPLE_WORLD_GROUND_ONLY.hasSupport(feet[0], feet[1], feet[2])),
    },
  });
}
// sampler over the SAME soup the world was built from (production definition)
const SAMPLE_WORLD_GROUND_ONLY = createGroundSampler([stripSoup(-20, 20, -3, 3, 0)]);

const ANCHOR = { id: 'mainStreet', labelZh: '主街', position: [-18, 0, 0], yaw: Math.PI / 2, validation: { ok: true } };

test('REL-01: normal main-street out-and-back keeps recoveryCount at zero', () => {
  const world = makeWorld([stripSoup(-20, 20, -3, 3, 0)]);
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [-18, 1, 0] } });
  const walk = mkSession([ANCHOR]);
  walk.beginWalk(c, null);
  const dt = 1 / 60;
  const legs = [[18, 0], [-18, 0]];
  let li = 0;
  for (let i = 0; i < 60 * 60; i++) {
    const t = legs[li];
    const p = c.feetPosition();
    if (Math.hypot(p[0] - t[0], p[2] - t[2]) < 0.8) li = Math.min(li + 1, legs.length - 1);
    c.yaw = Math.atan2(-(t[0] - p[0]), -(t[2] - p[2]));
    c.setMoveInput(1, 0);
    c.step(dt);
    const rec = walk.observeWalk(c, dt);
    assert.equal(rec, null, `no recovery on the normal route (frame ${i})`);
  }
  const snap = walk.snapshot();
  assert.equal(snap.recoveryCount, 0, 'a normal A/B round trip is NOT a recovery');
  assert.ok(c.isGrounded());
  assert.ok(Math.abs(c.feetPosition()[1]) < 0.05, `feet stay on the strip (y=${c.feetPosition()[1].toFixed(3)})`);
  c.dispose();
});

test('REL-01: walking off the strip recovers EXACTLY once to the last safe pose, no oscillation', () => {
  const world = makeWorld([stripSoup(-20, 20, -3, 3, 0)]);
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [-18, 1, 0] } });
  const walk = mkSession([ANCHOR]);
  walk.beginWalk(c, null);
  const dt = 1 / 60;
  // walk east INTO the void past x=20, input held the whole way (a real player
  // does exactly this; the page clears the input at recovery)
  let recoveredEvents = [];
  for (let i = 0; i < 60 * 30 && !recoveredEvents.length; i++) {
    c.yaw = Math.PI / 2 * 3; // face +x (east)
    c.setMoveInput(1, 0);
    c.step(dt);
    const rec = walk.observeWalk(c, dt);
    if (rec?.recovered) recoveredEvents.push(rec);
  }
  assert.equal(recoveredEvents.length, 1, 'the fall recovers exactly once');
  const ev = recoveredEvents[0];
  assert.ok(['below-floor', 'excessive-drop', 'airborne-timeout'].includes(ev.reason), `reason recorded (${ev.reason})`);
  assert.ok(ev.from[0] > 20, `recovery started from beyond the edge (x=${ev.from[0]})`);
  assert.ok(ev.to[0] < 19.4, `returned INSIDE the edge margin (x=${ev.to[0]})`);
  assert.equal(ev.target, 'last-safe', 'returned to the last VERIFIED safe pose');
  // stable landing, no oscillation: hold still for 5 s of frames
  const settle0 = c.feetPosition();
  for (let i = 0; i < 60 * 5; i++) {
    c.step(dt);
    const rec = walk.observeWalk(c, dt);
    assert.equal(rec, null, 'no re-trigger after recovery');
  }
  const settle1 = c.feetPosition();
  assert.ok(Math.hypot(settle1[0] - settle0[0], settle1[2] - settle0[2]) < 0.05, 'no drift/oscillation');
  assert.ok(c.isGrounded(), 'landed grounded');
  assert.ok(Math.abs(settle1[1]) < 0.05, `landed ON the strip (y=${settle1[1].toFixed(3)})`);
  // the recovery is recorded, with the full event, separate from relocations
  const snap = walk.snapshot();
  assert.equal(snap.recoveryCount, 1);
  assert.equal(snap.relocations.length, 0, 'recovery is never an explicit relocation');
  assert.equal(snap.recoveries[0].reason, ev.reason);
  // old input/velocity state died with the recovery: input is cleared
  assert.equal(c.input.forward, 0, 'pending move input cleared');
  assert.equal(c.input.jump, false, 'pending jump cleared');
  c.dispose();
});

test('REL-01: low framerate (dt clamped by the physics) still recovers exactly once', () => {
  const world = makeWorld([stripSoup(-20, 20, -3, 3, 0)]);
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [-18, 1, 0] } });
  let simMs = 0;
  const walk = mkSession([ANCHOR], { now: () => simMs });   // 4 fps wall clock
  walk.beginWalk(c, null);
  const dt = 0.25; // WalkController clamps internally
  let recoveries = 0, firstReason = null, fell = false;
  for (let i = 0; i < 200; i++) {
    simMs += dt * 1000;
    c.yaw = Math.PI / 2 * 3;
    if (!recoveries) c.setMoveInput(1, 0); // after the recovery the player stops walking into the void
    c.step(dt);
    const rec = walk.observeWalk(c, dt);
    if (c.feetPosition()[0] > 20) fell = true;
    if (rec?.recovered) { recoveries++; firstReason = firstReason ?? rec.reason; }
  }
  assert.ok(fell, 'the walk really left the strip');
  assert.equal(recoveries, 1, `exactly one recovery at low fps (got ${recoveries})`);
  assert.ok(firstReason, 'a reason is recorded');
  assert.ok(c.isGrounded() || Math.abs(c.feetPosition()[1]) < 0.05, 'stable after recovery');
  c.dispose();
});

test('REL-01: jump on the strip and a 0.85 m step-down never trigger recovery', () => {
  // step world: y=0 for x<0, y=-0.85 for x>0 (court -> street drop scale)
  const world = makeWorld([stripSoup(-20, 0, -3, 3, 0), stripSoup(0, 60, -3, 3, -0.85)]);
  const stepGround = createGroundSampler([
    stripSoup(-20, 0, -3, 3, 0), stripSoup(0, 60, -3, 3, -0.85),
  ]);
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [-15, 1, 0] } });
  const walk = mkSession([ANCHOR], { floorY: stepGround.minY() - 0.5, validateSafe: (feet) => stepGround.hasSupport(feet[0], feet[1], feet[2]) });
  walk.beginWalk(c, null);
  const dt = 1 / 60;
  // hop forward repeatedly while crossing the step edge
  let hops = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const p = c.feetPosition();
    c.yaw = Math.PI / 2 * 3;
    if (i % 90 === 0 && hops < 12) { c.setJump(true); hops++; }
    c.setMoveInput(1, 0);
    c.step(dt);
    const rec = walk.observeWalk(c, dt);
    assert.equal(rec, null, `jump/step-down never recovers (frame ${i}, feet y=${p[1].toFixed(2)})`);
  }
  assert.equal(walk.snapshot().recoveryCount, 0);
  assert.ok(c.feetPosition()[1] < -0.6, `walked down onto the lower strip (y=${c.feetPosition()[1].toFixed(2)})`);
  c.dispose();
});

test('REL-01: pause freezes observation — no recovery decisions while paused', () => {
  const world = makeWorld([stripSoup(-20, 20, -3, 3, 0)]);
  const c = new WalkController({ RAPIER, physics: { world }, capsule: { ...CAPSULE, spawn: [-18, 1, 0] } });
  const walk = mkSession([ANCHOR]);
  walk.beginWalk(c, null);
  walk.pause(c, 'user');
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    c.step(dt);
    assert.equal(walk.observeWalk(c, dt), null, 'paused: observeWalk is inert');
  }
  walk.resume(c);
  assert.equal(walk.observeWalk(c, dt), null);
  c.dispose();
});

// ---- unit layer: the authoritative state contract, no physics -------------
function fakeController({ grounded = true, correctedY = -0.01, feet = [0, 0, 0] } = {}) {
  return {
    yaw: 0, pitch: 0,
    input: { forward: 1, right: 0, jump: true },
    lastStep: { grounded, corrected: [0, correctedY, 0] },
    feetPosition: () => feet,
    isGrounded: () => grounded,
    teleport(pos, yaw, pitch) { this.teleported = (this.teleported ?? 0) + 1; this.lastTeleport = [pos, yaw, pitch]; this.input = { forward: 0, right: 0, jump: false }; },
    resume() { this.resumed = (this.resumed ?? 0) + 1; },
    clearKeys() {},
    pause() {},
  };
}

test('REL-01 unit: pending-anchor entry now sets everWalked at the authoritative layer', () => {
  const anchors = [ANCHOR, { ...ANCHOR, id: 'templeFront', position: [5, 0, 0] }];
  const walk = new WalkSession({ getAnchors: () => anchors });
  const c = fakeController();
  walk.relocate(c, 'templeFront');
  assert.equal(walk.everWalked, false, 'choosing a location alone is not walking');
  const r = walk.beginWalk(c, null);
  assert.equal(r.spawned.reason, 'explicit-choice');
  assert.equal(walk.everWalked, true, 'the pending branch marks the session as walked (REL-01 fix)');
  walk.endWalk(c);
  const r2 = walk.beginWalk(c, null);
  assert.equal(r2.restored, true, 'next entry RESTORES the pose — a mode switch is not a new game');
});

test('REL-01 unit: recovery events carry reason/from/to/at/target and stay separate from relocations', () => {
  let t = 1000;
  const walk = mkSession([ANCHOR], { now: () => (t += 16) });
  walk.mode = 'walk';
  const c = fakeController({ feet: [25, -3, 0] }); // below floorY=-0.5
  const rec = walk.observeWalk(c, 1 / 60);
  assert.ok(rec?.recovered);
  assert.equal(rec.reason, 'below-floor');
  assert.deepEqual(rec.from, [25, -3, 0]);
  assert.deepEqual(rec.to, [-18, 0, 0]);
  assert.equal(rec.target, 'anchor:mainStreet', 'no usable safe pose -> validated anchor');
  assert.equal(walk.snapshot().recoveryCount, 1);
  assert.equal(walk.snapshot().relocations.length, 0);
  assert.equal(c.teleported, 1);
  assert.equal(c.resumed, 1, 'resume clears the fixed-step accumulator');
});

test('REL-01 unit: with no valid safe pose the recovery falls back to a validated anchor', () => {
  const walk = mkSession([ANCHOR, { ...ANCHOR, id: 'bad', position: [99, 0, 0], validation: { ok: false } }], {
    validateSafe: () => false, // nothing ever qualifies as safe
  });
  walk.mode = 'walk';
  const c = fakeController({ feet: [22, -2, 1] });
  const rec = walk.observeWalk(c, 1 / 60);
  assert.ok(rec?.recovered, 'recovered via anchor fallback');
  assert.equal(rec.target, 'anchor:mainStreet', 'only VALIDATED anchors are used');
  assert.deepEqual(rec.to, [-18, 0, 0]);
});

test('REL-01 unit: validateSafe veto keeps airborne/edge points out of the safe cache', () => {
  let safeOk = false;
  const walk = mkSession([ANCHOR], { validateSafe: () => safeOk });
  walk.mode = 'walk';
  const c = fakeController({ feet: [19.9, 0, 0] }); // grounded but ON the edge (vetoed)
  assert.equal(walk.observeWalk(c, 1 / 60), null);
  assert.equal(walk.lastSafe, null, 'vetoed pose never enters the safe cache');
  safeOk = true;
  walk.observeWalk(c, 1 / 60);
  assert.ok(walk.lastSafe, 'verified pose is cached once the veto lifts');
});

test('REL-01 unit: recovery cooldown prevents double-triggering on one fall', () => {
  let t = 0;
  const walk = mkSession([ANCHOR], { now: () => t });
  walk.mode = 'walk';
  const c = fakeController({ feet: [25, -4, 0] });
  const r1 = walk.observeWalk(c, 1 / 60);
  assert.ok(r1?.recovered);
  t += 200; // 200 ms later — inside the 1 s cooldown
  assert.equal(walk.observeWalk(c, 1 / 60), null, 'no second recovery during cooldown');
  t += 2000; // cooldown over; the pose is safe now (fake feet still report old value)
  const c2 = fakeController({ feet: [25, -4, 0] }); // a genuinely NEW fall state
  const r2 = walk.observeWalk(c2, 1 / 60);
  assert.ok(r2?.recovered, 'a new fall after the cooldown still recovers');
});
