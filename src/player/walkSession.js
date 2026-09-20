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
export class WalkSession {
  constructor({ getAnchors, now = () => Date.now() } = {}) {
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

  snapshot() {
    return {
      mode: this.mode, paused: this.paused, everWalked: this.everWalked,
      spawnCount: this.spawnCount,
      relocations: this.relocations.map((r) => ({ ...r })),
      pendingAnchorId: this.pendingAnchorId,
      pose: this.pose ? { ...this.pose, feet: [...this.pose.feet] } : null,
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
