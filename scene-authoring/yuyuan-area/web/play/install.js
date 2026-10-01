// Play-phase 1 entry (?play=1): wires the playable gray-cat onto the area
// viewer. Default page behavior is untouched — installPlayMode runs only when
// the play flag is set, and everything it adds is additive.
//
// Split for testability:
//   - createPlayCore(): DOM-free state + decision core (node-tested in
//     tests/play_entry.test.mjs): profile constants, avatar state machine,
//     asset-failure messaging, read-only status assembly.
//   - installPlayMode(): the browser shell around it (GLTFLoader load of the
//     real character.glb + sha256 verify, third-person Rapier castRay that
//     excludes the player's own capsule, HUD wiring, auto-enter after the
//     world is ready). No placeholder mesh is ever spawned — a missing/broken
//     asset is a visible Chinese failure message, and play is not entered.
import RAPIER from '@dimforge/rapier3d-compat';
import { PlaySession } from './session.js';
import { PlayCamera } from './camera.js';
import { PlayAvatar } from './avatar.js';
import { installPlayHud } from './hud.js';

// GOAL.md play capsule/speed: r=0.28 / halfHeight=0.20 / eye=0.80 / 1.5 m/s.
// Viewer defaults (0.35/0.6/1.6, 2.2 m/s) live in web/walk.js and stay put.
export const PLAY_PROFILE = {
  capsule: { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8 },
  speed: 1.5,
  autostep: 0.15,
  shoulderHeight: 0.62,
  cameraDistance: 2.4,
  // R1（review R0-1）：相机被墙压到该距离以下时隐藏角色本体（不移动玩家物理位置）
  avatarHideDistance: 0.8,
};

// 中文失败说明（可恢复）：资产缺失/校验不符时给玩家看得懂的指引。
export function assetFailureMessage(detail) {
  return `灰猫角色未能加载：${detail}。`
    + '请按 README「play 模式与角色资产」一节恢复 resources/characters/gray-cat/character.glb 后刷新页面；'
    + '页面不会用占位模型代替角色。';
}

// DOM-free play core: owns the session, avatar state and read-only status.
export function createPlayCore({ manifest = null } = {}) {
  const state = {
    ready: false,
    assetError: null,
    assetSha256: manifest?.sha256 ?? null,
    actorId: manifest?.actorId ?? 'gray-cat',
    animation: 'idle',
    entered: false,
  };
  const session = new PlaySession();
  const core = {
    session,
    state,
    profile: PLAY_PROFILE,
    attachAvatar(avatar) {
      if (!avatar || !(avatar.root)) throw new Error('play core: avatar required');
      // 角色参与当前阴影投射/接收（沿用场景灯光预设；不改灯光/材质/资产）
      avatar.model?.traverse?.((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      state.avatar = avatar;
      state.ready = true;
    },
    failAsset(detail) {
      state.assetError = assetFailureMessage(detail);
      return state.assetError;
    },
    // walk.js play tick 每帧回调；paused 时冻结动画（mixer 不推进）。
    // R1（review R0-4）：速度/朝向用 tick 实测值（实际校正水平速度/位移方向），
    // 老调用方不带 telemetry 时回退到标称 play 速度。
    onFrame({ feet, yaw, moving, actualSpeed, facingYaw = null, paused, dt }) {
      const avatar = state.avatar;
      if (!avatar) return;
      const speed = actualSpeed === undefined ? (moving ? PLAY_PROFILE.speed : null)
        : (moving ? actualSpeed : null);
      avatar.update({ feet, yaw, moving, facingYaw, speed, paused, dt });
      state.animation = moving ? 'walk' : 'idle';
    },
    // 只读检查钩子（window.__play.status），主控真浏览器复验用；facing 为人物
    // 朝向（实际位移方向，非视角 yaw），供 R1 朝向解耦复验。
    status({ walkMode = 'orbit', controller = null, cameraMode } = {}) {
      const cam = cameraMode ?? (walkMode === 'walk' ? 'third-person' : 'orbit');
      return {
        ready: state.ready,
        actorId: state.actorId,
        assetSha256: state.assetSha256,
        mode: walkMode === 'walk' ? 'play' : 'orbit',
        paused: session.paused,
        feet: controller ? controller.feetPosition() : null,
        yaw: controller ? controller.yaw : null,
        facing: state.avatar ? state.avatar.facingYaw : null,
        animation: state.animation,
        cameraMode: cam,
        assetError: state.assetError,
      };
    },
  };
  return core;
}

// Browser shell. scene/camera/renderer/controls come from main.js.
export function installPlayMode({ scene, camera, renderer, controls, manifest = null }) {
  const core = createPlayCore({ manifest });
  const playCamera = new PlayCamera({
    camera,
    shoulderHeight: PLAY_PROFILE.shoulderHeight,
    distance: PLAY_PROFILE.cameraDistance,
  });
  let manifestLoaded = manifest ? Promise.resolve(manifest) : null;

  // ---- HUD（web/play/hud.js 负责全部 DOM） ----
  const hud = installPlayHud({ core });

  // ---- 第三人称射线：真实 Rapier 世界，排除玩家自己的胶囊（不误撞自身） ----
  const castRay = (origin, dir, maxToi) => {
    const walk = window.__walk;
    const world = walk?.zonePhysics?.physics?.world;
    if (!world) return null;
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z });
    // 签名与 web/walk.js groundY 相同：第 6 参排除自己的角色胶囊
    const exclude = walk?.controller?.collider ?? undefined;
    const hit = world.castRay(ray, maxToi, true, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  };

  const profile = {
    ...PLAY_PROFILE,
    session: core.session,
    onEnter: ({ outcome }) => {
      core.state.entered = true;
      hud.setPaused(core.session.paused);
      // R1：HUD 面向玩家措辞，不露 actorId 等技术词
      hud.message(outcome?.restored ? '灰猫回到上次的位置和朝向' : '灰猫已就位');
    },
    onPauseChange: (paused) => hud.setPaused(paused),
    onFrame: (info) => core.onFrame(info),
    // R1（review R0-1）：相机被近墙压到 avatarHideDistance 以下时隐藏角色本体
    //（遮挡安全优先于舒服下限，相机可缩到很小距离）；只影响显示，不动玩家物理位置。
    updateCamera: ({ camera, controller, dt }) => {
      const place = playCamera.update({ controller, castRay, dt });
      const avatar = core.state.avatar;
      if (avatar) avatar.root.visible = !place || place.applied >= PLAY_PROFILE.avatarHideDistance;
      return place;
    },
  };

  // ---- 资产加载：真实 GLB + SHA256 校验；失败 = 中文说明，不进 play、无占位模型 ----
  async function loadAvatar() {
    try {
      if (!manifestLoaded) {
        manifestLoaded = fetch('/inputs/play-character.json').then(r => {
          if (!r.ok) throw new Error(`inputs/play-character.json: ${r.status}`);
          return r.json();
        });
      }
      const m = await manifestLoaded;
      core.state.assetSha256 = m.sha256;
      core.state.actorId = m.actorId;
      const res = await fetch('/' + m.path);
      if (!res.ok) throw new Error(`/${m.path} 返回 ${res.status}`);
      const buf = await res.arrayBuffer();
      if (crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (sha !== m.sha256) throw new Error(`SHA256 校验不符（${sha.slice(0, 12)}… ≠ 期望 ${m.sha256.slice(0, 12)}…）`);
      }
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
      const avatar = new PlayAvatar({ gltfScene: gltf.scene, animations: gltf.animations });
      scene.add(avatar.root);
      core.attachAvatar(avatar);
      hud.assetsReady(m.actorId);
    } catch (e) {
      console.error('play asset failed', e);
      hud.showAssetError(core.failAsset(e?.message || String(e)));
    }
  }
  loadAvatar();

  // ---- 世界+资产就绪后自动进入 play（资产失败则留在取景，只给错误说明） ----
  const waitReady = setInterval(() => {
    if (!window.__ready || !window.__walk) return;
    if (!core.state.ready) {
      if (!core.state.assetError) return;   // 资产仍在加载
      clearInterval(waitReady);             // 资产失败：不进入，错误已展示
      return;
    }
    clearInterval(waitReady);
    window.__walk.enter().catch(e => console.error('play autostart failed', e));
  }, 200);

  function bind({ walk }) {
    // HUD 按钮走 window.__walk 的完整 API（pause/resume/enter/exit 都挂在那里），
    // main.js 传入的 walk 句柄只有 tick/mode/addCollisionZone。
    hud.bind({ walk: window.__walk ?? walk });
  }

  function status() {
    const walk = window.__walk;
    return core.status({
      walkMode: walk ? walk.mode() : 'orbit',
      controller: walk?.controller ?? null,
      cameraMode: walk?.mode() === 'walk' ? 'third-person' : 'orbit',
    });
  }

  return { profile, core, bind, status, playCamera };
}
