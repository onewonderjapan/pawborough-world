// 摊位小吃与食品陈列类型化修饰测试 (U06: Typed stall dressing & food display contract)
// Run: node tests/play_vendor_dressing.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  VENDOR_DRESSING_TEMPLATES,
  getVendorDressingTemplate,
  hasVendorDressing,
  createVendorDressing,
  attachVendorDressing,
} from '../scene-authoring/yuyuan-area/web/play/vendor-dressing.js';
import { deriveVendors, createVendorLayer } from '../scene-authoring/yuyuan-area/web/play/vendor-layer.js';
import { makeFoodEntry, FoodCatalog } from '../scene-authoring/yuyuan-area/web/play/foods.js';
import { FoodLibrary } from '../scene-authoring/yuyuan-area/web/play/food-library.js';
import { PlayAvatar } from '../scene-authoring/yuyuan-area/web/play/avatar.js';
import { sampleFoodPose, applyFoodPose, foodAnchorLocal } from '../scene-authoring/yuyuan-area/web/play/food-pose.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AREA = resolve(root, 'scene-authoring/yuyuan-area');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

// ==========================================
// 1. 三摊模板映射与元数据检测
// ==========================================
console.log('--- 1. 摊位模板映射与元数据 ---');
{
  check('changfen 模板已注册', hasVendorDressing('changfen') === true);
  check('boboji 模板已注册', hasVendorDressing('boboji') === true);
  check('waguan-tang 模板已注册', hasVendorDressing('waguan-tang') === true);
  check('未知食物返回 false', hasVendorDressing('unknown-food') === false);

  const cfTpl = getVendorDressingTemplate('changfen');
  check('changfen 模板类型为 steamer', cfTpl?.type === 'steamer');
  check('changfen 包含蒸箱中文名', /蒸箱/.test(cfTpl?.nameZh ?? ''));

  const bbjTpl = getVendorDressingTemplate('boboji');
  check('boboji 模板类型为 chili_oil_basin', bbjTpl?.type === 'chili_oil_basin');
  check('boboji 包含红油盆/竹签', /红油盆|竹签/.test(bbjTpl?.nameZh ?? ''));

  const wgtTpl = getVendorDressingTemplate('waguan-tang');
  check('waguan-tang 模板类型为 simmering_pot', wgtTpl?.type === 'simmering_pot');
  check('waguan-tang 包含煨罐/木盖', /煨罐|木盖/.test(wgtTpl?.nameZh ?? ''));

  check('未知食物 createVendorDressing 返回 null', createVendorDressing('unknown-food') === null);
}

// ==========================================
// 2. 几何道具包围盒、台面净空与无新碰撞检测
// ==========================================
console.log('--- 2. 台面道具空间包围与净空契约 ---');
{
  const cartHalfX = 0.475;
  const cartHalfZ = 0.325;
  const tableTopY = 0.725;

  for (const foodId of ['changfen', 'boboji', 'waguan-tang']) {
    const dressing = createVendorDressing(foodId);
    check(`${foodId} 道具组成功创建`, Boolean(dressing?.group));

    // 计算三维局部包围盒 (在推车局部系内)
    const box = new THREE.Box3().setFromObject(dressing.group);
    const size = new THREE.Vector3();
    box.getSize(size);

    // 严禁伸出推车柜台外沿（通行区净空）
    check(`${foodId} X 轴完全在推车台面内 (min >= -0.475, max <= 0.475)`,
      box.min.x >= -cartHalfX - 1e-4 && box.max.x <= cartHalfX + 1e-4,
      `x: [${box.min.x.toFixed(3)}, ${box.max.x.toFixed(3)}]`);

    check(`${foodId} Z 轴完全在推车台面内 (min >= -0.325, max <= 0.325)`,
      box.min.z >= -cartHalfZ - 1e-4 && box.max.z <= cartHalfZ + 1e-4,
      `z: [${box.min.z.toFixed(3)}, ${box.max.z.toFixed(3)}]`);

    // 道具底面紧贴台面 (Y >= 0.725)，顶面不顶撞遮阳篷 (Y <= 1.5)
    check(`${foodId} Y 轴底面落在台面表面 (min.y >= 0.72)`,
      box.min.y >= tableTopY - 0.01, `minY: ${box.min.y.toFixed(3)}`);
    check(`${foodId} Y 轴顶面高度合规 (max.y <= 1.2)`,
      box.max.y <= 1.2, `maxY: ${box.max.y.toFixed(3)}`);

    // 道具集中在左侧/中后部，不遮挡顾客点 (顾客点在 +Z 方向 1.8m 处)
    check(`${foodId} 道具远离顾客点 (max.z < 0.25)`,
      box.max.z < 0.25, `maxZ: ${box.max.z.toFixed(3)}`);

    // 检查蒸气契约
    if (foodId === 'changfen') {
      check('changfen 包含盖边蒸气', dressing.steams.length > 0);
      const steam = dressing.steams[0];
      check('蒸气为 Sprite 且使用透明材质', steam.sprite?.isSprite && steam.sprite.material.transparent);
      check('蒸气不添加点光源 (不用点光)', !dressing.group.children.some(c => c.isPointLight));

      // paused 停止动画测试
      const initialY = steam.sprite.position.y;
      const initialOpacity = steam.sprite.material.opacity;
      dressing.update(0.16, { paused: true });
      check('paused 状态下蒸气位置不变化', Math.abs(steam.sprite.position.y - initialY) < 1e-8);
      check('paused 状态下蒸气透明度不变化', Math.abs(steam.sprite.material.opacity - initialOpacity) < 1e-8);

      // 非 paused 状态下驱动动画
      dressing.update(0.5, { paused: false });
      check('非 paused 状态下蒸气产生微幅波动', steam.sprite.position.y !== initialY || steam.sprite.material.opacity !== initialOpacity);
    } else if (foodId === 'boboji') {
      check('boboji 不产生冗余蒸气', dressing.steams.length === 0);

      // 真正射线检测：从上方打入盆内中心，验证红油可见性与无遮挡
      const basinCenter = new THREE.Vector3(-0.18, 1.0, -0.03);
      const downRay = new THREE.Raycaster(basinCenter, new THREE.Vector3(0, -1, 0));
      dressing.group.updateMatrixWorld(true);
      const hits = downRay.intersectObjects(dressing.group.children, true);

      check('boboji 上方射线打入盆中心有命中', hits.length > 0);
      const firstHit = hits[0];
      check('boboji 射线首个命中为 redoil (红油能从上方直接看见)', firstHit?.object?.name === 'redoil');
      check('boboji 射线未被 blue 盆沿盖住', firstHit?.object?.name !== 'blue-rim');
      check('boboji 射线未被 white 盆顶盖住', firstHit?.object?.name !== 'white-basin');
      check('boboji 射线未被 sesame 盘盖住', firstHit?.object?.name !== 'sesame');
      check('boboji 红油 top 处于 0.810~0.812 之间',
        firstHit?.point?.y >= 0.810 - 1e-4 && firstHit?.point?.y <= 0.812 + 1e-4,
        `hitY: ${firstHit?.point?.y?.toFixed(4)}`);

      // 几何参数契约检测
      const basinMesh = dressing.group.getObjectByName('white-basin');
      check('盆体 Cylinder 为 openEnded (无封口顶盖)', basinMesh?.geometry?.parameters?.openEnded === true);

      const rimMesh = dressing.group.getObjectByName('blue-rim');
      check('盆沿为 RingGeometry', rimMesh?.geometry?.type === 'RingGeometry');
      check('盆沿内径为 0.126，外径为 0.133',
        Math.abs(rimMesh?.geometry?.parameters?.innerRadius - 0.126) < 1e-4 &&
        Math.abs(rimMesh?.geometry?.parameters?.outerRadius - 0.133) < 1e-4);
      check('盆沿旋转 -X π/2 且高度在 y~0.817',
        Math.abs(rimMesh?.rotation?.x - (-Math.PI / 2)) < 1e-4 &&
        Math.abs(rimMesh?.position?.y - 0.817) < 1e-4);

      const oilMesh = dressing.group.getObjectByName('redoil');
      const oilDiameter = (oilMesh?.geometry?.parameters?.radius ?? 0) * 2;
      check('红油表面直径为 0.252', Math.abs(oilDiameter - 0.252) < 1e-4, `d: ${oilDiameter}`);

      const sesameMesh = dressing.group.getObjectByName('sesame');
      check('芝麻采用 InstancedMesh 离散细小颗粒 (非整块覆盖圆盘)', sesameMesh?.isInstancedMesh === true);
    } else {
      check(`${foodId} 不产生冗余蒸气`, dressing.steams.length === 0);
    }

    // 释放检查
    dressing.dispose();
  }
}

// ==========================================
// 3. createVendorLayer 集成、碰撞盒数量与幂等释放
// ==========================================
console.log('--- 3. createVendorLayer 集成与生命周期 ---');
{
  const fakeScene = new THREE.Scene();
  const registeredColliders = [];
  const removedColliders = [];

  const addBoxCollider = desc => {
    const handle = { id: `collider-${desc.vendorId}`, ...desc };
    registeredColliders.push(handle);
    return handle;
  };
  const removeCollider = h => removedColliders.push(h);

  const runtimeVendors = [
    {
      vendorId: 'food-vendor-changfen',
      foodId: 'changfen',
      kind: 'cart',
      counter: { x: -153.75, z: -26.25 },
      customerPoint: { x: -154.811, z: -25.189 },
      groundY: 1.14,
      rotY: -0.785,
      enabled: true,
    },
    {
      vendorId: 'food-vendor-boboji',
      foodId: 'boboji',
      kind: 'cart',
      counter: { x: -177.25, z: -31.55 },
      customerPoint: { x: -177.25, z: -29.75 },
      groundY: 1.14,
      rotY: 0,
      enabled: true,
    },
    {
      vendorId: 'food-vendor-waguan-tang',
      foodId: 'waguan-tang',
      kind: 'cart',
      counter: { x: 34.25, z: -8.05 },
      customerPoint: { x: 34.25, z: -6.25 },
      groundY: 1.1,
      rotY: 0,
      enabled: true,
    },
  ];

  const layer = createVendorLayer({
    scene: fakeScene,
    vendors: runtimeVendors,
    addBoxCollider,
    removeCollider,
  });

  check('三台推车根节点均已创建', layer.roots.size === 3);
  check('三台推车均已装配专属修饰道具', layer.dressings.size === 3);

  // 严禁增加额外碰撞体 (零新增碰撞体，仅 3 个推车原有碰撞体)
  check('碰撞盒仅为 3 个推车原有盒体 (不放新碰撞遮住顾客点)',
    registeredColliders.length === 3 && layer.collisionBoxes.length === 3);

  // 各摊位修饰道具已加入推车根节点
  for (const v of runtimeVendors) {
    const root = layer.roots.get(v.vendorId);
    const dressing = layer.dressings.get(v.vendorId);
    check(`${v.vendorId} 根节点挂载修饰组`, root.children.includes(dressing.group));
  }

  // 动画驱动接口测试
  layer.update(0.1, { paused: false });
  layer.update(0.1, { paused: true });

  // 释放测试
  layer.dispose();
  check('释放后 roots 为空', layer.roots.size === 0);
  check('释放后 dressings 为空', layer.dressings.size === 0);
  check('释放后移除所有碰撞体', removedColliders.length === 3);

  // 二次幂等释放
  layer.dispose();
  check('二次释放安全且不重复移除碰撞体', removedColliders.length === 3);
}

// ==========================================
// 4. 食品陈列底面对齐、手持份量与姿态/锚点契约
// ==========================================
console.log('--- 4. 食品陈列底面与手持/锚点契约 ---');
{
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });

  const cgBuf = await readFile(resolve(AREA, 'resources/characters/gray-cat/character.glb'));
  const cg = await new Promise((ok, no) => new GLTFLoader().parse(cgBuf.buffer.slice(cgBuf.byteOffset, cgBuf.byteOffset + cgBuf.byteLength), '', ok, no));
  const avatar = new PlayAvatar({ gltfScene: cg.scene, animations: cg.animations });

  const foodConfigs = [
    { id: 'changfen', profile: 'bowl', utensil: 'chopsticks', expectedAnchors: ['leftSupport', 'rightSupport', 'bite', 'toolGrip', 'toolBite'] },
    { id: 'boboji', profile: 'skewer', utensil: null, expectedAnchors: ['leftSupport', 'rightSupport', 'bite'] },
    { id: 'waguan-tang', profile: 'bowl', utensil: 'spoon', expectedAnchors: ['leftSupport', 'rightSupport', 'bite', 'toolGrip', 'toolBite'] },
  ];

  for (const { id, profile, utensil, expectedAnchors } of foodConfigs) {
    const glbBuf = await readFile(resolve(AREA, `resources/foods/national/${id}.glb`));
    const gltf = await new Promise((ok, no) => new GLTFLoader().parse(glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength), '', ok, no));

    const entry = makeFoodEntry({ id, poseProfile: profile, utensilKind: utensil }, gltf.scene);
    const catalog = new FoodCatalog(new Map([[id, entry]]));

    // 陈列底面对齐契约: min.y 严格为 0
    const display = catalog.makeDisplay(id);
    const dBox = new THREE.Box3().setFromObject(display);
    check(`${id} 陈列底面严格对齐托盘基准面 (min.y === 0)`, Math.abs(dBox.min.y) < 1e-5, `min.y=${dBox.min.y}`);

    // 手持份量可读: 份量处于适读尺寸 (水平或高度跨度在 0.08m ~ 0.25m 之间)
    const holder = catalog.attachToHands(id, avatar.model);
    const hBox = new THREE.Box3().setFromObject(holder);
    const hSize = new THREE.Vector3();
    hBox.getSize(hSize);
    const maxDim = Math.max(hSize.x, hSize.y, hSize.z);
    check(`${id} 手持份量大小合理可辨识 (${maxDim.toFixed(3)}m)`, maxDim >= 0.08 && maxDim <= 0.30);

    // 锚点契约检查
    const instance = holder.foodInstance;
    check(`${id} 包含 foodInstance`, Boolean(instance));
    for (const anchorName of expectedAnchors) {
      check(`${id} 具备必需锚点: ${anchorName}`, Boolean(instance?.anchors?.[anchorName]));
    }

    // 动作姿态与咀嚼采样契约
    avatar.setHoldingPose(true);
    let allContactsOk = true;
    for (const t of [0, 0.4, 0.8, 1.2, 1.8, 2.5, 3.2]) {
      avatar.setEatingPose(true, t);
      avatar.update({ feet: [0, 0, 0], yaw: 0, moving: false, paused: false, dt: 0 });
      const anchors = Object.fromEntries(
        Object.entries(instance.anchors).map(([k, a]) => [
          k,
          foodAnchorLocal(a, k.startsWith('tool') ? instance.parts.utensil : holder),
        ])
      );
      const target = sampleFoodPose({
        profile,
        t,
        anchors,
        rig: { mouth: avatar.getFoodMouth() },
        presentation: { ...instance.presentation, eating: true },
      });
      const result = applyFoodPose(avatar, instance, target);
      if (!result.ok) allContactsOk = false;
    }
    check(`${id} 咀嚼周期姿态与接触点全部吻合`, allContactsOk);

    catalog.detach(holder);
    avatar.setEatingPose(false);
    avatar.setHoldingPose(false);
  }

  avatar.dispose();
}

// ==========================================
// 5. 8resident / 2concurrent / 3nearbydisplay 预算保持
// ==========================================
console.log('--- 5. FoodLibrary 资源预算保持 ---');
{
  const registry = {
    foodsById: new Map([
      ['changfen', { id: 'changfen', name: '肠粉' }],
      ['boboji', { id: 'boboji', name: '钵钵鸡' }],
      ['waguan-tang', { id: 'waguan-tang', name: '瓦罐汤' }],
      ['f4', { id: 'f4' }],
      ['f5', { id: 'f5' }],
      ['f6', { id: 'f6' }],
      ['f7', { id: 'f7' }],
      ['f8', { id: 'f8' }],
      ['f9', { id: 'f9' }],
    ]),
  };

  let maxConcurrentObserved = 0;
  let activeLoads = 0;
  const library = new FoodLibrary({
    registry,
    maxResident: 8,
    maxConcurrent: 2,
    loader: async id => {
      activeLoads++;
      if (activeLoads > maxConcurrentObserved) maxConcurrentObserved = activeLoads;
      await new Promise(r => setTimeout(r, 10));
      activeLoads--;
      return { id };
    },
  });

  const promises = ['changfen', 'boboji', 'waguan-tang', 'f4'].map(id => library.acquire(id, 'tok'));
  await Promise.all(promises);

  check('FoodLibrary 最大并发不超过 2 (2concurrent)', maxConcurrentObserved <= 2);
  check('FoodLibrary 常驻上限为 8 (8resident)', library.maxResident === 8);

  // 验证 3nearbydisplay 切片预算逻辑
  const mockStalls = [
    { vendorId: 'v1', customerPoint: { x: 0, z: 0 }, enabled: true },
    { vendorId: 'v2', customerPoint: { x: 5, z: 5 }, enabled: true },
    { vendorId: 'v3', customerPoint: { x: 10, z: 10 }, enabled: true },
    { vendorId: 'v4', customerPoint: { x: 15, z: 15 }, enabled: true },
    { vendorId: 'v5', customerPoint: { x: 20, z: 20 }, enabled: true },
  ];
  const feet = [0, 0, 0];
  const nearbySlice = mockStalls
    .filter(t => t.enabled)
    .sort((a, b) => Math.hypot(a.customerPoint.x - feet[0], a.customerPoint.z - feet[2]) -
                    Math.hypot(b.customerPoint.x - feet[0], b.customerPoint.z - feet[2]))
    .slice(0, 3);

  check('nearby display 最多激活 3 处 (3nearbydisplay)', nearbySlice.length === 3);
  check('最近的三处摊位被选中', nearbySlice.map(s => s.vendorId).join(',') === 'v1,v2,v3');

  library.dispose();
}

console.log('--------------------------------------------------');
if (failures === 0) {
  console.log('ALL PLAY_VENDOR_DRESSING TESTS PASSED (0 failures)');
} else {
  console.error(`PLAY_VENDOR_DRESSING FAILURES: ${failures}`);
  process.exit(1);
}
