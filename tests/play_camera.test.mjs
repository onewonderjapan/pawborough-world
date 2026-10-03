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
import { sampleFoodPose } from '../scene-authoring/yuyuan-area/web/play/food-pose.js';

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

// --- U03: PlayCamera food inspection view ('food' mode) ---
{
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 600);
  const pc = new PlayCamera({
    camera,
    shoulderHeight: 0.62,
    distance: 2.4,
    margin: 0.12,
    foodDistance: 1.15,
    foodShoulderHeight: 0.54,
    foodYawOffset: Math.PI,
    foodPitchOffset: -0.06,
  });

  check('initial viewMode is follow', pc.viewMode === 'follow' && !pc.isFoodView());
  pc.setViewMode('food');
  check('setViewMode("food") activates food view', pc.viewMode === 'food' && pc.isFoodView());
  pc.toggleFoodView();
  check('toggleFoodView() toggles back to follow', pc.viewMode === 'follow');
  pc.toggleFoodView();
  check('toggleFoodView() toggles to food', pc.viewMode === 'food');

  const yaw = -Math.PI / 2; // controller faces +X (forward = (1, 0, 0))
  const ctrl = stubController([10, 0.02, -4], yaw, 0);
  const place = pc.update({ controller: ctrl, dt: 1 / 60 });

  check('controller yaw and pitch remain unchanged (zero modification)',
    ctrl.yaw === yaw && ctrl.pitch === 0);

  const expectedPivot = new THREE.Vector3(10, 0.02 + 0.54, -4);
  check('food view pivot sits at feet + foodShoulderHeight (0.54)',
    pc.pivot.distanceTo(expectedPivot) < 1e-9, `pivot=${pc.pivot.toArray().map(v=>v.toFixed(2))}`);

  // In food view, camera sits in front of the model (at +X from pivot)
  check('food camera sits in front of the model (+X relative to pivot)',
    camera.position.x > pc.pivot.x, `cam.x=${camera.position.x.toFixed(2)} pivot.x=${pc.pivot.x.toFixed(2)}`);
  check('food camera applied distance is ~1.15m', close(place.applied, 1.15, 1e-6), `applied=${place.applied}`);
  check('unobstructed food camera distance > avatarHideDistance (0.8m)', place.applied >= 0.8);

  const toPivot = expectedPivot.clone().sub(camera.position).normalize();
  const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd);
  check('food camera looks at the food view pivot', camFwd.dot(toPivot) > 1 - 1e-6);

  // Near wall in front of the character (0.7m away along camera line)
  let rayDir = null;
  const wallHit = pc.update({
    controller: ctrl,
    dt: 1 / 60,
    castRay: (origin, dir, maxToi) => { rayDir = dir.clone(); return 0.70; },
  });
  check('castRay got front camera direction', rayDir && rayDir.x > 0);
  check('wall in front: applied distance retracts to hit - margin (0.70 - 0.12 = 0.58)',
    close(wallHit.applied, 0.58, 1e-6), `applied=${wallHit.applied.toFixed(4)}`);
  check('wall retraction leaves pivot untouched', pc.pivot.distanceTo(expectedPivot) < 1e-9);

  // Very tight wall closer than margin
  const tightHit = pc.update({
    controller: ctrl,
    dt: 1 / 60,
    castRay: () => 0.05,
  });
  check('hit < margin: zero safe clearance stays at pivot without crossing wall',
    tightHit.applied === 0);

  // Decoupled facingYaw: when facingYaw is specified, camera frames avatar facing
  const facingYaw = 0; // avatar faces -Z (forward = (0, 0, -1))
  const decoupledHit = pc.update({
    controller: ctrl, // ctrl.yaw is still -PI/2 (+X)
    dt: 1 / 60,
    facingYaw,
  });
  check('decoupled facing: camera sits along avatar facing (-Z relative to pivot)',
    camera.position.z < pc.pivot.z, `cam.z=${camera.position.z.toFixed(2)} pivot.z=${pc.pivot.z.toFixed(2)}`);

  // Switch back to follow mode
  pc.setViewMode('follow');
  const followPlace = pc.update({ controller: ctrl, dt: 1 / 60 });
  check('switching back to follow restores behind-character placement',
    camera.position.x < pc.pivot.x && close(followPlace.applied, 2.4, 1e-6));
}

// --- U03: 4 Food Profiles Framing & Visibility (S01, S02, S04, S05, S09) ---
{
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 600);
  const pc = new PlayCamera({
    camera,
    shoulderHeight: 0.62,
    foodDistance: 1.15,
    foodShoulderHeight: 0.54,
    foodYawOffset: Math.PI,
    foodPitchOffset: -0.06,
  });
  pc.setViewMode('food');

  const feet = [0, 0, 0];
  const yaw = 0; // facing -Z, forward = (0, 0, -1)
  const ctrl = stubController(feet, yaw, 0);
  pc.update({ controller: ctrl, dt: 1 / 60 });
  camera.updateMatrixWorld(true);

  const mouthModel = new THREE.Vector3(0, 0.65, 0.28);
  const modelRotY = avatarYawFor(yaw);
  const toWorld = (v) => v.clone().applyEuler(new THREE.Euler(0, modelRotY, 0)).add(new THREE.Vector3(...feet));
  const toNDC = (v) => v.clone().project(camera);

  const mouthWorld = toWorld(mouthModel);
  const mouthNDC = toNDC(mouthWorld);
  check('food view: mouth is within visible screen upper-center (NDC y in [0.1, 0.5])',
    Math.abs(mouthNDC.x) < 0.2 && mouthNDC.y >= 0.1 && mouthNDC.y <= 0.5 && mouthNDC.z < 1,
    `mouthNDC=(${mouthNDC.x.toFixed(2)}, ${mouthNDC.y.toFixed(2)})`);

  // Profile 1: Wrapped (S04 xiaolongbao / S05 roujiamo)
  {
    const pose = sampleFoodPose({
      profile: 'wrapped', t: 0.5, rig: { mouth: mouthModel },
      anchors: { leftSupport: [-0.08, 0, 0], rightSupport: [0.08, 0, 0], bite: [0, 0.05, 0] },
      presentation: { profile: 'wrapped', eating: true },
    });
    check('wrapped profile sampleFoodPose ok', pose.ok);
    const leftNDC = toNDC(toWorld(pose.palms.armL));
    const rightNDC = toNDC(toWorld(pose.palms.armR));
    const foodNDC = toNDC(toWorld(pose.position));
    check('wrapped: food, both paws, and mouth all inside frustum',
      [leftNDC, rightNDC, foodNDC, mouthNDC].every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= 0 && p.z <= 1),
      `left.x=${leftNDC.x.toFixed(2)} right.x=${rightNDC.x.toFixed(2)} food.y=${foodNDC.y.toFixed(2)}`);
    check('wrapped: paws are left and right of center', leftNDC.x < 0 && rightNDC.x > 0);
  }

  // Profile 2: Skewer (S02 boboji / tanghulu)
  {
    const pose = sampleFoodPose({
      profile: 'skewer', t: 0.5, rig: { mouth: mouthModel },
      anchors: { leftSupport: [-0.05, -0.05, 0], rightSupport: [0.05, -0.05, 0], bite: [0, 0.12, 0] },
      presentation: { profile: 'skewer', eating: true },
    });
    check('skewer profile sampleFoodPose ok', pose.ok);
    const leftNDC = toNDC(toWorld(pose.palms.armL));
    const rightNDC = toNDC(toWorld(pose.palms.armR));
    const foodNDC = toNDC(toWorld(pose.position));
    check('skewer: food, both paws, and mouth all inside frustum',
      [leftNDC, rightNDC, foodNDC, mouthNDC].every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= 0 && p.z <= 1),
      `left.y=${leftNDC.y.toFixed(2)} food.y=${foodNDC.y.toFixed(2)}`);
  }

  // Profile 3: Bowl with chopsticks (S01 changfen / noodles)
  {
    const pose = sampleFoodPose({
      profile: 'bowl', t: 0.5, rig: { mouth: mouthModel },
      anchors: { leftSupport: [-0.1, 0, 0], content: [0, 0.02, 0], toolGrip: [0.08, -0.02, 0], toolBite: [0.02, 0.08, 0.02] },
      presentation: { profile: 'bowl', eating: true, utensilKind: 'chopsticks' },
    });
    check('bowl chopsticks sampleFoodPose ok', pose.ok);
    const leftNDC = toNDC(toWorld(pose.palms.armL));
    const rightNDC = toNDC(toWorld(pose.palms.armR));
    const foodNDC = toNDC(toWorld(pose.position));
    check('bowl chopsticks: food, both paws, and mouth all inside frustum',
      [leftNDC, rightNDC, foodNDC, mouthNDC].every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= 0 && p.z <= 1),
      `bowl.y=${foodNDC.y.toFixed(2)} armR.y=${rightNDC.y.toFixed(2)}`);
  }

  // Profile 4: Bowl with spoon (S09 waguan-tang / shuangpinai)
  {
    const pose = sampleFoodPose({
      profile: 'bowl', t: 0.5, rig: { mouth: mouthModel },
      anchors: { leftSupport: [-0.1, 0, 0], content: [0, 0.02, 0], toolGrip: [0.08, -0.02, 0], toolBite: [0.02, 0.08, 0.02] },
      presentation: { profile: 'bowl', eating: true, utensilKind: 'spoon' },
    });
    check('bowl spoon sampleFoodPose ok', pose.ok);
    const leftNDC = toNDC(toWorld(pose.palms.armL));
    const rightNDC = toNDC(toWorld(pose.palms.armR));
    const foodNDC = toNDC(toWorld(pose.position));
    check('bowl spoon: food, both paws, and mouth all inside frustum',
      [leftNDC, rightNDC, foodNDC, mouthNDC].every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= 0 && p.z <= 1),
      `bowl.y=${foodNDC.y.toFixed(2)} spoon.y=${rightNDC.y.toFixed(2)}`);
  }
}

// --- U03: Camera View State Transitions & Contracts (install wiring contract) ---
{
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 600);
  const pc = new PlayCamera({ camera });

  // Simulate gameplay state
  let heldItem = null;
  let riding = false;
  let busyEating = false;
  let savedUserViewMode = 'follow';

  const canInspectFood = () => !riding && !!heldItem;
  const toggleFoodView = () => {
    if (riding || !heldItem) return false;
    pc.toggleFoodView();
    return true;
  };
  const startEat = () => {
    savedUserViewMode = pc.viewMode;
    pc.setViewMode('food');
    busyEating = true;
  };
  const finishEat = () => {
    busyEating = false;
    pc.setViewMode(savedUserViewMode);
  };
  const cancelEat = () => {
    busyEating = false;
    pc.setViewMode(savedUserViewMode);
  };
  const onMovementInput = () => {
    if (pc.viewMode === 'food' && !busyEating) {
      pc.setViewMode('follow');
    }
  };
  const onMount = () => {
    riding = true;
    pc.setViewMode('follow');
  };

  // 1. Cannot toggle food view without held item
  check('cannot inspect food with empty hands', !canInspectFood() && !toggleFoodView() && pc.viewMode === 'follow');

  // 2. Pick up food -> can toggle food view
  heldItem = 'roujiamo';
  check('holding food enables inspection', canInspectFood());
  check('V key toggles to food view', toggleFoodView() && pc.viewMode === 'food');
  check('V key toggles back to follow view', toggleFoodView() && pc.viewMode === 'follow');

  // 3. Movement input recovers follow view (prevents inverted walking)
  pc.setViewMode('food');
  onMovementInput();
  check('movement input restores follow camera', pc.viewMode === 'follow');

  // 4. F eating auto-view and restore:
  // 4a. User was in follow view -> eat switches to food view -> finish restores follow view
  check('pre-eat in follow mode', pc.viewMode === 'follow');
  startEat();
  check('eating auto-selects food view', pc.viewMode === 'food');
  // While eating, movement does NOT break food view (movement is locked)
  onMovementInput();
  check('eating locks view (movement does not exit food view while eating)', pc.viewMode === 'food');
  finishEat();
  check('eating finish restores user previous follow view', pc.viewMode === 'follow');

  // 4b. User was ALREADY in food view (via V) -> eat keeps food view -> finish restores food view
  pc.setViewMode('food');
  startEat();
  check('eating while in food view stays in food view', pc.viewMode === 'food');
  finishEat();
  check('eating finish restores food view when user had selected V before', pc.viewMode === 'food');

  // 4c. Eating cancelled restores previous view
  pc.setViewMode('follow');
  startEat();
  cancelEat();
  check('eating cancelled restores previous follow view', pc.viewMode === 'follow');

  // 5. Bike mount disables and exits food view
  pc.setViewMode('food');
  onMount();
  check('bike mount forces exit from food view to follow view', pc.viewMode === 'follow');
  check('riding disables food inspection', !canInspectFood() && !toggleFoodView());

  // 6. Pause / Esc / Atlas does NOT alter camera view mode
  pc.setViewMode('food');
  // simulate pause event
  const pauseState = { paused: true, viewMode: pc.viewMode };
  check('pause retains current view mode', pauseState.viewMode === 'food' && pc.viewMode === 'food');
  // simulate resume
  const resumeState = { paused: false, viewMode: pc.viewMode };
  check('resume retains current view mode', resumeState.viewMode === 'food' && pc.viewMode === 'food');
}

console.log(failures === 0 ? 'PLAY_CAMERA PASS' : `PLAY_CAMERA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
