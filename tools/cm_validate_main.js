// N closeout: in-browser loader for decode validation. Exposes
// window.__cmLoad(url) -> { triangles, min, max, meshes, materials, textures,
// groundNames } using the production GLTFLoader factory (MeshoptDecoder
// wired), so a candidate only counts once it loads through the same path as
// the shipped pages.
import * as THREE from 'three';
import { createGLTFLoader } from '/src/world/decoders.js';

const GROUND_PREFIX_RE = /^(street-kit__|sctail__|laneb__|temple-ground__)/;
const loader = createGLTFLoader({ baseUrl: './' });

async function loadGlb(url) {
  return new Promise((res, rej) => {
    loader.load(url, (gltf) => res(gltf), undefined, (e) => rej(new Error(String(e?.message ?? e))));
  });
}

window.__cmLoad = async (url) => {
  const gltf = await loadGlb(url);
  const scene = gltf.scene || gltf.scenes[0];
  scene.updateMatrixWorld(true);
  let triangles = 0, meshes = 0;
  const materials = new Set(), textures = new Set(), groundNames = [];
  scene.traverse((o) => {
    if (o.name && GROUND_PREFIX_RE.test(o.name)) groundNames.push(o.name);
    if (!o.isMesh) return;
    meshes += 1;
    const g = o.geometry;
    triangles += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    for (const m of [o.material].flat()) {
      materials.add(m);
      // count unique IMAGES, not texture objects: gltfpack -kn expands shared
      // texture objects (one per primitive) — documented in the shipped cm
      // manifests — while the underlying image data must stay 1:1
      for (const v of Object.values(m)) if (v?.isTexture && v.image) textures.add(v.image.uuid);
    }
  });
  const box = new THREE.Box3().setFromObject(scene);
  return {
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    groundNames,
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
};
console.log('cm validate harness ready');
