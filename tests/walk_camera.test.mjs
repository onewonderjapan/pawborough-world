// R1 walk-camera regression — drives the REAL production camera update
// (applyWalkOrientation, the exact function main.js calls every walk frame)
// against a real THREE.PerspectiveCamera and asserts the quaternion and the
// composed matrices stay finite and point where the controller intends.
// The R1 bug passed the rotation ORDER string as Euler's third argument (the
// Z-roll angle), producing a non-finite quaternion and a fully blank walk
// view; the negative control below reproduces that old construction and must
// stay non-finite so a future revert of the fix cannot pass silently.
//
// Run: node tests/walk_camera.test.mjs   (exit 0 = contract holds)
import * as T from 'three';
import { applyWalkOrientation } from '../src/player/walkCamera.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const finite = (arr) => arr.every(Number.isFinite);

// --- negative control: the exact R1 regression construction
{
  const broken = new T.Quaternion().setFromEuler(new T.Euler(0.2, -Math.PI / 2, 'YXZ'));
  check('R1 negative control: order-as-Z-angle still yields a non-finite quaternion',
    !finite(broken.toArray()), `q=[${broken.toArray().map(v => Number(v).toFixed(3)).join(', ')}]`);
}

// --- production path: real camera, every heading/pitch in controller range
const camera = new T.PerspectiveCamera(45, 16 / 9, 0.1, 600);
let allFinite = true;
let firstBad = null;
for (let yaw = -Math.PI; yaw <= Math.PI + 1e-9; yaw += Math.PI / 12) {
  for (const pitch of [-1.45, -0.6, 0, 0.6, 1.45]) { // WalkController.look clamps to ±1.45
    applyWalkOrientation(camera, pitch, yaw);
    camera.updateMatrixWorld(true);
    if (!finite(camera.quaternion.toArray()) || !finite(camera.matrixWorld.elements)) {
      allFinite = false;
      firstBad ??= `yaw=${yaw.toFixed(3)} pitch=${pitch}`;
    }
  }
}
check('production orientation keeps quaternion finite over the full look range', allFinite, firstBad ?? '');

// spawn/reset heading: resetController uses yaw=-PI/2 to face east (+X)
{
  applyWalkOrientation(camera, 0, -Math.PI / 2);
  camera.updateMatrixWorld(true);
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  check('reset yaw -PI/2 faces east along +X (street direction)',
    Math.abs(fwd.x - 1) < 1e-6 && Math.abs(fwd.y) < 1e-6 && Math.abs(fwd.z) < 1e-6,
    `forward=(${fwd.x.toFixed(4)}, ${fwd.y.toFixed(4)}, ${fwd.z.toFixed(4)})`);
  check('camera matrixWorld finite at reset heading', finite(camera.matrixWorld.elements));
}

// mouse-down look: positive movementY -> look() lowers pitch -> forward tilts down
{
  applyWalkOrientation(camera, -0.5, -Math.PI / 2);
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  check('negative pitch looks down at the street', fwd.y < -0.4 && fwd.x > 0.8,
    `forward=(${fwd.x.toFixed(3)}, ${fwd.y.toFixed(3)}, ${fwd.z.toFixed(3)})`);
}

// identity: level camera looks along -Z with no roll
{
  applyWalkOrientation(camera, 0, 0);
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  check('zero yaw/pitch looks along -Z with no roll', fwd.z < -0.999 && Math.abs(fwd.x) < 1e-6,
    `forward=(${fwd.x.toFixed(4)}, ${fwd.y.toFixed(4)}, ${fwd.z.toFixed(4)})`);
}

console.log(failures === 0 ? 'WALK_CAMERA PASS' : `WALK_CAMERA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
