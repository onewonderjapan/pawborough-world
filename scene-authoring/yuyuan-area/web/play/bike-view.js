// 自行车视觉装配（小吃工单 20261001）。只管网格与骑姿呈现：
//   - 从派生车 GLB（resources/vehicles/play-bicycle.glb，SHA 见
//     inputs/play-vehicle.json）按分件名装配 rig：front-wheel / rear-wheel /
//     steering / crank / saddle / handlebar / basket / anchor-dismount 等。
//   - 轮转随真实距离（RideController.speed × dt ÷ 轮半径），踏板随曲柄。
//   - 骑姿：角色根部接到座位锚点（不把步行动画站在车上），手臂朝手把、
//     腿朝脚踏的静态骨骼偏转（12 关节简化 rig，无 IK，落地到截图调优）。
// 物理位移全在 vehicle.js（RideController），本文件绝不移动任何刚体。
import * as THREE from 'three';

export async function loadBikeRig({ manifest }) {
  const res = await fetch('/' + manifest.path);
  if (!res.ok) throw new Error(`/${manifest.path} 返回 ${res.status}`);
  const buf = await res.arrayBuffer();
  if (crypto?.subtle && manifest.sha256 && manifest.sha256 !== 'PENDING_BUILD') {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (sha !== manifest.sha256) throw new Error(`SHA256 校验不符（${sha.slice(0, 12)}…）`);
  }
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
  const root = gltf.scene;
  const need = (name) => {
    let n = null;
    root.traverse((o) => { if (!n && o.name === name) n = o; });
    return n;
  };
  const rig = {
    root,
    frontWheel: need('front-wheel'),
    rearWheel: need('rear-wheel'),
    steering: need('steering'),
    crank: need('crank'),
    basket: need('basket'),
    seatAnchor: need('seat-anchor'),
    mountAnchor: need('anchor-mount'),
    dismountAnchor: need('anchor-dismount'),
  };
  for (const k of ['frontWheel', 'rearWheel', 'crank', 'seatAnchor']) {
    if (!rig[k]) throw new Error(`bike rig: missing part "${k}"`);
  }
  return rig;
}

export class BikeView {
  constructor(rig) {
    this.rig = rig;
    this.root = rig.root;
    this.wheelRadius = 0.17;
    this._spin = 0;
    this.rider = null;          // 挂在座位上的角色 root
    this._riderBoneSave = null; // 骑姿骨骼原四元数（下车还原）
    this.root.visible = false;  // 未布置前不显示
  }

  placeAt(pos, yaw = 0) {
    this.root.visible = true;
    this.root.position.set(pos[0], pos[1], pos[2]);
    // 模型 -Z 前向；world yaw 约定 forward = (-sin yaw, -cos yaw)
    this.root.rotation.set(0, yaw, 0);
  }

  // 骑乘中每帧：位置/朝向随 RideController，轮/踏板随真实距离
  updateRide(pos, yaw, speed, dt) {
    this.placeAt(pos, yaw);
    const dω = (speed * dt) / Math.max(0.05, this.wheelRadius);
    this._spin += dω;
    // 前进 = 世界 -Z；绕 +X 正转使轮顶向 +Z（后滚）→ 取负才是前滚
    if (this.rig.frontWheel) this.rig.frontWheel.rotation.x = -this._spin;
    if (this.rig.rearWheel) this.rig.rearWheel.rotation.x = -this._spin;
    if (this.rig.crank) this.rig.crank.rotation.x = -this._spin * 0.5;   // 简化传动比
  }

  // 上车：角色根挂到座位锚点（不销毁/不复制任何资源）
  attachRider(avatar) {
    if (!avatar || this.rider) return;
    this.rider = avatar;
    this._riderBoneSave = [];
    for (const name of ['armL', 'armR', 'legL', 'legR']) {
      const bone = avatar.model.getObjectByName(name);
      if (bone?.isBone) this._riderBoneSave.push([bone, bone.quaternion.clone()]);
    }
    this._applyRiderPose(0);
  }

  // 每帧骑姿（覆盖步行 update 的脚点定位）：座位锚点世界位 + 前向 = 车 yaw
  riderPose(out = null) {
    const seat = new THREE.Vector3();
    this.rig.seatAnchor.getWorldPosition(seat);
    return out ?? seat;
  }

  _applyRiderPose() {
    const avatar = this.rider;
    if (!avatar) return;
    // 手朝手把（arm 前伸），腿微曲踩脚踏（12 关节 rig 的静态近似，非 IK）
    const POSE = { armX: -1.15, legX: -0.85, legSpread: 0.12 };
    for (const [bone, q0] of this._riderBoneSave) {
      bone.quaternion.copy(q0);
      if (bone.name === 'armL' || bone.name === 'armR') {
        bone.rotateX(POSE.armX);
      } else if (bone.name === 'legL') {
        bone.rotateX(POSE.legX); bone.rotateZ(POSE.legSpread);
      } else if (bone.name === 'legR') {
        bone.rotateX(POSE.legX); bone.rotateZ(-POSE.legSpread);
      }
    }
  }

  // 骑乘中每帧调用：把角色根摆到座位（腿长近似下沉），朝向 = 车头
  sit(avatar, bikeYaw) {
    if (!avatar) return;
    const seat = this.riderPose();
    // 座位世界位在 root 变换后有效；角色脚点 ≈ 座位下方腿长处（模型按 feet 对齐）
    avatar.root.position.set(seat.x, seat.y - 0.34 - avatar.modelMinY * 0, seat.z);
    avatar.root.rotation.y = bikeYaw + Math.PI;   // MODEL_FORWARD +Z → 车头 -Z
    this._applyRiderPose();
  }

  detachRider(avatar) {
    if (!avatar || this.rider !== avatar) return;
    for (const [bone, q0] of this._riderBoneSave) bone.quaternion.copy(q0);
    this._riderBoneSave = null;
    this.rider = null;
  }
}

// install.js 每帧骑姿调用（BikeView.sit 的薄封装，保持 install 可读）
export function applyRiderPose(avatar, bikeView, bikeYaw) {
  bikeView.sit(avatar, bikeYaw);
}
