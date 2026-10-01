// R1: per-frame play motion telemetry derived from the WalkController's ACTUAL
// corrected displacement (review R0 items 2/3/4). The walk.js play tick feeds
// controller.lastStep here every frame; the result drives the avatar's
// walk/idle state, the walk playback rate (actual speed, not the nominal
// 1.5 m/s) and the character FACING (movement direction — decoupled from the
// camera/view yaw, so mouse-only rotation orbits the cat instead of spinning
// it, and A/D/S never plays the forward cycle sideways/backwards).
//
// facingYaw uses the controller convention: forward(f) = (-sin f, 0, -cos f),
// i.e. f = atan2(-vx, -vz) for corrected velocity (vx, vz). null when not
// actually moving — the caller keeps the previous facing then.
export const MOVE_EPS_SPEED = 0.24; // m/s — below this the capsule is blocked/settling

export function computeStepMotion(lastStep, fixedDt) {
  if (!lastStep || !Number.isFinite(fixedDt) || fixedDt <= 0) {
    return { moving: false, actualSpeed: 0, facingYaw: null };
  }
  const vx = lastStep.corrected[0] / fixedDt;
  const vz = lastStep.corrected[2] / fixedDt;
  const actualSpeed = Math.hypot(vx, vz);
  if (!(actualSpeed > MOVE_EPS_SPEED)) {
    return { moving: false, actualSpeed, facingYaw: null };
  }
  return { moving: true, actualSpeed, facingYaw: Math.atan2(-vx, -vz) };
}
