// Pure runtime-evidence logic for the lane-b polish runtime baseline
// (evidence-repair batch, 2026-09-20). No DOM, no browser, no I/O — imported
// both by tools/lane_b_polish_runtime.mjs (live page drive) and by
// tests/lane-b-evidence.test.mjs (targeted negatives).
//
// Why this module exists (lead finding B7-R1): the previous inline steering
// read tgt[2] on a [x,z] target, want/d became NaN and the turn branch never
// fired — the walk went straight and still reported PASS. Every function here
// therefore FAILS LOUD on malformed/non-finite input instead of returning a
// quiet NaN that comparisons treat as false.

export const LOOK_SENSITIVITY = 0.0023;   // page mouse sensitivity (rad per px)
export const TURN_DEADBAND = 0.10;        // rad; below this we walk straight

export class RouteTargetError extends Error {}

// A route target must be a finite [x, z] (2D, ground plane). The old bug fed
// [x, z] pairs into indexing that expected [x, y, z] and read undefined —
// that exact shape must throw, never steer.
export function normalizeTarget(t) {
  if (!Array.isArray(t) || t.length < 2)
    throw new RouteTargetError(`target must be [x,z], got ${JSON.stringify(t)}`);
  const [x, z] = t;
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw new RouteTargetError(`target coords must be finite, got ${JSON.stringify(t)}`);
  return { x, z };
}

// Page yaw convention (WalkController): forward = (-sin(yaw), -cos(yaw)).
// Yaw that faces `from` -> `to`, both [x,z].
export function yawTowards(from, to) {
  const f = normalizeTarget(from), t = normalizeTarget(to);
  return Math.atan2(-(t.x - f.x), -(t.z - f.z));
}

export function wrapAngle(d) {
  if (!Number.isFinite(d)) throw new RouteTargetError(`angle must be finite, got ${d}`);
  let a = d;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Signed yaw error from current heading to a target, normalized to [-pi, pi].
// Finite, correct-sign, and loud on malformed targets — the negative cases
// the previous tool silently swallowed.
export function yawError(feet, yaw, target) {
  if (!Number.isFinite(yaw)) throw new RouteTargetError(`yaw must be finite, got ${yaw}`);
  const f = normalizeTarget(feet), t = normalizeTarget(target);
  return wrapAngle(yawTowards([f.x, f.z], [t.x, t.z]) - yaw);
}

// Mouse movementX that closes `err` through the page's look() (yaw -= dx*0.0023),
// clamped to a per-tick budget so one synthetic event cannot teleport the view.
export function steeringDx(err, { sensitivity = LOOK_SENSITIVITY, maxPx = 700 } = {}) {
  const e = wrapAngle(err);
  const px = -e / sensitivity;
  return Math.max(-maxPx, Math.min(maxPx, px));
}

// Sequential waypoint follower over named legs. Advance happens ONLY when the
// capsule is within the leg's reach radius of the immediate next point — one
// index at a time, so points behind walls cannot be skipped by jumping to a
// globally-nearest waypoint.
export function makeWaypointer(legs) {
  if (!Array.isArray(legs) || legs.length === 0) throw new RouteTargetError('legs required');
  for (const leg of legs) {
    if (!Array.isArray(leg.pts) || leg.pts.length === 0)
      throw new RouteTargetError(`leg ${leg.name}: pts required`);
    if (!Number.isFinite(leg.reach) || leg.reach <= 0)
      throw new RouteTargetError(`leg ${leg.name}: reach must be > 0`);
  }
  let li = 0, wi = 0, reachedCount = 0;
  const reachedAt = [];
  return {
    get legIndex() { return li; },
    get waypointIndex() { return wi; },
    get legName() { return legs[li].name; },
    get done() { return li >= legs.length; },
    get reachedCount() { return reachedCount; },
    reachedAt,
    // advance against a [x,z] feet position; returns the current target
    update(feet, atMs = null) {
      while (li < legs.length) {
        const leg = legs[li];
        const tgt = normalizeTarget(leg.pts[wi]);
        const f = normalizeTarget(feet);
        const dist = Math.hypot(tgt.x - f.x, tgt.z - f.z);
        if (dist > leg.reach) return { leg: leg.name, index: wi, target: [tgt.x, tgt.z], dist };
        reachedCount++;
        reachedAt.push({ leg: leg.name, index: wi, atMs, dist: +dist.toFixed(3) });
        if (wi + 1 < leg.pts.length) { wi++; continue; }
        li++; wi = 0;
      }
      return null;   // all legs complete
    },
  };
}

// Verdict over a recorded walk trajectory. Pure: feed it the samples the live
// run collected (or a synthetic broken one in tests) and it decides PASS/FAIL
// with explicit reasons — reached-every-leg, enough valid walking seconds,
// no sustained stall, feet finite and above the fall line.
//
// sample = { tMs, feet:[x,y,z], yaw, leg, index, dist, moved, paused, fell? }
export function evaluateWalk({ samples, legNames, minValidWalkS = 90, stallFailS = 8,
  fallY = -0.05, stillEpsM = 0.05 }) {
  const failures = [];
  if (!Array.isArray(samples) || samples.length < 2)
    return { pass: false, failures: ['no trajectory samples'], stats: null };
  let tPrev = null, feetPrev = null, movingS = 0, totalS = 0, stillS = 0, maxStillS = 0;
  let distance = 0, fellAt = null, nonFinite = 0, pausedS = 0;
  const stillRuns = [];
  for (const s of samples) {
    if (!s || !Array.isArray(s.feet) || s.feet.length < 3 ||
        !s.feet.every(Number.isFinite) || !Number.isFinite(s.yaw) || !Number.isFinite(s.tMs)) {
      nonFinite++;
      continue;
    }
    if (s.feet[1] < fallY && fellAt === null) fellAt = { tMs: s.tMs, feet: s.feet.map((v) => +v.toFixed(2)) };
    if (tPrev !== null) {
      const dt = Math.max(0, (s.tMs - tPrev) / 1000);
      totalS += dt;
      if (s.paused) pausedS += dt;
      const step = Math.hypot(s.feet[0] - feetPrev[0], s.feet[2] - feetPrev[2]);
      distance += step;
      const moving = step / Math.max(dt, 1e-6) > 0.25 && !s.paused;   // ~>0.25 m/s counts as walking
      if (moving) movingS += dt;
      if (!moving && !s.paused) {
        stillS += dt;
        if (stillS > maxStillS) maxStillS = stillS;
      } else {
        if (stillS > 0) stillRuns.push(+stillS.toFixed(2));
        stillS = 0;
      }
    }
    tPrev = s.tMs; feetPrev = s.feet;
  }
  if (stillS > 0) stillRuns.push(+stillS.toFixed(2));
  const last = samples[samples.length - 1];
  const completed = Boolean(last && last.completed);
  if (!completed) failures.push(`route not completed (last leg/index: ${last ? `${last.leg}/${last.index}` : 'n/a'})`);
  if (fellAt) failures.push(`fell below y=${fallY} at t=${Math.round(fellAt.tMs)}ms ${JSON.stringify(fellAt.feet)}`);
  if (nonFinite > 0) failures.push(`${nonFinite} non-finite trajectory samples`);
  if (movingS < minValidWalkS) failures.push(`valid walking time ${movingS.toFixed(1)}s < ${minValidWalkS}s`);
  if (maxStillS > stallFailS) failures.push(`stalled ${maxStillS.toFixed(1)}s > ${stallFailS}s while unpaused`);
  return {
    pass: failures.length === 0,
    failures,
    stats: { totalS: +totalS.toFixed(1), movingS: +movingS.toFixed(1), pausedS: +pausedS.toFixed(1),
      distanceM: +distance.toFixed(1), maxStillS: +maxStillS.toFixed(1), stillRuns,
      fellAt, nonFinite, legsDeclared: legNames?.length ?? null },
  };
}

export function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (!sortedValues.every(Number.isFinite)) throw new RouteTargetError('percentile input must be finite');
  const i = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return +sortedValues[i].toFixed(2);
}

// Frame-interval statistics recomputed from RAW time-ordered samples — never
// from a pre-sorted top-N subset (the B7-R1 data-retention defect). Samples are
// [tMs, visible01, focus01, phase]. Only the requested phase with both samples
// visible+focused contributes intervals; every exclusion carries a reason.
export function frameIntervalStats(samples, { phase }) {
  const intervals = [];
  let excluded = 0;
  const reasons = { phase: 0, hiddenOrUnfocused: 0, nonFinite: 0, nonPositiveDt: 0 };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 4 || b.length < 4) { excluded++; reasons.nonFinite++; continue; }
    if (a[3] !== phase || b[3] !== phase) { excluded++; reasons.phase++; continue; }
    if (!a[1] || !a[2] || !b[1] || !b[2]) { excluded++; reasons.hiddenOrUnfocused++; continue; }
    const dt = b[0] - a[0];
    if (!Number.isFinite(dt)) { excluded++; reasons.nonFinite++; continue; }
    if (dt <= 0) { excluded++; reasons.nonPositiveDt++; continue; }
    intervals.push(+dt.toFixed(2));
  }
  const sorted = [...intervals].sort((x, y) => x - y);
  return {
    phase, kept: intervals.length, excluded, reasons,
    p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.length ? +sorted[sorted.length - 1].toFixed(2) : null,
    meanMs: intervals.length ? +(intervals.reduce((s, v) => s + v, 0) / intervals.length).toFixed(2) : null,
    intervalsSorted: sorted,
  };
}
