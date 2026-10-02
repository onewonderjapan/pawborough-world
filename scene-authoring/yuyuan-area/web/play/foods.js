// 食物目录（小吃工单 20261001）。加载三份真实手持小吃 GLB（resources/foods/
// handheld/，SHA 见 inputs/play-foods.json，恢复方法同角色资产一节）。
//
// 资源生命周期契约（GOAL.md）：每个 GLB 只加载一次，目录是唯一 owner；手持与
// 摊位陈列都从同一原型 clone（共享 geometry/material）。吃完只是把手持实例从
// 骨骼上摘下，绝不 dispose 仍被陈列引用的共享资源；只有整个目录 dispose（页面
// 卸载场景）才释放 GPU 资源。
//
// LOD：识别 _LOD0/1/2 命名，只显示一层（手持与近处陈列用 LOD0，保持资产实际
// 尺寸，不缩放）。socket_grip 对齐掌心（armR 骨骼），socket_rest 供托盘陈列参考。
import * as THREE from 'three';

export async function loadFoodCatalog({ foods, manifest, readJson = null } = {}) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const byId = new Map();
  for (const food of foods) {
    const entry = manifest.foods.find(f => f.id === food.id);
    if (!entry) throw new Error(`foods: manifest missing ${food.id}`);
    const res = await fetch('/' + entry.path);
    if (!res.ok) throw new Error(`/${entry.path} 返回 ${res.status}`);
    const buf = await res.arrayBuffer();
    if (crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (sha !== entry.sha256) throw new Error(`${food.id}: SHA256 校验不符`);
    }
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
    byId.set(food.id, makeFoodEntry(food, gltf.scene));
  }
  return new FoodCatalog(byId);
}

// 单层 LOD：隐藏 _LOD1/_LOD2（近景只留 LOD0），保持真实尺寸
function showSingleLod(root) {
  let shown = 0;
  root.traverse((o) => {
    const m = /_LOD(\d+)$/.exec(o.name || '');
    if (!m) return;
    o.visible = m[1] === '0';
    if (o.visible) shown += 1;
  });
  return shown;
}

function findNode(root, name) {
  let found = null;
  root.traverse((o) => { if (!found && o.name === name) found = o; });
  return found;
}

function makeFoodEntry(food, protoScene) {
  const grip = findNode(protoScene, 'socket_grip');
  const rest = findNode(protoScene, 'socket_rest');
  const lodShown = showSingleLod(protoScene);
  const box = new THREE.Box3().setFromObject(protoScene);
  const size = new THREE.Vector3();
  box.getSize(size);
  // 手持姿态：socket_grip 对齐 armR 掌心（骨骼原点）；按食物 gripYaw 让朝向顺爪
  protoScene.updateMatrixWorld(true);
  const gripPos = grip
    ? protoScene.worldToLocal(grip.getWorldPosition(new THREE.Vector3()))
    : new THREE.Vector3();
  return {
    id: food.id,
    proto: protoScene,
    gripOffset: gripPos.clone(),
    restOffset: rest?.position?.clone() ?? new THREE.Vector3(),
    lodShown, sizeM: [size.x, size.y, size.z],
    // armR is the upper-arm joint. The palm is down the limb, in its local
    // frame; the food grip is aligned separately inside the rotated holder.
    hand: {
      pos: new THREE.Vector3(-0.015, -0.135, 0.04),
      rot: new THREE.Euler(-Math.PI / 2 + 0.35, Math.PI, 0),
    },
  };
}

export class FoodCatalog {
  constructor(byId) {
    this.byId = byId;
    this.disposed = false;
  }
  has(id) { return this.byId.has(id); }
  // One catalog-owned wrapper can move between the palm and the basket.
  makeHandInstance(id) {
    const entry = this.byId.get(id);
    if (!entry) return null;
    const holder = new THREE.Group();
    holder.name = `play-held-${id}`;
    holder.userData.sharedPlayFood = true;
    holder.userData.playFoodId = id;
    const inst = entry.proto.clone();
    inst.name = `${id}-held`;
    inst.position.sub(entry.gripOffset);
    holder.add(inst);
    return holder;
  }
  // 手持实例：挂到指定骨骼（armR），随动画运动。gripLocal 是真实爪掌前表面
  // （armR 骨空间，由 PlayAvatar.ensureSnackSkin 从改绑后的真实爪皮肤簇标定）；
  // 不传时回退 legacy 固定偏移（假人骨架/测试路径）。
  attachToHand(id, bone, reusable = null, gripLocal = null) {
    const entry = this.byId.get(id);
    if (!entry || !bone?.isBone) return null;
    const holder = reusable?.userData?.playFoodId === id
      ? reusable : this.makeHandInstance(id);
    holder.position.copy(gripLocal ?? entry.hand.pos);
    holder.rotation.copy(entry.hand.rot);
    holder.scale.setScalar(1);        // 真实尺寸
    bone.add(holder);
    return holder;
  }
  // 陈列实例：摆在摊位托盘上（世界坐标由调用方给——来自 food-sockets tray）
  makeDisplay(id) {
    const entry = this.byId.get(id);
    if (!entry) return null;
    const inst = entry.proto.clone();
    inst.name = `${id}-display`;
    return inst;
  }
  // 吃完摘下：只移除实例对象，不 dispose 共享 geometry/material（陈列还在引用）
  detach(handGroup) {
    handGroup?.removeFromParent();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];
    for (const entry of this.byId.values()) {
      entry.proto.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry) geometries.add(o.geometry);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          materials.add(m);
          for (const k of TEX_KEYS) if (m[k]?.isTexture) textures.add(m[k]);
        }
      });
    }
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    this.byId.clear();
  }
}
