// Shared temple-viewer core — the pieces both pilot pages (temple.html on
// 5290/5291, temple-entry.html on 5292/5293) must never fork: renderer/scene/
// light rig, the faithful camera-pose verification, GLB loading with real
// byte/timing stats, ground-mesh extraction for physics, the walk-mode input
// chain and the local evidence endpoint call. Page-specific UI stays in the
// page mains; engine behavior lives here once.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGLTFLoader } from './world/decoders.js';

export const CAPSULE = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };

export function createSceneRig(appEl, { background = 0xd9dfd9 } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  appEl.appendChild(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color(background);
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
  controls.maxPolarAngle = Math.PI; // never clamp lead-designed poses (F2)

  const clay = new T.MeshStandardMaterial({ color: 0xb8b7ae, roughness: .86 });

  return { renderer, scene, camera, controls, sun, clay };
}

// Apply a cameras.json view and verify the executed pose AFTER
// controls.update() — degrees straight from the contract, never reconverted.
export function applyViewVerified(camera, controls, view) {
  camera.position.set(...view.positionGlb);
  controls.target.set(...view.targetGlb);
  camera.fov = view.verticalFovDegrees;
  camera.updateProjectionMatrix();
  controls.update();
  const dPos = Math.max(
    camera.position.distanceTo(new T.Vector3(...view.positionGlb)),
    controls.target.distanceTo(new T.Vector3(...view.targetGlb)),
  );
  const dFov = Math.abs(camera.fov - view.verticalFovDegrees);
  return { view: view.id, dPos: +dPos.toFixed(6), dFov: +dFov.toFixed(6),
           pass: dPos < 1e-3 && dFov < 1e-6 };
}

export async function loadGlbWithStats(path, name, { renderer, baseUrl }) {
  const t0 = performance.now();
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  const loader = createGLTFLoader({ renderer, baseUrl });
  const model = await loader.parseAsync(data, baseUrl);
  model.scene.name = name;
  return { root: model.scene, bytes: data.byteLength, ms: +(performance.now() - t0).toFixed(1) };
}

export function groundMeshesOf(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !/^temple-ground__/.test(o.name)) return;
    out.push({
      name: o.name,
      positions: o.geometry.attributes.position.array,
      indices: o.geometry.index ? o.geometry.index.array : Uint32Array.from({ length: o.geometry.attributes.position.count }, (_, i) => i),
      matrix: o.matrixWorld.elements.slice(),
    });
  });
  return out;
}

// Walk-mode input chain shared by both pages (same keys/mouse rules).
export function createWalkInput({ onVertical }) {
  const keys = { w: false, a: false, s: false, d: false };
  const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
  const state = { keys };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.code === 'Space' && onVertical) { onVertical(true); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });
  return state;
}

export async function saveEvidence(name, image, record) {
  const res = await fetch('/__review-evidence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, image, record }),
  });
  if (!res.ok) throw new Error(`保存 HTTP ${res.status}`);
  return res.json();
}

export function countResources(scene, clay) {
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
