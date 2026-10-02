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

const targetId='food-vendor-fenglisu';const found=[];
for(let radius=0;radius<=28&&found.length<6;radius+=2)for(let dx=-radius;dx<=radius&&found.length<6;dx+=2)for(let dz=-radius;dz<=radius&&found.length<6;dz+=2){
 if(radius&&Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
 const x=-174.75+dx,pz=-156.75+dz;
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const cp=[x+Math.sin(yaw)*1.5,pz+Math.cos(yaw)*1.5],original=registry.vendorsById.get(targetId);
  const r={...registry,vendorsById:new Map([[targetId,{...original,position:[x,pz],customerPoint:cp,rotationY:yaw}]])};
  const t=deriveVendors({registry:r,layout,sockets:await read('out-zone/food-sockets.json'),world:probe})[0];if(!t.enabled)continue;
  const plan=planner.planAStar({startXZ:[-157.75,-22.25],goalXZ:cp,step:1,boundingMargin:70});if(plan.success){found.push({position:[x,pz],customerPoint:cp,rotationY:yaw,groundY:t.groundY,length:plan.lengthM});break;}
 }
}
console.log(JSON.stringify(found,null,2));layer.dispose();fronts.dispose();seams?.dispose();z.physics.dispose();
