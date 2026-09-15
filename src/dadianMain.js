// Temple DADIAN viewer — the temple axis continued north (dadian.html, ports
// 5294/5295), sibling of the entry/shanmen pages. Same production modules and
// the SAME shared viewer core (src/templeViewShared.js) — no second engine.
// Loads the assembled dataset world/temple-dadian/: shanmen at (0,0,0), yimen
// instanced at (0,0,-21), the entry court as the court-open variant (cutoff
// wall removed — the second court continues through), the second court in
// place, and the hall instanced at (0,0,-44). Ten lead cameras, walk mode on
// the same physics chain, and an automated route cruise (honestly labeled
// automatic — manual full play is the lead's browser check, never claimed).
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { collectGroundTriangles } from './world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from './world/physics.js';
import { WalkController } from './player/WalkController.js';
import { CAPSULE, createSceneRig, applyViewVerified, loadGlbWithStats, groundMeshesOf,
         saveEvidence, countResources } from './templeViewShared.js';

const app = document.querySelector('#app'), stats = document.querySelector('#stats'),
  viewsEl = document.querySelector('#views'), noticeEl = document.querySelector('#notice');

const { renderer, scene, camera, controls, clay } = createSceneRig(app, { background: 0xd9dfd9 });
let clayOn = false;

const BASE = './world/temple-dadian/';
const DATASET_TAG = 'dadian';
const LABELS = {
  'court-axis': '二院中轴望大殿', 'dadian-front': '月台前正视', 'steps-low': '台阶前仰视',
  'plaque-close': '登台看匾额', 'burner-close': '铜鼎近景', 'dadian-roof': '侧望双层屋面',
  'court-quarter': '二院斜透视', 'look-back': '回望仪门轴线', 'corner-detail': '墙脚铺地近景',
  'hall-flank': '月台侧沿望殿身',
};
const YIMEN_Z = -21;
const DADIAN_Z = -44;

let cameras = [], manifest = null, physics = null, controller = null;
let mode = 'view', selected = null, ready = false;
let cameraCheck = null, routeCheck = null, loadStats = {};
let worldRoot = null;

function resources() { return countResources(scene, clay); }

function record() {
  return {
    dataset: 'temple-dadian', view: selected, mode, clay: clayOn,
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
      + `本机资产 ${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（新内容大殿+二院+court-open ${(loadStats.bytesNew / 1e6).toFixed(2)} MB）\n`
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
// chain. Forward leg follows route.json through both gates and around the
// burner, ATTEMPTS the stair ascent (honest result either way), stops before
// the closed hall doors, then returns to the street.
async function runRouteCheck() {
  const t0 = performance.now();
  const dt = 1 / 60;
  const mk = (x, z) => new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
  const results = {};
  {
    const c = mk(0, 5);
    const gates = [
      { name: 'shanmen-mid', z: -1.8 }, { name: 'court-mid', z: -12 },
      { name: 'yimen-door', z: -21 }, { name: 'entry-landing', z: -27.3 },
      { name: 'court2-mid', z: -31.5 },
    ];
    const marks = [];
    let gi = 0;
    c.yaw = 0;
    // waypoint follower: follow the route spec around the burner to the
    // stair foot (the route weaves at x=-2.2 by design)
    const wps = [[0, -24.5], [0, -30], [-2.2, -33], [-2.2, -36], [0, -38.5], [0, -39.9]];
    let wi = 0;
    for (let i = 0; i < Math.round(60 / dt); i++) {
      const [x, , z] = c.feetPosition();
      while (wi < wps.length && Math.hypot(x - wps[wi][0], z - wps[wi][1]) < 0.45) wi++;
      if (wi >= wps.length) break;
      const dx = wps[wi][0] - x, dz = wps[wi][1] - z;
      c.yaw = Math.atan2(-dx, -dz);
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x2, , z2] = c.feetPosition();
      while (gi < gates.length && z2 <= gates[gi].z) {
        marks.push({ gate: gates[gi].name, x: x2, grounded: c.isGrounded() });
        gi++;
      }
    }
    results.through = {
      gates: marks.map((m) => `${m.gate}:${m.grounded ? 'g' : 'AIR'}`).join(' '),
      reached: wi >= wps.length,
      drift: Math.max(...marks.map((m) => Math.abs(m.x)), 0),
      pass: gates.every((g) => marks.find((m) => m.gate === g.name && m.grounded))
        && marks.every((m) => Math.abs(m.x) < 1.6)
        && wi >= wps.length,
    };
    // stair ascent ATTEMPT: keep walking north; climb = reached platform
    // height; otherwise blocked safely at the first riser (honest fallback —
    // platform ascent stays pending, never faked)
    let climbed = false, topY = null, stoppedZ = null;
    for (let i = 0; i < Math.round(12 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [, y, z] = c.feetPosition();
      stoppedZ = z;
      if (z <= -42 && y >= 0.78) { climbed = true; topY = y; break; }
    }
    for (let i = 0; i < Math.round(12 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [, y, z] = c.feetPosition();
      stoppedZ = z;
      if (z <= -42 && y >= 0.78) { climbed = true; topY = y; break; }
    }
    results.stair = climbed
      ? { climbed: true, y: +topY.toFixed(2), pass: true }
      : { climbed: false, stoppedZ: +stoppedZ.toFixed(2), blockedSafely: c.isGrounded(),
          pass: c.isGrounded() && stoppedZ > -41.2,
          note: 'capsule cannot climb 0.17 risers — platform ascent pending, blocked safely (fallback #7)' };
    // doors stop: walk north into the closed leaves
    if (climbed) {
      let doorZ = null;
      for (let i = 0; i < Math.round(10 / dt); i++) {
        c.setMoveInput(1, 0);
        c.step(dt);
        doorZ = c.feetPosition()[2];
        if (doorZ <= -44.0) break;
      }
      results.doors = { z: +doorZ.toFixed(2), pass: doorZ > -44.35 };
    }
    // return leg
    c.yaw = Math.PI;
    let backZ = null, backEnd = null;
    for (let i = 0; i < Math.round(70 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const p = c.feetPosition();
      backEnd = [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)];
      if (p[2] > 4.0) { backZ = p[2]; break; }
    }
    results.return = { z: backZ, end: backEnd, pass: backZ !== null };
    c.dispose();
  }
  {
    const c = mk(7.0, -33.0); // court2 side wall
    c.yaw = -Math.PI / 2;
    for (let i = 0; i < Math.round(8 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    results.sideWall = { x: +c.feetPosition()[0].toFixed(2), pass: c.feetPosition()[0] < 10.3 };
    c.dispose();
  }
  {
    // burner blocks THROUGH-passage: walk the axis; the capsule may slide
    // around (the court allows that) but must never enter the burner zone
    const c = mk(0, -31.5);
    c.yaw = 0;
    let through = false, minZ = 0;
    for (let i = 0; i < Math.round(8 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x, , z] = c.feetPosition();
      minZ = Math.min(minZ, z);
      if (Math.abs(x) < 0.75 && z < -33.8 && z > -35.2) through = true;
    }
    results.burner = { minZ: +minZ.toFixed(2), throughBody: through, pass: !through };
    c.dispose();
  }
  {
    const c = mk(0, -61.5); // void beyond the north closure
    for (let i = 0; i < Math.round(2 / dt); i++) c.step(dt);
    results.voidFall = { y: +c.feetPosition()[1].toFixed(2), pass: c.feetPosition()[1] < -1.0 };
    c.dispose();
  }
  const pass = Object.values(results).every((r) => r.pass);
  routeCheck = {
    pass, automatic: true, results,
    summary: `穿行[${results.through.gates}]·台阶${results.stair.climbed ? '登顶y=' + results.stair.y : '未登顶(安全阻挡)'}`
      + `${results.doors ? '·闭门z=' + results.doors.z : ''}·返程z=${results.return.z}`
      + `·侧墙x=${results.sideWall.x}·铜鼎${results.burner.throughBody ? '穿身!' : '未穿身(minZ=' + results.burner.minZ + ')'}·界外坠落y=${results.voidFall.y}`,
    ms: +(performance.now() - t0).toFixed(0),
    waypoints: 8,
  };
  render();
  noticeEl.textContent = pass
    ? '巡游路线检查：全部通过（自动执行·含台阶尝试如实标注）。'
    : '巡游路线检查存在失败项，详见记录。';
  return pass;
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
      controller = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [eye.x, 1.0, Math.min(Math.max(eye.z, -57), 5.5)] } });
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
  const camContract = await json(BASE + 'cameras.json');
  cameras = camContract.cameras;
  manifest = await json(BASE + 'review-manifest.json');

  const opts = { renderer, baseUrl: BASE };
  const temple = await loadGlbWithStats(BASE + 'temple.glb', 'shanmen-main', opts);
  const ground = await loadGlbWithStats(BASE + 'ground.glb', 'shanmen-ground', opts);
  const lions = await loadGlbWithStats(BASE + 'lions.glb', 'shanmen-lions', opts);
  const ornaments = await loadGlbWithStats(BASE + 'ornaments.glb', 'shanmen-ornaments', opts);
  const yimen = await loadGlbWithStats(BASE + 'yimen.glb', 'yimen-main', opts);
  const courtOpen = await loadGlbWithStats(BASE + 'court-open.glb', 'entry-court-open', opts);
  const dadianCourt = await loadGlbWithStats(BASE + 'dadian-court.glb', 'dadian-court', opts);
  const dadian = await loadGlbWithStats(BASE + 'dadian.glb', 'dadian-main', opts);

  worldRoot = temple.root;                    // shanmen at identity (0,0,0)
  worldRoot.add(ground.root);
  yimen.root.position.set(0, 0, YIMEN_Z);     // instance origin (0,0,-21), yaw 0
  worldRoot.add(yimen.root);
  worldRoot.add(courtOpen.root);              // court-open authored in place
  worldRoot.add(dadianCourt.root);            // second court authored in place
  const candidates = new T.Group();
  candidates.name = 'temple-candidates';
  candidates.add(lions.root, ornaments.root);
  worldRoot.add(candidates);
  dadian.root.position.set(0, 0, DADIAN_Z);   // instance origin (0,0,-44), yaw 0
  worldRoot.add(dadian.root);
  scene.add(worldRoot);

  // integrity: the GLBs on disk must match the manifest the tests validate
  const loaded = { temple, ground, lions, ornaments, yimen, courtOpen, dadianCourt, dadian };
  for (const [id, a] of Object.entries(manifest.assets)) {
    if (loaded[id].bytes !== a.bytes) throw new Error(`asset ${id}: bytes ${loaded[id].bytes} != manifest ${a.bytes}`);
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
                                     ...groundMeshesOf(dadianCourt.root)]);
  addGroundCollider(RAPIER, world, gt);
  physics.groundTriangleCount = gt.triangleCount;

  const r = resources();
  const expected = Object.values(manifest.assets).reduce((s, a) => s + a.triangles, 0);
  if (r.triangles !== expected)
    throw new Error(`geometry integrity: ${r.triangles} triangles loaded != manifest ${expected}`);

  loadStats = {
    bytesTotal: Object.values(loaded).reduce((s, l) => s + l.bytes, 0),
    bytesNew: courtOpen.bytes + dadianCourt.bytes + dadian.bytes,
    fetchParseMs: Object.values(loaded).reduce((s, l) => s + l.ms, 0),
    wallColliders: physics.wallCount,
    groundTriangles: physics.groundTriangleCount,
  };
  ready = true;
  setupButtons();
  setView('court-axis');
  await runRouteCheck();
  noticeEl.textContent = `大殿段已载入：${r.triangles.toLocaleString()} 三角形，`
    + `${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（新内容 ${(loadStats.bytesNew / 1e6).toFixed(2)} MB，`
    + `加载 ${loadStats.fetchParseMs}ms）。`;
  window.__dadianRecord = record;
}

load().catch((e) => {
  stats.textContent = '载入失败：' + e.message;
  noticeEl.textContent = '大殿段载入失败：' + e.message;
  throw e;
});
