// Geometry/ownership contracts for the actual three snacks and gray-cat skin.
// Texture stub is for Node geometry only; real GPU screenshots are separate.
import assert from 'node:assert/strict';import fs from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';import * as T from'three';
import{loadFoodCatalog}from'../scene-authoring/yuyuan-area/web/play/foods.js';import{PlayAvatar}from'../scene-authoring/yuyuan-area/web/play/avatar.js';
const A=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scene-authoring/yuyuan-area');globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:4,height:4,close(){}});
const mf=JSON.parse(await fs.readFile(A+'/inputs/play-foods.json','utf8')),fetchOriginal=fetch;
globalThis.fetch=async x=>String(x).startsWith('blob:')?fetchOriginal(x):new Response(await fs.readFile(A+'/'+String(x).replace(/^\//,'')));
const catalog=await loadFoodCatalog({foods:mf.foods,manifest:mf});globalThis.fetch=fetchOriginal;
const{GLTFLoader}=await import(A+'/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),bytes=await fs.readFile(A+'/resources/characters/gray-cat/character.glb');
const g=await new Promise((ok,no)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',ok,no));
const avatar=new PlayAvatar({gltfScene:g.scene,animations:g.animations}),body=g.scene.getObjectByName('cat_body'),mouth=g.scene.getObjectByName('cat_mouth'),original=body.geometry,originalWeights=original.attributes.skinWeight.array.slice();
const refresh=()=>{avatar.root.updateMatrixWorld(true);body.skeleton.update();mouth.skeleton.update();};
const sampleIds=name=>{const bi=body.skeleton.bones.findIndex(b=>b.name===name),inv=body.skeleton.boneInverses[bi],geo=body.geometry,points=[],v=new T.Vector3();for(let i=0;i<geo.attributes.position.count;i++){let w=0;for(let k=0;k<4;k++)if(geo.attributes.skinIndex.getComponent(i,k)===bi)w+=geo.attributes.skinWeight.getComponent(i,k);v.fromBufferAttribute(geo.attributes.position,i).applyMatrix4(inv);if(w>=.3&&v.length()>.13)points.push({i,y:v.y});}const min=Math.min(...points.map(p=>p.y));return points.filter(p=>p.y<=min+.035).map(p=>p.i);};
const point=(mesh,ids)=>{const c=new T.Vector3(),v=new T.Vector3();for(const i of ids)c.add(mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld));return c.divideScalar(ids.length);};
const step=(dt=1/60,paused=false,yaw=0,moving=false)=>avatar.update({feet:[3,.06,-2],yaw,moving,paused,dt});
for(const [id,width]of Object.entries({xiaolongbao:.18,congyoubing:.22,youdunzi:.18})){
 const entry=catalog.byId.get(id),h=catalog.makeHandInstance(id),size=new T.Box3().setFromObject(h,true).getSize(new T.Vector3());
 assert.ok(Math.abs(Math.max(size.x,size.z)-width)<.001,`${id} actual scaled geometry width`);
 const display=catalog.makeDisplay(id),displayBox=new T.Box3().setFromObject(display,true),protoBox=new T.Box3().setFromObject(entry.proto,true);
 assert.ok(Math.abs(displayBox.min.y-protoBox.min.y)<1e-6,`${id} display bottom stays on tray`);
 avatar.setHoldingPose(true);catalog.attachToHands(id,avatar.model,h);step();refresh();
 const left=sampleIds('armL'),right=sampleIds('armR');assert.ok(left.length>10&&right.length>10);
 const checkPalms=()=>{refresh();const box=new T.Box3().setFromObject(h,true);for(const ids of[left,right])assert.ok(box.distanceToPoint(point(body,ids))<.07,`${id} both real palms support food: gap=${box.distanceToPoint(point(body,ids))} palm=${point(body,ids).toArray()} min=${box.min.toArray()} max=${box.max.toArray()}`);return box;};
 checkPalms();for(let i=0;i<10;i++)step(1/60,false,.7,true);checkPalms();
 const same=catalog.attachToHands(id,avatar.model,h);assert.equal(same,h);assert.equal(h.children[0].scale.x,entry.cupScale,'reattach does not accumulate scaling');
 for(const elapsed of[.65,1.1]){avatar.setEatingPose(true,elapsed);step();step();const box=checkPalms(),mc=point(mouth,Array.from({length:mouth.geometry.attributes.position.count},(_,i)=>i));assert.ok(box.distanceToPoint(mc)<.09,`${id} edible edge reaches actual mouth: gap=${box.distanceToPoint(mc)}`);
  for(const name of['armL','armR'])assert.ok(avatar.restBoneQuaternions.get(name).angleTo(avatar.model.getObjectByName(name).quaternion)<=2.1+1e-6);
  const frozen=box.min.clone();step(3,true,.7);refresh();assert.ok(frozen.distanceTo(new T.Box3().setFromObject(h,true).min)<1e-6,'paused cupping and eating stay frozen');}
 avatar.setEatingPose(false);avatar.setHoldingPose(false);catalog.detach(h);step();assert.equal(body.geometry,original,'snack clone returned to original');assert.deepEqual(original.attributes.skinWeight.array,originalWeights,'original skin weights unchanged');
 console.log(`PASS ${id}: dimensions, both palms, mouth, pause, ownership and original skin`);
}
const h=catalog.makeHandInstance('xiaolongbao');avatar.setHoldingPose(true);catalog.attachToHands('xiaolongbao',avatar.model,h);step();let foodDisposed=0;catalog.byId.get('xiaolongbao').proto.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>foodDisposed++);});avatar.dispose();assert.equal(foodDisposed,0,'actor disposal keeps catalog-owned food alive');assert.equal(h.parent,null);catalog.dispose();console.log('PLAY_FOOD_CUPPING PASS');
