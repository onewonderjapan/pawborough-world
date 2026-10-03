import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PlayAvatar} from '../scene-authoring/yuyuan-area/web/play/avatar.js';
import {sampleFoodPose,applyFoodPose,foodAnchorLocal} from '../scene-authoring/yuyuan-area/web/play/food-pose.js';
globalThis.self=globalThis; globalThis.createImageBitmap=async()=>({width:4,height:4,close(){}});
const bytes=await readFile(new URL('../scene-authoring/yuyuan-area/resources/characters/gray-cat/character.glb',import.meta.url));
const g=await new Promise((ok,no)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',ok,no));
const avatar=new PlayAvatar({gltfScene:g.scene,animations:g.animations});
const node=(parent,name,pos)=>{const o=new T.Object3D();o.name=name;o.position.fromArray(pos);parent.add(o);return o;};
function proxy(profile,utensilKind){
 const root=new T.Group(),edible=new T.Mesh(new T.SphereGeometry(.04),new T.MeshStandardMaterial());root.add(edible);root.userData.foodPoseProfile=profile;
 const parts={edible},anchors={};
 if(profile==='wrapped'){
  parts.wrapper=new T.Group();root.add(parts.wrapper);
  for(const [id,p] of Object.entries({leftSupport:[.075,0,0],rightSupport:[-.075,0,0],bite:[0,.085,.030]}))anchors[id]=node(root,id,p);
 } else if(profile==='skewer'){
  parts.skewer=new T.Group();root.add(parts.skewer);
  for(const [id,p]of Object.entries({leftSupport:[.015,-.035,0],rightSupport:[-.015,-.025,0],bite:[0,.115,.021]}))anchors[id]=node(root,id,p);
 }else{
  parts.container=new T.Group();parts.utensil=new T.Group();root.add(parts.container,parts.utensil);
  anchors.leftSupport=node(root,'leftSupport',[.07,0,-.03]);anchors.content=node(root,'content',[0,.018,0]);
  anchors.toolGrip=node(parts.utensil,'toolGrip',[0,0,0]);anchors.toolBite=node(parts.utensil,'toolBite',[0,0,.11]);
 }
 avatar.model.add(root);
 return {root,parts,anchors,presentation:{profile,utensilKind},setBiteProgress(p){edible.scale.setScalar(1-.75*p);}};
}
assert.ok(sampleFoodPose({profile:'cupped'}).legacyCupped);
assert.equal(sampleFoodPose({profile:'bowl',rig:{mouth:new T.Vector3()},anchors:{},presentation:{utensilKind:'spoon'}}).ok,false);
for(const [profile,utensilKind]of [['wrapped'],['skewer'],['bowl','spoon'],['bowl','chopsticks'],['bowl','skewer']]){
 const instance=proxy(profile,utensilKind);avatar.setHoldingPose(true);
 if(profile==='bowl'){const a=Object.fromEntries(Object.entries(instance.anchors).map(([k,v])=>[k,foodAnchorLocal(v,k.startsWith('tool')?instance.parts.utensil:instance.root)]));const carry=sampleFoodPose({profile,t:0,rig:{mouth:avatar.getFoodMouth()},anchors:a,presentation:{utensilKind,eating:false}});assert.equal(carry.mouthfulVisible,false,'idle bowl has no loose bite at tool tip');}
 let bowlPosition=null;
 for(const t of [0,.4,.8,1.1,1.5,1.8,2.5,3.2]){
  avatar.setEatingPose(true,t);avatar.update({feet:[3,.06,-2],yaw:.7,moving:false,paused:false,dt:0});
  const bonePositions=['armL','armR'].map(n=>avatar.model.getObjectByName(n).position.clone());
  const anchors=Object.fromEntries(Object.entries(instance.anchors).map(([k,v])=>[k,foodAnchorLocal(v,k.startsWith('tool')?instance.parts.utensil:instance.root)]));
  const targets=sampleFoodPose({profile,t,rig:{mouth:avatar.getFoodMouth()},anchors,presentation:{...instance.presentation,eating:true}});
  assert.ok(targets.ok,`${profile} sample`);
  const result=applyFoodPose(avatar,instance,targets);
  console.log(profile,utensilKind??'',t,JSON.stringify(Object.fromEntries(Object.entries(result.contacts??{}).map(([k,v])=>[k,+v.gap.toFixed(5)]))));
  assert.ok(result.ok,`${profile} ${utensilKind??''} t=${t}: ${JSON.stringify(result.contacts)}`);
  const repeated=sampleFoodPose({profile,t,rig:{mouth:avatar.getFoodMouth()},anchors,presentation:{...instance.presentation,eating:true}});
  assert.ok(repeated.position.distanceTo(targets.position)<1e-9,'game-time sample is deterministic during pause');
  for(const side of ['armL','armR'])assert.ok(avatar.getFoodPalm(side).distanceTo(targets.palms[side])<=.03);
  if(t>=.8&&t<=1.8)assert.ok(targets.bite.distanceTo(avatar.getFoodMouth())<=.025);
  if(profile==='bowl'){
   bowlPosition??=instance.root.position.clone();assert.ok(instance.root.position.distanceTo(bowlPosition)<=.004);
   const actualTip=avatar.model.worldToLocal(instance.anchors.toolBite.getWorldPosition(new T.Vector3()));
   assert.ok(actualTip.distanceTo(targets.bite)<1e-6);
  }
  for(const [name,part]of Object.entries(instance.parts))if(name!=='edible')assert.deepEqual(part.scale.toArray(),[1,1,1]);
  assert.ok(avatar._bodyMesh.skeleton.bones.every(b=>b.quaternion.toArray().every(Number.isFinite)));
  for(let i=0;i<2;i++)assert.ok(avatar.model.getObjectByName(i?'armR':'armL').position.distanceTo(bonePositions[i])<1e-8,'profile must preserve source animation shoulder translations');
 }
 instance.root.removeFromParent();avatar.setEatingPose(false);avatar.setHoldingPose(false);
}
avatar.dispose();console.log('PLAY_FOOD_PROFILES PASS');
