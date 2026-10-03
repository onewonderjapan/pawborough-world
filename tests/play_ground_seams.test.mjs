import assert from 'node:assert/strict';import fs from 'node:fs/promises';import * as T from 'three';import RAPIER from '@dimforge/rapier3d-compat';
import{AreaWalkPhysics}from'../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';import{WalkController}from'../src/player/WalkController.js';import{installGroundSeams}from'../scene-authoring/yuyuan-area/web/play/ground-seams.js';
const root=new URL('../scene-authoring/yuyuan-area/out-zone/',import.meta.url),json=async f=>JSON.parse(await fs.readFile(new URL(f,root),'utf8'));
await RAPIER.init();const z=new AreaWalkPhysics({RAPIER,manifest:await json('zones-manifest.json'),readJson:json,readBytes:f=>fs.readFile(new URL(f,root))});await z.loadZones(['outer','fangbang']);
const ground=(x,pz)=>{const handles=new Set(z.groundColliders.map(c=>c.handle));const h=z.physics.world.castRay(new RAPIER.Ray({x,y:.3,z:pz},{x:0,y:-1,z:0}),2,true,undefined,undefined,undefined,undefined,c=>handles.has(c.handle));return h?.timeOfImpact===undefined?null:.3-h.timeOfImpact;};
assert.ok(ground(-96.795563,20.7500076)<-.1,'real original14mm gap reaches backdrop');
const bodies=z.physics.world.bodies.len(),colliders=z.physics.world.colliders.len(),scene=new T.Scene(),unrelated=new T.Group();scene.add(unrelated);
const owner=installGroundSeams({scene,RAPIER,zonePhysics:z});assert.ok(owner);assert.equal(installGroundSeams({scene,RAPIER,zonePhysics:z}),owner,'one owner perworld');assert.ok(ground(-96.795563,20.7500076)>=.02);
assert.equal(z.physics.world.bodies.len(),bodies+2);assert.equal(z.physics.world.colliders.len(),colliders+2);
for(const eastward of [false,true])for(const running of [false,true])for(const phase of [0,.012,.024]){
 const x=eastward?-97.15+phase:-96.45-phase,y=ground(x,20.75)+.02;
 const c=new WalkController({RAPIER,physics:z.physics,capsule:{radius:.28,halfHeight:.2,eyeHeight:.8,speed:2.6,runSpeed:4.2,autostep:.15,minimumGroundY:-.1,groundColliders:()=>z.groundColliders,spawn:[x,y,20.75]}});c.teleport([x,y,20.75],eastward?-Math.PI/2:Math.PI/2);c.setRunning(running);c.setMoveInput(1,0);
 let unsupported=0,lowest=Infinity;for(let i=0;i<30;i++){c.step(1/60);unsupported+=c.lastStep.unsupported?1:0;lowest=Math.min(lowest,c.feetPosition()[1]);}
 assert.equal(unsupported,0,`direction${eastward} run${running} phase${phase}`);assert.ok(Math.abs(c.feetPosition()[0]-x)>.8);assert.ok(lowest>=.015);c.dispose();
}
owner.dispose();owner.dispose();assert.equal(z.physics.world.bodies.len(),bodies);assert.equal(z.physics.world.colliders.len(),colliders);assert.deepEqual(scene.children,[unrelated]);assert.ok(ground(-96.795563,20.7500076)<-.1,'revoke restoresoriginalgap');z.physics.dispose();
console.log('GROUND_SEAMS PASS: actual14mmRED, reversibleconnector,12walk/run/direction/phasecases, no body/collider leaks');
