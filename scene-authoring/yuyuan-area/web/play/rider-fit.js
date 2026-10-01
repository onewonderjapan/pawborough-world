// 工单 B：骑乘专用双臂蒙皮权重修复（运行时、可还原、原 GLB 字节不动）。
//
// 背景（NEUTRAL-CONTACT-LANDMARKS.json / SKIN-ISLANDS.json 证据）：灰猫 cat_body
// 的上臂/前臂/爪皮肤顶点大多数错绑 spine/earR/hips，armL/armR 真实权重 >=0.3 的
// 只有几十个顶点——按 rest 姿势摆臂时爪尖钉在原位，形成尖刺/够不到把。
//
// 修复方法（主控复核后的定版）：
//   1. 逐顶点空间 mask 归属：焊接 epsilon 1e-5 只用于「同权重一致性」与统计，
//      不作整身归属筛子（真实原 GLB 焊接后 cat_body 是 15510 顶点单一连通体，
//      整体 component 质心不能区分双臂——见 RIDER-FIRST-FAIL.json）。
//      归属沿「肩→真实爪簇」臂段：远端硬属臂，肩/胸边界软过渡；
//      头耳脸尾（y 高处 ear/head 权重区）与胸腹中线（|x| 小）显式保护；
//   2. 坐标空间：归属全部在 model(mesh) space——肩/爪端点由 boneInverses（bind
//      位姿，与当前动画/世界无关）求出；蒙皮簇采样同样用 boneInverse 把 mesh
//      space 直接映到 bone space，世界平移/yaw 不影响结果；骨点不再与世界点混算；
//   3. 生命周期：骑乘用完整 geometry.clone（保留 position/normal/UV/morph），
//      只 patch clone 的 skinIndex/skinWeight；下车恢复原 geometry 对象并 dispose
//      整个 clone（BufferAttribute 不单独 dispose，避免反复上下车漏 GPU buffer）。
//      原 GLB sha / 原 attributes 不变；sharedPlayFood 归属不受影响。
// 统一 restQ 后标定：调用方先把全部骨骼置 rest（avatar.restBoneQuaternions），
// boneInverses 本身与位姿无关，标定结果稳定，不取 walk animation 中间肩点。
import * as THREE from 'three';

const WELD_EPS = 1e-5;
const ARM_CORE = 0.055;        // 距臂段 <= ARM_CORE：硬属臂（爪/前臂皮肤）
const ARM_SOFT = 0.16;         // 软过渡外缘（肩/胸边界在此淡出）
const CHEST_GUARD_X = 0.18;    // |x| < CHEST_GUARD_X：胸腹中线，臂权淡出为 0
const SHOULDER_BLEND_D = 0.06; // 肩关节附近保留脊柱权的过渡带半径
const SHOULDER_ARM_CAP = 0.62; // 肩部臂权上限（其余给躯干，防拉细躯干）
const EAR_GUARD_Y = 0.42;      // 头/耳权重且 y 更高的顶点：一律不改（护耳脸）

export function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function distPointSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-12;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 焊接哈希（含邻居格，epsilon 1e-5）：同位置顶点分组——UV 缝两侧顶点共享权重，
// 防缝裂。仅用于「权重一致性」与统计证据，不作归属筛子。
function weldGroups(position) {
  const n = position.count;
  const hash = new Map();
  const keyOf = (i) => {
    // 1e-5 网格主格 + 检查 27 邻格代价高；直接用最近邻遍历太慢，这里用
    // 量化格互撞即可：1e-5 精度下同位置顶点必然落进同格或相邻格，逐一
    // 对相邻格做距离复核由调用方在组内完成（同格内 O(k²) 比对）。
    return `${Math.round(position.getX(i) / WELD_EPS)}:${Math.round(position.getY(i) / WELD_EPS)}:${Math.round(position.getZ(i) / WELD_EPS)}`;
  };
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    let slot = hash.get(k);
    if (slot === undefined) { slot = []; hash.set(k, slot); }
    slot.push(i);
  }
  // 组内按真实距离并查集合并（同格 + 6 邻格，覆盖浮点边界）
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const cells = [...hash.entries()];
  const byCell = new Map(hash);
  for (const [k, slot] of cells) {
    const [cx, cy, cz] = k.split(':').map(Number);
    for (let dx = 0; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && (dy !== 0 || dz !== 0) && dz !== 0) continue;   // 只查半空间邻格防重复
      const nk = `${cx + dx}:${cy + dy}:${cz + dz}`;
      const other = byCell.get(nk);
      if (!other) continue;
      for (const i of slot) for (const j of other) {
        const ddx = position.getX(i) - position.getX(j);
        const ddy = position.getY(i) - position.getY(j);
        const ddz = position.getZ(i) - position.getZ(j);
        if (ddx * ddx + ddy * ddy + ddz * ddz <= WELD_EPS * WELD_EPS) union(i, j);
      }
    }
    // 同格内合并
    for (let a = 1; a < slot.length; a++) union(slot[0], slot[a]);
  }
  const group = new Int32Array(n);
  const ids = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let id = ids.get(r);
    if (id === undefined) { id = ids.size; ids.set(r, id); }
    group[i] = id;
  }
  return { group, groupCount: ids.size };
}

// 真实焊接连通区（统计/证据用：报告 cat_body 是单一连通体这一事实）。
export function connectedComponents(geometry) {
  const pos = geometry.attributes.position;
  const { group, groupCount } = weldGroups(pos);
  const parent = new Int32Array(groupCount);
  for (let i = 0; i < groupCount; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const idx = geometry.index;
  const n = pos.count;
  const triCount = Math.floor((idx ? idx.count : n) / 3);
  for (let t = 0; t < triCount; t++) {
    const a = group[idx ? idx.getX(t * 3) : t * 3];
    const b = group[idx ? idx.getX(t * 3 + 1) : t * 3 + 1];
    const c = group[idx ? idx.getX(t * 3 + 2) : t * 3 + 2];
    const ra = find(a), rb = find(b), rc = find(c);
    if (ra !== rb) parent[rb] = ra;
    if (ra !== rc) parent[rc] = ra;
  }
  const ids = new Set();
  for (let i = 0; i < groupCount; i++) ids.add(find(i));
  return ids.size;
}

// 臂段端点（全部 model space，bind 位姿）：肩骨原点 = invert(boneInverse) 原点；
// 爪簇 = 臂骨权重 >=0.3 顶点在骨空间最低带（minY+0.035）质心。boneInverses 是
// mesh→bone 的 bind 逆矩阵，与当前动画/世界位姿无关——不取 walk 中间肩点。
function armSegmentModel(mesh, skeleton, boneName) {
  const boneIndex = skeleton.bones.findIndex((b) => b.name === boneName);
  if (boneIndex < 0) return null;
  const boneInverse = new THREE.Matrix4().copy(skeleton.boneInverses[boneIndex]);
  const boneOriginInv = new THREE.Matrix4().copy(boneInverse).invert();
  const shoulder = new THREE.Vector3().setFromMatrixPosition(boneOriginInv);
  const skinIdx = mesh.geometry.attributes.skinIndex;
  const skinW = mesh.geometry.attributes.skinWeight;
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const weightedLocal = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++)
      if (skinIdx.getComponent(i, k) === boneIndex) w += skinW.getComponent(i, k);
    if (w < 0.3) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(boneInverse);   // mesh space → bone space
    weightedLocal.push(v.clone());
  }
  if (!weightedLocal.length) return null;
  const minY = Math.min(...weightedLocal.map((p) => p.y));
  const tip = weightedLocal.filter((p) => p.y <= minY + 0.035);
  const center = new THREE.Vector3();
  for (const p of tip) center.add(p);
  center.divideScalar(Math.max(1, tip.length));
  const tipModel = center.clone().applyMatrix4(boneOriginInv);  // bone space → mesh space
  return {
    boneIndex, boneInverse, boneOriginInv,
    shoulder, tipModel, contactLocal: center, radius: center.length(),
    weightedCount: weightedLocal.length,
  };
}

// 真实皮肤顶点簇（改绑后）：权重 >=minWeight 且离骨原点 >minDist 的顶点簇，
// 返回骨空间质心/半径/数量。boneInverse 直接采样，结果与世界平移/yaw 无关，
// 供骑姿解算（骨点≠爪点：这是爪皮肤自己的质心）。
export function skinCluster(mesh, skeleton, boneName, { minWeight = 0.5, minDist = 0.13 } = {}) {
  const boneIndex = skeleton.bones.findIndex((b) => b.name === boneName);
  if (boneIndex < 0) return null;
  const boneInverse = new THREE.Matrix4().copy(skeleton.boneInverses[boneIndex]);
  const skinIdx = mesh.geometry.attributes.skinIndex;
  const skinW = mesh.geometry.attributes.skinWeight;
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const pts = [];
  const vertexIndices = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++)
      if (skinIdx.getComponent(i, k) === boneIndex) w += skinW.getComponent(i, k);
    if (w < minWeight) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(boneInverse);
    if (v.length() > minDist) { pts.push(v.clone()); vertexIndices.push(i); }
  }
  if (!pts.length) return null;
  const center = new THREE.Vector3();
  for (const p of pts) center.add(p);
  center.divideScalar(pts.length);
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, p.distanceTo(center));
  // 一个皮肤簇可能同时由手臂和脊柱驱动；均值也必须按实际蒙皮权重计算。
  // 对每个骨骼预聚合 bind 空间质心，运行时解算无需遍历数百个顶点。
  const byBone = new Map();
  for (const i of vertexIndices) {
    for (let k = 0; k < 4; k++) {
      const index = skinIdx.getComponent(i, k), weight = skinW.getComponent(i, k);
      if (weight <= 0) continue;
      let entry = byBone.get(index);
      if (!entry) { entry = { mass: 0, point: new THREE.Vector3() }; byBone.set(index, entry); }
      v.fromBufferAttribute(pos, i).applyMatrix4(skeleton.boneInverses[index]);
      entry.point.addScaledVector(v, weight); entry.mass += weight;
    }
  }
  const contributions = [...byBone].map(([index, entry]) => ({
    bone: skeleton.bones[index], weight: entry.mass / pts.length,
    local: entry.point.divideScalar(entry.mass),
  }));
  return { contactLocal: center, radius, count: pts.length, vertexIndices, contributions };
}

// 主入口：计算臂权重修复（不落地）。apply/restore 换的是完整 geometry 克隆。
export function planRideSkinFix(mesh) {
  const geometry = mesh.geometry;
  const skeleton = mesh.skeleton;
  if (!skeleton) throw new Error('rider-fit: mesh has no skeleton');
  const boneIndexByName = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  for (const need of ['armL', 'armR', 'spine'])
    if (!boneIndexByName.has(need)) throw new Error(`rider-fit: bone "${need}" missing`);
  if (!boneIndexByName.has('hips')) boneIndexByName.set('hips', boneIndexByName.get('spine'));

  const segL = armSegmentModel(mesh, skeleton, 'armL');
  const segR = armSegmentModel(mesh, skeleton, 'armR');
  if (!segL || !segR) throw new Error('rider-fit: arm clusters empty');

  const pos = geometry.attributes.position;
  const n = pos.count;
  const welded = weldGroups(pos);
  const weldedComponents = connectedComponents(geometry);

  // 逐顶点臂权目标（按焊接组代表计算，组内一致 → UV 缝两侧同权不裂）
  const oldIdx = geometry.attributes.skinIndex;
  const oldW = geometry.attributes.skinWeight;
  const p = new THREE.Vector3();
  const targetArmW = new Float32Array(n);
  const sideOf = new Int8Array(n);          // -1 无 / 1 armL / 2 armR
  const segBySide = { 1: segL, 2: segR };
  const boneNameBySide = { 1: 'armL', 2: 'armR' };
  const EAR_FACE = new Set(['earL', 'earR', 'head', 'tail1', 'tail2', 'root']);
  // 先取每个焊接组的首顶点算 mask（组内顶点位置一致 → mask 一致）
  const repOfGroup = new Map();
  for (let i = 0; i < n; i++) {
    const g = welded.group[i];
    if (!repOfGroup.has(g)) repOfGroup.set(g, i);
  }
  const groupMask = new Float32Array(repOfGroup.size);
  const groupSide = new Int8Array(repOfGroup.size);
  for (const [g, i] of repOfGroup) {
    p.fromBufferAttribute(pos, i);
    // 保护：耳/头主导的顶点（权重 >=0.5）一律不动——那是真的耳/脸皮肤；
    // 臂皮肤上错绑的少量 ear 质量（<0.5）才属于清理对象。
    let wEarHead = 0, wLeg = 0;
    for (let k = 0; k < 4; k++) {
      const bn = skeleton.bones[oldIdx.getComponent(i, k)]?.name;
      if (bn === 'earL' || bn === 'earR' || bn === 'head') wEarHead += oldW.getComponent(i, k);
      if (bn === 'legL' || bn === 'legR') wLeg += oldW.getComponent(i, k);
    }
    // 高处是真实脸耳；低处的 ear/head 权重正是已诊断的臂错绑，须修正。
    if (wLeg >= 0.5 || (p.y > 0.5 && wEarHead >= 0.5)) { groupMask[g] = 0; groupSide[g] = 0; continue; }
    // 臂段上但在头脸高度（y>0.5）的杂顶点同样不动（额外保险）
    if (p.y > 0.5 && wEarHead > 0.01) { groupMask[g] = 0; groupSide[g] = 0; continue; }
    const side = p.x < 0 ? 2 : 1;               // x<0 = 右侧（armR）
    const seg = segBySide[side];
    const dSeg = distPointSegment(p, seg.shoulder, seg.tipModel);
    if (dSeg > ARM_SOFT) { groupMask[g] = 0; groupSide[g] = 0; continue; }
    // 半径剖面：<=ARM_CORE 硬属臂，ARM_CORE..ARM_SOFT 软过渡
    let wArm = 1 - smooth01((dSeg - ARM_CORE) / (ARM_SOFT - ARM_CORE));
    wArm *= 1 - smooth01((p.y - 0.40) / 0.06); // 肩上缘接回颈部，不让颈毛跟爪前伸
    // 胸腹中线淡出（|x| < CHEST_GUARD_X 线性归零）
    wArm *= smooth01((Math.abs(p.x) - CHEST_GUARD_X) / 0.03);
    // 肩关节附近封顶（保留躯干权，防拉细躯干）
    const dShoulder = p.distanceTo(seg.shoulder);
    if (dShoulder < SHOULDER_BLEND_D) wArm = Math.min(wArm, SHOULDER_ARM_CAP);
    if (wArm <= 0.01) { groupMask[g] = 0; groupSide[g] = 0; continue; }
    // 不降低既有真实臂权
    let armOld = 0;
    for (let k = 0; k < 4; k++)
      if (skeleton.bones[oldIdx.getComponent(i, k)]?.name === boneNameBySide[side])
        armOld += oldW.getComponent(i, k);
    groupMask[g] = Math.max(wArm, armOld);
    groupSide[g] = side;
  }
  // 组内一致回填
  for (let i = 0; i < n; i++) {
    targetArmW[i] = groupMask[welded.group[i]];
    sideOf[i] = groupSide[welded.group[i]];
  }

  // 生成 patch 后的 skinIndex/skinWeight（在完整 geometry clone 上替换）
  const newIdx = oldIdx.clone();
  const newW = oldW.clone();
  let changed = 0, earMassRemoved = 0, maxSumErr = 0, armMassAdded = 0;
  const changedBySide = { 1: 0, 2: 0 };
  for (let i = 0; i < n; i++) {
    const side = sideOf[i];
    if (!side) continue;
    const wArm = targetArmW[i];
    const armBoneIndex = boneIndexByName.get(boneNameBySide[side]);
    const slots = [];
    let armOld = 0;
    for (let k = 0; k < 4; k++) {
      const bi = oldIdx.getComponent(i, k);
      const bw = oldW.getComponent(i, k);
      if (bi === armBoneIndex) { armOld += bw; continue; }
      const bn = skeleton.bones[bi]?.name;
      if (EAR_FACE.has(bn)) { earMassRemoved += bw; continue; }   // 错绑耳/脸/尾质量清零
      slots.push([bi, bw]);
    }
    const restMass = slots.reduce((s, [, w]) => s + w, 0) || 1e-9;
    const newArmW = Math.min(1, armOld + wArm * (1 - armOld));
    const scale = (1 - newArmW) / restMass;
    const out = [[armBoneIndex, newArmW],
      ...slots.map(([bi, w]) => [bi, w * scale])].filter(([, w]) => w > 1e-4);
    const total = out.reduce((s, [, w]) => s + w, 0);
    out.sort((a, b) => b[1] - a[1]);
    const top = out.slice(0, 4).map(([bi, w]) => [bi, w / total]);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    maxSumErr = Math.max(maxSumErr, Math.abs(1 - sum));
    for (let k = 0; k < 4; k++) {
      if (k < top.length) { newIdx.setComponent(i, k, top[k][0]); newW.setComponent(i, k, top[k][1]); }
      else { newIdx.setComponent(i, k, 0); newW.setComponent(i, k, 0); }
    }
    changed++; changedBySide[side]++;
    armMassAdded += newArmW - armOld;
  }

  const fix = {
    stats: {
      mesh: mesh.name || 'cat_body',
      verticesChanged: changed,
      changedBySide: { armL: changedBySide[1], armR: changedBySide[2] },
      armMassAdded: +armMassAdded.toFixed(3),
      earMassRemoved: +earMassRemoved.toFixed(4),
      maxWeightSumError: +maxSumErr.toFixed(9),
      weldedGroups: welded.groupCount,
      weldedComponents,
      armSegments: {
        armL: { shoulder: segL.shoulder.toArray(), tip: segL.tipModel.toArray(), weightedCount: segL.weightedCount },
        armR: { shoulder: segR.shoulder.toArray(), tip: segR.tipModel.toArray(), weightedCount: segR.weightedCount },
      },
    },
    // 应用：整只 geometry 克隆（position/normal/UV/morph 全保留）换到 mesh 上，
    // 只 patch 克隆的 skinIndex/skinWeight；原 geometry 对象由 restore 归还。
    apply() {
      const clone = geometry.clone();
      clone.setAttribute('skinIndex', newIdx);
      clone.setAttribute('skinWeight', newW);
      mesh.geometry = clone;
      return clone;
    },
    // 还原：换回原 geometry 对象，dispose 整个克隆（释放其全部 GPU buffer）
    restore(appliedClone) {
      mesh.geometry = geometry;
      if (appliedClone && appliedClone !== geometry) appliedClone.dispose();
    },
    patched: { skinIndex: newIdx, skinWeight: newW },
  };
  return fix;
}
