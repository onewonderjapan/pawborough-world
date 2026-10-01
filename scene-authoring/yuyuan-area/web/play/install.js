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

// readJson helper（/out 与 /inputs 都由 scripts/server.mjs 提供）
async function readJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
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
        feet: ctl.feetPosition(), yaw: ctl.yaw, pitch: rideCtl ? 0 : (walk?.controller?.pitch ?? 0),
      })));
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

  // ---- 第三人称射线：真实 Rapier 世界，排除玩家自己的胶囊（不误撞自身） ----
  // rapier3d-compat 签名：castRay(ray, maxToi, solid, flags, groups,
  //   excludeCollider, excludeRigidBody, filterPredicate)；谓词 = 传入 true 才检测。
  const worldNow = () => window.__walk?.zonePhysics?.physics?.world ?? null;
  const playerHandles = () => {
    const s = new Set();
    const w = window.__walk?.controller?.collider; if (w) s.add(w.handle);
    if (rideCtl?.collider) s.add(rideCtl.collider.handle);
    return s;
  };
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
  const groundYAt = (x, z, maxToi = 8) => {
    const world = worldNow();
    if (!world) return null;
    const ray = new RAPIER.Ray({ x, y: 8, z }, { x: 0, y: -1, z: 0 });
    const exclude = playerHandles();
    const hit = world.castRay(ray, maxToi, true, undefined, undefined,
      undefined, undefined, (c) => !exclude.has(c.handle));
    return hit ? 8 - hit.timeOfImpact : null;
  };

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
      hud.message(outcome?.restored ? '灰猫回到上次的位置和朝向' : '灰猫已就位，去尝遍三味吧');
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
      if (avatar && !gameState.vehicle.riding) {
        avatar.root.visible = !place || place.applied >= PLAY_PROFILE.avatarHideDistance;
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
  let pendingSave = null;       // 存档恢复（入场后应用）
  let bikePlaced = false;
  let placedMarker = null;      // 目标世界小标记

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

  // ---- 存档恢复（入场时应用；坏档回安全出生点） ----
  try {
    const raw = storage().getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const v = validateSave(parsed, FOODS);
      if (v.ok) {
        gameState.applySave(v.value);
        pendingSave = v.value;
      } else {
        hud.message(`上次的散步存档无法读取（${v.reason}），已从出生点开始`);
        storage().removeItem(STORAGE_KEY);
      }
    }
  } catch { /* 坏 JSON 同样按坏档处理 */ }

  function applyPendingSave() {
    if (!pendingSave) return;
    const walk = window.__walk;
    const controller = walk?.controller;
    const s = pendingSave;
    pendingSave = null;
    if (controller && s.feet) {
      // 显式恢复：session 记录为 explicit relocation，绝不当作走动证据
      core.session.relocate(controller, s.feet, s.yaw ?? 0);
      hud.message('回到上次的散步进度');
    }
    // 车位置恢复（placed 且不在骑乘状态落地为停着的车）
    if (gameState.vehicle.placed && bikeView && !gameState.vehicle.riding) {
      bikeView.placeAt(gameState.vehicle.pos, gameState.vehicle.yaw);
      bikePlaced = true;
    }
    // 手里/车篮的模型恢复
    refreshHeldModel();
    hud.renderGoal(goalView());
  }

  // ---- 车：借车站布置（真实支持面 + Rapier 检查）与上/下车 ----
  function ensureBikePlaced() {
    if (bikePlaced || !bikeView) return;
    const walk = window.__walk;
    if (!walk?.zonePhysics?.physics) return;          // 物理还没建好
    const controller = walk.controller;
    const feet = controller ? controller.feetPosition() : null;
    if (!feet) return;
    const pos = gameState.vehicle.placed && gameState.vehicle.pos
      ? [...gameState.vehicle.pos]
      : findBikeStand(feet);
    if (!pos) return;
    const gy = groundYAt(pos[0], pos[2]);
    if (gy === null) return;
    bikeView.placeAt([pos[0], gy, pos[2]], gameState.vehicle.yaw ?? 0);
    gameState.placeVehicle([pos[0], gy, pos[2]], gameState.vehicle.yaw ?? 0);
    bikePlaced = true;
    saveNow();
  }

  // 借车站：正常出生点附近 1.2–3.5m 环形找真实支持面（有地面、无墙交叠、避开入口）
  function findBikeStand(feet) {
    const world = worldNow();
    if (!world) return null;
    const offsets = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 1.4 + (i % 3) * 0.9;
      offsets.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const probeShape = new RAPIER.Cuboid(0.34, 0.68, 0.82);
    const exclude = playerHandles();
    for (const [ox, oz] of offsets) {
      const x = feet[0] + ox, z = feet[2] + oz;
      const gy = groundYAt(x, z);
      if (gy === null || Math.abs(gy - feet[1]) > 0.6) continue;
      // 整车+骑手体量不得与静态墙交叠（排除玩家/车自身）
      const clear = world.intersectionWithShape(
        { x, y: gy + 0.68, z }, { x: 0, y: 0, z: 0, w: 1 }, probeShape,
        undefined, undefined, undefined, undefined, (c) => !exclude.has(c.handle));
      if (!clear) return [x, gy, z];
    }
    return [feet[0] + 2.0, feet[1], feet[2]];   // 兜底：出生点东侧 2m（地面射线在 placeAt 前再验）
  }

  function refreshHeldModel() {
    const avatar = core.state.avatar;
    if (!avatar || !foods) return;
    // 摘掉旧手持（不 dispose 共享资源）
    avatar.model.traverse((o) => {
      if (o.name?.startsWith('play-held-')) o.removeFromParent();
    });
    if (!gameState.heldItem) return;
    const armR = avatar.model.getObjectByName('armR');
    if (!armR) return;
    foods.attachToHand(gameState.heldItem, armR);
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
    rideCtl = new RideController({
      RAPIER, physics: walk.zonePhysics.physics,
      cruise: PLAY_PROFILE.bikeCruise, max: PLAY_PROFILE.bikeMax,
      excludeColliderHandles: [window.__walk?.controller?.collider?.handle].filter(Boolean),
    });
    rideCtl.teleport([bike[0], bike[1], bike[2]], gameState.vehicle.yaw ?? 0);
    // 上车：持物进车篮（不复制食物），骑姿接管
    gameState.stowHeldToBasket();
    refreshHeldModel();
    gameState.setRiding(true);
    playCamera.shoulderHeight = PLAY_PROFILE.rideShoulderHeight;
    playCamera.distance = PLAY_PROFILE.rideCameraDistance;
    bikeView.attachRider(core.state.avatar);
    hud.message('骑上共享自行车（W 加速 · Shift 冲刺 · S/空格 刹车 · R 下车）');
    saveNow();
  }

  function dismount(controller) {
    const feet = rideCtl.feetPosition();
    const yaw = rideCtl.yaw;
    // 安全下车点：左/右/后方逐一真实地面 + 胶囊重叠检查（排除玩家/车）
    const world = worldNow();
    if (!world) { hud.setHint('物理世界还没就绪，稍等再下'); return; }
    const shape = new RAPIER.Capsule(0.2, 0.28);
    const exclude = playerHandles();
    const probe = (x, y, z) => {
      const gy = groundYAt(x, z);
      if (gy === null || Math.abs(gy - y) > 1.2) return false;
      const overlapping = world.intersectionWithShape(
        { x, y: gy + 0.48, z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
        undefined, undefined, undefined, undefined, (c) => !exclude.has(c.handle));
      return !overlapping;
    };
    const spot = pickDismountSpot(feet, yaw, probe);
    if (!spot) { hud.setHint('周围没有安全下车点，请骑到开阔处再按 R'); return; }
    const bikeFinal = [feet[0], feet[1], feet[2]];
    const bikeYaw = yaw;
    const speedAtStop = rideCtl.speed;
    rideCtl.dispose();
    rideCtl = null;
    // 车停稳在骑乘结束点；玩家落到安全点
    gameState.setRiding(false, bikeFinal, bikeYaw);
    controller.teleport(spot.feet, yaw, 0);
    bikeView.detachRider(core.state.avatar);
    bikeView.placeAt(bikeFinal, bikeYaw);
    playCamera.shoulderHeight = PLAY_PROFILE.shoulderHeight;
    playCamera.distance = PLAY_PROFILE.cameraDistance;
    gameState.takeBackFromBasket();
    refreshHeldModel();
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
  function frameGame({ feet, yaw, paused, dt }) {
    const walk = window.__walk;
    const controller = walk?.controller;
    if (!controller) return;
    if (core.state.entered && !pendingSave) ensureBikePlaced();
    applyPendingSaveWhenReady();

    // 骑乘物理与视觉（唯一活动位移权威：rideCtl 存在时 walk.js 不 step 步行控制器）
    if (rideCtl) {
      if (!paused) rideCtl.step(dt);
      const pos = rideCtl.feetPosition();
      gameState.moveVehicle(pos, rideCtl.yaw);
      bikeView.updateRide(pos, rideCtl.yaw, rideCtl.speed, paused ? 0 : dt);
      applyRiderPose(core.state.avatar, bikeView, rideCtl.yaw);
    }

    // 吃：未暂停帧推进；暂停冻结（不调 eatTick 即不跳时）
    if (gameState.eating && !paused) {
      const r = gameState.eatTick(dt);
      if (r && r.done) {
        core.state.avatar?.setEatingPose(false);
        core.state.avatar?.showSatisfaction();
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
      hud.setHint(computeHint({
        state: gameState, feet, stalls,
        bike, riding: gameState.vehicle.riding,
        blockedRatio: rideCtl?.lastStep?.blockedRatio ?? 0,
      }));
      renderGoalDistance(feet);
      minimap.update({
        feet, yaw: rideCtl ? rideCtl.yaw : yaw,
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
    t.groundY = t.groundY ?? groundYAt(t.customerPoint.x, t.customerPoint.z) ?? gy;
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
        pos: gameState.vehicle.pos, yaw: gameState.vehicle.yaw, riding: gameState.vehicle.riding,
      } : null,
      bikePlaced,
      stallsReady: stalls.length,
      foodsReady: !!foods,
      minimapMode: minimap.mode,
      saveKey: STORAGE_KEY,
    };
  }

  return { profile, core, bind, status, playCamera, gameState };
}
