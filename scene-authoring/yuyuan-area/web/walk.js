// WP4.2 浏览器步行模式：第一人称 WASD + 指针锁定，六个锚点出生。
// 物理只走可复用件：collision-<zone>.json -> buildPhysicsWorld（Rapier），
// 分区 GLB 地面节点 -> walkGround（按 groundNodeRe/extraGroundNodes 选网）-> collectGroundTriangles，
// 位移只经 WalkController（CruiseDriver 同一条输入链）。默认仍是轨道模式，不加 ?walk=1 不加载任何物理。
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { collectGroundTriangles } from '/vendor-src/world/groundExtractor.js';
import { readGlb } from '/vendor-src/world/glbReader.js';
import { buildPhysicsWorld } from '/vendor-src/world/physics.js';
import { WalkController } from '/vendor-src/player/WalkController.js';
import { applyWalkOrientation } from '/vendor-src/player/walkCamera.js';
import { selectAreaGroundMeshes } from '../src/walkGround.js';

const ZONE_FILES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];
const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const MOUSE_SENS = 0.0022;

export function installWalkMode({ scene, camera, renderer, controls, getRoots, hud }) {
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
    sel.value = anchor;
  }).catch(() => {});

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    bMode.classList.toggle('active', m === 'walk');
    bMode.textContent = m === 'walk' ? '轨道' : '步行';
    if (m === 'walk') {
      controls.enabled = false;
      enterWalk().catch(e => { if (hud) hud(`步行模式启动失败: ${e.message}`); console.error(e); });
    } else {
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
    teleportTo(anchors[anchor] || anchors.main);
    if (hud) hud(`步行模式（WASD 移动 · 点击画面锁定鼠标）· 锚点 ${anchor}`);
  }
  function teleportTo(a) {
    const [x, , z] = a;
    const feetY = groundY(x, z) ?? 0.5;
    controller.teleport([x, feetY, z], 0, 0);
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
    const files = await Promise.all(ZONE_FILES.map(z =>
      fetch(`/out/collision-${z}.json`).then(r => { if (!r.ok) throw new Error(`collision-${z}.json: ${r.status}`); return r.json(); })));
    const colliders = files.flatMap(f => f.colliders);
    anchors = {};
    for (const f of files) Object.assign(anchors, f.spawns || {});
    anchor = anchors[anchor] ? anchor : 'main';
    sel.value = anchor;

    // 地面三角形：直接解析原始分区 GLB（zones-manifest.json 给出各分区分件，
    // 与 tests/zone-walk-check.mjs 同一路径），再按各分区 collision 文件的
    // groundNodeRe/extraGroundNodes 选网（walkGround）。不用渲染场景的 cm.glb ——
    // gltfpack 合并把同材质网格并进别名组、网格名变 mesh_N，无法可靠对名。
    const manifest = await fetch('/out/zones-manifest.json').then(r => r.json());
    const partsOf = z => manifest.zones.filter(e => e.id === z && e.file).map(e => e.file);
    const groundMeshes = [];
    for (const f of files) {
      for (const part of partsOf(f.zone)) {
        const buf = await fetch(`/out/${part}`).then(r => {
          if (!r.ok) throw new Error(`${part}: ${r.status}`);
          return r.arrayBuffer();
        });
        const { meshes } = readGlb(buf);
        for (const m of selectAreaGroundMeshes(meshes, f)) groundMeshes.push(m);
      }
    }
    if (!groundMeshes.length) throw new Error('walk: no ground meshes matched in zone GLBs');
    const groundTriangles = collectGroundTriangles(groundMeshes);
    physics = buildPhysicsWorld(RAPIER, { collision: { colliders }, groundTriangles });
    controller = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [0, 1, 0] } });
    if (hud) hud(`步行：碰撞就绪（墙 ${physics.wallCount} · 地面 ${physics.groundTriangleCount} 三角）`);
  }

  // ---------- 输入 ----------
  const KEYMAP = { KeyW: 'f+', ArrowUp: 'f+', KeyS: 'f-', ArrowDown: 'f-', KeyA: 'l-', ArrowLeft: 'l-', KeyD: 'r+', ArrowRight: 'r-' };
  function applyKeys() { if (controller) controller.setMoveInput(keys.forward, keys.right); }
  addEventListener('keydown', (e) => {
    if (mode !== 'walk') return;
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (k[0] === 'f') keys.forward = k[1] === '+' ? 1 : -1;
    else keys.right = k[1] === '+' ? 1 : -1;
    applyKeys();
  });
  addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    if (k[0] === 'f') keys.forward = 0; else keys.right = 0;
    applyKeys();
  });
  renderer.domElement.addEventListener('click', () => {
    if (mode === 'walk' && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
  });
  addEventListener('mousemove', (e) => {
    if (mode === 'walk' && controller && document.pointerLockElement === renderer.domElement)
      controller.look(e.movementX * MOUSE_SENS, e.movementY * MOUSE_SENS);
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
    const dt = Math.min(0.25, (now - lastTick) / 1000); // 真实帧长；固定步整形在 WalkController 内部
    lastTick = now;
    controller.step(dt);
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
      anchors: Object.keys(anchors),
      physicsReady: !!physics,
      wallCount: physics ? physics.wallCount : 0,
      groundTriangleCount: physics ? physics.groundTriangleCount : 0,
      feet: controller ? controller.feetPosition() : null,
      eye: controller ? controller.eyePosition() : null,
      grounded: controller ? controller.isGrounded() : false,
    };
  }
  window.__walk = {
    status,
    async spawnAt(name) {
      anchor = name; sel.value = name;
      if (mode !== 'walk') setMode('walk');
      await ensurePhysics();
      teleportTo(anchors[name] || anchors.main);
      return status();
    },
    async enter() { setMode('walk'); await ensurePhysics(); return status(); },
    exit() { setMode('orbit'); return status(); },
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

  return { tick };
}
