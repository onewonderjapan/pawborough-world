import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {createClosedFacades}=await import(process.env.PB_C_FACADE_MODULE?pathToFileURL(process.env.PB_C_FACADE_MODULE):'../scene-authoring/yuyuan-area/web/play/closed-facades.js');
function fixture(){
 const counts={add:0,geometry:0,material:0,texture:0},geometry={dispose(){counts.geometry++;}},texture={isTexture:true,dispose(){counts.texture++;}},material={map:texture,dispose(){counts.material++;}};
 const root={getObjectByName(){return{userData:{closedCount:172}};},traverse(f){f({geometry,material});f({geometry,material});}};
 const scene={add(){counts.add++;},remove(){}},manifest={facades:{path:'test.glb',closedCount:172}};
 return{root,counts,scene,manifest};
}
{
 const f=fixture();let done;const parsing=new Promise(r=>done=r);
 const owner=createClosedFacades({scene:f.scene,fetchJson:async()=>f.manifest,fetchBuffer:async()=>new ArrayBuffer(0),parseGlb:()=>parsing});
 const a=owner.install(),b=owner.install();await new Promise(r=>setTimeout(r,0));done(f.root);await Promise.all([a,b]);
 assert.equal(f.counts.add,1,'concurrent installation must add one overlay');owner.dispose();
 assert.deepEqual(f.counts,{add:1,geometry:1,material:1,texture:1},'shared resources within the owned GLB are each released once');
}
{
 const f=fixture();let done;const parsing=new Promise(r=>done=r);
 const owner=createClosedFacades({scene:f.scene,fetchJson:async()=>f.manifest,fetchBuffer:async()=>new ArrayBuffer(0),parseGlb:()=>parsing});
 const waiting=owner.install();await new Promise(r=>setTimeout(r,0));owner.dispose();done(f.root);await waiting;
 assert.deepEqual(f.counts,{add:0,geometry:1,material:1,texture:1},'disposing during decode releases the late asset without attaching it');
 assert.equal(owner.status().closedFacadesReady,false);
}
console.log('PLAY_CLOSED_FACADE_LIFECYCLE PASS');
