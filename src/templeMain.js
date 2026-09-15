// Standalone temple pilot viewer — its own entry (temple.html, ports 5290/5291),
// deliberately separate from the street client (src/main.js, 5284/5285). It
// reuses the same production modules: three + GLTFLoader + OrbitControls, the
// shared collision adapter / ground extractor / physics builders, and the
// WalkController input chain — no new engine, no new physics.
//
// Extra to the street page: (1) every fixed camera verifies its OWN pose
// against cameras.json after controls.update() (the F2 lesson: presets must be
// executed faithfully, fov applied as degrees straight from the contract);
// (2) an automated doorway-passage check driving the real WalkController
// through the opening, plus blocked/fall negatives proving no wall seals the
// opening and no invisible plane exists beyond the court.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';

import { GROUND_NODE_RE } from './world/collisionAdapter.js';
import { collectGroundTriangles } from './world/groundExtractor.js';
import { addWallCollider, addGroundCollider } from './world/physics.js';
import { createGLTFLoader } from './world/decoders.js';
import { WalkController } from './player/WalkController.js';

const app = document.querySelector('#app'), stats = document.querySelector('#stats'),
  viewsEl = document.querySelector('#views'), noticeEl = document.querySelector('#notice');

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new T.Scene();
scene.background = new T.Color(0xd9dfd9);
const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, .04).texture;
scene.environmentIntensity = .3;
room.dispose(); pmrem.dispose();

const sun = new T.DirectionalLight(0xfff5ea, 2.6);
sun.position.set(-14, 26, 30);
sun.target.position.set(0, 3, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -12, near: .5, far: 90 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = .025;
scene.add(sun, sun.target);
scene.add(new T.AmbientLight(0xdde4ee, .25));

const camera = new T.PerspectiveCamera(48, 1, .1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.minDistance = .4;
controls.maxDistance = 120;
controls.maxPolarAngle = Math.PI; // F2 lesson: never clamp the lead-designed poses

const clay = new T.MeshStandardMaterial({ color: 0xb8b7ae, roughness: .86 });
let clayOn = false;

const BASE = './world/temple-shanmen/';
const DATASET_TAG = 'temple';
const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const LABELS = {
  'front': '正面', 'street-eye': '街面平视', 'quarter-left': '三分之四·左',
  'roof': '檐角/屋顶', 'doorway': '门洞通行', 'rear-inferred': '背面(推断)',
};

let cameras = [], manifest = null, physics = null, controller = null;
let mode = 'view', selected = null, ready = false, ornamentsOn = true;
let cameraCheck = null, passageCheck = null, loadStats = {};
let candidateRoot = null, worldRoot = null;

function resources() {
  const g = new Set(), m = new Set(), t = new Set();
  let triangles = 0, meshes = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    g.add(o.geometry);
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    for (const mat of [o.material].flat()) {
      if (mat === clay) continue;
      m.add(mat);
      for (const v of Object.values(mat)) if (v?.isTexture) t.add(v);
    }
  });
  return { meshes, triangles: Math.round(triangles), uniqueGeometries: g.size, uniqueMaterials: m.size, uniqueTextures: t.size };
}

function record() {
  return {
    dataset: 'temple-shanmen', view: selected, mode, clay: clayOn, ornaments: ornamentsOn,
    resources: resources(), loadStats,
    camera: mode === 'view' ? {
      position: camera.position.toArray().map((v) => +v.toFixed(3)),
      target: controls.target.toArray().map((v) => +v.toFixed(3)),
      fovDeg: +camera.fov.toFixed(3),
    } : { feet: controller.feetPosition().map((v) => +v.toFixed(2)) },
    cameraCheck, passageCheck,
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
      + `本机资产 ${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（含雕饰候选 ${(loadStats.bytesCandidates / 1e6).toFixed(2)} MB）\n`
      + `机位校验 ${cameraCheck ? (cameraCheck.pass ? 'PASS' : 'FAIL') : '—'}${cameraCheck ? ` (${cameraCheck.view}: Δpos ${cameraCheck.dPos}, Δfov ${cameraCheck.dFov})` : ''}\n`
      + `门洞通行 ${passageCheck ? (passageCheck.pass ? 'PASS ' + passageCheck.summary : 'FAIL ' + (passageCheck.summary || passageCheck.error)) : '— 未运行'}`;
  document.querySelector('#record').textContent = JSON.stringify(record(), null, 2);
}

function setView(id) {
  const v = cameras.find((c) => c.id === id);
  if (!v) return;
  if (mode === 'walk') setMode('view');
  selected = id;
  camera.position.set(...v.positionGlb);
  controls.target.set(...v.targetGlb);
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.fov = v.verticalFovDegrees; // degrees straight from the contract — never reconverted
  camera.updateProjectionMatrix();
  controls.update();
  // faithful-execution check AFTER controls.update(): preset must be exactly what cameras.json says
  const dPos = Math.max(
    camera.position.distanceTo(new T.Vector3(...v.positionGlb)),
    controls.target.distanceTo(new T.Vector3(...v.targetGlb)),
  );
  const dFov = Math.abs(camera.fov - v.verticalFovDegrees);
  cameraCheck = { view: id, dPos: +dPos.toFixed(6), dFov: +dFov.toFixed(6), pass: dPos < 1e-3 && dFov < 1e-6 };
  for (const b of viewsEl.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === id);
  render();
}

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

async function loadGlb(path, name) {
  const t0 = performance.now();
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  const loader = createGLTFLoader({ renderer, baseUrl: BASE });
  const model = await loader.parseAsync(data, BASE);
  model.scene.name = name;
  return { root: model.scene, bytes: data.byteLength, ms: +(performance.now() - t0).toFixed(1) };
}

function groundMeshesOf(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !GROUND_NODE_RE.test(o.name)) return;
    out.push({
      name: o.name,
      positions: o.geometry.attributes.position.array,
      indices: o.geometry.index ? o.geometry.index.array : Uint32Array.from({ length: o.geometry.attributes.position.count }, (_, i) => i),
      matrix: o.matrixWorld.elements.slice(),
    });
  });
  return out;
}

// --- the automated doorway passage check: real WalkController, real physics ---
async function runPassageCheck() {
  const t0 = performance.now();
  const mk = (x, z) => new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [x, 1.0, z] } });
  const drive = (c, seconds, forward = 1) => {
    const dt = 1 / 60;
    c.yaw = 0; // facing -Z (straight at the gate)
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      c.setMoveInput(forward, 0);
      c.step(dt);
    }
  };
  const results = {};
  // positive: approach on the axis, must cross the gate grounded and clear to z < -4.2
  // (beyond the rear wall there is intentionally NO ground — falling after the
  // exit is expected and doubles as proof of no invisible plane behind)
  {
    const c = mk(0, 6.5);
    let groundedAtMid = null, exitZ = null;
    const dt = 1 / 60;
    c.yaw = 0;
    for (let i = 0; i < Math.round(10 / dt); i++) {
      c.setMoveInput(1, 0);
      c.step(dt);
      const [x, , z] = c.feetPosition();
      if (groundedAtMid === null && z < -1.8 && z > -2.4) groundedAtMid = c.isGrounded();
      if (exitZ === null && z < -4.2) { exitZ = z; break; }
    }
    const [x] = c.feetPosition();
    results.through = {
      x: +x.toFixed(3), midGrounded: groundedAtMid, exitZ: exitZ === null ? null : +exitZ.toFixed(3),
      pass: exitZ !== null && Math.abs(x) < 0.45 && groundedAtMid === true,
    };
    c.dispose();
  }
  // negative 1: 0.7m off-axis runs into the reveal wall / column line — blocked
  {
    const c = mk(-1.6, 6.5);
    drive(c, 8);
    const [, , z] = c.feetPosition();
    results.blockedReveal = { z: +z.toFixed(3), pass: z > -0.5 };
    c.dispose();
  }
  // negative 2: open lattice door leaf (folded at the side bay) is solid
  {
    const c = mk(2.25, 2.5);
    drive(c, 6);
    const [, , z] = c.feetPosition();
    results.blockedLeaf = { z: +z.toFixed(3), pass: z > 0.05 };
    c.dispose();
  }
  // negative 3: step off the court side edge -> falls (no invisible world plane)
  {
    const c = mk(0, 3.0);
    c.yaw = -Math.PI / 2; // face +X
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(9 / dt); i++) { c.setMoveInput(1, 0); c.step(dt); }
    const [x, y] = c.feetPosition();
    results.fallOffEdge = { x: +x.toFixed(2), y: +y.toFixed(2), pass: y < -1.0 };
    c.dispose();
  }
  const pass = Object.values(results).every((r) => r.pass);
  passageCheck = {
    pass, results,
    summary: `门洞中段落地=${results.through.midGrounded}·穿出z=${results.through.exitZ}·偏移x=${results.through.x}；侧向拦停z=${results.blockedReveal.z}；门板拦停z=${results.blockedLeaf.z}；越界坠落y=${results.fallOffEdge.y}`,
    ms: +(performance.now() - t0).toFixed(0),
  };
  render();
  noticeEl.textContent = pass ? '门洞通行检查：全部通过（穿行/拦停/无隐形地面）。' : '门洞通行检查存在失败项，详见记录。';
  return pass;
}

// --- walk mode wiring (same input chain as the street client) ----------------
const keys = { w: false, a: false, s: false, d: false };
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

function setMode(next) {
  if (next === mode) return;
  if (next === 'walk') {
    const v = cameras.find((c) => c.id === selected) ?? cameras[0];
    const eye = new T.Vector3(...v.positionGlb);
    if (eye.y < 6) { // start walking from a street-level preset only
      controller = new WalkController({ RAPIER, physics, capsule: { ...CAPSULE, spawn: [eye.x, 1.0, Math.max(eye.z, 5.5)] } });
      mode = 'walk';
      renderer.domElement.requestPointerLock?.();
    } else {
      noticeEl.textContent = '该机位在高处：请先用街面平视/门洞机位进入行走。';
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
    sun.shadow.needsUpdate = true;
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
  chk.textContent = '门洞通行检查';
  chk.onclick = async () => { chk.disabled = true; await runPassageCheck(); chk.disabled = false; };
  viewsEl.appendChild(chk);
  const save = document.createElement('button');
  save.textContent = '保存实测图';
  save.onclick = async () => {
    if (!ready) return;
    render();
    const image = renderer.domElement.toDataURL('image/jpeg', .94);
    try {
      const res = await fetch('/__review-evidence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${DATASET_TAG}-${mode === 'walk' ? 'walk' : selected}-${clayOn ? 'clay' : 'pbr'}`,
          image, record: record(),
        }),
      });
      if (!res.ok) throw new Error(`保存 HTTP ${res.status}`);
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
  const t0 = performance.now();
  await RAPIER.init();
  [manifest, cameras] = await Promise.all([
    json(BASE + 'review-manifest.json'),
    json(BASE + 'cameras.json').then((c) => c.cameras),
  ]);
  const camContract = await json(BASE + 'cameras.json');
  cameras = camContract.cameras;

  const main = await loadGlb(BASE + 'temple.glb', 'temple-main');
  const ground = await loadGlb(BASE + 'ground.glb', 'temple-ground');
  const lions = await loadGlb(BASE + 'lions.glb', 'temple-lions');
  const ornaments = await loadGlb(BASE + 'ornaments.glb', 'temple-ornaments');
  worldRoot = main.root;
  worldRoot.add(ground.root);
  candidateRoot = new T.Group();
  candidateRoot.name = 'temple-candidates';
  candidateRoot.add(lions.root, ornaments.root);
  worldRoot.add(candidateRoot);
  scene.add(worldRoot);

  // integrity: the GLBs on disk must match the manifest the tests validate
  for (const [id, a] of Object.entries(manifest.assets)) {
    const got = id === 'temple' ? main : id === 'ground' ? ground : id === 'lions' ? lions : ornaments;
    if (got.bytes !== a.bytes) throw new Error(`asset ${id}: bytes ${got.bytes} != manifest ${a.bytes}`);
  }

  worldRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !/temple-ground/.test(o.parent?.name ?? '') && !/^temple-ground/.test(o.name);
    o.receiveShadow = true;
    for (const m of [o.material].flat())
      for (const v of Object.values(m)) if (v?.isTexture) v.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  });

  // physics: walls from collision-world.json + ground trimesh from the VISIBLE paving
  const collision = await json(BASE + 'collision-world.json');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics = { world, wallCount: 0, groundTriangleCount: 0, dispose: () => world.free() };
  for (const rec of collision.colliders) { addWallCollider(RAPIER, world, rec); physics.wallCount++; }
  const gt = collectGroundTriangles(groundMeshesOf(ground.root));
  addGroundCollider(RAPIER, world, gt);
  physics.groundTriangleCount = gt.triangleCount;

  const r = resources();
  const expected = Object.values(manifest.assets).reduce((s, a) => s + a.triangles, 0);
  if (r.triangles !== expected)
    throw new Error(`geometry integrity: ${r.triangles} triangles loaded != manifest ${expected}`);

  loadStats = {
    bytesTotal: main.bytes + ground.bytes + lions.bytes + ornaments.bytes,
    bytesMain: main.bytes + ground.bytes,
    bytesCandidates: lions.bytes + ornaments.bytes,
    fetchParseMs: main.ms + ground.ms + lions.ms + ornaments.ms,
    wallColliders: physics.wallCount,
    groundTriangles: physics.groundTriangleCount,
  };
  ready = true;
  setupButtons();
  setView('front');
  await runPassageCheck();
  noticeEl.textContent = `样板已载入：${r.triangles.toLocaleString()} 三角形，${(loadStats.bytesTotal / 1e6).toFixed(2)} MB（加载 ${loadStats.fetchParseMs}ms）。`;
  window.__templeRecord = record; // capture script asserts telemetry from the page itself
}

load().catch((e) => {
  stats.textContent = '载入失败：' + e.message;
  noticeEl.textContent = '样板载入失败：' + e.message;
  throw e;
});
