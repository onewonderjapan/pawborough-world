// 自行车视觉装配（小吃工单 20261001；R0-3 修正版）。只管网格与骑姿呈现：
//   - 从派生车 GLB（resources/vehicles/play-bicycle.glb，SHA 见
//     inputs/play-vehicle.json）按分件名装配 rig：front-wheel / rear-wheel /
//     steering（含前叉+车把+前轮）/ crank / seat / handle-L/R / pedal-L/R /
//     basket-socket / anchor-dismount。
//   - 轮/曲柄角度按 RideController 累计的真实校正水平位移（distance）推进——
//     碰墙静止时不按 desired 空转（R0-3）；轮轴 = GLB X。
//   - 车把随 A/D 转向有可见反馈（steering 节点小角度偏转）。
//   - 骑姿按真实骨骼拟合（R0-3）：髋骨对齐 seat socket（不再固定 -0.34）、
//     手臂朝 handle-L/R、腿按曲柄相位蹬踏 pedal-L/R（随曲柄旋转，非常量姿势）。
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
    seat: need('seat') ?? need('seat-anchor'),
    handleL: need('handle-L'),
    handleR: need('handle-R'),
    pedalL: need('pedal-L'),
    pedalR: need('pedal-R'),
    basketSocket: need('basket-socket'),
    dismountAnchor: need('anchor-dismount'),
  };
  for (const k of ['frontWheel', 'rearWheel', 'crank', 'seat', 'steering']) {
    if (!rig[k]) throw new Error(`bike rig: missing part "${k}"`);
  }
  return rig;
}

const _wp = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class BikeView {
  constructor(rig) {
    this.rig = rig;
    this.root = rig.root;
    this.wheelRadius = 0.17;
    this.crankRatio = 0.5;      // 简化传动比（曲柄角 = 轮角 × 0.5）
    this._spin = 0;             // 按真实位移累计的轮角
    this._lastDistance = 0;
    this.rider = null;          // 挂在座位上的角色
    this._riderBoneSave = null; // 骑姿骨骼原四元数（下车还原）
    this._hipsOffset = null;    // 髋骨在角色 root 空间的偏移（座位拟合用）
    this.root.visible = false;  // 未布置前不显示
  }

  placeAt(pos, heading = 0) {
    this.root.visible = true;
    this.root.position.set(pos[0], pos[1], pos[2]);
    // 模型 -Z 前向；世界 heading 约定 forward = (-sin h, -cos h)
    this.root.rotation.set(0, heading, 0);
  }

  worldPos(node, out = new THREE.Vector3()) {
    return node.getWorldPosition(out);
  }

  // 骑乘中每帧：位置/航向随 RideController；轮/曲柄按真实位移；车把随 A/D
  updateRide(pos, heading, rideCtl, dt) {
    this.placeAt(pos, heading);
    this.root.updateMatrixWorld(true);
    // 轮角按真实校正位移累计（rideCtl.distance 来自 lastStep.corrected）
    const dist = rideCtl?.distance ?? this._lastDistance;
    const dd = Math.max(0, dist - this._lastDistance);
    this._lastDistance = dist;
    this._spin += dd / Math.max(0.05, this.wheelRadius);
    // 前进 = 世界 -Z；绕 +X 正转使轮顶向 +Z（后滚）→ 取负才是前滚
    if (this.rig.frontWheel) this.rig.frontWheel.rotation.x = -this._spin;
    if (this.rig.rearWheel) this.rig.rearWheel.rotation.x = -this._spin;
    if (this.rig.crank) this.rig.crank.rotation.x = -this._spin * this.crankRatio;
    // 车把转向反馈：A/D 输入 → steering 节点小角度偏转（视觉，不影响碰撞体）
    if (this.rig.steering) {
      const steer = rideCtl?.input?.right ?? 0;
      this.rig.steering.rotation.y = -steer * 0.3;
    }
    if (dt > 0) this._crankPhase = this.rig.crank ? this.rig.crank.rotation.x : 0;
  }

  // ---- 骑姿（R0-3：按真实骨骼/座位/手把/踏板拟合，不再固定偏移） ----
  attachRider(avatar) {
    if (!avatar || this.rider) return;
    this.rider = avatar;
    this._riderBoneSave = [];
    for (const name of ['armL', 'armR', 'legL', 'legR']) {
      const bone = avatar.model.getObjectByName(name);
      if (bone?.isBone) this._riderBoneSave.push([bone,
        (avatar.restBoneQuaternions?.get(name) ?? bone.quaternion).clone()]);
    }
    // 髋骨 root 空间偏移（座位拟合的解析基准）
    const hips = avatar.model.getObjectByName('hips');
    if (hips) {
      avatar.model.updateMatrixWorld(true);
      const hipsWorld = new THREE.Vector3();
      hips.getWorldPosition(hipsWorld);
      const rootYaw = avatar.root.rotation.y;
      const off = hipsWorld.sub(avatar.root.position);
      this._hipsOffset = off.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rootYaw);
    }
    this._armPitch = this._fitArmPitch(avatar);
  }

  // 手臂前伸角：肩(arm 骨) → handle-R 的几何俯仰（按真实位置拟合）。
  // 手臂 rest 大致朝下；目标方向的水平距 dh / 垂直差 -dy 决定前伸角。
  _fitArmPitch(avatar) {
    if (!this.rig.handleR) return -1.3;
    this.root.updateMatrixWorld(true);
    avatar.root.updateMatrixWorld(true);
    const shoulder = new THREE.Vector3();
    avatar.model.getObjectByName('armR')?.getWorldPosition(shoulder);
    const grip = this.worldPos(this.rig.handleR, new THREE.Vector3());
    const dy = grip.y - shoulder.y;
    const dh = Math.hypot(grip.x - shoulder.x, grip.z - shoulder.z);
    return -Math.atan2(Math.max(0.05, dh), Math.max(0.02, -dy));
  }

  // 每帧骑姿：座位拟合 + 手臂定姿 + 腿随曲柄相位
  sit(avatar, bikeHeading, crankAngle = 0) {
    if (!avatar) return;
    const seat = this.worldPos(this.rig.seat, new THREE.Vector3());
    const rootYaw = bikeHeading + Math.PI;   // MODEL_FORWARD +Z → 车头 -Z
    avatar.root.rotation.y = rootYaw;
    if (this._hipsOffset) {
      const off = this._hipsOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rootYaw);
      avatar.root.position.set(seat.x - off.x, seat.y - off.y + 0.015, seat.z - off.z);
    } else {
      avatar.root.position.set(seat.x, seat.y - 0.2, seat.z);   // 无髋骨时的保守近似
    }
    this._armPitch = this._fitArmPitch(avatar);
    this._applyRiderPose(crankAngle);
  }

  _applyRiderPose(crankAngle = 0) {
    const avatar = this.rider;
    if (!avatar) return;
    const legBase = -0.45, legAmp = 0.42;   // 蹬踏：相位相反的左右腿
    for (const [bone, q0] of this._riderBoneSave) {
      bone.quaternion.copy(q0);
      if (bone.name === 'armL' || bone.name === 'armR') {
        bone.rotateX(this._armPitch ?? -1.3);
      } else if (bone.name === 'legL') {
        bone.rotateX(legBase + legAmp * Math.sin(crankAngle));
        bone.rotateZ(0.12);
      } else if (bone.name === 'legR') {
        bone.rotateX(legBase + legAmp * Math.sin(crankAngle + Math.PI));
        bone.rotateZ(-0.12);
      }
    }
  }

  // 车篮：同一实例移入（不复制，R0-5）
  attachBasket(obj) {
    const socket = this.rig.basketSocket ?? this.rig.root;
    socket.add(obj);
    obj.position.set(0, 0.07, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.setScalar(1);
  }

  detachRider(avatar) {
    if (!avatar || this.rider !== avatar) return;
    for (const [bone, q0] of this._riderBoneSave) bone.quaternion.copy(q0);
    this._riderBoneSave = null;
    this._hipsOffset = null;
    this.rider = null;
  }
}

// install.js 每帧骑姿调用（BikeView.sit 的薄封装，保持 install 可读）
export function applyRiderPose(avatar, bikeView, bikeHeading) {
  const crank = bikeView.rig.crank;
  bikeView.sit(avatar, bikeHeading, crank ? crank.rotation.x : 0);
}
