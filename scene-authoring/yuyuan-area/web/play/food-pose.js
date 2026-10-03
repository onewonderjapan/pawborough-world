// Absolute game-time targets. Anchors and contacts are in avatar.model metres.
import * as T from 'three';
import { solveFoodArm } from './food-arm-ik.js';
const clamp = v => Math.max(0, Math.min(1, v));
const ease = v => { const x = clamp(v); return x*x*(3-2*x); };
const vec = v => v?.isVector3 ? v.clone() : Array.isArray(v) ? new T.Vector3(...v) : null;
const finite = v => v?.toArray().every(Number.isFinite);

export function foodAnchorLocal(anchor, owner) {
  if (anchor?.isObject3D) {
    owner.updateWorldMatrix(true, true);
    return owner.worldToLocal(anchor.getWorldPosition(new T.Vector3()));
  }
  return vec(anchor);
}
export function sampleFoodPose({profile, t=0, rig={}, anchors={}, presentation={}}={}) {
  const id = typeof profile === 'string' ? profile : profile?.id;
  if (id === 'cupped') return { ok:true, legacyCupped:true, profile:id };
  if (!['wrapped','skewer','bowl'].includes(id)) return {ok:false,reason:'unknown-profile'};
  const mouth = vec(rig.mouth);
  if (!finite(mouth) || !Number.isFinite(t)) return {ok:false,reason:'invalid-mouth-time'};
  const elapsed = Math.max(0,t);
  const lift = presentation.eating
    ? elapsed < .8 ? ease(elapsed/.8) : elapsed <= 1.8 ? 1 : 1-ease((elapsed-1.8)/1.4)
    : 0;
  const biteProgress = presentation.eating ? ease((elapsed-1.8)/1.4) : 0;
  const front = mouth.clone().add(new T.Vector3(0,0,.006));
  const left = vec(anchors.leftSupport), right = vec(anchors.rightSupport), bite = vec(anchors.bite);
  if (!finite(left)) return {ok:false,reason:'missing-left-support'};
  const rotation = new T.Quaternion(), position = new T.Vector3();
  const out = {ok:true,profile:id,lift,biteProgress,rotation,position,palms:{},mouth:front,
    mouthfulVisible:Boolean(presentation.eating)&&elapsed<1.4};
  const isRefinedPortion = presentation.containerKind === 'shallowPlate' || presentation.portionMode === 'selected';
  out.isRefinedPortion = isRefinedPortion;
  out.containerKind = presentation.containerKind ?? null;
  out.portionMode = presentation.portionMode ?? null;
  out.selectedPortionName = presentation.selectedPortionName ?? 'rice-piece-0';

  if (isRefinedPortion) {
    if (!presentation.eating) {
      out.selectedPieceVisible = true;
      out.toolFoodVisible = false;
      out.mouthfulVisible = false;
      out.portionTransferred = false;
    } else {
      // Transfer is irreversible for this bite, including the lowering phase.
      const transfer = elapsed >= 0.4;
      out.portionTransferred = transfer;
      out.selectedPieceVisible = !transfer;
      out.toolFoodVisible = transfer && biteProgress < 0.8 && elapsed < 2.5;
      out.mouthfulVisible = out.toolFoodVisible;
    }
  }

  if (id !== 'bowl') {
    if (!finite(right) || !finite(bite)) return {ok:false,reason:'missing-food-anchors'};
    rotation.setFromEuler(new T.Euler(id==='wrapped'?.25:.65,0,id==='skewer'?-.06:0));
    const neutral = new T.Vector3(id==='skewer'?.01:0,mouth.y-(id==='wrapped'?.20:.18),mouth.z-(id==='wrapped'?.035:.09));
    const lifted = front.clone().sub(bite.clone().applyQuaternion(rotation));
    position.copy(neutral).lerp(lifted,lift);
    out.palms.armL = left.applyQuaternion(rotation).add(position);
    out.palms.armR = right.applyQuaternion(rotation).add(position);
    out.bite = bite.applyQuaternion(rotation).add(position);
  } else {
    const content = vec(anchors.content), grip = vec(anchors.toolGrip), tip = vec(anchors.toolBite);
    if (![content,grip,tip].every(finite) || !['spoon','chopsticks','skewer'].includes(presentation.utensilKind)) return {ok:false,reason:'missing-tool-anchors'};
    position.set(.015,.38,.33);
    if (presentation.containerKind === 'shallowPlate' && Number.isFinite(presentation.plateHeight)) {
      position.y = presentation.plateHeight;
    }
    const pitch = presentation.containerKind === 'shallowPlate' && Number.isFinite(presentation.platePitch)
      ? Math.max(-0.08, Math.min(0.08, presentation.platePitch))
      : 0;
    if (pitch !== 0) {
      rotation.setFromEuler(new T.Euler(pitch, 0, 0));
    }
    out.palms.armL = left.clone().applyQuaternion(rotation).add(position);
    const axis = tip.clone().sub(grip);
    if (axis.length() < .01) return {ok:false,reason:'invalid-tool-length'};
    const tipTarget = content.applyQuaternion(rotation).add(position).lerp(front,lift);
    const direction = new T.Vector3(.82,.36,.45).normalize().lerp(new T.Vector3(.70,.70,.35).normalize(),lift).normalize();
    const toolRotation = new T.Quaternion().setFromUnitVectors(axis.normalize(),direction);
    const toolPosition = tipTarget.clone().sub(tip.clone().applyQuaternion(toolRotation));
    out.tool = {position:toolPosition,rotation:toolRotation};
    out.palms.armR = grip.applyQuaternion(toolRotation).add(toolPosition);
    out.bite = tipTarget;
  }
  return out;
}

export function applyFoodPose(avatar, instance, targets) {
  if (!targets?.ok || targets.legacyCupped) return {ok:!!targets?.legacyCupped,contacts:null,reason:targets?.reason};
  avatar._restoreSnackArm();
  const rig = avatar.ensureFoodArmRig();
  if (!rig || !instance?.root || instance.root.parent !== avatar.model) return {ok:false,reason:'missing-rig-or-model-parent'};
  if (targets.tool && !instance.parts?.utensil) return {ok:false,reason:'missing-utensil'};
  rig.resetJoints();
  avatar._cupBase = Object.values(rig.bonesBySide).map(({shoulder}) => ({arm:shoulder,q:shoulder.quaternion.clone(),p:shoulder.position.clone()}));
  // Absolute shoulder basis avoids mixing a previous overlay into this frame.
  for (const {shoulder} of Object.values(rig.bonesBySide)) shoulder.quaternion.copy(avatar.restBoneQuaternions.get(shoulder.name));
  instance.root.position.copy(targets.position); instance.root.quaternion.copy(targets.rotation);
  if (targets.tool) {
    const tool = instance.parts.utensil;
    if (tool.parent !== instance.root) return {ok:false,reason:'utensil-must-be-root-child'};
    tool.position.copy(targets.tool.position).sub(targets.position).applyQuaternion(targets.rotation.clone().invert());
    tool.quaternion.copy(targets.rotation.clone().invert().multiply(targets.tool.rotation));
  }
  const contacts = {};
  for (const side of ['armL','armR']) contacts[side] = solveFoodArm(avatar,side,targets.palms[side]);
  instance.setBiteProgress?.(targets.biteProgress);
  const morsel = instance.parts.utensil?.getObjectByName('toolFood');
  if (targets.isRefinedPortion || instance.refinedActive) {
    const portionName = targets.selectedPortionName ?? instance.selectedPortionName ?? 'rice-piece-0';
    const selectedPiece = instance.parts?.selectedPiece ?? instance.parts?.edible?.getObjectByName(portionName);
    if (selectedPiece) {
      selectedPiece.visible = Boolean(targets.selectedPieceVisible);
      if (morsel) morsel.visible = Boolean(targets.toolFoodVisible);
    } else {
      if (morsel) morsel.visible = targets.mouthfulVisible;
    }
  } else {
    if (morsel) morsel.visible = targets.mouthfulVisible;
  }
  avatar.root.updateMatrixWorld(true);
  return {ok:Object.values(contacts).every(v=>Number.isFinite(v.gap)&&v.gap<=.03),contacts,targets};
}
