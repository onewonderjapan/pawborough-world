// Real new GLBs including separate spoon/chopsticks, anchors and owned instances.
import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';import * as T from'three';
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{PlayAvatar}from'../scene-authoring/yuyuan-area/web/play/avatar.js';
import{makeFoodEntry,FoodCatalog}from'../scene-authoring/yuyuan-area/web/play/foods.js';import{sampleFoodPose,applyFoodPose,foodAnchorLocal}from'../scene-authoring/yuyuan-area/web/play/food-pose.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:4,height:4,close(){}});
const area=new URL('../scene-authoring/yuyuan-area/',import.meta.url);
const load=async path=>{const b=await readFile(new URL(path,area));return new Promise((ok,no)=>new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,no));};
const cg=await load('resources/characters/gray-cat/character.glb'),avatar=new PlayAvatar({gltfScene:cg.scene,animations:cg.animations});
const assets=JSON.parse(await readFile(new URL('inputs/play-foods.json',area),'utf8'));
for(const [id,profile,utensilKind]of [['roujiamo','wrapped'],['tanghulu','skewer'],['shuangpinai','bowl','spoon'],['reganmian','bowl','chopsticks']]){
 const asset=assets.foods.find(f=>f.id===id);assert.ok(asset,'actual asset input declared');
 const g=await load(asset.path),entry=makeFoodEntry({id,poseProfile:profile,utensilKind},g.scene),catalog=new FoodCatalog(new Map([[id,entry]]));
 const holder=catalog.attachToHands(id,avatar.model),instance=holder.foodInstance;assert.ok(instance);
 const display=catalog.makeDisplay(id);assert.ok(Math.abs(new T.Box3().setFromObject(display).min.y)<1e-6,'new meal display bottom rests on tray plane');
 assert.ok(instance.parts.edible);if(profile==='bowl'){assert.ok(instance.parts.container);assert.ok(instance.parts.utensil.getObjectByName('toolFood'));}
 avatar.setHoldingPose(true);
 for(const t of [0,.4,.8,1.1,1.5,1.8,2.5,3.2]){
  avatar.setEatingPose(true,t);avatar.update({feet:[4,.06,-3],yaw:1.2,moving:false,paused:false,dt:0});
  const anchors=Object.fromEntries(Object.entries(instance.anchors).map(([k,a])=>[k,foodAnchorLocal(a,k.startsWith('tool')?instance.parts.utensil:holder)]));
  const target=sampleFoodPose({profile,t,anchors,rig:{mouth:avatar.getFoodMouth()},presentation:{...instance.presentation,eating:true}}),result=applyFoodPose(avatar,instance,target);assert.ok(result.ok,`${id}@${t} ${JSON.stringify(result.contacts)}`);
  if(t>=.8&&t<=1.8){assert.ok(target.bite.distanceTo(avatar.getFoodMouth())<=.025);assert.deepEqual(instance.parts.edible.scale.toArray(),[1,1,1],'actual edible stays at contact geometry through bite');}
  if(profile==='bowl'){const tip=avatar.model.worldToLocal(instance.anchors.toolBite.getWorldPosition(new T.Vector3()));assert.ok(tip.distanceTo(target.bite)<1e-6);assert.deepEqual(holder.position.toArray(),[.015,.38,.33]);}
  for(const [name,part]of Object.entries(instance.parts))if(name!=='edible')assert.deepEqual(part.scale.toArray(),[1,1,1]);
 }
 const original=holder.uuid;catalog.detach(holder);const basket=new T.Group();basket.add(holder);assert.equal(holder.uuid,original);catalog.attachToHands(id,avatar.model,holder);assert.equal(holder.uuid,original);
 catalog.detach(holder);avatar.setEatingPose(false);avatar.setHoldingPose(false);assert.equal(avatar._bodyMesh.skeleton.bones.length,12);assert.equal(avatar.model.getObjectByName('armL_forearm'),undefined);
 catalog.dispose();console.log('PASS actual meal',id,utensilKind??profile);
}
avatar.dispose();console.log('ACTUAL_FOOD_MEALS PASS');
