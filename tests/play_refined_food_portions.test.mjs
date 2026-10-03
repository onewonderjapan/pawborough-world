// Acceptance of refined changfen shallowPlate / selected portion interaction.
// Contracts:
// 1. Presentation fields: containerKind:shallowPlate, selectedPortionName:rice-piece-0, portionMode:selected
// 2. Carry mode: toolFood hidden, selected piece on plate visible
// 3. Picking & lift transfer: mid-phase lift triggers transfer, exactly one visible at any time
// 4. Invariance: container, sauce, other food pieces, and edible root remain fixed scale [1,1,1] (no rubber scaling)
// 5. Tool contact & avatar IK: left palm supports plate underneath, right palm solves toolGrip, tip contacts mouth
// 6. Basket UUID transfer: hand -> basket -> hand preserves identical food instance UUID
// 7. Pause & time idempotency: pure functional sampling, zero jump/drift on pause
// 8. Safe fallback: old GLB missing selected portion node falls back cleanly without crashing or scaling static nodes
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayAvatar } from '../scene-authoring/yuyuan-area/web/play/avatar.js';
import { makeFoodEntry, FoodCatalog } from '../scene-authoring/yuyuan-area/web/play/foods.js';
import { sampleFoodPose, applyFoodPose, foodAnchorLocal } from '../scene-authoring/yuyuan-area/web/play/food-pose.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });

const area = new URL('../scene-authoring/yuyuan-area/', import.meta.url);
const loadGlb = async (relPath) => {
  const buf = await readFile(new URL(relPath, area));
  return new Promise((ok, no) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, no));
};

const charGltf = await loadGlb('resources/characters/gray-cat/character.glb');
const avatar = new PlayAvatar({ gltfScene: charGltf.scene, animations: charGltf.animations });

console.log('--- TEST 1: Refined Food Presentation & Creation ---');
const proto = (await loadGlb('resources/foods/refined/changfen-v5.glb')).scene;
const foodDef = {
  id: 'changfen',
  poseProfile: 'bowl',
  utensilKind: 'chopsticks',
  containerKind: 'shallowPlate',
  portionMode: 'selected',
  selectedPortionName: 'rice-piece-0',
  platePitch: 0.04, // slight tilt <= 0.08 rad
};
const entry = makeFoodEntry(foodDef, proto);
assert.equal(entry.presentation.containerKind, 'shallowPlate');
assert.equal(entry.presentation.portionMode, 'selected');
assert.equal(entry.presentation.selectedPortionName, 'rice-piece-0');
assert.equal(entry.presentation.platePitch, 0.04, 'optional plate pitch survives asset entry creation');
assert.equal(entry.proto.getObjectByName('toolFood').visible, false, 'the separate bite is hidden in untouched stall display prototypes');

const catalog = new FoodCatalog(new Map([['changfen', entry]]));
const holder = catalog.attachToHands('changfen', avatar.model);
const instance = holder.foodInstance;
assert.ok(instance, 'foodInstance initialized');
assert.ok(instance.refinedActive, 'refinedActive enabled on foodInstance');
assert.equal(instance.parts.selectedPiece.name, 'rice-piece-0');

console.log('--- TEST 2: Carry Mode (toolFood hidden, plate piece visible) ---');
const toolFood = instance.parts.utensil.getObjectByName('toolFood');
const selectedPiece = instance.parts.selectedPiece;
assert.equal(toolFood.visible, false, 'carry mode: toolFood must be hidden');
assert.equal(selectedPiece.visible, true, 'carry mode: selected portion on plate must be visible');

// Carry mode pose sample
const carryAnchors = Object.fromEntries(
  Object.entries(instance.anchors).map(([k, a]) => [k, foodAnchorLocal(a, k.startsWith('tool') ? instance.parts.utensil : holder)])
);
const carryTarget = sampleFoodPose({
  profile: 'bowl',
  t: 0,
  anchors: carryAnchors,
  rig: { mouth: avatar.getFoodMouth() },
  presentation: { ...instance.presentation, eating: false }
});
assert.ok(carryTarget.ok, 'carry sample ok');
assert.equal(carryTarget.selectedPieceVisible, true);
assert.equal(carryTarget.toolFoodVisible, false);
applyFoodPose(avatar, instance, carryTarget);
assert.equal(toolFood.visible, false, 'applied carry pose: toolFood stays hidden');
assert.equal(selectedPiece.visible, true, 'applied carry pose: selectedPiece stays visible');

console.log('--- TEST 3: Hand -> Basket -> Hand UUID Preservation ---');
const originalUuid = holder.uuid;
catalog.detach(holder);
const basket = new T.Group();
basket.add(holder);
assert.equal(holder.uuid, originalUuid);
catalog.attachToHands('changfen', avatar.model, holder);
assert.equal(holder.uuid, originalUuid, 'holder UUID preserved across basket transfer');
assert.equal(toolFood.visible, false, 'toolFood still hidden after basket return');

console.log('--- TEST 4: Single Ownership & Transfer during Eating Timeline ---');
avatar.setHoldingPose(true);
let transferOccurred = false;

for (const t of [0, 0.2, 0.4, 0.5, 0.8, 1.1, 1.5, 1.8, 2.2, 2.8, 3.2]) {
  avatar.setEatingPose(true, t);
  avatar.update({ feet: [0, 0, 0], yaw: 0, moving: false, paused: false, dt: 0 });

  const anchors = Object.fromEntries(
    Object.entries(instance.anchors).map(([k, a]) => [k, foodAnchorLocal(a, k.startsWith('tool') ? instance.parts.utensil : holder)])
  );
  const target = sampleFoodPose({
    profile: 'bowl',
    t,
    anchors,
    rig: { mouth: avatar.getFoodMouth() },
    presentation: { ...instance.presentation, eating: true }
  });
  assert.ok(target.ok, `sample @ t=${t}`);
  const result = applyFoodPose(avatar, instance, target);
  assert.ok(result.ok, `apply @ t=${t}`);

  // Single ownership check: NEVER both visible
  assert.ok(
    !(selectedPiece.visible && toolFood.visible),
    `t=${t}: selectedPiece and toolFood must NEVER be simultaneously visible`
  );

  if (t < 0.4) {
    // Before mid-lift: piece is still on plate
    assert.equal(selectedPiece.visible, true, `t=${t}: piece on plate visible before first transfer`);
    assert.equal(toolFood.visible, false, `t=${t}: toolFood hidden before mid-lift`);
  } else {
    // Mid-lift reached: transfer triggered
    transferOccurred = true;
    assert.equal(selectedPiece.visible, false, `t=${t}: piece on plate stays removed after first transfer`);
    if (t < 2.5) {
      assert.equal(toolFood.visible, true, `t=${t}: toolFood visible lifting to mouth`);
    } else {
      assert.equal(toolFood.visible, false, `t=${t}: toolFood consumed / hidden at mouth exit`);
    }
  }

  // Contract: Static objects invariant (no rubber scale!)
  assert.deepEqual(instance.parts.container.scale.toArray(), [1, 1, 1], `t=${t}: container scale invariant`);
  assert.deepEqual(instance.parts.sauce.scale.toArray(), [1, 1, 1], `t=${t}: sauce scale invariant`);
  assert.deepEqual(instance.parts.edible.getObjectByName('rice-piece-1').scale.toArray(), [1, 1, 1], `t=${t}: other food pieces invariant`);
  assert.deepEqual(instance.parts.edible.scale.toArray(), [1, 1, 1], `t=${t}: edible group root invariant (no rubber scaling)`);

  // Avatar IK contacts
  assert.ok(result.contacts.armL.gap <= 0.03, `t=${t}: armL gap ${result.contacts.armL.gap} <= 0.03`);
  assert.ok(result.contacts.armR.gap <= 0.03, `t=${t}: armR gap ${result.contacts.armR.gap} <= 0.03`);

  // Contact at mouth during bite phase
  if (t >= 0.8 && t <= 1.8) {
    assert.ok(target.bite.distanceTo(avatar.getFoodMouth()) <= 0.025, `t=${t}: bite contacts mouth`);
  }
}
assert.ok(transferOccurred, 'mid-lift transfer was verified');

console.log('--- TEST 5: Pause and Idempotency ---');
const pauseTime = 0.5;
avatar.setEatingPose(true, pauseTime);
avatar.update({ feet: [0, 0, 0], yaw: 0, moving: false, paused: true, dt: 10 });
const anchorsPause = Object.fromEntries(
  Object.entries(instance.anchors).map(([k, a]) => [k, foodAnchorLocal(a, k.startsWith('tool') ? instance.parts.utensil : holder)])
);
const t1 = sampleFoodPose({ profile: 'bowl', t: pauseTime, anchors: anchorsPause, rig: { mouth: avatar.getFoodMouth() }, presentation: { ...instance.presentation, eating: true } });
const t2 = sampleFoodPose({ profile: 'bowl', t: pauseTime, anchors: anchorsPause, rig: { mouth: avatar.getFoodMouth() }, presentation: { ...instance.presentation, eating: true } });
assert.equal(t1.lift, t2.lift);
assert.equal(t1.selectedPieceVisible, t2.selectedPieceVisible);
assert.equal(t1.toolFoodVisible, t2.toolFoodVisible);
assert.deepEqual(t1.position.toArray(), t2.position.toArray());
assert.deepEqual(t1.rotation.toArray(), t2.rotation.toArray());

console.log('--- TEST 6: Old GLB Missing selectedNodes Safe Fallback ---');
const oldGlb = await loadGlb('resources/foods/national/changfen.glb');
const oldEntry = makeFoodEntry({
  id: 'changfen',
  poseProfile: 'bowl',
  utensilKind: 'chopsticks',
  containerKind: 'shallowPlate',
  portionMode: 'selected',
  selectedPortionName: 'rice-piece-0', // Not in old GLB!
}, oldGlb.scene);

const oldCatalog = new FoodCatalog(new Map([['changfen', oldEntry]]));
const oldHolder = oldCatalog.attachToHands('changfen', avatar.model);
const oldInstance = oldHolder.foodInstance;
assert.ok(oldInstance);
assert.equal(oldInstance.refinedActive, false, 'safe fallback: refinedActive is false when portion node missing');
assert.ok(oldHolder.userData.missingSelectedPortionFallback, 'fallback reported in userData');

// Fallback eating step must succeed without error
const oldAnchors = Object.fromEntries(
  Object.entries(oldInstance.anchors).map(([k, a]) => [k, foodAnchorLocal(a, k.startsWith('tool') ? oldInstance.parts.utensil : oldHolder)])
);
const oldTarget = sampleFoodPose({
  profile: 'bowl',
  t: 0.5,
  anchors: oldAnchors,
  rig: { mouth: avatar.getFoodMouth() },
  presentation: { ...oldInstance.presentation, eating: true }
});
const oldResult = applyFoodPose(avatar, oldInstance, oldTarget);
assert.ok(oldResult.ok, 'old GLB fallback applyFoodPose succeeds');
assert.deepEqual(oldInstance.parts.container.scale.toArray(), [1, 1, 1], 'fallback does NOT scale container');

oldCatalog.dispose();
catalog.dispose();
avatar.dispose();

console.log('ALL REFINED FOOD PORTION TESTS PASSED!');
