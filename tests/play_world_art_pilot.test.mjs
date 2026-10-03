import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from 'three';

import { applyWorldArtStyle } from '../scene-authoring/yuyuan-area/web/material-style.js';
import { installStreetLife } from '../scene-authoring/yuyuan-area/web/street-life.js';
import { createClosedFacades } from '../scene-authoring/yuyuan-area/web/play/closed-facades.js';
import {
  getSharedGlassDepthTexture,
  getSharedLacquerTexture,
  retainGlassDepthTexture,
  releaseGlassDepthTexture,
  disposeWorldArtPilotTextures
} from '../scene-authoring/yuyuan-area/web/world-art-pilot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylePath = path.resolve(__dirname, '../scene-authoring/yuyuan-area/inputs/world-art-style.json');
const streetLifePath = path.resolve(__dirname, '../scene-authoring/yuyuan-area/inputs/street-life.json');
const pilotConfigPath = path.resolve(__dirname, '../scene-authoring/yuyuan-area/inputs/world-art-pilot.json');

const styleConfig = JSON.parse(await fs.readFile(stylePath, 'utf8'));
const streetLifeConfig = JSON.parse(await fs.readFile(streetLifePath, 'utf8'));
const pilotConfig = JSON.parse(await fs.readFile(pilotConfigPath, 'utf8'));

test('U05 baseline & pilot scopes: world-art-style is full baseline with 10 global + 4 scoped pilot families', () => {
  assert.equal(styleConfig.mode, 'full', 'world-art-style mode must be full baseline');
  assert.deepEqual(styleConfig.scopes, [], 'global scopes must be empty array to preserve full baseline');

  const baseline10Ids = [
    'warm-paving', 'blue-stone', 'red-wood', 'dark-wood', 'lime-wall',
    'grey-roof', 'worn-stone', 'bridge-rail', 'stall-wood', 'pond-water'
  ];
  for (const id of baseline10Ids) {
    const fam = styleConfig.families.find(f => f.id === id);
    assert.ok(fam, `baseline family ${id} must exist in world-art-style`);
    assert.ok(!fam.scopes || fam.scopes.length === 0, `baseline family ${id} must not be restricted by family scopes`);
  }

  const new4Families = ['shop-glass', 'closed-door-lacquer', 'blue-gray-brick', 'timber'];
  for (const id of new4Families) {
    const fam = styleConfig.families.find(f => f.id === id);
    assert.ok(fam, `pilot family ${id} must exist in world-art-style`);
    assert.ok(Array.isArray(fam.scopes) && fam.scopes.length >= 2, `pilot family ${id} must define family-level scopes`);
  }
});

test('U05 pilot regression: baseline applies outside pilot, while pilot families are strictly scoped', () => {
  const root = new THREE.Group();

  // 1. Baseline mesh outside pilot scope (e.g., at [500, 0, 500])
  const baseGeom = new THREE.BoxGeometry(2, 0.2, 2);
  const baseMat = new THREE.MeshStandardMaterial({
    name: 'paving-paving-fine-cobble',
    color: new THREE.Color('#ffffff')
  });
  const baseMesh = new THREE.Mesh(baseGeom, baseMat);
  baseMesh.position.set(500, 0, 500);
  root.add(baseMesh);

  // 2. Pilot mesh outside pilot scope (e.g., at [500, 1.5, 500]) - should NOT change
  const outPilotGeom = new THREE.PlaneGeometry(1.5, 1.8);
  const outPilotMat = new THREE.MeshStandardMaterial({
    name: 'recessed-old-glass',
    color: new THREE.Color(0.04, 0.05, 0.06)
  });
  const outPilotMesh = new THREE.Mesh(outPilotGeom, outPilotMat);
  outPilotMesh.position.set(500, 1.5, 500);
  root.add(outPilotMesh);

  // 3. Pilot mesh inside center scope ([-158, 1.5, -22]) - should change
  const inPilotGeom = new THREE.PlaneGeometry(1.5, 1.8);
  const inPilotMat = new THREE.MeshStandardMaterial({
    name: 'recessed-old-glass',
    color: new THREE.Color(0.04, 0.05, 0.06)
  });
  const inPilotMesh = new THREE.Mesh(inPilotGeom, inPilotMat);
  inPilotMesh.position.set(-158, 1.5, -22);
  root.add(inPilotMesh);

  root.updateMatrixWorld(true);

  const sharedMaterials = new Map();
  const { dispose, stats } = applyWorldArtStyle(root, { style: styleConfig, sharedMaterials });

  // Baseline mesh outside pilot scope must be transformed by global baseline
  assert.notEqual(baseMesh.material, baseMat, 'baseline paving outside pilot scope is transformed by full baseline');
  assert.ok(stats.appliedFamilies.includes('warm-paving'), 'warm-paving family applied to outside mesh');

  // Pilot mesh outside pilot scope must remain UNTOUCHED
  assert.equal(outPilotMesh.material, outPilotMat, 'pilot material outside pilot scope is NOT modified');

  // Pilot mesh inside pilot scope is transformed
  assert.notEqual(inPilotMesh.material, inPilotMat, 'pilot material inside pilot scope is transformed');
  assert.ok(stats.appliedFamilies.includes('shop-glass'), 'shop-glass family applied inside pilot scope');

  dispose();
  assert.equal(baseMesh.material, baseMat, 'baseline paving restored to original instance');
  assert.equal(inPilotMesh.material, inPilotMat, 'pilot mesh restored to original instance');
});

test('U05 texture lifecycle: independent Maps A & B share textures, disposing A does not dispose B, finally all released', () => {
  // Ensure clean starting slate
  disposeWorldArtPilotTextures({ force: true });

  const rootA = new THREE.Group();
  const geomA = new THREE.PlaneGeometry(1, 1);
  const matA = new THREE.MeshStandardMaterial({ name: 'recessed-old-glass' });
  const meshA = new THREE.Mesh(geomA, matA);
  meshA.position.set(-158, 1, -22);
  rootA.add(meshA);
  rootA.updateMatrixWorld(true);

  const rootB = new THREE.Group();
  const geomB = new THREE.PlaneGeometry(1, 1);
  const matB = new THREE.MeshStandardMaterial({ name: 'recessed-old-glass' });
  const meshB = new THREE.Mesh(geomB, matB);
  meshB.position.set(-158, 1, -22);
  rootB.add(meshB);
  rootB.updateMatrixWorld(true);

  const sharedMaterialsA = new Map();
  const sharedMaterialsB = new Map();

  const handleA = applyWorldArtStyle(rootA, { style: styleConfig, sharedMaterials: sharedMaterialsA });
  const handleB = applyWorldArtStyle(rootB, { style: styleConfig, sharedMaterials: sharedMaterialsB });

  const texA = meshA.material.map;
  const texB = meshB.material.map;
  assert.ok(texA, 'meshA received procedural glass depth texture');
  assert.ok(texB, 'meshB received procedural glass depth texture');
  assert.equal(texA, texB, 'both independent maps A and B share the exact same procedural texture');

  let textureDisposedCount = 0;
  texA.addEventListener('dispose', () => {
    textureDisposedCount++;
  });

  // Dispose Owner A: mapA is cleared
  handleA.dispose();
  assert.equal(sharedMaterialsA.size, 0, 'sharedMaterialsA is empty after dispose');
  assert.equal(meshA.material, matA, 'meshA material restored');
  assert.equal(textureDisposedCount, 0, 'disposing Owner A must NOT dispose shared texture still used by Owner B');
  assert.equal(meshB.material.map, texB, 'meshB still has valid texture reference');

  // Dispose Owner B: mapB is cleared, texture is now released
  handleB.dispose();
  assert.equal(sharedMaterialsB.size, 0, 'sharedMaterialsB is empty after dispose');
  assert.equal(meshB.material, matB, 'meshB material restored');
  assert.equal(textureDisposedCount, 1, 'disposing Owner B finally releases and disposes the shared texture');

  // Next access creates a fresh new texture
  const texFresh = getSharedGlassDepthTexture();
  assert.notEqual(texFresh, texA, 'new texture created after previous texture was cleanly disposed');
  disposeWorldArtPilotTextures({ force: true });
});

test('U05 texture color space: Canvas and DataTextures specify SRGBColorSpace', () => {
  disposeWorldArtPilotTextures({ force: true });
  const glassTex = getSharedGlassDepthTexture();
  assert.equal(glassTex.colorSpace, THREE.SRGBColorSpace, 'glass depth texture colorSpace must be SRGBColorSpace');

  const lacquerTex = getSharedLacquerTexture();
  assert.equal(lacquerTex.colorSpace, THREE.SRGBColorSpace, 'lacquer texture colorSpace must be SRGBColorSpace');
  disposeWorldArtPilotTextures({ force: true });
});

test('U05 street-life: all 8 untrusted pilot items are disabled and ignored by street-life', () => {
  const pilotItems = streetLifeConfig.items.filter(it => it.chapterId === 'pilot-u05');
  assert.equal(pilotItems.length, 8, 'must contain exactly 8 pilot items in inputs/street-life.json');

  for (const item of pilotItems) {
    assert.equal(item.enabled, false, `item ${item.id} must be disabled (enabled: false)`);
    assert.ok(item.disabledReason, `item ${item.id} must have disabledReason documented`);
  }

  // Verify installStreetLife ignores disabled items
  const scene = new THREE.Scene();
  const owner = installStreetLife({ scene, manifest: { items: pilotItems } });
  assert.equal(owner.stats.items, 0, 'none of the disabled items may be installed into active world');
  assert.equal(owner.lanterns.length, 0, 'no lanterns registered from disabled items');
  owner.dispose();
});

test('U05 closed-facades: applies art style, tracks status, and handles clean lifecycle', async () => {
  const scene = new THREE.Scene();
  const fakeGeo = new THREE.BoxGeometry(1, 1, 1);
  const fakeTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const fakeMat = new THREE.MeshStandardMaterial({ name: 'recessed-old-glass', map: fakeTex });
  const fakeMesh = new THREE.Mesh(fakeGeo, fakeMat);
  fakeMesh.position.set(-158, 1, -22);

  const mockRoot = new THREE.Group();
  mockRoot.name = 'play-closed-facades';
  mockRoot.userData = { closedCount: 1 };
  mockRoot.add(fakeMesh);

  const manifest = {
    facades: {
      path: 'resources/play-facades/play-closed-facades.glb',
      sha256: null,
      closedCount: 1,
      root: 'play-closed-facades'
    }
  };

  const facadeSharedMaterials = new Map();
  const owner = createClosedFacades({
    scene,
    style: styleConfig,
    sharedMaterials: facadeSharedMaterials,
    fetchJson: async () => manifest,
    fetchBuffer: async () => new ArrayBuffer(8),
    digest: async () => null,
    parseGlb: async () => mockRoot,
  });

  await owner.install();
  const status = owner.status();
  assert.equal(status.closedFacadesReady, true);
  assert.equal(status.closedFacadeCount, 1);
  assert.equal(status.closedFacadesArtStyleMatched, 1, 'matched 1 glass mesh on mock closed facades root');
  assert.ok(status.closedFacadesArtStyleFamilies.includes('shop-glass'), 'applied shop-glass family');

  owner.dispose();
  assert.equal(owner.status().closedFacadesReady, false);
  assert.equal(scene.children.length, 0, 'root removed from scene on dispose');
});
