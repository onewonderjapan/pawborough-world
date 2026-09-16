// Fangbang ↔ temple BRIDGE viewer (fangbang.html, ports 5296/5297).
// One walkable world assembled from the delivered datasets:
//   street assembly (world/street-reviewed.glb, loaded by WorldLoader)
//   + west-extension surface (dataset manifest streetCompletion.surface —
//     the WorldLoader extension point; visible faces ARE walkable ground)
//   + east tail surface + seal wall (page-level GLB loads, byte-checked)
//   + temple axis 8 GLBs (assets block via blockViews — the ONE production
//     loader path; its walkable court faces join as a second ground trimesh)
//   + block lifecycle for the placeholder districts (gray boxes, real
//     colliders) and the refined shop blocks
// Physics walls come from the dataset collision-world.json (337 records:
// street 208 + seal wall 1 + temple 128 composed with T+yaw) — the single
// wall authority; the temple assets block carries no sidecars, so nothing
// can double. The route cruise is AUTOMATIC and honestly labeled
// (manualWalkClaim: false) — manual full play is the lead's browser check.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';

import { loadWorld, CAPSULE } from './world/WorldLoader.js';
import { GROUND_NODE_RE } from './world/collisionAdapter.js';
import { collectGroundTriangles } from './world/groundExtractor.js';
import { addGroundCollider } from './world/physics.js';
import { WalkController } from './player/WalkController.js';
import { applyWalkOrientation } from './player/walkCamera.js';
import { CruiseDriver } from './player/cruise.js';
import { BlockManager } from './world/BlockManager.js';
import { createBlockViews } from './world/blockViews.js';
import { loadedSceneAssets, expectedTriangles } from './world/sceneAssets.js';
import { applyViewVerified, loadGlbWithStats, saveEvidence, countResources } from './templeViewShared.js';

const app = document.querySelector('#app'), stats = document.querySelector('#stats'),
  viewsEl = document.querySelector('#views'), noticeEl = document.querySelector('#notice');

const BASE = './world/fangbang-temple/';
const DATASET_TAG = 'fangbang';

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.info.autoReset = false;
app.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '方浜中路桥接世界三维街景');

const scene = new T.Scene();
scene.background = new T.Color(0xdde3df);
scene.fog = new T.Fog(0xdde3df, 220, 460);
const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, .04).texture;
scene.environmentIntensity = .28;
room.dispose(); pmrem.dispose();
scene.add(new T.HemisphereLight(0xe8f0f5, 0xb9b2a1, .72));
const sun = new T.DirectionalLight(0xfff5ea, 2.4);
sun.position.set(-35, 110, 60);
sun.target.position.set(-15, 0, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -190, right: 190, top: 130, bottom: -130, near: .5, far: 420 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = .025;
sun.shadow.bias = -.0002;
sun.shadow.autoUpdate = false;
scene.add(sun, sun.target);
const outside = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshStandardMaterial({ color: 0xbabdb4, roughness: .98 }));
outside.rotation.x = -Math.PI / 2;
outside.position.set(42, -.18, 4);
outside.receiveShadow = true;
scene.add(outside);

const camera = new T.PerspectiveCamera(45, 1, .1, 700);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.minDistance = .5;
controls.maxDistance = 320;
controls.maxPolarAngle = Math.PI;

const world = new T.Group();
world.name = 'fangbang-bridge-world';
scene.add(world);
const clay = new T.MeshStandardMaterial({ color: 0xb8b7ae, roughness: .86 });

let session = null, controller = null, blocks = null, cruise = null;
let mode = 'view', paused = false, ready = false, clayOn = false, selected = null;
let cameras = [], manifest = null, lastRender = {}, loadStats = {};
let routeCheck = null, cameraCheck = null, resetCount = 0, lastCruiseStatus = null;
let placeholderPref = true;   // the gray placeholder districts ARE this page's context
const keys = { w: false, a: false, s: false, d: false };

function resources() { return countResources(world, clay); }

function record() {
  return {
    dataset: 'fangbang-temple', view: selected, mode, paused, clay: clayOn, ready,
    resources: resources(),
    trianglesExpected: session
      ? expectedTriangles(manifest.placedTriangles, [
          ...(session.sceneInventory ?? []),
          { kind: 'surface', triangles: manifest.streetCompletion.eastTailSurface.triangles },
          { kind: 'surface', triangles: manifest.westExtension.sealWall.triangles },
        ]).total
      : null,
    load: loadStats,
    render: lastRender,
    camera: mode === 'view'
      ? { position: camera.position.toArray().map((v) => +v.toFixed(3)), target: controls.target.toArray().map((v) => +v.toFixed(3)), fovDeg: +camera.fov.toFixed(3) }
      : { feet: controller.feetPosition().map((v) => +v.toFixed(2)) },
    cameraCheck, routeCheck,
    walking: {
      walkingVerified: false, manualKeyboardWalkTested: false, walkResets: resetCount,
      capsuleFeet: controller ? controller.feetPosition() : null, eyeHeightM: 1.6, capsuleRadiusM: .35,
      autoPhysicsCruise: lastCruiseStatus,
      manualWalkClaim: false,
      blocks: blocks ? { active: blocks.activeIds(), epoch: blocks.epoch } : null,
    },
    presentation: {
      placeholdersVisible: mode === 'walk' ? true : placeholderPref,
      viewPreference: placeholderPref,
      hiddenPlaceholderIds: mode === 'walk' || placeholderPref || !blocks ? [] : blocks.loadedPlaceholderIds(),
      loadedPlaceholderCount: blocks ? blocks.loadedPlaceholderIds().length : 0,
      placeholderColliders: blocks ? blocks.colliderCount() : null,
    },
    mapRegistration: manifest?.mapRegistration
      ? { footOnCenterlineGlb: manifest.mapRegistration.foot.onCenterlineGlb, translationGlb: manifest.mapRegistration.templePlacement.translationGlb, yawRad: manifest.mapRegistration.templePlacement.yawRad, ownerAdopted: manifest.mapRegistration.ownerAdopted }
      : null,
    ownerAdopted: false,
    browserRendered: true,
    framebuffer: renderer.getSize(new T.Vector2()).toArray(),
    lighting: { shadows: renderer.shadowMap.enabled, toneMapping: 'AgX', exposure: 1, sunIntensity: 2.4 },
  };
}

function render() {
  if (!ready) return;
  const near = mode === 'view' ? Math.max(.05, Math.min(2, camera.position.distanceTo(controls.target) * .003)) : .1;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  renderer.info.reset();
  const started = performance.now();
  renderer.render(scene, camera);
  lastRender = { callsIncludingShadow: renderer.info.render.calls, trianglesIncludingShadow: renderer.info.render.triangles, cpuSubmitMs: +(performance.now() - started).toFixed(2) };
  const r = resources();
  stats.textContent = mode === 'walk'
    ? `行走模式 · 脚底 (${controller.feetPosition().map((v) => v.toFixed(1)).join(', ')}) ${paused ? '· 已暂停' : ''}\nWASD 移动 · 鼠标环视(点击画面锁定) · 空格跳 · P 暂停 · V 返回取景`
    : `${r.triangles.toLocaleString()} 三角形 · 几何/材质/纹理 ${r.uniqueGeometries}/${r.uniqueMaterials}/${r.uniqueTextures}\n`
      + `本机资产 ${((loadStats.bytesTotal || 0) / 1e6).toFixed(2)} MB · 街道装配+东西延伸+庙轴线+占位街区\n`
      + `巡游 ${routeCheck ? (routeCheck.pass ? 'PASS ' + routeCheck.summary : 'FAIL ' + (routeCheck.summary || routeCheck.error)) : '—（自动执行，非人工试玩）'}`;
  document.querySelector('#record').textContent = JSON.stringify(record(), null, 2);
}

function setView(id) {
  const v = cameras.find((c) => c.id === id);
  if (!v) return;
  if (mode === 'walk') setMode('view');
  selected = id;
  camera.aspect = app.clientWidth / app.clientHeight;
  cameraCheck = applyViewVerified(camera, controls, v);
  for (const b of viewsEl.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === id);
  render();
}

function notice(text) { noticeEl.textContent = text; }

// ---- walk mode ---------------------------------------------------------------
function resetController(countsAsReset) {
  const s = controller.spawnRef;
  controller.body.setTranslation({ x: s.x, y: s.y + controller.centerOffset, z: s.z }, true);
  controller.vy = 0;
  controller.yaw = Math.PI / 2;   // face west (-X), down the bridge route
  controller.pitch = 0;
  controller.clearKeys();
  controller.resume();
  cruise = null;
  if (countsAsReset) resetCount++;
}

function setMode(next) {
  if (!ready || !controller || next === mode) return;
  if (next === 'walk') {
    resetController(true);          // entering walk = reset to the bridge start
    camera.fov = 68;
    camera.updateProjectionMatrix();
    renderer.domElement.requestPointerLock?.();
  } else {
    document.exitPointerLock?.();
    keys.w = keys.a = keys.s = keys.d = false;
    mode = 'view';
    controls.enabled = true;
    setView(selected);
    syncPlaceholderUi();
    sun.shadow.needsUpdate = true;
    render();
    return;
  }
  mode = next;
  paused = false;
  controls.enabled = false;
  syncPlaceholderUi();
  sun.shadow.needsUpdate = true;
  render();
}

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

// ---- the AUTOMATIC route check: full bridge out-and-back + 4 negatives -------
async function runRouteCheck() {
  const t0 = performance.now();
  const dt = 1 / 60;
  const route = session.route;
  const results = {};
  const ph165 = session.blocks.placeholders.find((x) => x.id === 'shop-165');
  const shopOBB = {
    'shop-165': { x: ph165.glbPoint[0], z: ph165.glbPoint[1], theta: ph165.angleRad, hw: ph165.widthM / 2, hd: ph165.depthM / 2 },
  };
  {
    // forward: bridge start (east tail) -> main street -> west extension ->
    // forecourt -> threshold -> temple axis -> STAIR FOOT. The capsule cannot
    // climb the 0.17m platform risers (temple_dadian_passage evidence:
    // blocked safely), so the honest terminus is the stair foot; the doors
    // stay covered by the dadian-doors negative. Stall time inside the stair
    // zone (temple-local z < -38) is the expected blocked-at-riser state and
    // does not count as a joint stall.
    const T = manifest.mapRegistration.templePlacement.translationGlb;
    const YAW = manifest.mapRegistration.templePlacement.yawRad;
    const CY = Math.cos(YAW), SY = Math.sin(YAW);
    const localZ = (wx, wz) => SY * (wx - T[0]) + CY * (wz - T[2]);
    const c = controller;
    resetController(false);
    const driver = new CruiseDriver({ controller: c, waypoints: route.mainStreet, reachRadius: 1.4, timeoutSteps: 60 * 900 });
    // joint-stall zones (route.fallCheck: 拼接缝无 >1s 卡顿): the frozen-road/
    // west-extension seam (x -4..1) and the frozen-road/east-tail seam (x 84..89).
    // A normal step is ~0.023m at 1.4m/s, so standstill means < 0.008m/step;
    // slow navigation elsewhere is legitimate and not counted.
    const jointZone = (p) => (p[0] > -4 && p[0] < 1) || (p[0] > 84 && p[0] < 89);
    let guard = 60 * 1200;
    let lastPos = c.feetPosition(), stillS = 0, jointStallS = 0;
    const stall = { maxStallS: 0, where: null };
    let stairBlocked = false, stuckOutside = null;
    while (!driver.done && guard-- > 0) {
      driver.tick(dt);
      c.step(dt);
      const p = c.feetPosition();
      const moved = Math.hypot(p[0] - lastPos[0], p[2] - lastPos[2]);
      const lz = localZ(p[0], p[2]);
      if (moved < 0.008) {
        stillS += dt;
        if (jointZone(p)) {
          jointStallS += dt;
          if (jointStallS > stall.maxStallS) { stall.maxStallS = jointStallS; stall.where = p.map((v) => +v.toFixed(1)); }
        }
        if (lz < -38 && stillS > 6) { stairBlocked = true; break; }   // blocked at the riser: expected
        if (stillS > 12) { stuckOutside = p.map((v) => +v.toFixed(2)); driver.blocked = { reason: 'standstill > 12s', at: stuckOutside }; break; }
      } else { stillS = 0; if (!jointZone(p)) jointStallS = 0; }
      lastPos = p;
      if (p[1] < -0.05) { driver.blocked = { reason: 'fell below y=-0.05', at: p.map((v) => +v.toFixed(2)) }; break; }
    }
    const [fx, fy, fz] = c.feetPosition();
    results.forward = {
      blocked: driver.blocked,
      stairBlocked,
      stuckOutside,
      feetY: +fy.toFixed(3),
      stop: [+fx.toFixed(1), +fz.toFixed(1)],
      finalLocalZ: +localZ(fx, fz).toFixed(2),
      stairFootLocalZ: -39.9,
      maxJointStallS: +stall.maxStallS.toFixed(2),
      stallWhere: stall.where,
      pass: !driver.blocked && fy >= -0.05 && localZ(fx, fz) <= -39.4 && stall.maxStallS <= 1.0,
    };
    // return: stair foot -> back east to the tail start
    const back = new CruiseDriver({ controller: c, waypoints: [...route.mainStreet].reverse(), reachRadius: 1.6, timeoutSteps: 60 * 900 });
    guard = 60 * 1200;
    while (!back.done && guard-- > 0) { back.tick(dt); c.step(dt); }
    const w0 = route.mainStreet[0];
    const [rx, ry, rz] = c.feetPosition();
    results.return = {
      done: back.done, feetY: +ry.toFixed(3),
      stop: [+rx.toFixed(1), +rz.toFixed(1)], target: [+w0[0].toFixed(1), +w0[2].toFixed(1)],
      pass: back.done && Math.hypot(rx - w0[0], rz - w0[2]) < 3.5 && ry >= -0.05,
    };
  }
  // negatives (route.json contract; each its own capsule, forward input only)
  const mk = (x, z) => new WalkController({ RAPIER, physics: session.physics, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
  const runNeg = (neg, dir, seconds) => {
    const c = mk(neg.spawn[0], neg.spawn[2]);
    const start = c.feetPosition();
    c.yaw = Math.atan2(-dir[0], -dir[2]);
    for (let i = 0; i < Math.round(seconds / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const f = c.feetPosition();
    const out = {
      spawn: neg.spawn,
      final: [+f[0].toFixed(2), +f[2].toFixed(2)],
      advanced: +Math.hypot(f[0] - start[0], f[2] - start[2]).toFixed(2),
      feetY: +f[1].toFixed(3),
    };
    c.dispose();
    return out;
  };
  {
    const n = route.negatives[0];
    const r = runNeg(n, n.dir, 4);
    r.assert = n.assert;
    r.pass = r.final[0] > n.barrierX - 0.2 && r.feetY >= -0.05;
    results.sealWall = r;
  }
  {
    // stops AT the placeholder box: OBB surface distance in (0, maxObbGapM]
    // (the capsule may slide along the rotated face — never inside it)
    const n = route.negatives[1];
    const r = runNeg(n, n.dir, 4);
    const b = shopOBB['shop-165'];
    const dx = r.final[0] - b.x, dz = r.final[1] - b.z;
    const lx = Math.cos(b.theta) * dx - Math.sin(b.theta) * dz;
    const lz = Math.sin(b.theta) * dx + Math.cos(b.theta) * dz;
    r.obbGapM = +Math.hypot(Math.max(Math.abs(lx) - b.hw, 0), Math.max(Math.abs(lz) - b.hd, 0)).toFixed(3);
    r.assert = n.assert;
    r.pass = r.obbGapM > 0 && r.obbGapM <= n.maxObbGapM && r.feetY >= -0.05;
    results.shopPlaceholder = r;
  }
  {
    // The forecourt's east boundary is OPEN at this z (the spec's presumed
    // placeholder blocker shop-167/169 is suppressed by the temple axis), so
    // the capsule either stops at the wing wall or walks off the edge and
    // falls — the fall itself proves there is no synthetic floor east of the
    // temple (same no-invisible-slab evidence as the S3 band-edge negative).
    const n = route.negatives[2];
    const r = runNeg(n, n.dir, 5);
    r.assert = n.assert;
    r.outcome = r.feetY < -1.0 ? 'fell off the open forecourt edge (no synthetic slab)' : 'stopped';
    r.pass = (r.feetY < -1.0 && r.advanced > 1.0) || (r.feetY >= -0.05 && r.advanced < n.maxAdvancedM);
    results.forecourtEast = r;
  }
  {
    const n = route.negatives[3];
    const r = runNeg(n, n.dir, 4);
    const T = manifest.mapRegistration.templePlacement.translationGlb;
    const YAW = manifest.mapRegistration.templePlacement.yawRad;
    const lz = Math.sin(YAW) * (r.final[0] - T[0]) + Math.cos(YAW) * (r.final[1] - T[2]);
    r.finalLocalZ = +lz.toFixed(3);
    r.assert = n.assert;
    r.pass = r.finalLocalZ > n.localZLimit && r.feetY >= -0.05;
    results.dadianDoors = r;
  }
  const pass = Object.values(results).every((r) => r.pass);
  routeCheck = {
    pass, automatic: true, results,
    summary: `去程${results.forward.pass ? '至台阶脚' : '未达'}(${results.forward.stop.join(',')})`
      + `·返程${results.return.pass ? '达' : '未达'}`
      + `·端墙挡${results.sealWall.pass ? '✓' : '✗'}·占位挡${results.shopPlaceholder.pass ? '✓' : '✗'}`
      + `·前院东界${results.forecourtEast.pass ? '✓' : '✗'}·闭门挡${results.dadianDoors.pass ? '✓' : '✗'}`
      + `·接缝最长停滞${results.forward.maxJointStallS}s`,
    ms: +(performance.now() - t0).toFixed(0),
    waypoints: route.mainStreet.length,
  };
  render();
  notice(pass
    ? '巡游路线检查：全程往返 + 4 负例全部通过（automatic，非人工试玩）。'
    : '巡游路线检查存在失败项，详见记录。');
  return pass;
}

// ---- input wiring (same chain as the sibling pages) ---------------------------
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
window.addEventListener('keydown', (e) => {
  if (mode !== 'walk') return;
  if (e.code === 'KeyV') { setMode('view'); return; }
  if (e.code === 'KeyP') { paused = !paused; if (paused) controller.pause(); else controller.resume(); notice(paused ? '行走已暂停（P 继续）。' : '继续行走。'); render(); return; }
  if (paused) return;
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.code === 'Space') { controller.setJump(true); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { keys.w = keys.a = keys.s = keys.d = false; if (mode === 'walk' && !paused) { paused = true; controller.pause(); } render(); });
renderer.domElement.addEventListener('click', () => { if (mode === 'walk' && !paused && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock(); });
document.addEventListener('mousemove', (e) => {
  if (mode === 'walk' && !paused && document.pointerLockElement === renderer.domElement)
    controller.look(e.movementX * .0023, e.movementY * .0023);
});

// ---- frame loop -----------------------------------------------------------------
let lastT = null;
function frame(t) {
  requestAnimationFrame(frame);
  if (!ready) return;
  const dt = lastT === null ? .016 : Math.min(.25, (t - lastT) / 1000);
  lastT = t;
  if (mode === 'walk' && !paused) {
    if (cruise) {
      if (!cruise.tick(dt)) { lastCruiseStatus = cruise.status(); cruise = null; }
    } else {
      const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), r = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      controller.setMoveInput(f, r);
    }
    controller.step(dt);
  }
  if (mode === 'walk') {
    const eye = controller.eyePosition();
    camera.position.set(...eye);
    applyWalkOrientation(camera, controller.pitch, controller.yaw);
    if (blocks) blocks.update(...controller.feetPosition());
  }
  render();
}

function applyPlaceholderDisplay(visible) {
  const applied = blocks.setPlaceholdersVisible(visible);
  sun.shadow.needsUpdate = true;
  return applied;
}
function syncPlaceholderUi() {
  const box = document.querySelector('#chk-placeholder');
  if (!box) return;
  box.checked = mode === 'walk' ? true : placeholderPref;
  box.disabled = mode === 'walk';
  box.parentElement.classList.toggle('on', mode === 'walk' || placeholderPref);
}

function setupButtons() {
  for (const c of cameras) {
    const b = document.createElement('button');
    b.textContent = c.labelZh ?? c.id;
    b.dataset.view = c.id;
    b.onclick = () => setView(c.id);
    viewsEl.appendChild(b);
  }
  const walkBtn = document.createElement('button');
  walkBtn.id = 'btn-walk';
  walkBtn.textContent = '行走模式';
  walkBtn.onclick = () => setMode(mode === 'walk' ? 'view' : 'walk');
  viewsEl.appendChild(walkBtn);
  const cruiseBtn = document.createElement('button');
  cruiseBtn.textContent = '路线巡游检查（自动）';
  cruiseBtn.onclick = async () => { cruiseBtn.disabled = true; await runRouteCheck(); cruiseBtn.disabled = false; };
  viewsEl.appendChild(cruiseBtn);
  const phLabel = document.createElement('label');
  phLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 9px;border:1px solid #c7c6b9;border-radius:3px;background:#f8f5ed;cursor:pointer;user-select:none';
  const phBox = document.createElement('input');
  phBox.type = 'checkbox';
  phBox.id = 'chk-placeholder';
  phBox.onchange = () => {
    if (mode !== 'view') { phBox.checked = placeholderPref; return; }
    const prev = placeholderPref;
    placeholderPref = phBox.checked;
    try { applyPlaceholderDisplay(placeholderPref); } catch (e) { placeholderPref = prev; phBox.checked = prev; notice('占位显示切换失败：' + e.message); }
    render();
  };
  phLabel.appendChild(phBox);
  phLabel.appendChild(document.createTextNode('占位街区'));
  viewsEl.appendChild(phLabel);
  const clayBtn = document.createElement('button');
  clayBtn.textContent = '灰模';
  clayBtn.onclick = () => {
    clayOn = !clayOn;
    scene.overrideMaterial = clayOn ? clay : null;
    clayBtn.classList.toggle('on', clayOn);
    sun.shadow.needsUpdate = true;
    render();
  };
  viewsEl.appendChild(clayBtn);
  const save = document.createElement('button');
  save.textContent = '保存实测图';
  save.onclick = async () => {
    if (!ready) return;
    render();
    const image = renderer.domElement.toDataURL('image/jpeg', .94);
    const phHidden = mode !== 'walk' && !placeholderPref;
    try {
      await saveEvidence(`${DATASET_TAG}-${selected}-${clayOn ? 'clay' : 'pbr'}${phHidden ? '-noph' : '-ph'}`, image, record());
      notice('当前WebGL画面与数据已保存。');
    } catch (e) { notice(e.message); }
  };
  viewsEl.appendChild(save);
}

// ---- load -----------------------------------------------------------------------
async function load() {
  const t0 = performance.now();
  await RAPIER.init();
  const camContract = await json(BASE + 'cameras.json');
  cameras = camContract.cameras;
  manifest = await json(BASE + 'review-manifest.json');

  session = await loadWorld({ RAPIER, baseUrl: BASE, renderer });
  // manifest.streetCompletion.surface (the west extension) is already inside
  // the session root; the east tail surface + the seal wall load here,
  // byte-checked against the manifest
  const eastTail = manifest.streetCompletion.eastTailSurface;
  const tail = await loadGlbWithStats(eastTail.path, 'east-tail-surface', { renderer, baseUrl: './' });
  if (tail.bytes !== eastTail.bytes) throw new Error(`east tail surface bytes ${tail.bytes} != manifest ${eastTail.bytes}`);
  world.add(tail.root);
  const wallInfo = manifest.westExtension.sealWall;
  const wall = await loadGlbWithStats(wallInfo.path, 'west-seal-wall', { renderer, baseUrl: BASE });
  if (wall.bytes !== wallInfo.bytes) throw new Error(`seal wall bytes ${wall.bytes} != manifest ${wallInfo.bytes}`);
  world.add(wall.root);
  world.add(session.root);

  world.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !(/^(street-kit__|sctail__)/.test(o.name) && /asphalt|stone/.test(o.name));
    o.receiveShadow = true;
    for (const m of [o.material].flat())
      for (const v of Object.values(m)) if (v?.isTexture) v.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  });

  // controller + block lifecycle FIRST (asset blocks load their GLBs here),
  // then the integrity check over the fully assembled scene
  const start = session.route.entries.bridgeStart;
  controller = new WalkController({
    RAPIER, physics: session.physics,
    capsule: { ...session.capsule, spawn: [start[0], session.spawn.y, start[2]] },
  });
  controller.spawnRef = { x: start[0], y: session.spawn.y, z: start[2] };

  blocks = new BlockManager({
    RAPIER, physics: session.physics, views: createBlockViews(scene, session), dataset: session.blocks,
    physicsAlive: () => !session.disposed,
  });
  await blocks.applyReviewed();
  for (const id of blocks.assetBlockIds()) await blocks.applyAssets(id);
  await blocks.loadBlock('block-adjacent-east');
  await blocks.loadBlock('block-adjacent-west');
  blocks.setPlaceholdersVisible(placeholderPref);
  world.updateMatrixWorld(true);

  // honest asset inventory: base assembly + west surface (WorldLoader-checked)
  // + every autoApply asset block (temple axis, refined shops), all matched to
  // manifest bytes/sha — a missing entry fails loudly instead of shipping
  // made-up numbers
  const assetBlocks = session.blocks.blocks.filter((b) => b.kind === 'assets' && b.autoApply);
  const manifestAssets = [
    ...(manifest.eastEdgeAssets?.assets ?? []),
    ...(manifest.streetCompletion?.assets ?? []),
    ...(manifest.templeAxis?.assets ?? []),
  ];
  const assetInfos = assetBlocks.flatMap((b) => (b.assets ?? [])).map((a) => {
    const m = manifestAssets.find((e) => e.id === a.id);
    if (!m) throw new Error(`asset ${a.id}: bytes/sha missing from dataset manifest`);
    return { id: a.id, glb: a.glb, bytes: m.bytes, sha256: m.sha256, triangles: m.triangles ?? 0 };
  });
  session.sceneInventory = loadedSceneAssets(manifest, assetInfos, true);
  const exp = expectedTriangles(manifest.placedTriangles, [
    ...session.sceneInventory.filter((e) => e.kind === 'asset'),
    { kind: 'surface', triangles: manifest.streetCompletion.surface.triangles },   // west surface (WorldLoader-loaded)
    { kind: 'surface', triangles: eastTail.triangles },
    { kind: 'surface', triangles: wallInfo.triangles },
  ]);
  const r = resources();
  if (r.triangles !== exp.total)
    throw new Error(`几何不完整：实际 ${r.triangles} / 预期 ${exp.total}（基础 ${manifest.placedTriangles} + 资产 ${session.sceneInventory.filter((e) => e.kind === 'asset').map((a) => a.id).join(' + ')} + 东西延伸面 + 端墙）`);


  // extra walkable ground OUTSIDE the session trimesh: the east tail surface
  // (sctail__ faces, page-level GLB) + the temple courts (temple-ground__
  // faces inside the assets block). Same production extraction, same visible
  // faces — never an invisible slab.
  const extraMeshes = [];
  world.traverse((o) => {
    if (o.isMesh && o.name.startsWith('sctail__') && GROUND_NODE_RE.test(o.name))
      extraMeshes.push({ name: o.name, positions: o.geometry.attributes.position.array, indices: o.geometry.index ? o.geometry.index.array : null, matrix: o.matrixWorld.elements.slice() });
  });
  const templeGroup = blocks.blocks.get('block-temple-axis')?.reviewed?.group;
  if (templeGroup) templeGroup.traverse((o) => {
    if (o.isMesh && GROUND_NODE_RE.test(o.name))
      extraMeshes.push({ name: o.name, positions: o.geometry.attributes.position.array, indices: o.geometry.index ? o.geometry.index.array : null, matrix: o.matrixWorld.elements.slice() });
  });
  const gt = collectGroundTriangles(extraMeshes);
  addGroundCollider(RAPIER, session.physics.world, gt);

  loadStats = {
    bytesTotal: manifest.worldAssembly.bytes + session.sceneInventory.reduce((s, a) => s + a.bytes, 0) + eastTail.bytes + wallInfo.bytes,
    bytesBase: manifest.worldAssembly.bytes,
    bytesWestSurface: manifest.streetCompletion.surface.bytes,
    bytesEastTail: eastTail.bytes,
    bytesSealWall: wallInfo.bytes,
    bytesTemple: manifest.templeAxis.assets.reduce((s, a) => s + a.bytes, 0),
    bytesShops: manifestAssets.filter((a) => /shop/.test(a.id)).reduce((s, a) => s + a.bytes, 0),
    extraGroundTriangles: gt.triangleCount,
    wallColliders: session.physics.wallCount,
    allAssetsReadyMs: +(performance.now() - t0).toFixed(0),
    fpsNotMeasured: true, localOnly: true,
  };

  setupButtons();
  syncPlaceholderUi();
  setView('shanmen-from-road');
  const compiledAt = performance.now();
  await renderer.compileAsync(scene, camera);
  loadStats.shaderCompileMs = +(performance.now() - compiledAt).toFixed(0);
  ready = true;
  sun.shadow.needsUpdate = true;
  render();
  requestAnimationFrame(frame);
  notice('桥接世界已载入 · 取景模式。「行走模式」从东尾落入街面，「路线巡游检查（自动）」走全程物理链（automatic，非人工试玩）。');
  await runRouteCheck();
  window.__fangbangRecord = record;
}

load().catch((e) => {
  stats.textContent = '载入失败：' + e.message;
  notice('未取得完整场景，不计为验证通过。');
  console.error(e);
});
window.addEventListener('pagehide', () => {
  controls.dispose();
  if (controller) controller.dispose();
  if (blocks) blocks.dispose();
  if (session) session.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
});
