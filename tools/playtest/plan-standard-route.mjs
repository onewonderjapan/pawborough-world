// Real world/control route proof. Fixture reset occurs only before each case.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import * as T from '../../node_modules/three/build/three.module.js';
import RAPIER from '../../node_modules/@dimforge/rapier3d-compat/rapier.mjs';import{AreaWalkPhysics}from'../../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';
import{WalkController}from'../../src/player/WalkController.js';import{installStallFronts}from'../../scene-authoring/yuyuan-area/web/play/stall-fronts.js';
import{createFoodRegistry}from'../../scene-authoring/yuyuan-area/web/play/catalog.js';import{deriveVendors,createVendorLayer}from'../../scene-authoring/yuyuan-area/web/play/vendor-layer.js';
import{FoodRoutePlanner}from'../../tests/lib/food-route-planner.mjs';
import{installGroundSeams}from'../../scene-authoring/yuyuan-area/web/play/ground-seams.js';
import{planBridgeAccess,planSeamBridges,porchApproachPath,applyAccessPhysics}from'../../scene-authoring/yuyuan-area/web/play/bridge-access.js';
const area=new URL('../../scene-authoring/yuyuan-area/',import.meta.url),read=async p=>JSON.parse(await fs.readFile(new URL(p,area),'utf8'));
const out=process.env.PB_ROUTE_EVIDENCE??'/tmp/pawborough-official-planning';await fs.mkdir(out,{recursive:true});
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

z.physics.world.step();planner.probeCache.clear();
const center={x:-157.75,y:.04,z:-22.25};
const stops=[['S00','中心广场：初见与操作',null,'entry'],['S01','肠粉：取餐、筷子进食、首枚章','changfen','meal'],['S02','钵钵鸡：拿在手上去骑车','boboji','take'],['S03','共享自行车：车篮、倒车、暂停、下车',null,'bike'],['S04','小笼包：原三味捧食','xiaolongbao','meal'],['S05','肉夹馍：纸包、图鉴暂停与恢复','roujiamo','journalMeal'],['S06','奶豆腐：外围西街尺度与街景','naidoufu','meal'],['S07','清补凉：西桥岸入口和勺食','qingbuliang','meal'],['S08','方浜交界：地缝双向行走',null,'seam'],['S09','瓦罐汤：陶罐、标签与店面边界','waguan-tang','meal'],['S10','驴肉火烧：长街发现、远程图鉴','lvrou-huoshao','meal'],['S11','长街终点就地：收藏复查、重载、窄屏、夜景',null,'final']];
const checkpoints=stops.map(([id,title,foodId,action])=>{const target=targets.find(t=>t.foodId===foodId);return{id,title,foodId,action,point:id==='S11'?null:target?{x:target.customerPoint.x,y:target.groundY,z:target.customerPoint.z}:id==='S08'?{x:-98.0,y:.02,z:20.75}:center,poseProfile:foodId?registry.foodsById.get(foodId).poseProfile:null};});
const variants={full:stops.map(s=>s[0]),controls:['S00','S01','S02','S03','S04','S05','S08','S09','S11']};
const legs={};for(const ids of Object.values(variants)){let from=checkpoints[0];for(const id of ids.slice(1)){const to=checkpoints.find(s=>s.id===id),key=from.id+'>'+to.id;if(to.action==='final'){legs[key]={from:from.id,to:to.id,lengthM:0,waypoints:[],note:'Finish at current finalsnackpoint without positionchange'};continue;}if(!legs[key]){let plan;for(const cfg of[{step:1.5,boundingMargin:35},{step:1,boundingMargin:70}]){plan=planner.planAStar({startXZ:[from.point.x,from.point.z],goalXZ:[to.point.x,to.point.z],anchorXZ:[center.x,center.z],...cfg});if(plan.success)break;}if(!plan.success)throw Error(key+':'+plan.reason);legs[key]={from:from.id,to:to.id,lengthM:plan.lengthM,waypoints:plan.path.filter((p,i,a)=>i===0||Math.hypot(p.x-a[i-1].x,p.z-a[i-1].z)>.01)};console.log('LEG',key,plan.lengthM.toFixed(1));}from=to;}}
const route={schemaVersion:1,id:'pb-official-tour-v1.1',revision:'v1.1',baseCommit:'9abe3ca4f251dea97b3c908f8441a59982f200cd',baseUrl:'http://127.0.0.1:5492/?play=1&at=center',contextPolicy:'Fresh independent browser context, preserve owner storage. Normal center entry, continuous movement. No mid-route teleport, no direct collection writes or simulation fast-forward.',navigationPolicy:'Waypoints planned on actual six-zone geometry/current48vendor bodies. Movement requests use production WalkController input/fixed-step; E/F/R/B/P/Space via keyboard. Setup may warm geometry without changing player position.',variants,checkpoints,legs};
await fs.writeFile(new URL('../../docs/playtest-20261003/official-route.json',import.meta.url),JSON.stringify(route,null,2)+'\n','utf8');console.log('OFFICIAL_ROUTE_PLANNED',Object.keys(legs).length);
layer.dispose();fronts.dispose();seams?.dispose();z.physics.dispose();
