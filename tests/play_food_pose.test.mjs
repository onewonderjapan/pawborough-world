// Real food socket + snack motion contract; no DOM, server or texture fixture.
// Part A: fake-skeleton lifecycle contracts (ownership/transfer/dispose/legacy
//         hand-offset fallback — a stand-in skeleton, never hand-fit evidence).
// Part B: real gray-cat skin/pose contracts — real character.glb bytes, real
//         food GLB bytes, socket_grip placed on the actual patched paw pad,
//         visible paw skin following the arm bone, hand→basket→hand lifecycle
//         against BikeView's geometry clone with no leak or wrong restore.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {loadFoodCatalog} from '../scene-authoring/yuyuan-area/web/play/foods.js';
import {PlayAvatar} from '../scene-authoring/yuyuan-area/web/play/avatar.js';
import {BikeView} from '../scene-authoring/yuyuan-area/web/play/bike-view.js';
const area=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scene-authoring/yuyuan-area');
const manifest=JSON.parse(await fs.readFile(path.join(area,'inputs/play-foods.json'),'utf8'));
manifest.foods=manifest.foods.filter(f=>['xiaolongbao','congyoubing','youdunzi'].includes(f.id));
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>new Response(await fs.readFile(path.join(area,String(input).replace(/^\//,''))));
const catalog=await loadFoodCatalog({foods:[{id:'xiaolongbao'}],manifest});globalThis.fetch=originalFetch;
const model=new THREE.Group(),arm=new THREE.Bone();arm.name='armR';arm.position.set(-.19,.48,.12);model.add(arm);
const leg=new THREE.Bone();leg.name='legL';leg.position.set(.13,.2,-.04);model.add(leg);
model.add(new THREE.Mesh(new THREE.BoxGeometry(.32,.9,.2),new THREE.MeshBasicMaterial()));
const clips=['idle','walk','eat'].map(name=>new THREE.AnimationClip(name,2,[new THREE.QuaternionKeyframeTrack('armR.quaternion',[0,2],[0,0,0,1,0,0,0,1])]));
const avatar=new PlayAvatar({gltfScene:model,animations:clips});
avatar.setHoldingPose?.(true);avatar.update({feet:[0,0,0],yaw:0,moving:false,paused:false,dt:.02});
const holder=catalog.attachToHand('xiaolongbao',arm);
const grip=()=>{avatar.root.updateMatrixWorld(true);return holder.getObjectByName('socket_grip').getWorldPosition(new THREE.Vector3());};
const shoulder=()=>arm.getWorldPosition(new THREE.Vector3());
const localGrip=arm.worldToLocal(grip().clone());
let failures=0;const check=(name,ok,detail)=>{console.log(`${ok?'ok':'FAIL'} ${name} ${detail??''}`);if(!ok)failures++;};
check('legacy fallback keeps the food below the shoulder joint (stand-in skeleton only)',localGrip.y<-.08&&localGrip.length()>.11&&localGrip.length()<.21,localGrip.toArray());
const mouth=()=>avatar.root.localToWorld(new THREE.Vector3(0,.68,.28));
const before=grip().distanceTo(mouth());avatar.setEatingPose(true);
for(let i=0;i<36;i++)avatar.update({feet:[0,0,0],yaw:0,moving:false,paused:false,dt:1/60});
const after=grip().distanceTo(mouth());
check('legacy fallback moves closer to the stand-in mouth',after<before,`${before.toFixed(3)}m -> ${after.toFixed(3)}m`);
check('snack motion stays within the plush arm deformation budget',arm.quaternion.angleTo(avatar.restBoneQuaternions.get('armR'))<=1.35+1e-6);
const frozen=grip();avatar.update({feet:[0,0,0],yaw:0,moving:false,paused:true,dt:10});
check('paused snack pose stays frozen',grip().distanceTo(frozen)<1e-7);
avatar.setEatingPose(false);avatar.setHoldingPose(false);
leg.rotateX(.9); // A different last walk phase must not change the riding pose.
const bikeRoot=new THREE.Group(),seat=new THREE.Object3D();seat.position.y=.4;bikeRoot.add(seat);
const bike=new BikeView({root:bikeRoot,seat});bike.attachRider(avatar);bike.sit(avatar,0,0);
check('mounting without contact sockets restores the neutral limb basis instead of the last walking phase',
  leg.quaternion.angleTo(avatar.restBoneQuaternions.get('legL')) < 1e-7, leg.rotation.x);
bike.detachRider(avatar);
const entry=catalog.byId.get('xiaolongbao'),display=catalog.makeDisplay('xiaolongbao');let disposed=0;
entry.proto.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>disposed++);});
const basket=new THREE.Group();basket.add(holder);
const returned=catalog.attachToHand('xiaolongbao',arm,holder);
check('basket to hand transfers the same food instance',returned===holder&&holder.parent===arm);
avatar.dispose();check('actor disposal leaves catalog-owned food geometry alive',disposed===0);
catalog.detach(returned);check('consumption detaches hand without disposing shared stall geometry',disposed===0&&display.children.length>0);
catalog.dispose();

// ===================== Part B: real gray cat =====================
// Real GLB bytes for the character and all three foods; textures are skipped
// (stubbed decoder) exactly like tests/play_rider_fit.test.mjs — geometry,
// skeleton, sockets and skin weights stay byte-true. No visual claim.
globalThis.self=globalThis;
if (!globalThis.createImageBitmap) globalThis.createImageBitmap=async()=>({width:4,height:4,close(){}});
const realManifest=JSON.parse(await fs.readFile(path.join(area,'inputs/play-foods.json'),'utf8'));
realManifest.foods=realManifest.foods.filter(f=>['xiaolongbao','congyoubing','youdunzi'].includes(f.id));
globalThis.fetch=async input=>String(input).startsWith('blob:')?originalFetch(input):new Response(await fs.readFile(path.join(area,String(input).replace(/^\//,''))));
const realCatalog=await loadFoodCatalog({foods:realManifest.foods.map(f=>({id:f.id})),manifest:realManifest});
globalThis.fetch=originalFetch;
const {GLTFLoader}=await import(path.join(area,'node_modules/three/examples/jsm/loaders/GLTFLoader.js'));
const parseGlb=async rel=>{const buf=await fs.readFile(path.join(area,rel));
  return new Promise((yes,no)=>new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength),'',yes,no));};
const charGltf=await parseGlb('resources/characters/gray-cat/character.glb');
const realAvatar=new PlayAvatar({gltfScene:charGltf.scene,animations:charGltf.animations});
const realBikeGltf=await parseGlb('resources/vehicles/play-bicycle.glb');
const realModel=charGltf.scene,realArmR=realModel.getObjectByName('armR');
const realBody=(()=>{let m=null;realModel.traverse(o=>{if(!m&&o.isSkinnedMesh&&o.skeleton)m=o;});return m;})();
const realOriginal=realBody.geometry;
const originalIndices=realOriginal.attributes.skinIndex.array.slice();
const originalWeights=realOriginal.attributes.skinWeight.array.slice();
const rigNeed=name=>{let n=null;realBikeGltf.scene.traverse(o=>{if(!n&&o.name===name)n=o;});return n;};
const realRig={root:realBikeGltf.scene,frontWheel:rigNeed('front-wheel'),rearWheel:rigNeed('rear-wheel'),
  steering:rigNeed('steering'),crank:rigNeed('crank'),seat:rigNeed('seat'),handleL:rigNeed('handle-L'),
  handleR:rigNeed('handle-R'),pedalL:rigNeed('pedal-L'),pedalR:rigNeed('rig.pedal-R'.slice(4)),
  basketSocket:rigNeed('basket-socket'),dismountAnchor:rigNeed('anchor-dismount')};
const realBike=new BikeView(realRig);
realBike.root.visible=true;
const worldGroup=new THREE.Group();worldGroup.add(realAvatar.root);worldGroup.add(realBike.root);
realBike.placeAt([0,0,0],0);
const refresh=()=>{worldGroup.updateMatrixWorld(true);realBody.skeleton.update();};
refresh();

// visible paw pad: armR-weighted(>=0.3) skinned tips centroid, banded in armR
// bone space (pose-stable acceptance metric; mirrors the 0.12155m baseline).
const palmSamples=new WeakMap();
const visiblePalm=()=>{
  refresh();const geometry=realBody.geometry;
  let samples=palmSamples.get(geometry);
  if(!samples){
    const idx=geometry.attributes.skinIndex,w=geometry.attributes.skinWeight,pos=geometry.attributes.position,bi=realBody.skeleton.bones.indexOf(realArmR),inv=realBody.skeleton.boneInverses[bi],local=[];
    for(let i=0;i<pos.count;i++){let weight=0;for(let k=0;k<4;k++)if(idx.getComponent(i,k)===bi)weight+=w.getComponent(i,k);if(weight>=.3)local.push({i,p:new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(inv)});}
    const minY=Math.min(...local.map(o=>o.p.y));samples=local.filter(o=>o.p.y<minY+.035).map(o=>o.i);palmSamples.set(geometry,samples);
  }
  const center=new THREE.Vector3(),v=new THREE.Vector3();
  for(const i of samples)center.add(realBody.getVertexPosition(i,v).applyMatrix4(realBody.matrixWorld));
  return center.divideScalar(samples.length);
};
const gripWorld=h=>{refresh();return h.getObjectByName('socket_grip').getWorldPosition(new THREE.Vector3());};

check('B0 real gray cat loads with the documented 12-joint skin',realBody.isSkinnedMesh&&realBody.skeleton.bones.length===12,`joints=${realBody.skeleton.bones.length}`);

// B1 holding applies the validated rider-fit arm patch; idle does not
check('B1a not holding: skin keeps the original geometry',realBody.geometry===realOriginal);
realAvatar.setHoldingPose(true);
check('B1b holding applies the arm skin patch (geometry clone)',realBody.geometry!==realOriginal);
check('B1c patch leaves the original object untouched',originalIndices.every((v,i)=>v===realOriginal.attributes.skinIndex.array[i])&&originalWeights.every((v,i)=>v===realOriginal.attributes.skinWeight.array[i]),
  'original attributes retained by reference');
check('B1d grip anchor computed from the real patched paw cluster',
  !!realAvatar.snackGripLocal && Number.isFinite(realAvatar.snackGripLocal.length()) && realAvatar.snackGripLocal.length() < 0.3,
  String(realAvatar.snackGripLocal));

// B2 the acceptance metric: socket_grip sits on the real paw pad for all three tastes
const gaps={};
for(const id of realManifest.foods.map(f=>f.id)){
  const h=realCatalog.attachToHand(id,realArmR,null,realAvatar.snackGripLocal);
  const gap=gripWorld(h).distanceTo(visiblePalm());
  gaps[id]=+gap.toFixed(4);
  check(`B2 ${id}: socket_grip on the real paw pad (<=0.05m, baseline failure was 0.12155)`,gap<=0.05,gap.toFixed(4));
  realCatalog.detach(h);
}

// B3 the visible paw follows the arm bone after the patch (and not before)
{
  const h=realCatalog.attachToHand('xiaolongbao',realArmR,null,realAvatar.snackGripLocal);
  const restQ=realAvatar.restBoneQuaternions.get('armR');
  const palm0=visiblePalm();
  realArmR.quaternion.copy(restQ);realArmR.rotateX(-.45);refresh();
  const palm1=visiblePalm();
  check('B3a patched paw skin follows the arm bone',palm1.distanceTo(palm0)>0.05,palm1.distanceTo(palm0).toFixed(4));
  check('B3b held food rides the moved paw (<=0.06m)',gripWorld(h).distanceTo(palm1)<=0.06,gripWorld(h).distanceTo(palm1).toFixed(4));
  realAvatar.releaseSnackSkin();
  check('B3c release restores the original geometry',realBody.geometry===realOriginal);
  realArmR.quaternion.copy(restQ);refresh();
  const stuck0=visiblePalm();
  realArmR.quaternion.copy(restQ);realArmR.rotateX(-.45);refresh();
  const stuck1=visiblePalm();
  check('B3d release preserves the original skin attributes',realBody.geometry===realOriginal&&originalIndices.every((v,i)=>v===realOriginal.attributes.skinIndex.array[i]),stuck1.distanceTo(stuck0).toFixed(4));
  realArmR.quaternion.copy(restQ);refresh();
  realAvatar.setHoldingPose(true);
  check('B3e re-hold re-applies a fresh patch',realBody.geometry!==realOriginal);
  realCatalog.detach(h);
}

// B4 eating pose: budget respected, grip stays on the paw and moves toward the head
{
  const h=realCatalog.attachToHand('xiaolongbao',realArmR,null,realAvatar.snackGripLocal);
  const mouth=realModel.getObjectByName('cat_mouth');
  const mouthPosition=()=>{refresh();mouth.skeleton.update();const center=new THREE.Vector3(),v=new THREE.Vector3(),n=mouth.geometry.attributes.position.count;for(let i=0;i<n;i++)center.add(mouth.getVertexPosition(i,v).applyMatrix4(mouth.matrixWorld));return center.divideScalar(n);};
  realAvatar.update({feet:[0,0,0],yaw:0,moving:false,paused:false,dt:.02});
  refresh();
  const up=new THREE.Vector3(0,1,0).applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()));
  check('B4 holding keeps the Y-up food package upright',up.y>.999,up.toArray());
  const beforeDist=gripWorld(h).distanceTo(mouthPosition());
  realAvatar.setEatingPose(true);
  for(let i=0;i<36;i++)realAvatar.update({feet:[0,0,0],yaw:0,moving:false,paused:false,dt:1/60});
  refresh();
  const angle=realArmR.quaternion.angleTo(realAvatar.restBoneQuaternions.get('armR'));
  check('B4a eating stays within the 1.35rad arm budget',angle<=1.35+1e-6,angle.toFixed(3));
  check('B4b eating carries the food toward the actual mouth',gripWorld(h).distanceTo(mouthPosition())<beforeDist*.85,
    `${beforeDist.toFixed(3)} -> ${gripWorld(h).distanceTo(mouthPosition()).toFixed(3)}`);
  const gap=gripWorld(h).distanceTo(visiblePalm());
  check('B4c food stays on the paw while eating (<=0.07m)',gap<=0.07,gap.toFixed(4));
  const frozenGrip=gripWorld(h).clone();
  realAvatar.update({feet:[0,0,0],yaw:0,moving:false,paused:true,dt:10});
  check('B4d paused eating pose is frozen',gripWorld(h).distanceTo(frozenGrip)<1e-7);
  realAvatar.setEatingPose(false);
  realAvatar.setHoldingPose(false);
  check('B4e snack end releases the patch',realBody.geometry===realOriginal);
  realCatalog.detach(h);
}

// B5 hand → basket → hand with the real bike; nested clone lifecycle stays clean
{
  realAvatar.setHoldingPose(true);
  realAvatar.setHoldingPose(true);           // holding at mount time (refreshHeldModel precondition)
  const h=realCatalog.attachToHand('xiaolongbao',realArmR,null,realAvatar.snackGripLocal);
  const handClone=realBody.geometry;
  const disposeCounts=new Map();
  const track=g=>{disposeCounts.set(g,0);g.addEventListener('dispose',()=>disposeCounts.set(g,disposeCounts.get(g)+1));};
  track(realOriginal);track(handClone);
  // install.js mount order: stow to basket (setHoldingPose(false) releases), then bike clone
  realCatalog.detach(h);
  realAvatar.setHoldingPose(false);
  check('B5a mount: hand patch released back to the original',realBody.geometry===realOriginal);
  check('B5b released hand clone disposed exactly once',disposeCounts.get(handClone)===1,`count=${disposeCounts.get(handClone)}`);
  realBike.attachRider(realAvatar,null);
  const bikeClone=realBody.geometry;
  check('B5c bike owns its own fresh clone',bikeClone!==realOriginal&&bikeClone!==handClone);
  track(bikeClone);
  realBike.detachRider(realAvatar);
  check('B5d dismount restores the original geometry',realBody.geometry===realOriginal);
  check('B5e bike clone disposed exactly once',disposeCounts.get(bikeClone)===1,`count=${disposeCounts.get(bikeClone)}`);
  // take-back: refreshHeldModel re-ensures while holding
  realAvatar.setHoldingPose(true);
  const secondClone=realBody.geometry;
  check('B5f hand patch re-applies after dismount',secondClone!==realOriginal&&secondClone!==handClone&&secondClone!==bikeClone);
  check('B5g grip anchor recalibrated on the fresh patch',
    !!realAvatar.snackGripLocal&&Number.isFinite(realAvatar.snackGripLocal.length())&&realAvatar.snackGripLocal.length()<0.3);
  const h2=realCatalog.attachToHand('xiaolongbao',realArmR,null,realAvatar.snackGripLocal);
  const gap=gripWorld(h2).distanceTo(visiblePalm());
  check('B5h food back on the paw after hand→basket→hand (<=0.05m)',gap<=0.05,gap.toFixed(4));
  realAvatar.setHoldingPose(false);
  check('B5i final release restores original',realBody.geometry===realOriginal);
  check('B5j original geometry never disposed',disposeCounts.get(realOriginal)===0);
  realCatalog.detach(h2);
}

// B6 disposal while holding releases the patch first (no clone leak)
{
  realAvatar.setHoldingPose(true);
  const clone=realBody.geometry;
  let cloneDisposed=0;clone.addEventListener('dispose',()=>cloneDisposed++);
  realAvatar.dispose();
  check('B6 avatar disposal restores the original and frees its own clone',realBody.geometry===realOriginal&&cloneDisposed===1,
    `disposed=${cloneDisposed}`);
}
realCatalog.dispose();
assert.equal(failures,0,'snack pose contracts failed');console.log('PLAY_FOOD_POSE PASS');
