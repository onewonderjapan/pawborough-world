// M04-A: Frozen runtime derived arm-rig construction.
// Derives a 16-joint skeleton and patched geometry clone for food holding/eating.
import * as THREE from 'three';

function smoothstep(min, max, x) {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const u = (x - min) / (max - min);
  return u * u * (3 - 2 * u);
}

/**
 * Plans and constructs the derived 16-bone arm rig.
 *
 * @param {THREE.SkinnedMesh} mesh The prepared body mesh (caller already applied planRideSkinFix + smoothPlushShoulders)
 * @param {object} [options]
 * @param {object} [options.palmVertexIds] { armL: number[], armR: number[] }
 * @param {number} [options.elbowFraction=0.55]
 * @param {number} [options.wristFraction=0.93]
 * @returns {object} handle { geometry, skeleton, bonesBySide, stats, activate, deactivate, resetJoints, dispose }
 */
export function planFoodArmRig(mesh, options = {}) {
  const {
    palmVertexIds = {},
    elbowFraction = 0.55,
    wristFraction = 0.93,
  } = options;

  const baseGeometry = mesh.geometry;
  const baseSkeleton = mesh.skeleton;
  if (!baseSkeleton) throw new Error('planFoodArmRig: mesh has no skeleton');

  const oldBones = baseSkeleton.bones;
  const armLIndex = oldBones.findIndex(b => b.name === 'armL');
  const armRIndex = oldBones.findIndex(b => b.name === 'armR');
  if (armLIndex < 0 || armRIndex < 0) {
    throw new Error('planFoodArmRig: required arm bones missing');
  }

  const originalArmL = oldBones[armLIndex];
  const originalArmR = oldBones[armRIndex];

  const pos = baseGeometry.attributes.position;
  const oldIdx = baseGeometry.attributes.skinIndex;
  const oldW = baseGeometry.attributes.skinWeight;

  // Derive rest shoulder positions from inverse of boneInverses in bind space
  const setupArmChain = (side, shoulderIndex, palmIds) => {
    const shoulderInverseBind = baseSkeleton.boneInverses[shoulderIndex];
    const shoulderBindWorld = shoulderInverseBind.clone().invert();
    const pShoulder = new THREE.Vector3().setFromMatrixPosition(shoulderBindWorld);

    // Compute bind-space palm mean from fixed palm vertex IDs transformed by mesh.bindMatrix
    const pPalm = new THREE.Vector3();
    const v = new THREE.Vector3();
    const ids = palmIds || [];
    for (const id of ids) {
      v.fromBufferAttribute(pos, id).applyMatrix4(mesh.bindMatrix);
      pPalm.add(v);
    }
    if (ids.length > 0) {
      pPalm.divideScalar(ids.length);
    } else {
      pPalm.copy(pShoulder);
    }

    const armVec = pPalm.clone().sub(pShoulder);
    const pForearm = pShoulder.clone().addScaledVector(armVec, elbowFraction);
    const pWrist = pShoulder.clone().addScaledVector(armVec, wristFraction);

    // Forearm local rest offset in parent (shoulder) bind frame
    const localForearmPos = pForearm.clone().applyMatrix4(shoulderInverseBind);
    const localForearmQuat = new THREE.Quaternion();
    const localForearmScale = new THREE.Vector3(1, 1, 1);
    const localRestC_forearm = new THREE.Matrix4().compose(localForearmPos, localForearmQuat, localForearmScale);
    const forearmInverseBind = localRestC_forearm.clone().invert().multiply(shoulderInverseBind);

    // Wrist local rest offset in parent (forearm) bind frame
    const localWristPos = pWrist.clone().applyMatrix4(forearmInverseBind);
    const localWristQuat = new THREE.Quaternion();
    const localWristScale = new THREE.Vector3(1, 1, 1);
    const localRestC_wrist = new THREE.Matrix4().compose(localWristPos, localWristQuat, localWristScale);
    const wristInverseBind = localRestC_wrist.clone().invert().multiply(forearmInverseBind);

    // Create new bone instances
    const forearmBone = new THREE.Bone();
    forearmBone.name = side + '_forearm';
    forearmBone.position.copy(localForearmPos);
    forearmBone.quaternion.copy(localForearmQuat);
    forearmBone.scale.copy(localForearmScale);
    forearmBone.updateMatrix();

    const wristBone = new THREE.Bone();
    wristBone.name = side + '_wrist';
    wristBone.position.copy(localWristPos);
    wristBone.quaternion.copy(localWristQuat);
    wristBone.scale.copy(localWristScale);
    wristBone.updateMatrix();

    return {
      pShoulder,
      pPalm,
      armVec,
      armLenSq: armVec.lengthSq(),
      forearmBone,
      wristBone,
      forearmInverseBind,
      wristInverseBind,
      restTransforms: {
        forearm: {
          position: localForearmPos.clone(),
          quaternion: localForearmQuat.clone(),
          scale: localForearmScale.clone(),
        },
        wrist: {
          position: localWristPos.clone(),
          quaternion: localWristQuat.clone(),
          scale: localWristScale.clone(),
        },
      },
    };
  };

  const chainL = setupArmChain('armL', armLIndex, palmVertexIds.armL);
  const chainR = setupArmChain('armR', armRIndex, palmVertexIds.armR);

  // Derived skeleton: preserve old 12 bone objects/order/inverses, append L forearm,wrist then R forearm,wrist
  const derivedBones = [
    ...oldBones,
    chainL.forearmBone,
    chainL.wristBone,
    chainR.forearmBone,
    chainR.wristBone,
  ];

  const derivedBoneInverses = [
    ...baseSkeleton.boneInverses.map(m => m.clone()),
    chainL.forearmInverseBind,
    chainL.wristInverseBind,
    chainR.forearmInverseBind,
    chainR.wristInverseBind,
  ];

  const derivedSkeleton = new THREE.Skeleton(derivedBones, derivedBoneInverses);

  const bonesBySide = {
    armL: {
      shoulder: originalArmL,
      forearm: chainL.forearmBone,
      wrist: chainL.wristBone,
    },
    armR: {
      shoulder: originalArmR,
      forearm: chainR.forearmBone,
      wrist: chainR.wristBone,
    },
  };

  // Clone geometry: shares original textures/materials unchanged, only patch skinIndex and skinWeight
  const derivedGeometry = baseGeometry.clone();
  const newIdx = derivedGeometry.attributes.skinIndex;
  const newW = derivedGeometry.attributes.skinWeight;

  let affectedVertexCount = 0;
  let smoothVertexCount = 0;
  let hardVertexCount = 0;
  let unchangedVertexCount = 0;

  const vBind = new THREE.Vector3();
  const vRel = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Allowed region check: abs(x) > .145, abs(x) < .37, .10 < y < .505, z > -.09
    const inRegion = (Math.abs(x) > 0.145 && Math.abs(x) < 0.37 && y > 0.10 && y < 0.505 && z > -0.09);
    if (!inRegion) {
      continue;
    }

    // Choose target arm by x sign (L positive)
    const isLeft = x >= 0;
    const targetArmIndex = isLeft ? armLIndex : armRIndex;
    const shoulderIndex = targetArmIndex;
    const forearmIndex = isLeft ? 12 : 14;
    const wristIndex = isLeft ? 13 : 15;

    // Combine duplicate influences by bone index without dropping any nonzero weight
    let targetArmMass = 0;
    const nonTargetMap = new Map();
    for (let k = 0; k < 4; k++) {
      const bi = oldIdx.getComponent(i, k);
      const w = oldW.getComponent(i, k);
      if (w <= 0) continue;
      if (bi === targetArmIndex) {
        targetArmMass += w;
      } else {
        nonTargetMap.set(bi, (nonTargetMap.get(bi) || 0) + w);
      }
    }

    // Must have existing target-arm influence
    if (targetArmMass <= 1e-9) {
      continue;
    }

    // Project vertex along shoulder -> fixed paw
    const chain = isLeft ? chainL : chainR;
    vBind.set(x, y, z).applyMatrix4(mesh.bindMatrix);
    vRel.subVectors(vBind, chain.pShoulder);
    const t = chain.armLenSq > 1e-12 ? (vRel.dot(chain.armVec) / chain.armLenSq) : 0;

    // Smoothstep arm->forearm band [.40, .62], forearm->wrist [.78, .94]
    let f_shoulder = 0;
    let f_forearm = 0;
    let f_wrist = 0;

    if (t <= 0.40) {
      f_shoulder = 1.0;
    } else if (t < 0.62) {
      const u = smoothstep(0.40, 0.62, t);
      f_shoulder = 1.0 - u;
      f_forearm = u;
    } else if (t <= 0.78) {
      f_forearm = 1.0;
    } else if (t < 0.94) {
      const u = smoothstep(0.78, 0.94, t);
      f_forearm = 1.0 - u;
      f_wrist = u;
    } else {
      f_wrist = 1.0;
    }

    const nonTargetEntries = Array.from(nonTargetMap.entries());
    const nNonTarget = nonTargetEntries.length;

    let slots = [];
    let isHard = false;

    if (nNonTarget === 3) {
      // 3 non-target entries: map wholly to largest fraction (hard assignment)
      isHard = true;
      let chosenBone = shoulderIndex;
      let maxF = f_shoulder;
      if (f_forearm > maxF) {
        maxF = f_forearm;
        chosenBone = forearmIndex;
      }
      if (f_wrist > maxF) {
        maxF = f_wrist;
        chosenBone = wristIndex;
      }
      slots = [
        ...nonTargetEntries,
        [chosenBone, targetArmMass],
      ];
    } else {
      // <= 2 non-target entries: distribute to adjacent arm segments (smooth assignment)
      const armSlots = [];
      if (f_shoulder > 0) armSlots.push([shoulderIndex, targetArmMass * f_shoulder]);
      if (f_forearm > 0) armSlots.push([forearmIndex, targetArmMass * f_forearm]);
      if (f_wrist > 0) armSlots.push([wristIndex, targetArmMass * f_wrist]);
      slots = [
        ...nonTargetEntries,
        ...armSlots,
      ];
    }

    // Sort descending by weight, tie-break by bone index
    slots.sort((a, b) => b[1] - a[1] || a[0] - b[0]);

    let changed = false;
    for (let k = 0; k < 4; k++) {
      const bi = k < slots.length ? slots[k][0] : 0;
      const bw = k < slots.length ? slots[k][1] : 0;
      if (oldIdx.getComponent(i, k) !== bi || Math.abs(oldW.getComponent(i, k) - bw) > 1e-6) {
        changed = true;
      }
      newIdx.setComponent(i, k, bi);
      newW.setComponent(i, k, bw);
    }

    if (changed) {
      affectedVertexCount++;
      if (isHard) hardVertexCount++;
      else smoothVertexCount++;
    } else {
      unchangedVertexCount++;
    }
  }

  newIdx.needsUpdate = true;
  newW.needsUpdate = true;

  const stats = {
    version: 'runtimeOnly',
    oldJointCount: oldBones.length,
    newJointCount: derivedBones.length,
    affectedVertexCount,
    smoothVertexCount,
    hardVertexCount,
    unchangedVertexCount,
    affected: affectedVertexCount,
    smooth: smoothVertexCount,
    hard: hardVertexCount,
  };

  let active = false;
  let disposed = false;

  const activate = () => {
    if (disposed) return false;
    if (active) {
      if (mesh.geometry === derivedGeometry && mesh.skeleton === derivedSkeleton) {
        // Already active
        return true;
      }
      return false;
    }
    // Atomic ownership check: only swap if both still equal captured base pair
    if (mesh.geometry !== baseGeometry || mesh.skeleton !== baseSkeleton) {
      return false;
    }

    // Attach owned forearms under original arm bones, wrist under forearm
    if (chainL.forearmBone.parent !== originalArmL) {
      originalArmL.add(chainL.forearmBone);
    }
    if (chainL.wristBone.parent !== chainL.forearmBone) {
      chainL.forearmBone.add(chainL.wristBone);
    }
    if (chainR.forearmBone.parent !== originalArmR) {
      originalArmR.add(chainR.forearmBone);
    }
    if (chainR.wristBone.parent !== chainR.forearmBone) {
      chainR.forearmBone.add(chainR.wristBone);
    }

    // Atomically swap geometry and skeleton
    mesh.geometry = derivedGeometry;
    mesh.skeleton = derivedSkeleton;
    active = true;
    return true;
  };

  const deactivate = () => {
    if (!active) {
      // Inactive: ensure chains detached
      if (chainL.forearmBone.parent) chainL.forearmBone.parent.remove(chainL.forearmBone);
      if (chainR.forearmBone.parent) chainR.forearmBone.parent.remove(chainR.forearmBone);
      return true;
    }
    // Atomic ownership check: only restore if both still equal owned derived pair
    if (mesh.geometry !== derivedGeometry || mesh.skeleton !== derivedSkeleton) {
      return false;
    }

    // Detach new chains from original arm bones
    if (chainL.forearmBone.parent) chainL.forearmBone.parent.remove(chainL.forearmBone);
    if (chainR.forearmBone.parent) chainR.forearmBone.parent.remove(chainR.forearmBone);

    // Atomically restore base pair
    mesh.geometry = baseGeometry;
    mesh.skeleton = baseSkeleton;
    active = false;
    return true;
  };

  const resetJoints = () => {
    chainL.forearmBone.position.copy(chainL.restTransforms.forearm.position);
    chainL.forearmBone.quaternion.copy(chainL.restTransforms.forearm.quaternion);
    chainL.forearmBone.scale.copy(chainL.restTransforms.forearm.scale);
    chainL.forearmBone.updateMatrix();

    chainL.wristBone.position.copy(chainL.restTransforms.wrist.position);
    chainL.wristBone.quaternion.copy(chainL.restTransforms.wrist.quaternion);
    chainL.wristBone.scale.copy(chainL.restTransforms.wrist.scale);
    chainL.wristBone.updateMatrix();

    chainR.forearmBone.position.copy(chainR.restTransforms.forearm.position);
    chainR.forearmBone.quaternion.copy(chainR.restTransforms.forearm.quaternion);
    chainR.forearmBone.scale.copy(chainR.restTransforms.forearm.scale);
    chainR.forearmBone.updateMatrix();

    chainR.wristBone.position.copy(chainR.restTransforms.wrist.position);
    chainR.wristBone.quaternion.copy(chainR.restTransforms.wrist.quaternion);
    chainR.wristBone.scale.copy(chainR.restTransforms.wrist.scale);
    chainR.wristBone.updateMatrix();
  };

  const dispose = () => {
    if (active) {
      // If active and either/both current fields differ from owned derived pair, refuse
      if (mesh.geometry !== derivedGeometry || mesh.skeleton !== derivedSkeleton) {
        return false;
      }
      const deactivated = deactivate();
      if (!deactivated) {
        // Foreign takeover prevents restoration: do not clobber/dispose live resources
        return false;
      }
    }
    // Inactive handle may dispose its own unused resources safely, without touching whatever mesh fields currently belong to someone else.
    if (!disposed) {
      if (chainL.forearmBone.parent) chainL.forearmBone.parent.remove(chainL.forearmBone);
      if (chainR.forearmBone.parent) chainR.forearmBone.parent.remove(chainR.forearmBone);
      derivedGeometry.dispose();
      derivedSkeleton.dispose();
      disposed = true;
    }
    return true;
  };

  return {
    geometry: derivedGeometry,
    skeleton: derivedSkeleton,
    bonesBySide,
    stats,
    activate,
    deactivate,
    resetJoints,
    dispose,
    get active() { return active; },
    get disposed() { return disposed; },
  };
}
