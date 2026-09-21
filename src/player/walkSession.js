// Walk session state (player-experience batch A) — the DOM-free decision core
// for player mode switching. The page applies the returned decisions to the
// real WalkController/camera; node tests drive the same class with fakes.
//
// Contract (the 20260920 defects this replaces):
//   - entering walk NEVER resets a live session: the first entry spawns at a
//     SAFE validated anchor chosen from the framing camera; every later entry
//     restores the exact captured pose. A mode switch is not a new game.
//   - pause (P), window blur and pointer-lock loss clear the input state and
//     never move the capsule; resume always starts from clean input.
//   - explicit location selection is a TELEPORT, recorded as relocation with
//     explicit=true — never presented as walking evidence.
//
// Safe-fall recovery (REL-02 of the reliability batch, world 20260921): the
// long-run evidence shows players walking off the walkable surface (bridge
// east tail, mid-street north edge) fall into the void with NO protection.
// observeWalk() runs every rendered frame INSIDE the normal walk state chain
// (never via teleport/re-entry shortcuts) and:
//   - caches the last safe pose: grounded on real support, stable landing —
//     the page injects validateSafe() built from the PRODUCTION ground
//     extraction (ground faces only, with an edge margin), so wall tops,
//     airborne feet and mid-fall points are never cached as safe
//   - recovers when the feet leave the scene's real ground band: below the
//     scene floor (floorY, derived from the actual ground triangles — NOT a
//     hardcoded world y=0), or a vertical drop beyond any legitimate scene
//     drop (temple court 0.85 m), or airborne far longer than any jump
//   - returns to the last VERIFIED safe pose (revalidated before use), or —
//     only when none exists — to a validated entry anchor; old input,
//     velocity and the accumulated dt die with the teleport+resume
//   - every recovery is recorded { reason, from, to, at, target } — clearly
//     separate from explicit relocations, never presented as normal walking.
export class WalkSession {
  constructor({ getAnchors, now = () => Date.now(), recovery = null } = {}) {
    if (typeof getAnchors !== 'function') throw new Error('WalkSession: getAnchors required');
    this.getAnchors = getAnchors;
    this.now = now;
    this.mode = 'view';
    this.everWalked = false;
    this.paused = false;
    this.pose = null;          // { feet:[x,y,z], yaw, pitch } captured on exit
    this.pendingAnchorId = null;
    this.spawnCount = 0;
    this.relocations = [];     // { anchorId, at, explicit:true }
    // safe-fall recovery state + thresholds (scene-tuned, see module header)
    this.recoveryCfg = {
      floorY: -0.55,           // below ANY real walkable surface in the scene
      maxDropM: 2.5,           // largest legitimate scene drop is 0.85 m (court -> street)
      airborneTimeoutS: 4,     // a jump is airborne well under 1 s even at low fps
      cooldownS: 1.0,          // let the recovered pose settle before re-arming triggers
      validateSafe: null,      // (feet, controller) => bool — page-side ground/edge check
      ...(recovery ?? {}),
    };
    this.lastSafe = null;      // { feet, yaw, pitch } — last VERIFIED safe pose
    this.fall = { airborneS: 0, lastRecoveryAt: -Infinity };
    this.recoveries = [];      // { reason, from, to, at, target } — never mixed with relocations
  }

  #validated(id) {
    return this.getAnchors().find((a) => a.id === id && a.validation?.ok) ?? null;
  }

  // Enter walk mode. An explicit pending location choice always wins (it is
  // the player's own instruction); the first entry otherwise spawns at a safe
  // anchor chosen from the framing camera; every later entry restores the
  // exact captured pose. A mode switch is not a new game.
  beginWalk(controller, cameraPos) {
    if (this.mode === 'walk') return null;
    const pending = this.pendingAnchorId ? this.#validated(this.pendingAnchorId) : null;
    if (pending) {
      controller.teleport(pending.position, pending.yaw ?? 0, 0);
      controller.resume();
      this.pose = { feet: [...pending.position], yaw: pending.yaw ?? 0, pitch: 0 };
      this.pendingAnchorId = null;
      // the player HAS walked from here on: without this, the next view->walk
      // entry re-spawned at the anchor instead of restoring the pose (the
      // 20260921 batch moved the fix from the fangbangMain call site into
      // this authoritative state layer)
      this.everWalked = true;
      this.mode = 'walk';
      this.paused = false;
      this.spawnCount += 1;
      return { spawned: { anchorId: pending.id, labelZh: pending.labelZh,
        displaced: false, reason: 'explicit-choice', horizDistM: 0 }, restored: false };
    }
    if (!this.everWalked) {
      let pick = null;
      if (cameraPos) {
        const anchors = this.getAnchors().filter((a) => a.validation?.ok);
        pick = anchorForCameraSafe(anchors, cameraPos);
      } else {
        const anchors = this.getAnchors().filter((a) => a.validation?.ok);
        if (anchors.length) pick = { anchor: anchors[0], displaced: true, reason: 'fallback' };
      }
      if (!pick) return { spawned: null, restored: false, error: 'no validated anchor' };
      controller.teleport(pick.anchor.position, pick.anchor.yaw ?? 0, 0);
      controller.resume();
      this.pose = { feet: [...pick.anchor.position], yaw: pick.anchor.yaw ?? 0, pitch: 0 };
      this.everWalked = true;
      this.spawnCount += 1;
      this.mode = 'walk';
      this.paused = false;
      return { spawned: { anchorId: pick.anchor.id, labelZh: pick.anchor.labelZh,
        displaced: pick.displaced, reason: pick.reason, horizDistM: pick.horizDistM }, restored: false };
    }
    // restore the captured pose exactly
    controller.teleport(this.pose.feet, this.pose.yaw, this.pose.pitch);
    controller.resume();
    this.mode = 'walk';
    this.paused = false;
    return { spawned: null, restored: true, pose: this.pose };
  }

  // Leave walk mode, capturing where the player actually stands.
  endWalk(controller) {
    if (this.mode !== 'walk') return null;
    this.pose = { feet: controller.feetPosition(), yaw: controller.yaw, pitch: controller.pitch };
    controller.clearKeys();
    this.mode = 'view';
    this.paused = false;
    return this.pose;
  }

  pause(controller, reason = 'user') {
    if (this.mode !== 'walk' || this.paused) return { paused: this.paused, reason: null, changed: false };
    this.paused = true;
    controller.pause();          // clears input + accumulator
    return { paused: true, reason, changed: true };
  }

  resume(controller) {
    if (this.mode !== 'walk' || !this.paused) return { paused: this.paused, changed: false };
    this.paused = false;
    controller.resume();         // clean input state, no teleport
    return { paused: false, changed: true };
  }

  blur(controller) { return this.pause(controller, 'blur'); }
  pointerLockLost(controller) { return this.pause(controller, 'lock-lost'); }

  // Explicit location choice (the UI's 主街/A弄/B弄/庙前). Teleports when
  // walking; when viewing, it becomes the next walk spawn. Either way it is
  // an explicit relocation, never walk evidence.
  relocate(controller, anchorId) {
    const anchor = this.#validated(anchorId);
    if (!anchor) return { ok: false };
    this.relocations.push({ anchorId, at: this.now(), explicit: true });
    this.pendingAnchorId = anchorId;
    this.pose = { feet: [...anchor.position], yaw: anchor.yaw ?? 0, pitch: 0 };
    if (this.mode === 'walk') controller.teleport(anchor.position, anchor.yaw ?? 0, 0);
    return { ok: true, anchor };
  }

  // Per-frame safety observation — the page calls this every rendered frame
  // while walking and unpaused, right after controller.step(dt). Returns a
  // recovery decision { recovered: true, reason, from, to, target } or null.
  observeWalk(controller, dtSeconds) {
    if (this.mode !== 'walk' || this.paused) return null;
    const cfg = this.recoveryCfg;
    const feet = controller.feetPosition();
    const grounded = controller.isGrounded();
    if (grounded) {
      this.fall.airborneS = 0;
      const step = controller.lastStep;
      // stick-to-ground corrected motion is a few cm per step; a sliding or
      // still-settling foot must not enter the safe cache
      if (!step || (step.grounded && step.corrected[1] > -0.045)) this.#cacheSafeIfValid(controller, feet);
    } else {
      this.fall.airborneS += Math.max(0, dtSeconds);
    }
    const t = this.now();
    if (t - this.fall.lastRecoveryAt < cfg.cooldownS * 1000) return null;
    let reason = null;
    if (cfg.floorY !== null && cfg.floorY !== undefined && feet[1] < cfg.floorY) reason = 'below-floor';
    else if (this.lastSafe && feet[1] < this.lastSafe.feet[1] - cfg.maxDropM) reason = 'excessive-drop';
    else if (this.fall.airborneS > cfg.airborneTimeoutS) reason = 'airborne-timeout';
    if (!reason) return null;
    return this.#recover(controller, reason, feet);
  }

  #cacheSafeIfValid(controller, feet) {
    // the page-side check is the production ground extraction: real support
    // under the feet AND an edge margin, so returning here cannot re-fall
    if (this.recoveryCfg.validateSafe && !this.recoveryCfg.validateSafe(feet, controller)) return;
    this.lastSafe = { feet: [feet[0], feet[1], feet[2]], yaw: controller.yaw, pitch: controller.pitch };
  }

  #stillSafe(target) {
    if (!this.recoveryCfg.validateSafe) return true;
    return this.recoveryCfg.validateSafe(target.feet, null);
  }

  #recover(controller, reason, fromFeet) {
    const round = (p) => p.map((v) => +v.toFixed(3));
    let target = null, targetKind = null;
    if (this.lastSafe && this.#stillSafe(this.lastSafe)) {
      target = this.lastSafe; targetKind = 'last-safe';
    } else {
      // only with NO usable safe pose: fall back to the nearest VALIDATED
      // entry anchor (real walked positions, never invented constants)
      const from = fromFeet;
      let best = null, bd = Infinity;
      for (const a of this.getAnchors()) {
        if (!a.validation?.ok) continue;
        const d = Math.hypot(a.position[0] - from[0], a.position[2] - from[2]);
        if (d < bd) { bd = d; best = a; }
      }
      if (best) { target = { feet: [...best.position], yaw: best.yaw ?? 0, pitch: 0 }; targetKind = `anchor:${best.id}`; }
    }
    if (!target) return { recovered: false, reason };
    const event = { reason, from: round(fromFeet), to: round(target.feet), at: this.now(), target: targetKind };
    // clean slate: pending input, vertical velocity and the fixed-step
    // accumulator all die here (teleport resets them, resume zeroes dt)
    controller.teleport(target.feet, target.yaw, target.pitch);
    controller.resume();
    this.lastSafe = { feet: [...target.feet], yaw: target.yaw, pitch: target.pitch };
    this.fall.airborneS = 0;
    this.fall.lastRecoveryAt = this.now();
    this.recoveries.push(event);
    if (this.recoveries.length > 100) this.recoveries.shift();
    return { recovered: true, ...event };
  }

  snapshot() {
    return {
      mode: this.mode, paused: this.paused, everWalked: this.everWalked,
      spawnCount: this.spawnCount,
      relocations: this.relocations.map((r) => ({ ...r })),
      pendingAnchorId: this.pendingAnchorId,
      pose: this.pose ? { ...this.pose, feet: [...this.pose.feet] } : null,
      recoveryCount: this.recoveries.length,
      recoveries: this.recoveries.map((r) => ({ ...r, from: [...r.from], to: [...r.to] })),
    };
  }
}

function anchorForCameraSafe(anchors, cameraPos) {
  if (!anchors.length) return null;
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(a.position[0] - cameraPos[0], a.position[2] - cameraPos[2]);
    if (d < bestD) { bestD = d; best = a; }
  }
  const aerial = cameraPos[1] > 3;
  return {
    anchor: best,
    horizDistM: +bestD.toFixed(2),
    displaced: aerial || bestD > 6,
    reason: aerial ? 'aerial' : bestD > 6 ? 'far' : 'near',
  };
}
