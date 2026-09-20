// Fangbang ↔ temple BRIDGE viewer (fangbang.html) — player-experience batch A
// (20260920) rebuild of the page shell around the SAME world assembly:
//   street assembly + west/east extension surfaces + temple axis blocks +
//   placeholder districts + lanes (v5), single wall authority from the
//   dataset collision-world.json, integrity checks unchanged.
// What this batch changed:
//   1. the canvas renders at the container's REAL CSS size (drawingBuffer =
//      CSS × pixelRatio, ratio capped [1, 1.5]) with a ResizeObserver — the
//      old page never called setSize and shipped the 300×150 default.
//   2. view mode renders ON DEMAND (orbit change / resize / panel events);
//      resource stats and the record pre are recomputed only when dirty or
//      (while walking) on a 1s tick — never per frame. Walk stays one RAF +
//      fixed-step physics through WalkController, the single authority.
//   3. players get a clean entry (开始探索 + explicit start points); the 19
//      engineering cameras, clay, placeholders, auto cruise, stats and the
//      asset record live in the default-closed 审查工具 panel.
//   4. walk entry uses VALIDATED safe anchors derived from route.json; view
//      ↔ walk preserves the in-world pose (a mode switch is not a new game);
//      P/Esc/pointer-lock loss pause cleanly with no sticky keys.
// The route cruise is AUTOMATIC and honestly labeled (manualWalkClaim:false)
// — manual full play stays the lead's browser check.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';

import { loadWorld, CAPSULE } from './world/WorldLoader.js';
import { addWallCollider } from './world/physics.js';
import { GROUND_NODE_RE } from './world/collisionAdapter.js';
import { collectGroundTriangles } from './world/groundExtractor.js';
import { addGroundCollider } from './world/physics.js';
import { WalkController } from './player/WalkController.js';
import { applyWalkOrientation } from './player/walkCamera.js';
import { CruiseDriver } from './player/cruise.js';
import { BlockManager } from './world/BlockManager.js';
import { createBlockViews } from './world/blockViews.js';
import { loadedSceneAssets, expectedTriangles } from './world/sceneAssets.js';
import { compressedEnabled, installCompressedFetch } from './world/compressedState.js';
import { applyViewVerified, loadGlbWithStats, saveEvidence, countResources } from './templeViewShared.js';
import { resolvePixelRatio, applyCanvasFit } from './player/canvasFit.js';
import {
  STORE_KEY, SCHEMA_VERSION, FramingError,
  validateView, decodeStore, loadViews, addView, mergeViews, removeView, findView,
} from './framingTools.js';
import { deriveEntryAnchors, validateAnchor } from './player/entryAnchors.js';
import { WalkSession } from './player/walkSession.js';
import { describeLoadError } from './worldPreview/loadErrorText.js';

const app = document.querySelector('#app'), stats = document.querySelector('#stats'),
  viewsEl = document.querySelector('#views'), noticeEl = document.querySelector('#notice'),
  introEl = document.querySelector('#intro'), stageEl = document.querySelector('#stage'),
  startBtn = document.querySelector('#btn-start'), locationsEl = document.querySelector('#locations'),
  locationsWalkEl = document.querySelector('#locations-walk'), hudEl = document.querySelector('#hud'),
  hudState = document.querySelector('#hud-state'), reviewEl = document.querySelector('#review'),
  engLog = document.querySelector('#eng-log');

// ?ds=<dataset> selects the world dataset (default 'fangbang-temple').
// ?dpr=<1..1.5> render ratio (default 1). ?review=1 opens the review panel.
const PARAMS = new URLSearchParams(location.search);
const DATASET_ID = PARAMS.get('ds') || 'fangbang-temple';
const WANT_SKINS = PARAMS.get('skins') === '1';
const WANT_PROPS = PARAMS.get('props') === '1';
export let COMPRESSED = compressedEnabled(PARAMS);
const BASE = `./world/${DATASET_ID}/`;
const DATASET_TAG = DATASET_ID === 'fangbang-temple' ? 'fangbang' : `fangbang-${DATASET_ID}`;
const PIXEL_RATIO = resolvePixelRatio(PARAMS.get('dpr'));

// ---- loading stages (#6): real stages, no invented percentages --------------
function setStage(text) {
  if (stageEl) stageEl.textContent = text;
  if (stats) stats.textContent = text;
}
function engNote(text) {
  if (engLog) engLog.textContent += (engLog.textContent ? '\n' : '') + text;
}

// ---- understandable failure states (world-playable-night 20260920) ----------
// A dead init must never masquerade as endless loading: the fatal panel gives
// an actionable message, a user-driven retry (one click = one reload; there is
// no automatic retry loop) and the relative way back to the overview page.
// Technical detail stays folded. Without WebGL the overview and gallery pages
// still work — they carry no 3D. Load-error wording lives in
// src/worldPreview/loadErrorText.js (shared with the batch tests).
function showFatal(title, userMsg, technical) {
  const panel = document.querySelector('#fatal');
  if (!panel) return;
  document.querySelector('#fatal-title').textContent = title;
  document.querySelector('#fatal-msg').textContent = userMsg;
  document.querySelector('#fatal-detail').textContent = technical ?? userMsg;
  document.querySelector('#fatal-retry').onclick = () => location.reload();
  panel.hidden = false;
  if (introEl) introEl.style.display = 'none';
  setStage(title + '：' + userMsg);
}

const renderer = (() => {
  try {
    return new T.WebGLRenderer({ antialias: true });
  } catch (e) {
    showFatal('无法启动三维画面',
      '当前浏览器或环境未能创建 WebGL。首页与场景图库仍可浏览；如要行走，请换用支持 WebGL 的桌面浏览器后重试。',
      String(e?.stack ?? e));
    throw e;
  }
})();
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.info.autoReset = false;
app.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '方浜中路三维街景');

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

// ---- #1 real canvas fit: buffer = container CSS × ratio, aspect follows ----
let needsRender = true;
const invalidate = () => { needsRender = true; };
function fit() {
  if (!applyCanvasFit(renderer, camera, app.clientWidth, app.clientHeight, PIXEL_RATIO)) return;
  invalidate();
}
fit();
new ResizeObserver(fit).observe(app);
window.addEventListener('resize', fit);

const world = new T.Group();
world.name = 'fangbang-bridge-world';
scene.add(world);
const clay = new T.MeshStandardMaterial({ color: 0xb8b7ae, roughness: .86 });

let session = null, controller = null, blocks = null, cruise = null, skinsStats = null, skInstancesCount = 0, viewLabelOverride = null;
let propsStats = null;   // ?props=1 street life layer stats (E batch)
let mode = 'view', paused = false, ready = false, clayOn = false, selected = null;
let clayBtnEl = null;
function applyClay() {
  scene.overrideMaterial = clayOn ? clay : null;
  if (clayBtnEl) clayBtnEl.classList.toggle('on', clayOn);
  sun.shadow.needsUpdate = true;
  markResourcesDirty();
  invalidate();
  refreshRecord(performance.now(), true);
}
let cameras = [], manifest = null, loadStats = {};
let routeCheck = null, cameraCheck = null, resetCount = 0, lastCruiseStatus = null;
let walk = null, safeAnchors = [];   // WalkSession + validated entry anchors
let lastViewFov = 55;
let placeholderPref = true;   // the gray placeholder districts ARE this page's context
const keys = { w: false, a: false, s: false, d: false };

// ---- #2 on-demand rendering + throttled stats/record ------------------------
let resCache = null, resDirty = true;
controls.addEventListener('change', invalidate);
const ensureResources = () => { if (resDirty || resCache === null) { resCache = countResources(world, clay); resDirty = false; } };
const markResourcesDirty = () => { resDirty = true; };
let lastHudAt = 0, lastRecordAt = 0;
function refreshHud(nowMs, force = false) {
  if (!force && nowMs - lastHudAt < 300) return;
  lastHudAt = nowMs;
  if (mode === 'walk') {
    hudState.textContent = paused
      ? '已暂停 · P 或点击画面继续 · V 返回取景 · Esc 释放鼠标'
      : `位置 ${controller.feetPosition()[0].toFixed(1)}, ${controller.feetPosition()[2].toFixed(1)} · P 暂停 · V 返回取景 · Esc 释放鼠标`;
  }
}
function refreshRecord(nowMs, force = false) {
  if (!force && nowMs - lastRecordAt < 1000) return;
  lastRecordAt = nowMs;
  if (mode === 'walk') markResourcesDirty();   // block lifecycle may have swapped geometry
  ensureResources();
  stats.textContent = mode === 'walk'
    ? `行走模式 · 脚底 (${controller.feetPosition().map((v) => v.toFixed(1)).join(', ')}) ${paused ? '· 已暂停' : ''}`
    : `${resCache.triangles.toLocaleString()} 三角形 · 几何/材质/纹理 ${resCache.uniqueGeometries}/${resCache.uniqueMaterials}/${resCache.uniqueTextures}\n`
      + `本机资产 ${((loadStats.bytesTotal || 0) / 1e6).toFixed(2)} MB · 街道装配+东西延伸+庙轴线+占位街区\n`
      + `巡游 ${routeCheck ? (routeCheck.pass ? 'PASS ' + routeCheck.summary : 'FAIL ' + (routeCheck.summary || routeCheck.error)) : '—（自动执行，非人工试玩）'}`;
  document.querySelector('#record').textContent = JSON.stringify(record(), null, 2);
}

function record() {
  ensureResources();
  const snap = walk ? walk.snapshot() : null;
  return {
    dataset: DATASET_ID, view: selected, mode, paused, clay: clayOn, ready,
    skins: skinsStats, propsStats,
    resources: resCache,
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
      session: snap ? { mode: snap.mode, paused: snap.paused, spawnCount: snap.spawnCount,
        explicitRelocations: snap.relocations, pose: snap.pose } : null,
      blocks: blocks ? { active: blocks.activeIds(), epoch: blocks.epoch } : null,
    },
    safeAnchors: safeAnchors.map((a) => ({ id: a.id, labelZh: a.labelZh,
      position: a.position.map((v) => +v.toFixed(3)), yawRad: +(a.yaw ?? 0).toFixed(4),
      source: a.source, validation: a.validation })),
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
    framebuffer: [renderer.domElement.width, renderer.domElement.height],
    framebufferCss: [app.clientWidth, app.clientHeight],
    pixelRatio: PIXEL_RATIO,
    lighting: { shadows: renderer.shadowMap.enabled, toneMapping: 'AgX', exposure: 1, sunIntensity: 2.4 },
  };
}
let lastRender = {};

// The raw draw only: submit the scene, sample renderer.info. No traversals,
// no DOM writes — those live in the throttled refreshers above.
function render() {
  if (!ready) return;
  const near = mode === 'view' ? Math.max(.05, Math.min(2, camera.position.distanceTo(controls.target) * .003)) : .1;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  renderer.info.reset();
  const started = performance.now();
  renderer.render(scene, camera);
  lastRender = { callsIncludingShadow: renderer.info.render.calls, trianglesIncludingShadow: renderer.info.render.triangles, cpuSubmitMs: +(performance.now() - started).toFixed(2) };
}

function setView(id) {
  const v = cameras.find((c) => c.id === id);
  if (!v) return;
  if (mode === 'walk') exitWalk();
  selected = id;
  camera.aspect = app.clientWidth / app.clientHeight;
  cameraCheck = applyViewVerified(camera, controls, v);
  lastViewFov = v.verticalFovDegrees;
  for (const b of viewsEl.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === id);
  markResourcesDirty();
  render();
  refreshRecord(performance.now(), true);
}

function notice(text) { noticeEl.textContent = text; }

// ---- walk mode (#4): validated anchors + pose-preserving session -------------
function resetController(countsAsReset) {
  const s = controller.spawnRef;
  controller.teleport([s.x, s.y, s.z], Math.PI / 2, 0);   // face west (-X), down the bridge route
  controller.resume();
  cruise = null;
  if (countsAsReset) resetCount++;
}

function enterWalk() {
  if (!ready || !controller || !walk || mode === 'walk') return;
  const r = walk.beginWalk(controller, camera.position.toArray());
  if (!r) return;
  if (r.spawned === null && r.error) { notice('暂无可用的安全落脚点，请稍候重试。'); return; }
  if (r.spawned?.reason === 'explicit-choice') {
    // Locked-core compensation (world-ten-hour 20260921, walkthrough UP-B1):
    // WalkSession.beginWalk's pending-anchor branch never sets everWalked, so
    // the next 取景→行走 entry re-spawned at the anchor instead of restoring
    // the pose — breaking the session contract ("a mode switch is not a new
    // game") and the exitWalk notice 「从当前位置继续」. src/player is locked
    // (protection baseline), so the page closes the gap at the call site.
    walk.everWalked = true;
  }
  mode = 'walk';
  paused = false;
  camera.fov = 68;
  camera.updateProjectionMatrix();
  controls.enabled = false;
  introEl.style.display = 'none';
  hudEl.hidden = false;
  renderer.domElement.requestPointerLock?.();
  if (r.spawned) {
    const { labelZh, displaced } = r.spawned;
    notice(displaced
      ? `取景位置不在可行走地面，已从最近的安全入口「${labelZh}」进入。`
      : `从「${labelZh}」开始探索。`);
  } else {
    notice('继续上一次的位置行走。');
  }
  syncChips();
  syncFramingButton();
  sun.shadow.needsUpdate = true;
  markResourcesDirty();
  invalidate();
  refreshHud(performance.now(), true);
  refreshRecord(performance.now(), true);
}

function exitWalk() {
  if (mode !== 'walk') return;
  walk.endWalk(controller);
  mode = 'view';
  paused = false;
  cruise = null;
  keys.w = keys.a = keys.s = keys.d = false;
  document.exitPointerLock?.();
  controls.enabled = true;
  // keep the player's spot: orbit continues from where they stand
  camera.fov = lastViewFov;
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  controls.target.copy(camera.position).addScaledVector(fwd, 8);
  controls.update();
  hudEl.hidden = true;
  syncChips();
  syncFramingButton();
  // accurate state: the pose is kept, only the mode changed — never claim a reset
  notice('已切换到取景；点击「行走」从当前位置继续。');
  sun.shadow.needsUpdate = true;
  markResourcesDirty();
  invalidate();
  refreshRecord(performance.now(), true);
}

// explicit location choice: a TELEPORT, recorded as relocation (never walk
// evidence). While viewing it also previews the location's framing camera.
function pickLocation(id) {
  if (!walk || mode !== 'view' && mode !== 'walk') return;
  const anchor = safeAnchors.find((a) => a.id === id && a.validation?.ok);
  if (!anchor) return;
  const r = walk.relocate(controller, id);
  if (!r.ok) return;
  if (mode === 'view') {
    const previewView = LOCATION_VIEWS[id]?.find((v) => cameras.some((c) => c.id === v));
    if (previewView) setView(previewView);
  }
  notice(mode === 'walk' ? `已移动到「${anchor.labelZh}」口（显式定位）。` : `出发点已设为「${anchor.labelZh}」。`);
  resetCount++;   // explicit relocation is a spawn change, honestly counted
  refreshHud(performance.now(), true);
  refreshRecord(performance.now(), true);
}
const LOCATION_VIEWS = {
  mainStreet: ['east-junction', 'junction-west'],
  templeFront: ['shanmen-from-road'],
  laneA: ['lane-a-street-look-in'],
  laneB: ['lane-b-street-look-in'],
};

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
    // stay covered by the dadian-doors negative.
    const T = manifest.mapRegistration.templePlacement.translationGlb;
    const YAW = manifest.mapRegistration.templePlacement.yawRad;
    const CY = Math.cos(YAW), SY = Math.sin(YAW);
    const localZ = (wx, wz) => SY * (wx - T[0]) + CY * (wz - T[2]);
    const c = controller;
    resetController(false);
    const driver = new CruiseDriver({ controller: c, waypoints: route.mainStreet, reachRadius: 1.4, timeoutSteps: 60 * 900 });
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
    // R1-03: keep pushing after the last waypoint — the capsule climbs the
    // platform via the cruise path and the CLOSED DOORS are the terminus
    let lastP = c.feetPosition(), doorStill = 0;
    const T3 = manifest.mapRegistration.templePlacement.translationGlb;
    const Y3 = manifest.mapRegistration.templePlacement.yawRad;
    const doorW = [T3[0] + Math.sin(Y3) * route.stair.terminusLocalZ, 0, T3[2] + Math.cos(Y3) * route.stair.terminusLocalZ];
    for (let i = 0; i < Math.round(40 / dt); i++) {
      const dx = doorW[0] - c.feetPosition()[0], dz = doorW[2] - c.feetPosition()[2];
      c.yaw = Math.atan2(-dx, -dz);
      c.setMoveInput(1, 0);
      c.step(dt);
      const p = c.feetPosition();
      if (p[1] < -0.05) break;
      if (Math.hypot(p[0] - lastP[0], p[2] - lastP[2]) < 0.008) {
        doorStill += dt;
        if (doorStill > 1.0) break;
      } else doorStill = 0;
      lastP = p;
    }
    const [fx, fy, fz] = c.feetPosition();
    const lzEnd = localZ(fx, fz);
    results.forward = {
      blocked: driver.blocked,
      stuckOutside,
      feetY: +fy.toFixed(3),
      stop: [+fx.toFixed(1), +fz.toFixed(1)],
      finalLocalZ: +lzEnd.toFixed(3),
      terminusLocalZ: route.stair.terminusLocalZ,
      maxJointStallS: +stall.maxStallS.toFixed(2),
      stallWhere: stall.where,
      pass: !driver.blocked && fy >= -0.05 && Math.abs(lzEnd - route.stair.terminusLocalZ) <= route.stair.terminusToleranceM && stall.maxStallS <= 1.0,
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
  const negs = Object.fromEntries(route.negatives.map((n) => [n.id, n]));
  {
    const n = negs['seal-wall'];
    const r = runNeg(n, n.dir, 4);
    r.assert = n.assert;
    r.pass = r.final[0] > n.barrierX - 0.2 && r.feetY >= -0.05;
    results.sealWall = r;
  }
  if (negs['shop-165-placeholder']) {
    const n = negs['shop-165-placeholder'];
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
    const n = negs['forecourt-east'];
    const r = runNeg(n, n.dir, 5);
    r.assert = n.assert;
    r.pass = r.advanced < n.maxAdvancedM && r.feetY >= -0.05;
    results.forecourtEast = r;
  }
  {
    const n = negs['dadian-doors'];
    const r = runNeg(n, n.dir, 4);
    const T = manifest.mapRegistration.templePlacement.translationGlb;
    const YAW = manifest.mapRegistration.templePlacement.yawRad;
    const lz = Math.sin(YAW) * (r.final[0] - T[0]) + Math.cos(YAW) * (r.final[1] - T[2]);
    r.finalLocalZ = +lz.toFixed(3);
    r.assert = n.assert;
    r.pass = r.finalLocalZ > n.localZLimit && r.feetY >= -0.05;
    results.dadianDoors = r;
  }
  if (negs['westshop-facade']) {
    const n = negs['westshop-facade'];
    const r = runNeg(n, n.dir, 4);
    r.assert = n.assert;
    r.pass = r.advanced < n.maxAdvancedM && r.feetY >= -0.05;
    results.westshopFacade = r;
  }
  if (negs['weststrip-wall']) {
    const n = negs['weststrip-wall'];
    const r = runNeg(n, n.dir, 4);
    r.assert = n.assert;
    r.pass = r.advanced < n.maxAdvancedM && r.feetY >= -0.05;
    results.weststripWall = r;
  }
  const negResults = [results.shopPlaceholder, results.westshopFacade, results.weststripWall]
    .filter(Boolean);
  const negCount = [results.sealWall, ...negResults, results.forecourtEast, results.dadianDoors].length;
  const negLabels = [
    `端墙挡${results.sealWall.pass ? '✓' : '✗'}`,
    results.shopPlaceholder ? `占位挡${results.shopPlaceholder.pass ? '✓' : '✗'}` : null,
    results.westshopFacade ? `店面挡${results.westshopFacade.pass ? '✓' : '✗'}` : null,
    results.weststripWall ? `条带挡${results.weststripWall.pass ? '✓' : '✗'}` : null,
    `前院东界${results.forecourtEast.pass ? '✓' : '✗'}·闭门挡${results.dadianDoors.pass ? '✓' : '✗'}`,
  ].filter(Boolean).join('·');
  const pass = Object.values(results).every((r) => r.pass);
  routeCheck = {
    pass, automatic: true, results,
    summary: `去程${results.forward.pass ? '至闭门前' : '未达'}(z_local=${results.forward.finalLocalZ})`
      + `·返程${results.return.pass ? '达' : '未达'}`
      + `·${negLabels}`
      + `·接缝最长停滞${results.forward.maxJointStallS}s`,
    ms: +(performance.now() - t0).toFixed(0),
    waypoints: route.mainStreet.length,
  };
  engNote(`巡游路线检查：${pass ? `全程往返 + ${negCount} 负例全部通过` : '存在失败项'}（automatic，非人工试玩）。`);
  if (!pass) notice('路线自检发现异常，详见审查工具。');
  markResourcesDirty();
  invalidate();
  refreshRecord(performance.now(), true);
  return pass;
}

// ---- input wiring --------------------------------------------------------------
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
window.addEventListener('keydown', (e) => {
  if (mode !== 'walk') return;
  if (e.code === 'KeyV') { exitWalk(); return; }
  if (e.code === 'KeyP') {
    const r = paused ? walk.resume(controller) : walk.pause(controller, 'user');
    if (r.changed) {
      paused = r.paused;
      notice(paused ? '行走已暂停（P 或点击画面继续）。' : '继续行走。');
      refreshHud(performance.now(), true);
      invalidate();
    }
    return;
  }
  if (paused) return;
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.code === 'Space') { controller.setJump(true); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => {
  keys.w = keys.a = keys.s = keys.d = false;
  if (mode === 'walk' && walk) {
    const r = walk.blur(controller);
    if (r.changed) { paused = true; notice('窗口失去焦点，行走已暂停（P 或点击画面继续）。'); refreshHud(performance.now(), true); invalidate(); }
  }
});
// Esc releases the pointer lock -> pause here (never lose the spot, never
// leave mouse-look half-armed)
document.addEventListener('pointerlockchange', () => {
  if (mode === 'walk' && !paused && document.pointerLockElement !== renderer.domElement) {
    const r = walk.pointerLockLost(controller);
    if (r.changed) { paused = true; notice('已释放鼠标：点击画面或按 P 继续行走。'); refreshHud(performance.now(), true); invalidate(); }
  }
});
renderer.domElement.addEventListener('click', () => {
  if (mode !== 'walk') return;
  if (paused) {
    const r = walk.resume(controller);
    if (r.changed) paused = false;
    refreshHud(performance.now(), true);
  }
  if (!paused && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
});
document.addEventListener('mousemove', (e) => {
  if (mode === 'walk' && !paused && document.pointerLockElement === renderer.domElement)
    controller.look(e.movementX * .0023, e.movementY * .0023);
});

// ---- frame loop: ONE RAF; walk = fixed-step physics + continuous draw;
//      view = render only when something changed -----------------------------
let lastT = null;
function frame(t) {
  requestAnimationFrame(frame);
  if (!ready) return;
  const dt = lastT === null ? .016 : Math.min(.25, (t - lastT) / 1000);
  lastT = t;
  const walking = mode === 'walk';
  if (walking && !paused) {
    if (cruise) {
      if (!cruise.tick(dt)) { lastCruiseStatus = cruise.status(); cruise = null; }
    } else {
      const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), r = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      controller.setMoveInput(f, r);
    }
    controller.step(dt);
    const eye = controller.eyePosition();
    camera.position.set(...eye);
    applyWalkOrientation(camera, controller.pitch, controller.yaw);
    if (blocks) blocks.update(...controller.feetPosition());
    refreshHud(t);
    refreshRecord(t);
  }
  if ((walking && !paused) || needsRender) {
    needsRender = false;
    render();
  }
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
function syncChips() {
  const show = mode === 'walk';
  locationsWalkEl.style.display = show ? 'flex' : 'none';
  syncFramingPanel();
}
// the framing tool exists only in view mode (restore is an explicit framing
// act; saving mid-walk has no meaning) and only once the world is ready
function syncFramingPanel() {
  const el = document.querySelector('#framing');
  if (el) el.hidden = !(ready && mode === 'view');
}
function syncFramingButton() {
  const b = document.querySelector('#btn-framing');
  if (!b) return;
  b.textContent = mode === 'walk' ? '取景' : (introEl.style.display === 'none' ? '行走' : '取景');
}

function setupButtons() {
  for (const c of cameras) {
    const b = document.createElement('button');
    b.textContent = c.labelZh ?? c.id;
    b.dataset.view = c.id;
    b.onclick = () => setView(c.id);
    viewsEl.appendChild(b);
  }
  const toolsEl = document.querySelector('#tools');
  const walkBtn = document.createElement('button');
  walkBtn.id = 'btn-walk';
  walkBtn.textContent = '行走模式';
  walkBtn.onclick = () => (mode === 'walk' ? exitWalk() : enterWalk());
  toolsEl.appendChild(walkBtn);
  const cruiseBtn = document.createElement('button');
  cruiseBtn.textContent = '路线巡游检查（自动）';
  cruiseBtn.onclick = async () => { cruiseBtn.disabled = true; await runRouteCheck(); cruiseBtn.disabled = false; };
  toolsEl.appendChild(cruiseBtn);
  const phLabel = document.createElement('label');
  const phBox = document.createElement('input');
  phBox.type = 'checkbox';
  phBox.id = 'chk-placeholder';
  phBox.onchange = () => {
    if (mode !== 'view') { phBox.checked = placeholderPref; return; }
    const prev = placeholderPref;
    placeholderPref = phBox.checked;
    try { applyPlaceholderDisplay(placeholderPref); } catch (e) { placeholderPref = prev; phBox.checked = prev; notice('占位显示切换失败：' + e.message); }
    markResourcesDirty();
    invalidate();
    refreshRecord(performance.now(), true);
  };
  phLabel.appendChild(phBox);
  phLabel.appendChild(document.createTextNode('占位街区'));
  toolsEl.appendChild(phLabel);
  const clayBtn = document.createElement('button');
  clayBtn.textContent = '灰模';
  clayBtn.onclick = () => {
    clayOn = !clayOn;
    applyClay();
  };
  clayBtnEl = clayBtn;
  toolsEl.appendChild(clayBtn);
  const save = document.createElement('button');
  save.textContent = '保存实测图';
  save.onclick = async () => {
    if (!ready) return;
    markResourcesDirty();
    render();
    const image = renderer.domElement.toDataURL('image/jpeg', .94);
    const phHidden = mode !== 'walk' && !placeholderPref;
    try {
      await saveEvidence(`${DATASET_TAG}-${viewLabelOverride ?? selected}-${clayOn ? 'clay' : 'pbr'}${phHidden ? '-noph' : '-ph'}`, image, record());
      notice('当前WebGL画面与数据已保存。');
    } catch (e) { notice(e.message); }
  };
  toolsEl.appendChild(save);
}

function setupPlayerUi() {
  startBtn.onclick = () => enterWalk();
  document.querySelector('#btn-framing').onclick = () => {
    if (mode === 'walk') { exitWalk(); return; }
    if (introEl.style.display !== 'none') { introEl.style.display = 'none'; syncFramingButton(); notice('自由取景：拖动旋转，滚轮缩放。「行走」进入街面。'); return; }
    enterWalk();
  };
  document.querySelector('#btn-help').onclick = () => { document.querySelector('#help').hidden = false; };
  document.querySelector('#help-close').onclick = () => { document.querySelector('#help').hidden = true; };
  document.querySelector('#btn-review').onclick = () => { reviewEl.open = !reviewEl.open; fit(); };
  reviewEl.addEventListener('toggle', () => { markResourcesDirty(); invalidate(); fit(); refreshRecord(performance.now(), true); });
  if (PARAMS.get('review') === '1') reviewEl.open = true;
  const mkChip = (a) => {
    const b = document.createElement('button');
    b.textContent = a.labelZh;
    b.dataset.location = a.id;
    b.onclick = () => pickLocation(a.id);
    return b;
  };
  const valid = safeAnchors.filter((a) => a.validation?.ok);
  for (const a of valid) {
    locationsEl.appendChild(mkChip(a));
    locationsWalkEl.appendChild(mkChip(a));
  }
  if (!valid.length) document.querySelector('#intro .loc-label').textContent = '出发点（载入后自动选择安全入口）';
}

// ---- framing tools (world-ten-hour 20260921, PLAN task C) -----------------------
// Save / restore / import / export of player camera poses in VIEW mode. All
// validation lives in src/framingTools.js (node-tested); this wiring only
// applies validated data to the camera and never feeds it to the walk physics.
// Restoring is an explicit framing act — never recorded as walking evidence.
const FRAMING_PRESETS = [
  { id: 'east-junction', note: '主街东接口望西（样段纵深起点）' },
  { id: 'junction-west', note: '主街西口回望拼接处' },
  { id: 'lane-a-street-look-in', note: 'A弄街口望入（窄门洞纵深）' },
  { id: 'lane-b-street-look-in', note: 'B弄街口望入' },
  { id: 'lane-b-return', note: 'B弄尽端回望主街' },
  { id: 'shanmen-from-road', note: '方浜路中线正望山门' },
];
let ftViews = [];            // validated saves for THIS dataset (session + localStorage)
let ftStorageOk = true;
let ftConfirmDeleteId = null;
let ftConfirmTimer = null;

function ftEls() {
  return {
    panel: document.querySelector('#framing'), name: document.querySelector('#ft-name'),
    save: document.querySelector('#ft-save'), presets: document.querySelector('#ft-presets'),
    list: document.querySelector('#ft-list'), empty: document.querySelector('#ft-empty'),
    error: document.querySelector('#ft-error'), png: document.querySelector('#ft-png'),
    exportJson: document.querySelector('#ft-export-json'), importBtn: document.querySelector('#ft-import-btn'),
    importFile: document.querySelector('#ft-import-file'),
  };
}
function ftError(msg) {
  const { error } = ftEls();
  error.textContent = msg || '';
  error.hidden = !msg;
  if (msg) { clearTimeout(ftError.t); ftError.t = setTimeout(() => { error.hidden = true; }, 8000); }
}
function ftPersist() {
  if (!ftStorageOk) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ storeVersion: SCHEMA_VERSION, views: ftViews }));
  } catch {
    ftStorageOk = false;
    ftError('本机存储不可用（隐私模式？）：机位仅保留到页面关闭。');
  }
}
function ftRefreshList() {
  const { list, empty } = ftEls();
  list.textContent = '';
  empty.hidden = ftViews.length > 0;
  for (const v of ftViews) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = v.name;
    label.title = `pos ${v.position.map((n) => n.toFixed(1)).join(', ')} · target ${v.target.map((n) => n.toFixed(1)).join(', ')} · fov ${v.fovDeg}`;
    const meta = document.createElement('span');
    meta.className = 'ft-meta';
    meta.textContent = `fov ${Math.round(v.fovDeg)}°${v.display.clay ? ' · 灰模' : ''}`;
    const use = document.createElement('button');
    use.type = 'button'; use.textContent = '恢复';
    use.onclick = () => ftRestore(v.id);
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '删除';
    del.onclick = () => ftDelete(v.id, del);
    li.append(label, meta, use, del);
    list.appendChild(li);
  }
}
function ftCurrentRaw(name) {
  return {
    schemaVersion: SCHEMA_VERSION, dataset: DATASET_ID, name,
    position: camera.position.toArray(), target: controls.target.toArray(),
    fovDeg: camera.fov, display: { clay: clayOn }, createdAt: Date.now(),
  };
}
function ftSanitizeName(s) {
  return s.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'view';
}
async function ftPngNonBlank(dataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('画面读取失败')); img.src = dataUrl; });
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  if (!g) return true;
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  const colors = new Set();
  for (let i = 0; i < d.length; i += 4) colors.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
  return colors.size >= 4;   // blank/black frames have ~1–2 buckets
}
function setupFramingTools() {
  const { panel, name, save, presets, png, exportJson, importBtn, importFile } = ftEls();
  // persisted saves (this dataset only; foreign-dataset entries are skipped visibly)
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const { views, errors } = loadViews(decodeStore(raw), DATASET_ID);
      ftViews = views;
      ftRefreshList();
      if (errors.length)
        ftError(`已跳过 ${errors.length} 条无法识别的已存机位：\n` + errors.map((e) => `· ${e.name ?? `#${e.index}`}：${e.error}`).join('\n'));
    }
  } catch (e) {
    ftStorageOk = false;
    ftError(`已存机位读取失败：${e.message}`);
  }
  for (const p of FRAMING_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.note; b.title = `工程机位 ${p.id}`;
    b.onclick = () => { setView(p.id); };
    presets.appendChild(b);
  }
  save.onclick = () => {
    if (mode !== 'view') { ftError('保存机位是取景操作：先按 V 返回取景。'); return; }
    const chosen = name.value.trim() || `机位-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    try {
      const v = validateView(ftCurrentRaw(chosen), DATASET_ID);
      const { views, view: stored } = addView(ftViews, { ...v, id: null });
      ftViews = views;
      ftPersist();
      ftRefreshList();
      ftError('');
      notice(`机位「${stored.name}」已保存（仅本机浏览器）。`);
    } catch (e) { ftError(e.message); }
  };
  png.onclick = async () => {
    if (mode !== 'view') { ftError('导出画面是取景操作：先按 V 返回取景。'); return; }
    try {
      markResourcesDirty();
      render();   // the exported pixels ARE this frame's WebGL output
      const dataUrl = renderer.domElement.toDataURL('image/png');
      if (!(await ftPngNonBlank(dataUrl))) { ftError('本帧画面为空（未渲染或全黑），已取消导出。'); return; }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `fangbang-framing-${ftSanitizeName(name.value || 'view')}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.png`;
      a.click();
      notice('当前画面已导出 PNG（画布原分辨率）。');
    } catch (e) { ftError(`导出失败：${e.message}`); }
  };
  exportJson.onclick = () => {
    if (!ftViews.length) { ftError('还没有已存机位可导出。'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ storeVersion: SCHEMA_VERSION, views: ftViews }, null, 1) + '\n'], { type: 'application/json' }));
    a.download = `fangbang-framing-views-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    notice(`已导出 ${ftViews.length} 个机位（JSON）。`);
  };
  importBtn.onclick = () => importFile.click();
  importFile.onchange = async () => {
    const file = importFile.files?.[0];
    importFile.value = '';   // allow re-choosing the same file
    if (!file) return;
    try {
      const text = await file.text();
      const { views, added, errors } = mergeViews(ftViews, decodeStore(text), DATASET_ID);
      ftViews = views;
      ftPersist();
      ftRefreshList();
      ftError(errors.length
        ? `已导入 ${added.length} 条，跳过 ${errors.length} 条：\n` + errors.map((e) => `· ${e.name ?? `#${e.index}`}：${e.error}`).join('\n')
        : (added.length ? `已导入 ${added.length} 条机位（重名自动加后缀，不覆盖）。` : '载荷里没有可导入的机位。'));
      if (added.length) notice(`已导入 ${added.length} 个机位。`);
    } catch (e) { ftError(`导入失败：${e.message}`); }
  };
  panel.addEventListener('toggle', () => { if (panel.open) { ftConfirmDeleteId = null; invalidate(); } });
}
function ftRestore(id) {
  try {
    if (mode !== 'view') { notice('恢复机位是取景操作：先按 V 返回取景。'); return; }
    const v = findView(ftViews, id);
    camera.position.set(...v.position);
    controls.target.set(...v.target);
    camera.fov = v.fovDeg;
    camera.updateProjectionMatrix();
    controls.update();
    // honest apply check: read back what the camera actually holds
    const drift = Math.max(
      camera.position.distanceTo(new T.Vector3(...v.position)),
      controls.target.distanceTo(new T.Vector3(...v.target)));
    if (drift > 0.01) { ftError(`恢复校验未通过（偏差 ${drift.toFixed(3)}m），未应用。`); return; }
    if (clayBtnEl && v.display.clay !== clayOn) { clayOn = v.display.clay; applyClay(); }
    markResourcesDirty();
    invalidate();
    notice(`已恢复取景机位「${v.name}」（显式定位，非行走）。`);
  } catch (e) { ftError(e.message); }
}
function ftDelete(id, btn) {
  if (ftConfirmDeleteId !== id) {
    ftConfirmDeleteId = id;
    btn.textContent = '确认删除';
    btn.classList.add('confirm');
    clearTimeout(ftConfirmTimer);
    ftConfirmTimer = setTimeout(() => {
      ftConfirmDeleteId = null;
      btn.textContent = '删除';
      btn.classList.remove('confirm');
    }, 3500);
    return;   // first click only arms the confirm — cancelable edit
  }
  clearTimeout(ftConfirmTimer);
  ftConfirmDeleteId = null;
  try {
    ftViews = removeView(ftViews, id);
    ftPersist();
    ftRefreshList();
    notice('机位已删除。');
  } catch (e) { ftError(e.message); }
}

// ---- load -----------------------------------------------------------------------
async function load() {
  const t0 = performance.now();
  setStage('正在初始化物理引擎…');
  await RAPIER.init();
  COMPRESSED = await installCompressedFetch(BASE, COMPRESSED);
  setStage('正在读取桥接世界清单…');
  const camContract = await json(BASE + 'cameras.json');
  cameras = camContract.cameras;
  manifest = await json(BASE + 'review-manifest.json');

  setStage('正在装配街道与延伸面…');
  session = await loadWorld({ RAPIER, baseUrl: BASE, renderer });
  const eastTail = manifest.streetCompletion.eastTailSurface;
  const tail = await loadGlbWithStats(eastTail.path, 'east-tail-surface', { renderer, baseUrl: './' });
  if (tail.bytes !== eastTail.bytes) throw new Error(`east tail surface bytes ${tail.bytes} != manifest ${eastTail.bytes}`);
  world.add(tail.root);
  const wallInfo = manifest.westExtension.sealWall;
  const wall = await loadGlbWithStats(wallInfo.path, 'west-seal-wall', { renderer, baseUrl: BASE });
  if (wall.bytes !== wallInfo.bytes) throw new Error(`seal wall bytes ${wall.bytes} != manifest ${wallInfo.bytes}`);
  world.add(wall.root);
  let eastSurfaceInfo = null, eastWallInfo = null, eastSurface = null, eastWall = null;
  if (manifest.eastExtension?.surface) {
    eastSurfaceInfo = manifest.eastExtension.surface;
    eastSurface = await loadGlbWithStats(eastSurfaceInfo.path, 'east-extension-surface', { renderer, baseUrl: './' });
    if (eastSurface.bytes !== eastSurfaceInfo.bytes) throw new Error(`east extension surface bytes ${eastSurface.bytes} != manifest ${eastSurfaceInfo.bytes}`);
    world.add(eastSurface.root);
    eastWallInfo = manifest.eastExtension.sealWall;
    eastWall = await loadGlbWithStats(eastWallInfo.path, 'east-end-wall', { renderer, baseUrl: BASE });
    if (eastWall.bytes !== eastWallInfo.bytes) throw new Error(`east end wall bytes ${eastWall.bytes} != manifest ${eastWallInfo.bytes}`);
    world.add(eastWall.root);
  }
  world.add(session.root);

  if (WANT_SKINS) {
    setStage('正在贴附沿街立面…');
    const skManifest = await json('./world/street-sidefaces/review-manifest.json');
    const skCollision = await json('./world/street-sidefaces/collision-world.json');
    const skInstances = await json('./world/street-sidefaces/instances.json');
    const skinGLBs = new Map();
    let skinBytes = 0;
    let placedTris = 0;
    const sources = new Map(); // glb -> parsed root (kept OUT of the scene)
    const loadSkinSource = async (k) => {
      if (!sources.has(k.glb)) {
        const sk = await loadGlbWithStats(k.glb, `sideface-${k.id}`, { renderer, baseUrl: './' });
        if (sk.bytes !== k.bytes) throw new Error(`skin ${k.id} bytes ${sk.bytes} != manifest ${k.bytes}`);
        sources.set(k.glb, sk.root);
      }
      return sources.get(k.glb);
    };
    let placedCount = 0;
    for (const i of skInstances.instances) {
      const k = skManifest.skins.find((x) => x.id === i.skin);
      if (!k) throw new Error(`instance ${i.id}: skin ${i.skin} missing from manifest`);
      const src = await loadSkinSource(k);
      const instRoot = src.clone(true);
      if (i.batch === 'A') {
        instRoot.position.set(...i.positionGlb);
        instRoot.rotation.y = i.rotationYRad;
      }
      world.add(instRoot);
      placedTris += k.triangles;
      placedCount++;
    }
    for (const rec of skCollision.colliders) { addWallCollider(RAPIER, session.physics.world, rec); session.physics.wallCount++; }
    skInstancesCount = skInstances.instances.length;
    skinsStats = { count: placedCount, uniqueGlbs: skinGLBs.size,
      bytes: [...skinGLBs.values()].reduce((s2, x) => s2 + x.bytes, 0),
      placedTris,
      triangles: skManifest.triangleAccounting.instancedPlacedTris.actual,
      colliders: skCollision.colliders.length, manifest: skManifest.datasetId };
  }

  if (WANT_PROPS) {
    setStage('正在布置街面物件…');
    const prManifest = await json('./world/street-props/review-manifest.json');
    const prInstances = await json('./world/street-props/instances.json');
    const prCollision = await json('./world/street-props/collision.json');
    const sources = new Map();
    let propsBytes = 0;
    for (const inst of prInstances.instances) {
      const a = prManifest.assets[inst.item];
      if (!a) throw new Error(`props instance ${inst.id}: item ${inst.item} missing`);
      if (!sources.has(inst.item)) {
        const g = await loadGlbWithStats(a.file, `prop-${inst.item}`, { renderer, baseUrl: './' });
        if (g.bytes !== a.bytes) throw new Error(`prop ${inst.item} bytes ${g.bytes} != manifest ${a.bytes}`);
        sources.set(inst.item, g.root);
        propsBytes += g.bytes;
      }
      const root2 = sources.get(inst.item).clone(true);
      root2.name = inst.id;
      root2.position.set(inst.positionGlb[0], inst.y ?? inst.positionGlb[1], inst.positionGlb[2]);
      root2.rotation.y = inst.rotationYRad;
      world.add(root2);
    }
    for (const rec of prCollision.colliders) { addWallCollider(RAPIER, session.physics.world, rec); session.physics.wallCount++; }
    propsStats = { count: prInstances.instances.length, counts: prManifest.counts,
      bytes: propsBytes, placedTris: prManifest.placedTriangles,
      colliders: prCollision.colliders.length, manifest: prManifest.datasetId };
  }

  world.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !(/^(street-kit__|sctail__)/.test(o.name) && /asphalt|stone/.test(o.name));
    o.receiveShadow = true;
    for (const m of [o.material].flat())
      for (const v of Object.values(m)) if (v?.isTexture) v.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  });

  setStage('正在装配街区与庙轴线…');
  blocks = new BlockManager({
    RAPIER, physics: session.physics, views: createBlockViews(scene, session), dataset: session.blocks,
    physicsAlive: () => !session.disposed,
  });
  await blocks.applyReviewed();
  for (const id of blocks.assetBlockIds()) await blocks.applyAssets(id);
  await blocks.loadBlock('block-adjacent-east');
  await blocks.loadBlock('block-adjacent-west');
  const revokeId = PARAMS.get('revoke');
  if (revokeId && blocks.blocks.get(revokeId)) await blocks.revokeAssets(revokeId);
  blocks.setPlaceholdersVisible(placeholderPref);
  world.updateMatrixWorld(true);

  setStage('正在核对资产完整性…');
  const revokedBlock = PARAMS.get('revoke');
  const assetBlocks = session.blocks.blocks.filter((b) => b.kind === 'assets' && b.autoApply && b.id !== revokedBlock);
  const manifestAssets = [
    ...(manifest.eastEdgeAssets?.assets ?? []),
    ...(manifest.streetCompletion?.assets ?? []),
    ...(manifest.templeAxis?.assets ?? []),
    ...(manifest.westShops?.assets ?? []),
    ...(manifest.eastShops?.assets ?? []),
    ...(manifest.lanesV2?.assets ?? []),
  ];
  const assetInfos = assetBlocks.flatMap((b) => (b.assets ?? [])).map((a) => {
    const m = manifestAssets.find((e) => e.id === a.id);
    if (!m) throw new Error(`asset ${a.id}: bytes/sha missing from dataset manifest`);
    return { id: a.id, glb: a.glb, bytes: m.bytes, sha256: m.sha256, triangles: m.triangles ?? 0 };
  });
  session.sceneInventory = loadedSceneAssets(manifest, assetInfos, true);
  const exp = expectedTriangles(manifest.placedTriangles + (skinsStats?.placedTris ?? 0)
    + (propsStats?.placedTris ?? 0), [
    ...session.sceneInventory.filter((e) => e.kind === 'asset'),
    { kind: 'surface', triangles: manifest.streetCompletion.surface.triangles },
    { kind: 'surface', triangles: eastTail.triangles },
    { kind: 'surface', triangles: wallInfo.triangles },
    ...(eastSurfaceInfo ? [
      { kind: 'surface', triangles: eastSurfaceInfo.triangles ?? 0 },
      { kind: 'surface', triangles: eastWallInfo.triangles ?? 0 },
    ] : []),
  ]);
  const r = countResources(world, clay);
  const triTol = COMPRESSED ? Math.ceil(exp.total * 0.001) : 0;
  if (Math.abs(r.triangles - exp.total) > triTol)
    throw new Error(`几何不完整：实际 ${r.triangles} / 预期 ${exp.total}（基础 ${manifest.placedTriangles} + 皮肤 ${skinsStats?.placedTris ?? 0} + 资产 ${session.sceneInventory.filter((e) => e.kind === 'asset').map((a) => a.id).join(' + ')} + 东西延伸面 + 端墙）`);

  // extra walkable ground OUTSIDE the session trimesh (east tail, temple
  // courts, lanes) — same production extraction, visible faces only
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
  const lanesGroup = blocks.blocks.get('block-lanes-v2')?.reviewed?.group;
  if (lanesGroup) lanesGroup.traverse((o) => {
    if (o.isMesh && GROUND_NODE_RE.test(o.name))
      extraMeshes.push({ name: o.name, positions: o.geometry.attributes.position.array, indices: o.geometry.index ? o.geometry.index.array : null, matrix: o.matrixWorld.elements.slice() });
  });
  const gt = collectGroundTriangles(extraMeshes);
  addGroundCollider(RAPIER, session.physics.world, gt);

  // ---- #4 anchors: derive from the route, validate with the real capsule --
  // Validation runs BEFORE the live player controller exists (the 20260920
  // root cause: a probe spawned at bridgeStart collided with the live
  // capsule standing at the same point and was rejected as blocked — the
  // static street there is actually clear). Defensively, any live player
  // collider would be excluded from the probe's movement queries.
  setStage('正在验证入口落点…');
  safeAnchors = [];
  for (const a of deriveEntryAnchors({ route: session.route })) {
    const validation = await validateAnchor({
      RAPIER, physics: session.physics, capsule: session.capsule, anchor: a,
      excludeColliderHandles: controller && !controller.disposed ? [controller.collider.handle] : [],
    });
    safeAnchors.push({ ...a, validation });
    if (!validation.ok) engNote(`入口锚点 ${a.id} 验证失败：${validation.reason}，已从出发点中移除。`);
  }
  walk = new WalkSession({ getAnchors: () => safeAnchors });

  // live player controller LAST, on the fully assembled static world
  const start = session.route.entries.bridgeStart;
  controller = new WalkController({
    RAPIER, physics: session.physics,
    capsule: { ...session.capsule, spawn: [start[0], session.spawn.y, start[2]] },
  });
  controller.spawnRef = { x: start[0], y: session.spawn.y, z: start[2] };

  loadStats = {
    bytesTotal: manifest.worldAssembly.bytes + session.sceneInventory.reduce((s, a) => s + a.bytes, 0) + eastTail.bytes + wallInfo.bytes
    + (eastSurfaceInfo ? eastSurfaceInfo.bytes + eastWallInfo.bytes : 0),
    bytesBase: manifest.worldAssembly.bytes,
    bytesWestSurface: manifest.streetCompletion.surface.bytes,
    bytesEastTail: eastTail.bytes,
    bytesSealWall: wallInfo.bytes,
    bytesEastExtension: eastSurfaceInfo?.bytes ?? 0,
    bytesEastEndWall: eastWallInfo?.bytes ?? 0,
    bytesTemple: manifest.templeAxis.assets.reduce((s, a) => s + a.bytes, 0),
    bytesShops: manifestAssets.filter((a) => /shop/.test(a.id)).reduce((s, a) => s + a.bytes, 0),
    extraGroundTriangles: gt.triangleCount,
    wallColliders: session.physics.wallCount,
    allAssetsReadyMs: +(performance.now() - t0).toFixed(0),
    fpsNotMeasured: true, localOnly: true,
  };

  setupButtons();
  setupPlayerUi();
  setupFramingTools();
  syncPlaceholderUi();
  setView('shanmen-from-road');
  syncFramingPanel();
  // ?entry=<anchor id> — the overview page's explicit start-point choice. Only
  // existing VALIDATED anchors are accepted; the value is never fed to physics
  // directly (pickLocation re-checks validation and records an explicit
  // relocation, never walk evidence). An invalid or empty value falls back to
  // 主街 with a plain explanation; a MISSING value keeps the legacy behavior
  // of this page unchanged (direct fangbang.html opens stay as they were).
  const entryParam = PARAMS.get('entry');
  if (entryParam !== null) {
    const valid = safeAnchors.find((a) => a.id === entryParam && a.validation?.ok);
    if (valid) {
      pickLocation(valid.id);
    } else {
      engNote(`?entry=${entryParam} 不是已验证的入口，已回退主街。`);
      const main = safeAnchors.find((a) => a.id === 'mainStreet' && a.validation?.ok);
      if (main) pickLocation('mainStreet');
      notice('入口参数未识别，已回到主街出发点。');
    }
  }
  setStage('正在编译着色器…');
  const compiledAt = performance.now();
  await renderer.compileAsync(scene, camera);
  loadStats.shaderCompileMs = +(performance.now() - compiledAt).toFixed(0);
  ready = true;
  fit();   // the panel/layout may have settled since the first fit
  syncFramingPanel();
  startBtn.disabled = false;
  startBtn.textContent = '开始探索';
  setStage('已就绪');
  markResourcesDirty();
  invalidate();
  render();
  refreshRecord(performance.now(), true);
  requestAnimationFrame(frame);
  notice('已就绪。「开始探索」落入街面行走，或先自由取景。');
  await runRouteCheck();
  window.__fangbangRecord = record;
  window.__fangbangRenderSync = render;
  window.__fangbangStartWalk = enterWalk;
  window.__fangbangRelocate = pickLocation;
  // engineering probe: first scene hit along a ray (occluder diagnosis for
  // framing cameras; read-only, no gameplay effect)
  window.__fangbangRaycast = (origin, dir, farM = 60) => {
    const rc = new T.Raycaster(new T.Vector3(...origin), new T.Vector3(...dir).normalize(), 0.01, farM);
    const hits = rc.intersectObjects(world.children, true);
    return hits.slice(0, 6).map((h) => ({ d: +h.distance.toFixed(2), name: h.object.name || '(unnamed)',
      parent: h.object.parent?.name || '', point: h.point.toArray().map((v) => +v.toFixed(2)) }));
  };
  window.__fangbangView = (pos, target, label) => {
    if (mode === 'walk') exitWalk();
    camera.position.set(...pos);
    controls.target.set(...target);
    viewLabelOverride = label ?? null;
    controls.update();
    render();  // render synchronously so same-task canvas reads see the frame
    refreshRecord(performance.now(), true);
  };
  window.__fangbangWalkRoute = async (points, opts = {}) => {
    const dt = 1 / 60;
    const reach = opts.reachRadiusM ?? 0.9;
    const timeoutS = opts.timeoutSPerLeg ?? 12;
    const spawn = points[0];
    const c = new WalkController({ RAPIER, physics: session.physics, capsule: { ...CAPSULE, spawn: [spawn[0], 1.0, spawn[2]] } });
    const legs = [];
    let blocked = null;
    for (let i = 1; i < points.length; i++) {
      const target = points[i];
      c.yaw = Math.atan2(-(target[0] - c.feetPosition()[0]), -(target[2] - c.feetPosition()[2]));
      let t = 0, stuck = 0, last = c.feetPosition(), reached = false;
      while (t < timeoutS) {
        const p0 = c.feetPosition();
        c.yaw = Math.atan2(-(target[0] - p0[0]), -(target[2] - p0[2]));
        c.setMoveInput(1, 0);
        c.step(dt);
        t += dt;
        const p1 = c.feetPosition();
        if (p1[1] < -0.05) { blocked = { reason: 'fell', at: p1.map((v) => +v.toFixed(2)) }; break; }
        if (Math.hypot(p1[0] - last[0], p1[2] - last[2]) < 0.006) {
          stuck += dt;
          if (stuck > 1.2) break;
        } else stuck = 0;
        last = p1;
        if (Math.hypot(p1[0] - target[0], p1[2] - target[2]) <= reach) { reached = true; break; }
      }
      const f = c.feetPosition();
      legs.push({ to: [+target[0].toFixed(2), +target[2].toFixed(2)], reached,
        feetY: +f[1].toFixed(3), stop: [+f[0].toFixed(2), +f[2].toFixed(2)], stuckS: +stuck.toFixed(2) });
      if (blocked) break;
    }
    let yMin = 1e9, yMax = -1e9;
    for (const leg of legs) { yMin = Math.min(yMin, leg.feetY); yMax = Math.max(yMax, leg.feetY); }
    c.dispose();
    return { legs, blocked, feetYMin: legs.length ? +yMin.toFixed(3) : null, feetYMax: legs.length ? +yMax.toFixed(3) : null };
  };
}

load().catch((e) => {
  const msg = '载入失败：' + (e?.message ?? e);
  setStage(msg);
  stats.textContent = msg;
  startBtn.disabled = true;
  startBtn.textContent = '载入失败';
  notice(msg + '。详情见审查工具。');
  const technical = String(e?.stack ?? e);
  engNote(technical);
  showFatal('载入失败', describeLoadError(e) + '。可重试一次；若重复失败，请从场景总览查看已知问题。', technical);
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
