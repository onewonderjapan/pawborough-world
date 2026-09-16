// Route cruise driver — walks route.json waypoints through the SAME
// WalkController input chain as a human (setMoveInput only; never a position
// write). Used by the in-browser "路线巡游" test button and by node tests.
// Records per-waypoint progress so an auto-physics cruise is always
// distinguishable from a manual keyboard walk in the evidence record.

export class CruiseDriver {
  constructor({ controller, waypoints, reachRadius = 1.2, timeoutSteps = 60 * 120 }) {
    this.controller = controller;
    this.waypoints = waypoints.map((p) => [p[0], p[2]]); // XZ only
    this.i = 1; // waypoint 0 is the start
    this.reachRadius = reachRadius;
    this.remainingSteps = timeoutSteps;
    this.done = false;
    this.blocked = null;
    this.log = [];
  }

  // Per fixed step: aim at the current waypoint. Returns false when finished.
  tick(dt) {
    if (this.done || this.controller.paused) return !this.done;
    if (this.remainingSteps-- <= 0) {
      this.blocked = { at: this.controller.feetPosition(), waypointIndex: this.i, reason: 'timeout' };
      this.controller.clearKeys();
      this.done = true;
      return false;
    }
    const [fx, , fz] = this.controller.feetPosition();
    const [tx, tz] = this.waypoints[this.i];
    const dx = tx - fx, dz = tz - fz;
    const dist = Math.hypot(dx, dz);
    if (dist <= this.reachRadius) {
      this.log.push({ waypoint: this.i, at: [fx, fz], stepsLeft: this.remainingSteps });
      if (this.i >= this.waypoints.length - 1) {
        this.controller.clearKeys();
        this.done = true;
        return false;
      }
      this.i += 1;
      return true;
    }
    // desired world direction -> controller yaw + forward input
    const targetYaw = Math.atan2(-dx, -dz); // inverse of forward=(-sin,-cos)
    this.controller.yaw = targetYaw;
    this.controller.setMoveInput(1, 0);
    void dt;
    return true;
  }

  status() {
    return {
      done: this.done,
      reached: this.log.length,
      total: this.waypoints.length - 1,
      blocked: this.blocked,
      finalFeet: this.controller.feetPosition(),
    };
  }
}
