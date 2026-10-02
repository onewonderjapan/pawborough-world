// Independent Gemini route regression: old-north walks off a real street onto
// the backdrop foundation (-0.4m), then cannot return. Actual area physics only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import {AreaWalkPhysics} from '../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';
import {WalkController} from '../src/player/WalkController.js';
import {installStallFronts} from '../scene-authoring/yuyuan-area/web/play/stall-fronts.js';
const root=fileURLToPath(new URL('../scene-authoring/yuyuan-area/out-zone/',import.meta.url));
const readJson=async f=>JSON.parse(await fs.readFile(root+f,'utf8'));
await RAPIER.init();
const z=new AreaWalkPhysics({RAPIER,manifest:await readJson('zones-manifest.json'),readJson,readBytes:f=>fs.readFile(root+f)});
await z.loadZones(['garden','pond','temple','bazaar','outer','fangbang']);
const fronts=installStallFronts({layout:await readJson('layout.json'),RAPIER,zonePhysics:z});
let failures=0;
const routes=[{name:'old-north',feet:[-174.75,.04,-156.75],yaw:0},{name:'main',feet:[-191,.04,36.25],yaw:0},{name:'fangbang',feet:[136.24,.02,-1.96],yaw:0},{name:'jiuqu-side',feet:[-176.87,.07,-112.33],yaw:Math.atan2(-1.26,1.34)}];
for(const route of routes)for(const running of [false,true]){
 const c=new WalkController({RAPIER,physics:z.physics,capsule:{radius:.28,halfHeight:.2,eyeHeight:.8,speed:2.6,runSpeed:4.2,autostep:.15,minimumGroundY:-.1,groundColliders:()=>z.groundColliders,spawn:[0,1,0]}});
 c.teleport(route.feet,route.yaw);c.setRunning(running);c.setMoveInput(1,0);
 let lowest=Infinity,edgeSignaled=false;
 for(let i=0;i<360;i++){c.step(1/60);lowest=Math.min(lowest,c.feetPosition()[1]);edgeSignaled ||= !!c.lastStep.unsupported;}
 const stop=c.feetPosition();c.setMoveInput(-1,0);for(let i=0;i<120;i++)c.step(1/60);
 const back=c.feetPosition(),returned=Math.hypot(back[0]-stop[0],back[2]-stop[2]);
 const ok=lowest>=-.1&&(route.name==='jiuqu-side'||edgeSignaled)&&returned>1&&back[1]>=-.1;
 console.log(`${ok?'ok':'FAIL'} ${route.name} ${running?'run':'walk'}: lowest=${lowest.toFixed(4)}, edge=${edgeSignaled}, return=${returned.toFixed(2)}m`);if(!ok)failures++;
 c.dispose();
}
fronts.dispose();z.physics.dispose();assert.equal(failures,0,'walkers must not enter the unwalkable foundation or become buried at road edges');
console.log('PLAY_GROUND_EDGES PASS');
