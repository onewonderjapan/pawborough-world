// Acceptance of the owner's 48-food / 34-region delivery, including real assets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFoodRegistry } from '../scene-authoring/yuyuan-area/web/play/catalog.js';
import { makeFoodEntry, FoodCatalog } from '../scene-authoring/yuyuan-area/web/play/foods.js';

const area = new URL('../scene-authoring/yuyuan-area/', import.meta.url);
const read = async path => JSON.parse(await fs.readFile(new URL(path, area), 'utf8'));
const [catalog, assets, vendors, profiles] = await Promise.all(
  ['food-catalog', 'play-foods', 'play-vendors', 'food-pose-profiles'].map(n => read(`inputs/${n}.json`)));
assert.equal(catalog.foods.filter(f => f.enabled !== false).length, 48, '48 real enabled foods');
const registry = createFoodRegistry({ catalog, assets, vendors, profiles });
assert.equal(registry.requiredFoodIds.size, 48);
assert.equal(registry.regionsById.size, 34);
assert.equal(new Set(catalog.foods.map(f => f.regionId).filter(Boolean)).size, 34, 'every region has actual food');
assert.equal(vendors.vendors.length, 48, '48 distinct buying locations');
for (const food of catalog.foods) {
  // Cross-region dishes stay unassigned rather than invent a province association.
  if (food.regionId != null) assert.ok(registry.regionsById.has(food.regionId), `${food.id}: region exists`);
  assert.equal(registry.vendorsFor(food.id).length, 1, `${food.id}: one unambiguous vendor`);
}

const added = new Set([
  'lvrou-huoshao', 'daoxiaomian', 'naidoufu', 'shenyang-jijia', 'jianbing-cong',
  'yaxue-fensi', 'dingshenggao', 'maodoufu', 'shachamian', 'waguan-tang',
  'luosifen', 'siwawa', 'suanlafen', 'niangpi', 'qinghai-yogurt', 'sanzi',
  'nang', 'zanba', 'shengjianbao', 'tangou', 'ningbo-tangyuan', 'mashu', 'boboji', 'xiajiao',
]);
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
const modelHashes = new Set();
let thumbnailBytes = 0, newModelBytes = 0;
for (const food of catalog.foods) {
  const asset = assets.foods.find(a => a.id === food.assetId);
  const bytes = await fs.readFile(new URL(asset.path, area));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${food.id}: binary glTF, not an LFS pointer`);
  assert.equal(hash, asset.sha256, `${food.id}: actual adopted model SHA`);
  assert.equal(bytes.length, asset.bytes);
  assert.ok(!modelHashes.has(hash), `${food.id}: unique meal, no renamed duplicate model`);
  modelHashes.add(hash);
  const png = await fs.readFile(new URL(asset.thumbnail.path, area));
  assert.equal(crypto.createHash('sha256').update(png).digest('hex'), asset.thumbnail.sha256);
  assert.equal(png.length, asset.thumbnail.bytes);
  thumbnailBytes += png.length;
  if (!added.has(food.id)) continue;
  assert.ok(food.sourceUrls?.some(s => /^https:\/\//.test(s)), `${food.id}: primary food source recorded`);
  assert.ok(bytes.length <= 524288, `${food.id}: model size budget`);
  assert.ok(png.length <= 28672, `${food.id}: incremental thumbnail budget`);
  newModelBytes += bytes.length;
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  const entry = makeFoodEntry(food, gltf.scene);
  const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
  assert.ok([size.x, size.y, size.z].every(Number.isFinite));
  const minimumWidth = food.poseProfile === 'skewer' ? .04 : .12;
  assert.ok(Math.max(size.x, size.z) >= minimumWidth && Math.max(size.x, size.z) <= .26,
    `${food.id}: visible hand-sized serving ${size.toArray()}`);
  if (food.poseProfile === 'skewer') assert.ok(size.y >= .15, 'skewer remains a visible serving');
  assert.ok(size.y <= (food.poseProfile === 'skewer' ? .36 : .31));
  assert.ok(gltf.scene.getObjectByName('edible'), `${food.id}: editable edible geometry`);
  assert.ok(gltf.scene.getObjectByName('socket_grip'), `${food.id}: real grip anchor`);
  const owner = new FoodCatalog(new Map([[food.id, entry]]));
  const display = owner.makeDisplay(food.id);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(display).min.y) < 1e-6,
    `${food.id}: display bottom stays on the counter`);
  const hand = owner.makeHandInstance(food.id);
  if (food.poseProfile !== 'cupped') {
    const meal = hand.foodInstance;
    assert.ok(meal.parts.edible && meal.anchors.leftSupport && meal.anchors.rightSupport && meal.anchors.bite);
    if (food.poseProfile === 'wrapped') assert.ok(meal.parts.wrapper);
    if (food.id === 'shenyang-jijia') assert.ok(meal.parts.container, 'bones retained separately from edible meat');
    if (food.poseProfile === 'skewer') assert.ok(meal.parts.skewer);
    if (food.poseProfile === 'bowl') {
      assert.ok(meal.parts.container && meal.parts.utensil && meal.anchors.toolGrip && meal.anchors.toolBite);
      assert.ok(meal.parts.utensil.getObjectByName('toolFood'));
      assert.ok(['spoon', 'chopsticks'].includes(food.utensilKind));
    }
    const retained = Object.entries(meal.parts).filter(([name]) => name !== 'edible')
      .map(([name, node]) => [name, node.scale.toArray()]);
    meal.setBiteProgress(1);
    for (const [name, scale] of retained) assert.deepEqual(meal.parts[name].scale.toArray(), scale,
      `${food.id}: vessel, wrapping and tools do not shrink when eaten`);
  }
  owner.dispose();
  console.log('PASS coverage meal', food.id, food.poseProfile);
}
assert.ok(thumbnailBytes <= 2 * 1024 * 1024, 'all 48 thumbnails fit existing total budget');
assert.ok(newModelBytes <= 24 * 524288);
console.log('FOOD_COVERAGE_DELIVERY PASS', { foods: 48, regions: 34, vendors: 48, newModelBytes, thumbnailBytes });
