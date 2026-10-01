// Play-phase 1 third-person camera + avatar math, driven with real THREE
// objects and a stub controller/castRay (the browser wire-up only injects the
// real Rapier ray that excludes the player's own capsule).
//
// R1 repair additions (review R0): occlusion safety beats the comfort floor
// (near-wall retraction may shrink far below minDistance, pure boundary tests
// + a real Rapier near-wall ray); view yaw is decoupled from the character
// facing (facing follows actual displacement, idle/pause keep the last
// facing); walk playback follows actual speed; dispose frees the avatar's OWN
// GPU resources (geometry/material/texture/skeleton), idempotently.
//
// Run: node tests/play_camera.test.mjs   (exit 0 = contract holds)
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
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

// --- pure placement math: free view, wall retraction, occlusion beats comfort
{
  const pivot = new THREE.Vector3(1, 0.8, 2);
  const dir = new THREE.Vector3(0, 0, 1);
  const free = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: null });
  check('no wall: camera sits the full distance behind the pivot',
    free.position.distanceTo(pivot.clone().addScaledVector(dir, 2.4)) < 1e-9);

  const wall = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: 1.0, margin: 0.12 });
  check('wall: camera retracts to hit minus margin',
    close(wall.position.distanceTo(pivot), 0.88, 1e-9), `d=${wall.position.distanceTo(pivot).toFixed(4)}`);

  // R0-1: a wall CLOSER than minDistance+margin must win over the comfort floor
  const near = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: 0.28, margin: 0.12, minDistance: 0.5 });
  check('near wall (hit<minDistance+margin): safety beats minDistance (0.28-0.12=0.16, NOT 0.5)',
    close(near.applied, 0.16, 1e-9) && near.position.distanceTo(pivot) < 0.28,
    `applied=${near.applied.toFixed(4)}`);

  // Hit closer than the margin leaves zero safe clearance — stay at the pivot.
  const tight = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: 0.05, margin: 0.12, minDistance: 0.5, minSafe: 0.02 });
  check('hit<margin: zero safe clearance stays at the pivot (never negative or beyond the hit)',
    close(tight.applied, 0, 1e-9) && tight.applied < 0.05 && Number.isFinite(tight.applied),
    `applied=${tight.applied.toFixed(4)}`);

  for (const hitT of [0.005, 0]) {
    const closeHit = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT, margin: 0.12 });
    check('even a sub-2cm/zero hit cannot be crossed by a safety floor',
      closeHit.applied <= hitT && closeHit.applied >= 0,
      `hit=${hitT} applied=${closeHit.applied}`);
  }

  const nan = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT: NaN });
  check('NaN hitT is treated as no wall', close(nan.position.distanceTo(pivot), 2.4, 1e-9));
}

// --- real Rapier near-wall ray feeding the placement (R0-1)
{
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // wall plane 0.28 m in front of the pivot along +Z
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, 0.1).setTranslation(0, 0, 0.38));
  world.step();
  const pivot = new THREE.Vector3(0, 0.62, 0);
  const dir = new THREE.Vector3(0, 0, 1);
  const ray = new RAPIER.Ray({ x: pivot.x, y: pivot.y, z: pivot.z }, { x: dir.x, y: dir.y, z: dir.z });
  const hit = world.castRay(ray, 2.4, true);
  const hitT = hit ? hit.timeOfImpact : null;
  check('rapier ray sees the near wall at ~0.28', hitT !== null && Math.abs(hitT - 0.28) < 1e-3,
    `hitT=${hitT?.toFixed(4)}`);
  const place = computeCameraPlacement({ pivot, dir, distance: 2.4, hitT, margin: 0.12, minDistance: 0.5, minSafe: 0.02 });
  check('placement retracts to hit-margin despite minDistance=0.5',
    close(place.applied, 0.16, 1e-3), `applied=${place.applied.toFixed(4)}`);
  check('camera stays on the safe side of the wall plane',
    place.position.z < 0.28 - 1e-6, `z=${place.position.z.toFixed(4)}`);
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
    Number.isFinite(camera.position.x + camera.position.y + camera.position.z));
  check('NaN dt did not re-place the camera', camera.position.distanceTo(before) < 1e-12);
}

// --- avatar: facing decoupled from view yaw (R0-3), speed from actual motion (R0-4)
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

  // first frames: no movement yet -> facing falls back to the view yaw
  avatar.update({ feet: [3, 0.02, 7], yaw: 0, moving: false, paused: false, dt: 1 / 60 });
  check('before any movement the cat faces the view direction', close(avatar.root.rotation.y, avatarYawFor(0), 1e-9));

  // mouse-only view rotation while standing must NOT turn the character
  avatar.update({ feet: [3, 0.02, 7], yaw: 1.1, moving: false, facingYaw: null, paused: false, dt: 1 / 60 });
  check('idle view rotation keeps the last facing (camera orbits, cat stays)',
    close(avatar.root.rotation.y, avatarYawFor(0), 1e-9), `rot=${avatar.root.rotation.y.toFixed(4)}`);

  // actual displacement turns the cat toward the movement direction
  avatar.update({ feet: [3, 0.02, 7], yaw: 1.1, moving: true, facingYaw: -Math.PI / 2, speed: 1.5, paused: false, dt: 1 / 60 });
  check('walking: facing follows the actual movement direction (+X for f=-PI/2)',
    close(avatar.root.rotation.y, avatarYawFor(-Math.PI / 2), 1e-9),
    `rot=${avatar.root.rotation.y.toFixed(4)}`);
  const modelFwd = MODEL_FORWARD.clone().applyEuler(new THREE.Euler(0, avatar.root.rotation.y, 0));
  const ctrlFwd = controllerForward(-Math.PI / 2);
  check('model +Z face points along the movement direction', modelFwd.distanceTo(ctrlFwd) < 1e-9);

  // stopping keeps the last facing (no snap back to the view yaw)
  avatar.update({ feet: [3, 0.02, 7], yaw: -0.4, moving: false, facingYaw: null, paused: false, dt: 1 / 60 });
  check('stopped: facing persists (does not snap to the new view yaw)',
    close(avatar.root.rotation.y, avatarYawFor(-Math.PI / 2), 1e-9));

  const idleW = () => avatar.actions.idle.getEffectiveWeight();
  const walkW = () => avatar.actions.walk.getEffectiveWeight();
  check('stopped/wall-blocked switches back to idle', idleW() === 1 && walkW() === 0);
  avatar.update({ feet: [3, 0.02, 7], yaw: -0.4, moving: true, facingYaw: 0, speed: 1.5, paused: false, dt: 1 / 60 });
  check('actual corrected displacement (moving=true) switches to walk', walkW() === 1 && idleW() === 0);
  check('walk timeScale follows ACTUAL speed (R0-4)', close(avatar.actions.walk.timeScale, 1.5 / avatar.walkCycleSpeed, 1e-9));
  avatar.update({ feet: [3, 0.02, 7], yaw: -0.4, moving: true, facingYaw: 0, speed: 0.6, paused: false, dt: 1 / 60 });
  check('half-blocked low speed slows the gait', close(avatar.actions.walk.timeScale, 0.6 / avatar.walkCycleSpeed, 1e-9),
    `timeScale=${avatar.actions.walk.timeScale.toFixed(3)}`);

  // paused mid-walk: keep weights and facing (freeze frame), mixer frozen
  const t0 = avatar.mixer.time;
  const wBefore = walkW();
  avatar.update({ feet: [3, 0.02, 7], yaw: 2.0, moving: true, facingYaw: 0, speed: 1.5, paused: true, dt: 0.5 });
  check('paused freezes the mixer (animation cannot add motion)', close(avatar.mixer.time, t0, 1e-12));
  check('paused keeps the walk weight (no pose snap) and the facing', walkW() === wBefore
    && close(avatar.root.rotation.y, avatarYawFor(0), 1e-9));

  avatar.update({ feet: [3, 0.02, 7], yaw: -0.4, moving: false, paused: false, dt: NaN });
  check('NaN dt does not advance the mixer or NaN the wrapper', Number.isFinite(avatar.mixer.time)
    && Number.isFinite(avatar.root.position.x + avatar.root.position.y + avatar.root.position.z));

  const parent = new THREE.Group(); parent.add(avatar.root);
  avatar.dispose();
  check('dispose detaches the avatar and stays idempotent', !avatar.root.parent);
  let err = null; try { avatar.dispose(); } catch (e) { err = e; }
  check('repeat dispose is a no-op', !err, err?.message ?? '');
}

// --- dispose frees the avatar's OWN GPU resources (R0-6), idempotent
{
  const model = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const mat = new THREE.MeshStandardMaterial();
  const tex = new THREE.Texture();
  mat.map = tex;
  let geoD = 0, matD = 0, texD = 0;
  geo.addEventListener('dispose', () => geoD++);
  mat.addEventListener('dispose', () => matD++);
  tex.addEventListener('dispose', () => texD++);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  let skelD = 0;
  const origSkelDispose = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => { skelD++; origSkelDispose(); };
  mesh.skeleton = skeleton;
  model.add(mesh);
  const clip = new THREE.AnimationClip('idle', 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0]),
  ]);
  const walkClip = new THREE.AnimationClip('walk', 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0]),
  ]);
  const avatar = new PlayAvatar({ gltfScene: model, animations: [clip, walkClip] });
  avatar.dispose();
  check('dispose frees geometry', geoD === 1, `geoD=${geoD}`);
  check('dispose frees material', matD === 1, `matD=${matD}`);
  check('dispose frees texture', texD === 1, `texD=${texD}`);
  check('dispose frees the owned skeleton', skelD === 1, `skelD=${skelD}`);
  avatar.dispose();
  check('repeat dispose does not double-free GPU resources', geoD === 1 && matD === 1 && texD === 1 && skelD === 1);
}

console.log(failures === 0 ? 'PLAY_CAMERA PASS' : `PLAY_CAMERA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
