// WP4.2 浏览器步行模式：第一人称 WASD + 指针锁定，六个锚点出生。
// 物理只走可复用件：collision-<zone>.json -> buildPhysicsWorld（Rapier），
// 分区 GLB 地面节点 -> walkGround（按 groundNodeRe/extraGroundNodes 选网）-> collectGroundTriangles，
// 位移只经 WalkController（CruiseDriver 同一条输入链）。默认仍是轨道模式，不加 ?walk=1 不加载任何物理。
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { WalkController } from '/vendor-src/player/WalkController.js';
import { applyWalkOrientation } from '/vendor-src/player/walkCamera.js';
import { AreaWalkPhysics } from '../src/areaWalkPhysics.js';
import { computeStepMotion } from './play/telemetry.js';   // R1：play 档实测运动遥测
import { installStallFronts } from './play/stall-fronts.js';

const ZONE_FILES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];
const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const MOUSE_SENS = 0.0022;

export function installWalkMode({ scene, camera, renderer, controls, getRoots, hud, extraCollisionZones = () => [], onFeet = null, play = null }) {
  // ---------- 界面 ----------
  const bar = document.getElementById('bar');
  const sel = document.createElement('select');
  sel.id = 'w-anchor';
  sel.style.cssText = 'font:inherit;background:#faf5e9;border:1px solid #c3b498;border-radius:4px;padding:4px 6px';
  const bMode = document.createElement('button');
  bMode.id = 'w-mode'; bMode.textContent = '步行';
  const bHome = document.createElement('button');
  bHome.id = 'w-home'; bHome.textContent = '回到锚点';
  bar.appendChild(sel); bar.appendChild(bMode); bar.appendChild(bHome);

  // ---------- 状态 ----------
  let mode = 'orbit';
  let physics = null, controller = null, physicsPromise = null;
  let anchors = {};
  let zonePhysics = null;
  let stallFronts = null;
  const params = new URLSearchParams(location.search);
  let anchor = params.get('at') || 'main';
  const keys = { forward: 0, right: 0 };
  let lastHud = 0;

  // 锚点菜单先按 nav-gap.json 填充（物理构建仍以 collision 文件 spawns 为准）
  fetch('/out/nav-gap.json').then(r => r.json()).then(nav => {
    for (const name of Object.keys(nav.anchors || {})) {
      const o = document.createElement('option');
      o.value = name; o.textContent = `锚点 ${name}`;
      sel.appendChild(o);
    }
    const street = document.createElement('option');
    street.value = 'fangbang-street'; street.textContent = '方浜街段'; sel.appendChild(street);
    sel.value = anchor;
  }).catch(() => {});

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    // R3（可选1）：模式变化的唯一通知点 —— 按钮点击、enter/exit、spawnAt 全都汇到这里，
    // 消费方（如 infocard.js 关卡）监听本事件即可，不必逐个包装 __walk 入口。
    window.dispatchEvent(new CustomEvent('pb:mode', { detail: { mode: m } }));
    bMode.classList.toggle('active', m === 'walk');
    bMode.textContent = m === 'walk' ? '轨道' : '步行';
    if (m === 'walk') {
      controls.enabled = false;
      enterWalk().catch(e => { if (hud) hud(`步行模式启动失败: ${e.message}`); console.error(e); });
    } else {
      if (play && controller) play.session.end(activeCtl());
      resetLocalKeys();                        // R0-1：模式切换统一清输入（含 Shift/刹车）
      const active = activeCtl();
      if (ridingNow() && active) { active.pause(); active.speed = 0; }
      document.exitPointerLock?.();
      controls.enabled = true;
      // 轨道接管：以当前眼位为机位，目标取视线前方 8 m，衔接自然
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      controls.target.copy(camera.position).addScaledVector(fwd, 8);
      controls.update();
      if (hud) hud('轨道模式');
    }
  }
  async function enterWalk() {
    await ensurePhysics();
    if (mode !== 'walk') return;                        // 等待期间可能已切回轨道
    lastTick = performance.now();
    if (ridingNow()) activeCtl()?.resume();
    if (play) {
      // play 档：首次进入才出生，之后由 session 恢复捕获的脚点/朝向
      const a = anchors[anchor] || anchors.main;
      const [x, , z] = a;
      const spawnFeet = [x, groundY(x, z) ?? 0.5, z];
      const outcome = play.session.begin(controller, { spawnFeet });
      if (play.onEnter) play.onEnter({ controller, outcome });
      if (hud) hud(play.session.paused ? '游玩已暂停（继续 或 点击画面）' : '游玩模式（WASD 移动 · 鼠标视角 · P 暂停）');
    } else {
      teleportTo(anchors[anchor] || anchors.main);
      if (hud) hud(`步行模式（WASD 移动 · 点击画面锁定鼠标）· 锚点 ${anchor}`);
    }
  }
  function teleportTo(a) {
    const [x, , z] = a;
    const feetY = groundY(x, z) ?? 0.5;
    const feet = [x, feetY, z];
    if (play) play.session.relocate(controller, feet, 0);  // play：显式回锚点走 session 记录
    else controller.teleport(feet, 0, 0);
  }
  function groundY(x, z) {
    const ray = new RAPIER.Ray({ x, y: 8, z }, { x: 0, y: -1, z: 0 });
    // 排除自己的胶囊（回到锚点时旧胶囊可能高于射线起点）
    const hit = physics.world.castRay(ray, 40, true, undefined, undefined, controller ? controller.collider : undefined);
    return hit ? 8 - hit.timeOfImpact : null;
  }

  // ---------- 物理（懒构建，一次） ----------
  async function ensurePhysics() {
    if (physics) return;
    if (!physicsPromise) physicsPromise = buildPhysics();
    await physicsPromise;
  }
  async function buildPhysics() {
    if (hud) hud('步行：构建碰撞世界 …');
    await RAPIER.init();
    const readJson = async file => {
      const r = await fetch(`/out/${file}`);
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r.json();
    };
    const manifest = await readJson('zones-manifest.json');
    zonePhysics = new AreaWalkPhysics({ RAPIER, manifest, readJson, readBytes: async file => {
      const r = await fetch(`/out/${file}`);
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r.arrayBuffer();
    } });
    physics = await zonePhysics.loadZones([...ZONE_FILES, ...extraCollisionZones().filter(z => !ZONE_FILES.includes(z))]);
    if(play)stallFronts=installStallFronts({scene,layout:await readJson('layout.json'),RAPIER,zonePhysics});
    anchors = zonePhysics.anchors;
    if (zonePhysics.zones.has('fangbang')) await addStreetAnchor(readJson);
    anchor = anchors[anchor] ? anchor : 'main';
    sel.value = anchor;
    controller = new WalkController({
      RAPIER, physics,
      // play 档换胶囊/速度（r0.28/h0.2/eye0.8/走2.6/Shift跑4.2），未开启 play 时保持 viewer 默认
      capsule: play
        ? { ...play.capsule, speed: play.walkSpeed ?? play.speed, runSpeed: play.runSpeed ?? play.speed, autostep: play.autostep, minimumGroundY: play.minimumGroundY, groundColliders: () => zonePhysics.groundColliders, spawn: [0, 1, 0] }
        : { ...CAPSULE, spawn: [0, 1, 0] },
    });
    if (hud) hud(`步行：碰撞就绪（墙 ${physics.wallCount} · 地面 ${physics.groundTriangleCount} 三角）`);
  }

  async function addStreetAnchor(readJson = file => fetch(`/out/${file}`).then(r => {
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return r.json();
  })) {
    const route = await readJson('fangbang-route.json');
    const street = route.mainStreet.find(p => p[0] < 138 && p[0] >= 54);
    if (!street) throw new Error('fangbang-route: reviewed street start missing');
    // New optional spawn from the existing reviewed street route; core pins unchanged.
    anchors['fangbang-street'] = [...street];
  }

  // ---------- 输入 ----------
  const KEYMAP = { KeyW: 'f+', ArrowUp: 'f+', KeyS: 'f-', ArrowDown: 'f-', KeyA: 'l-', ArrowLeft: 'l-', KeyD: 'r+', ArrowRight: 'r-' };
  // 小吃工单 R0-1：main.js 传入的就是 play.profile 本体——骑乘钩子直接读
  // play.moveController / play.riding / play.movementLocked，不再多套一层。
  // 骑乘时活动位移权威是车控制器；吃的过程中移动锁死。
  const activeCtl = () => (typeof play?.moveController === 'function' ? play.moveController() : null) ?? controller;
  const ridingNow = () => Boolean(play?.riding?.());
  function applyKeys() { const c = activeCtl(); if (c) c.setMoveInput(keys.forward, keys.right); }
  function setBrake(on) { const c = activeCtl(); if (c?.setBrake) c.setBrake(on); }
  // 统一清键（R0-1）：暂停/失焦/锁丢失/模式切换/恢复时，浏览器本地 keys、
  // 控制器输入/Shift/刹车/累计器一次清干净，不留悬挂输入。
  function resetLocalKeys() {
    keys.forward = 0; keys.right = 0;
    applyKeys();
    setBrake(false);
    const c = activeCtl();
    if (c?.setRunning) c.setRunning(false);
  }
  addEventListener('keydown', (e) => {
    if (mode !== 'walk') return;
    if (play && e.code === 'Escape') {
      e.preventDefault();
      resetLocalKeys();
      play.session.pause(controller, 'escape');
      document.exitPointerLock?.();
      play.onPauseChange?.(true);
      return;
    }
    if (play && e.code === 'KeyP') {          // play：P 键暂停/继续（暂停时清键、清累计器并释放指针锁）
      e.preventDefault();
      if (play.session.paused) play.session.resume(controller);
      else { resetLocalKeys(); play.session.pause(controller, 'user'); document.exitPointerLock?.(); }
      if (play.onPauseChange) play.onPauseChange(play.session.paused);
      return;
    }
    if (play && play.session.paused) return;   // 暂停期间不吃移动键
    if (play?.movementLocked?.()) {            // 吃的过程中禁止移动/上车（R0-4）
      if (KEYMAP[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') e.preventDefault();
      return;
    }
    // 骑乘：空格 = 纯刹车（任何方向只减速到 0，不换向）；S/方向下走 KEYMAP
    // forward=-1——控制器先真刹车到 0，继续按住进入低速倒车（工单 A）
    if (ridingNow() && e.code === 'Space') {
      e.preventDefault();
      setBrake(true);
      return;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {   // Shift 跑/冲刺（走 4.2 · 车 7 m/s）
      e.preventDefault();
      const c = activeCtl();
      if (c?.setRunning) c.setRunning(true);
      return;
    }
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (k[0] === 'f') keys.forward = k[1] === '+' ? 1 : -1;
    else keys.right = k[1] === '+' ? 1 : -1;
    applyKeys();
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      if (ridingNow()) setBrake(false);
      // S/下的 keyup 照常走 KEYMAP 清键（倒车输入随松键归零）
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {   // 松开 Shift 即回常速（与模式无关）
      const c = activeCtl();
      if (c?.setRunning) c.setRunning(false);
      return;
    }
    const k = KEYMAP[e.code];
    if (!k) return;
    if (k[0] === 'f') keys.forward = 0; else keys.right = 0;
    applyKeys();
  });
  renderer.domElement.addEventListener('click', () => {
    if (mode !== 'walk') return;
    if (play && play.session.paused) {         // play：点画面即继续（随后重新锁定鼠标）
      play.session.resume(controller);
      if (play.onPauseChange) play.onPauseChange(false);
    }
    if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
  });
  addEventListener('mousemove', (e) => {
    if (mode === 'walk' && controller && document.pointerLockElement === renderer.domElement && !(play && play.session.paused))
      activeCtl().look(e.movementX * MOUSE_SENS, e.movementY * MOUSE_SENS);
  });
  // 骑乘状态变化（上/下车/恢复）：统一清浏览器本地输入（R0-1）
  window.addEventListener('pb:ride-change', () => { if (mode === 'walk') resetLocalKeys(); });
  // play：失焦 / 指针锁丢失 = 暂停（清键、位置不动）；viewer 档保持原行为不动
  addEventListener('blur', () => {
    if (play && mode === 'walk' && controller && !play.session.paused) {
      resetLocalKeys();
      play.session.pause(controller, 'blur');
      if (play.onPauseChange) play.onPauseChange(true);
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (play && mode === 'walk' && controller && !play.session.paused
      && document.pointerLockElement !== renderer.domElement) {
      resetLocalKeys();
      play.session.pause(controller, 'lock-lost');
      if (play.onPauseChange) play.onPauseChange(true);
    }
  });

  bMode.addEventListener('click', () => setMode(mode === 'walk' ? 'orbit' : 'walk'));
  sel.addEventListener('change', () => { anchor = sel.value; });
  bHome.addEventListener('click', async () => {
    if (mode !== 'walk') return;
    if (!physics) await ensurePhysics();
    teleportTo(anchors[anchor] || anchors.main);
    if (hud) hud(`回到锚点 ${anchor}`);
  });

  // ---------- 帧循环（main.js 每帧在 controls.update() 之后调用） ----------
  let lastTick = performance.now();
  function tick() {
    if (mode !== 'walk' || !controller) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000); // 真实帧长；固定步整形在各自控制器内部
    lastTick = now;
    if (play && play.session.paused) return;   // 暂停：两个控制器都不步进（不消费输入、不跳帧）
    // 小吃工单 R0-1：骑乘时车控制器是唯一固定步权威（步行胶囊悬挂不位移）
    if (ridingNow()) {
      const ride = activeCtl();
      if (ride) {
        ride.step(dt);
        if (onFeet) onFeet(ride.feetPosition());
        // facing 用物理航向（骑姿朝车头）；相机用 ride.yaw 自由视角（PlayCamera 读 controller.yaw）
        play.onFrame?.({
          feet: ride.feetPosition(), yaw: ride.yaw,
          moving: false, actualSpeed: 0, facingYaw: ride.heading,
          grounded: ride.isGrounded(), paused: false, dt,
        });
        play.updateCamera?.({ camera, controller: ride, dt });
      }
      return;
    }
    // 吃的过程（R0-4）：固定步层确保水平输入为 0——控制器不 step（动画/倒计时
    // 仍由 play.onFrame 推进，P 暂停时两者都冻结）
    if (play?.movementLocked?.()) {
      controller.clearKeys();
      if (onFeet) onFeet(controller.feetPosition());
      const motion = { moving: false, actualSpeed: 0, facingYaw: null };
      play.onFrame?.({ feet: controller.feetPosition(), yaw: controller.yaw, ...motion, grounded: controller.isGrounded(), paused: false, dt });
      play.updateCamera?.({ camera, controller, dt });
      return;
    }
    controller.step(dt);
    // R1（review R0-2）：脚点通知放在 play/viewer 共用路径——main.js 靠它做
    // 方浜 60m 自然逼近加载，play 分支不得提前 return 跳过；每帧至多一次。
    if (onFeet) onFeet(controller.feetPosition());
    if (play) {
      // play 档：按固定步的实际校正位移/速度/方向判定 walk/idle、步频与人物朝向
      const paused = false;
      const motion = computeStepMotion(controller.lastStep, controller.fixedDt);
      play.onFrame?.({ feet: controller.feetPosition(), yaw: controller.yaw, ...motion, grounded: controller.isGrounded(), paused, dt });
      play.updateCamera?.({ camera, controller, dt });
      return;
    }
    const eye = controller.eyePosition();
    camera.position.set(eye[0], eye[1], eye[2]);
    applyWalkOrientation(camera, controller.pitch, controller.yaw);
    const tnow = performance.now();
    if (hud && tnow - lastHud > 250) {
      lastHud = tnow;
      const f = controller.feetPosition();
      hud(`步行 · 锚点 ${anchor} · 脚点 (${f[0].toFixed(1)}, ${f[1].toFixed(2)}, ${f[2].toFixed(1)}) · ${controller.isGrounded() ? '着地' : '腾空'}`);
    }
  }

  // ---------- 测试/截图钩子 ----------
  function status() {
    return {
      mode,
      anchor,
      camera: camera.position.toArray(),
      cameraRotation: camera.rotation.toArray().slice(0, 3),
      cameraQuat: camera.quaternion.toArray(),   // 工单 D：Esc 暂停镜头稳定性断言用（只读）
      yaw: controller ? controller.yaw : null,
      pitch: controller ? controller.pitch : null,
      paused: controller ? controller.paused : false,
      anchors: Object.keys(anchors),
      physicsReady: !!physics,
      zones: zonePhysics ? zonePhysics.status().zones : [],
      wallCount: physics ? physics.wallCount : 0,
      groundTriangleCount: physics ? physics.groundTriangleCount : 0,
      feet: controller ? controller.feetPosition() : null,
      eye: controller ? controller.eyePosition() : null,
      grounded: controller ? controller.isGrounded() : false,
    };
  }
  window.__walk = {
    status,
    mode: () => mode,                          // play HUD/status 需要；viewer 契约只增不改
    get zonePhysics() { return zonePhysics; },
    get controller() { return controller; },   // M4：?perf=1 的 CruiseDriver 需要挂同一控制器
    paused: () => (play ? play.session.paused : controller ? controller.paused : false),
    // play 专用：HUD 暂停/继续按钮走这里；暂停统一释放指针锁（R1：P 后可直接点 HUD）
    pause() {
      if (play && mode === 'walk' && controller && !play.session.paused) {
        resetLocalKeys();
        play.session.pause(controller, 'user');
        document.exitPointerLock?.();
        if (play.onPauseChange) play.onPauseChange(true);
      }
      return status();
    },
    resume() {
      if (play && mode === 'walk' && controller && play.session.paused) {
        resetLocalKeys();
        play.session.resume(controller);
        if (play.onPauseChange) play.onPauseChange(false);
      }
      return status();
    },
    async spawnAt(name) {
      anchor = name; sel.value = name;
      if (mode !== 'walk') setMode('walk');
      await ensurePhysics();
      teleportTo(anchors[name] || anchors.main);
      return status();
    },
    async enter() { setMode('walk'); await ensurePhysics(); return status(); },
    exit() { setMode('orbit'); return status(); },
    teleport(x, y, z) {
      if (!controller) return status();
      controller.teleport([x, y, z], 0, 0);
      return status();
    },
    // 截图支持：把相机直接摆到任意眼高位姿（不依赖物理构建完成）
    eyeView(x, y, z, yaw = 0, pitch = 0) {
      camera.position.set(x, y, z);
      applyWalkOrientation(camera, pitch, yaw);
      return camera.position.toArray().map(v => +v.toFixed(2));
    },
  };
  if (params.get('walk') === '1') {
    const waitReady = setInterval(() => {
      if (!window.__ready) return;
      clearInterval(waitReady);
      window.__walk.spawnAt(anchor).catch(e => console.error('walk autostart failed', e));
    }, 200);
  }

  return {
    tick,
    mode: () => mode,
    async addCollisionZone(zone) {
      await ensurePhysics();
      await zonePhysics.loadZone(zone);
      // Same world/capsule/velocity/input/yaw/pause state survives activation.
      anchors = zonePhysics.anchors;
      if (zone === 'fangbang') await addStreetAnchor();
      return status();
    },
  };
}
