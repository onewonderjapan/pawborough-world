// Regression for the owner-reported stall-front penetration. Uses the actual
// area GLBs, Rapier world and production controller; no synthetic ground.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import {AreaWalkPhysics} from '../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';
import {WalkController} from '../src/player/WalkController.js';
import {deriveStallTargets} from '../scene-authoring/yuyuan-area/web/play/stalls.js';
import {installStallFronts} from '../scene-authoring/yuyuan-area/web/play/stall-fronts.js';
const root=fileURLToPath(new URL('../scene-authoring/yuyuan-area/out-zone/',import.meta.url));
const readJson=async f=>JSON.parse(await fs.readFile(root+f,'utf8'));
await RAPIER.init();
const z=new AreaWalkPhysics({RAPIER,manifest:await readJson('zones-manifest.json'),readJson,readBytes:f=>fs.readFile(root+f)});
await z.loadZones(['garden','pond','temple','bazaar','outer','fangbang']);
const fronts=installStallFronts({layout:await readJson('layout.json'),RAPIER,zonePhysics:z});
const handles=new Set(z.groundColliders.map(c=>c.handle));
const ground=(x,y,zp)=>{const hit=z.physics.world.castRay(new RAPIER.Ray({x,y,z:zp},{x:0,y:-1,z:0}),12,true,undefined,undefined,undefined,undefined,c=>handles.has(c.handle));return hit?y-hit.timeOfImpact:null;};
const targets=deriveStallTargets(await readJson('layout.json'),await readJson('food-sockets.json'));
let failures=0;
for(const t of targets)for(const lateral of [0,-.5,.5]){
 const p={radius:.28,halfHeight:.2,eyeHeight:.8,speed:2.6,runSpeed:4.2,autostep:.15,spawn:[0,1,0],groundColliders:()=>z.groundColliders};
 const c=new WalkController({RAPIER,physics:z.physics,capsule:p});
 const x=t.counter.x+t.faceDir.x*2.45+t.faceDir.z*lateral,zz=t.counter.z+t.faceDir.z*2.45-t.faceDir.x*lateral;
 const gy=ground(x,8,zz);assert.notEqual(gy,null);c.teleport([x,gy+.02,zz],Math.atan2(t.faceDir.x,t.faceDir.z));
 let worst=Infinity,groundSamples=0,lowest=Infinity;
 c.setMoveInput(1,0);for(let i=0;i<180;i++){c.step(1/60);const f=c.feetPosition(),g=ground(f[0],f[1]+1,f[2]);if(g!==null){worst=Math.min(worst,f[1]-g);lowest=Math.min(lowest,f[1]);groundSamples++;}}
 const atCounter=c.feetPosition(),frontDistance=(atCounter[0]-t.counter.x)*t.faceDir.x+(atCounter[2]-t.counter.z)*t.faceDir.z;
 c.setMoveInput(-1,0);for(let i=0;i<120;i++){c.step(1/60);const f=c.feetPosition(),g=ground(f[0],f[1]+1,f[2]);if(g!==null)worst=Math.min(worst,f[1]-g);}
 const returned=c.feetPosition(),backDistance=(returned[0]-t.counter.x)*t.faceDir.x+(returned[2]-t.counter.z)*t.faceDir.z;
 const ok=groundSamples===180&&worst>=-.025&&lowest>=gy-.08&&frontDistance>.97&&backDistance>2.6;
 console.log(`${ok?'ok':'FAIL'} ${t.stallId} lateral ${lateral}: worst foot-ground gap ${worst.toFixed(4)}m, lowest feet ${lowest.toFixed(4)}m`);if(!ok)failures++;
 c.dispose();
}
fronts.dispose();z.physics.dispose();assert.equal(failures,0,'actual stall approaches must not penetrate ground');
console.log('PLAY_STALL_GROUND PASS');
