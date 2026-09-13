// GLTFLoader factory with the full decoder set wired in. The production
// WorldLoader and the N4 compression lab use THE SAME factory, so a
// compressed asset can only be called delivered once it loads through this
// exact path (addendum: assets whose decoder is not wired do not count).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let ktx2 = null;

export function createGLTFLoader({ renderer, baseUrl = './' } = {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // EXT_meshopt_compression
  if (renderer) {
    if (!ktx2) {
      ktx2 = new KTX2Loader()
        .setTranscoderPath(new URL('decoder/basis/', new URL(baseUrl, location.href)).href)
        .detectSupport(renderer);
    }
    loader.setKTX2Loader(ktx2); // KHR_texture_basisu
    const draco = new DRACOLoader().setDecoderPath(new URL('decoder/draco/', new URL(baseUrl, location.href)).href);
    loader.setDRACOLoader(draco); // KHR_draco_mesh_compression (if ever used)
  }
  return loader;
}

export function disposeDecoders() {
  if (ktx2) { ktx2.dispose(); ktx2 = null; }
}
