// 食物目录（小吃工单 20261001；双爪捧食 20261002 按 PRIMARY-NOTES 覆盖）。
// 加载三份真实手持小吃 GLB（resources/foods/handheld/，SHA 见
// inputs/play-foods.json，恢复方法同角色资产一节）。
//
// 资源生命周期契约（GOAL.md）：每个 GLB 只加载一次，目录是唯一 owner；手持与
// 摊位陈列都从同一原型 clone（共享 geometry/material）。吃完只是把手持实例从
// 骨骼上摘下，绝不 dispose 仍被陈列引用的共享资源；只有整个目录 dispose（页面
// 卸载场景）才释放 GPU 资源。
//
// LOD：识别 _LOD0/1/2 命名，只显示一层（手持与近处陈列用 LOD0，原型保持原始尺寸）。socket_grip 对齐掌心（armR 骨骼），socket_rest 供托盘陈列参考。
//
// 双爪捧食（20261002）：主控实景 baseline 三味 proto 都太小（最大水平边
// .046/.12/.07m），运行时按份放大到目标最大水平尺寸（.18/.22/.18m），比例
// 从真实 proto bbox 推导、绝对赋值不累乘；原 GLB 字节与陈列相对布局不变，
// 陈列几何底面仍贴原托盘。socket_grip 偏移随比例转换（乘 cupScale），在新
// 实例创建时一次性换算，任何 attach 路径都不再改 scale。
import * as THREE from 'three';

// 目标最大水平尺寸（米）：小笼包 .18 / 葱油饼 .22 / 油墩子 .18（主控 baseline 定版）
export const CUP_TARGET_WIDTH = { xiaolongbao: 0.18, congyoubing: 0.22, youdunzi: 0.18 };

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
  // 双爪捧食比例（PRIMARY-NOTES）：目标最大水平尺寸 / 真实 bbox 最大水平边；
  // 未知味回退 1（不放大），固定每份一个值，绝不累乘。
  const targetWidth = CUP_TARGET_WIDTH[food.id] ?? null;
  const cupScale = targetWidth ? targetWidth / Math.max(size.x, size.z) : 1;
  // 底面中心（proto 系）：双手托举底面锚点 + 陈列底面贴盘补偿共用
  const bottomCenter = new THREE.Vector3(
    (box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  return {
    id: food.id,
    proto: protoScene,
    gripOffset: gripPos.clone(),
    restOffset: rest?.position?.clone() ?? new THREE.Vector3(),
    lodShown, sizeM: [size.x, size.y, size.z],
    cupScale,
    cupBottomAnchor: bottomCenter.clone(),
    cupRearAnchor: new THREE.Vector3(bottomCenter.x, box.min.y, box.min.z),
    // holder 原点（= socket_grip）到食品底面中心的偏移，已含比例（holder 局部系）
    cupBottomOffset: bottomCenter.clone().sub(gripPos).multiplyScalar(cupScale),
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
  // 比例换算只发生在实例创建：inner 绝对赋值 cupScale，socket_grip 随比例
  // 平移（-gripOffset*cupScale）保持钉在 holder 原点；holder 自身 scale 恒 1，
  // 手中/篮中比例天然一致。绝不反复乘 scale。
  makeHandInstance(id) {
    const entry = this.byId.get(id);
    if (!entry) return null;
    const holder = new THREE.Group();
    holder.name = `play-held-${id}`;
    holder.userData.sharedPlayFood = true;
    holder.userData.playFoodId = id;
    holder.userData.cupBottomOffset = entry.cupBottomOffset.clone();
    holder.userData.cupRearOffset = entry.cupRearAnchor.clone().sub(entry.gripOffset).multiplyScalar(entry.cupScale);
    holder.userData.cupYaw = 0;
    const inst = entry.proto.clone();
    inst.name = `${id}-held`;
    inst.scale.setScalar(entry.cupScale);                       // 幂等：绝对赋值
    inst.position.copy(entry.gripOffset).multiplyScalar(-entry.cupScale);
    holder.add(inst);
    return holder;
  }
  // 手持实例：挂到指定骨骼（armR），随动画运动。gripLocal 是真实爪掌前表面
  // （armR 骨空间，由 PlayAvatar.ensureSnackSkin 从改绑后的真实爪皮肤簇标定）；
  // 不传时回退 legacy 固定偏移（假人骨架/测试路径）。旧单手契约保留不动。
  attachToHand(id, bone, reusable = null, gripLocal = null) {
    const entry = this.byId.get(id);
    if (!entry || !bone?.isBone) return null;
    const holder = reusable?.userData?.playFoodId === id
      ? reusable : this.makeHandInstance(id);
    holder.userData.playTwoHanded = false;
    holder.position.copy(gripLocal ?? entry.hand.pos);
    holder.rotation.copy(entry.hand.rot);
    holder.scale.setScalar(1);        // 真实比例由 inner inst 携带
    bone.add(holder);
    return holder;
  }
  // 双爪捧食（工单 20261002 新模式）：挂到任意 anchor（通常是 avatar.model 这
  // 类非骨节点——生命周期与角色场景同生共死，avatar.dispose 的 sharedPlayFood
  // 扫描会先摘除、绝不 dispose 目录资源）。位置/朝向由 PlayAvatar 双手中点
  // 同步每帧驱动；这里只挂载并标记 playTwoHanded。返回同一 holder（hand→篮→
  // hand 复用不复制）。
  attachToHands(id, anchor, reusable = null, { initLocal = null } = {}) {
    const entry = this.byId.get(id);
    if (!entry || !anchor?.isObject3D) return null;
    const holder = reusable?.userData?.playFoodId === id
      ? reusable : this.makeHandInstance(id);
    holder.userData.playTwoHanded = true;
    holder.position.copy(initLocal ?? new THREE.Vector3());
    holder.rotation.set(0, 0, 0);
    holder.scale.setScalar(1);
    anchor.add(holder);
    return holder;
  }
  // 陈列实例：摆在摊位托盘上（世界坐标由调用方给——来自 food-sockets tray）。
  // 同比例放大，但绕「底面中心」补偿：几何最低面保持在原陈列接触点上，只在
  // 托盘平面上向四周长大（调用方无需改任何摆放代码）。wrapper 是调用方直接
  // 摆位的对象（位置/rotY 都作用在 wrapper 上）；inner 承担缩放+补偿。
  makeDisplay(id) {
    const entry = this.byId.get(id);
    if (!entry) return null;
    const inst = entry.proto.clone();
    inst.name = `${id}-display`;
    inst.scale.setScalar(entry.cupScale);
    // 缩放后 proto 点 p 映射到 wrapper 系：inst.position + s*p；要求底面中心
    // bc 落在原处（bc*1）：inst.position = (1-s)*bc
    inst.position.copy(entry.cupBottomAnchor).multiplyScalar(1 - entry.cupScale);
    const wrapper = new THREE.Group();
    wrapper.name = `${id}-display-cupped`;
    wrapper.add(inst);
    return wrapper;
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
