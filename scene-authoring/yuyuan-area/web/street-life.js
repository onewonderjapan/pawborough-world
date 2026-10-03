import * as THREE from 'three';

const ALLOWED_KINDS = new Set([
  'vendor-sign',
  'lantern',
  'bunting',
  'counter-flower',
  'curb-trim',
  'closed-notice',
  'wall-lantern'
]);

/**
 * Creates default 256x384 canvas texture for vertical closed shop notice plaques.
 */
function createNoticeCanvasTexture(label) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#3a241b';
      ctx.fillRect(0, 0, 256, 384);
      ctx.strokeStyle = '#c8a870';
      ctx.lineWidth = 6;
      ctx.strokeRect(12, 12, 232, 360);
      ctx.lineWidth = 2;
      ctx.strokeRect(18, 18, 220, 348);
      ctx.font = 'bold 36px "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff4dc';
      const text = label || '暂不开放';
      if (text.length <= 4) {
        for (let i = 0; i < text.length; i++) {
          ctx.fillText(text[i], 128, 80 + i * 70);
        }
      } else {
        ctx.fillText(text, 128, 192);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  const texture = new THREE.DataTexture(new Uint8Array([58, 36, 27, 255]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates default 384x128 canvas texture for Chinese vendor sign labels.
 */
function createDefaultCanvasTexture(label) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 384, 128);
      ctx.font = 'bold 36px "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2c1e14';
      ctx.fillText(label || '', 192, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  // Fallback for headless test environments without canvas
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Validates manifest structure and coordinates strictly.
 */
function validateManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Invalid manifest: expected an object with items array');
  }
  const rawItems = manifest.items;
  if (!Array.isArray(rawItems)) {
    throw new Error('Invalid manifest: items must be an array');
  }

  const seenIds = new Set();
  const validItems = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid manifest item at index ${i}`);
    }

    if (item.enabled === false) {
      continue;
    }

    if (item.id === undefined || item.id === null || item.id === '') {
      throw new Error(`Missing item id at index ${i}`);
    }
    const idStr = String(item.id);
    if (seenIds.has(idStr)) {
      throw new Error(`Duplicate item id: "${idStr}"`);
    }
    seenIds.add(idStr);

    if (!item.position || !Array.isArray(item.position) || item.position.length < 3) {
      throw new Error(`Invalid position for item "${idStr}": expected [x, y, z]`);
    }
    const [x, y, z] = item.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Non-finite position coordinate for item "${idStr}": [${x}, ${y}, ${z}]`);
    }

    const yaw = item.yaw ?? 0;
    if (!Number.isFinite(yaw)) {
      throw new Error(`Non-finite yaw for item "${idStr}": ${yaw}`);
    }

    if (!ALLOWED_KINDS.has(item.kind)) {
      if (options.strictUnknown) {
        throw new Error(`Unknown decoration kind: "${item.kind}" for item "${idStr}"`);
      }
      // Skip unknown kind
      continue;
    }

    validItems.push({
      id: idStr,
      sourceId: item.sourceId != null ? String(item.sourceId) : null,
      kind: item.kind,
      position: [x, y, z],
      yaw,
      label: item.label != null ? String(item.label) : '',
      chapterId: item.chapterId != null ? String(item.chapterId) : ''
    });
  }

  return validItems;
}

/**
 * Installs the finite M09 decorative street-life layer.
 *
 * @param {Object} params
 * @param {THREE.Scene|THREE.Object3D} params.scene
 * @param {Object} params.manifest
 * @param {Object|null} [params.resourcePool=null]
 * @param {Function|null} [params.makeLabelTexture=null]
 * @returns {{ update: Function, dispose: Function, stats: Object, lanterns: Array, group: THREE.Group }}
 */
export function installStreetLife({
  scene,
  manifest,
  resourcePool = null,
  makeLabelTexture = null,
  options = {}
} = {}) {
  if (!scene || typeof scene.add !== 'function') {
    throw new Error('installStreetLife requires a valid Three.js scene/object with add method');
  }

  const validItems = validateManifest(manifest, options);

  const ownerGroup = new THREE.Group();
  ownerGroup.name = 'streetLifeLayer';
  ownerGroup.raycast = () => {};

  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const ownedTextures = new Set();
  const lights = [];
  const lanternEntries = [];
  const labelCache = new Map();

  function trackGeometry(geo) {
    if (geo) ownedGeometries.add(geo);
    return geo;
  }

  function trackMaterial(mat) {
    if (mat) ownedMaterials.add(mat);
    return mat;
  }

  function makeNoopRaycast(obj) {
    if (!obj) return obj;
    obj.raycast = () => {};
    if (typeof obj.traverse === 'function') {
      obj.traverse(child => {
        child.raycast = () => {};
      });
    }
    return obj;
  }

  // Partition items by kind
  const signs = [];
  const lanterns = [];
  const buntings = [];
  const flowers = [];
  const curbs = [];
  const notices = [];
  const wallLanterns = [];

  for (const item of validItems) {
    switch (item.kind) {
      case 'vendor-sign':
        signs.push(item);
        break;
      case 'lantern':
        lanterns.push(item);
        break;
      case 'bunting':
        buntings.push(item);
        break;
      case 'counter-flower':
        flowers.push(item);
        break;
      case 'curb-trim':
        curbs.push(item);
        break;
      case 'closed-notice':
        notices.push(item);
        break;
      case 'wall-lantern':
        wallLanterns.push(item);
        break;
    }
  }

  const dummy = new THREE.Object3D();
  const localMat = new THREE.Matrix4();
  const finalMat = new THREE.Matrix4();

  // 1. LANTERNS
  if (lanterns.length > 0) {
    // Shared primitive geometries (3 primitives: housing, cap, tassel)
    const housingGeo = trackGeometry(new THREE.CylinderGeometry(0.09, 0.09, 0.23, 16, 1));
    const capGeo = trackGeometry(new THREE.CylinderGeometry(0.04, 0.05, 0.03, 12));
    const tasselGeo = trackGeometry(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8));

    // Shared materials
    const housingMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xdf5343,
      emissive: 0xffe2a0,
      emissiveIntensity: 0.75,
      roughness: 0.6
    }));
    const capMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x2b241e,
      roughness: 0.5
    }));
    const tasselMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xd93829,
      roughness: 0.7
    }));

    const housingInst = makeNoopRaycast(new THREE.InstancedMesh(housingGeo, housingMat, lanterns.length));
    const capInst = makeNoopRaycast(new THREE.InstancedMesh(capGeo, capMat, lanterns.length));
    const tasselInst = makeNoopRaycast(new THREE.InstancedMesh(tasselGeo, tasselMat, lanterns.length));

    housingInst.castShadow = false;
    capInst.castShadow = false;
    tasselInst.castShadow = false;

    for (let i = 0; i < lanterns.length; i++) {
      const item = lanterns[i];
      const [x, y, z] = item.position;
      const yaw = item.yaw;

      lanternEntries.push({
        id: item.id,
        sourceId: item.sourceId,
        position: new THREE.Vector3(x, y, z),
        yaw
      });

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      // Housing at center
      housingInst.setMatrixAt(i, dummy.matrix);

      // Top cap at (0, 0.13, 0)
      localMat.makeTranslation(0, 0.13, 0);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      capInst.setMatrixAt(i, finalMat);

      // Tassel at (0, -0.155, 0)
      localMat.makeTranslation(0, -0.155, 0);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      tasselInst.setMatrixAt(i, finalMat);
    }

    housingInst.instanceMatrix.needsUpdate = true;
    capInst.instanceMatrix.needsUpdate = true;
    tasselInst.instanceMatrix.needsUpdate = true;

    ownerGroup.add(housingInst);
    ownerGroup.add(capInst);
    ownerGroup.add(tasselInst);

    // Pooled point lights: at most 2, warm cream non-shadow lights
    const maxLights = Math.min(2, lanterns.length);
    for (let i = 0; i < maxLights; i++) {
      const pl = new THREE.PointLight(0xffbe76, 0, 8, 1.8);
      pl.castShadow = false;
      pl.raycast = () => {};
      lights.push(pl);
      ownerGroup.add(pl);
    }
  }

  // 2. BUNTING
  if (buntings.length > 0) {
    // 2.0m short rope gentle curve
    const ropeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.0, 0, 0),
      new THREE.Vector3(-0.5, -0.06, 0),
      new THREE.Vector3(0, -0.08, 0),
      new THREE.Vector3(0.5, -0.06, 0),
      new THREE.Vector3(1.0, 0, 0)
    ]);
    const ropeGeo = trackGeometry(new THREE.TubeGeometry(ropeCurve, 16, 0.008, 6, false));
    const ropeMat = trackMaterial(new THREE.MeshStandardMaterial({ color: 0xc8b598, roughness: 0.9 }));

    // Small triangular cloth pennant (base 0.15m, height 0.18m)
    const pennantGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -0.075, 0, 0,
       0.075, 0, 0,
       0,    -0.18, 0
    ]);
    const normals = new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1
    ]);
    const uvs = new Float32Array([
      0, 1,
      1, 1,
      0.5, 0
    ]);
    pennantGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    pennantGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    pennantGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    trackGeometry(pennantGeo);

    // Pennants use InstancedMesh with per-instance colors (jade, cream, coral)
    const pennantMat = trackMaterial(new THREE.MeshStandardMaterial({
      roughness: 0.7,
      side: THREE.DoubleSide
    }));

    const ropeInst = makeNoopRaycast(new THREE.InstancedMesh(ropeGeo, ropeMat, buntings.length));
    const totalPennants = buntings.length * 5;
    const pennantInst = makeNoopRaycast(new THREE.InstancedMesh(pennantGeo, pennantMat, totalPennants));

    ropeInst.castShadow = false;
    pennantInst.castShadow = false;

    // 5 alternating pennant offsets and colors
    // Colors: Jade, Cream, Coral, Jade, Cream
    const pennantOffsets = [
      { x: -0.6, y: -0.05 },
      { x: -0.3, y: -0.07 },
      { x:  0.0, y: -0.08 },
      { x:  0.3, y: -0.07 },
      { x:  0.6, y: -0.05 }
    ];
    const pennantColors = [
      new THREE.Color(0x3d7e80), // jade
      new THREE.Color(0xfbf6ea), // cream
      new THREE.Color(0xe06d53), // coral
      new THREE.Color(0x3d7e80), // jade
      new THREE.Color(0xfbf6ea)  // cream
    ];

    let pIndex = 0;
    for (let i = 0; i < buntings.length; i++) {
      const item = buntings[i];
      const [x, y, z] = item.position;
      const yaw = item.yaw;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      ropeInst.setMatrixAt(i, dummy.matrix);

      for (let f = 0; f < 5; f++) {
        const off = pennantOffsets[f];
        localMat.makeTranslation(off.x, off.y, 0);
        finalMat.multiplyMatrices(dummy.matrix, localMat);
        pennantInst.setMatrixAt(pIndex, finalMat);
        pennantInst.setColorAt(pIndex, pennantColors[f]);
        pIndex++;
      }
    }

    ropeInst.instanceMatrix.needsUpdate = true;
    pennantInst.instanceMatrix.needsUpdate = true;
    if (pennantInst.instanceColor) {
      pennantInst.instanceColor.needsUpdate = true;
    }

    ownerGroup.add(ropeInst);
    ownerGroup.add(pennantInst);
  }

  // 3. COUNTER-FLOWER
  if (flowers.length > 0) {
    // Tiny jade pot (0.1m radius, 0.12m height)
    const potGeo = trackGeometry(new THREE.CylinderGeometry(0.1, 0.075, 0.12, 16));
    const potMat = trackMaterial(new THREE.MeshStandardMaterial({ color: 0x2e6659, roughness: 0.4 }));

    // Broad green leaves
    const leafGeo = trackGeometry(new THREE.PlaneGeometry(0.08, 0.12));
    const leafMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x366838,
      roughness: 0.6,
      side: THREE.DoubleSide
    }));

    // Flowers (3 warm yellow / pale pink blossoms)
    const blossomGeo = trackGeometry(new THREE.SphereGeometry(0.035, 8, 8));
    const blossomMat = trackMaterial(new THREE.MeshStandardMaterial({
      roughness: 0.6
    }));

    const potInst = makeNoopRaycast(new THREE.InstancedMesh(potGeo, potMat, flowers.length));
    const leafInst = makeNoopRaycast(new THREE.InstancedMesh(leafGeo, leafMat, flowers.length * 3));
    const blossomInst = makeNoopRaycast(new THREE.InstancedMesh(blossomGeo, blossomMat, flowers.length * 3));

    potInst.castShadow = false;
    leafInst.castShadow = false;
    blossomInst.castShadow = false;

    const flowerColors = [
      new THREE.Color(0xf5cc47), // warm yellow
      new THREE.Color(0xf4b6c2), // pale pink
      new THREE.Color(0xf5cc47)  // warm yellow
    ];
    const flowerOffsets = [
      { x: -0.04, y: 0.13, z: -0.03 },
      { x:  0.04, y: 0.14, z: -0.02 },
      { x:  0.00, y: 0.13, z:  0.04 }
    ];
    const leafAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];

    let leafIdx = 0;
    let bloomIdx = 0;

    for (let i = 0; i < flowers.length; i++) {
      const item = flowers[i];
      const [x, y, z] = item.position;
      const yaw = item.yaw;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      // Pot sits on counter at y = +0.06
      localMat.makeTranslation(0, 0.06, 0);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      potInst.setMatrixAt(i, finalMat);

      // 3 broad leaves
      for (let l = 0; l < 3; l++) {
        const la = leafAngles[l];
        const rotMat = new THREE.Matrix4().makeRotationY(la);
        const pitchMat = new THREE.Matrix4().makeRotationX(Math.PI / 3);
        const transMat = new THREE.Matrix4().makeTranslation(0, 0.10, 0.06);
        const leafCombined = rotMat.multiply(transMat).multiply(pitchMat);

        finalMat.multiplyMatrices(dummy.matrix, leafCombined);
        leafInst.setMatrixAt(leafIdx++, finalMat);
      }

      // 3 blossoms
      for (let b = 0; b < 3; b++) {
        const fo = flowerOffsets[b];
        localMat.makeTranslation(fo.x, fo.y, fo.z);
        finalMat.multiplyMatrices(dummy.matrix, localMat);
        blossomInst.setMatrixAt(bloomIdx, finalMat);
        blossomInst.setColorAt(bloomIdx, flowerColors[b]);
        bloomIdx++;
      }
    }

    potInst.instanceMatrix.needsUpdate = true;
    leafInst.instanceMatrix.needsUpdate = true;
    blossomInst.instanceMatrix.needsUpdate = true;
    if (blossomInst.instanceColor) {
      blossomInst.instanceColor.needsUpdate = true;
    }

    ownerGroup.add(potInst);
    ownerGroup.add(leafInst);
    ownerGroup.add(blossomInst);
  }

  // 4. VENDOR-SIGN
  if (signs.length > 0) {
    // Refined small cream rounded panel: 0.7 x 0.25m
    const panelGeo = trackGeometry(new THREE.BoxGeometry(0.7, 0.25, 0.02));
    const borderGeo = trackGeometry(new THREE.BoxGeometry(0.72, 0.27, 0.015));
    const bracketGeo = trackGeometry(new THREE.BoxGeometry(0.08, 0.06, 0.06));
    const labelQuadGeo = trackGeometry(new THREE.PlaneGeometry(0.66, 0.22));

    const panelMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xfcf8ee,
      roughness: 0.5
    }));
    const borderMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x2a5b63, // jade blue border
      roughness: 0.5
    }));
    const bracketMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xb87333, // copper little bracket
      metalness: 0.6,
      roughness: 0.3
    }));

    const panelInst = makeNoopRaycast(new THREE.InstancedMesh(panelGeo, panelMat, signs.length));
    const borderInst = makeNoopRaycast(new THREE.InstancedMesh(borderGeo, borderMat, signs.length));
    const bracketInst = makeNoopRaycast(new THREE.InstancedMesh(bracketGeo, bracketMat, signs.length));

    panelInst.castShadow = false;
    borderInst.castShadow = false;
    bracketInst.castShadow = false;

    for (let i = 0; i < signs.length; i++) {
      const item = signs[i];
      const [x, y, z] = item.position;
      const yaw = item.yaw;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      panelInst.setMatrixAt(i, dummy.matrix);
      borderInst.setMatrixAt(i, dummy.matrix);

      // Bracket at top
      localMat.makeTranslation(0, 0.145, 0);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      bracketInst.setMatrixAt(i, finalMat);

      // Label Texture Cache: cached per label/chapter within owner
      const labelKey = `${item.chapterId}:::${item.label}`;
      let cachedLabel = labelCache.get(labelKey);
      if (!cachedLabel) {
        let tex = null;
        let owned = true;

        if (typeof makeLabelTexture === 'function') {
          const res = makeLabelTexture({ label: item.label, chapterId: item.chapterId });
          if (res && typeof res === 'object' && 'texture' in res) {
            tex = res.texture;
            owned = res.owned !== false;
          } else {
            tex = res;
            owned = true;
          }
        } else if (resourcePool && typeof resourcePool.getTexture === 'function' && resourcePool.getTexture(item.label)) {
          tex = resourcePool.getTexture(item.label);
          owned = false;
        } else {
          tex = createDefaultCanvasTexture(item.label);
          owned = true;
        }

        if (owned && tex && typeof tex.dispose === 'function') {
          ownedTextures.add(tex);
        }

        const labelMat = trackMaterial(new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide
        }));

        cachedLabel = { texture: tex, material: labelMat, owned };
        labelCache.set(labelKey, cachedLabel);
      }

      // Create sign label quad Mesh at front face with depthTest=true
      const labelMesh = makeNoopRaycast(new THREE.Mesh(labelQuadGeo, cachedLabel.material));
      labelMesh.castShadow = false;

      // Position in front of the panel: local (0, 0, 0.012)
      localMat.makeTranslation(0, 0, 0.012);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      finalMat.decompose(labelMesh.position, labelMesh.quaternion, labelMesh.scale);

      ownerGroup.add(labelMesh);
    }

    panelInst.instanceMatrix.needsUpdate = true;
    borderInst.instanceMatrix.needsUpdate = true;
    bracketInst.instanceMatrix.needsUpdate = true;

    ownerGroup.add(borderInst);
    ownerGroup.add(panelInst);
    ownerGroup.add(bracketInst);
  }

  // 5. CURB-TRIM (路边踢脚石)
  if (curbs.length > 0) {
    const curbGeo = trackGeometry(new THREE.BoxGeometry(1.2, 0.14, 0.12));
    const curbMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xb5ad9f, // warm granolithic stone (暖灰水刷石)
      roughness: 0.92
    }));
    const curbInst = makeNoopRaycast(new THREE.InstancedMesh(curbGeo, curbMat, curbs.length));
    curbInst.castShadow = false;

    for (let i = 0; i < curbs.length; i++) {
      const item = curbs[i];
      dummy.position.set(...item.position);
      dummy.rotation.set(0, item.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      curbInst.setMatrixAt(i, dummy.matrix);
    }

    curbInst.instanceMatrix.needsUpdate = true;
    ownerGroup.add(curbInst);
  }

  // 6. CLOSED-NOTICE (闭店外观明确暂不开放)
  if (notices.length > 0) {
    const boardGeo = trackGeometry(new THREE.BoxGeometry(0.35, 0.50, 0.02));
    const boardMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0x3d271e, // dark lacquer wood (旧木漆)
      roughness: 0.72
    }));
    const noticeQuadGeo = trackGeometry(new THREE.PlaneGeometry(0.32, 0.46));
    const boardInst = makeNoopRaycast(new THREE.InstancedMesh(boardGeo, boardMat, notices.length));
    boardInst.castShadow = false;

    for (let i = 0; i < notices.length; i++) {
      const item = notices[i];
      dummy.position.set(...item.position);
      dummy.rotation.set(0, item.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      boardInst.setMatrixAt(i, dummy.matrix);

      const noticeText = item.label || '暂不开放';
      const labelKey = `notice:::${noticeText}`;
      let cachedNotice = labelCache.get(labelKey);
      if (!cachedNotice) {
        const tex = createNoticeCanvasTexture(noticeText);
        if (tex && typeof tex.dispose === 'function') {
          ownedTextures.add(tex);
        }
        const labelMat = trackMaterial(new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide
        }));
        cachedNotice = { texture: tex, material: labelMat, owned: true };
        labelCache.set(labelKey, cachedNotice);
      }

      const labelMesh = makeNoopRaycast(new THREE.Mesh(noticeQuadGeo, cachedNotice.material));
      labelMesh.castShadow = false;
      localMat.makeTranslation(0, 0, 0.012);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      finalMat.decompose(labelMesh.position, labelMesh.quaternion, labelMesh.scale);
      ownerGroup.add(labelMesh);
    }

    boardInst.instanceMatrix.needsUpdate = true;
    ownerGroup.add(boardInst);
  }

  // 7. WALL-LANTERN (贴边挂壁暖灯 - 灯光进入统一池)
  if (wallLanterns.length > 0) {
    const bracketGeo = trackGeometry(new THREE.BoxGeometry(0.06, 0.06, 0.12));
    const shadeGeo = trackGeometry(new THREE.CylinderGeometry(0.06, 0.07, 0.18, 12));
    const bracketMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xb87333,
      metalness: 0.6,
      roughness: 0.35
    }));
    const shadeMat = trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xffe6b8,
      emissive: 0xffaa44,
      emissiveIntensity: 0.8,
      roughness: 0.5
    }));
    const bracketInst = makeNoopRaycast(new THREE.InstancedMesh(bracketGeo, bracketMat, wallLanterns.length));
    const shadeInst = makeNoopRaycast(new THREE.InstancedMesh(shadeGeo, shadeMat, wallLanterns.length));
    bracketInst.castShadow = false;
    shadeInst.castShadow = false;

    for (let i = 0; i < wallLanterns.length; i++) {
      const item = wallLanterns[i];
      const [x, y, z] = item.position;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, item.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      bracketInst.setMatrixAt(i, dummy.matrix);
      localMat.makeTranslation(0, -0.06, 0.06);
      finalMat.multiplyMatrices(dummy.matrix, localMat);
      shadeInst.setMatrixAt(i, finalMat);

      lanternEntries.push({
        id: item.id,
        sourceId: item.sourceId,
        position: new THREE.Vector3(x, y, z),
        yaw: item.yaw
      });
    }

    bracketInst.instanceMatrix.needsUpdate = true;
    shadeInst.instanceMatrix.needsUpdate = true;
    ownerGroup.add(bracketInst);
    ownerGroup.add(shadeInst);

    // If lights pool was not yet initialized because lanterns was 0, initialize up to 2 pooled lights
    if (lights.length === 0 && lanternEntries.length > 0) {
      const maxLights = Math.min(2, lanternEntries.length);
      for (let i = 0; i < maxLights; i++) {
        const pl = new THREE.PointLight(0xffbe76, 0, 8, 1.8);
        pl.castShadow = false;
        pl.raycast = () => {};
        lights.push(pl);
        ownerGroup.add(pl);
      }
    }
  }

  // Ensure all children are raycast noop
  makeNoopRaycast(ownerGroup);

  // Add owner group to scene
  scene.add(ownerGroup);

  let accumulatedGameTime = 0;
  let lastLightUpdateTime = -Infinity;
  let lastTimeOfDay = null;
  let isDisposed = false;

  function update({ feet, dt = 0, paused = false, timeOfDay = 'day' } = {}) {
    if (isDisposed || paused) {
      return;
    }

    accumulatedGameTime += dt;

    const isNightOrDusk = (timeOfDay === 'night' || timeOfDay === 'dusk');
    const timeSinceLastUpdate = accumulatedGameTime - lastLightUpdateTime;
    const timeOfDayChanged = (timeOfDay !== lastTimeOfDay);

    // If timeOfDay changed to day, turn off lights immediately
    if (timeOfDayChanged && !isNightOrDusk) {
      lastTimeOfDay = timeOfDay;
      for (const light of lights) {
        light.intensity = 0;
      }
    }

    // Nearest lantern lights selection occurs on first call, every 0.5 game seconds, or on time-of-day switch to night/dusk
    if (lastLightUpdateTime < 0 || timeSinceLastUpdate >= 0.5 || (timeOfDayChanged && isNightOrDusk)) {
      lastLightUpdateTime = accumulatedGameTime;
      lastTimeOfDay = timeOfDay;

      if (!isNightOrDusk || lanternEntries.length === 0) {
        for (const light of lights) {
          light.intensity = 0;
        }
      } else {
        const fx = Array.isArray(feet) ? feet[0] : (feet?.x ?? 0);
        const fy = Array.isArray(feet) ? feet[1] : (feet?.y ?? 0);
        const fz = Array.isArray(feet) ? feet[2] : (feet?.z ?? 0);

        // Sort lanterns by distance squared to feet
        const sorted = [...lanternEntries].sort((a, b) => {
          const da = (a.position.x - fx) ** 2 + (a.position.y - fy) ** 2 + (a.position.z - fz) ** 2;
          const db = (b.position.x - fx) ** 2 + (b.position.y - fy) ** 2 + (b.position.z - fz) ** 2;
          return da - db;
        });

        for (let i = 0; i < lights.length; i++) {
          if (i < sorted.length) {
            lights[i].position.copy(sorted[i].position);
            lights[i].intensity = 1.8;
          } else {
            lights[i].intensity = 0;
          }
        }
      }
    }
  }

  function dispose() {
    if (isDisposed) {
      return;
    }
    isDisposed = true;

    if (ownerGroup.parent) {
      ownerGroup.parent.remove(ownerGroup);
    }

    for (const geo of ownedGeometries) {
      if (typeof geo.dispose === 'function') {
        geo.dispose();
      }
    }
    ownedGeometries.clear();

    for (const mat of ownedMaterials) {
      if (typeof mat.dispose === 'function') {
        mat.dispose();
      }
    }
    ownedMaterials.clear();

    for (const tex of ownedTextures) {
      if (typeof tex.dispose === 'function') {
        tex.dispose();
      }
    }
    ownedTextures.clear();

    for (const light of lights) {
      if (typeof light.dispose === 'function') {
        light.dispose();
      }
    }
    lights.length = 0;
  }

  const stats = {
    items: validItems.length,
    geometryCount: ownedGeometries.size,
    materialCount: ownedMaterials.size,
    textureCount: ownedTextures.size,
    lightCount: lights.length,
    sourceIds: validItems.map(it => it.sourceId)
  };

  return {
    update,
    dispose,
    stats,
    lanterns: lanternEntries,
    group: ownerGroup
  };
}
