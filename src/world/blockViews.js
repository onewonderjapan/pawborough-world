// three.js view factory for the N6 block lifecycle sample — neutral gray
// low-poly extrusions of map placeholders, no invented historical detail.
import * as T from 'three';

export function createBlockViews(scene) {
  const material = new T.MeshStandardMaterial({ color: 0x9aa09b, roughness: .95 });
  return {
    add(obj) { if (obj) scene.add(obj); },
    remove(obj) { if (obj) scene.remove(obj); },
    makePlaceholder(ph) {
      const geo = new T.BoxGeometry(ph.widthM, ph.heightM, ph.depthM);
      const mesh = new T.Mesh(geo, material);
      mesh.position.set(ph.glbPoint[0], ph.heightM / 2, ph.glbPoint[1]);
      mesh.rotation.y = ph.angleRad;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `placeholder__${ph.id}`;
      return { object: mesh, dispose() { geo.dispose(); } };
    },
    disposePlaceholder(v) { v.dispose(); },
    // the reviewed street is already in the scene via WorldLoader; marking the
    // block active is what suppresses its replaced placeholders
    async makeReviewed() { return { group: null, colliders: [] }; },
    disposeReviewed() {},
  };
}
