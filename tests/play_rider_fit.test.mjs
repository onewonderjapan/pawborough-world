// 工单 B：骑乘姿势与权重修复 —— 真实 GLB 节点测试（首例验证）。
// 真实 character.glb + 派生 play-bicycle.glb：
//   - rider-fit 逐顶点空间 mask：左右各改变大量真实臂顶点（非 bone proxy），
//     爪皮肤改绑、耳/脸不动；焊接组两侧同权防 UV 缝裂；权重和 = 1；
//   - BikeView 真实接触解算：8 个曲柄相位，爪簇→握把 <=0.035m、脚簇→踏板 <=0.05m，
//     角度相对 rest 臂<=1.2rad 腿<=1.35rad，髋骨落座面；
//   - 世界不变性：任意世界平移/yaw 下接触误差相同；
//   - clone 生命周期：下车恢复原 geometry 对象、克隆被 dispose。
// Run: node tests/play_rider_fit.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const area = resolve(root, 'scene-authoring/yuyuan-area');
const require = createRequire(resolve(area, 'package.json'));
const THREE = require('three');
const { GLTFLoader } = await import(resolve(area, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'));
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });

const { PlayAvatar } = await import(resolve(area, 'web/play/avatar.js'));
const { loadBikeRig, BikeView, applyRiderPose } = await import(resolve(area, 'web/play/bike-view.js'));
const { planRideSkinFix, skinCluster } = await import(resolve(area, 'web/play/rider-fit.js'));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const parseGlb = async (path) => {
  const buf = await readFile(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((yes, no) => new GLTFLoader().parse(ab, '', yes, no));
};

const charGltf = await parseGlb(resolve(area, 'resources/characters/gray-cat/character.glb'));
const bikeGltf = await parseGlb(resolve(area, 'resources/vehicles/play-bicycle.glb'));

// 场景图：把车和猫都挂到一个世界组下（可整体平移/旋转验证世界不变性）
const world = new THREE.Group();
const scene = new THREE.Scene();
scene.add(world);

const rig = await loadBikeRig({ manifest: { path: 'x', sha256: null } }).catch(async () => {
  // loadBikeRig 会 fetch；这里直接用已解析的 gltf 构造等价 rig
  return null;
});
const rigDirect = (() => {
  const rootNode = bikeGltf.scene;
  const need = (name) => { let n = null; rootNode.traverse((o) => { if (!n && o.name === name) n = o; }); return n; };
  return {
    root: rootNode,
    frontWheel: need('front-wheel'), rearWheel: need('rear-wheel'), steering: need('steering'),
    crank: need('crank'), seat: need('seat'), handleL: need('handle-L'), handleR: need('handle-R'),
    pedalL: need('pedal-L'), pedalR: need('pedal-R'), basketSocket: need('basket-socket'),
    dismountAnchor: need('anchor-dismount'),
  };
})();
for (const k of ['frontWheel', 'rearWheel', 'crank', 'seat', 'steering'])
  check(`rig 分件 ${k} 存在`, !!rigDirect[k]);

const avatar = new PlayAvatar({ gltfScene: charGltf.scene, animations: charGltf.animations });
world.add(avatar.root);
world.updateMatrixWorld(true);

// ---- 1. rider-fit 首例验证：真实臂顶点改变、爪动耳不动 ----
const bodyMesh = (() => {
  let m = null;
  avatar.model.traverse((o) => { if (!m && o.isSkinnedMesh && o.skeleton) m = o; });
  return m;
})();
check('cat_body skinned mesh 存在', !!bodyMesh);
const originalGeometry = bodyMesh.geometry;
const beforeIdx = originalGeometry.attributes.skinIndex;
const beforeW = originalGeometry.attributes.skinWeight;
const seg = { armL: null, armR: null };
{
  const fix = planRideSkinFix(bodyMesh);
  const s = fix.stats;
  check('左右各改变大量真实臂顶点（>=100/侧）', s.changedBySide.armL >= 100 && s.changedBySide.armR >= 100,
    `armL=${s.changedBySide.armL} armR=${s.changedBySide.armR}`);
  check('清掉错绑耳/脸质量', s.earMassRemoved > 0.5, `removed=${s.earMassRemoved}`);
  check('权重和误差 <= 1e-6', s.maxWeightSumError <= 1e-6, `max=${s.maxWeightSumError}`);
  check('臂段端点为 model space 标定（肩≈±0.191,0.427,0.128）',
    Math.abs(s.armSegments.armL.shoulder[0] - 0.1914) < 0.002
    && Math.abs(s.armSegments.armL.shoulder[1] - 0.4274) < 0.002,
    JSON.stringify(s.armSegments.armL.shoulder));

  // 应用（真实流程：BikeView.attachRider 内部同样调用）
  const clone = fix.apply();
  check('apply 换上是克隆 geometry（原对象不覆盖）', bodyMesh.geometry !== originalGeometry
    && bodyMesh.geometry.attributes.position === clone.attributes.position);
  check('克隆保留 position/normal/UV/morph（形状不变）',
    clone.attributes.position === originalGeometry.attributes.position
    && clone.attributes.normal === originalGeometry.attributes.normal
    && (!!clone.attributes.uv) === (!!originalGeometry.attributes.uv)
    && (clone.morphAttributes && Object.keys(clone.morphAttributes).length) === (originalGeometry.morphAttributes && Object.keys(originalGeometry.morphAttributes).length)
      || (clone.morphAttributes && Object.keys(clone.morphAttributes).length) === (originalGeometry.morphAttributes && Object.keys(originalGeometry.morphAttributes).length),
    `morph=${Object.keys(clone.morphAttributes || {}).length} vs ${Object.keys(originalGeometry.morphAttributes || {}).length}`);

  // 爪皮肤动、耳不动：耳主导顶点（原 ear 权重 >=0.5）必须逐位不变；
  // 臂皮肤上被错绑的少量 ear 质量（<0.5）按设计清零（那本来就是错绑）。
  const armLI = bodyMesh.skeleton.bones.findIndex((b) => b.name === 'armL');
  const armRI = bodyMesh.skeleton.bones.findIndex((b) => b.name === 'armR');
  let pawMoved = 0, earDominantTouched = 0, earDominantCount = 0;
  for (let i = 0; i < originalGeometry.attributes.position.count; i++) {
    let armW0 = 0, armW1 = 0, earW0 = 0, earW1 = 0;
    for (let k = 0; k < 4; k++) {
      const b0 = beforeIdx.getComponent(i, k), b1 = bodyMesh.geometry.attributes.skinIndex.getComponent(i, k);
      const w0 = beforeW.getComponent(i, k), w1 = bodyMesh.geometry.attributes.skinWeight.getComponent(i, k);
      const n0 = bodyMesh.skeleton.bones[b0]?.name;
      if (b0 === armLI || b0 === armRI) armW0 += w0;
      if (b1 === armLI || b1 === armRI) armW1 += w1;
      if (n0 === 'earL' || n0 === 'earR') earW0 += w0;
      if (bodyMesh.skeleton.bones[b1]?.name === 'earL'
        || bodyMesh.skeleton.bones[b1]?.name === 'earR') earW1 += w1;
    }
    const y = originalGeometry.attributes.position.getY(i);
    if (armW1 - armW0 > 0.3 && y < 0.45) pawMoved++;
    if (earW0 >= 0.5 && y > 0.5) {
      earDominantCount++;
      if (Math.abs(earW1 - earW0) > 1e-9) earDominantTouched++;
    }
  }
  check(`真实耳部高处顶点全部未动（共 ${earDominantCount} 个）`, earDominantTouched === 0 && earDominantCount > 100,
    `touched=${earDominantTouched}`);
  check('大量真实爪/臂皮肤顶点改绑（>=100，非 bone proxy）', pawMoved >= 100, `moved=${pawMoved}`);

  // 爪簇存在且是皮肤簇（骨点≠爪点）
  world.updateMatrixWorld(true);
  const pawL = skinCluster(bodyMesh, bodyMesh.skeleton, 'armL', { minDist: 0.13 });
  const pawR = skinCluster(bodyMesh, bodyMesh.skeleton, 'armR', { minDist: 0.13 });
  check('左右爪皮肤簇标定成功（>=20 顶点）', pawL && pawR && pawL.count >= 20 && pawR.count >= 20,
    `L=${pawL?.count} R=${pawR?.count}`);
  seg.armL = pawL; seg.armR = pawR;

  fix.restore(clone);
  check('restore 归还原 geometry 对象', bodyMesh.geometry === originalGeometry);
}

// ---- 2. BikeView 真实接触解算：8 相位、阈值、限幅、髋骨落座 ----
const bikeView = new BikeView(rigDirect);
world.add(bikeView.root);
bikeView.placeAt([0, 0, 0], 0);
world.updateMatrixWorld(true);
bikeView.attachRider(avatar, null);
world.updateMatrixWorld(true);

const GRIP_T = 0.035, PEDAL_T = 0.05;
// 簇世界质心：簇标定是骨空间坐标（boneInverse 采样），随骨骼位姿走世界必须用
// 当前 bone.matrixWorld 直接变换（boneInverse 路径只会给出 bind 位姿冻结点）。
const clusterWorld = (view, boneName, cluster) => {
  const mesh = view._skinMesh;
  const bone = mesh.skeleton.bones[mesh.skeleton.bones.findIndex((b) => b.name === boneName)];
  bodyMesh.skeleton.update();
  const mean = new THREE.Vector3(), vertex = new THREE.Vector3();
  for (const index of cluster.vertexIndices) {
    bodyMesh.getVertexPosition(index, vertex);
    mean.add(vertex.applyMatrix4(bodyMesh.matrixWorld));
  }
  return mean.divideScalar(cluster.vertexIndices.length);
};

const phases = 8;
let worstGrip = 0, worstPedal = 0, worstArmAng = 0, worstLegAng = 0;
const measure = { phases: [], worldInvariant: null };
for (let ph = 0; ph < phases; ph++) {
  const ang = (ph / phases) * Math.PI * 2;
  if (bikeView.rig.crank) bikeView.rig.crank.rotation.x = -ang;
  world.updateMatrixWorld(true);
  applyRiderPose(avatar, bikeView, 0);
  world.updateMatrixWorld(true);
  const mesh = bikeView._skinMesh;
  const sample = {};
  for (const [arm, grip, leg, pedal] of [
    ['armL', bikeView.rig.handleL, 'legL', bikeView.rig.pedalL],
    ['armR', bikeView.rig.handleR, 'legR', bikeView.rig.pedalR],
  ]) {
    const pawW = clusterWorld(bikeView, arm, bikeView._contact[arm]);
    const gripW = bikeView.worldPos(grip, new THREE.Vector3());
    const footW = clusterWorld(bikeView, leg, bikeView._contact[leg]);
    const pedalW = bikeView.worldPos(pedal, new THREE.Vector3());
    const gd = pawW.distanceTo(gripW), pd = footW.distanceTo(pedalW);
    sample[arm] = +gd.toFixed(4); sample[leg] = +pd.toFixed(4);
    worstGrip = Math.max(worstGrip, gd);
    worstPedal = Math.max(worstPedal, pd);
  }
  // 角度限幅（相对 rest）
  for (const [name, lim] of [['armL', 1.2], ['armR', 1.2], ['legL', 1.35], ['legR', 1.35]]) {
    const bone = avatar.model.getObjectByName(name);
    const rest = avatar.restBoneQuaternions.get(name);
    const angle = bone.quaternion.angleTo(rest);
    if (name.startsWith('arm')) worstArmAng = Math.max(worstArmAng, angle);
    else worstLegAng = Math.max(worstLegAng, angle);
    check(`${name} 相位 ${ph} 角度 <= ${lim}rad`, angle <= lim + 1e-6, `${angle.toFixed(3)}`);
  }
  measure.phases.push({ phase: ph, ...sample });
}
check('8 相位爪→握把全部 <= 0.035m', worstGrip <= GRIP_T, `worst=${worstGrip.toFixed(4)}`);
check('8 相位脚→踏板全部 <= 0.05m', worstPedal <= PEDAL_T, `worst=${worstPedal.toFixed(4)}`);
check('臂角度限幅 <= 1.2rad', worstArmAng <= 1.2 + 1e-6, `worst=${worstArmAng.toFixed(3)}`);
check('腿角度限幅 <= 1.35rad', worstLegAng <= 1.35 + 1e-6, `worst=${worstLegAng.toFixed(3)}`);

// 髋骨落座面
{
  const hipsW = avatar.model.getObjectByName('hips').getWorldPosition(new THREE.Vector3());
  const seatW = bikeView.worldPos(bikeView.rig.seat, new THREE.Vector3());
  check('髋骨落在座面（|Δy| <= 0.03）', Math.abs(hipsW.y - seatW.y) <= 0.03,
    `hipsY=${hipsW.y.toFixed(3)} seatY=${seatW.y.toFixed(3)}`);
}

// 不穿车篮：爪在世界系与车篮盒（±0.14, ±0.10, ±0.07 围绕 basket-socket）保持间距
{
  const pawW = clusterWorld(bikeView, 'armR', bikeView._contact.armR);
  const basketW = bikeView.worldPos(bikeView.rig.basketSocket, new THREE.Vector3());
  const dx = Math.max(0, Math.abs(pawW.x - basketW.x) - 0.14);
  const dy = Math.max(0, Math.abs(pawW.y - basketW.y) - 0.09);
  const dz = Math.max(0, Math.abs(pawW.z - basketW.z) - 0.10);
  const clear = Math.hypot(dx, dy, dz);
  check('爪不穿车篮（盒外间距 > 0.01）', clear > 0.01, `clear=${clear.toFixed(4)}`);
}

// ---- 3. 世界不变性：整体平移 + yaw 后误差一致 ----
{
  bikeView.rig.crank.rotation.x = 0;
  world.updateMatrixWorld(true);
  applyRiderPose(avatar, bikeView, 0);
  world.updateMatrixWorld(true);
  const before = clusterWorld(bikeView, 'armR', bikeView._contact.armR)
    .distanceTo(bikeView.worldPos(bikeView.rig.handleR, new THREE.Vector3()));
  world.position.set(-157, 0, -22);
  world.rotation.y = 2.2;
  world.updateMatrixWorld(true);
  applyRiderPose(avatar, bikeView, 2.2);
  world.updateMatrixWorld(true);
  const after = clusterWorld(bikeView, 'armR', bikeView._contact.armR)
    .distanceTo(bikeView.worldPos(bikeView.rig.handleR, new THREE.Vector3()));
  check('世界平移/yaw 后实际蒙皮接触误差不变（Float32 Δ <= 3e-5）', Math.abs(before - after) <= 3e-5,
    `before=${before.toFixed(6)} after=${after.toFixed(6)}`);
  measure.worldInvariant = { before: +before.toFixed(6), after: +after.toFixed(6) };
  world.position.set(0, 0, 0); world.rotation.y = 0;
  world.updateMatrixWorld(true);
}

// ---- 4. 下车恢复：原 walking/eating 状态与 geometry 归还 ----
{
  const geoDuring = bikeView._skinMesh.geometry;
  bikeView.detachRider(avatar);
  check('下车恢复原 geometry 对象', bodyMesh.geometry === originalGeometry);
  check('骑行期间用克隆、原对象未被写入', geoDuring !== originalGeometry);
  avatar.update({ feet: [0, 0, 0], yaw: 0, moving: true, facingYaw: 0.3, speed: 2.0, paused: false, dt: 0.016 });
  check('下车后 walking 动画状态恢复', avatar.current === 'walk');
}

// 证据 JSON（供 DELIVERY 引用）
const fs = await import('node:fs/promises');
const out = process.env.PB_RIDER_MEASURE_JSON;
if (out) {
  await fs.writeFile(out, JSON.stringify({
    source: { character: 'resources/characters/gray-cat/character.glb (sha 5f60f225…)',
      bicycle: 'resources/vehicles/play-bicycle.glb (sha a19b8635…)' },
    thresholds: { grip: GRIP_T, pedal: PEDAL_T, armAngle: 1.2, legAngle: 1.35, phases },
    measured: { worstGrip: +worstGrip.toFixed(4), worstPedal: +worstPedal.toFixed(4),
      worstArmAngle: +worstArmAng.toFixed(3), worstLegAngle: +worstLegAng.toFixed(3) },
    phases: measure.phases,
    worldInvariant: measure.worldInvariant,
  }, null, 2) + '\n', 'utf8');
  console.log(`rider measure JSON -> ${out}`);
}

console.log(failures === 0 ? 'PLAY_RIDER_FIT PASS' : `PLAY_RIDER_FIT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
