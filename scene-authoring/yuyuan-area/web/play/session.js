// Play-phase 1 session state — the DOM-free decision core for the playable
// gray-cat mode (?play=1). The page (web/walk.js play profile + web/play/*)
// applies these decisions to the real WalkController/camera; node tests drive
// the same class with the real controller and the real reviewed world
// (tests/play_session.test.mjs).
//
// Contract (GOAL.md 生命周期):
//   - the FIRST play entry spawns at the given feet; every later enter/exit
//     round-trip restores the exact captured pose (feet + yaw + pitch). A mode
//     switch (取景) is never a new game and never respawns at the anchor.
//   - pause (P key), window blur and pointer-lock loss clear the input state
//     and never move the capsule; resume always starts from clean input with a
//     zeroed fixed-step accumulator, so no paused gap turns into a dt jump.
//   - only an EXPLICIT relocation (回到锚点 / anchor choice) moves the spawn
//     position; it is recorded separately and is never presented as walking.
export class PlaySession {
  constructor({ spawn = null } = {}) {
    this.spawn = spawn;          // default spawn feet [x,y,z], used when the page gives none
    this.mode = 'view';          // 'view' | 'play'
    this.everSpawned = false;
    this.paused = false;
    this.pausedReason = null;
    this.pose = null;            // { feet:[x,y,z], yaw, pitch } captured on exit
    this.spawnCount = 0;
    this.relocations = [];       // { feet, at, explicit:true }
  }

  // Enter play. First entry spawns (spawnFeet wins over constructor spawn);
  // every later entry restores the captured pose exactly.
  begin(controller, { spawnFeet = null } = {}) {
    if (this.mode === 'play') return null;
    if (!this.everSpawned) {
      const feet = spawnFeet ?? this.spawn;
      if (!feet) return { spawned: false, restored: false, error: 'no spawn point' };
      controller.teleport(feet, 0, 0);
      controller.resume();
      this.pose = { feet: [...feet], yaw: 0, pitch: 0 };
      this.everSpawned = true;
      this.spawnCount += 1;
      this.mode = 'play';
      this.paused = false;
      this.pausedReason = null;
      return { spawned: true, restored: false, pose: { ...this.pose, feet: [...this.pose.feet] } };
    }
    controller.teleport(this.pose.feet, this.pose.yaw, this.pose.pitch);
    controller.resume();
    this.mode = 'play';
    this.paused = false;
    this.pausedReason = null;
    return { spawned: false, restored: true, pose: { ...this.pose, feet: [...this.pose.feet] } };
  }

  // Leave play (取景/退出), capturing where the player actually stands.
  end(controller) {
    if (this.mode !== 'play') return null;
    this.pose = { feet: controller.feetPosition(), yaw: controller.yaw, pitch: controller.pitch };
    controller.clearKeys();
    this.mode = 'view';
    this.paused = false;
    this.pausedReason = null;
    return { ...this.pose, feet: [...this.pose.feet] };
  }

  pause(controller, reason = 'user') {
    if (this.mode !== 'play' || this.paused) return { changed: false, reason: null };
    this.paused = true;
    this.pausedReason = reason;
    controller.pause();          // clears input + fixed-step accumulator
    return { changed: true, reason };
  }

  resume(controller) {
    if (this.mode !== 'play' || !this.paused) return { changed: false };
    this.paused = false;
    this.pausedReason = null;
    controller.resume();         // clean input state, zeroed accumulator, no teleport
    return { changed: true };
  }

  // Explicit location choice (回到锚点 / anchor menu). Teleports when playing;
  // while viewing it becomes the next play spawn. Either way it is an explicit
  // relocation record, never walking evidence.
  relocate(controller, feet, yaw = 0) {
    this.pose = { feet: [feet[0], feet[1], feet[2]], yaw, pitch: 0 };
    this.everSpawned = true;
    this.relocations.push({ feet: [...this.pose.feet], at: Date.now(), explicit: true });
    if (this.mode === 'play' && controller) controller.teleport(this.pose.feet, yaw, 0);
    return { ok: true, pose: { ...this.pose, feet: [...this.pose.feet] } };
  }

  snapshot() {
    return {
      mode: this.mode,
      paused: this.paused,
      pausedReason: this.pausedReason,
      everSpawned: this.everSpawned,
      spawnCount: this.spawnCount,
      pose: this.pose ? { ...this.pose, feet: [...this.pose.feet] } : null,
      relocations: this.relocations.map((r) => ({ ...r, feet: [...r.feet] })),
    };
  }
}
