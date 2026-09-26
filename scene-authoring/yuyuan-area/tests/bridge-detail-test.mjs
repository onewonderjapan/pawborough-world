// Validate actual GLB shore landings against the frozen bridge endpoints, never the output against itself.
import fs from 'node:fs';
import path from 'node:path';
import {parseGlb, raycast} from '../modules/bridge-detail/glb-evidence.mjs';
const layout=JSON.parse(fs.readFileSync('baseline/layout.json','utf8'));
const bridge=layout.objects.find(o=>o.id==='jiuqu-bridge');
const file=process.env.BRIDGE_GLB||path.join(process.env.OUT_DIR||'out-sol-bridge','zone-pond.glb');
const g=parseGlb(file);
if(process.env.BRIDGE_SITE_GLB){
 const site=parseGlb(process.env.BRIDGE_SITE_GLB),base=g.verts.length;
 g.verts.push(...site.verts);g.tris.push(...site.tris.map(t=>t.map(i=>i+base)));
}
let failures=[];let samples=0;
for(const [id,endpoint] of [['jiuqu-bridge-step-w',bridge.geometry.polyline[0]],['jiuqu-bridge-step-e',bridge.geometry.polyline.at(-1)]]){
 const o=layout.objects.find(o=>o.id===id),q=o.geometry.position,ang=o.geometry.rotY;
 const forward=[Math.sin(ang),Math.cos(ang)];const gap=(endpoint[0]-q[0])*forward[0]+(endpoint[1]-q[1])*forward[1];
 const rise=(o.geometry.topY-o.geometry.bottomY)/o.geometry.stepCount;
 for(let step=0;step<o.geometry.stepCount;step++)for(const across of [-0.6,0,0.6]){
  const distance=-(0.18+step*0.32),x=q[0]+forward[0]*distance+Math.cos(ang)*across,z=q[1]+forward[1]*distance-Math.sin(ang)*across;
  const hit=raycast(g,[x,0.8,z],[0,-1,0],1,0.6);samples++;
  if(hit===null||Math.abs(0.8-hit-(o.geometry.topY-rise*step))>0.003)failures.push({id,step,across,y:hit===null?null:0.8-hit});
 }
 for(const across of [-0.6,0,0.6])for(let distance=0;distance<=gap+0.10;distance+=0.05){
  const x=q[0]+forward[0]*distance+Math.cos(ang)*across,z=q[1]+forward[1]*distance-Math.sin(ang)*across;
  const hit=raycast(g,[x,0.8,z],[0,-1,0],1,0.60);samples++;
  if(hit===null||Math.abs((0.8-hit)-bridge.deckY)>0.003)failures.push({id,across,distance:+distance.toFixed(2),y:hit===null?null:0.8-hit});
 }
}
// The existing full bridge centreline must remain at its frozen deck top.
for(let i=1;i<bridge.geometry.polyline.length;i++){
 const a=bridge.geometry.polyline[i-1],b=bridge.geometry.polyline[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/0.5);
 for(let k=1;k<n;k++){const t=k/n;const hit=raycast(g,[a[0]+(b[0]-a[0])*t,0.8,a[1]+(b[1]-a[1])*t],[0,-1,0],1,0.6);samples++;if(hit===null||Math.abs(0.8-hit-bridge.deckY)>0.003)failures.push({id:'bridge-centreline',span:i,k,y:hit===null?null:0.8-hit});}
}
console.log(JSON.stringify({file,samples,failures:failures.length,firstFailures:failures.slice(0,10)},null,2));process.exit(failures.length?1:0);
