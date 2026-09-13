// N4 compression lab — loads a GLB through the SAME decoder-wired factory as
// the production WorldLoader (createGLTFLoader), renders it with the client's
// visual setup (AgX, exposure 1, RoomEnvironment), and exposes measurements.
// Used only by tools/compression_lab.mjs; not part of the built app.
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGLTFLoader } from './world/decoders.js';

const src = new URLSearchParams(location.search).get('src');
const app = document.querySelector('#app');

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.AgXToneMapping;
renderer.toneMappingExposure = 1;
renderer.setSize(1280, 960, false);
app.appendChild(renderer.domElement);

const scene = new T.Scene();
scene.background = new T.Color(0xdde3df);
const pmrem = new T.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const env = pmrem.fromScene(room, .04);
scene.environment = env.texture;
scene.environmentIntensity = .28;
room.dispose();
pmrem.dispose();
scene.add(new T.HemisphereLight(0xe8f0f5, 0xb9b2a1, .72));
const sun = new T.DirectionalLight(0xfff5ea, 2.4);
sun.position.set(-20, 65, 48);
scene.add(sun);
const camera = new T.PerspectiveCamera(45, 1280 / 960, .1, 600);

async function run() {
  const t0 = performance.now();
  const res = await fetch(src, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
  const data = await res.arrayBuffer();
  const t1 = performance.now();
  const model = await createGLTFLoader({ renderer, baseUrl: './' }).parseAsync(data, new URL('.', location.href).href);
  const t2 = performance.now();
  const root = model.scene;
  scene.add(root);
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root);
  const size = box.getSize(new T.Vector3());
  const ctr = box.getCenter(new T.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  // front view, same relative framing as the kit renders
  camera.position.set(ctr.x, ctr.y - span * 2.1 * .35, ctr.z + span * 2.1);
  camera.lookAt(ctr.x, ctr.y, box.min.z + size.z * .45);
  renderer.render(scene, camera);
  const g = new Set(), m = new Set(), tex = new Set();
  let triangles = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    g.add(o.geometry);
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    for (const mat of [o.material].flat()) {
      m.add(mat);
      for (const v of Object.values(mat)) if (v?.isTexture) tex.add(v);
    }
  });
  window.__labResult = {
    src,
    bytes: data.byteLength,
    fetchMs: +(t1 - t0).toFixed(1),
    parseMs: +(t2 - t1).toFixed(1),
    triangles,
    uniqueGeometries: g.size,
    uniqueMaterials: m.size,
    uniqueTextures: tex.size,
    extensionsUsed: model.parser?.json?.extensionsUsed ?? [],
    nodeNames: root.children.map(o => o.name).slice(0, 12),
  };
  document.title = 'LAB_READY';
}

run().catch(e => {
  window.__labResult = { src, error: String(e) };
  document.title = 'LAB_ERROR';
});
