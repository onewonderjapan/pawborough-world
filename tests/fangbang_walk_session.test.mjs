// Player-experience batch A regression #4 — walk session semantics, driven
// through the production WalkSession (src/player/walkSession.js) with a fake
// controller that records every teleport/pause/clearKeys call:
//   - first walk entry spawns at a SAFE validated anchor near the framing
//     camera (A-lane framing -> A-lane mouth, NOT the east-end reset)
//   - aerial/unsafe framings fall back to the NEAREST validated anchor with
//     an explicit reason
//   - view <-> walk switching PRESERVES the in-world pose (a mode switch is
//     not a new game); only the first entry or an explicit location choice
//     may set the start point
//   - pause (P / blur / pointer-lock loss) clears input state; resume never
//     teleports; no sticky keys
//   - explicit location selection is recorded as relocation, never claimed
//     as walk evidence
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkSession } from '../src/player/walkSession.js';

const anchors = [
  { id: 'mainStreet', labelZh: '主街', position: [124.6, 0, 27.65], yaw: 3.0, validation: { ok: true } },
  { id: 'templeFront', labelZh: '庙前', position: [-127.817, 0, 27.057], yaw: 1.4, validation: { ok: true } },
  { id: 'laneA', labelZh: 'A弄', position: [43.096, 0, -10.697], yaw: -0.08, validation: { ok: true } },
  { id: 'laneB', labelZh: 'B弄', position: [60.086, 0, 9.144], yaw: 2.7, validation: { ok: true } },
];

function fakeController() {
  const c = {
    feet: [0, 1, 0], yaw: 0, pitch: 0,
    teleports: [], paused: false, pauseCalls: 0, resumeCalls: 0, clearCalls: 0,
    teleport(feet, yaw, pitch) { c.teleports.push({ feet: [...feet], yaw, pitch }); c.feet = [...feet]; c.yaw = yaw; c.pitch = pitch ?? 0; },
    feetPosition() { return [...c.feet]; },
    pause() { c.paused = true; c.pauseCalls += 1; c.clearKeys(); },
    resume() { c.paused = false; c.resumeCalls += 1; c.clearKeys(); },
    clearKeys() { c.clearCalls += 1; },
  };
  return c;
}
const makeSession = () => new WalkSession({ getAnchors: () => anchors });

test('first walk from the A-lane framing camera spawns AT the lane mouth', () => {
  const s = makeSession(), c = fakeController();
  // lane-a-street-look-in camera pose [43.5, 1.6, -9.8]
  const r = s.beginWalk(c, [43.5, 1.6, -9.8]);
  assert.equal(r.spawned?.anchorId, 'laneA');
  assert.equal(r.spawned?.displaced, false, 'framing camera is at street level near the lane');
  assert.equal(c.teleports.length, 1);
  assert.deepEqual(c.teleports[0].feet, [43.096, 0, -10.697]);
  assert.equal(c.teleports[0].yaw, anchors[2].yaw, 'faces INTO the lane');
  assert.equal(s.snapshot().mode, 'walk');
});

test('aerial framing falls back to the NEAREST validated anchor with a reason', () => {
  const s = makeSession(), c = fakeController();
  // aerial-overview pose [-70, 45, 70]: nearest anchor is the temple front
  const r = s.beginWalk(c, [-70, 45, 70]);
  assert.equal(r.spawned?.anchorId, 'templeFront');
  assert.equal(r.spawned?.displaced, true);
  assert.equal(r.spawned?.reason, 'aerial');
});

test('far street-level framing still reports displacement but lands safely', () => {
  const s = makeSession(), c = fakeController();
  const r = s.beginWalk(c, [200, 1.6, 40]);   // far east, near mainStreet anchor
  assert.equal(r.spawned?.anchorId, 'mainStreet');
  assert.equal(r.spawned?.displaced, true);
  assert.equal(r.spawned?.reason, 'far');
});

test('view <-> walk preserves the pose; a mode switch is NOT a new game', () => {
  const s = makeSession(), c = fakeController();
  s.beginWalk(c, [43.5, 1.6, -9.8]);
  // the player walks 4m into the lane
  c.feet = [43.4, 0.11, -14.8]; c.yaw = -0.05; c.pitch = 0.1;
  s.endWalk(c);
  assert.equal(s.snapshot().mode, 'view');
  const r2 = s.beginWalk(c, [-999, 9, 999]);  // camera pose must not matter anymore
  assert.equal(r2.restored, true, 'second entry restores, never respawns');
  assert.equal(r2.spawned, null);
  assert.equal(c.teleports.length, 2);
  assert.deepEqual(c.teleports[1].feet, [43.4, 0.11, -14.8]);
  assert.equal(c.teleports[1].yaw, -0.05);
  assert.equal(c.teleports[1].pitch, 0.1);
  // and the spawn counter stayed honest
  assert.equal(s.snapshot().spawnCount, 1);
});

test('pointer-lock loss pauses and clears input; resume never teleports', () => {
  const s = makeSession(), c = fakeController();
  s.beginWalk(c, [43.5, 1.6, -9.8]);
  const before = c.teleports.length;
  const r = s.pointerLockLost(c);
  assert.equal(r.paused, true);
  assert.equal(r.reason, 'lock-lost');
  assert.ok(c.pauseCalls >= 1, 'controller paused (input cleared)');
  s.resume(c);
  assert.ok(c.resumeCalls >= 1);
  assert.equal(c.teleports.length, before, 'resume must not move the capsule');
  // a second lock loss while already paused is a no-op, not a state flip
  s.pointerLockLost(c);
  assert.equal(s.snapshot().paused, true);
});

test('blur during walk pauses; the pose is still captured on exit', () => {
  const s = makeSession(), c = fakeController();
  s.beginWalk(c, [43.5, 1.6, -9.8]);
  c.feet = [43.2, 0.11, -12.4];
  const r = s.blur(c);
  assert.equal(r.paused, true);
  assert.equal(r.reason, 'blur');
  s.endWalk(c);
  const r2 = s.beginWalk(c, [0, 0, 0]);
  assert.deepEqual(c.teleports.at(-1).feet, [43.2, 0.11, -12.4], 'paused pose preserved');
});

test('explicit location selection teleports, records relocation, stays explicit', () => {
  const s = makeSession(), c = fakeController();
  s.beginWalk(c, [43.5, 1.6, -9.8]);
  const r = s.relocate(c, 'laneB');
  assert.equal(r.ok, true);
  assert.deepEqual(c.teleports.at(-1).feet, [60.086, 0, 9.144]);
  assert.equal(s.snapshot().mode, 'walk', 'relocation mid-walk keeps walking');
  const snap = s.snapshot();
  assert.equal(snap.relocations.length, 1);
  assert.equal(snap.relocations[0].anchorId, 'laneB');
  assert.equal(snap.relocations[0].explicit, true, 'never counted as walk evidence');

  // relocation while VIEWING sets the next spawn anchor
  s.endWalk(c);
  const r2 = s.relocate(c, 'templeFront');
  assert.equal(r2.ok, true);
  const r3 = s.beginWalk(c, [9, 9, 9]);
  assert.equal(r3.spawned?.anchorId, 'templeFront');
  assert.equal(r3.spawned?.reason, 'explicit-choice');
});

test('unknown or unvalidated anchors are refused, not guessed', () => {
  const s = makeSession(), c = fakeController();
  assert.equal(s.relocate(c, 'nope').ok, false);
  const s2 = new WalkSession({ getAnchors: () => [{ ...anchors[2], validation: { ok: false, reason: 'fell' } }] });
  assert.equal(s2.relocate(fakeController(), 'laneA').ok, false);
  // a session with NO validated anchors refuses to start walking
  const s3 = new WalkSession({ getAnchors: () => [] });
  assert.equal(s3.beginWalk(fakeController(), [0, 1.6, 0]).spawned, null);
});

test('beginWalk during walk and endWalk during view are no-ops', () => {
  const s = makeSession(), c = fakeController();
  s.beginWalk(c, [43.5, 1.6, -9.8]);
  const t = c.teleports.length;
  assert.equal(s.beginWalk(c, [0, 0, 0]), null);
  s.endWalk(c);
  assert.equal(s.endWalk(c), null);
  assert.equal(c.teleports.length, t);
});
