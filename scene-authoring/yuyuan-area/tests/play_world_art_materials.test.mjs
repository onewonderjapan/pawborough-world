import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { applyWorldArtStyle } from '../web/material-style.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylePath = path.resolve(__dirname, '../inputs/world-art-style.json');
const styleConfig = JSON.parse(await fs.readFile(stylePath, 'utf8'));

// Helper to create a standard mesh in a specific position and size
function createMesh(name, matName, position = [-150, 0, -50], size = [2, 2, 2]) {
  const geom = new THREE.BoxGeometry(...size);
  const mat = new THREE.MeshStandardMaterial({
    name: matName,
    color: new THREE.Color(0xffffff),
    roughness: 0.5,
    metalness: 0.5
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.updateMatrixWorld(true);
  return { mesh, geom, mat };
}

console.log('--- Test 1: two scoped meshes share one variant ---');
{
  const root = new THREE.Group();
  // "center" scope boundsXZ: [-198, -66, -118, 8]
  // Material "btk-wood" belongs to "red-wood" family
  // Test Blender suffix: mesh1 uses "btk-wood", mesh2 uses "btk-wood.002"
  const { mesh: m1, mat: mat1 } = createMesh('m1', 'btk-wood', [-150, 0, -50]);
  const { mesh: m2, mat: mat2 } = createMesh('m2', 'btk-wood.002', [-160, 0, -40]);
  // Set mat2 to use the same underlying material instance or another with same name
  m2.material = mat1; // Both reference mat1 to verify shared variant
  root.add(m1, m2);
  root.updateMatrixWorld(true);

  const sharedMaterials = new Map();
  const { dispose, stats } = applyWorldArtStyle(root, { style: styleConfig, sharedMaterials });

  assert.equal(stats.matchedMeshes, 2, 'both meshes should be matched');
  assert.equal(stats.uniqueVariants, 1, 'only one unique variant should be created');
  assert.ok(stats.appliedFamilies.includes('red-wood'), 'appliedFamilies should include red-wood');
  assert.equal(m1.material, m2.material, 'two scoped meshes share the same variant instance');
  assert.notEqual(m1.material, mat1, 'material was replaced by variant clone');
  assert.equal(m1.material.name, mat1.name, 'material name preserved');

  // Verify frozen tint, blend, roughness, metalness
  const family = styleConfig.families.find(f => f.id === 'red-wood');
  const expectedColor = mat1.color.clone().lerp(new THREE.Color(family.tint), family.colorBlend);
  assert.ok(Math.abs(m1.material.color.r - expectedColor.r) < 1e-4, 'color r matches');
  assert.ok(Math.abs(m1.material.color.g - expectedColor.g) < 1e-4, 'color g matches');
  assert.ok(Math.abs(m1.material.color.b - expectedColor.b) < 1e-4, 'color b matches');
  assert.equal(m1.material.roughness, family.roughness, 'roughness matches frozen value');
  assert.equal(m1.material.metalness, family.metalness, 'metalness matches frozen value');

  dispose();
  assert.equal(m1.material, mat1, 'mesh1 restored to original reference');
  assert.equal(m2.material, mat1, 'mesh2 restored to original reference');
}

console.log('--- Test 2: out-of-scope/oversize/skinned/unknown unchanged ---');
{
  const root = new THREE.Group();
  // 1. out-of-scope: position at (1000, 0, 1000)
  const { mesh: mOutOfScope, mat: matOut } = createMesh('mOut', 'btk-wood', [1000, 0, 1000]);
  // 2. oversize: red-wood maxMeshSpanM is 90; size 120 in X
  const { mesh: mOversize, mat: matOver } = createMesh('mOver', 'btk-wood', [-150, 0, -50], [120, 2, 2]);
  // 3. skinned: THREE.SkinnedMesh inside scope
  const geomSkin = new THREE.BoxGeometry(2, 2, 2);
  const matSkin = new THREE.MeshStandardMaterial({ name: 'btk-wood' });
  const mSkinned = new THREE.SkinnedMesh(geomSkin, matSkin);
  mSkinned.position.set(-150, 0, -50);
  // 4. unknown material: material name not in any family
  const { mesh: mUnknown, mat: matUnk } = createMesh('mUnk', 'completely-unknown-material', [-150, 0, -50]);

  // 5. array material with one known and one unknown
  const geomArray = new THREE.BoxGeometry(2, 2, 2);
  const matKnown = new THREE.MeshStandardMaterial({ name: 'palewood' }); // stall-wood family, span <= 30
  const matUnknownInArray = new THREE.MeshStandardMaterial({ name: 'other-unknown' });
  const origArray = [matKnown, matUnknownInArray];
  const mArray = new THREE.Mesh(geomArray, origArray);
  mArray.position.set(-150, 0, -50);

  root.add(mOutOfScope, mOversize, mSkinned, mUnknown, mArray);
  root.updateMatrixWorld(true);

  const { dispose, stats } = applyWorldArtStyle(root, { style: styleConfig });

  assert.equal(mOutOfScope.material, matOut, 'out-of-scope mesh unchanged');
  assert.equal(mOversize.material, matOver, 'oversize mesh unchanged');
  assert.equal(mSkinned.material, matSkin, 'skinned mesh unchanged');
  assert.equal(mUnknown.material, matUnk, 'unknown material unchanged');

  // Verify array material assigned new array without mutating original array
  assert.notEqual(mArray.material, origArray, 'assigned new material array');
  assert.equal(origArray[0], matKnown, 'original array index 0 not mutated');
  assert.equal(origArray[1], matUnknownInArray, 'original array index 1 not mutated');
  assert.notEqual(mArray.material[0], matKnown, 'known material in array replaced by variant');
  assert.equal(mArray.material[1], matUnknownInArray, 'unknown material in array kept unchanged');

  dispose();
  assert.equal(mArray.material, origArray, 'array mesh restored to exact original array');
}

console.log('--- Test 3: two roots share variant via same cache, disposing first preserves second then last releases exactly once ---');
{
  const root1 = new THREE.Group();
  const root2 = new THREE.Group();
  const sharedMat = new THREE.MeshStandardMaterial({ name: 'ht-wood-red', color: new THREE.Color(0x888888) });

  const geom1 = new THREE.BoxGeometry(2, 2, 2);
  const mesh1 = new THREE.Mesh(geom1, sharedMat);
  mesh1.position.set(-150, 0, -50);
  root1.add(mesh1);
  root1.updateMatrixWorld(true);

  const geom2 = new THREE.BoxGeometry(2, 2, 2);
  const mesh2 = new THREE.Mesh(geom2, sharedMat);
  mesh2.position.set(-155, 0, -45);
  root2.add(mesh2);
  root2.updateMatrixWorld(true);

  const sharedCache = new Map();
  const app1 = applyWorldArtStyle(root1, { style: styleConfig, sharedMaterials: sharedCache });
  const app2 = applyWorldArtStyle(root2, { style: styleConfig, sharedMaterials: sharedCache });

  assert.equal(mesh1.material, mesh2.material, 'two roots share the same variant instance');
  const variant = mesh1.material;

  let disposeCallCount = 0;
  const originalDispose = variant.dispose.bind(variant);
  variant.dispose = () => {
    disposeCallCount++;
    originalDispose();
  };

  // Disposing root1 should NOT dispose the variant because root2 still uses it
  app1.dispose();
  assert.equal(mesh1.material, sharedMat, 'root1 mesh restored to original');
  assert.equal(mesh2.material, variant, 'root2 mesh retains variant');
  assert.equal(disposeCallCount, 0, 'variant was not disposed after first root release');

  // Disposing root2 should now dispose the variant exactly once
  app2.dispose();
  assert.equal(mesh2.material, sharedMat, 'root2 mesh restored to original');
  assert.equal(disposeCallCount, 1, 'variant was disposed exactly once when last root released');
}

console.log('--- Test 4: repeated dispose is safe ---');
{
  const root = new THREE.Group();
  const { mesh, mat } = createMesh('m_repeat', 'palewood', [-150, 0, -50]);
  root.add(mesh);
  root.updateMatrixWorld(true);

  const app = applyWorldArtStyle(root, { style: styleConfig });
  const variant = mesh.material;
  let disposeCount = 0;
  const origDisp = variant.dispose.bind(variant);
  variant.dispose = () => {
    disposeCount++;
    origDisp();
  };

  app.dispose();
  assert.equal(mesh.material, mat, 'mesh restored');
  assert.equal(disposeCount, 1, 'disposed once');

  // Call dispose again
  assert.doesNotThrow(() => {
    app.dispose();
    app.dispose();
  }, 'repeated dispose must be safe');
  assert.equal(disposeCount, 1, 'disposed still exactly once after repeated calls');
  assert.equal(mesh.material, mat, 'mesh remains restored');
}

console.log('--- Test 5: textured material retains map and textures are never disposed ---');
{
  const root = new THREE.Group();
  const geom = new THREE.BoxGeometry(2, 2, 2);
  const texture = new THREE.Texture();
  let textureDisposeCalled = false;
  texture.dispose = () => {
    textureDisposeCalled = true;
  };

  const mat = new THREE.MeshStandardMaterial({
    name: 'paving-paving-fine-cobble',
    map: texture,
    transparent: true,
    opacity: 0.85
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(-150, 0, -50);
  root.add(mesh);
  root.updateMatrixWorld(true);

  const app = applyWorldArtStyle(root, { style: styleConfig });
  assert.notEqual(mesh.material, mat, 'material replaced');
  assert.equal(mesh.material.map, texture, 'texture map reference retained');
  assert.equal(mesh.material.transparent, true, 'transparent flag retained');
  assert.equal(mesh.material.opacity, 0.85, 'opacity retained');

  app.dispose();
  assert.equal(mesh.material, mat, 'material restored');
  assert.equal(textureDisposeCalled, false, 'texture was never disposed');
}

console.log('ALL TESTS PASSED');
