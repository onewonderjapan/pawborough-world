// Temple ENTRY-GROUP viewer — its own entry (temple-entry.html, ports
// 5292/5293), sibling of the shanmen pilot page. Same production modules and
// the SAME shared viewer core (src/templeViewShared.js) — no second engine.
// Loads the assembled dataset world/temple-entry/: shanmen at (0,0,0), yimen
// instanced at (0,0,-21), the walled court in place, plus the shanmen lion /
// ornament candidates. Eight lead cameras, walk mode on the same physics
// chain, and an automated route cruise (honestly labeled automatic — manual
// full play is the lead's browser check, never claimed here).
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

const BASE = './world/temple-entry/';
const DATASET_TAG = 'entry';
const LABELS = {
  'entry-axis': '入口中轴', 'from-gate': '山门内望', 'court-quarter': '前院斜面',
  'yimen-front': '仪门正面', 'yimen-roof': '仪门屋面', 'yimen-detail': '仪门近景',
  'return-to-gate': '回望山门', 'rear-inferred': '仪门之背(推断)',
};
const YIMEN_Z = -21;

let cameras = [], manifest = null, physics = null, controller = null;
let mode = 'view', selected = null, ready = false, ornamentsOn = true;
let cameraCheck = null, routeCheck = null, loadStats = {};
let candidateRoot = null, worldRoot = null;

function resources() { return countResources(scene, clay); }

function record() {
  return {
    dataset: 'temple-entry', view: selected, mode, clay: clayOn, ornaments: ornamentsOn,
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
      + `本机资产 ${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（新内容仪门+前院 ${(loadStats.bytesNew / 1e6).toFixed(2)} MB）\n`
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
// chain, following world/temple-entry/route.json waypoints there and back.
async function runRouteCheck() {
  const t0 = performance.now();
  const route = await json(BASE + 'route.json');
  const dt = 1 / 60;
  const mk = (x, z) => new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
  const results = {};
  {
    const c = mk(0, 5);
    const gates = [
      { name: 'shanmen-mid', z: -1.8 }, { name: 'court-mid', z: -12 },
      { name: 'yimen-door', z: -21 }, { name: 'landing', z: -27.3 },
    ];
    const marks = [];
    let gi = 0;
    c.yaw = 0;
    for (let i = 0; i < Math.round(30 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x, , z] = c.feetPosition();
      while (gi < gates.length && z <= gates[gi].z) {
        marks.push({ gate: gates[gi].name, x, grounded: c.isGrounded() });
        gi++;
      }
      if (z <= -27.3) break;
    }
    results.through = {
      gates: marks.map((m) => `${m.gate}:${m.grounded ? 'g' : 'AIR'}`).join(' '),
      drift: Math.max(...marks.map((m) => Math.abs(m.x)), 0),
      pass: gates.every((g) => marks.find((m) => m.gate === g.name && m.grounded))
        && marks.every((m) => Math.abs(m.x) < 0.5),
    };
    // return leg
    c.yaw = Math.PI;
    let backZ = null;
    for (let i = 0; i < Math.round(40 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [, , z] = c.feetPosition();
      if (z > 4.0) { backZ = z; break; }
    }
    results.return = { z: backZ, pass: backZ !== null };
    c.dispose();
  }
  {
    const c = mk(5, -12); // court side wall
    c.yaw = -Math.PI / 2;
    for (let i = 0; i < Math.round(5 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    results.sideWall = { x: +c.feetPosition()[0].toFixed(2), pass: c.feetPosition()[0] < 8.1 };
    c.dispose();
  }
  {
    const c = mk(4.2, -19.0); // yimen lattice bay
    c.yaw = 0;
    for (let i = 0; i < Math.round(5 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    results.yimenBay = { z: +c.feetPosition()[2].toFixed(2), pass: c.feetPosition()[2] > -21.3 };
    c.dispose();
  }
  {
    const c = mk(0, -30.5); // void beyond the cutoff wall
    for (let i = 0; i < Math.round(2 / dt); i++) c.step(dt);
    results.voidFall = { y: +c.feetPosition()[1].toFixed(2), pass: c.feetPosition()[1] < -1.0 };
    c.dispose();
  }
  const pass = Object.values(results).every((r) => r.pass);
  routeCheck = {
    pass, automatic: true, results,
    summary: `穿行[${results.through.gates}]·返程z=${results.return.z}·侧墙x=${results.sideWall.x}·仪门格门z=${results.yimenBay.z}·界外坠落y=${results.voidFall.y}`,
    ms: +(performance.now() - t0).toFixed(0),
    waypoints: route.mainStreet?.length ?? 0,
  };
  render();
  noticeEl.textContent = pass
    ? '巡游路线检查：全部通过（自动执行·穿两门往返/拦停/无隐形地面）。'
    : '巡游路线检查存在失败项，详见记录。';
  return pass;
}

// --- walk mode wiring (same input chain as the shanmen page) ----------------
const keys = { w: false, a: false, s: false, d: false };
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

function setMode(next) {
  if (next === mode) return;
  if (next === 'walk') {
    const v = cameras.find((c) => c.id === selected) ?? cameras[0];
    const eye = new T.Vector3(...v.positionGlb);
    if (eye.y < 6) {
      controller = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [eye.x, 1.0, Math.min(Math.max(eye.z, -27), 5.5)] } });
      mode = 'walk';
      renderer.domElement.requestPointerLock?.();
    } else {
      noticeEl.textContent = '该机位在高处：请先用中轴/内望/回望等街面机位进入行走。';
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
  const ornBtn = document.createElement('button');
  ornBtn.textContent = '雕饰候选';
  ornBtn.classList.add('on');
  ornBtn.onclick = () => {
    ornamentsOn = !ornamentsOn;
    candidateRoot.visible = ornamentsOn;
    ornBtn.classList.toggle('on', ornamentsOn);
    render();
  };
  viewsEl.appendChild(ornBtn);
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
  const court = await loadGlbWithStats(BASE + 'court.glb', 'entry-court', opts);

  worldRoot = temple.root;                    // shanmen at identity (0,0,0)
  worldRoot.add(ground.root);
  yimen.root.position.set(0, 0, YIMEN_Z);     // instance origin (0,0,-21), yaw 0
  worldRoot.add(yimen.root);
  worldRoot.add(court.root);                  // court authored in place
  candidateRoot = new T.Group();
  candidateRoot.name = 'temple-candidates';
  candidateRoot.add(lions.root, ornaments.root);
  worldRoot.add(candidateRoot);
  scene.add(worldRoot);

  // integrity: the GLBs on disk must match the manifest the tests validate
  const loaded = { temple, ground, lions, ornaments, yimen, court };
  for (const [id, a] of Object.entries(manifest.assets)) {
    if (loaded[id].bytes !== a.bytes) throw new Error(`asset ${id}: bytes ${loaded[id].bytes} != manifest ${a.bytes}`);
  }

  worldRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !/shanmen-ground|entry-court/.test(o.parent?.name ?? '') && !/^temple-ground/.test(o.name);
    o.receiveShadow = true;
    for (const m of [o.material].flat())
      for (const v of Object.values(m)) if (v?.isTexture) v.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  });

  // physics: world-space walls + ground trimesh from the VISIBLE paving
  const collision = await json(BASE + 'collision-world.json');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics = { world, wallCount: 0, groundTriangleCount: 0, dispose: () => world.free() };
  for (const rec of collision.colliders) { addWallCollider(RAPIER, world, rec); physics.wallCount++; }
  const gt = collectGroundTriangles([...groundMeshesOf(ground.root), ...groundMeshesOf(court.root)]);
  addGroundCollider(RAPIER, world, gt);
  physics.groundTriangleCount = gt.triangleCount;

  const r = resources();
  const expected = Object.values(manifest.assets).reduce((s, a) => s + a.triangles, 0);
  if (r.triangles !== expected)
    throw new Error(`geometry integrity: ${r.triangles} triangles loaded != manifest ${expected}`);

  loadStats = {
    bytesTotal: Object.values(loaded).reduce((s, l) => s + l.bytes, 0),
    bytesNew: yimen.bytes + court.bytes,
    fetchParseMs: Object.values(loaded).reduce((s, l) => s + l.ms, 0),
    wallColliders: physics.wallCount,
    groundTriangles: physics.groundTriangleCount,
  };
  ready = true;
  setupButtons();
  setView('entry-axis');
  await runRouteCheck();
  noticeEl.textContent = `入口组已载入：${r.triangles.toLocaleString()} 三角形，`
    + `${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（新内容 ${(loadStats.bytesNew / 1e6).toFixed(2)} MB，`
    + `加载 ${loadStats.fetchParseMs}ms）。`;
  window.__entryRecord = record;
}

load().catch((e) => {
  stats.textContent = '载入失败：' + e.message;
  noticeEl.textContent = '入口组载入失败：' + e.message;
  throw e;
});
