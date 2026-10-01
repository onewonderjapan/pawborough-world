// Play-phase 1 gray-cat avatar wrapper. Owns the GLTF scene (5 skinned meshes
// + 12-bone skin), the AnimationMixer and the idle/walk action pair.
//
// Contract (GOAL.md 动作与相机):
//   - the wrapper's world position is derived ONLY from the controller feet:
//     root.position = feet - modelMinY (modelMinY from the real loaded
//     geometry). Animation can never move the wrapper — clips' root
//     translation tracks are constant zero (pinned by
//     tests/play_asset_contract.test.mjs) and the mixer is frozen while paused.
//   - the model's face is +Z (asset contract), the controller forward is
//     (-sin yaw, 0, -cos yaw); root.rotation.y = avatarYawFor(yaw) = yaw + PI
//     aligns the two, so the cat never walks backwards.
//   - walk/idle follows the ACTUAL corrected displacement flag from the
//     physics chain (web/walk.js play tick): a wall-blocked capsule reports
//     moving=false and the cat settles into idle instead of sliding its feet.
//     Walk playback rate follows the actual speed (speed / walkCycleSpeed).
//   - illegal dt (NaN/negative) never propagates.
import * as THREE from 'three';

// The GLB's face direction in model space (nose/mouth meshes sit at +Z).
export const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
// Wrapper yaw that points MODEL_FORWARD along the WalkController forward.
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

  update({ feet, yaw, moving, speed = null, paused, dt }) {
    if (this.disposed) return;
    // 外层位置只从脚点导出；非法 dt 直接丢弃，不进 mixer、不进位置
    if (dt !== undefined && (!Number.isFinite(dt) || dt < 0)) return;
    this.root.position.set(feet[0], feet[1] - this.modelMinY, feet[2]);
    this.root.rotation.y = avatarYawFor(yaw);
    if (!paused) this.mixer.update(dt);
    const want = moving ? 'walk' : 'idle';
    if (want !== this.current) {
      this.actions[this.current]?.setEffectiveWeight(0);
      this.actions[want].setEffectiveWeight(1);
      this.current = want;
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
    this.root.removeFromParent();
  }
}
