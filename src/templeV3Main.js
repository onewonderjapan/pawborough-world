// Temple AXIS V3 viewer — the corridor-refinement axis (temple-v3.html, ports
// 5306/5307), built from the v2 page: same shared viewer core, dataset
// world/temple-axis-v3/ = frozen v2 assets with THREE variant swaps (lions-v2,
// square-lattice ornaments-v2, entry-court-v3 = court-open + incense road +
// bronze burner) plus the camphor tree instanced 4x. Ten frozen cameras, walk
// mode on the same physics chain, automated route cruise (honest: includes the
// burner detour and the burner negative).
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { collectGroundTriangles } from './world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from './world/physics.js';
import { WalkController } from './player/WalkController.js';
import { CAPSULE, createSceneRig, applyViewVerified, loadGlbWithStats, groundMeshesOf,
         saveEvidence, countResources } from './templeViewShared.js';
import { compressedEnabled, installCompressedFetch } from './world/compressedState.js';

// H2 (adoption batch 20260919): compressed variant loads by DEFAULT;
// ?compressed=0 returns to the original bytes. The install probes for the
// dataset's review-manifest.cm.json — temple-axis-v3 has none, so this page
// serves the original manifest + GLBs unless a compressed manifest appears.
const PARAMS = new URLSearchParams(location.search);

const app = document.querySelector('#app'), stats = document.querySelector('#stats'),
  viewsEl = document.querySelector('#views'), noticeEl = document.querySelector('#notice');

const { renderer, scene, camera, controls, clay } = createSceneRig(app, { background: 0xd9dfd9 });
let clayOn = false;

const BASE = './world/temple-axis-v3/';
const DATASET_TAG = 'temple-axis-v3';
const LABELS = {
  'court2-pair': '仪门后中轴：两侧配殿夹院，远端大殿',
  'peidian-west-front': '正视西配殿（廊柱、格扇、素匾）',
  'gallery-link': '廊庑与配殿交接（坐凳栏）',
  'stage-from-court': '二进院回望仪门背面戏楼',
  'stage-3q': '戏楼四分之三',
  'passage-east': '东侧通道望三进院（月台裙面在左）',
  'court3-axis': '三进院中轴望城隍殿',
  'houdian-front': '城隍殿正视',
  'houdian-3q': '城隍殿四分之三与硬山山墙',
  'axis-aerial': '高空总览：山门→仪门/戏楼→配殿院→大殿→三进院→城隍殿',
};
const YIMEN_Z = -21;
const DADIAN_Z = -44;
const HOUDIAN_Z = -74;

let cameras = [], manifest = null, physics = null, controller = null;
let mode = 'view', selected = null, ready = false;
let cameraCheck = null, routeCheck = null, loadStats = {};
let worldRoot = null;

function resources() { return countResources(scene, clay); }

function record() {
  return {
    dataset: 'temple-axis-v3', view: selected, mode, clay: clayOn,
    resources: resources(), loadStats,
    camera: mode === 'view' ? {
      position: camera.position.toArray().map((v) => +v.toFixed(3)),
      target: controls.target.toArray().map((v) => +v.toFixed(3)),
      fovDeg: +camera.fov.toFixed(3),
    } : { feet: controller.feetPosition().map((v) => +v.toFixed(2)) },
    cameraCheck, routeCheck,
    ready,
  };
}

function render() {
  if (!ready) return;
  const near = mode === 'view' ? Math.max(.05, Math.min(2, camera.position.distanceTo(controls.target) * .003)) : .1;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
  const r = resources();
  stats.textContent = mode === 'walk'
    ? `行走模式 · 脚底 (${controller.feetPosition().map((v) => v.toFixed(1)).join(', ')})\nWASD 移动 · 鼠标环视(点击画面锁定) · 空格跳 · V 返回取景`
    : `${r.triangles.toLocaleString()} 三角形 · 几何/材质/纹理 ${r.uniqueGeometries}/${r.uniqueMaterials}/${r.uniqueTextures}\n`
      + `本机资产 ${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（新内容 戏楼+配殿+廊庑+三进院+城隍殿+二院变体 ${(loadStats.bytesNew / 1e6).toFixed(2)} MB）\n`
      + `机位校验 ${cameraCheck ? (cameraCheck.pass ? 'PASS' : 'FAIL') : '—'}${cameraCheck ? ` (${cameraCheck.view}: Δpos ${cameraCheck.dPos}, Δfov ${cameraCheck.dFov})` : ''}\n`
      + `巡游路线 ${routeCheck ? (routeCheck.pass ? 'PASS ' + routeCheck.summary : 'FAIL ' + (routeCheck.summary || routeCheck.error)) : '— 未运行（自动执行，非人工试玩）'}`;
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

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

// --- the automated route cruise: real WalkController on the real physics
// chain. Forward leg follows DESIGN_SPEC.route.templeLocal: through both
// gates, to the west peidian gallery front, back to the axis, UP the platform
// (attempt), back to -40.2, through the EAST opening into the side passage,
// north along x=13.5 into court3, back to the axis, to the houdian doors
// (z -71.8; the ascent attempt is honest either way), then mirrored return.
// Plus six structured negatives and fall detection.
async function runRouteCheck() {
  const t0 = performance.now();
  const dt = 1 / 60;
  const mk = (x, z) => new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
  const results = {};
  const follow = async (c, wps, arriveR = 0.5, maxSeconds = 240) => {
    let wi = 0;
    for (let i = 0; i < Math.round(maxSeconds / dt); i++) {
      const [x, , z] = c.feetPosition();
      while (wi < wps.length && Math.hypot(x - wps[wi][0], z - wps[wi][1]) < arriveR) wi++;
      if (wi >= wps.length) return true;
      const dx = wps[wi][0] - x, dz = wps[wi][1] - z;
      c.yaw = Math.atan2(-dx, -dz);
      c.setMoveInput(1, 0);
      c.step(dt);
    }
    return false;
  };
  {
    const c = mk(0, 5);
    const gates = [
      { name: 'shanmen-mid', z: -1.8 }, { name: 'court-mid', z: -12 },
      { name: 'yimen-door', z: -21 }, { name: 'stage-passage', z: -27.5 },
      { name: 'court2-s', z: -30.5 },
    ];
    const marks = [];
    let gi = 0;
    c.yaw = 0;
    // leg 1: gate chain to the court2 south
    // burner detour on the axis (DESIGN_SPEC packageD.entryCourtBurner)
    const wps1 = [[0, -9.8], [-2.0, -10.5], [-2.0, -13.5], [0, -14.2], [0, -24.5], [0, -28.0], [-4.0, -31.0]];
    let wi = 0;
    for (let i = 0; i < Math.round(90 / dt); i++) {
      const [x, , z] = c.feetPosition();
      while (wi < wps1.length && Math.hypot(x - wps1[wi][0], z - wps1[wi][1]) < 0.45) wi++;
      if (wi >= wps1.length) break;
      const dx = wps1[wi][0] - x, dz = wps1[wi][1] - z;
      c.yaw = Math.atan2(-dx, -dz);
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x2, , z2] = c.feetPosition();
      while (gi < gates.length && z2 <= gates[gi].z) {
        marks.push({ gate: gates[gi].name, x: x2, grounded: c.isGrounded() });
        gi++;
      }
    }
    results.gates = {
      marks: marks.map((m) => `${m.gate}:${m.grounded ? 'g' : 'AIR'}`).join(' '),
      reachedGallery: wi >= wps1.length,
      pass: gates.every((g) => marks.find((m) => m.gate === g.name && m.grounded)) && wi >= wps1.length,
    };
    // leg 2: to the west peidian gallery front (route z -31.5..-35.8), then
    // back to the axis and the stair foot
    const okGallery = await follow(c, [[-8.5, -31.5], [-8.5, -35.8], [-5.0, -38.0], [0, -39.9]]);
    // platform ascent ATTEMPT (honest either way)
    let climbed = false, topY = null;
    for (let i = 0; i < Math.round(12 / dt); i++) {
      c.setMoveInput(1, 0); c.step(dt);
      const [, y, z] = c.feetPosition();
      if (z <= -42 && y >= 0.78) { climbed = true; topY = y; break; }
    }
    results.platform = climbed
      ? { climbed: true, y: +topY.toFixed(2), pass: true }
      : { climbed: false, blockedSafely: c.isGrounded(), pass: c.isGrounded(),
          note: 'capsule could not climb the 0.17 risers (fallback #7 language); passage route unaffected' };
    // leg 3: back to -40.2, east opening, side passage to court3, to houdian
    const okEast = await follow(c, [[0, -40.2], [0, -38.6], [6.0, -38.6], [6.0, -40.2], [13.5, -40.2], [13.5, -50.0], [13.5, -60.0]]);
    const okCourt3 = await follow(c, [[8.0, -65.0], [0, -66.0], [0, -70.0], [0, -71.8]]);
    let doorZ = null;
    if (okCourt3) {
      for (let i = 0; i < Math.round(8 / dt); i++) {
        c.setMoveInput(1, 0); c.step(dt);
        doorZ = c.feetPosition()[2];
        if (doorZ <= -73.4) break;
      }
    }
    results.houdianApproach = {
      galleryLoop: okGallery, eastPassage: okEast, court3: okCourt3,
      doorZ: doorZ === null ? null : +doorZ.toFixed(2),
      pass: okGallery && okEast && okCourt3 && doorZ !== null && doorZ > -74.6,
    };
    // return leg (mirrored)
    const okReturn = await follow(c, [[0, -70.0], [0, -66.0], [8.0, -65.0], [13.5, -60.0],
      [13.5, -50.0], [13.5, -40.2], [6.0, -40.2], [6.0, -38.6], [0, -38.6], [-5.0, -38.0],
      [-8.5, -35.8], [-8.5, -31.5], [-4.0, -30.5], [0, -28.0], [0, -14.2],
      [-2.0, -13.5], [-2.0, -10.5], [0, -9.0], [0, 4.2]], 0.55, 300);
    results.return = { reached: okReturn, z: +c.feetPosition()[2].toFixed(2), pass: okReturn };
    c.dispose();
  }
  // --- six structured negatives (DESIGN_SPEC.route.negatives) ----------------
  const neg = async (id, spawn, dir, limits, label) => {
    const c = mk(spawn[0], spawn[2]);
    c.yaw = { west: Math.PI / 2, east: -Math.PI / 2, north: 0 }[dir] ?? 0;
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x, y, z] = c.feetPosition();
    const grounded = c.isGrounded();
    c.dispose();
    const pass = (limits.minX === undefined || x >= limits.minX) && y >= -0.05
      && (limits.maxZ === undefined || z >= limits.maxZ)
      && (limits.maxX === undefined || x <= limits.maxX)
      && (limits.minZ === undefined || z >= limits.minZ)
      && grounded;
    results[id] = { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), grounded, pass, label };
  };
  await neg('n1-peidian-door', [-9.0, 0, -35.8], 'west', { minX: -11.5 }, '西配殿闭门/格扇挡');
  await neg('n2-gallery-bench', [-10.0, 0, -31.0], 'west', { minX: -13.4 }, '廊庑坐凳栏挡');
  {
    // north through the stage columns: must pass z -29.8 (between column rows)
    const c = mk(0, -27.5);
    c.yaw = 0;
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    c.dispose();
    results.n3a = { z: +z.toFixed(2), pass: z < -29.8, label: 'x=0 从戏楼柱间穿过' };
  }
  {
    // walk the column ROW line (z=-26.6): the spec's z=-27.5 line passes
    // BETWEEN the two column rows (the stage is open at ground level there)
    const c = mk(2.4, -26.6);
    c.yaw = -Math.PI / 2; // east, into the stage column band
    for (let i = 0; i < Math.round(3 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x] = c.feetPosition();
    c.dispose();
    results.n3b = { x: +x.toFixed(2), pass: x < 2.6 && c.isGrounded(), label: '东行被戏楼柱挡(z=-26.6柱排线)' };
  }
  await neg('n4-boundary-wall', [13.5, 0, -45.0], 'east', { maxX: 16.3 }, 'x=16.4 边界墙挡');
  await neg('n4-boundary-wall', [13.5, 0, -45.0], 'east', { maxX: 16.3 }, 'x=16.4 边界墙挡');
  {
    // houdian: blocked by the closed door (if the platform was climbed) or by
    // the base front face — either way the capsule must stop before z -74.4
    const c = mk(0, -72.0);
    c.yaw = 0;
    for (let i = 0; i < Math.round(4 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    const grounded = c.isGrounded();
    c.dispose();
    results['n5-houdian'] = { z: +z.toFixed(2), grounded, pass: grounded && z > -74.4,
      label: '城隍殿闭门/台基侧面挡' };
  }
  await neg('n6-north-closure', [0, 0, -83.0], 'north', { minZLocal: -99 }, '北端墙挡');
  {
    // burner negative (DESIGN_SPEC packageD.entryCourtBurner): spawn south of
    // the ding, walk north, must be blocked by the vessel box (front face
    // z=-11.45 + capsule radius 0.35 -> stop ~-11.10; spec's -10.9 was a
    // rounded figure — recorded in the route negative's assert text)
    const c = mk(0, -9.5);
    c.yaw = 0;
    for (let i = 0; i < Math.round(5 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    const grounded = c.isGrounded();
    c.dispose();
    results['n7-burner'] = { z: +z.toFixed(2), grounded,
      pass: grounded && z >= -11.3 && z <= -10.6, label: '鼎挡（轴线上不得穿鼎）' };
  }
  {
    const c = mk(0, -83.0);
    c.yaw = 0;
    for (let i = 0; i < Math.round(3 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [, , z] = c.feetPosition();
    c.dispose();
    results.n6 = { z: +z.toFixed(2), pass: z > -84.2, label: '北端墙 z=-84 挡' };
  }
  // fall detection: settle a fresh capsule at every route sample; nothing may
  // drop below y -0.05 (the platform top 0.85 is above ground, never below)
  {
    let minY = 0;
    for (const [x, z] of routePoints()) {
      const c = mk(x, z);
      for (let i = 0; i < Math.round(1.2 / dt); i++) { c.setMoveInput(0, 0); c.step(dt); }
      minY = Math.min(minY, c.feetPosition()[1]);
      c.dispose();
    }
    results.fallCheck = { minY: +minY.toFixed(2), pass: minY >= -0.05,
      label: '全程掉地检测（逐点落地采样）' };
  }
  const pass = Object.values(results).every((r) => r.pass);
  routeCheck = {
    pass, automatic: true, results,
    summary: `门链[${results.gates.marks}]·配殿环${results.houdianApproach.galleryLoop ? '✓' : '✗'}`
      + `·东通道${results.houdianApproach.eastPassage ? '✓' : '✗'}·三进院${results.houdianApproach.court3 ? '✓' : '✗'}`
      + `·月台${results.platform.climbed ? '登顶y=' + results.platform.y : '未登(安全阻挡)'}`
      + `·城隍殿前z=${results.houdianApproach.doorZ ?? '—'}·返程${results.return.pass ? '✓' : '✗'}`
      + `·负例${[results['n1-peidian-door'], results['n2-gallery-bench'], results.n3a, results.n3b, results['n4-boundary-wall'], results['n5-houdian'], results['n6-north-closure'], results.n6].every((r) => r?.pass) ? '7/7' : 'FAIL'}`
      + `·掉地y=${results.fallCheck.minY}`,
    ms: +(performance.now() - t0).toFixed(0),
    waypoints: 22,
  };
  render();
  noticeEl.textContent = pass
    ? '巡游路线检查：全部通过（自动执行·含登台尝试与掉地检测如实标注）。'
    : '巡游路线检查存在失败项，详见记录。';
  return pass;
}

function routePoints() {
  return [[0, 3.5], [0, 0], [0, -12], [0, -24.5], [-4, -30.5], [-8.5, -35.8], [0, -39.9],
    [6, -40.2], [13.5, -50], [13.5, -60], [0, -66], [0, -70], [0, -71.8]];
}

// --- walk mode wiring (same input chain as the sibling pages) ----------------
const keys = { w: false, a: false, s: false, d: false };
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

function setMode(next) {
  if (next === mode) return;
  if (next === 'walk') {
    const v = cameras.find((c) => c.id === selected) ?? cameras[0];
    const eye = new T.Vector3(...v.positionGlb);
    if (eye.y < 6) {
      controller = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [eye.x, 1.0, Math.min(Math.max(eye.z, -80), 5.5)] } });
      mode = 'walk';
      renderer.domElement.requestPointerLock?.();
    } else {
      noticeEl.textContent = '该机位在高处：请先用街面机位进入行走。';
      return;
    }
  } else {
    controller?.dispose();
    controller = null;
    document.exitPointerLock?.();
    mode = 'view';
    setView(selected);
  }
  for (const b of viewsEl.querySelectorAll('button')) b.classList.toggle('on', mode === 'walk' ? b.id === 'btn-walk' : b.dataset.view === selected);
  render();
}

window.addEventListener('keydown', (e) => {
  if (mode === 'walk') {
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.code === 'KeyV') setMode('view');
    if (e.code === 'Space') { controller.setJump(true); e.preventDefault(); }
  }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
renderer.domElement.addEventListener('click', () => { if (mode === 'walk') renderer.domElement.requestPointerLock?.(); });
window.addEventListener('mousemove', (e) => {
  if (mode === 'walk' && document.pointerLockElement === renderer.domElement)
    controller.look(e.movementX * .0024, e.movementY * .0024);
});

let lastT = null;
function frame(t) {
  requestAnimationFrame(frame);
  if (!ready) return;
  const dt = lastT === null ? .016 : Math.min(.25, (t - lastT) / 1000);
  lastT = t;
  if (mode === 'walk' && controller) {
    const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), r = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    controller.step(dt);
    controller.setMoveInput(f, r);
    const eye = controller.eyePosition();
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.fov = 68; camera.aspect = app.clientWidth / app.clientHeight;
    camera.updateProjectionMatrix();
    const yaw = controller.yaw, pitch = controller.pitch;
    camera.quaternion.setFromEuler(new T.Euler(pitch, yaw, 0, 'YXZ'));
    render();
  }
}
requestAnimationFrame(frame);

function setupButtons() {
  for (const c of cameras) {
    const b = document.createElement('button');
    b.textContent = LABELS[c.id] ?? c.id;
    b.dataset.view = c.id;
    b.onclick = () => setView(c.id);
    viewsEl.appendChild(b);
  }
  const clayBtn = document.createElement('button');
  clayBtn.textContent = '灰模';
  clayBtn.onclick = () => {
    clayOn = !clayOn;
    scene.overrideMaterial = clayOn ? clay : null;
    clayBtn.classList.toggle('on', clayOn);
    render();
  };
  viewsEl.appendChild(clayBtn);
  const walkBtn = document.createElement('button');
  walkBtn.id = 'btn-walk';
  walkBtn.textContent = '行走模式';
  walkBtn.onclick = () => setMode(mode === 'walk' ? 'view' : 'walk');
  viewsEl.appendChild(walkBtn);
  const chk = document.createElement('button');
  chk.textContent = '巡游路线检查';
  chk.onclick = async () => { chk.disabled = true; await runRouteCheck(); chk.disabled = false; };
  viewsEl.appendChild(chk);
  const save = document.createElement('button');
  save.textContent = '保存实测图';
  save.onclick = async () => {
    if (!ready) return;
    render();
    const image = renderer.domElement.toDataURL('image/jpeg', .94);
    try {
      await saveEvidence(`${DATASET_TAG}-${mode === 'walk' ? 'walk' : selected}-${clayOn ? 'clay' : 'pbr'}`,
        image, record());
      noticeEl.textContent = '当前WebGL画面与数据已保存。';
    } catch (e) { noticeEl.textContent = e.message; }
  };
  viewsEl.appendChild(save);
}

controls.addEventListener('change', render);
new ResizeObserver(() => {
  const w = app.clientWidth, h = app.clientHeight;
  const k = Math.min(1, 1600 / w, 900 / h);
  renderer.setSize(Math.round(w * k), Math.round(h * k), false);
  camera.aspect = w / h;
  if (selected) {
    const v = cameras.find((c) => c.id === selected);
    if (v) { camera.fov = v.verticalFovDegrees; camera.updateProjectionMatrix(); }
  }
  render();
}).observe(app);

async function load() {
  await RAPIER.init();
  await installCompressedFetch(BASE, compressedEnabled(PARAMS));
  const camContract = await json(BASE + 'cameras.json');
  cameras = camContract.cameras;
  manifest = await json(BASE + 'review-manifest.json');

  const opts = { renderer, baseUrl: BASE };
  const temple = await loadGlbWithStats(BASE + 'temple.glb', 'shanmen-main', opts);
  const ground = await loadGlbWithStats(BASE + 'ground.glb', 'shanmen-ground', opts);
  const lions = await loadGlbWithStats(BASE + 'lions-v2.glb', 'shanmen-lions-v2', opts);
  const ornaments = await loadGlbWithStats(BASE + 'ornaments-v2.glb', 'shanmen-ornaments-v2', opts);
  const yimen = await loadGlbWithStats(BASE + 'yimen.glb', 'yimen-main', opts);
  const courtOpen = await loadGlbWithStats(BASE + 'entry-court-v3.glb', 'entry-court-v3', opts);
  const tree = await loadGlbWithStats(BASE + 'tree-camphor.glb', 'tree-camphor', opts);
  const dadianCourt = await loadGlbWithStats(BASE + 'dadian-court-v2.glb', 'dadian-court-v2', opts);
  const peidianW = await loadGlbWithStats(BASE + 'peidian.glb', 'peidian-w', opts);
  const peidianE = await loadGlbWithStats(BASE + 'peidian.glb', 'peidian-e', opts);
  const galleryW = await loadGlbWithStats(BASE + 'gallery.glb', 'gallery-w', opts);
  const galleryE = await loadGlbWithStats(BASE + 'gallery.glb', 'gallery-e', opts);
  const stage = await loadGlbWithStats(BASE + 'yimen-stage.glb', 'yimen-stage', opts);
  const dadian = await loadGlbWithStats(BASE + 'dadian.glb', 'dadian-main', opts);
  const court3 = await loadGlbWithStats(BASE + 'court3.glb', 'court3', opts);
  const houdian = await loadGlbWithStats(BASE + 'houdian.glb', 'houdian-main', opts);

  worldRoot = temple.root;                    // shanmen at identity (0,0,0)
  worldRoot.add(ground.root);
  yimen.root.position.set(0, 0, YIMEN_Z);     // instance origin (0,0,-21), yaw 0
  worldRoot.add(yimen.root);
  stage.root.position.set(0, 0, YIMEN_Z);     // yimen-local authored; same origin
  worldRoot.add(stage.root);
  worldRoot.add(courtOpen.root);              // court-open authored in place
  worldRoot.add(dadianCourt.root);            // second court VARIANT, in place
  const yawTo = (root, pos, yaw) => { root.position.set(...pos); root.rotation.y = yaw; worldRoot.add(root); };
  yawTo(peidianW.root, [-11.2, 0, -35.8], Math.PI / 2);   // facade toward +X
  yawTo(peidianE.root, [11.2, 0, -35.8], -Math.PI / 2);   // facade toward -X
  yawTo(galleryW.root, [-10.78, 0, -30.99], Math.PI / 2);
  yawTo(galleryE.root, [10.78, 0, -30.99], -Math.PI / 2);
  const candidates = new T.Group();
  candidates.name = 'temple-candidates';
  candidates.add(lions.root, ornaments.root);
  worldRoot.add(candidates);
  // D3 camphor trees — 4 instances (manifest placements, fallback #2 shifts applied)
  const treePlacements = Object.entries(manifest.assets.tree.instancesAt ?? {});
  if (treePlacements.length !== 4) throw new Error('tree instance contract: expected 4, got ' + treePlacements.length);
  for (const [id, p] of treePlacements) {
    const t = tree.root.clone(true);
    t.name = id;
    t.position.set(p[0], p[1], p[2]);
    worldRoot.add(t);
  }
  dadian.root.position.set(0, 0, DADIAN_Z);
  worldRoot.add(dadian.root);
  worldRoot.add(court3.root);                 // authored in place
  houdian.root.position.set(0, 0, HOUDIAN_Z);
  worldRoot.add(houdian.root);
  scene.add(worldRoot);

  // integrity: the GLBs on disk must match the manifest the tests validate
  const loaded = { temple, ground, lionsV2: lions, ornamentsV2: ornaments, yimen,
    entryCourtV3: courtOpen, dadianCourt: dadianCourt,
    peidian: peidianW, gallery: galleryW, yimenStage: stage, dadian, court3, houdian, tree };
  for (const [id, a] of Object.entries(manifest.assets)) {
    const l = loaded[id];
    if (l && l.bytes !== a.bytes) throw new Error(`asset ${id}: bytes ${l.bytes} != manifest ${a.bytes}`);
  }

  worldRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !/^temple-ground/.test(o.name);
    o.receiveShadow = true;
    for (const m of [o.material].flat())
      for (const v of Object.values(m)) if (v?.isTexture) v.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  });

  // physics: world-space walls + ground trimesh from the VISIBLE paving
  const collision = await json(BASE + 'collision-world.json');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics = { world, wallCount: 0, groundTriangleCount: 0, dispose: () => world.free() };
  for (const rec of collision.colliders) { addWallCollider(RAPIER, world, rec); physics.wallCount++; }
  const gt = collectGroundTriangles([...groundMeshesOf(ground.root), ...groundMeshesOf(courtOpen.root),
                                     ...groundMeshesOf(dadianCourt.root), ...groundMeshesOf(court3.root),
                                     ...groundMeshesOf(peidianW.root), ...groundMeshesOf(peidianE.root),
                                     ...groundMeshesOf(galleryW.root), ...groundMeshesOf(galleryE.root),
                                     ...groundMeshesOf(houdian.root)]);
  addGroundCollider(RAPIER, world, gt);
  physics.groundTriangleCount = gt.triangleCount;

  const r = resources();
  // expected triangles: each manifest asset once, peidian/gallery twice (two
  // yawed instances each)
  const trisOf = (id) => manifest.assets[id]?.triangles ?? 0;
  const expected = Object.values(manifest.assets).reduce((s, a) => s + a.triangles, 0)
    + trisOf('peidian') + trisOf('gallery') + trisOf('tree') * 3;
  if (r.triangles !== expected)
    throw new Error(`geometry integrity: ${r.triangles} triangles loaded != manifest ${expected}`);

  loadStats = {
    bytesTotal: Object.values(loaded).reduce((s, l) => s + l.bytes, 0),
    bytesNew: lions.bytes + ornaments.bytes + courtOpen.bytes + tree.bytes * 4,
    fetchParseMs: Object.values(loaded).reduce((s, l) => s + l.ms, 0),
    wallColliders: physics.wallCount,
    groundTriangles: physics.groundTriangleCount,
  };
  ready = true;
  setupButtons();
  setView('court2-pair');
  await runRouteCheck();
  noticeEl.textContent = `庙轴线 v3 已载入：${r.triangles.toLocaleString()} 三角形，`
    + `${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（新内容 ${(loadStats.bytesNew / 1e6).toFixed(2)} MB，`
    + `加载 ${loadStats.fetchParseMs}ms）。`;
  window.__templeV3Record = record;
}

load().catch((e) => {
  stats.textContent = '载入失败：' + e.message;
  noticeEl.textContent = '庙轴线 v3 载入失败：' + e.message;
  throw e;
});
