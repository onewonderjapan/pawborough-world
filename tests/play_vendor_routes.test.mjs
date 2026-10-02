// 摊位派生、路径备选与推车图层契约测试 (M06: Vendor derivation & Cart layer)
// Run: node tests/play_vendor_routes.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { deriveVendors, createVendorLayer } from '../scene-authoring/yuyuan-area/web/play/vendor-layer.js';
import { createFoodRegistry } from '../scene-authoring/yuyuan-area/web/play/catalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AREA = resolve(root, 'scene-authoring/yuyuan-area');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

// 载入真实场景输入
const layout = JSON.parse(await readFile(resolve(AREA, 'out-zone/layout.json'), 'utf8'));
const sockets = JSON.parse(await readFile(resolve(AREA, 'out-zone/food-sockets.json'), 'utf8'));
const catalogJson = JSON.parse(await readFile(resolve(AREA, 'inputs/food-catalog.json'), 'utf8'));
const assetsJson = JSON.parse(await readFile(resolve(AREA, 'inputs/play-foods.json'), 'utf8'));
const vendorsJson = JSON.parse(await readFile(resolve(AREA, 'inputs/play-vendors.json'), 'utf8'));
const profilesJson = JSON.parse(await readFile(resolve(AREA, 'inputs/food-pose-profiles.json'), 'utf8'));
// Fixed legacy fixture for candidate-choice negative cases. The full current
// edition is checked separately with real physics/controller routes.
const legacyIds=new Set(['xiaolongbao','congyoubing','youdunzi']);
catalogJson.foods=catalogJson.foods.filter(f=>legacyIds.has(f.id));catalogJson.requiredFoodIds=[...legacyIds];
vendorsJson.vendors=vendorsJson.vendors.filter(v=>legacyIds.has(v.foodId));

const registry = createFoodRegistry({
  catalog: catalogJson,
  assets: assetsJson,
  vendors: vendorsJson,
  profiles: profilesJson,
});

// 基础模拟世界探针
function createMockWorld({
  supportY = 1.0,
  blockedSet = new Set(),
  supportMap = new Map(),
  los = true,
} = {}) {
  return {
    supportAt(x, z) {
      const key = `${Math.round(x * 100) / 100},${Math.round(z * 100) / 100}`;
      if (supportMap.has(key)) return supportMap.get(key);
      return supportY;
    },
    isBlocked(x, y, z) {
      const key = `${Math.round(x * 100) / 100},${Math.round(z * 100) / 100}`;
      return blockedSet.has(key);
    },
    hasLineOfSight(from, to) {
      if (typeof los === 'function') return los(from, to);
      return Boolean(los);
    },
  };
}

// ==========================================
// 1. 固定摊位 (existing stalls) 候选距离与可达性测试
// ==========================================
{
  const world = createMockWorld({ supportY: 0.95 });
  const runtimeVendors = deriveVendors({ registry, layout, sockets, world });

  check('初版 3 处固定摊位成功派生', runtimeVendors.length === 3);
  check('三处固定摊位全部 enabled', runtimeVendors.every(v => v.enabled === true));
  check('displayAnchor 是 tray 的别名', runtimeVendors.every(v => v.displayAnchor === v.tray));
  check('tray 具备世界坐标与 rotY', runtimeVendors.every(v => v.tray && Number.isFinite(v.tray.x) && Number.isFinite(v.tray.y)));
  check('groundY 记录地面高程', runtimeVendors.every(v => v.groundY === 0.95));

  // 首选 2.0m 被挡，回退到 2.6m 备选
  const stall5FirstCandidate = runtimeVendors[0].candidates[0];
  const blockedKey = `${Math.round(stall5FirstCandidate.x * 100) / 100},${Math.round(stall5FirstCandidate.z * 100) / 100}`;
  const fallbackWorld = createMockWorld({
    supportY: 0.95,
    blockedSet: new Set([blockedKey]),
  });
  const fallbackVendors = deriveVendors({ registry, layout, sockets, world: fallbackWorld });
  const v5Fallback = fallbackVendors.find(v => v.stallId === 'stall-5');
  check('首选 2.0m 被挡时选择 2.6m 备选', v5Fallback?.chosen === 1);
  check('记录备选原因', /改用 2\.6m 备选/.test(v5Fallback?.reason ?? ''));

  // 全备选点阻挡：全部候选失败 -> enabled: false, customerPoint 为 null (never fallback usable coord)
  const allBlockedWorld = {
    supportAt: () => 0.95,
    isBlocked: () => true, // 全部阻挡
    hasLineOfSight: () => false,
  };
  const allBlockedVendors = deriveVendors({ registry, layout, sockets, world: allBlockedWorld });
  check('候选点全败时 enabled=false (allfailedvendorsdisabled)', allBlockedVendors.every(v => v.enabled === false));
  check('候选点全败时清空顾客点 (neverfallbackusable coord)', allBlockedVendors.every(v => v.customerPoint === null));
  check('候选点全败时记录 readable reason', allBlockedVendors.every(v => /全部备选点未通过/.test(v.reason)));

  // 缺失 layout 或 stall 时优雅降级为 disabled，不崩溃
  const brokenVendors = deriveVendors({ registry, layout: { objects: [] }, sockets, world });
  check('缺失 stall 对象时摊位 disabled 而非抛出异常崩溃', brokenVendors.every(v => v.enabled === false && v.customerPoint === null));
}

// ==========================================
// 2. 推车摊位 (Cart kind) 派生与几何规则测试
// ==========================================
{
  const cartFood = { id: 'tanghulu', name: '冰糖葫芦', chapterId: 'shanghai', assetId: 'food-tanghulu', poseProfile: 'skewer' };
  const customRegistry = {
    foodsById: new Map([['tanghulu', cartFood]]),
    vendorsById: new Map([
      ['cart-1', {
        vendorId: 'cart-1',
        foodId: 'tanghulu',
        kind: 'cart',
        position: [10, 20],
        rotationY: Math.PI / 2,
        customerPoint: [10, 21.5], // 离车身 center 1.5m
        enabled: true,
      }],
      ['cart-inside-box', {
        vendorId: 'cart-inside-box',
        foodId: 'tanghulu',
        kind: 'cart',
        position: [30, 40],
        rotationY: 0,
        customerPoint: [30.2, 40.1], // 顾客点在车身盒子内 (halfExtents: [.475, .4, .325])
        enabled: true,
      }],
      ['cart-unlevel', {
        vendorId: 'cart-unlevel',
        foodId: 'tanghulu',
        kind: 'cart',
        position: [50, 60],
        rotationY: 0,
        customerPoint: [50, 62],
        enabled: true,
      }],
    ]),
  };

  // 配置模拟探针：cart-unlevel 的某一角高差达到 0.5m (>0.2m)
  const cartWorld = createMockWorld({
    supportY: 2.0,
    supportMap: new Map([
      // cart-unlevel: center=2.0, corner [50.6, 60.4] = 2.5m (高差 0.5m)
      ['50.6,60.4', 2.5],
    ]),
  });

  const cartTargets = deriveVendors({ registry: customRegistry, layout, sockets, world: cartWorld });
  const validCart = cartTargets.find(v => v.vendorId === 'cart-1');
  const insideBoxCart = cartTargets.find(v => v.vendorId === 'cart-inside-box');
  const unlevelCart = cartTargets.find(v => v.vendorId === 'cart-unlevel');

  check('合规推车成功激活 (enabled: true)', validCart?.enabled === true);
  check('推车 tray center 在 cart ground + 0.8m', Math.abs(validCart.tray.y - (2.0 + 0.8)) < 1e-6);
  check('推车 displayAnchor 等同 tray', validCart.displayAnchor === validCart.tray);
  check('推车 counter 位置正确', validCart.counter.x === 10 && validCart.counter.z === 20);
  check('推车 rotY 正确传递', validCart.rotY === Math.PI / 2);

  // 顾客点在车身盒子内时检测失败并清空顾客点 (cart clearcustomerpoint)
  check('顾客点在车体内部时推车被禁用', insideBoxCart?.enabled === false);
  check('顾客点在车体内部时 clear customerPoint', insideBoxCart?.customerPoint === null);
  check('记录内部碰撞原因', /inside cart box/.test(insideBoxCart?.reason ?? ''));

  // 底盘四角不平 (>0.2m) 时禁用推车
  check('底盘四角不平时推车被禁用', unlevelCart?.enabled === false);
  check('底盘不平时 clear customerPoint', unlevelCart?.customerPoint === null);
  check('记录底盘不平原因', /not level within 0.2m/.test(unlevelCart?.reason ?? ''));
}

// ==========================================
// 3. 一味多摊与数组解耦 (food -> vendor many & no index coupling)
// ==========================================
{
  const customRegistry = {
    foodsById: new Map([
      ['xiaolongbao', { id: 'xiaolongbao', enabled: true }],
    ]),
    vendorsById: new Map([
      ['vendor-a', { vendorId: 'vendor-a', foodId: 'xiaolongbao', kind: 'cart', position: [0, 0], customerPoint: [0, 1.5], enabled: true }],
      ['vendor-b', { vendorId: 'vendor-b', foodId: 'xiaolongbao', kind: 'cart', position: [10, 10], customerPoint: [10, 11.5], enabled: true }],
    ]),
  };
  const world = createMockWorld();
  const res = deriveVendors({ registry: customRegistry, layout, sockets, world });
  check('支持同一小吃对应多个推车/摊位', res.length === 2 && res[0].foodId === 'xiaolongbao' && res[1].foodId === 'xiaolongbao');
  check('各 vendorId 独立且无数组索引耦合', res[0].vendorId === 'vendor-a' && res[1].vendorId === 'vendor-b');
}

// ==========================================
// 4. createVendorLayer 契约、一致性与幂等释放测试
// ==========================================
{
  const fakeScene = new THREE.Scene();
  const unrelatedMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  fakeScene.add(unrelatedMesh);

  const registeredColliders = [];
  const removedColliders = [];

  const addBoxCollider = (desc) => {
    const handle = { id: `collider-${desc.vendorId}`, ...desc };
    registeredColliders.push(handle);
    return handle;
  };
  const removeCollider = (handle) => {
    removedColliders.push(handle);
  };

  const runtimeVendors = [
    // 包含一个现有固定摊位 (existing)
    {
      vendorId: 'existing-stall-1',
      kind: 'existing',
      foodId: 'xiaolongbao',
      counter: { x: 5, z: 5 },
      groundY: 1.0,
      enabled: true,
    },
    // 包含一个启用推车 (cart)
    {
      vendorId: 'cart-valid',
      kind: 'cart',
      foodId: 'tanghulu',
      counter: { x: 12, z: 18 },
      groundY: 0.5,
      rotY: 1.57,
      enabled: true,
    },
    // 包含一个禁用推车 (cart disabled)
    {
      vendorId: 'cart-disabled',
      kind: 'cart',
      foodId: 'tanghulu',
      counter: { x: 20, z: 30 },
      groundY: 0.5,
      rotY: 0,
      enabled: false,
    },
  ];

  const layer = createVendorLayer({
    scene: fakeScene,
    vendors: runtimeVendors,
    addBoxCollider,
    removeCollider,
  });

  // 现有固定摊位无额外 mesh / collider
  check('现有摊位不创建额外 Mesh 与碰撞体', !layer.roots.has('existing-stall-1'));
  check('禁用推车不创建 Mesh 与碰撞体', !layer.roots.has('cart-disabled'));

  // 启用推车创建 Mesh Root 并加入 Scene
  const cartRoot = layer.roots.get('cart-valid');
  check('启用推车创建 Mesh Root', Boolean(cartRoot));
  check('Scene 包含推车 Root', fakeScene.children.includes(cartRoot));

  // 世界坐标、yaw 与碰撞体描述符一致性验证 (worldposition/yaw/collideragreement)
  check('推车 Root 位置与 counter/groundY 一致',
    cartRoot.position.x === 12 && cartRoot.position.y === 0.5 && cartRoot.position.z === 18);
  check('推车 Root yaw 与 rotY 一致', cartRoot.rotation.y === 1.57);

  check('仅注册了一个推车碰撞盒', registeredColliders.length === 1 && layer.collisionBoxes.length === 1);
  const col = registeredColliders[0];
  check('碰撞盒 vendorId 吻合', col.vendorId === 'cart-valid');
  check('碰撞盒中心在 [x, gy + 0.4, z]',
    col.center[0] === 12 && col.center[1] === 0.5 + 0.4 && col.center[2] === 18);
  check('碰撞盒 halfExtents 为 [.475, .4, .325]',
    col.halfExtents[0] === 0.475 && col.halfExtents[1] === 0.4 && col.halfExtents[2] === 0.325);
  check('碰撞盒 yaw 与推车 rotY 一致', col.yaw === 1.57);

  // 幂等释放测试 (dispose idempotent & twice preserves unrelatedworld)
  layer.dispose();
  check('第一次 dispose 移除推车 Root', !fakeScene.children.includes(cartRoot));
  check('第一次 dispose 调用 removeCollider', removedColliders.length === 1);
  check('释放后 roots Map 已清空', layer.roots.size === 0);
  check('释放保留了场景无关对象 (unrelatedworld)', fakeScene.children.includes(unrelatedMesh));

  // 第二次 dispose
  layer.dispose();
  check('第二次 dispose 不重复调用 removeCollider (idempotent)', removedColliders.length === 1);
  check('第二次 dispose 依然保留场景无关对象', fakeScene.children.includes(unrelatedMesh));
}

console.log(failures === 0 ? 'PLAY_VENDOR_ROUTES PASS' : `PLAY_VENDOR_ROUTES FAIL (${failures})`);
if (failures > 0) process.exit(1);
