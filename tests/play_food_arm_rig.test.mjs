import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { PlayAvatar } from '../scene-authoring/yuyuan-area/web/play/avatar.js';
import { planRideSkinFix } from '../scene-authoring/yuyuan-area/web/play/rider-fit.js';
import { cupPalmVertices, smoothPlushShoulders } from '../scene-authoring/yuyuan-area/web/play/plush-skin.js';
import { planFoodArmRig } from '../scene-authoring/yuyuan-area/web/play/food-arm-rig.js';

// Setup Node texture stubs
const A = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scene-authoring/yuyuan-area');
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });

const { GLTFLoader } = await import(A + '/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const bytes = await fs.readFile(A + '/resources/characters/gray-cat/character.glb');
const g = await new Promise((ok, no) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, no));

const avatar = new PlayAvatar({ gltfScene: g.scene, animations: g.animations });
const body = g.scene.getObjectByName('cat_body');
const mouth = g.scene.getObjectByName('cat_mouth');
const eyeL = g.scene.getObjectByName('cat_eyeL');
const eyeR = g.scene.getObjectByName('cat_eyeR');
const nose = g.scene.getObjectByName('cat_nose');

assert.ok(body, 'cat_body exists');
assert.ok(mouth, 'cat_mouth exists');
assert.ok(eyeL, 'cat_eyeL exists');
assert.ok(eyeR, 'cat_eyeR exists');
assert.ok(nose, 'cat_nose exists');

const old12Skeleton = body.skeleton;
const originalBodyGeo = body.geometry;

// Apply planRideSkinFix, freeze cupPalmVertices IDs, smoothPlushShoulders
const fix = planRideSkinFix(body);
const preparedBaseGeo = fix.apply();
const palmVertexIds = {
  armL: cupPalmVertices(body, 'armL'),
  armR: cupPalmVertices(body, 'armR'),
};
assert.ok(palmVertexIds.armL.length > 5, 'armL palm vertices captured');
assert.ok(palmVertexIds.armR.length > 5, 'armR palm vertices captured');
smoothPlushShoulders(body, preparedBaseGeo);

// Track disposal of original geometry, skeleton, and textures
let originalGeoDisposed = 0;
let originalTextureDisposed = 0;
preparedBaseGeo.addEventListener('dispose', () => { originalGeoDisposed++; });
if (body.material) {
  const mats = Array.isArray(body.material) ? body.material : [body.material];
  for (const m of mats) {
    if (m.map) m.map.addEventListener('dispose', () => { originalTextureDisposed++; });
  }
}

// 1. Plan arm rig on prepared body
const handle = planFoodArmRig(body, { palmVertexIds, elbowFraction: 0.55, wristFraction: 0.93 });
assert.ok(handle, 'handle created');
assert.ok(handle.geometry, 'derived geometry exists');
assert.ok(handle.skeleton, 'derived skeleton exists');
assert.ok(handle.bonesBySide?.armL?.shoulder, 'armL shoulder exists');
assert.ok(handle.bonesBySide?.armL?.forearm, 'armL forearm exists');
assert.ok(handle.bonesBySide?.armL?.wrist, 'armL wrist exists');
assert.ok(handle.bonesBySide?.armR?.shoulder, 'armR shoulder exists');
assert.ok(handle.bonesBySide?.armR?.forearm, 'armR forearm exists');
assert.ok(handle.bonesBySide?.armR?.wrist, 'armR wrist exists');

// Verify stats
assert.equal(handle.stats.version, 'runtimeOnly');
assert.equal(handle.stats.oldJointCount, 12);
assert.equal(handle.stats.newJointCount, 16);
assert.ok(handle.stats.affectedVertexCount > 0, 'affected vertices > 0');
assert.ok(handle.stats.smoothVertexCount > 0, 'smooth vertices > 0');
assert.ok(handle.stats.hardVertexCount > 0, 'hard vertices > 0');
assert.equal(handle.stats.affectedVertexCount, handle.stats.smoothVertexCount + handle.stats.hardVertexCount);

// Verify derived geometry attributes
const basePos = preparedBaseGeo.attributes.position;
const derivedPos = handle.geometry.attributes.position;
assert.equal(derivedPos.count, basePos.count);
// Positions, normals, UVs untouched
for (let i = 0; i < basePos.count; i++) {
  assert.equal(derivedPos.getX(i), basePos.getX(i));
  assert.equal(derivedPos.getY(i), basePos.getY(i));
  assert.equal(derivedPos.getZ(i), basePos.getZ(i));
}
if (preparedBaseGeo.attributes.normal) {
  assert.deepEqual(handle.geometry.attributes.normal.array, preparedBaseGeo.attributes.normal.array);
}
if (preparedBaseGeo.attributes.uv) {
  assert.deepEqual(handle.geometry.attributes.uv.array, preparedBaseGeo.attributes.uv.array);
}

// Verify skin weights: sum within 1e-6 and indices < 16
const dIdx = handle.geometry.attributes.skinIndex;
const dW = handle.geometry.attributes.skinWeight;
const bIdx = preparedBaseGeo.attributes.skinIndex;
const bW = preparedBaseGeo.attributes.skinWeight;

let maskTested = 0;
for (let i = 0; i < basePos.count; i++) {
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const idx = dIdx.getComponent(i, k);
    const w = dW.getComponent(i, k);
    assert.ok(idx >= 0 && idx < 16, `bone index ${idx} in [0, 15]`);
    assert.ok(w >= -1e-6, `weight ${w} >= 0`);
    sum += w;
  }
  assert.ok(Math.abs(1 - sum) < 1e-6, `vertex ${i} weight sum ${sum} approx 1`);

  const x = basePos.getX(i), y = basePos.getY(i), z = basePos.getZ(i);
  const inRegion = (Math.abs(x) > 0.145 && Math.abs(x) < 0.37 && y > 0.10 && y < 0.505 && z > -0.09);
  const targetArm = x >= 0 ? 6 : 7;
  let hasTargetArm = false;
  for (let k = 0; k < 4; k++) {
    if (bIdx.getComponent(i, k) === targetArm && bW.getComponent(i, k) > 1e-9) hasTargetArm = true;
  }
  if (!inRegion || !hasTargetArm) {
    maskTested++;
    for (let k = 0; k < 4; k++) {
      assert.equal(dIdx.getComponent(i, k), bIdx.getComponent(i, k), `protected vertex ${i} slot ${k} index unchanged`);
      assert.equal(dW.getComponent(i, k), bW.getComponent(i, k), `protected vertex ${i} slot ${k} weight unchanged`);
    }
  }
}
assert.ok(maskTested > 1000, `protected regions exact (${maskTested} vertices tested)`);

// Verify skeleton preservation
assert.equal(handle.skeleton.bones.length, 16);
for (let i = 0; i < 12; i++) {
  assert.equal(handle.skeleton.bones[i], old12Skeleton.bones[i], `bone ${i} object reference preserved`);
  assert.deepEqual(handle.skeleton.boneInverses[i].elements, old12Skeleton.boneInverses[i].elements, `boneInverse ${i} preserved`);
}
assert.equal(handle.skeleton.bones[12].name, 'armL_forearm');
assert.equal(handle.skeleton.bones[13].name, 'armL_wrist');
assert.equal(handle.skeleton.bones[14].name, 'armR_forearm');
assert.equal(handle.skeleton.bones[15].name, 'armR_wrist');

// 2. Test activate / deactivate
assert.equal(body.geometry, preparedBaseGeo);
assert.equal(body.skeleton, old12Skeleton);
assert.ok(handle.activate(), 'activate succeeded');
assert.equal(body.geometry, handle.geometry, 'body switched to derived geometry');
assert.equal(body.skeleton, handle.skeleton, 'body switched to derived skeleton');
assert.equal(mouth.skeleton, old12Skeleton, 'mouth skeleton remains original');
assert.equal(eyeL.skeleton, old12Skeleton, 'cat_eyeL skeleton remains original');
assert.equal(eyeR.skeleton, old12Skeleton, 'cat_eyeR skeleton remains original');
assert.equal(nose.skeleton, old12Skeleton, 'cat_nose skeleton remains original');

// Repeated activate
assert.ok(handle.activate(), 'repeated activate supported');

// Test Rest Equivalence across all body vertices in neutral + animations
const checkRestEquivalence = (label) => {
  avatar.root.updateMatrixWorld(true);
  old12Skeleton.update();
  handle.skeleton.update();

  const vOrig = new T.Vector3();
  const vDerived = new T.Vector3();

  // Test across all body vertices
  for (let i = 0; i < basePos.count; i++) {
    // Original skinning
    vOrig.fromBufferAttribute(preparedBaseGeo.attributes.position, i).applyMatrix4(body.bindMatrix);
    const origDeformed = new T.Vector3(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const bi = bIdx.getComponent(i, k);
      const w = bW.getComponent(i, k);
      if (w > 0) {
        const mat = old12Skeleton.bones[bi].matrixWorld.clone().multiply(old12Skeleton.boneInverses[bi]);
        origDeformed.addScaledVector(vOrig.clone().applyMatrix4(mat), w);
      }
    }
    origDeformed.applyMatrix4(body.bindMatrixInverse);

    // Derived skinning
    vDerived.fromBufferAttribute(handle.geometry.attributes.position, i).applyMatrix4(body.bindMatrix);
    const derivedDeformed = new T.Vector3(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const bi = dIdx.getComponent(i, k);
      const w = dW.getComponent(i, k);
      if (w > 0) {
        const mat = handle.skeleton.bones[bi].matrixWorld.clone().multiply(handle.skeleton.boneInverses[bi]);
        derivedDeformed.addScaledVector(vDerived.clone().applyMatrix4(mat), w);
      }
    }
    derivedDeformed.applyMatrix4(body.bindMatrixInverse);

    const dist = origDeformed.distanceTo(derivedDeformed);
    assert.ok(dist < 1e-4, `${label} vertex ${i} rest equivalence (dist=${dist})`);
  }
};

// Neutral pose
checkRestEquivalence('neutral');

// Idle animation phase
avatar.actions.idle.setEffectiveWeight(1).play();
avatar.mixer.update(0.4);
checkRestEquivalence('idle phase');

// Walk animation phase
avatar.actions.idle.setEffectiveWeight(0);
avatar.actions.walk.setEffectiveWeight(1).play();
avatar.mixer.update(0.6);
checkRestEquivalence('walk phase');

// Eat animation phase
avatar.actions.walk.setEffectiveWeight(0);
avatar.actions.eat.setEffectiveWeight(1).play();
avatar.mixer.update(0.8);
checkRestEquivalence('eat phase');

// Nonzero translation and yaw
avatar.root.position.set(3, 0.5, -2);
avatar.root.rotation.y = 1.1;
checkRestEquivalence('translated & yawed');

// 3. Test real joint bending produces movement at frozen paw samples
const getPawCenter = (ids) => {
  avatar.root.updateMatrixWorld(true);
  handle.skeleton.update();
  const c = new T.Vector3(), v = new T.Vector3();
  for (const i of ids) {
    body.getVertexPosition(i, v);
    c.add(v.applyMatrix4(body.matrixWorld));
  }
  return c.divideScalar(ids.length);
};

const pawRest = getPawCenter(palmVertexIds.armL);
// Rotate forearm joint
handle.bonesBySide.armL.forearm.rotateX(0.7);
handle.bonesBySide.armL.forearm.rotateZ(0.4);
avatar.root.updateMatrixWorld(true);
handle.skeleton.update();
const pawBent = getPawCenter(palmVertexIds.armL);
const bentDist = pawRest.distanceTo(pawBent);
assert.ok(bentDist > 0.015, `real joint bending produces movement: dist=${bentDist}`);

// Test resetJoints restores rest
handle.resetJoints();
avatar.root.updateMatrixWorld(true);
handle.skeleton.update();
const pawRestored = getPawCenter(palmVertexIds.armL);
assert.ok(pawRest.distanceTo(pawRestored) < 1e-4, 'resetJoints restores rest paw position');

// 4. Repeated swaps
assert.ok(handle.deactivate(), 'deactivate succeeded');
assert.equal(body.geometry, preparedBaseGeo, 'restored base geometry');
assert.equal(body.skeleton, old12Skeleton, 'restored base skeleton');
assert.equal(handle.bonesBySide.armL.forearm.parent, null, 'armL forearm detached');
assert.equal(handle.bonesBySide.armR.forearm.parent, null, 'armR forearm detached');
assert.ok(handle.deactivate(), 'repeated deactivate supported');

assert.ok(handle.activate(), 're-activate succeeded');
assert.equal(body.geometry, handle.geometry);
assert.equal(body.skeleton, handle.skeleton);
assert.equal(handle.bonesBySide.armL.forearm.parent, handle.bonesBySide.armL.shoulder);

// 5. Atomic ownership refusal
// Simulate foreign takeover while active: single field (geometry)
const foreignGeo = new T.BufferGeometry();
const foreignSkeleton = new T.Skeleton([]);
body.geometry = foreignGeo;
assert.equal(handle.deactivate(), false, 'deactivate refuses foreign geometry takeover');
assert.equal(handle.dispose(), false, 'dispose refuses foreign geometry takeover without clobber');
body.geometry = handle.geometry;

// Simulate foreign takeover while active: single field (skeleton)
body.skeleton = foreignSkeleton;
assert.equal(handle.deactivate(), false, 'deactivate refuses foreign skeleton takeover');
assert.equal(handle.dispose(), false, 'dispose refuses foreign skeleton takeover without clobber');
body.skeleton = handle.skeleton;

// Simulate foreign takeover while active: BOTH geometry and skeleton
body.geometry = foreignGeo;
body.skeleton = foreignSkeleton;
assert.equal(handle.deactivate(), false, 'deactivate refuses foreign takeover of both geometry and skeleton');
assert.equal(handle.dispose(), false, 'dispose refuses foreign takeover of both geometry and skeleton');
assert.equal(handle.bonesBySide.armL.forearm.parent, handle.bonesBySide.armL.shoulder, 'forearm L preserved on arm');
assert.equal(handle.bonesBySide.armR.forearm.parent, handle.bonesBySide.armR.shoulder, 'forearm R preserved on arm');
assert.equal(body.geometry, foreignGeo, 'external geometry untouched');
assert.equal(body.skeleton, foreignSkeleton, 'external skeleton untouched');
// Restore owned pair
body.geometry = handle.geometry;
body.skeleton = handle.skeleton;

// Deactivate and simulate foreign takeover while inactive
assert.ok(handle.deactivate(), 'deactivate restored');
body.skeleton = foreignSkeleton;
assert.equal(handle.activate(), false, 'activate refuses foreign skeleton takeover');
body.skeleton = old12Skeleton;

// 6. Test creation while current original bones are animated
avatar.actions.eat.setEffectiveWeight(1).play();
avatar.mixer.update(1.2);
avatar.root.position.set(5, 1, 4);
avatar.root.rotation.y = 2.0;
avatar.root.updateMatrixWorld(true);

const handleAnimated = planFoodArmRig(body, { palmVertexIds });
assert.deepEqual(
  handleAnimated.bonesBySide.armL.forearm.position.toArray(),
  handle.bonesBySide.armL.forearm.position.toArray(),
  'forearm position independent of current animated pose'
);
assert.deepEqual(
  handleAnimated.skeleton.boneInverses[12].elements,
  handle.skeleton.boneInverses[12].elements,
  'forearm boneInverse independent of current animated pose'
);
assert.deepEqual(
  handleAnimated.skeleton.boneInverses[13].elements,
  handle.skeleton.boneInverses[13].elements,
  'wrist boneInverse independent of current animated pose'
);

// 7. Test disposal
let derivedGeoDisposed = 0;
handle.geometry.addEventListener('dispose', () => { derivedGeoDisposed++; });
assert.ok(handle.activate());
assert.ok(handle.dispose(), 'dispose succeeded');
assert.equal(derivedGeoDisposed, 1, 'derived geometry disposed once');
assert.equal(originalGeoDisposed, 0, 'original geometry never disposed');
assert.equal(originalTextureDisposed, 0, 'original textures never disposed');
assert.equal(body.geometry, preparedBaseGeo, 'dispose deactivated back to base geometry');
assert.equal(body.skeleton, old12Skeleton, 'dispose deactivated back to base skeleton');
assert.equal(mouth.skeleton, old12Skeleton, 'mouth skeleton intact');
assert.equal(eyeL.skeleton, old12Skeleton, 'cat_eyeL skeleton intact');
assert.equal(eyeR.skeleton, old12Skeleton, 'cat_eyeR skeleton intact');
assert.equal(nose.skeleton, old12Skeleton, 'cat_nose skeleton intact');
assert.equal(handle.bonesBySide.armL.forearm.parent, null, 'forearm L detached after dispose');
assert.equal(handle.bonesBySide.armR.forearm.parent, null, 'forearm R detached after dispose');

// Test Failure 1: activate()->dispose()->activate()
// Repeat dispose safe
assert.ok(handle.dispose(), 'repeat dispose safe and returns true');
assert.equal(derivedGeoDisposed, 1, 'derived geometry not disposed again');

// activate must reject after successful dispose
assert.equal(handle.activate(), false, 'activate must reject after successful dispose');
assert.equal(body.geometry, preparedBaseGeo, 'body geometry untouched after rejected activate');
assert.equal(body.skeleton, old12Skeleton, 'body skeleton untouched after rejected activate');
assert.equal(handle.bonesBySide.armL.forearm.parent, null, 'forearm L remains detached after rejected activate');
assert.equal(handle.bonesBySide.armR.forearm.parent, null, 'forearm R remains detached after rejected activate');

// 8. Lifecycle 2: Active takeover, refusal, caller restoration then dispose, and inactive disposal
const handle2 = planFoodArmRig(body, { palmVertexIds });
let handle2GeoDisposed = 0;
handle2.geometry.addEventListener('dispose', () => { handle2GeoDisposed++; });

assert.ok(handle2.activate(), 'handle2 activated');
assert.equal(body.geometry, handle2.geometry);
assert.equal(body.skeleton, handle2.skeleton);
assert.equal(handle2.bonesBySide.armL.forearm.parent, handle2.bonesBySide.armL.shoulder);
assert.equal(handle2.bonesBySide.armR.forearm.parent, handle2.bonesBySide.armR.shoulder);

// External takeover of BOTH fields while active
body.geometry = foreignGeo;
body.skeleton = foreignSkeleton;
assert.equal(handle2.dispose(), false, 'dispose returns false during foreign takeover of both fields');
assert.equal(handle2GeoDisposed, 0, 'owned resources preserved, not disposed');
assert.equal(handle2.bonesBySide.armL.forearm.parent, handle2.bonesBySide.armL.shoulder, 'forearm L still preserved on arm');
assert.equal(handle2.bonesBySide.armR.forearm.parent, handle2.bonesBySide.armR.shoulder, 'forearm R still preserved on arm');

// Caller later restores the owned pair
body.geometry = handle2.geometry;
body.skeleton = handle2.skeleton;

// Successful dispose restores captured base pair, detaches both chains, releases owned resources once
assert.ok(handle2.dispose(), 'dispose succeeds after caller restores owned pair');
assert.equal(body.geometry, preparedBaseGeo, 'captured base geometry restored');
assert.equal(body.skeleton, old12Skeleton, 'captured base skeleton restored');
assert.equal(handle2.bonesBySide.armL.forearm.parent, null, 'armL forearm detached');
assert.equal(handle2.bonesBySide.armR.forearm.parent, null, 'armR forearm detached');
assert.equal(handle2GeoDisposed, 1, 'derived geometry disposed once');

// Repeat dispose safe
assert.ok(handle2.dispose(), 'repeat dispose safe');
assert.equal(handle2GeoDisposed, 1, 'not disposed multiple times');
assert.equal(handle2.activate(), false, 'activate rejects after dispose');

// Test inactive handle disposal without touching foreign mesh fields
const handle3 = planFoodArmRig(body, { palmVertexIds });
let handle3GeoDisposed = 0;
handle3.geometry.addEventListener('dispose', () => { handle3GeoDisposed++; });
// Mesh currently belongs to someone else
body.geometry = foreignGeo;
body.skeleton = foreignSkeleton;
assert.ok(handle3.dispose(), 'inactive handle disposes safely');
assert.equal(handle3GeoDisposed, 1, 'inactive handle disposed its own resources');
assert.equal(body.geometry, foreignGeo, 'foreign mesh geometry untouched');
assert.equal(body.skeleton, foreignSkeleton, 'foreign mesh skeleton untouched');
assert.equal(handle3.bonesBySide.armL.forearm.parent, null, 'forearm L was never attached');
assert.equal(handle3.bonesBySide.armR.forearm.parent, null, 'forearm R was never attached');
assert.equal(handle3.activate(), false, 'activate rejects after dispose on inactive handle');

// Restore body to base
body.geometry = preparedBaseGeo;
body.skeleton = old12Skeleton;

console.log('ALL PLAY_FOOD_ARM_RIG TESTS PASSED');
