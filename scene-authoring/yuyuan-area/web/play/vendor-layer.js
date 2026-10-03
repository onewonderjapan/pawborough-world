// 摊位派生与推车图层 (M06: Reachable vendors / Cart layer)
// 适配固定商业摊位 (existing) 与独立流浪小吃车 (cart)
import * as THREE from 'three';
import { deriveStallTargets } from './stalls.js';
import {
  attachVendorDressing,
  createVendorDressing,
  getVendorDressingTemplate,
  hasVendorDressing,
  VENDOR_DRESSING_TEMPLATES,
} from './vendor-dressing.js';

export {
  attachVendorDressing,
  createVendorDressing,
  getVendorDressingTemplate,
  hasVendorDressing,
  VENDOR_DRESSING_TEMPLATES,
};

function isWorldBlocked(world, x, y, z) {
  if (!world || typeof world.isBlocked !== 'function') return false;
  if (world.isBlocked.length === 2) {
    return Boolean(world.isBlocked(x, z));
  }
  return Boolean(world.isBlocked(x, y, z));
}

/**
 * 运行时派生所有有效摊位目标并执行物理探针可达性检测
 * 
 * @param {Object} options
 * @param {Object} options.registry 注册表 { foodsById, vendorsById }
 * @param {Object} [options.layout] 场景 layout.json
 * @param {Object} [options.sockets] food-sockets.json
 * @param {Object} options.world 物理探针 { supportAt, isBlocked, hasLineOfSight }
 * @returns {Array} 派生后的运行时摊位列表
 */
export function deriveVendors({ registry, layout, sockets, world } = {}) {
  if (!registry || !registry.vendorsById) return [];

  const vendorList = registry.vendorsById instanceof Map
    ? Array.from(registry.vendorsById.values())
    : Object.values(registry.vendorsById);

  const out = [];

  for (const vendor of vendorList) {
    if (!vendor || typeof vendor !== 'object') continue;

    const vendorId = vendor.vendorId ?? vendor.id;
    const foodId = vendor.foodId;
    const food = registry.foodsById instanceof Map
      ? registry.foodsById.get(foodId)
      : registry.foodsById?.[foodId];

    const kind = vendor.kind ?? (vendor.stallId ? 'existing' : 'cart');

    if (kind === 'existing') {
      // 1. 固定摊位：基于既有 layout 与 food-sockets 派生
      let stallTarget = null;
      try {
        const foodParam = {
          ...food,
          id: foodId,
          stallId: vendor.stallId,
          stallLabelZh: vendor.labelZh ?? food?.stallLabelZh,
        };
        const targets = deriveStallTargets(layout, sockets, [foodParam]);
        stallTarget = targets[0];
      } catch (err) {
        // layout / stall / tray 缺失时禁用该摊位，不引起整个目录崩溃
        out.push({
          ...vendor,
          vendorId,
          foodId,
          kind: 'existing',
          enabled: false,
          reason: `existing stall derivation failed: ${err.message}`,
          customerPoint: null,
          groundY: null,
          tray: null,
          displayAnchor: null,
        });
        continue;
      }

      // 测试候选点 [2.0m, 2.6m, 1.5m, 3.0m] 站立性与胶囊阻挡
      let chosenCandidate = null;
      let chosenIndex = -1;
      let targetGroundY = null;

      if (stallTarget && Array.isArray(stallTarget.candidates)) {
        for (let i = 0; i < stallTarget.candidates.length; i++) {
          const c = stallTarget.candidates[i];
          const gy = world?.supportAt?.(c.x, c.z);
          const supported = gy !== null && gy !== undefined && Number.isFinite(gy);
          const blocked = supported && isWorldBlocked(world, c.x, gy + 0.48, c.z);
          if (supported && !blocked) {
            chosenCandidate = c;
            chosenIndex = i;
            targetGroundY = gy;
            break;
          }
        }
      }

      if (chosenCandidate !== null) {
        const isEnabled = vendor.enabled !== false && (food?.enabled !== false);
        const reason = !isEnabled
          ? 'vendor or food disabled'
          : (chosenIndex > 0 ? `建议 2.0m 点不可站立，沿路侧改用 ${chosenCandidate.m}m 备选` : null);

        const runtimeTarget = {
          ...vendor,
          ...stallTarget,
          vendorId,
          foodId,
          kind: 'existing',
          chosen: chosenIndex,
          customerPoint: { x: chosenCandidate.x, z: chosenCandidate.z },
          groundY: targetGroundY,
          displayAnchor: stallTarget.tray,
          enabled: isEnabled,
          reason,
        };
        out.push(runtimeTarget);
      } else {
        // 全败：enabled=false，保留可读原因，绝不回退不可用坐标
        out.push({
          ...vendor,
          ...stallTarget,
          vendorId,
          foodId,
          kind: 'existing',
          chosen: -1,
          customerPoint: null,
          groundY: null,
          displayAnchor: stallTarget.tray,
          enabled: false,
          reason: '全部备选点未通过地面/碰撞检查',
        });
      }
    } else {
      // 2. 推车摊位 (cart)
      const pos = vendor.position;
      const cp = vendor.customerPoint;

      const cx = Array.isArray(pos) ? pos[0] : pos?.x;
      const cz = Array.isArray(pos) ? pos[1] : pos?.z;
      const rotY = vendor.rotationY ?? vendor.rotY ?? 0;

      const cpx = Array.isArray(cp) ? cp[0] : cp?.x;
      const cpz = Array.isArray(cp) ? (cp.length === 2 ? cp[1] : cp[2]) : cp?.z;

      if (!Number.isFinite(cx) || !Number.isFinite(cz) || !Number.isFinite(cpx) || !Number.isFinite(cpz)) {
        out.push({
          ...vendor,
          vendorId,
          foodId,
          kind: 'cart',
          counter: Number.isFinite(cx) && Number.isFinite(cz) ? { x: cx, z: cz } : null,
          faceDir: null,
          tray: null,
          rotY,
          groundY: null,
          customerPoint: null,
          displayAnchor: null,
          enabled: false,
          reason: 'missing mandatory position or customerPoint',
        });
        continue;
      }

      // 底盘四角与中心地面高程可靠性与平整性判定 (±0.6, ±0.4, 差值 <= 0.2m)
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      const cornerOffsets = [
        [0.6, 0.4],
        [0.6, -0.4],
        [-0.6, 0.4],
        [-0.6, -0.4],
      ];

      const centerGy = world?.supportAt?.(cx, cz);
      let cornersValid = centerGy !== null && centerGy !== undefined && Number.isFinite(centerGy);
      const heights = cornersValid ? [centerGy] : [];

      for (const [dx, dz] of cornerOffsets) {
        const wx = cx + dx * cos - dz * sin;
        const wz = cz + dx * sin + dz * cos;
        const gy = world?.supportAt?.(wx, wz);
        if (gy === null || gy === undefined || !Number.isFinite(gy)) {
          cornersValid = false;
          break;
        }
        heights.push(gy);
      }

      if (cornersValid) {
        const minH = Math.min(...heights);
        const maxH = Math.max(...heights);
        if (maxH - minH > 0.2) {
          cornersValid = false;
        }
      }

      const cartGround = centerGy ?? heights[0] ?? 0;

      // 顾客点地面与阻挡判定
      let custValid = true;
      let custGy = null;
      if (cornersValid) {
        custGy = world?.supportAt?.(cpx, cpz);
        if (custGy === null || custGy === undefined || !Number.isFinite(custGy)) {
          custValid = false;
        } else if (Math.abs(custGy - cartGround) > 2.0) {
          custValid = false;
        }
      }

      // 顾客点不得在推车车身盒体内 (halfExtents: [0.475, 0.4, 0.325])
      const relX = cpx - cx;
      const relZ = cpz - cz;
      const localX = relX * cos + relZ * sin;
      const localZ = -relX * sin + relZ * cos;
      const insideCartBox = Math.abs(localX) <= 0.475 && Math.abs(localZ) <= 0.325;

      // 顾客点无墙面重叠阻挡
      const wallOverlap = custValid && isWorldBlocked(world, cpx, (custGy ?? cartGround) + 0.48, cpz);

      // 视线通畅
      const losBlocked = (cornersValid && custValid) &&
        (typeof world?.hasLineOfSight === 'function' &&
         !world.hasLineOfSight([cx, cartGround + 0.8, cz], [cpx, (custGy ?? cartGround) + 0.8, cpz]));

      let enabled = true;
      let reason = null;

      if (!cornersValid) {
        enabled = false;
        reason = 'cart footprint corners unsupported or not level within 0.2m';
      } else if (!custValid) {
        enabled = false;
        reason = 'customer point unsupported or height mismatch';
      } else if (insideCartBox) {
        enabled = false;
        reason = 'customer point inside cart box';
      } else if (wallOverlap) {
        enabled = false;
        reason = 'customer point blocked by wall or obstacle';
      } else if (losBlocked) {
        enabled = false;
        reason = 'line of sight between cart and customer point blocked';
      } else if (vendor.enabled === false || (food && food.enabled === false)) {
        enabled = false;
        reason = 'vendor or food disabled';
      }

      const counter = { x: cx, z: cz };
      const fdx = cpx - cx;
      const fdz = cpz - cz;
      const flen = Math.hypot(fdx, fdz) || 1;
      const faceDir = { x: fdx / flen, z: fdz / flen };
      const tray = { x: cx, y: cartGround + 0.8, z: cz, rotY };

      out.push({
        ...vendor,
        vendorId,
        foodId,
        kind: 'cart',
        counter,
        faceDir,
        tray,
        rotY,
        groundY: cornersValid ? cartGround : null,
        customerPoint: enabled ? { x: cpx, z: cpz } : null,
        displayAnchor: tray,
        enabled,
        reason,
      });
    }
  }

  return out;
}

/**
 * 创建推车渲染与碰撞图层 (owned cart layer)
 * 仅对 enabled cart 摊位创建三维实体与世界盒碰撞体；固定摊位不生成额外几何
 * 
 * @param {Object} options
 * @param {Object} [options.scene] Three.js Scene 实例
 * @param {Array} options.vendors deriveVendors 输出的运行时列表
 * @param {Function} [options.addBoxCollider] 添加盒碰撞体回调 ({ vendorId, center, halfExtents, yaw }) => handle
 * @param {Function} [options.removeCollider] 移除碰撞体回调 (handle) => void
 * @returns {Object} { roots: Map, collisionBoxes: Array, dispose: Function }
 */
export function createVendorLayer({
  scene,
  vendors = [],
  addBoxCollider,
  removeCollider,
} = {}) {
  const ownedGeometries = [];
  const ownedMaterials = [];

  function trackGeom(g) { ownedGeometries.push(g); return g; }
  function trackMat(m) { ownedMaterials.push(m); return m; }

  // 共享优雅材质：奶油/翡翠车身、微铜边饰、织物顶棚、深木车轮
  const bodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xedf1e8, roughness: 0.5 })); // cream jade
  const trimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.3, metalness: 0.8 })); // copper trim
  const wheelMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.7 })); // legs / wheels
  const canopyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x4e7b68, roughness: 0.7 })); // jade green canopy
  const poleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x9b6b43, metalness: 0.6 })); // brass poles

  // 共享几何体 (单位: 米)
  // 圆角柜台: .95 × .65 × .65m，中心位于 ground + .4m
  const counterGeom = trackGeom(new THREE.BoxGeometry(0.95, 0.65, 0.65));
  const trimGeom = trackGeom(new THREE.BoxGeometry(0.97, 0.04, 0.67));
  const wheelGeom = trackGeom(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12));
  const canopyGeom = trackGeom(new THREE.ConeGeometry(0.72, 0.28, 4));
  const poleGeom = trackGeom(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 8));

  const roots = new Map();
  const dressings = new Map();
  const collisionBoxes = [];
  const colliderHandles = [];

  const cartVendors = (vendors || []).filter(
    v => v.kind === 'cart' && v.enabled !== false && v.enabled === true
  );

  for (const v of cartVendors) {
    const root = new THREE.Group();
    root.name = `cart-${v.vendorId}`;

    const cx = v.counter.x;
    const cz = v.counter.z;
    const gy = v.groundY ?? 0;
    const rotY = v.rotY ?? 0;

    root.position.set(cx, gy, cz);
    root.rotation.y = rotY;

    // 1. 柜台本体：高度 .65m，中心位于地面 + .4m
    const counterMesh = new THREE.Mesh(counterGeom, bodyMat);
    counterMesh.position.set(0, 0.4, 0);
    root.add(counterMesh);

    // 柜台顶部微铜收边
    const trimMesh = new THREE.Mesh(trimGeom, trimMat);
    trimMesh.position.set(0, 0.72, 0);
    root.add(trimMesh);

    // 2. 四处脚轮 / 短腿
    const legOffsets = [
      [0.35, 0.25],
      [0.35, -0.25],
      [-0.35, 0.25],
      [-0.35, -0.25],
    ];
    for (const [lx, lz] of legOffsets) {
      const wheelMesh = new THREE.Mesh(wheelGeom, wheelMat);
      wheelMesh.rotation.z = Math.PI / 2;
      wheelMesh.position.set(lx, 0.08, lz);
      root.add(wheelMesh);
    }

    // 3. 支柱四根
    const poleOffsets = [
      [0.42, 0.28],
      [0.42, -0.28],
      [-0.42, 0.28],
      [-0.42, -0.28],
    ];
    for (const [px, pz] of poleOffsets) {
      const pole = new THREE.Mesh(poleGeom, poleMat);
      pole.position.set(px, 1.15, pz);
      root.add(pole);
    }

    // 4. 遮阳顶棚：高度 1.65m
    const canopyMesh = new THREE.Mesh(canopyGeom, canopyMat);
    canopyMesh.position.set(0, 1.65, 0);
    canopyMesh.rotation.y = Math.PI / 4;
    root.add(canopyMesh);

    // 5. 摊位专用台面道具修饰 (U06 typed stall dressing)
    const dressing = attachVendorDressing(root, v, { trackGeom, trackMat });
    if (dressing) {
      dressings.set(v.vendorId, dressing);
    }

    if (scene && typeof scene.add === 'function') {
      scene.add(root);
    }
    roots.set(v.vendorId, root);

    // 6. 碰撞盒描述符与注册
    // center: [cx, gy + .4, cz], halfExtents: [.475, .4, .325], yaw: rotY
    const colliderDesc = {
      vendorId: v.vendorId,
      center: [cx, gy + 0.4, cz],
      halfExtents: [0.475, 0.4, 0.325],
      yaw: rotY,
    };
    collisionBoxes.push(colliderDesc);

    if (typeof addBoxCollider === 'function') {
      const handle = addBoxCollider(colliderDesc);
      colliderHandles.push(handle);
    }
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;

    // 释放修饰道具
    for (const d of dressings.values()) {
      d.dispose();
    }
    dressings.clear();

    // 幂等移除推车 Mesh
    for (const root of roots.values()) {
      if (scene && typeof scene.remove === 'function') {
        scene.remove(root);
      }
    }
    roots.clear();

    // 移除碰撞体
    if (typeof removeCollider === 'function') {
      for (const h of colliderHandles) {
        removeCollider(h);
      }
    }
    colliderHandles.length = 0;

    // 释放自身拥有的几何与材质资源（只释放一次）
    for (const g of ownedGeometries) {
      g.dispose();
    }
    for (const m of ownedMaterials) {
      m.dispose();
    }
    ownedGeometries.length = 0;
    ownedMaterials.length = 0;
  }

  return {
    roots,
    dressings,
    collisionBoxes,
    update(dt = 0, { paused = false } = {}) {
      for (const d of dressings.values()) {
        d.update(dt, { paused });
      }
    },
    dispose,
  };
}
