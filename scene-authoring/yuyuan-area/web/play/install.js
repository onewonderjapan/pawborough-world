// Play entry (?play=1) — 小吃工单 20261001 总装。
// 玩法闭环：更快移动（走 2.6 / Shift 跑 4.2）→ 小地图 + 目标 HUD → 三摊位
// E 取食 / F 进食 / 集章 → R 自行车（同世界、方向性碰撞体、安全上下车）→
// 版本化存档（动作完成/暂停自动存，位置节流）。
//
// 分层（与 web/play/* 一致）：
//   - DOM-free 决策：state.js / stalls.js / interaction.js / vehicle.js /
//     map-core.js（节点测试直接驱动，见 tests/play_* ）
//   - 浏览器壳：本文件 + hud.js / minimap.js / foods.js / bike-view.js
// 默认页面行为不动：installPlayMode 只在 ?play=1 安装，全部叠加式。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PlaySession } from './session.js';
import { PlayCamera } from './camera.js';
import { PlayAvatar } from './avatar.js';
import { installPlayHud } from './hud.js';
import { installPlayMap } from './minimap.js';
import { PlayGameState, FOODS, STORAGE_KEY, validateSave } from './state.js';
import { deriveStallTargets, chooseReachable } from './stalls.js';
import { loadFoodCatalog } from './foods.js';
import { RideController, pickDismountSpot } from './vehicle.js';
import { canTakeNow, takeFailHint, computeHint, TAKE_RADIUS_M, MOUNT_RADIUS_M, nearestStall } from './interaction.js';
import { loadBikeRig, BikeView, applyRiderPose } from './bike-view.js';
import { createClosedFacades, closedFacadeHint } from './closed-facades.js';

// GOAL.md play capsule/speed (小吃工单 20261001): r=0.28 / halfHeight=0.20 /
// eye=0.80 / walk 2.6 m/s / Shift run 4.2 m/s. Bike cruise/max ride speeds live
// here too so tests and HUD read one profile. Viewer defaults (0.35/0.6/1.6,
// 2.2 m/s) live in web/walk.js and stay put.
export const PLAY_PROFILE = {
  capsule: { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8 },
  walkSpeed: 2.6,
  runSpeed: 4.2,
  speed: 2.6,              // legacy alias = walk speed (install wiring + onFrame fallback)
  autostep: 0.15,
  shoulderHeight: 0.62,
  cameraDistance: 2.4,
  rideShoulderHeight: 1.02,
  rideCameraDistance: 3.3,
  // R1（review R0-1）：相机被墙压到该距离以下时隐藏角色本体（不移动玩家物理位置）
  avatarHideDistance: 0.8,
  rideAvatarHideDistance: 1.15,
  // 骑车（GOAL.md 自行车）：巡航 5.5，Shift 最高 7
  bikeCruise: 5.5,
  bikeMax: 7.0,
};

// 中文失败说明（可恢复）：资产缺失/校验不符时给玩家看得懂的指引。
export function assetFailureMessage(detail) {
  return `灰猫角色未能加载：${detail}。`
    + '请按 README「play 模式与角色资产」一节恢复 resources/characters/gray-cat/character.glb 后刷新页面；'
    + '页面不会用占位模型代替角色。';
}
export function foodFailureMessage(detail) {
  return `小吃模型未能加载：${detail}。`
    + '请按 inputs/play-foods.json 恢复 resources/foods/handheld/ 下三份 GLB 后刷新；取食/集章暂不可用，走路和小地图不受影响。';
}
export function vehicleFailureMessage(detail) {
  return `自行车未能加载：${detail}。借车点暂不可用，步行逛吃不受影响。`;
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
      state.animation = avatar.current ?? (moving ? 'walk' : 'idle');
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

// readJson helper（/out 与 /inputs 都由 scripts/server.mjs 提供）
async function readJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// Browser shell. scene/camera/renderer/controls come from main.js.
export function installPlayMode({ scene, camera, renderer, controls, manifest = null }) {
  let startupNotice = null;
  const core = createPlayCore({ manifest });
  const playCamera = new PlayCamera({
    camera,
    shoulderHeight: PLAY_PROFILE.shoulderHeight,
    distance: PLAY_PROFILE.cameraDistance,
    margin: 0.20, // 闭门门框比原墙面前伸最多 0.19m，镜头保留相应余量
  });
  let manifestLoaded = manifest ? Promise.resolve(manifest) : null;

  // ---- 玩法状态（唯一 owner：手里/嘴里/集章/目标/车） ----
  const gameState = new PlayGameState();
  let saveThrottle = 0;
  const storage = () => window.localStorage;
  function saveNow() {
    const walk = window.__walk;
    const ctl = rideCtl ?? walk?.controller;
    if (!ctl) return;
    try {
      storage().setItem(STORAGE_KEY, JSON.stringify(gameState.toSave({
        feet: ctl.feetPosition(),
        yaw: rideCtl ? ctl.yaw : (walk?.controller?.yaw ?? 0),      // 视角
        pitch: rideCtl ? (ctl.pitch ?? 0) : (walk?.controller?.pitch ?? 0),
      })));
      // 车辆航向/视角由 toSave 从 gameState.vehicle 取（frameGame 每帧同步）
    } catch { /* 存储满/禁用：不影响玩法 */ }
  }
  gameState.onChange((evt) => {
    if (evt.type === 'stamped' || evt.type === 'eaten') {
      hud.renderGoal(goalView());
      saveNow();
    }
  });
  function goalView() {
    if (gameState.complete) return { complete: true, foods: gameState.foods, tasted: gameState.tasted };
    const goal = gameState.goal();
    return { complete: false, foods: gameState.foods, tasted: gameState.tasted, goal };
  }

  // ---- HUD（web/play/hud.js 负责全部 DOM） ----
  const hud = installPlayHud({ core, state: gameState });

  // ---- 小地图（右上，真实 layout 底图） ----
  const minimap = installPlayMap();

  // ---- 射线/形状查询（R0-5 共用件） ----
  // rapier3d-compat 签名：castRay(ray, maxToi, solid, flags, groups,
  //   excludeCollider, excludeRigidBody, filterPredicate)；谓词 = 传入 true 才检测。
  const worldNow = () => window.__walk?.zonePhysics?.physics?.world ?? null;
  const groundCollidersNow = () => window.__walk?.zonePhysics?.groundColliders ?? [];
  let groundKey = '';
  let groundHandles = new Set();
  const groundHandlesNow = () => {
    const list = groundCollidersNow();
    const key = list.map(c => c.handle).join(',');
    if (key !== groundKey) { groundHandles = new Set(list.map(c => c.handle)); groundKey = key; }
    return groundHandles;
  };
  const playerHandles = () => {
    const s = new Set();
    const w = window.__walk?.controller?.collider; if (w) s.add(w.handle);
    if (rideCtl?.collider) s.add(rideCtl.collider.handle);
    return s;
  };
  // 第三人称相机遮挡射线：排除玩家/车（墙才挡相机）
  const castRay = (origin, dir, maxToi) => {
    const world = worldNow();
    if (!world) return null;
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z });
    const exclude = playerHandles();
    const hit = world.castRay(ray, maxToi, true, undefined, undefined,
      undefined, undefined, (c) => !exclude.has(c.handle));
    return hit ? hit.timeOfImpact : null;
  };
  // 支撑面查询（R0-5）：只认已登记 groundColliders——墙顶/柜台顶不算 ground。
  // 所有取地面/停车/下车/存档校验共用这一个过滤器。
  function supportAt(x, z, fromY = 8, maxToi = 12) {
    const world = worldNow();
    if (!world) return null;
    const gh = groundHandlesNow();
    if (!gh.size) return null;
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, maxToi, true, undefined, undefined,
      undefined, undefined, (c) => gh.has(c.handle));
    return hit ? fromY - hit.timeOfImpact : null;
  }
  // 墙重叠检查：排除玩家/车自身与地面碰撞体（不抹掉真正墙体，R0-5）。
  // 无世界时返回 true（视作被挡，调用方各自兜底）。
  function wallOverlap(x, y, z, shape, yaw = 0) {
    const world = worldNow();
    if (!world) return true;
    const gh = groundHandlesNow();
    const excl = playerHandles();
    return !!world.intersectionWithShape(
      { x, y, z }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, shape,
      undefined, undefined, undefined, undefined,
      (c) => c.handle !== undefined && !gh.has(c.handle) && !excl.has(c.handle));
  }
  // 玩家脚点是否踩在可靠支撑面上（E 资格/存档恢复共用）
  function feetSupported(feet, tol = 0.35) {
    const gy = supportAt(feet[0], feet[2]);
    const centerOffset = PLAY_PROFILE.capsule.radius + PLAY_PROFILE.capsule.halfHeight;
    return gy !== null && Math.abs(gy - feet[1]) <= tol
      && !wallOverlap(feet[0], feet[1] + centerOffset, feet[2], capsuleShape());
  }

  // ---- 资产：角色 + 三味小吃 + 自行车（真实 GLB + SHA256 校验） ----
  const profile = {
    ...PLAY_PROFILE,
    session: core.session,
    onEnter: ({ outcome }) => {
      core.state.entered = true;
      gameState.playing = true;
      gameState.paused = core.session.paused;
      hud.setPaused(core.session.paused);
      hud.renderGoal(goalView());
      // R1：HUD 面向玩家措辞，不露 actorId 等技术词
      hud.message(startupNotice ?? (outcome?.restored ? '灰猫回到上次的位置和朝向' : '灰猫已就位，去尝遍三味吧'));
      startupNotice = null;
      saveNow();
    },
    onPauseChange: (paused) => {
      hud.setPaused(paused);
      gameState.paused = paused;
      // 车控制器与步行控制器同进退：暂停清键/清累计器，恢复从干净输入开始
      if (paused) { rideCtl?.pause?.(); saveNow(); }
      else rideCtl?.resume?.();
    },
    onFrame: (info) => {
      core.onFrame(info);
      frameGame(info);
    },
    // R1（review R0-1）：相机被近墙压到 avatarHideDistance 以下时隐藏角色本体
    //（遮挡安全优先于舒服下限，相机可缩到很小距离）；只影响显示，不动玩家物理位置。
    updateCamera: ({ camera: cam, controller, dt }) => {
      const place = playCamera.update({ controller, castRay, dt });
      const avatar = core.state.avatar;
      if (avatar) {
        const limit = gameState.vehicle.riding ? PLAY_PROFILE.rideAvatarHideDistance : PLAY_PROFILE.avatarHideDistance;
        avatar.root.visible = !place || place.applied >= limit;
        if (bikeView && gameState.vehicle.riding) bikeView.root.visible = avatar.root.visible;
      }
      return place;
    },
    // walk.js 路由钩子：骑乘时返回车控制器（唯一活动位移权威）
    moveController: () => rideCtl,
    riding: () => gameState.vehicle.riding,
    movementLocked: () => gameState.busyEating,
  };

  // ---- 资产加载：角色（失败不进 play） + 小吃/车（失败降级为步行逛吃） ----
  async function loadAvatar() {
    try {
      if (!manifestLoaded) {
        manifestLoaded = readJson('/inputs/play-character.json');
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

  // ---- 玩法子系统的懒加载（layout/food-sockets/小吃/车；互不阻塞入场） ----
  const stalls = [];            // stalls.js 派生目标（含顾客点/朝向/候选）
  let foods = null;             // FoodCatalog
  let bikeView = null;          // BikeView（车网格 + 轮转）
  let rideCtl = null;           // RideController（骑乘时的位移权威）
  window.addEventListener('pb:mode', ({ detail }) => {
    if (detail?.mode !== 'orbit') return;
    if (core.state.avatar) core.state.avatar.root.visible = true;
    if (bikeView) bikeView.root.visible = true;
  });
  let pendingSave = null;       // 存档恢复（入场后应用）
  let bikePlaced = false;
  let placedMarker = null;      // 目标世界小标记

  // ---- 闭门叠加层（工单 C）：不可进入的展示门面第一眼看出关门 ----
  // 懒加载失败不假报 ready、不影响步行；owner 负责几何/材质/贴图释放。
  let facadesHintAt = 0;
  const closedFacades = createClosedFacades({
    scene,
    onHint: (msg) => {
      const now = performance.now();
      if (now - facadesHintAt < 8000) return;   // 提示节流，别刷屏
      facadesHintAt = now;
      hud.message(msg);
    },
  });
  closedFacades.install();

  (async () => {
    const [layout, sockets] = await Promise.all([
      readJson('/out/layout.json'),
      readJson('/out/food-sockets.json'),
    ]);
    for (const t of deriveStallTargets(layout, sockets, FOODS)) stalls.push(t);
    minimap.setGeometry(layout);
    // 陈列：真实小吃摆在托盘（真实 socket 世界位；共享同一目录资源）
    foods = await loadFoodCatalog({ foods: FOODS, manifest: await readJson('/inputs/play-foods.json') });
    for (const t of stalls) {
      const inst = foods.makeDisplay(t.foodId);
      inst.position.set(t.tray.x, t.tray.y, t.tray.z);
      inst.rotation.y = -t.tray.rotY;      // layout rotY（Z-up 语义）→ GLB 世界系修正
      scene.add(inst);
      t.display = inst;
    }
    // 车网格（失败只降级借车功能）
    try {
      const vm = await readJson('/inputs/play-vehicle.json');
      const rig = await loadBikeRig({ manifest: vm.vehicle });
      bikeView = new BikeView(rig);
      scene.add(bikeView.root);
    } catch (e) {
      console.error('play vehicle failed', e);
      hud.message(vehicleFailureMessage(e?.message || String(e)));
    }
    // 目标小标记（世界内，指当前目标摊位）
    placedMarker = makeTargetMarker();
    scene.add(placedMarker);
    hud.renderGoal(goalView());
  })().catch((e) => {
    console.error('play game assets failed', e);
    hud.message(foodFailureMessage(e?.message || String(e)));
  });

  // ---- 存档恢复（入场时应用；坏档/无支撑/墙内位置回安全出生点，R0-5） ----
  try {
    const raw = storage().getItem(STORAGE_KEY);
    if (raw) {
      let parsed = null, parsedOk = false;
      try {
        parsed = JSON.parse(raw);
        parsedOk = true;
      } catch (e) {
        startupNotice = '上次的散步记录有些损坏，已从安全出生点开始';
        storage().removeItem(STORAGE_KEY);
      }
      if (parsedOk) {
        const v = validateSave(parsed, FOODS);
        if (v.ok) {
          gameState.applySave(v.value);
          pendingSave = v.value;
        } else {
          startupNotice = String(v.reason).includes('version')
            ? '这份散步记录属于旧版本，已从安全出生点开始'
            : '上次的散步记录无法读取，已从安全出生点开始';
          storage().removeItem(STORAGE_KEY);
        }
      }
    }
  } catch { /* 其它存储异常同样按坏档处理，不阻塞入场 */ }

  function applyPendingSave() {
    if (!pendingSave) return;
    const walk = window.__walk;
    const controller = walk?.controller;
    const s = pendingSave;
    pendingSave = null;
    let placedFeet = false;
    if (controller && s.feet) {
      // 几何校验（R0-5）：脚点必须踩在已登记支撑面上（不接受空中/墙内位置）
      if (feetSupported(s.feet)) {
        // 显式恢复：session 记录为 explicit relocation，绝不当作走动证据
        core.session.relocate(controller, s.feet, s.yaw ?? 0);
        placedFeet = true;
      } else {
        hud.message('上次的落脚点不在可靠地面上，已回到安全出生点（集章进度保留）');
      }
    }
    if (placedFeet) hud.message('回到上次的散步进度');
    // 手里/车篮的模型恢复（恰好一个实例）
    refreshHeldModel();
    if (gameState.eating) core.state.avatar?.setEatingPose(true, gameState.eating.elapsed);
    hud.renderGoal(goalView());
    // 车的位置/骑乘恢复交给 ensureBikePlaced（物理/bikeView 就绪后按档校验落地）
  }

  // ---- 车：借车站布置（真实支持面 + Rapier 检查，R0-5）与上/下车 ----
  let standFailAt = null;   // 找不到安全停车点时的提示节流
  function ensureBikePlaced() {
    if (bikePlaced || !bikeView) return;
    const walk = window.__walk;
    if (!walk?.zonePhysics?.physics) return;          // 物理还没建好
    const controller = walk.controller;
    const feet = controller ? controller.feetPosition() : null;
    if (!feet) return;

    // 有存档：按档恢复（位置过几何校验才落地；骑乘档重建唯一车控制器）
    if (gameState.vehicle.placed && gameState.vehicle.pos) {
      const p = gameState.vehicle.pos;
      const gy = bikeGroundY(p, gameState.vehicle.yaw ?? 0);
      if (gy !== null) {
        bikeView.placeAt([p[0], gy, p[2]], gameState.vehicle.yaw ?? 0);
        if (gameState.vehicle.riding) {
          restoreRide([p[0], gy, p[2]], gameState.vehicle.yaw ?? 0, gameState.vehicle.viewYaw ?? 0);
        }
        bikePlaced = true;
        saveNow();
        return;
      }
      hud.message('存档里的自行车位置不安全，已在出生点附近重新借车');
      gameState.vehicle = { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false };
    }

    // 借车站：出生点附近环形找真实支持面（有支撑、无墙交叠）
    const pos = findBikeStand(feet);
    if (!pos) {
      if (!standFailAt || performance.now() - standFailAt > 8000) {
        standFailAt = performance.now();
        hud.message('附近暂时没有安全的借车位置，走到开阔处再试试');
      }
      return;   // 不做无碰撞检查的兜底落点（R0-5）
    }
    bikeView.placeAt([pos[0], pos[1], pos[2]], 0);
    gameState.placeVehicle([pos[0], pos[1], pos[2]], 0);
    bikePlaced = true;
    saveNow();
  }
  const BIKE_RIDE_HALF = [0.34, 0.68, 0.82];
  let _bikeShape = null;
  function bikeShape() {
    if (!_bikeShape) _bikeShape = new RAPIER.Cuboid(...BIKE_RIDE_HALF);
    return _bikeShape;
  }
  function bikeGroundY(pos, heading) {
    const gy = supportAt(pos[0], pos[2]);
    if (gy === null || Math.abs(gy - pos[1]) > 0.35
      || wallOverlap(pos[0], gy + BIKE_RIDE_HALF[1], pos[2], bikeShape(), heading)) return null;
    const [hx, , hz] = BIKE_RIDE_HALF, s = Math.sin(heading), c = Math.cos(heading);
    for (const [dx, dz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [0, -hz], [0, hz]]) {
      const y = supportAt(pos[0] + dx * c + dz * s, pos[2] - dx * s + dz * c);
      if (y === null || Math.abs(y - gy) > 0.16) return null;
    }
    return gy;
  }
  let _capsuleShape = null;
  function capsuleShape() {
    if (!_capsuleShape) _capsuleShape = new RAPIER.Capsule(0.2, 0.28);
    return _capsuleShape;
  }

  // 借车站：出生点附近 1.2–6m 环形找真实支持面（有支撑、车体不与墙交叠）。
  // 找不到安全点返回 null（调用方提示玩家挪步，不落地）。
  function findBikeStand(feet) {
    for (let ring = 0; ring < 4; ring++) {
      const n = 12;
      const r0 = 1.2 + ring * 1.6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.26;
        const x = feet[0] + Math.cos(a) * r0;
        const z = feet[2] + Math.sin(a) * r0;
        const gy = bikeGroundY([x, feet[1], z], 0);
        if (gy === null) continue;
        return [x, gy, z];
      }
    }
    return null;
  }

  // ---- 手持/车篮：恰好一个模型实例（R0-5）——take 创建，上车移入车篮，
  // 下车移回手，吃完摘除销毁引用（共享 geometry/material 由 FoodCatalog 唯一持有） ----
  let heldObj = null;   // { foodId, obj }
  function attachHand(obj) {
    const avatar = core.state.avatar;
    const armR = avatar?.model?.getObjectByName('armR');
    if (!armR) return;
    armR.add(obj);
  }
  function refreshHeldModel() {
    const avatar = core.state.avatar;
    if (!avatar || !foods) return;
    avatar.setHoldingPose(Boolean(gameState.heldItem));
    // 摘掉旧手持容器（不 dispose 共享资源）
    avatar.model.traverse((o) => {
      if (o.name?.startsWith('play-held-')) o.removeFromParent();
    });
    if (heldObj) { heldObj.obj.removeFromParent(); }
    if (gameState.heldItem) {
      const reusable = heldObj?.foodId === gameState.heldItem ? heldObj.obj : null;
      heldObj = { foodId: gameState.heldItem, obj: foods.attachToHand(gameState.heldItem,
        avatar.model.getObjectByName('armR') ?? avatar.model, reusable) };
    } else if (gameState.basketItem && gameState.vehicle.riding && bikeView) {
      // 车篮里的正是同一实例（上车时移入的），不再新建
      if (!heldObj || heldObj.foodId !== gameState.basketItem) {
        heldObj = { foodId: gameState.basketItem, obj: foods.makeHandInstance(gameState.basketItem) };
      }
      bikeView.attachBasket(heldObj.obj);
    } else {
      heldObj = null;
    }
  }

  function toggleVehicle() {
    const walk = window.__walk;
    const controller = walk?.controller;
    if (!walk || !controller || !bikeView || !bikePlaced) {
      if (walk) hud.message(vehicleFailureMessage('车还没就位'));
      return;
    }
    if (gameState.vehicle.riding) { dismount(controller); return; }
    mount(controller);
  }

  function mount(controller) {
    if (gameState.busyEating) { hud.setHint('先吃完手里的再上车'); return; }
    const feet = controller.feetPosition();
    const bike = gameState.vehicle.pos;
    const d = Math.hypot(feet[0] - bike[0], feet[2] - bike[2]);
    if (d > MOUNT_RADIUS_M) { hud.setHint(`走近自行车再按 R（现在 ${d.toFixed(1)}m）`); return; }
    const walk = window.__walk;
    controller.clearKeys();                       // 上车统一清输入（R0-1）
    rideCtl = new RideController({
      RAPIER, physics: walk.zonePhysics.physics,
      cruise: PLAY_PROFILE.bikeCruise, max: PLAY_PROFILE.bikeMax,
      excludeColliderHandles: [window.__walk?.controller?.collider?.handle].filter(Boolean),
      groundColliders: groundCollidersNow,        // R0-2：支撑面只认已登记地面
    });
    // 车头沿用停车 heading；视角保持玩家当前自由视角（R0-1 二者分离）
    rideCtl.teleport([bike[0], bike[1], bike[2]], gameState.vehicle.yaw ?? 0, controller.yaw ?? 0);
    // 上车：持物进车篮（不复制食物，同一实例移入），骑姿接管
    gameState.stowHeldToBasket();
    gameState.setRiding(true);
    refreshHeldModel();
    playCamera.shoulderHeight = PLAY_PROFILE.rideShoulderHeight;
    playCamera.distance = PLAY_PROFILE.rideCameraDistance;
    bikeView.attachRider(core.state.avatar, rideCtl);
    window.dispatchEvent(new CustomEvent('pb:ride-change', { detail: { riding: true } }));
    hud.message('骑上共享自行车（W 加速 · S 刹停后倒车 · Space 刹车 · Shift 冲刺 · A/D 转向 · R 下车 · 鼠标自由看）');
    saveNow();
  }

  // 存档骑乘恢复（R0-5）：重建唯一车控制器/接骑姿和相机，视角与航向按档分离
  function restoreRide(bikePos, heading, viewYaw) {
    const walk = window.__walk;
    const controller = walk?.controller;
    if (!walk?.zonePhysics?.physics || !controller) return false;
    controller.clearKeys();
    rideCtl = new RideController({
      RAPIER, physics: walk.zonePhysics.physics,
      cruise: PLAY_PROFILE.bikeCruise, max: PLAY_PROFILE.bikeMax,
      excludeColliderHandles: [controller?.collider?.handle].filter(Boolean),
      groundColliders: groundCollidersNow,
    });
    rideCtl.teleport(bikePos, heading, viewYaw ?? heading);
    gameState.setRiding(true);
    gameState.setVehicleView(viewYaw ?? heading);
    playCamera.shoulderHeight = PLAY_PROFILE.rideShoulderHeight;
    playCamera.distance = PLAY_PROFILE.rideCameraDistance;
    bikeView.attachRider(core.state.avatar, rideCtl);
    window.dispatchEvent(new CustomEvent('pb:ride-change', { detail: { riding: true, restored: true } }));
    refreshHeldModel();
    hud.message('恢复骑乘（车与位置按上次存档还原）');
    return true;
  }

  function dismount(controller) {
    const feet = rideCtl.feetPosition();
    const heading = rideCtl.heading;
    const viewYaw = rideCtl.yaw;
    // 安全下车点：左/右/后方逐一真实支撑面 + 胶囊墙重叠检查（排除玩家/车，R0-5）
    if (!worldNow()) { hud.setHint('物理世界还没就绪，稍等再下'); return; }
    const shape = capsuleShape();
    const probe = (x, y, z) => {
      const gy = supportAt(x, z);
      if (gy === null || Math.abs(gy - y) > 1.2) return false;
      return !wallOverlap(x, gy + 0.48, z, shape);
    };
    const spot = pickDismountSpot(feet, heading, probe);
    if (!spot) { hud.setHint('周围没有安全下车点，请骑到开阔处再按 R'); return; }
    const bikeFinal = [feet[0], feet[1], feet[2]];
    const speedAtStop = rideCtl.speed;
    rideCtl.dispose();
    rideCtl = null;
    // 车停稳在骑乘结束点（保存物理航向）；玩家落到安全点（视角沿用自由视角）
    gameState.setRiding(false, bikeFinal, heading);
    gameState.setVehicleView(viewYaw);
    controller.teleport(spot.feet, viewYaw, 0);
    bikeView.detachRider(core.state.avatar);
    bikeView.placeAt(bikeFinal, heading);
    playCamera.shoulderHeight = PLAY_PROFILE.shoulderHeight;
    playCamera.distance = PLAY_PROFILE.cameraDistance;
    gameState.takeBackFromBasket();
    refreshHeldModel();
    window.dispatchEvent(new CustomEvent('pb:ride-change', { detail: { riding: false } }));
    hud.message(speedAtStop > 1 ? '已停车下车' : '下车了');
    saveNow();
  }

  // ---- E / F / R 按键（repeat 忽略；暂停/取景不吃键） ----
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const walk = window.__walk;
    if (!walk || walk.mode() !== 'walk') return;
    if (core.session.paused) return;
    if (e.code === 'KeyE') { e.preventDefault(); tryTake(); return; }
    if (e.code === 'KeyF') { e.preventDefault(); tryEat(); return; }
    if (e.code === 'KeyR') { e.preventDefault(); if (!gameState.busyEating) toggleVehicle(); return; }
  });

  function losToStall(stall) {
    const walk = window.__walk;
    const controller = walk?.controller;
    if (!controller) return false;
    const feet = controller.feetPosition();
    const from = new THREE.Vector3(feet[0], feet[1] + 0.55, feet[2]);
    const to = new THREE.Vector3(stall.customerPoint.x, (stall.groundY ?? feet[1]) + 0.8, stall.customerPoint.z);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.3) return true;
    dir.normalize();
    const toi = castRay(from, dir, dist);
    return toi === null || toi >= dist - 0.05;   // 只挡"墙"；顾客点在柜台前，柜台不算隔墙
  }

  function tryTake() {
    if (gameState.vehicle.riding) { hud.setHint('下车再取餐'); return; }
    const walk = window.__walk;
    const controller = walk?.controller;
    if (!controller || !stalls.length) return;
    const feet = controller.feetPosition();
    // E 资格加真实地面/高度门槛（R0-4）：脚点必须踩在已登记支撑面上，
    // 且与顾客点地面高差合理——不能在空中/屋顶/墙顶远程取餐
    const feetGy = supportAt(feet[0], feet[2]);
    if (feetGy === null || Math.abs(feetGy - feet[1]) > 0.35) {
      hud.setHint('脚下没有可靠地面，站稳后再取餐');
      return;
    }
    const result = canTakeNow({ state: gameState, feet, stalls, losCheck: losToStall });
    if (!result.ok) {
      const hint = takeFailHint(result);
      if (hint) hud.setHint(hint);
      return;
    }
    gameState.take(result.foodId);
    refreshHeldModel();
    const food = FOODS.find(f => f.id === result.foodId);
    hud.message(`拿到一份${food.labelZh}（免费试吃）· F 开吃`);
    saveNow();
  }

  function tryEat() {
    if (gameState.vehicle.riding) { hud.setHint('下车再吃，稳当些'); return; }
    const gate = gameState.canEat({});
    if (!gate.ok) {
      if (gate.reason === 'empty-hand') hud.setHint('手上没有小吃，先去摊位按 E 取');
      else if (gate.reason === 'already-eating') hud.setHint('正在吃呢');
      return;
    }
    const walk = window.__walk;
    const controller = walk?.controller;
    if (controller) controller.clearKeys();       // 吃的过程中禁止移动
    gameState.startEat();
    core.state.avatar?.setEatingPose(true);
  }

  // ---- 每帧玩法编排（walk.js play tick → play.onFrame → 这里） ----
  // R0-1：物理步进只在 walk.js 骑乘分支发生（唯一固定步权威）；本函数只做
  // 状态同步、视觉（轮/踏板/骑姿）与玩法计时，绝不再 step 任何控制器。
  function frameGame({ feet, yaw, paused, dt }) {
    const walk = window.__walk;
    const controller = walk?.controller;
    if (!controller) return;
    if (core.state.entered && !pendingSave) ensureBikePlaced();
    applyPendingSaveWhenReady();

    // 骑乘视觉/状态同步（不 step）：轮/踏板按真实校正位移（R0-3）
    if (rideCtl) {
      const pos = rideCtl.feetPosition();
      gameState.moveVehicle(pos, rideCtl.heading);
      gameState.setVehicleView(rideCtl.yaw);
      bikeView.updateRide(pos, rideCtl.heading, rideCtl, paused ? 0 : dt);
      applyRiderPose(core.state.avatar, bikeView, rideCtl.heading);
    }

    // 吃：未暂停帧推进；暂停冻结（不调 eatTick 即不跳时）
    if (gameState.eating && !paused) {
      const r = gameState.eatTick(dt);
      if (r && r.done) {
        core.state.avatar?.setEatingPose(false);
        core.state.avatar?.showSatisfaction();
        refreshHeldModel();                    // 吃完手持模型实际摘除（R0-4）
        const food = FOODS.find(f => f.id === r.foodId);
        hud.message(r.complete
          ? '三味集齐！这条街你吃遍了 🎉'
          : `集齐一枚「${food.labelZh}」章！下一味：${gameState.goal()?.labelZh ?? '—'}`);
      }
    }

    // HUD：目标距离/提示/小地图（目标只导向不传送）
    updateTargetMarker();
    if (gameState.playing) {
      const near = stalls.length ? nearestStall(stalls, feet) : null;
      const bike = bikePlaced && !gameState.vehicle.riding ? {
        dist: Math.hypot(feet[0] - gameState.vehicle.pos[0], feet[2] - gameState.vehicle.pos[2]),
      } : null;
      const step = rideCtl?.lastStep;
      if (step?.unsupported) hud.setHint('车辆悬在边缘！原地按 R 下车或后退');
      hud.setHint(computeHint({
        state: gameState, feet, stalls,
        bike, riding: gameState.vehicle.riding,
        blockedRatio: step?.blockedRatio ?? 0,
        turnBlocked: step?.turnBlocked ?? false,
        aheadBlocked: step?.aheadBlocked ?? false,
      }));
      renderGoalDistance(feet);
      minimap.update({
        feet, yaw: rideCtl ? rideCtl.yaw : yaw,
        facingYaw: rideCtl ? rideCtl.heading : core.state.avatar?.facingYaw,
        stalls: stalls.map(t => ({ x: t.customerPoint.x, z: t.customerPoint.z, done: gameState.tasted.has(t.foodId) })),
        bike: bikePlaced ? { x: gameState.vehicle.pos[0], z: gameState.vehicle.pos[2], gone: gameState.vehicle.riding } : null,
        targetIndex: gameState.complete ? -1 : stalls.findIndex(t => t.foodId === gameState.goal()?.id),
        complete: gameState.complete,
      });
    }

    // 位置节流保存（动作完成/暂停即时存在 onChange/onPauseChange 里）
    saveThrottle += dt;
    if (saveThrottle > 2.5 && gameState.playing && !gameState.paused) {
      saveThrottle = 0;
      saveNow();
    }
  }

  let goalDistThrottle = 0;
  function renderGoalDistance(feet) {
    goalDistThrottle += 1;
    if (goalDistThrottle % 20 !== 1) return;    // ~1/3 秒一次
    const view = goalView();
    if (view.complete || !view.goal) return;
    const t = stalls.find(s => s.foodId === view.goal.id);
    if (!t) return;
    const d = Math.hypot(feet[0] - t.customerPoint.x, feet[2] - t.customerPoint.z);
    hud.renderGoal({ ...view, distM: d });
  }

  function updateTargetMarker() {
    if (!placedMarker) return;
    if (gameState.complete || !stalls.length) { placedMarker.visible = false; return; }
    const goal = gameState.goal();
    const t = stalls.find(s => s.foodId === goal?.id);
    if (!t) { placedMarker.visible = false; return; }
    placedMarker.visible = true;
    const gy = t.groundY ?? t.tray.y;
    placedMarker.position.set(t.customerPoint.x, gy + 2.1 + Math.sin(performance.now() / 400) * 0.08, t.customerPoint.z);
    t.groundY = t.groundY ?? supportAt(t.customerPoint.x, t.customerPoint.z) ?? gy;
  }

  function applyPendingSaveWhenReady() {
    // 位置恢复只等控制器；车位置若 bikeView 未就绪，ensureBikePlaced 会按
    // vehicle.pos（已恢复进状态）在物理就绪后落地
    if (pendingSave && window.__walk?.controller) applyPendingSave();
  }

  // 目标世界小标记：朱红倒锥 + 金环（纸/墨绿/朱红/金黄 工单气质）
  function makeTargetMarker() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.34, 4),
      new THREE.MeshBasicMaterial({ color: 0xd35a43 }));
    cone.rotation.x = Math.PI;
    cone.position.y = 0.3;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.03, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0xe5b761 }));
    ring.rotation.x = Math.PI / 2;
    g.add(cone, ring);
    g.visible = false;
    return g;
  }

  // 小地图目标点选：只导向（换目标味），不传送
  minimap.pickTarget((i) => {
    if (gameState.selectGoal(i)) {
      hud.message(`目标改为「${FOODS[i].labelZh}」`);
      hud.renderGoal(goalView());
    }
  });

  // ---- 世界+资产就绪后自动进入 play（资产失败则留在取景，只给错误说明） ----
  const waitReady = setInterval(() => {
    if (!window.__ready || !window.__walk) return;
    if (!core.state.ready) {
      if (!core.state.assetError) return;   // 资产仍在加载
      clearInterval(waitReady);             // 资产失败：不进入，错误已展示
      return;
    }
    clearInterval(waitReady);
    window.__walk.enter().then(() => {
      // 存档位置恢复等首次物理/控制器就绪后应用
      if (pendingSave) applyPendingSaveWhenReady();
    }).catch(e => console.error('play autostart failed', e));
  }, 200);

  function bind({ walk }) {
    // HUD 按钮走 window.__walk 的完整 API（pause/resume/enter/exit 都挂在那里），
    // main.js 传入的 walk 句柄只有 tick/mode/addCollisionZone。
    hud.bind({ walk: window.__walk ?? walk });
  }

  function status() {
    const walk = window.__walk;
    const base = core.status({
      walkMode: walk ? walk.mode() : 'orbit',
      controller: rideCtl ?? walk?.controller ?? null,
      cameraMode: walk?.mode() === 'walk' ? 'third-person' : 'orbit',
    });
    return {
      ...base,
      // 小吃工单复验字段（只读）
      stamps: gameState.stamps,
      complete: gameState.complete,
      heldItem: gameState.heldItem,
      basketItem: gameState.basketItem,
      eating: gameState.eating ? { ...gameState.eating } : null,
      goal: gameState.goal()?.id ?? null,
      tasted: [...gameState.tasted],
      riding: gameState.vehicle.riding,
      vehicle: gameState.vehicle.placed ? {
        pos: gameState.vehicle.pos, yaw: gameState.vehicle.yaw, viewYaw: gameState.vehicle.viewYaw, riding: gameState.vehicle.riding,
      } : null,
      heading: rideCtl ? rideCtl.heading : null,
      viewYaw: rideCtl ? rideCtl.yaw : null,
      bikePlaced,
      stallsReady: stalls.length,
      foodsReady: !!foods,
      ...closedFacades.status(),          // 闭门叠加层只读状态（工单 C）
      minimapMode: minimap.mode,
      saveKey: STORAGE_KEY,
    };
  }

  return { profile, core, bind, status, playCamera, gameState, ride: () => rideCtl,
    closedFacades, closedFacadeHint };
}
