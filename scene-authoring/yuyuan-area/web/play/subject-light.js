import * as THREE from 'three';

/**
 * U04: 夜景角色与食物补光小样 (Actor & Food Subject Lighting)
 *
 * 根验收退回有限修正：
 * 1. 柔和可读参数：
 *    - front: intensity 1.4, localOffset [.45, 1.05, .95], distance 2.8, color #ffe4c4
 *    - rim: intensity 0.8, localOffset [-.75, .85, -.85], distance 2.5, color #d1dbe6
 *    - weights: day 0.0, dusk 0.35, night 1.0
 * 2. 缓存 actor 引用，避免每 tick 遍历整棵城市树；仅在有效挂载在 scene 上时复用；
 *    无 actor 时低频查找 (<= 2 次/秒)，不累加对象；卸载/换场景清空引用。
 * 3. 增加 isActive 回调 (集成 walk gating)，非 walk 模式立刻 disable。
 */

export const SUBJECT_LIGHT_DEFAULTS = {
  front: {
    name: 'play-subject-light-front',
    color: '#ffe4c4',
    intensity: 1.4,
    distance: 2.8,
    decay: 2.0,
    localOffset: [0.45, 1.05, 0.95],
  },
  rim: {
    name: 'play-subject-light-rim',
    color: '#d1dbe6',
    intensity: 0.8,
    distance: 2.5,
    decay: 2.0,
    localOffset: [-0.75, 0.85, -0.85],
  },
  weights: {
    day: 0.0,
    dusk: 0.35,
    night: 1.0,
  },
};

export function createSubjectLight({
  scene,
  config = SUBJECT_LIGHT_DEFAULTS,
  isActive = () => true,
}) {
  const cfg = {
    ...SUBJECT_LIGHT_DEFAULTS,
    ...(config || {}),
    front: { ...SUBJECT_LIGHT_DEFAULTS.front, ...(config?.front || {}) },
    rim: { ...SUBJECT_LIGHT_DEFAULTS.rim, ...(config?.rim || {}) },
    weights: { ...SUBJECT_LIGHT_DEFAULTS.weights, ...(config?.weights || {}) },
  };

  const frontLight = new THREE.PointLight(
    cfg.front.color,
    0,
    cfg.front.distance,
    cfg.front.decay
  );
  frontLight.name = cfg.front.name;
  frontLight.castShadow = false;
  frontLight.visible = false;

  const rimLight = new THREE.PointLight(
    cfg.rim.color,
    0,
    cfg.rim.distance,
    cfg.rim.decay
  );
  rimLight.name = cfg.rim.name;
  rimLight.castShadow = false;
  rimLight.visible = false;

  scene.add(frontLight, rimLight);

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _off1 = new THREE.Vector3(...cfg.front.localOffset);
  const _off2 = new THREE.Vector3(...cfg.rim.localOffset);

  let curPreset = null;
  let weight = 0.0;
  let active = false;

  // 缓存引用与低频查找机制
  let cachedActor = null;
  let lastLookupTime = -Infinity;
  const LOOKUP_INTERVAL_MS = 500; // 低频 <= 2次/秒
  let lookupCount = 0;

  function isActorValid(obj) {
    if (!obj || !obj.parent) return false;
    let curr = obj;
    while (curr.parent) {
      curr = curr.parent;
      if (curr === scene) return true;
    }
    return false;
  }

  function getActor(now = performance.now()) {
    if (cachedActor) {
      if (isActorValid(cachedActor)) {
        return cachedActor;
      }
      cachedActor = null;
    }

    if (now - lastLookupTime < LOOKUP_INTERVAL_MS) {
      return null;
    }

    lastLookupTime = now;
    lookupCount++;
    const found = scene.getObjectByName('play-gray-cat');
    if (found && isActorValid(found)) {
      cachedActor = found;
      return cachedActor;
    }
    return null;
  }

  function setPreset(name, presetData = null) {
    curPreset = name;
    if (!name || name === 'day') {
      weight = 0.0;
    } else if (cfg.weights[name] !== undefined) {
      weight = cfg.weights[name];
    } else if (name === 'dusk') {
      weight = 0.35;
    } else if (name === 'night') {
      weight = 1.0;
    } else {
      weight = 0.0;
    }

    frontLight.intensity = cfg.front.intensity * weight;
    rimLight.intensity = cfg.rim.intensity * weight;

    if (weight <= 0) {
      frontLight.visible = false;
      rimLight.visible = false;
      active = false;
    }
  }

  function tick(now = performance.now()) {
    // 门控检查：非 walk 模式或无权重时立即停用
    if (!isActive() || weight <= 0) {
      if (frontLight.visible || rimLight.visible) {
        frontLight.visible = false;
        rimLight.visible = false;
      }
      active = false;
      return;
    }

    const cat = getActor(now);
    if (!cat || !cat.visible) {
      if (frontLight.visible || rimLight.visible) {
        frontLight.visible = false;
        rimLight.visible = false;
      }
      active = false;
      return;
    }

    cat.updateMatrixWorld();
    _v1.copy(_off1);
    cat.localToWorld(_v1);
    frontLight.position.copy(_v1);

    _v2.copy(_off2);
    cat.localToWorld(_v2);
    rimLight.position.copy(_v2);

    frontLight.visible = true;
    rimLight.visible = true;
    active = true;
  }

  function configure(newConfig) {
    if (!newConfig) return;
    if (newConfig.front) Object.assign(cfg.front, newConfig.front);
    if (newConfig.rim) Object.assign(cfg.rim, newConfig.rim);
    if (newConfig.weights) Object.assign(cfg.weights, newConfig.weights);

    if (cfg.front.color) frontLight.color.set(cfg.front.color);
    if (cfg.front.distance !== undefined) frontLight.distance = cfg.front.distance;
    if (cfg.front.decay !== undefined) frontLight.decay = cfg.front.decay;
    if (cfg.front.localOffset) _off1.set(...cfg.front.localOffset);

    if (cfg.rim.color) rimLight.color.set(cfg.rim.color);
    if (cfg.rim.distance !== undefined) rimLight.distance = cfg.rim.distance;
    if (cfg.rim.decay !== undefined) rimLight.decay = cfg.rim.decay;
    if (cfg.rim.localOffset) _off2.set(...cfg.rim.localOffset);

    if (curPreset) setPreset(curPreset);
  }

  function dispose() {
    cachedActor = null;
    scene.remove(frontLight, rimLight);
    frontLight.dispose?.();
    rimLight.dispose?.();
  }

  function state() {
    return {
      preset: curPreset,
      weight,
      active,
      lookupCount,
      hasCachedActor: !!cachedActor,
      front: {
        visible: frontLight.visible,
        intensity: frontLight.intensity,
        color: '#' + frontLight.color.getHexString(),
        position: frontLight.position.toArray(),
      },
      rim: {
        visible: rimLight.visible,
        intensity: rimLight.intensity,
        color: '#' + rimLight.color.getHexString(),
        position: rimLight.position.toArray(),
      },
    };
  }

  return {
    setPreset,
    configure,
    tick,
    dispose,
    state,
    lights: [frontLight, rimLight],
    getLookupCount: () => lookupCount,
    getCachedActor: () => cachedActor,
  };
}
