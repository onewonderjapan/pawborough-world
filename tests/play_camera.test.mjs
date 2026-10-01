// Play-phase 1 third-person camera + avatar math, driven with real THREE
// objects and a stub controller/castRay (the browser wire-up only injects the
// real Rapier ray that excludes the player's own capsule).
//
// Run: node tests/play_camera.test.mjs   (exit 0 = contract holds)
import * as THREE from 'three';
import { PlayCamera, computeCameraPlacement } from '../scene-authoring/yuyuan-area/web/play/camera.js';
import { PlayAvatar, avatarYawFor, MODEL_FORWARD } from '../scene-authoring/yuyuan-area/web/play/avatar.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// controller forward convention shared with WalkController:
// forward = (-sin yaw, 0, -cos yaw)
const controllerForward = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
function stubController(feet, yaw, pitch = 0) {
  return {
    feetPosition: () => [...feet],
    yaw, pitch,
  };
}

// --- pure placement math: free view, wall retraction, hard floor on distance
{
  const pivot = new THREE.Vector3(1, 0.8, 2);
  const dir = new THREE.Vector3(0, 0, 1);
  const free = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: null });
  check('no wall: camera sits the full distance behind the pivot',
    free.position.distanceTo(pivot.clone().addScaledVector(dir, 2.4)) < 1e-9);

  const wall = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: 1.0, margin: 0.12 });
  check('wall: camera retracts to hit minus margin',
    close(wall.position.distanceTo(pivot), 0.88, 1e-9), `d=${wall.position.distanceTo(pivot).toFixed(4)}`);

  const tight = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: 0.2, margin: 0.12, minDistance: 0.5 });
  check('very close wall: distance floors at minDistance (camera never reaches the pivot)',
    close(tight.position.distanceTo(pivot), 0.5, 1e-9), `d=${tight.position.distanceTo(pivot).toFixed(4)}`);

  const nan = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: NaN });
  check('NaN hitT is treated as no wall', close(nan.position.distanceTo(pivot), 2.4, 1e-9));
}

// --- PlayCamera.update: behind-the-model placement + look-at, wall retraction
{
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 600);
  const pc = new PlayCamera({ camera, shoulderHeight: 0.62, distance: 2.4 });
  const yaw = -Math.PI / 2; // controller faces +X
  pc.update({ controller: stubController([10, 0.02, -4], yaw), dt: 1 / 60 });
  const expectedPivot = new THREE.Vector3(10, 0.64, -4);
  const fwd = controllerForward(yaw);
  const expectedCam = expectedPivot.clone().addScaledVector(fwd, -2.4); // behind the model
  check('camera pivot rides at feet + shoulder height', pc.pivot.distanceTo(expectedPivot) < 1e-9,
    `pivot=(${pc.pivot.x.toFixed(2)},${pc.pivot.y.toFixed(2)},${pc.pivot.z.toFixed(2)})`);
  check('camera sits behind the model (opposite controller forward)',
    camera.position.distanceTo(expectedCam) < 1e-9,
    `cam=(${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)})`);
  const toPivot = expectedPivot.clone().sub(camera.position).normalize();
  const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd);
  check('camera looks at the pivot', camFwd.dot(toPivot) > 1 - 1e-6);

  // wall 1 m behind the model: camera retracts, pivot unchanged, still look-at
  let rayDir = null;
  const hit = pc.update({
    controller: stubController([10, 0.02, -4], yaw),
    dt: 1 / 60,
    castRay: (origin, dir, maxToi) => { rayDir = dir.clone(); return 1.0; },
  });
  check('castRay got the pivot->camera direction', rayDir && rayDir.distanceTo(fwd.clone().negate()) < 1e-9);
  check('wall behind: applied distance retracts to hit-margin', close(hit.applied, 0.88, 1e-9));
  check('retracted camera still looks at the pivot', (() => {
    const f = new THREE.Vector3(); camera.getWorldDirection(f);
    const to = expectedPivot.clone().sub(camera.position).normalize();
    return f.dot(to) > 1 - 1e-6;
  })());
  check('retraction never moved the pivot', pc.pivot.distanceTo(expectedPivot) < 1e-9);

  // illegal dt must not propagate NaN into the camera
  const before = camera.position.clone();
  pc.update({ controller: stubController([10, 0.02, -4], yaw), dt: NaN });
  pc.update({ controller: stubController([10, 0.02, -4], yaw), dt: -5 });
  check('NaN/negative dt leave the camera finite and unmoved',
    camera.position.every?.call(camera.position, Number.isFinite) ?? Number.isFinite(camera.position.x + camera.position.y + camera.position.z));
  check('NaN dt did not re-place the camera', camera.position.distanceTo(before) < 1e-12);
}

// --- avatar: position from feet only, model-forward alignment, action states
{
  // minimal stand-in for the GLB graph: a group whose geometry spans
  // y [0, 0.964] with the face on +Z (real-asset facts are pinned separately
  // in tests/play_asset_contract.test.mjs)
  const model = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.964, 0.4));
  box.name = 'root'; // the real GLB's skeleton root the clips bind to
  box.position.y = 0.964 / 2 + 0.006;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05));
  nose.position.set(0, 0.8, 0.25); // +Z face marker
  model.add(box, nose);
  const clip = (name) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0]),
  ]);
  const avatar = new PlayAvatar({ gltfScene: model, animations: [clip('idle'), clip('walk'), clip('eat')] });

  check('avatar exposes modelMinY from real geometry bounds', close(avatar.modelMinY, 0.006, 1e-6),
    `minY=${avatar.modelMinY}`);
  check('avatar height matches geometry', close(avatar.height, 0.964, 1e-6));

  const yaw = 0;
  avatar.update({ feet: [3, 0.02, 7], yaw, moving: false, paused: false, dt: 1 / 60 });
  check('outer wrapper sits at feet minus modelMinY (visual root never adds motion)',
    close(avatar.root.position.x, 3) && close(avatar.root.position.y, 0.02 - avatar.modelMinY, 1e-9) && close(avatar.root.position.z, 7));
  check('avatar yaw aligns the +Z model face with the controller forward',
    (() => {
      const modelFwd = MODEL_FORWARD.clone().applyEuler(new THREE.Euler(0, avatar.root.rotation.y, 0));
      const ctrlFwd = controllerForward(yaw);
      return modelFwd.distanceTo(ctrlFwd) < 1e-9;
    })(), `rotation.y=${avatar.root.rotation.y.toFixed(4)} (model +Z faces controller forward)`);
  check('avatarYawFor is the yaw+PI convention', close(avatarYawFor(0), Math.PI) && close(avatarYawFor(-Math.PI / 2), Math.PI / 2));

  const idleW = () => avatar.actions.idle.getEffectiveWeight();
  const walkW = () => avatar.actions.walk.getEffectiveWeight();
  check('standing plays idle', idleW() === 1 && walkW() === 0);
  avatar.update({ feet: [3, 0.02, 7], yaw, moving: true, speed: 1.5, paused: false, dt: 1 / 60 });
  check('actual corrected displacement (moving=true) switches to walk', walkW() === 1 && idleW() === 0);
  check('walk timeScale follows actual speed (speed/cycleSpeed)', close(avatar.actions.walk.timeScale, 1.5 / avatar.walkCycleSpeed, 1e-9),
    `timeScale=${avatar.actions.walk.timeScale}`);
  avatar.update({ feet: [3, 0.02, 7], yaw, moving: false, paused: false, dt: 1 / 60 });
  check('stopped/wall-blocked switches back to idle', idleW() === 1 && walkW() === 0);

  const t0 = avatar.mixer.time;
  avatar.update({ feet: [3, 0.02, 7], yaw, moving: false, paused: true, dt: 0.5 });
  check('paused freezes the mixer (animation cannot add motion)', close(avatar.mixer.time, t0, 1e-12));
  avatar.update({ feet: [3, 0.02, 7], yaw, moving: false, paused: false, dt: NaN });
  check('NaN dt does not advance the mixer or NaN the wrapper', Number.isFinite(avatar.mixer.time)
    && Number.isFinite(avatar.root.position.x + avatar.root.position.y + avatar.root.position.z));

  const parent = new THREE.Group(); parent.add(avatar.root);
  avatar.dispose();
  check('dispose detaches the avatar and stays idempotent', !avatar.root.parent);
  let err = null; try { avatar.dispose(); } catch (e) { err = e; }
  check('repeat dispose is a no-op', !err, err?.message ?? '');
}

console.log(failures === 0 ? 'PLAY_CAMERA PASS' : `PLAY_CAMERA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
