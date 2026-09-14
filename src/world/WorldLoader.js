// Minimal WorldLoader — browser entry for the reviewed street world.
// Consumes the lead-approved single assembly (world/street-reviewed.glb) plus
// the world JSONs, builds the shared physics world, and hands back a handle
// with everything the client needs and a full dispose. It deliberately does
// NOT load street-kit.glb or the 13 module GLBs — that would duplicate every
// house (and regress the 18-texture sharing to 161 objects).
//
// Data-path pieces that must be testable in node live in sibling modules
// (collisionAdapter / groundExtractor / physics); this file only wires
// three.js + fetch + Rapier.

import * as T from 'three';
import { validateWorldInputs, GROUND_NODE_RE } from './collisionAdapter.js';
import { collectGroundTriangles } from './groundExtractor.js';
import { buildPhysicsWorld } from './physics.js';
import { createGLTFLoader } from './decoders.js';

export const CAPSULE = {
  radius: 0.35,      // = route.json clearance.clearRadiusM
  halfHeight: 0.6,   // total height 1.9 m
  eyeHeight: 1.6,
};

export async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`world input: ${path} HTTP ${r.status}`);
  return r.json();
}

export async function loadWorld({ RAPIER, baseUrl = './world/', renderer = null } = {}) {
  const u = (p) => new URL(p, new URL(baseUrl, location.href)).href;
  // baseUrl is the DATASET directory (files directly inside it). blocks.json
  // is required: fetchJson throws on HTTP errors and validateWorldInputs
  // throws on malformed content, so a missing/corrupt block dataset can never
  // come back as an HTML error page and silently disable the block lifecycle.
  const [manifest, instances, collision, route, blocks] = await Promise.all([
    fetchJson(u('review-manifest.json')),
    fetchJson(u('instances.json')),
    fetchJson(u('collision-world.json')),
    fetchJson(u('route.json')),
    fetchJson(u('blocks.json')),
  ]);
  validateWorldInputs({ manifest, instances, collision, route, blocks });

  // --- geometry (single assembly; identical to the shipped orbit viewer) ---
  // manifest asset paths are site-root-relative (frozen: ./world/..., laneb: ./world/laneb/...)
  const res = await fetch(new URL(manifest.worldAssembly.path, location.href), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`world input: ${manifest.worldAssembly.path} HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  const model = await createGLTFLoader({ renderer, baseUrl }).parseAsync(data, u('./'));
  const root = model.scene;
  root.name = 'world-root';

  let placedTriangles = 0;
  const uniqueGeometries = new Set();
  const uniqueMaterials = new Set();
  const uniqueTextures = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    uniqueGeometries.add(o.geometry);
    placedTriangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    for (const mat of [o.material].flat()) {
      uniqueMaterials.add(mat);
      for (const v of Object.values(mat)) if (v?.isTexture) uniqueTextures.add(v);
    }
  });
  if (placedTriangles !== manifest.placedTriangles)
    throw new Error(`world integrity: placed triangles ${placedTriangles} != manifest ${manifest.placedTriangles}`);
  if (uniqueTextures.size > manifest.sceneImages.count * 2)
    throw new Error(`world integrity: ${uniqueTextures.size} textures — image sharing regressed (expected ~${manifest.sceneImages.count})`);

  // --- ground triangles from the verified street-kit faces ---
  root.updateMatrixWorld(true);
  const groundMeshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !GROUND_NODE_RE.test(o.name)) return;
    groundMeshes.push({
      name: o.name,
      positions: o.geometry.attributes.position.array,
      indices: o.geometry.index ? o.geometry.index.array : contiguousIndices(o.geometry.attributes.position.count),
      matrix: o.matrixWorld.elements.slice(),
    });
  });
  const groundTriangles = collectGroundTriangles(groundMeshes);

  // --- physics ---
  const physics = buildPhysicsWorld(RAPIER, { collision, groundTriangles });

  // --- spawn: route west entry, feet above the real road, controller settles ---
  const spawnPoint = route.entries.west.slice();
  const spawn = { x: spawnPoint[0], y: spawnPoint[1] + 1.0, z: spawnPoint[2] };

  let disposed = false;
  return {
    RAPIER,
    renderer,
    root,
    physics,
    route,
    instances,
    manifest,
    collision,
    blocks,
    groundTriangles,
    capsule: CAPSULE,
    spawn,
    stats: {
      placedTriangles,
      uniqueGeometries: uniqueGeometries.size,
      uniqueMaterials: uniqueMaterials.size,
      uniqueTextures: uniqueTextures.size,
      wallColliders: physics.wallCount,
      groundTriangles: physics.groundTriangleCount,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      physics.dispose();
      root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          for (const mat of [o.material].flat()) {
            for (const v of Object.values(mat)) if (v?.isTexture) v.dispose();
            mat.dispose();
          }
        }
      });
      root.removeFromParent();
    },
  };
}

function contiguousIndices(count) {
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  return idx;
}
