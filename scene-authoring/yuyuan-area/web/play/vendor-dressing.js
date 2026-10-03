// 摊位小吃与食品陈列类型化修饰 (M06 / U06: Typed stall dressing props)
// 适配指定小吃推车：肠粉（蒸箱+盖边蒸气）、钵钵鸡（红油盆+竹签罐）、瓦罐汤（深陶煨罐+木盖）
import * as THREE from 'three';

export const VENDOR_DRESSING_TEMPLATES = {
  changfen: {
    foodId: 'changfen',
    type: 'steamer',
    nameZh: '肠粉小蒸箱',
    descriptionZh: '不锈钢抽屉式双层蒸箱与木质底座，缝隙散发温热蒸气',
  },
  boboji: {
    foodId: 'boboji',
    type: 'chili_oil_basin',
    nameZh: '钵钵鸡红油盆与竹签罐',
    descriptionZh: '瓷盆满盛红油芝麻，配老陶罐插放细竹签串',
  },
  'waguan-tang': {
    foodId: 'waguan-tang',
    type: 'simmering_pot',
    nameZh: '瓦罐汤深陶煨罐与木盖',
    descriptionZh: '深褐色粗陶煨罐，上扣厚圆木盖与取手',
  },
};

export function hasVendorDressing(foodId) {
  return Boolean(foodId && Object.hasOwn(VENDOR_DRESSING_TEMPLATES, foodId));
}

export function getVendorDressingTemplate(foodId) {
  return VENDOR_DRESSING_TEMPLATES[foodId] ?? null;
}

/**
 * 产生柔和半透明蒸气纹理（无文本乱码，无外部网络依赖）
 */
function createSteamTexture() {
  if (typeof document === 'undefined') {
    // Node.js mock texture
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 120]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.45, 'rgba(240, 245, 250, 0.45)');
    grad.addColorStop(0.8, 'rgba(230, 240, 245, 0.15)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * 创建特定食物品类专用的台面道具组 (shared typed dressing)
 * 道具必须完全收容于推车台面碰撞体积内，不伸入通行区，不阻挡顾客交互点
 *
 * @param {string} foodId
 * @param {Object} [options]
 * @param {Function} [options.trackGeom]
 * @param {Function} [options.trackMat]
 * @returns {Object|null} { foodId, group, steams, geometries, materials, textures, update, dispose }
 */
export function createVendorDressing(foodId, { trackGeom, trackMat } = {}) {
  const template = getVendorDressingTemplate(foodId);
  if (!template) return null;

  const geometries = [];
  const materials = [];
  const textures = [];
  const steams = [];

  function geom(g) {
    geometries.push(g);
    if (typeof trackGeom === 'function') trackGeom(g);
    return g;
  }
  function mat(m) {
    materials.push(m);
    if (typeof trackMat === 'function') trackMat(m);
    return m;
  }
  function tex(t) {
    textures.push(t);
    return t;
  }

  const group = new THREE.Group();
  group.name = `dressing-${foodId}`;

  // 台面基本基准高度：推车柜台中心在 y=0.4，高度 0.65 -> 表面在 0.725
  const tableY = 0.725;

  if (foodId === 'changfen') {
    // 1. 肠粉车：小蒸箱（木/不锈钢）+ 盖边蒸气
    const woodMat = mat(new THREE.MeshStandardMaterial({
      color: 0xb5824b,
      roughness: 0.65,
    }));
    const steelMat = mat(new THREE.MeshStandardMaterial({
      color: 0xd8dde2,
      metalness: 0.85,
      roughness: 0.28,
    }));
    const brassMat = mat(new THREE.MeshStandardMaterial({
      color: 0xbfa366,
      metalness: 0.7,
      roughness: 0.35,
    }));

    // 底座木框架 (32cm x 3cm x 24cm)
    const baseMesh = new THREE.Mesh(geom(new THREE.BoxGeometry(0.32, 0.03, 0.24)), woodMat);
    baseMesh.position.set(-0.20, tableY + 0.015, -0.02);
    group.add(baseMesh);

    // 不锈钢主蒸箱体 (30cm x 14cm x 22cm)
    const bodyMesh = new THREE.Mesh(geom(new THREE.BoxGeometry(0.30, 0.14, 0.22)), steelMat);
    bodyMesh.position.set(-0.20, tableY + 0.03 + 0.07, -0.02);
    group.add(bodyMesh);

    // 双层肠粉抽屉前板与黄铜拉手
    const drawerLevels = [tableY + 0.065, tableY + 0.125];
    for (const dy of drawerLevels) {
      const panel = new THREE.Mesh(geom(new THREE.BoxGeometry(0.28, 0.045, 0.008)), steelMat);
      panel.position.set(-0.20, dy, 0.094);
      group.add(panel);

      const handle = new THREE.Mesh(geom(new THREE.BoxGeometry(0.06, 0.012, 0.018)), brassMat);
      handle.position.set(-0.20, dy, 0.104);
      group.add(handle);
    }

    // 蒸箱顶盖与把手
    const lidMesh = new THREE.Mesh(geom(new THREE.BoxGeometry(0.31, 0.016, 0.23)), steelMat);
    lidMesh.position.set(-0.20, tableY + 0.178, -0.02);
    group.add(lidMesh);

    const lidHandle = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.007, 0.007, 0.10, 8)), brassMat);
    lidHandle.rotation.z = Math.PI / 2;
    lidHandle.position.set(-0.20, tableY + 0.198, -0.02);
    group.add(lidHandle);

    // 盖边细蒸气（精简 Sprite，无点光源，支持 paused 停止动画）
    const steamTexture = tex(createSteamTexture());
    const steamMat = mat(new THREE.SpriteMaterial({
      map: steamTexture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }));
    const steamSprite = new THREE.Sprite(steamMat);
    const steamBaseY = tableY + 0.21;
    steamSprite.position.set(-0.20, steamBaseY, 0.06);
    steamSprite.scale.set(0.18, 0.20, 1);
    group.add(steamSprite);

    steams.push({
      sprite: steamSprite,
      baseY: steamBaseY,
      time: 0,
      update(dt, paused) {
        if (paused) return;
        this.time += dt;
        this.sprite.position.y = this.baseY + Math.sin(this.time * 2.2) * 0.012;
        this.sprite.material.opacity = 0.38 + Math.sin(this.time * 1.8) * 0.10;
        this.sprite.scale.x = 0.18 + Math.sin(this.time * 2.0) * 0.015;
      },
    });

  } else if (foodId === 'boboji') {
    // 2. 钵钵鸡车：红油盆 + 竹签罐
    const porcelainMat = mat(new THREE.MeshStandardMaterial({
      color: 0xf5f3ea,
      roughness: 0.25,
      side: THREE.DoubleSide,
    }));
    const blueGlazeMat = mat(new THREE.MeshStandardMaterial({
      color: 0x245582,
      roughness: 0.3,
      side: THREE.DoubleSide,
    }));
    const chiliOilMat = mat(new THREE.MeshStandardMaterial({
      color: 0xa1170d,
      roughness: 0.12,
      metalness: 0.08,
      side: THREE.DoubleSide,
    }));
    const sesameMat = mat(new THREE.MeshStandardMaterial({
      color: 0xd9b87a,
      roughness: 0.6,
    }));
    const potteryMat = mat(new THREE.MeshStandardMaterial({
      color: 0x5a3928,
      roughness: 0.75,
    }));
    const skewerMat = mat(new THREE.MeshStandardMaterial({
      color: 0xd6b77c,
      roughness: 0.55,
    }));

    // 大号瓷钵外盆 (直径 26cm, 高 9cm, openEnded: true 无全圆封口盖，侧壁 DoubleSide)
    const basinMesh = new THREE.Mesh(
      geom(new THREE.CylinderGeometry(0.13, 0.095, 0.09, 20, 1, true)),
      porcelainMat
    );
    basinMesh.name = 'white-basin';
    basinMesh.position.set(-0.18, tableY + 0.045, -0.03);
    group.add(basinMesh);

    // 盆底少量封底片 (位于盆底 tableY 处，不盖顶面)
    const bottomCapMesh = new THREE.Mesh(
      geom(new THREE.CircleGeometry(0.095, 20)),
      porcelainMat
    );
    bottomCapMesh.name = 'basin-bottom';
    bottomCapMesh.rotation.x = -Math.PI / 2;
    bottomCapMesh.position.set(-0.18, tableY + 0.002, -0.03);
    group.add(bottomCapMesh);

    // 盆沿青花色环圈 (RingGeometry inner .126, outer .133，旋转 -X π/2 在 y~.817，不用封口 Cylinder 全圆盖)
    const rimMesh = new THREE.Mesh(
      geom(new THREE.RingGeometry(0.126, 0.133, 24)),
      blueGlazeMat
    );
    rimMesh.name = 'blue-rim';
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.set(-0.18, 0.817, -0.03);
    group.add(rimMesh);

    // 亮红油表面 (直径 .252 -> 半径 .126, top .810~.812 在 y=0.811，保持能从上方直接看见)
    const oilMesh = new THREE.Mesh(
      geom(new THREE.CircleGeometry(0.126, 24)),
      chiliOilMat
    );
    oilMesh.name = 'redoil';
    oilMesh.rotation.x = -Math.PI / 2;
    oilMesh.position.set(-0.18, 0.811, -0.03);
    group.add(oilMesh);

    // 红油表面熟芝麻粒 (少量确定性的细小颗粒 InstancedMesh，不用覆盖油面的整片黄盘，避开中心射线区)
    const seedCount = 28;
    const sesameGeom = geom(new THREE.BoxGeometry(0.003, 0.0015, 0.006));
    const sesameMesh = new THREE.InstancedMesh(sesameGeom, sesameMat, seedCount);
    sesameMesh.name = 'sesame';
    const seedDummy = new THREE.Object3D();
    const seedRadii = [
      0.032, 0.045, 0.058, 0.072, 0.085, 0.098, 0.108,
      0.038, 0.052, 0.065, 0.078, 0.092, 0.104, 0.112,
      0.042, 0.055, 0.068, 0.082, 0.095, 0.106, 0.028,
      0.048, 0.062, 0.075, 0.088, 0.101, 0.110, 0.035,
    ];
    for (let i = 0; i < seedCount; i++) {
      const r = seedRadii[i % seedRadii.length];
      const angle = (i * 2.39996) + 0.3;
      const sx = -0.18 + Math.cos(angle) * r;
      const sz = -0.03 + Math.sin(angle) * r;
      seedDummy.position.set(sx, 0.8115, sz);
      seedDummy.rotation.set(0, angle + (i * 0.4), 0);
      seedDummy.updateMatrix();
      sesameMesh.setMatrixAt(i, seedDummy.matrix);
    }
    sesameMesh.instanceMatrix.needsUpdate = true;
    group.add(sesameMesh);

    // 粗陶竹签筒 (直径 9cm, 高 13cm)
    const jarMesh = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.045, 0.04, 0.13, 16)), potteryMat);
    jarMesh.position.set(-0.35, tableY + 0.065, 0.08);
    group.add(jarMesh);

    // 筒内插放的一束细竹签 (6 根，确定性散开角度)
    const xAngles = [-0.14, 0.08, -0.06, 0.12, 0.02, -0.10];
    const zAngles = [0.05, -0.06, 0.10, -0.04, 0.08, -0.08];
    for (let i = 0; i < 6; i++) {
      const stick = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.0028, 0.0028, 0.22, 6)), skewerMat);
      stick.position.set(-0.35 + xAngles[i] * 0.14, tableY + 0.135, 0.08 + zAngles[i] * 0.14);
      stick.rotation.set(zAngles[i], 0, -xAngles[i]);
      group.add(stick);
    }

  } else if (foodId === 'waguan-tang') {
    // 3. 瓦罐汤车：深陶煨罐 + 木盖
    const clayMat = mat(new THREE.MeshStandardMaterial({
      color: 0x3e281f,
      roughness: 0.85,
      metalness: 0.04,
    }));
    const woodLidMat = mat(new THREE.MeshStandardMaterial({
      color: 0x9b6b42,
      roughness: 0.65,
    }));

    // 煨罐下腹瓮身 (上口略收，直径 23cm, 高 16cm)
    const bellyMesh = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.115, 0.09, 0.16, 20)), clayMat);
    bellyMesh.position.set(-0.20, tableY + 0.08, -0.02);
    group.add(bellyMesh);

    // 煨罐罐颈
    const neckMesh = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.095, 0.115, 0.04, 20)), clayMat);
    neckMesh.position.set(-0.20, tableY + 0.18, -0.02);
    group.add(neckMesh);

    // 罐口厚唇
    const lipMesh = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.10, 0.10, 0.02, 20)), clayMat);
    lipMesh.position.set(-0.20, tableY + 0.21, -0.02);
    group.add(lipMesh);

    // 双侧小系耳
    const earGeom = geom(new THREE.CylinderGeometry(0.01, 0.01, 0.04, 8));
    const earL = new THREE.Mesh(earGeom, clayMat);
    earL.rotation.z = Math.PI / 2;
    earL.position.set(-0.32, tableY + 0.14, -0.02);
    group.add(earL);

    const earR = new THREE.Mesh(earGeom, clayMat);
    earR.rotation.z = Math.PI / 2;
    earR.position.set(-0.08, tableY + 0.14, -0.02);
    group.add(earR);

    // 厚圆木盖
    const lidMesh = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.103, 0.103, 0.022, 20)), woodLidMat);
    lidMesh.position.set(-0.20, tableY + 0.231, -0.02);
    group.add(lidMesh);

    // 木盖中心提钮
    const knobMesh = new THREE.Mesh(geom(new THREE.CylinderGeometry(0.016, 0.012, 0.028, 12)), woodLidMat);
    knobMesh.position.set(-0.20, tableY + 0.254, -0.02);
    group.add(knobMesh);
  }

  function update(dt = 0, { paused = false } = {}) {
    for (const s of steams) {
      s.update(dt, paused);
    }
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    geometries.length = 0;
    materials.length = 0;
    textures.length = 0;
    steams.length = 0;
  }

  return {
    foodId,
    template,
    group,
    steams,
    geometries,
    materials,
    textures,
    update,
    dispose,
  };
}

/**
 * 将修饰道具绑定至推车 root 节点
 */
export function attachVendorDressing(root, vendor, options = {}) {
  if (!root || !vendor?.foodId) return null;
  const dressing = createVendorDressing(vendor.foodId, options);
  if (!dressing) return null;
  root.add(dressing.group);
  return dressing;
}
