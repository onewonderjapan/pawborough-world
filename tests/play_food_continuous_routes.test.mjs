// Real world/control route proof. Fixture reset occurs only before each case.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';import{AreaWalkPhysics}from'../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';
import{WalkController}from'../src/player/WalkController.js';import{installStallFronts}from'../scene-authoring/yuyuan-area/web/play/stall-fronts.js';
import{createFoodRegistry}from'../scene-authoring/yuyuan-area/web/play/catalog.js';import{deriveVendors,createVendorLayer}from'../scene-authoring/yuyuan-area/web/play/vendor-layer.js';
import{FoodRoutePlanner}from'./lib/food-route-planner.mjs';
import{installGroundSeams}from'../scene-authoring/yuyuan-area/web/play/ground-seams.js';
import{planBridgeAccess,planSeamBridges,porchApproachPath,applyAccessPhysics}from'../scene-authoring/yuyuan-area/web/play/bridge-access.js';
const area=new URL('../scene-authoring/yuyuan-area/',import.meta.url),read=async p=>JSON.parse(await fs.readFile(new URL(p,area),'utf8'));
const out=process.env.PB_ROUTE_EVIDENCE??'/home/baibai/outbox/pawborough-national-snacks-20261002/m08-routes';await fs.mkdir(out,{recursive:true});
await RAPIER.init();const z=new AreaWalkPhysics({RAPIER,manifest:await read('out-zone/zones-manifest.json'),readJson:f=>read('out-zone/'+f),readBytes:f=>fs.readFile(new URL('out-zone/'+f,area))});
await z.loadZones(['garden','pond','temple','bazaar','outer','fangbang']);const layout=await read('out-zone/layout.json'),fronts=installStallFronts({layout,RAPIER,zonePhysics:z});
const seams=installGroundSeams({RAPIER,zonePhysics:z});
const [catalog,assets,vendors,profiles]=await Promise.all(['food-catalog','play-foods','play-vendors','food-pose-profiles'].map(n=>read('inputs/'+n+'.json'))),registry=createFoodRegistry({catalog,assets,vendors,profiles});
const planner=new FoodRoutePlanner({physics:z.physics,groundColliders:()=>z.groundColliders,RAPIER}),probe={supportAt:(x,pz)=>planner.supportAt(x,pz),isBlocked:(x,y,pz)=>planner.wallOverlap(x,y,pz)};
const collisionZones=await Promise.all(['garden','pond','temple','bazaar','outer','fangbang'].map(async zone=>({zone,records:(await read('out-zone/collision-'+zone+'.json')).colliders})));
const accessPlan=planBridgeAccess({layout,collisionZones,capsuleRadius:.28});
const accessPaths=[layout.objects.find(o=>o.kind==='zigzagBridge')?.geometry?.polyline,porchApproachPath(layout)?.path].filter(Boolean);
accessPlan.seamSlabs=planSeamBridges({paths:accessPaths,probe:(x,pz)=>planner.supportAt(x,pz,3,8)}).slabs;
applyAccessPhysics(RAPIER,z.physics,accessPlan,z);planner.probeCache.clear();
const targets=deriveVendors({registry,layout,sockets:await read('out-zone/food-sockets.json'),world:probe});
const layer=createVendorLayer({scene:new T.Scene(),vendors:targets,addBoxCollider:b=>z.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(...b.halfExtents).setTranslation(...b.center).setRotation({x:0,y:Math.sin(b.yaw/2),z:0,w:Math.cos(b.yaw/2)})),removeCollider:c=>z.physics.world.removeCollider(c,false)});
const start=[-157.75,.06,-22.25],capsule={radius:.28,halfHeight:.2,eyeHeight:.8,speed:2.6,runSpeed:4.2,autostep:.15,minimumGroundY:-.1,groundColliders:()=>z.groundColliders,spawn:start};
const report={scope:'Continuous real WalkController per-vendor roundtrip from center; only initial fixture resets; no mid-route teleport',physics:z.status(),cartBoxes:layer.collisionBoxes,routes:[]};
try{
 for(const target of targets.filter(t=>!process.env.PB_ROUTE_FOOD||process.env.PB_ROUTE_FOOD.split(',').includes(t.foodId))){
  const row={vendorId:target.vendorId,foodId:target.foodId,enabled:target.enabled};report.routes.push(row);
  if(!target.enabled){row.pass=false;row.reason=target.reason;continue;}
  let plan;
  for(const config of [{step:1.5,boundingMargin:30},{step:1,boundingMargin:70}]){plan=planner.planAStar({startXZ:[start[0],start[2]],goalXZ:[target.customerPoint.x,target.customerPoint.z],...config});if(plan.success)break;}
  row.plan=plan;if(!plan.success){row.pass=false;console.log('FAIL plan',row.foodId,plan.reason);continue;}
  const c=new WalkController({RAPIER,physics:z.physics,capsule});c.teleport(start,0,0);
  let lowest=Infinity,worstGap=Infinity,unsupported=0,distance=0,ticks=0,failure=null;
  const path=[...plan.path,...plan.path.slice(0,-1).reverse()];let waypoint=1,lastProgress=0,progressFeet=c.feetPosition();
  const limit=Math.ceil((plan.lengthM*2/2.6*2+20)*60);
  while(waypoint<path.length&&ticks<limit){
   const f=c.feetPosition(),p=path[waypoint],dx=p.x-f[0],dz=p.z-f[2];
   if(Math.hypot(dx,dz)<.06){waypoint++;lastProgress=ticks;progressFeet=f;continue;}
   c.yaw=Math.atan2(-dx,-dz);c.setMoveInput(1,0);c.step(1/60);ticks++;
   const next=c.feetPosition(),g=planner.supportAt(next[0],next[2],next[1]+1,4);lowest=Math.min(lowest,next[1]);if(g!==null)worstGap=Math.min(worstGap,next[1]-g);else{failure='missing real ground during traversal';break;}
   distance+=Math.hypot(next[0]-f[0],next[2]-f[2]);if(c.lastStep?.unsupported)unsupported++;
   if(next[1]<-.1||next[1]-g<-.025){failure='ground penetration';break;}
   if(ticks-lastProgress>=300){if(Math.hypot(next[0]-progressFeet[0],next[2]-progressFeet[2])<.05){failure='stalled five simulation seconds';break;}lastProgress=ticks;progressFeet=next;}
  }
  const final=c.feetPosition();row.pass=!failure&&waypoint===path.length&&Math.hypot(final[0]-start[0],final[2]-start[2])<=1.2&&unsupported===0;
  Object.assign(row,{reason:failure??(row.pass?null:'waypoint/unsupported completion failed'),ticks,waypoint,lowest,worstGap,unsupported,distanceM:distance,final});c.dispose();
  await fs.writeFile(`${out}/${row.foodId}.json`,JSON.stringify(row,null,2)+'\n','utf8');console.log(row.pass?'PASS route':'FAIL route',row.foodId,row.reason??'',`distance${distance.toFixed(1)}m lowest${lowest.toFixed(3)} gap${worstGap.toFixed(3)}`);
 }
 await fs.writeFile(`${out}/summary.json`,JSON.stringify(report,null,2)+'\n','utf8');assert.ok(report.routes.every(r=>r.pass),'Every active food requires actual center→vendor→center traversal');
 console.log('CONTINUOUS_FOOD_ROUTES PASS',report.routes.length);
}finally{layer.dispose();fronts.dispose();seams?.dispose();z.physics.dispose();}
