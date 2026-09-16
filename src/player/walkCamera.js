// Walk-mode camera orientation — THE production camera update the frame loop
// uses every walk frame (main.js). Kept importable so tests drive the exact
// same code path instead of re-implementing the math.
//
// THREE.Euler's third argument is the Z (roll) angle; the rotation ORDER is
// the fourth argument. The R1 regression passed 'YXZ' as the Z angle, which
// made Euler parsing produce a non-finite quaternion and rendered the walk
// view as an empty background. Roll stays 0 on purpose: this rig has none.
import * as T from 'three';

export function applyWalkOrientation(camera, pitch, yaw) {
  camera.quaternion.setFromEuler(new T.Euler(pitch, yaw, 0, 'YXZ'));
  return camera.quaternion;
}
