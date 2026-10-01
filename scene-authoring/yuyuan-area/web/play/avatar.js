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

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {
      idle: this.mixer.clipAction(clips.get('idle')),
      walk: this.mixer.clipAction(clips.get('walk')),
      eat: clips.has('eat') ? this.mixer.clipAction(clips.get('eat')) : null,
    };
    this.current = 'idle';
    this.actions.idle.setEffectiveWeight(1).play();
    this.actions.walk.setEffectiveWeight(0).play();
    this.disposed = false;
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
      this.mixer.update(dt);
      const want = moving ? 'walk' : 'idle';
      if (want !== this.current) {
        this.actions[this.current]?.setEffectiveWeight(0);
        this.actions[want].setEffectiveWeight(1);
        this.current = want;
      }
    }
    const ts = speed === null || !Number.isFinite(speed) || speed <= 0
      ? 1
      : speed / this.walkCycleSpeed;
    this.actions.walk.timeScale = ts;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
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
