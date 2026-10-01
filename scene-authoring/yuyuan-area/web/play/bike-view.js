// 自行车视觉装配（小吃工单 20261001；R0-3 修正版；工单 B 重标定）。
// 只管网格与骑姿呈现：
//   - 从派生车 GLB（resources/vehicles/play-bicycle.glb，SHA 见
//     inputs/play-vehicle.json）按分件名装配 rig：front-wheel / rear-wheel /
//     steering（含前叉+车把+前轮）/ crank / seat / handle-L/R / pedal-L/R /
//     basket-socket / anchor-dismount。
//   - 轮/曲柄角度按 RideController 的 signedTravel（真实校正位移在车头推进轴的
//     投影）推进——倒车反转、碰墙静止不空转；轮轴 = GLB X。
//   - 车把随 A/D 转向有可见反馈（steering 节点小角度偏转）。
//   - 骑姿按真实皮肤接触解算（工单 B）：髋骨落在座面；每侧手臂/腿在骨局部
//     pitch×roll 网格里解算，把 rider-fit 标定的爪/脚皮肤簇质心送到随转向/
//     曲柄实时移动的握把/踏板 socket；角度相对 rest 限幅（臂 <=1.2rad、
//     腿 <=1.35rad、脊柱前倾 <=0.55rad），不硬移骨骼不拉长。
// 物理位移全在 vehicle.js（RideController），本文件绝不移动任何刚体。
import * as THREE from 'three';
import { planRideSkinFix, skinCluster } from './rider-fit.js';

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
    this._lastSigned = 0;       // 绑定控制器的 signedTravel 基线（换控制器无相位跳变）
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

  // 骑乘中每帧：位置/航向随 RideController；轮/曲柄按真实校正位移投影（signedTravel，
  // 倒车反转、碰墙不空转）；车把随 A/D。控制器基线在绑定/换绑时重置。
  updateRide(pos, heading, rideCtl, dt) {
    this.placeAt(pos, heading);
    this.root.updateMatrixWorld(true);
    const signed = rideCtl?.signedTravel ?? this._lastSigned;
    const dd = signed - this._lastSigned;
    this._lastSigned = signed;
    this._spin += dd / Math.max(0.05, this.wheelRadius);
    // 前进 = 世界 -Z；绕 +X 正转使轮顶向 +Z（后滚）→ 取负才是前滚；倒车 dd<0 自然反转
    if (this.rig.frontWheel) this.rig.frontWheel.rotation.x = -this._spin;
    if (this.rig.rearWheel) this.rig.rearWheel.rotation.x = -this._spin;
    if (this.rig.crank) this.rig.crank.rotation.x = -this._spin * this.crankRatio;
    // 车把转向反馈：A/D 输入 → steering 节点小角度偏转（视觉，不影响碰撞体）
    if (this.rig.steering) {
      const steer = rideCtl?.input?.right ?? 0;
      this.rig.steering.rotation.y = -steer * 0.1;
    }
    if (dt > 0) this._crankPhase = this.rig.crank ? this.rig.crank.rotation.x : 0;
  }

  // ---- 骑姿（工单 B：真实皮肤接触解算） ----
  // rideCtl：绑定 signedTravel 基线（上车/换控制器时重置，无相位跳变）。
  // 上车流程：骨骼统一 rest → rider-fit 改绑（完整 geometry 克隆）→
  // 爪/脚皮肤簇标定（boneInverse 采样，与世界无关）→ 髋骨座位偏移 + 脊柱前倾搜索。
  attachRider(avatar, rideCtl = null) {
    if (!avatar || this.rider) return;
    this.rider = avatar;
    this._lastSigned = rideCtl?.signedTravel ?? 0;
    this._riderBoneSave = [];
    for (const name of ['armL', 'armR', 'legL', 'legR', 'spine']) {
      const bone = avatar.model.getObjectByName(name);
      if (bone?.isBone) this._riderBoneSave.push([bone,
        (avatar.restBoneQuaternions?.get(name) ?? bone.quaternion).clone()]);
    }
    // 统一 rest 位姿后再标定（不取 walk animation 中间肩点）
    avatar.model.traverse((o) => {
      if (o.isBone && avatar.restBoneQuaternions?.has(o.name)) {
        o.quaternion.copy(avatar.restBoneQuaternions.get(o.name));
      }
    });
    // 权重修复：完整 geometry 克隆 + patch；下车 restore 归还原对象并 dispose 克隆
    const bodyMesh = this._findSkinMesh(avatar.model);
    if (bodyMesh) {
      this._skinFix = planRideSkinFix(bodyMesh);
      this._skinClone = this._skinFix.apply();
      this._skinMesh = bodyMesh;
      this._contact = {
        armL: skinCluster(bodyMesh, bodyMesh.skeleton, 'armL', { minDist: 0.13 }),
        armR: skinCluster(bodyMesh, bodyMesh.skeleton, 'armR', { minDist: 0.13 }),
        legL: skinCluster(bodyMesh, bodyMesh.skeleton, 'legL', { minDist: 0.14 }),
        legR: skinCluster(bodyMesh, bodyMesh.skeleton, 'legR', { minDist: 0.14 }),
      };
    }
    // 髋骨 root 空间偏移（座位拟合基准）
    const hips = avatar.model.getObjectByName('hips');
    if (hips) {
      avatar.root.updateMatrixWorld(true);
      const hipsWorld = new THREE.Vector3();
      hips.getWorldPosition(hipsWorld);
      this._hipsOffset = avatar.root.worldToLocal(hipsWorld);
    }
    // 脊柱前倾搜索（一次性）：带动肩前移，取手臂可达最好的档位（<=0.55rad）
    this._crankAngle = this.rig.crank ? this.rig.crank.rotation.x : 0;
    this._spineLean = 0;
    this.sit(avatar, this.root.rotation.y, this._crankAngle);
    this._spineLean = this._searchSpineLean(avatar);
    this.sit(avatar, this.root.rotation.y, this._crankAngle);
  }

  _findSkinMesh(model) {
    let found = null;
    model.traverse((o) => { if (!found && o.isSkinnedMesh && o.skeleton) found = o; });
    return found;
  }

  // 脊柱前倾档位：粗网格评分（手臂簇→握把 + 腿簇→踏板的总误差），取最优
  _searchSpineLean(avatar) {
    if (!this._contact?.armL || !this.rig.handleL) return 0;
    this.root.updateMatrixWorld(true);
    avatar.root.updateMatrixWorld(true);
    const spine = avatar.model.getObjectByName('spine');
    if (!spine?.isBone) return 0;
    const q0 = avatar.restBoneQuaternions.get('spine') ?? spine.quaternion.clone();
    let best = { lean: 0, score: Infinity };
    for (const lean of [0, 0.15, 0.3, 0.42, 0.55]) {
      spine.quaternion.copy(q0);
      spine.rotateX(lean);           // +X = 前倾（模型 +Z 为脸朝向，肩向车头移）
      avatar.root.updateMatrixWorld(true);
      const score = this._scoreContacts(avatar);
      if (score < best.score) best = { lean, score };
    }
    spine.quaternion.copy(q0);
    avatar.root.updateMatrixWorld(true);
    return best.lean;
  }

  _scoreContacts(avatar) {
    let score = 0;
    const arms = [['armL', this.rig.handleL, this._contact.armL], ['armR', this.rig.handleR, this._contact.armR]];
    const legs = [['legL', this.rig.pedalL, this._contact.legL], ['legR', this.rig.pedalR, this._contact.legR]];
    for (const [boneName, node, cluster] of [...arms, ...legs]) {
      if (!node || !cluster) continue;
      const bone = avatar.model.getObjectByName(boneName);
      const q0 = avatar.restBoneQuaternions.get(boneName) ?? bone.quaternion.clone();
      const target = this.worldPos(node, new THREE.Vector3());
      const fit = this._skinTarget(bone, cluster, target);
      const { dist } = this._solveLimb(bone, q0, fit.local, fit.target, { apply: false });
      score += dist * dist * (boneName.startsWith('arm') ? 1.5 : 1);   // 手部优先
    }
    return score;
  }

  _skinTarget(bone, cluster, target) {
    const own = cluster.contributions?.find(c => c.bone === bone);
    if (!own || own.weight < 1e-6) return { local: cluster.contactLocal, target };
    const other = new THREE.Vector3();
    for (const c of cluster.contributions) {
      if (c === own) continue;
      other.addScaledVector(c.bone.localToWorld(c.local.clone()), c.weight);
    }
    return { local: own.local, target: target.clone().sub(other).divideScalar(own.weight) };
  }

  // 单肢解算：在骨局部 pitch×roll 网格里找爪/脚簇质心离目标最近的旋转，
  // 角度相对 rest 限幅。apply=false 只返回结果不写骨骼。
  _solveLimb(bone, q0, contactLocal, targetWorld, { apply = false, maxAngle = 1.2, pitchLo = -1.25, pitchHi = 0.1, rollLo = -0.6, rollHi = 0.6, steps = 24 }) {
    const parent = bone.parent;
    const e = new THREE.Euler();
    const R = new THREE.Quaternion();
    const q = new THREE.Quaternion();
    const paw = new THREE.Vector3();
    let best = { dist: Infinity, pitch: 0, roll: 0, angle: 0 };
    for (let pi = 0; pi <= steps; pi++) {
      const pitch = pitchLo + (pitchHi - pitchLo) * (pi / steps);
      for (let ri = 0; ri <= 12; ri++) {
        const roll = rollLo + (rollHi - rollLo) * (ri / 12);
        e.set(pitch, 0, roll, 'XYZ');
        R.setFromEuler(e);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(R.w)));   // 相对 rest 的转角
        if (angle > maxAngle) continue;
        q.copy(q0).multiply(R);
        paw.copy(contactLocal).applyQuaternion(q).add(bone.position);
        parent.localToWorld(paw);
        const dist = paw.distanceTo(targetWorld);
        if (dist < best.dist) best = { dist, pitch, roll, angle };
      }
    }
    if (best.dist === Infinity) {   // 全网格越限：取限幅内最大前伸
      best = { dist: Infinity, pitch: pitchLo * 0.9, roll: 0, angle: 0 };
    }
    if (apply) {
      e.set(best.pitch, 0, best.roll, 'XYZ');
      R.setFromEuler(e);
      bone.quaternion.copy(q0).multiply(R);
    }
    return best;
  }

  // 每帧骑姿：座位拟合 + 脊柱前倾 + 双臂/双腿真实接触解算。
  // 坐标契约：seat/heading 都是 bike 世界值；avatar.root 的父帧可能带平移/yaw
  // （浏览器里是 scene 原帧，测试里验证任意父帧），先取父帧局部量再落位。
  sit(avatar, bikeHeading, crankAngle = 0) {
    if (!avatar) return;
    const parent = avatar.root.parent;
    if (parent) parent.updateWorldMatrix(true, false);
    const seatLocal = this.worldPos(this.rig.seat, new THREE.Vector3());
    if (parent) parent.worldToLocal(seatLocal);
    let yawOffset = 0;
    if (parent) {
      const pq = new THREE.Quaternion(), pp = new THREE.Vector3(), ps = new THREE.Vector3();
      parent.matrixWorld.decompose(pp, pq, ps);
      yawOffset = new THREE.Euler().setFromQuaternion(pq, 'YXZ').y;
    }
    const rootYaw = bikeHeading + Math.PI - yawOffset;   // MODEL_FORWARD +Z → 车头 -Z（父帧内）
    avatar.root.rotation.y = rootYaw;
    if (this._hipsOffset) {
      const off = this._hipsOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rootYaw);
      avatar.root.position.set(seatLocal.x - off.x, seatLocal.y - off.y + 0.015, seatLocal.z - off.z);
    } else {
      avatar.root.position.set(seatLocal.x, seatLocal.y - 0.2, seatLocal.z);   // 无髋骨时的保守近似
    }
    avatar.root.updateMatrixWorld(true);
    // 脊柱前倾（固定档位；改完骨骼必须刷新矩阵再解算，臂挂在 spine 下）
    const spine = avatar.model.getObjectByName('spine');
    if (spine?.isBone && this._spineLean > 0) {
      const q0 = avatar.restBoneQuaternions.get('spine') ?? spine.quaternion.clone();
      spine.quaternion.copy(q0);
      spine.rotateX(this._spineLean);
      avatar.root.updateMatrixWorld(true);
    }
    // 双臂 → 握把（随 steering 实时移动）；双腿 → 踏板（随曲柄实时移动）
    this._crankAngle = crankAngle;
    this._poseContacts(avatar);
  }

  _poseContacts(avatar) {
    if (!this._contact) return;
    const limits = { arm: 1.2, leg: 1.35 };
    const pairs = [
      ['armL', this.rig.handleL, this._contact.armL, limits.arm],
      ['armR', this.rig.handleR, this._contact.armR, limits.arm],
      ['legL', this.rig.pedalL, this._contact.legL, limits.leg],
      ['legR', this.rig.pedalR, this._contact.legR, limits.leg],
    ];
    for (const [boneName, node, cluster, maxAngle] of pairs) {
      if (!node || !cluster) continue;
      const bone = avatar.model.getObjectByName(boneName);
      if (!bone?.isBone) continue;
      const q0 = avatar.restBoneQuaternions.get(boneName) ?? bone.quaternion.clone();
      const target = this.worldPos(node, new THREE.Vector3());
      const fit = this._skinTarget(bone, cluster, target);
      this._solveLimb(bone, q0, fit.local, fit.target, {
        apply: true, maxAngle,
        pitchLo: boneName.startsWith('arm') ? -1.3 : -1.3,
        pitchHi: boneName.startsWith('arm') ? 0.25 : 0.15,
        rollLo: -0.6, rollHi: 0.6, steps: 26,
      });
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
    // 权重修复还原：原 geometry 对象归还，整只克隆 dispose（GPU buffer 全释放）
    if (this._skinFix) {
      this._skinFix.restore(this._skinClone);
      this._skinFix = null; this._skinClone = null; this._skinMesh = null; this._contact = null;
    }
    this._riderBoneSave = null;
    this._hipsOffset = null;
    this._spineLean = 0;
    this._lastSigned = 0;      // 下车清基线，下次上车重新绑定
    this.rider = null;
  }
}

// install.js 每帧骑姿调用（BikeView.sit 的薄封装，保持 install 可读）
export function applyRiderPose(avatar, bikeView, bikeHeading) {
  const crank = bikeView.rig.crank;
  bikeView.sit(avatar, bikeHeading, crank ? crank.rotation.x : 0);
}
