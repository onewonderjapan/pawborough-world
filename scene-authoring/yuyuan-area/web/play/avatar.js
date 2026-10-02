// Play-phase 1 gray-cat avatar wrapper. Owns the GLTF scene (5 skinned meshes
// + 12-bone skin), the AnimationMixer and the idle/walk action pair.
//
// Contract (GOAL.md 动作与相机 + review R0):
//   - the wrapper's world position is derived ONLY from the controller feet:
//     root.position = feet - modelMinY (modelMinY from the real loaded
//     geometry). Animation can never move the wrapper — clips' root
//     translation tracks are constant zero (pinned by
//     tests/play_asset_contract.test.mjs) and the mixer is frozen while paused.
//   - VIEW yaw and CHARACTER FACING are decoupled (R1): the caller passes the
//     movement-derived facingYaw (web/play/telemetry.js — actual corrected
//     displacement direction, controller convention); while idle/paused
//     facingYaw is null and the cat keeps its last facing, so mouse-only view
//     rotation orbits the cat instead of spinning it. Until the first actual
//     movement the facing falls back to the view yaw. 取景/回游玩 never resets
//     it because the wrapper object survives the mode switch.
//   - walk/idle follows the ACTUAL corrected displacement flag; walk playback
//     rate follows the ACTUAL speed (speed / walkCycleSpeed) so a partially
//     blocked capsule slows its gait instead of moonwalking (R1).
//   - paused keeps the current action weights (freeze frame, no pose snap),
//     keeps the facing and never advances the mixer.
//   - illegal dt (NaN/negative) never propagates.
//   - dispose frees the wrapper's OWN GPU resources — geometries, materials,
//     textures and the owned skeleton found under the GLTF scene — and is
//     idempotent; it never touches the static physics world or shared assets.
import * as THREE from 'three';
import { planRideSkinFix, skinCluster } from './rider-fit.js';
import { smoothPlushShoulders, cupPalmVertices } from './plush-skin.js';
import { planFoodArmRig } from './food-arm-rig.js';

// The GLB's face direction in model space (nose/mouth meshes sit at +Z).
export const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
// Wrapper yaw that points MODEL_FORWARD along a controller-convention yaw.
export function avatarYawFor(yaw) { return yaw + Math.PI; }

// World-space bounds of every mesh under the (rest-pose) GLTF scene.
export function computeModelBounds(modelRoot) {
  modelRoot.updateMatrixWorld(true);
  const box = new THREE.Box3();
  modelRoot.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

export class PlayAvatar {
  // gltfScene: THREE.Group from GLTFLoader (NOT a placeholder); animations:
  // the loaded AnimationClips (idle/walk/eat required by name).
  constructor({ gltfScene, animations, walkCycleSpeed = 1.5 }) {
    if (!gltfScene?.isObject3D) throw new Error('avatar: gltfScene required');
    const clips = new Map((animations ?? []).map(c => [String(c.name || '').toLowerCase(), c]));
    for (const need of ['idle', 'walk']) {
      if (!clips.has(need)) throw new Error(`avatar: missing "${need}" animation clip`);
    }
    this.root = new THREE.Group();
    this.root.name = 'play-gray-cat';
    this.model = gltfScene;
    this.root.add(this.model);

    const box = computeModelBounds(this.model);
    if (box.isEmpty()) throw new Error('avatar: model has no renderable geometry');
    this.modelMinY = box.min.y;           // feet offset: lowest real geometry point
    this.height = box.max.y - box.min.y;
    this.walkCycleSpeed = walkCycleSpeed; // model-space m/s at walk timeScale 1
    this.facingYaw = null;                // last movement-derived facing (null = not yet)
    this.restBoneQuaternions = new Map();
    this.model.traverse(o => {
      if (o.isBone) this.restBoneQuaternions.set(o.name, o.quaternion.clone());
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {
      idle: this.mixer.clipAction(clips.get('idle')),
      walk: this.mixer.clipAction(clips.get('walk')),
      eat: clips.has('eat') ? this.mixer.clipAction(clips.get('eat')) : null,
    };
    this.current = 'idle';
    this.eatingPose = false;
    this.holdingPose = false;
    this.snackArm = this.model.getObjectByName('armR');
    this._snackBase = null;
    this._cupBase = null;
    this._snackElapsed = 0;
    // 手持/进食的爪皮肤跟随（工单：与骑乘共用 rider-fit 运行时改绑，可还原）。
    // _bodyMesh/_bodyOriginal 只用于识别「当前 geometry 是否还是原 GLB 对象」，
    // 骑乘（BikeView）持有自己的克隆期间，手持侧绝不重复 clone 或误还原。
    this._bodyMesh = (() => {
      let m = null;
      this.model.traverse(o => { if (!m && o.isSkinnedMesh && o.skeleton) m = o; });
      return m;
    })();
    this._bodyOriginal = this._bodyMesh?.geometry ?? null;
    this._bodyOriginalSkeleton = this._bodyMesh?.skeleton ?? null;
    this._foodArmRig = null;
    this._foodPalmCache = new WeakMap();
    this._handSkin = null;        // { mesh, fix, clone } —— 手持期间的权重克隆
    this.snackGripLocal = null;   // 真实爪掌前表面（armR 骨空间）；仅补丁生效期有效
    this._snackGripVertices = null;
    this._snackLeftVertices = null;
    this.actions.idle.setEffectiveWeight(1).play();
    this.actions.walk.setEffectiveWeight(0).play();
    // 表情 morph（eyeL/eyeR/mouth，extras.targetNames 提供名字；吃完成给 happy/content）
    this.morphMeshes = [];
    this.model.traverse((o) => {
      if (o.isMesh && o.morphTargetInfluences) this.morphMeshes.push(o);
    });
    this._expression = null;   // { name, weight, decay }
    this.disposed = false;
  }

  // 设置表情权重（按 targetNames 名字；字典缺失时回退 extras 顺序索引）。
  // weight 0 = 清除。返回是否命中了 morph。
  setExpression(name, weight) {
    let hit = false;
    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const idx = dict && Object.hasOwn(dict, name)
        ? dict[name]
        : (mesh.userData?.targetNames ? mesh.userData.targetNames.indexOf(name) : -1);
      if (idx >= 0 && idx < mesh.morphTargetInfluences.length) {
        mesh.morphTargetInfluences[idx] = Math.max(0, Math.min(1, weight));
        hit = true;
      }
    }
    return hit;
  }
  // 吃完的满足反馈：happy+content 淡入，decaySeconds 后淡出（暂停时不衰减）
  showSatisfaction({ weight = 1, hold = 1.2, decay = 1.5 } = {}) {
    const ok = this.setExpression('happy', weight) | this.setExpression('content', weight);
    if (!ok) return false;
    this._expression = { weight, hold, decay };
    return true;
  }
  _tickExpression(dt) {
    const e = this._expression;
    if (!e) return;
    if (e.hold > 0) { e.hold -= dt; return; }
    e.weight = Math.max(0, e.weight - dt / Math.max(0.05, e.decay));
    this.setExpression('happy', e.weight);
    this.setExpression('content', e.weight);
    if (e.weight <= 0) this._expression = null;
  }

  // 吃相：eat 剪辑循环；吃的过程中移动已被外层禁止，walk 权重归零
  setEatingPose(on, elapsed = 0) {
    if (!this.actions.eat) return false;
    this.eatingPose = Boolean(on);
    if (this.eatingPose) {
      this.ensureSnackSkin();
      this._snackElapsed = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
      this.actions.eat.reset();
      this.actions.eat.time = this._snackElapsed % Math.max(0.001, this.actions.eat.getClip().duration);
      this.actions.eat.setEffectiveWeight(1).play();
    } else if (!this.holdingPose) this.releaseSnackSkin();
    return true;
  }

  setHoldingPose(on) {
    this.holdingPose = Boolean(on);
    if (this.holdingPose) this.ensureSnackSkin();
    else if (!this.eatingPose) this.releaseSnackSkin();
    if (!this.holdingPose && !this.eatingPose) this._restoreSnackArm();
  }
  _restoreSnackArm() {
    if (this._cupBase) {
      for (const {arm,q,p} of this._cupBase) {arm.quaternion.copy(q);arm.position.copy(p);}
      this._cupBase = null;
    }
    if (!this.snackArm || !this._snackBase) return;
    this.snackArm.quaternion.copy(this._snackBase.q);
    this.snackArm.position.copy(this._snackBase.p);
    this._snackBase = null;
  }
  // ---- 手持爪皮肤跟随（复用 rider-fit 的验收改绑；原 GLB 字节不变） ----
  // 生效期：手持或进食。骑车接管（BikeView 自己 clone）期间不 apply；release 只
  // 归还自己持有的克隆，绝不动别人的 geometry（嵌套 clone 不泄漏、不错位还原）。
  ensureSnackSkin() {
    if (this.disposed || !this._bodyMesh || !this._bodyOriginal) return null;
    if (this._handSkin) {
      const s = this._handSkin, rig = this._foodArmRig;
      const baseOwned = s.mesh.geometry === s.clone && s.mesh.skeleton === s.skeleton;
      const rigOwned = rig?.active && s.mesh.geometry === rig.geometry && s.mesh.skeleton === rig.skeleton;
      return baseOwned || rigOwned ? this.snackGripLocal : null;
    }
    if (this._bodyMesh.geometry !== this._bodyOriginal || this._bodyMesh.skeleton !== this._bodyOriginalSkeleton) return null;
    const fix = planRideSkinFix(this._bodyMesh);
    const clone = fix.apply();
    this._handSkin = { mesh: this._bodyMesh, fix, clone, skeleton: this._bodyMesh.skeleton };
    this._calibrateSnackGrip();
    return this.snackGripLocal;
  }
  ensureFoodArmRig() {
    if (!this.ensureSnackSkin() || !this._cupLeftVertices?.length || !this._cupRightVertices?.length) return null;
    const s = this._handSkin;
    if (!s.plush) { smoothPlushShoulders(s.mesh, s.clone); s.plush = true; }
    if (this._foodArmRig?.disposed) this._foodArmRig = null;
    if (!this._foodArmRig) this._foodArmRig = planFoodArmRig(s.mesh, {
      palmVertexIds: { armL: this._cupLeftVertices, armR: this._cupRightVertices },
    });
    return this._foodArmRig.activate() ? this._foodArmRig : null;
  }
  getFoodPalm(side) {
    const contributions = this.getFoodPalmContributions(side);
    return contributions?.reduce((p, entry) => p.add(entry.position), new THREE.Vector3()) ?? null;
  }
  getFoodPalmContributions(side) {
    if (!this._handSkin) return null;
    const ids = side === 'armL' ? this._cupLeftVertices : this._cupRightVertices;
    if (!ids?.length) return null;
    const mesh = this._bodyMesh;
    this.root.updateMatrixWorld(true); mesh.skeleton.update();
    let cache = this._foodPalmCache.get(mesh.geometry);
    if (!cache) { cache = new Map(); this._foodPalmCache.set(mesh.geometry,cache); }
    const signature = (mesh.morphTargetInfluences ?? []).join(',');
    let entry = cache.get(side);
    if (!entry || entry.signature !== signature) {
      const sums = new Map(), v = new THREE.Vector3();
      const {skinIndex,skinWeight} = mesh.geometry.attributes;
      for (const id of ids) {
        THREE.Mesh.prototype.getVertexPosition.call(mesh,id,v);
        v.applyMatrix4(mesh.bindMatrix);
        for (let k=0;k<4;k++) {
          const mass=skinWeight.getComponent(id,k)/ids.length;
          if (!mass) continue;
          const index=skinIndex.getComponent(id,k), sum=sums.get(index) ?? {index,mass:0,point:new THREE.Vector3()};
          sum.mass+=mass; sum.point.addScaledVector(v,mass); sums.set(index,sum);
        }
      }
      entry={signature,sums:[...sums.values()].map(s=>({...s,point:s.point.divideScalar(s.mass)}))};cache.set(side,entry);
    }
    const intoModel = this.model.matrixWorld.clone().invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
    const boneMatrix = new THREE.Matrix4();
    return entry.sums.map(({index,mass,point}) => {
      boneMatrix.multiplyMatrices(mesh.skeleton.bones[index].matrixWorld,mesh.skeleton.boneInverses[index]);
      return {bone:mesh.skeleton.bones[index],mass,position:point.clone().applyMatrix4(boneMatrix).applyMatrix4(intoModel).multiplyScalar(mass)};
    });
  }
  getFoodShoulder(side) {
    this.root.updateMatrixWorld(true);
    const bone = this.model.getObjectByName(side);
    return bone ? this.model.worldToLocal(bone.getWorldPosition(new THREE.Vector3())) : null;
  }
  getFoodMouth() {
    const mesh = this.model.getObjectByName('cat_mouth');
    if (!mesh?.geometry) return null;
    this.root.updateMatrixWorld(true); mesh.skeleton?.update();
    const intoModel = this.model.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) box.expandByPoint(mesh.getVertexPosition(i, v).applyMatrix4(intoModel));
    const center = box.getCenter(new THREE.Vector3());
    center.z = box.max.z;
    return center;
  }
  releaseSnackSkin() {
    const s = this._handSkin;
    if (!s) return false;
    const rig = this._foodArmRig;
    if (rig) {
      if (rig.active && (s.mesh.geometry !== rig.geometry || s.mesh.skeleton !== rig.skeleton)) return false;
      rig.resetJoints();
      if (!rig.deactivate() || !rig.dispose()) return false;
      this._foodArmRig = null;
    }
    if (s.mesh.geometry !== s.clone || s.mesh.skeleton !== s.skeleton) return false;
    s.fix.restore(s.clone);
    this._handSkin = null;
    this.snackGripLocal = null;
    this._snackGripVertices = null;
    this._snackLeftVertices = null;
    this._cupLeftVertices = null;
    this._cupRightVertices = null;
    return true;
  }
  // 真实爪掌接触点（armR 骨空间）：改绑后的 armR 皮肤簇（skinCluster，与骑乘
  // 同一标定）→ 簇顶点在骨空间的最低带（minY+0.035，与 armSegmentModel 同带规
  // 则）质心 = 爪垫；沿肩→爪垫方向外推 0.015m 到爪掌前表面（纸托/包厚度）。
  _calibrateSnackGrip() {
    const mesh = this._handSkin?.mesh ?? this._bodyMesh;
    if (!mesh) return null;
    const cluster = skinCluster(mesh, mesh.skeleton, 'armR', { minWeight: 0.3, minDist: 0.13 });
    if (!cluster?.vertexIndices?.length) { this.snackGripLocal = null; return null; }
    const boneIndex = mesh.skeleton.bones.findIndex(b => b.name === 'armR');
    const boneInverse = mesh.skeleton.boneInverses[boneIndex];
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    const pts = [];
    for (const i of cluster.vertexIndices) pts.push({i,p:v.fromBufferAttribute(pos, i).applyMatrix4(boneInverse).clone()});
    const minY = Math.min(...pts.map(o => o.p.y));
    const tips = pts.filter(o => o.p.y <= minY + 0.035);
    const pad = new THREE.Vector3();
    tips.forEach(o => pad.add(o.p));
    pad.divideScalar(Math.max(1, tips.length));
    this._snackGripVertices = tips.map(o => o.i);
    this._cupLeftVertices=cupPalmVertices(mesh,'armL');
    this._cupRightVertices=cupPalmVertices(mesh,'armR');
    this._snackGripOffset = pad.clone().normalize().multiplyScalar(0.015);
    this.snackGripLocal = new THREE.Vector3();
    const left = skinCluster(mesh, mesh.skeleton, 'armL', {minWeight:0.3,minDist:0.13});
    if (left?.vertexIndices.length) {
      const li=mesh.skeleton.bones.findIndex(b=>b.name==='armL'), inv=mesh.skeleton.boneInverses[li];
      const lp=left.vertexIndices.map(i=>({i,y:new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(inv).y}));
      const lo=Math.min(...lp.map(o=>o.y));this._snackLeftVertices=lp.filter(o=>o.y<=lo+.035).map(o=>o.i);
    }
    this._syncSnackGrip();
    return this.snackGripLocal;
  }

  // Keep the selected anatomical vertices fixed. Re-selecting the lowest
  // vertices after posing can switch from paw to torso at a large arm angle.
  _syncSnackGrip() {
    const mesh=this._handSkin?.mesh,arm=this.snackArm,indices=this._snackGripVertices;
    if(!mesh||!arm||!indices?.length)return;
    this.root.updateMatrixWorld(true);mesh.skeleton.update();
    const center=new THREE.Vector3(),v=new THREE.Vector3();
    for(const i of indices){mesh.getVertexPosition(i,v);center.add(v.applyMatrix4(mesh.matrixWorld));}
    center.divideScalar(indices.length);
    this.snackGripLocal.copy(arm.worldToLocal(center.clone())).add(this._snackGripOffset);
    const upright=arm.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(this.root.getWorldQuaternion(new THREE.Quaternion()));
    for(const o of arm.children)if(o.userData?.sharedPlayFood){
      o.position.copy(this.snackGripLocal);
      o.quaternion.copy(upright);
    }
    const cup=this.model.children.find(o=>o.userData?.sharedPlayFood&&o.userData.playTwoHanded);
    if(cup&&this._cupLeftVertices?.length&&this._cupRightVertices?.length) {
      const left=new THREE.Vector3();
      for(const i of this._cupLeftVertices){mesh.getVertexPosition(i,v);left.add(v.applyMatrix4(mesh.matrixWorld));}
      left.divideScalar(this._cupLeftVertices.length);
      const right=new THREE.Vector3();
      for(const i of this._cupRightVertices){mesh.getVertexPosition(i,v);right.add(v.applyMatrix4(mesh.matrixWorld));}
      right.divideScalar(this._cupRightVertices.length);
      // The rear lower edge rests between both actual skinned palms. Eating
      // tilts the edible edge toward the mouth; walking keeps the food level.
      const midpoint=right.clone().add(left).multiplyScalar(.5);
      const rootQ=this.root.getWorldQuaternion(new THREE.Quaternion());
      const thinLift=cup.userData.playFoodId === 'congyoubing' ? .013*(this._cupLift??0):0;
      midpoint.add(new THREE.Vector3(0,.012+.008*(this._cupLift??0)+thinLift,.018+.022*(this._cupLift??0)).applyQuaternion(rootQ));
      const lifts={xiaolongbao:.65,congyoubing:1.30,youdunzi:1.0};
      const tilt=(lifts[cup.userData.playFoodId]??.65)*(this._cupLift??0);
      const desired=rootQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt,cup.userData.cupYaw??0,0)));
      cup.quaternion.copy(this.model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      cup.position.copy(this.model.worldToLocal(midpoint));
      cup.position.sub(cup.userData.cupRearOffset.clone().applyQuaternion(cup.quaternion));
    }
  }

  _applyCupArms(dt) {
    const rig = this.ensureFoodArmRig();
    if (!rig) return false;
    rig.resetJoints();
    const arms=['armL','armR'].map(n=>this.model.getObjectByName(n));
    if(arms.some(a=>!a?.isBone))return false;
    this._cupBase=arms.map(arm=>({arm,q:arm.quaternion.clone(),p:arm.position.clone()}));
    if(this.eatingPose)this._snackElapsed+=dt;
    const t=this.eatingPose?Math.min(1,this._snackElapsed/.45):0;
    this._cupLift=t*t*(3-2*t);
    const pitch=-1.8-.25*this._cupLift;
    const roll=.82-.02*this._cupLift;
    for(let i=0;i<arms.length;i++) {
      const arm=arms[i],rest=this.restBoneQuaternions.get(arm.name);
      arm.quaternion.copy(rest);arm.rotateX(pitch);arm.rotateZ(i===0?-roll:roll);
      const angle=rest.angleTo(arm.quaternion);
      if(angle>2.1){const target=arm.quaternion.clone();arm.quaternion.copy(rest).slerp(target,2.1/angle);}
    }
    return true;
  }

  _applySnackArm(dt) {
    if (!this.snackArm || (!this.holdingPose && !this.eatingPose)) return;
    if (this.model.children.some(o => o.userData?.foodPoseProfile && o.userData.foodPoseProfile !== 'cupped')) return;
    const cup=this.model.children.find(o=>o.userData?.sharedPlayFood&&o.userData.playTwoHanded);
    if(cup&&this._applyCupArms(dt))return;
    const arm = this.snackArm;
    this._snackBase = { q: arm.quaternion.clone(), p: arm.position.clone() };
    if (this.eatingPose) this._snackElapsed += dt;
    const t = this.eatingPose ? Math.min(1, this._snackElapsed / 0.4) : 0;
    const lift = t * t * (3 - 2 * t);
    const bite = this.eatingPose ? Math.sin(this._snackElapsed * Math.PI * 6) * 0.05 * lift : 0;
    arm.rotateX(-0.9 - 0.6 * lift + bite);
    arm.rotateZ(0.35 * lift);
    arm.position.y += 0.018 * lift;
    arm.position.z += 0.045 * lift;
    const rest = this.restBoneQuaternions.get('armR');
    const angle = rest ? rest.angleTo(arm.quaternion) : 0;
    if (angle > 1.35) {
      const target = arm.quaternion.clone();
      arm.quaternion.copy(rest).slerp(target, 1.35 / angle);
    }
  }

  update({ feet, yaw, moving, facingYaw = null, speed = null, paused, dt }) {
    if (this.disposed) return;
    // 外层位置只从脚点导出；非法 dt 直接丢弃，不进 mixer、不进位置
    if (dt !== undefined && (!Number.isFinite(dt) || dt < 0)) return;
    this.root.position.set(feet[0], feet[1] - this.modelMinY, feet[2]);
    // 朝向只由实际位移方向更新；未动过时以首次出现的视角方向为初始朝向并锁定，
    // 此后静止/暂停/鼠标空转一律保留（facingYaw null 不回退到当前视角）
    if (facingYaw !== null && Number.isFinite(facingYaw)) this.facingYaw = facingYaw;
    else if (this.facingYaw === null) this.facingYaw = Number.isFinite(yaw) ? yaw : 0;
    this.root.rotation.y = avatarYawFor(this.facingYaw);
    if (!paused) {
      this._restoreSnackArm();
      this.mixer.update(dt);
      this._tickExpression(dt);
      const want = this.eatingPose && this.actions.eat ? 'eat' : (moving ? 'walk' : 'idle');
      if (want !== this.current) {
        this.actions[this.current]?.setEffectiveWeight(0);
        this.actions[want].setEffectiveWeight(1);
        this.current = want;
      }
      this._applySnackArm(dt);
      this._syncSnackGrip();
    }
    const ts = speed === null || !Number.isFinite(speed) || speed <= 0
      ? 1
      : speed / this.walkCycleSpeed;
    this.actions.walk.timeScale = ts;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.artFinish?.dispose();
    this.releaseSnackSkin();   // 归还手持克隆；原 geometry 留给下方遍历释放
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    // Food meshes belong to the catalog even when parented to this skeleton.
    const sharedAttachments = [];
    this.model.traverse(o => { if (o.userData?.sharedPlayFood) sharedAttachments.push(o); });
    for (const o of sharedAttachments) o.removeFromParent();
    // free every GPU resource owned by THIS glTF scene (the GLB is exclusively
    // ours); shared/static resources live elsewhere and are never touched here
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
    const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'emissiveMap', 'alphaMap', 'specularMap', 'bumpMap', 'displacementMap', 'lightMap'];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) geometries.add(o.geometry);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        materials.add(m);
        for (const k of TEX_KEYS) if (m[k] && m[k].isTexture) textures.add(m[k]);
      }
      if (o.isSkinnedMesh && o.skeleton) skeletons.add(o.skeleton);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    for (const s of skeletons) s.dispose?.();
    this.root.removeFromParent();
  }
}
