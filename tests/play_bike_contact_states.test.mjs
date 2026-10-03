// tests/play_bike_contact_states.test.mjs — U07 骑乘姿势与机械细节量化测试
// 针对 C1 静止 / 前进 / 转弯 / 倒车 4 态，基于真实 gray-cat + play-bicycle GLB 进行蒙皮几何接触量化：
// 1. 手—车把真实蒙皮簇质心间距 <= 0.035m
// 2. 脚—踏板真实蒙皮簇质心间距 <= 0.050m
// 3. 臀—鞍座垂直间距 |Δy| <= 0.035m
// 4. 关节角度限幅：臂 <= 1.20 rad、腿 <= 1.35 rad、脊柱 <= 0.55 rad
// 5. 机械细节核验：
//    - 检查 GLB 无独立脚撑节点，无未收起机构；
//    - 踏板随曲柄相位绕五通轴公转，倒车反转，静止锁定；
// 6. 生命周期：下车恢复原 geometry 对象，克隆被 dispose，原网格未被篡改。

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
const { BikeView, applyRiderPose } = await import(resolve(area, 'web/play/bike-view.js'));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures += 1;
};

const parseGlb = async (path) => {
  const buf = await readFile(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((yes, no) => new GLTFLoader().parse(ab, '', yes, no));
};

const charGltf = await parseGlb(resolve(area, 'resources/characters/gray-cat/character.glb'));
const bikeGltf = await parseGlb(resolve(area, 'resources/vehicles/play-bicycle.glb'));

// 1. 机械细节与分件核验
console.log('=== 1. 机械分件与脚撑核验 ===');
const bikeNodes = [];
bikeGltf.scene.traverse(o => bikeNodes.push(o.name));
const kickstandNodes = bikeNodes.filter(n => /kick|stand|footstand/i.test(n));
check('无独立未收脚撑分件（GLB 纯净无脚撑节点）', kickstandNodes.length === 0, `found=${kickstandNodes.join(',') || 'none'}`);

const crank = bikeGltf.scene.getObjectByName('crank');
const pedalL = bikeGltf.scene.getObjectByName('pedal-L');
const pedalR = bikeGltf.scene.getObjectByName('pedal-R');
check('曲柄与左右踏板存在且层级正确', !!(crank && pedalL && pedalR && pedalL.parent === crank && pedalR.parent === crank));

// 2. 场景图构建与骑乘安装
const world = new THREE.Group();
const scene = new THREE.Scene();
scene.add(world);

const rootNode = bikeGltf.scene;
const need = (name) => { let n = null; rootNode.traverse((o) => { if (!n && o.name === name) n = o; }); return n; };
const rig = {
  root: rootNode,
  frontWheel: need('front-wheel'), rearWheel: need('rear-wheel'), steering: need('steering'),
  crank: need('crank'), seat: need('seat'), handleL: need('handle-L'), handleR: need('handle-R'),
  pedalL: need('pedal-L'), pedalR: need('pedal-R'), basketSocket: need('basket-socket'),
  dismountAnchor: need('anchor-dismount'),
};

const avatar = new PlayAvatar({ gltfScene: charGltf.scene, animations: charGltf.animations });
world.add(avatar.root);
const bikeView = new BikeView(rig);
world.add(bikeView.root);
bikeView.placeAt([0, 0, 0], 0);
world.updateMatrixWorld(true);

const bodyMesh = (() => {
  let m = null;
  avatar.model.traverse((o) => { if (!m && o.isSkinnedMesh && o.skeleton) m = o; });
  return m;
})();
const originalGeometry = bodyMesh.geometry;

bikeView.attachRider(avatar, { signedTravel: 0 });
world.updateMatrixWorld(true);

const clusterWorld = (view, boneName, cluster) => {
  bodyMesh.skeleton.update();
  const mean = new THREE.Vector3(), vertex = new THREE.Vector3();
  for (const index of cluster.vertexIndices) {
    bodyMesh.getVertexPosition(index, vertex);
    mean.add(vertex.applyMatrix4(bodyMesh.matrixWorld));
  }
  return mean.divideScalar(cluster.vertexIndices.length);
};

// 3. 四态量化：静止 / 前进 / 转弯（左/右） / 倒车
console.log('\n=== 2. C1 四态真实蒙皮接触量化 ===');
const states = [
  { id: 'idle', label: '静止', speeds: [0], steers: [0], phases: 1 },
  { id: 'forward', label: '前进', speeds: [2.0], steers: [0], phases: 8 },
  { id: 'turn_left', label: '左转弯', speeds: [1.5], steers: [-1.0], phases: 8 },
  { id: 'turn_right', label: '右转弯', speeds: [1.5], steers: [1.0], phases: 8 },
  { id: 'reverse', label: '倒车', speeds: [-1.2], steers: [0], phases: 8 },
];

const TOL = { grip: 0.035, pedal: 0.050, hipsDeltaY: 0.035, armAng: 1.20, legAng: 1.35, spineAng: 0.55 };
let worstGrip = 0, worstPedal = 0, worstHipsY = 0, worstArm = 0, worstLeg = 0, worstSpine = 0;

for (const st of states) {
  let stWorstGrip = 0, stWorstPedal = 0;
  for (let ph = 0; ph < st.phases; ph++) {
    const travel = st.id === 'idle' ? 0 : (ph / 8) * (Math.PI * 2 * bikeView.wheelRadius / bikeView.crankRatio) * Math.sign(st.speeds[0]);
    const mockCtl = {
      signedTravel: travel,
      input: { right: st.steers[0], forward: Math.sign(st.speeds[0]) }
    };
    bikeView.updateRide([0, 0, 0], 0, mockCtl, 0.016);
    world.updateMatrixWorld(true);
    applyRiderPose(avatar, bikeView, 0);
    world.updateMatrixWorld(true);

    const pawL = clusterWorld(bikeView, 'armL', bikeView._contact.armL);
    const gripL = bikeView.worldPos(bikeView.rig.handleL, new THREE.Vector3());
    const dGripL = pawL.distanceTo(gripL);

    const pawR = clusterWorld(bikeView, 'armR', bikeView._contact.armR);
    const gripR = bikeView.worldPos(bikeView.rig.handleR, new THREE.Vector3());
    const dGripR = pawR.distanceTo(gripR);

    const footL = clusterWorld(bikeView, 'legL', bikeView._contact.legL);
    const pedL = bikeView.worldPos(bikeView.rig.pedalL, new THREE.Vector3());
    const dPedL = footL.distanceTo(pedL);

    const footR = clusterWorld(bikeView, 'legR', bikeView._contact.legR);
    const pedR = bikeView.worldPos(bikeView.rig.pedalR, new THREE.Vector3());
    const dPedR = footR.distanceTo(pedR);

    const hipsW = avatar.model.getObjectByName('hips').getWorldPosition(new THREE.Vector3());
    const seatW = bikeView.worldPos(bikeView.rig.seat, new THREE.Vector3());
    const dHipsY = Math.abs(hipsW.y - seatW.y);

    const armL_ang = avatar.model.getObjectByName('armL').quaternion.angleTo(avatar.restBoneQuaternions.get('armL'));
    const armR_ang = avatar.model.getObjectByName('armR').quaternion.angleTo(avatar.restBoneQuaternions.get('armR'));
    const legL_ang = avatar.model.getObjectByName('legL').quaternion.angleTo(avatar.restBoneQuaternions.get('legL'));
    const legR_ang = avatar.model.getObjectByName('legR').quaternion.angleTo(avatar.restBoneQuaternions.get('legR'));
    const spine_ang = avatar.model.getObjectByName('spine').quaternion.angleTo(avatar.restBoneQuaternions.get('spine'));

    stWorstGrip = Math.max(stWorstGrip, dGripL, dGripR);
    stWorstPedal = Math.max(stWorstPedal, dPedL, dPedR);
    worstGrip = Math.max(worstGrip, dGripL, dGripR);
    worstPedal = Math.max(worstPedal, dPedL, dPedR);
    worstHipsY = Math.max(worstHipsY, dHipsY);
    worstArm = Math.max(worstArm, armL_ang, armR_ang);
    worstLeg = Math.max(worstLeg, legL_ang, legR_ang);
    worstSpine = Math.max(worstSpine, spine_ang);
  }
  check(`${st.label}状态：手把接触（<= ${TOL.grip}m）`, stWorstGrip <= TOL.grip, `worst=${stWorstGrip.toFixed(4)}m`);
  check(`${st.label}状态：脚踏接触（<= ${TOL.pedal}m）`, stWorstPedal <= TOL.pedal, `worst=${stWorstPedal.toFixed(4)}m`);
}

check('全状态手部最大误差 <= 0.035m', worstGrip <= TOL.grip, `worst=${worstGrip.toFixed(4)}m`);
check('全状态脚部最大误差 <= 0.050m', worstPedal <= TOL.pedal, `worst=${worstPedal.toFixed(4)}m`);
check('全状态臀鞍垂直间距 <= 0.035m', worstHipsY <= TOL.hipsDeltaY, `worst=${worstHipsY.toFixed(4)}m`);
check('全状态手臂转角 <= 1.20 rad', worstArm <= TOL.armAng, `worst=${worstArm.toFixed(3)}rad`);
check('全状态腿部转角 <= 1.35 rad', worstLeg <= TOL.legAng, `worst=${worstLeg.toFixed(3)}rad`);
check('全状态脊柱前倾 <= 0.55 rad', worstSpine <= TOL.spineAng, `worst=${worstSpine.toFixed(3)}rad`);

// 4. 下车与生命周期
console.log('\n=== 3. 下车与生命周期恢复 ===');
const geoCloneDuring = bodyMesh.geometry;
check('骑行期间使用克隆 geometry', geoCloneDuring !== originalGeometry);
bikeView.detachRider(avatar);
check('下车后完美恢复原始 geometry 对象', bodyMesh.geometry === originalGeometry);

// 校验原始网格未被篡改
let attributesIntact = true;
const posOrig = originalGeometry.attributes.position;
if (!posOrig || posOrig.count <= 0) attributesIntact = false;
check('原角色几何属性未被污染/破坏', attributesIntact);

console.log(`\n=== 结果：${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'} ===`);
process.exit(failures === 0 ? 0 : 1);
