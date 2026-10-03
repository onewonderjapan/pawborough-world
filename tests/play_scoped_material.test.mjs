import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from 'three';

import { applyWorldArtStyle } from '../scene-authoring/yuyuan-area/web/material-style.js';
import {
  isPointInScope,
  isTriangleInScope,
  createScopedGeometry,
  applyScopedMaterial
} from '../scene-authoring/yuyuan-area/web/scoped-material.js';
import {
  getSharedLacquerTexture,
  disposeWorldArtPilotTextures
} from '../scene-authoring/yuyuan-area/web/world-art-pilot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const area = resolve(__dirname, '../scene-authoring/yuyuan-area');
const stylePath = resolve(area, 'inputs/world-art-style.json');
const glbPath = resolve(area, 'resources/play-facades/play-closed-facades.glb');

// Node self polyfill for GLTFLoader
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
const { GLTFLoader } = await import(resolve(area, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'));

test('U05 actual play-closed-facades.glb: scoped batched wood meshes split into <=2 groups with preserved outside material', async () => {
  const glbBytes = await readFile(glbPath);
  const gltf = await new Promise((ok, no) =>
    new GLTFLoader().parse(
      glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength),
      '',
      ok,
      no
    )
  );

  const styleConfig = JSON.parse(await readFile(stylePath, 'utf8'));

  let woodMesh = null;
  let woodDarkMesh = null;

  gltf.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (mesh.material?.name === 'facades-wood') woodMesh = mesh;
    if (mesh.material?.name === 'facades-wood-dark') woodDarkMesh = mesh;
  });

  assert.ok(woodMesh, 'facades-wood mesh must exist in play-closed-facades.glb');
  assert.ok(woodDarkMesh, 'facades-woodDark mesh must exist in play-closed-facades.glb');

  // Verify initial state: batched meshes span ~279m, no groups, no UVs
  woodMesh.geometry.computeBoundingBox();
  woodDarkMesh.geometry.computeBoundingBox();
  const spanX = Math.abs(woodMesh.geometry.boundingBox.max.x - woodMesh.geometry.boundingBox.min.x);
  assert.ok(spanX > 100, `facades-wood must be large batched city mesh (spanX=${spanX.toFixed(1)}m > 100m)`);
  assert.equal(woodMesh.geometry.groups.length, 0, 'original facades-wood has no groups');
  assert.equal(woodDarkMesh.geometry.groups.length, 0, 'original facades-woodDark has no groups');

  const origGeomWood = woodMesh.geometry;
  const origMatWood = woodMesh.material;
  const origTriCountWood = origGeomWood.index.count / 3;

  const origGeomDark = woodDarkMesh.geometry;
  const origMatDark = woodDarkMesh.material;
  const origTriCountDark = origGeomDark.index.count / 3;

  const sharedMaterials = new Map();
  const { dispose, stats } = applyWorldArtStyle(gltf.scene, { style: styleConfig, sharedMaterials });

  // 1. Stats verification
  assert.ok(stats.appliedFamilies.includes('closed-door-lacquer'), 'closed-door-lacquer family applied');
  assert.equal(stats.matchedMeshes, 2, 'matched exactly the 2 wood meshes');
  assert.ok(stats.insideTriangleCount > 0, `insideTriangleCount must be > 0 (got ${stats.insideTriangleCount})`);
  // Independent actual-asset scan for the frozen center/fangbang allowlist.
  assert.equal(stats.insideTriangleCount, 878 + 3950, 'exact inside triangle count matched');

  // 2. facades-wood mesh verification
  assert.notEqual(woodMesh.geometry, origGeomWood, 'wood mesh geometry is cloned for rendering');
  assert.equal(woodMesh.geometry.index.count / 3, origTriCountWood, 'total triangles in wood geometry must remain unchanged');
  assert.ok(Array.isArray(woodMesh.material), 'wood mesh material replaced with array [outside, inside]');
  assert.equal(woodMesh.material.length, 2, 'wood mesh has exactly 2 materials');
  assert.equal(woodMesh.material[0], origMatWood, 'outside material must preserve exact original material instance');
  assert.notEqual(woodMesh.material[1], origMatWood, 'inside material must be derived lacquer material');
  assert.ok(woodMesh.material[1].map, 'inside material must have procedural lacquer map');
  assert.equal(woodMesh.geometry.groups.length, 2, 'wood geometry has at most 2 groups (exactly 2)');

  const woodGroup0 = woodMesh.geometry.groups[0];
  const woodGroup1 = woodMesh.geometry.groups[1];
  assert.equal(woodGroup0.materialIndex, 0, 'group 0 uses outside material index 0');
  assert.equal(woodGroup1.materialIndex, 1, 'group 1 uses inside material index 1');
  const woodInsideTris = woodGroup1.count / 3;
  const woodOutsideTris = woodGroup0.count / 3;
  assert.ok(woodInsideTris > 0, `wood inside triangles must be > 0 (got ${woodInsideTris})`);
  assert.ok(woodOutsideTris > 0, `wood outside triangles must be > 0 (got ${woodOutsideTris})`);
  assert.equal(woodInsideTris + woodOutsideTris, origTriCountWood, 'sum of inside and outside triangles equals original');

  // 3. facades-woodDark mesh verification
  assert.notEqual(woodDarkMesh.geometry, origGeomDark, 'woodDark mesh geometry is cloned for rendering');
  assert.equal(woodDarkMesh.geometry.index.count / 3, origTriCountDark, 'total triangles in woodDark geometry must remain unchanged');
  assert.ok(Array.isArray(woodDarkMesh.material), 'woodDark mesh material replaced with array [outside, inside]');
  assert.equal(woodDarkMesh.material.length, 2, 'woodDark mesh has exactly 2 materials');
  assert.equal(woodDarkMesh.material[0], origMatDark, 'outside material must preserve exact original dark material instance');
  assert.notEqual(woodDarkMesh.material[1], origMatDark, 'inside material must be derived lacquer material');
  assert.ok(woodDarkMesh.material[1].map, 'inside material must have procedural lacquer map');
  assert.equal(woodDarkMesh.geometry.groups.length, 2, 'woodDark geometry has at most 2 groups (exactly 2)');

  const darkGroup0 = woodDarkMesh.geometry.groups[0];
  const darkGroup1 = woodDarkMesh.geometry.groups[1];
  assert.equal(darkGroup0.materialIndex, 0, 'group 0 uses outside material index 0');
  assert.equal(darkGroup1.materialIndex, 1, 'group 1 uses inside material index 1');
  const darkInsideTris = darkGroup1.count / 3;
  const darkOutsideTris = darkGroup0.count / 3;
  assert.ok(darkInsideTris > 0, `dark inside triangles must be > 0 (got ${darkInsideTris})`);
  assert.ok(darkOutsideTris > 0, `dark outside triangles must be > 0 (got ${darkOutsideTris})`);
  assert.equal(darkInsideTris + darkOutsideTris, origTriCountDark, 'sum of inside and outside triangles equals original');

  // 4. Coordinates / world bounds unchanged
  assert.ok(origGeomWood.boundingBox.equals(woodMesh.geometry.boundingBox), 'wood geometry bounding box unchanged');
  assert.ok(origGeomDark.boundingBox.equals(woodDarkMesh.geometry.boundingBox), 'woodDark geometry bounding box unchanged');

  // 5. Clean restoration on dispose
  dispose();
  assert.equal(woodMesh.geometry, origGeomWood, 'wood mesh geometry restored to exact original pointer');
  assert.equal(woodMesh.material, origMatWood, 'wood mesh material restored to exact original pointer');
  assert.equal(woodDarkMesh.geometry, origGeomDark, 'woodDark mesh geometry restored to exact original pointer');
  assert.equal(woodDarkMesh.material, origMatDark, 'woodDark mesh material restored to exact original pointer');

  // Idempotent dispose
  assert.doesNotThrow(() => dispose(), 'calling dispose twice must be idempotent and safe');
});

test('U05 texture lifecycle: shared lacquer texture is not prematurely released across owners', () => {
  disposeWorldArtPilotTextures({ force: true });

  const rootA = new THREE.Group();
  const rootB = new THREE.Group();

  const geomA = new THREE.BufferGeometry();
  // 2 triangles: T0 inside center scope [-158, 1, -22], T1 outside [500, 0, 500]
  const posA = new Float32Array([
    // T0 inside
    -158, 0, -22,
    -157, 0, -22,
    -157, 2, -22,
    // T1 outside
    500, 0, 500,
    502, 0, 500,
    500, 2, 500
  ]);
  const indicesA = new Uint16Array([0, 1, 2, 3, 4, 5]);
  geomA.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geomA.setIndex(new THREE.BufferAttribute(indicesA, 1));
  const matA = new THREE.MeshStandardMaterial({ name: 'facades-wood' });
  const meshA = new THREE.Mesh(geomA, matA);
  rootA.add(meshA);
  rootA.updateMatrixWorld(true);

  const geomB = geomA.clone();
  const matB = new THREE.MeshStandardMaterial({ name: 'facades-wood' });
  const meshB = new THREE.Mesh(geomB, matB);
  rootB.add(meshB);
  rootB.updateMatrixWorld(true);

  const sharedMaterialsA = new Map();
  const sharedMaterialsB = new Map();
  const styleConfig = {
    id: 'test-style',
    enabled: true,
    families: [
      {
        id: 'closed-door-lacquer',
        materialNames: ['facades-wood'],
        scopes: [{ id: 'center', boundsXZ: [-198, -66, -118, 8] }],
        maxMeshSpanM: 0 // forces triangle splitting
      }
    ]
  };

  const handleA = applyWorldArtStyle(rootA, { style: styleConfig, sharedMaterials: sharedMaterialsA });
  const handleB = applyWorldArtStyle(rootB, { style: styleConfig, sharedMaterials: sharedMaterialsB });

  // Each mesh received lacquer material as group 1
  const lacqMatA = Array.isArray(meshA.material) ? meshA.material[1] : meshA.material;
  const lacqMatB = Array.isArray(meshB.material) ? meshB.material[1] : meshB.material;
  assert.ok(lacqMatA.map, 'meshA received procedural lacquer texture');
  assert.ok(lacqMatB.map, 'meshB received procedural lacquer texture');
  assert.equal(lacqMatA.map, lacqMatB.map, 'both roots share identical procedural lacquer texture');

  let textureDisposeCount = 0;
  lacqMatA.map.addEventListener('dispose', () => {
    textureDisposeCount++;
  });

  // Dispose Owner A: texture must NOT be disposed because Owner B is still active
  handleA.dispose();
  assert.equal(textureDisposeCount, 0, 'texture must NOT be disposed when Owner A releases');
  assert.equal(meshA.material, matA, 'meshA restored to original material');
  const activeLacqMatB = Array.isArray(meshB.material) ? (meshB.material[1] || meshB.material[0]) : meshB.material;
  assert.equal(activeLacqMatB.map, lacqMatB.map, 'meshB still retains valid shared texture');

  // Dispose Owner B: texture now has 0 references and is disposed
  handleB.dispose();
  assert.equal(textureDisposeCount, 1, 'texture must be disposed when final Owner B releases');
  assert.equal(meshB.material, matB, 'meshB restored to original material');

  disposeWorldArtPilotTextures({ force: true });
});

test('U05 boundary dummy: triangles crossing scope boundary are never dyed (remain outside/original material)', () => {
  const dummyGeom = new THREE.BufferGeometry();
  // 3 triangles:
  // T0 (inside): (0, 0, 0), (2, 0, 0), (0, 2, 0) -> all within [-10, -10, 10, 10]
  // T1 (boundary cross): (5, 0, 5) [in], (9, 0, 9) [in], (15, 0, 15) [OUT] -> crosses boundary!
  // T2 (outside): (50, 0, 50), (52, 0, 50), (50, 2, 50) -> completely outside
  const positions = new Float32Array([
    // T0
    0, 0, 0,
    2, 0, 0,
    0, 2, 0,
    // T1 (crossing)
    5, 0, 5,
    9, 0, 9,
    15, 0, 15,
    // T2 (outside)
    50, 0, 50,
    52, 0, 50,
    50, 2, 50
  ]);
  const indices = new Uint16Array([
    0, 1, 2,
    3, 4, 5,
    6, 7, 8
  ]);
  dummyGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dummyGeom.setIndex(new THREE.BufferAttribute(indices, 1));

  const origMat = new THREE.MeshStandardMaterial({ name: 'facades-wood' });
  const dummyMesh = new THREE.Mesh(dummyGeom, origMat);

  const scopes = [
    { id: 'box', boundsXZ: [-10, -10, 10, 10] }
  ];

  const insideMat = new THREE.MeshStandardMaterial({ name: 'inside-lacquer' });
  const result = applyScopedMaterial(dummyMesh, {
    scopes,
    insideMaterial: insideMat,
    outsideMaterial: origMat
  });

  assert.equal(result.applied, true, 'scoped material applied');
  assert.equal(result.insideTriangleCount, 1, 'ONLY T0 is inside; T1 crossing boundary must NOT be inside');
  assert.equal(result.outsideTriangleCount, 2, 'T1 and T2 remain outside');

  assert.ok(Array.isArray(dummyMesh.material), 'material is array [outside, inside]');
  assert.equal(dummyMesh.material[0], origMat, 'group 0 uses original material');
  assert.equal(dummyMesh.material[1], insideMat, 'group 1 uses inside material');

  assert.equal(dummyMesh.geometry.groups.length, 2, 'exactly 2 groups created');
  assert.equal(dummyMesh.geometry.groups[0].count, 6, 'outside group contains exactly 2 triangles (6 indices)');
  assert.equal(dummyMesh.geometry.groups[1].count, 3, 'inside group contains exactly 1 triangle (3 indices)');

  // Verify indices of outside group point to T1 and T2 vertices (indices 3..8), NOT inside T0
  const idxAttr = dummyMesh.geometry.index;
  // Outside part: first 6 indices
  const outsideTriIndices = [idxAttr.getX(0), idxAttr.getX(3)];
  // Neither of the outside triangle root vertices should be vertex 0 (T0)
  assert.ok(!outsideTriIndices.includes(0), 'T0 must not be in outside group');

  // Clean restoration
  result.restore();
  assert.equal(dummyMesh.geometry, dummyGeom, 'geometry pointer restored');
  assert.equal(dummyMesh.material, origMat, 'material pointer restored');
});

test('U05 large batched mesh with zero inside triangles is left untouched', () => {
  const dummyGeom = new THREE.BufferGeometry();
  // Triangles far away: [500, 0, 500]
  const positions = new Float32Array([
    500, 0, 500,
    502, 0, 500,
    500, 2, 500
  ]);
  dummyGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dummyGeom.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));

  const origMat = new THREE.MeshStandardMaterial({ name: 'facades-wood' });
  const mesh = new THREE.Mesh(dummyGeom, origMat);

  const scopes = [
    { id: 'box', boundsXZ: [-10, -10, 10, 10] }
  ];

  const result = applyScopedMaterial(mesh, {
    scopes,
    insideMaterial: new THREE.MeshStandardMaterial()
  });

  assert.equal(result.applied, false, 'not applied when 0 triangles inside');
  assert.equal(mesh.geometry, dummyGeom, 'geometry untouched');
  assert.equal(mesh.material, origMat, 'material untouched');
});
