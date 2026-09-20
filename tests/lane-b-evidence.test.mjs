// lane-b evidence-repair tests (B7-R1/R2, 2026-09-20) — targeted negatives and
// artifact self-checks for the runtime baseline + delivery manifest repair.
//
// B7-R1 root cause being guarded against: the old steering read tgt[2] on
// [x,z] targets, want/d became NaN, the turn branch never fired and a
// straight-line walk still reported PASS. These tests drive the REAL pure
// logic (tools/lane_b_route_steer.mjs, tools/lane_b_delivery_manifest.mjs) —
// not source-string matches — plus the committed raw artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  yawError, yawTowards, steeringDx, normalizeTarget, makeWaypointer,
  evaluateWalk, frameIntervalStats, RouteTargetError, LOOK_SENSITIVITY,
} from '../tools/lane_b_route_steer.mjs';
import {
  buildManifest, verifyManifest, MANIFEST_REL, RECEIPT_REL, MANIFEST_SCOPE,
} from '../tools/lane_b_delivery_manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'));

// ---- steering semantics (page convention: forward = (-sin yaw, -cos yaw)) ----

test('evidence: yaw error is finite, zero dead-ahead, ±90° with correct sign', () => {
  // facing north (yaw 0 -> forward (0,-1)); target dead ahead
  let err = yawError([0, 0], 0, [0, -10]);
  assert.ok(Number.isFinite(err));
  assert.ok(Math.abs(err) < 1e-12, `dead-ahead err ${err}`);
  // target due east: yawTowards = atan2(-10, 0) = -PI/2 -> must turn right (negative)
  err = yawError([0, 0], 0, [10, 0]);
  assert.ok(Math.abs(err + Math.PI / 2) < 1e-12, `east err ${err}`);
  // target due west: +PI/2
  err = yawError([0, 0], 0, [-10, 0]);
  assert.ok(Math.abs(err - Math.PI / 2) < 1e-12, `west err ${err}`);
  // wraps: yaw already at +3, target at -3 -> shortest path across PI
  err = yawError([0, 0], 3, [0, 10]);   // yawTowards(0,0->0,10)=atan2(0,-10)=PI
  assert.ok(Math.abs(Math.abs(err) - (Math.PI - 3)) < 1e-12, `wrap err ${err}`);
});

test('evidence: steering dx through the page look() closes the error exactly', () => {
  const err = -Math.PI / 4;
  const dx = steeringDx(err);
  // controller.look does yaw -= dx * 0.0023; the yaw CHANGE must equal err
  const applied = -(dx * LOOK_SENSITIVITY);
  assert.ok(Math.abs(applied - err) < 1e-9, `dx ${dx} applies ${applied} vs err ${err}`);
  // clamped for absurd errors (no view teleport in one synthetic event)
  const big = steeringDx(Math.PI);
  assert.ok(Math.abs(big) <= 700, `clamp ${big}`);
});

// ---- B7-R1 negatives: malformed targets must FAIL LOUD, never steer-NaN ----

test('evidence: [x,z] target read at index 2 (the line-149 shape) throws instead of NaN', () => {
  const tgt = [43.1, -10.7];              // what the loop actually held
  const bogus = tgt[2];                    // undefined — what the old code read
  assert.equal(bogus, undefined);
  assert.throws(() => normalizeTarget([tgt[0], bogus]), RouteTargetError);
  assert.throws(() => yawError([0, 0], 0, [tgt[0], bogus]), RouteTargetError);
  // the old silent behavior would have been a NaN that |NaN|>0.12 evaluates
  // false — i.e. "never turn, still PASS". The helper must never return that.
  let threw = false;
  try { yawError([0, 0], 0, [Number.NaN, 0]); } catch { threw = true; }
  assert.ok(threw, 'NaN coordinate must throw');
  assert.throws(() => yawError([0, 0], Number.NaN, [1, 1]), RouteTargetError, 'NaN yaw must throw');
  assert.throws(() => normalizeTarget([43.1]), RouteTargetError, 'missing dimension must throw');
});

// ---- waypointer: sequential advance, no global-nearest skipping -------------

test('evidence: waypointer advances sequentially and completes a walked line', () => {
  const legs = [
    { name: 'a', reach: 1.0, pts: [[0, 0], [0, 5], [0, 10]] },
    { name: 'b', reach: 1.0, pts: [[3, 10], [3, 14]] },
  ];
  const wp = makeWaypointer(legs);
  assert.equal(wp.legName, 'a');
  let t = wp.update([0, 0]);
  assert.equal(t.index, 1, 'standing on wp0 advances past it');
  t = wp.update([0, 4.5]);
  assert.equal(t.index, 2, 'within reach of wp1 (0.5 m) advances to wp2');
  t = wp.update([0, 9.6]);
  assert.equal(t.leg, 'b', 'reached street end, next leg begins');
  assert.equal(t.index, 0);
  t = wp.update([3, 10.5]);
  assert.equal(t.index, 1, 'inside leg b, wp0 passed');
  t = wp.update([3, 13.5]);
  assert.equal(t, null, 'all legs complete');
  assert.ok(wp.done);
  assert.equal(wp.reachedCount, 5);
  assert.throws(() => makeWaypointer([{ name: 'bad', reach: 0, pts: [[0, 0]] }]), RouteTargetError);
  assert.throws(() => makeWaypointer([{ name: 'bad', reach: 1, pts: [] }]), RouteTargetError);
});

test('evidence: a wall (feet frozen) can never complete the route', () => {
  const legs = [{ name: 'lane', reach: 0.9, pts: [[0, 0], [0, 6]] }];
  const wp = makeWaypointer(legs);
  const samples = [];
  // capsule stuck at the mouth for 20 s: waypoint 1 stays 6 m away forever
  for (let i = 0; i <= 200; i++) {
    const t = wp.update([0, 0.4], i * 100);
    samples.push({ tMs: i * 100, feet: [0, 0.09, 0.4], yaw: 0, leg: 'lane',
      index: t.index, dist: t.dist, moved: 0, paused: false, completed: false });
  }
  assert.ok(!wp.done, 'frozen feet must not complete');
  const v = evaluateWalk({ samples, legNames: ['lane'] });
  assert.ok(!v.pass);
  assert.ok(v.failures.some((f) => f.includes('stalled')), JSON.stringify(v.failures));
  assert.ok(v.failures.some((f) => f.includes('not completed')), JSON.stringify(v.failures));
});

// ---- evaluateWalk verdicts ----------------------------------------------------

test('evidence: evaluateWalk passes a real completion with >=90 s of walking', () => {
  const samples = [];
  for (let i = 0; i <= 100; i++) {
    samples.push({ tMs: i * 1000, feet: [i * 0.3, 0.09, 0], yaw: 0, leg: 'street',
      index: 1, dist: 1, moved: 0.3, paused: false, completed: i === 100 });
  }
  const v = evaluateWalk({ samples, legNames: ['street'] });
  assert.ok(v.pass, JSON.stringify(v.failures));
  assert.ok(v.stats.movingS >= 90, `movingS ${v.stats.movingS}`);
});

test('evidence: evaluateWalk negatives — short walk, no completion, NaN, fell', () => {
  const mk = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
    tMs: i * 1000, feet: [i * 0.3, 0.09, 0], yaw: 0, leg: 's', index: 1,
    dist: 1, moved: 0.3, paused: false, completed: false, ...over }));
  let v = evaluateWalk({ samples: mk(60), legNames: ['s'] });   // 59 s of walking
  assert.ok(!v.pass && v.failures.some((f) => f.includes('valid walking time')));
  v = evaluateWalk({ samples: mk(100), legNames: ['s'] });      // never completed
  assert.ok(!v.pass && v.failures.some((f) => f.includes('not completed')));
  const nan = mk(10, { feet: [Number.NaN, 0.09, 0] });
  v = evaluateWalk({ samples: nan, legNames: ['s'] });
  assert.ok(!v.pass && v.failures.some((f) => f.includes('non-finite')));
  const fell = mk(10, { feet: [0, -0.2, 0] });
  v = evaluateWalk({ samples: fell, legNames: ['s'] });
  assert.ok(!v.pass && v.failures.some((f) => f.includes('fell')));
});

// ---- frame stats recomputed from FULL raw samples (B7-R1 retention defect) ---

test('evidence: frameIntervalStats exact values and phase/visibility exclusions', () => {
  const mk = (t, vis, focus, phase) => [t, vis, focus, phase];
  const samples = [];
  for (let i = 0; i < 5; i++) samples.push(mk(i * 50, 1, 1, 'load'));
  for (let i = 0; i < 21; i++) samples.push(mk(250 + i * 100, 1, 1, 'walk-loop'));
  samples[10][1] = 0;                      // one hidden sample inside the walk phase
  for (let i = 0; i < 5; i++) samples.push(mk(2350 + i * 40, 1, 1, 'pv-cycles'));
  const st = frameIntervalStats(samples, { phase: 'walk-loop' });
  assert.equal(st.kept, 18);
  assert.equal(st.excluded, 12);
  assert.ok(st.reasons.phase >= 2 && st.reasons.hiddenOrUnfocused >= 2, JSON.stringify(st.reasons));
  assert.equal(st.p50Ms, 100); assert.equal(st.p95Ms, 100); assert.equal(st.maxMs, 100);
});

test('evidence: stats from FULL samples, not the fastest-60 subset', () => {
  const samples = [[0, 1, 1, 'walk-loop']];
  for (let i = 1; i <= 60; i++) samples.push([i * 5, 1, 1, 'walk-loop']);        // 60 x 5 ms
  let t = 60 * 5;
  for (let i = 0; i < 939; i++) { t += 16.7; samples.push([+t.toFixed(2), 1, 1, 'walk-loop']); }
  samples.push([+(t + 40).toFixed(2), 1, 1, 'walk-loop']);                       // one real spike
  const st = frameIntervalStats(samples, { phase: 'walk-loop' });
  // the old artifact kept only the 60 fastest sorted intervals and reported
  // their spread; from the raw samples the honest P50/P95 is the steady state
  assert.equal(st.p50Ms, 16.7);
  assert.equal(st.p95Ms, 16.7);
  assert.equal(st.maxMs, 40, 'max keeps the real spike population');
  assert.equal(st.kept, 1000);
});

// ---- committed runtime artifacts: summary must recomputed-match the raw ------

test('evidence: runtime-baseline.json self-consistent with the raw dumps', async () => {
  const report = await json('artifacts/lane-b-polish/runtime-baseline.json');
  assert.equal(report.pass, true, 'rerun must have passed');
  assert.equal(report.injections.manualWalkClaim, false);
  for (const cfg of report.configs) {
    assert.deepEqual(cfg.failures, [], `${cfg.config} failures`);
    const tag = cfg.config === 'skins+props' ? 'skins-props' : cfg.config;
    const frames = await json(`artifacts/lane-b-polish/evidence-repair/raw/${tag}-frames.json`);
    const traj = await json(`artifacts/lane-b-polish/evidence-repair/raw/${tag}-trajectory.json`);
    // raw frame samples: time-ordered, full retention
    for (let i = 1; i < frames.samples.length; i++)
      assert.ok(frames.samples[i][0] >= frames.samples[i - 1][0], 'sample times non-decreasing');
    const st = frameIntervalStats(frames.samples, { phase: 'walk-loop' });
    const sum = cfg.walkLoop.frames.walkLoopPhaseOnly;
    assert.equal(st.kept, sum.kept, `${cfg.config} kept intervals`);
    assert.equal(st.p50Ms, sum.p50Ms, `${cfg.config} P50 recomputed`);
    assert.equal(st.p95Ms, sum.p95Ms, `${cfg.config} P95 recomputed`);
    assert.equal(st.maxMs, sum.maxMs, `${cfg.config} max recomputed`);
    // load clock recomputable: ready->firstValid == nav->firstValid - nav->ready
    const d = +(cfg.load.navigationToFirstValidFrameMs - cfg.load.navigationToReadyMs).toFixed(1);
    assert.ok(Math.abs(d - cfg.load.readyToFirstValidFrameMs) <= 0.15, 'ready->firstValid difference closes');
    assert.ok(cfg.load.firstValidFrameProof?.distinctColors >= 4, 'first frame pixel-verified');
    // trajectory re-verdict
    const v = evaluateWalk({ samples: traj.samples, legNames: traj.legs.map((l) => l.name) });
    assert.ok(v.pass, `${cfg.config} trajectory verdict ${JSON.stringify(v.failures)}`);
    assert.ok(v.stats.movingS >= 90, `${cfg.config} movingS ${v.stats.movingS}`);
    assert.equal(v.stats.distanceM, cfg.walkLoop.verdict.stats.distanceM, 'distance recomputed');
  }
});

test('evidence: retraction snapshot of the withdrawn baseline is preserved', async () => {
  const prev = await json('artifacts/lane-b-polish/evidence-repair/previous/runtime-baseline.json');
  assert.ok(Array.isArray(prev.configs) && Array.isArray(prev.configs[0].walkLoop.rawFirst60),
    'the old artifact really kept only the fastest-60 subset');
  const readme = await readFile(resolve(root, 'artifacts/lane-b-polish/evidence-repair/previous/README.md'), 'utf8');
  assert.ok(readme.includes('撤回'), 'retraction is explicit');
  assert.ok(readme.includes('tgt[2]'), 'root cause is documented');
});

// ---- manifest tool: real positives + tamper/missing/wrong-hash negatives ----

test('evidence: manifest round-trip on a fixture tree, then real failures', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'lane-b-manifest-'));
  await mkdir(resolve(dir, 'assets/x'), { recursive: true });
  await writeFile(resolve(dir, 'assets/x/a.bin'), Buffer.from([1, 2, 3, 4]));
  await writeFile(resolve(dir, 'assets/b.txt'), 'hello manifest');
  const scope = { dirs: ['assets'], files: [] };
  const m = await buildManifest(dir, { scope, meta: { note: 'fixture' } });
  assert.equal(m.fileCount, 2);
  assert.equal(m.totalBytes, 4 + 14);
  assert.ok(!(m.files['delivery-manifest.json']), 'manifest excludes itself by convention');
  let v = await verifyManifest(dir, m);
  assert.deepEqual(v.errors, []);
  assert.ok(v.ok);
  // tamper one byte
  await writeFile(resolve(dir, 'assets/x/a.bin'), Buffer.from([1, 2, 3, 5]));
  v = await verifyManifest(dir, m);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('sha256') || e.includes('bytes')), 'tampered byte must fail');
  await writeFile(resolve(dir, 'assets/x/a.bin'), Buffer.from([1, 2, 3, 4]));
  // missing file: point the manifest at a path that does not exist
  const m2 = JSON.parse(JSON.stringify(m));
  m2.files['assets/ghost.txt'] = { bytes: 1, sha256: '0'.repeat(64) };
  m2.fileCount += 1;
  v = await verifyManifest(dir, m2);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('missing')), 'missing file must fail');
  // wrong recorded hash on an existing file
  const m3 = JSON.parse(JSON.stringify(m));
  m3.files['assets/b.txt'].sha256 = 'f'.repeat(64);
  v = await verifyManifest(dir, m3);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('sha256')), 'wrong hash must fail');
  // self-inclusion must be rejected
  const m4 = JSON.parse(JSON.stringify(m));
  m4.files[MANIFEST_REL] = { bytes: 1, sha256: '0'.repeat(64) };
  v = await verifyManifest(dir, m4);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('itself')), 'manifest must exclude itself');
  // fileCount/totalBytes must match the entries
  const m5 = JSON.parse(JSON.stringify(m));
  m5.totalBytes += 1;
  v = await verifyManifest(dir, m5);
  assert.ok(!v.ok, 'totalBytes mismatch must fail');
  // path safety
  const m6 = JSON.parse(JSON.stringify(m));
  delete m6.files['assets/b.txt'];
  m6.files['../escape.txt'] = { bytes: 1, sha256: '0'.repeat(64) };
  v = await verifyManifest(dir, m6);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('path')), 'escaping path must fail');
});

test('evidence: the committed delivery manifest verifies against the real tree', async () => {
  const m = await json('artifacts/lane-b-polish/delivery-manifest.json');
  assert.ok(!m.files[MANIFEST_REL], 'manifest excludes itself');
  assert.ok(!m.files[RECEIPT_REL], 'manifest excludes the outer receipt');
  assert.equal(m.fileCount, Object.keys(m.files).length);
  assert.equal(m.totalBytes, Object.values(m.files).reduce((s, e) => s + e.bytes, 0));
  const v = await verifyManifest(root, m);
  assert.deepEqual(v.errors, [], `real manifest errors: ${JSON.stringify(v.errors)}`);
  // receipt is outer and carries the manifest digest
  const receipt = await json('artifacts/lane-b-polish/evidence-repair/delivery-receipt.json');
  const manifestBytes = await readFile(resolve(root, MANIFEST_REL));
  const sha = createHash('sha256').update(manifestBytes).digest('hex');
  assert.equal(receipt.manifestSha256, sha, 'receipt digest matches the manifest bytes');
  assert.equal(receipt.manifestBytes, manifestBytes.byteLength);
});
