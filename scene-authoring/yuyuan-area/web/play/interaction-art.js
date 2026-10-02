// Small, bounded world feedback: contact shadow, hot-food steam and bite/reward
// particles. Time comes from the play loop, so pause never advances effects.
import * as THREE from 'three';
function radialTexture(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,.85)');g.addColorStop(.35,'rgba(255,255,255,.5)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
export function installInteractionArt(scene){
  const root=new THREE.Group();root.name='play-interaction-art';scene.add(root);
  const fill=new THREE.PointLight(0xfff5e4,.55,2.8,2);fill.name='plush-soft-fill';root.add(fill);
  const map=radialTexture(),shadowGeo=new THREE.PlaneGeometry(1,1),shadowMat=new THREE.MeshBasicMaterial({map,color:0x333b39,transparent:true,opacity:.3,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  const shadow=new THREE.Mesh(shadowGeo,shadowMat);shadow.name='plush-contact-shadow';shadow.raycast=()=>{};shadow.rotation.x=-Math.PI/2;root.add(shadow);
  const steam=[],bits=[],owned=[];
  for(let i=0;i<7;i++){const m=new THREE.SpriteMaterial({map,color:0xfff7e7,transparent:true,opacity:0,depthWrite:false});const s=new THREE.Sprite(m);s.name='snack-steam';s.raycast=()=>{};s.visible=false;root.add(s);steam.push(s);owned.push(m);}
  const bitGeo=new THREE.IcosahedronGeometry(.007,0);
  for(let i=0;i<18;i++){const m=new THREE.MeshBasicMaterial({color:i%2?0xe6c27c:0x88b8aa,transparent:true,depthWrite:false});const mesh=new THREE.Mesh(bitGeo,m);mesh.visible=false;mesh.name='snack-reward-mote';mesh.raycast=()=>{};root.add(mesh);bits.push({mesh,velocity:new THREE.Vector3(),life:0,max:1});owned.push(m);}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const origin=new THREE.Vector3(),foodBox=new THREE.Box3();let clock=0,lastItem=null,lastStamps=0,lastBite=-1,ready=false;
  function burst(at,celebrate){if(reduced)return;let k=0;for(const b of bits){if(b.life>0)continue;const a=k*2.399963,big=celebrate?.6:.28;b.mesh.position.copy(at);b.velocity.set(Math.cos(a)*big,.3+(k%3)*.1,Math.sin(a)*big);b.max=b.life=celebrate?1.1:.55;b.mesh.visible=true;b.mesh.material.color.set(celebrate?(k%2?0xe6c27c:0x88b8aa):0xc89251);if(++k>=(celebrate?14:5))break;}}
  let disposed=false;
  return {update({avatar,food,state,feet,paused,dt}){
    if(!avatar||!feet)return;
    fill.position.copy(new THREE.Vector3(-.5,.95,1.0).applyQuaternion(avatar.root.getWorldQuaternion(new THREE.Quaternion()))).add(new THREE.Vector3(...feet));
    const step=paused?0:Math.min(.05,Math.max(0,dt||0));clock+=step;
    shadow.position.set(feet[0],feet[1]-.011,feet[2]);shadow.scale.set(state.vehicle.riding?.72:.58,state.vehicle.riding?1.05:.42,1);
    if(food){foodBox.setFromObject(food);foodBox.getCenter(origin);origin.y=foodBox.max.y+.01;}
    const active=!!state.heldItem&&!!food&&!reduced;
    for(let i=0;i<steam.length;i++){const s=steam[i];s.visible=active;if(!active)continue;const t=(clock*.45+i/steam.length)%1;s.position.set(origin.x+Math.sin(i*2.7+t*3)*(.015+t*.024),origin.y+t*.2,origin.z+Math.cos(i*1.4+t*2)*.018);s.scale.setScalar(.025+t*.075);s.material.opacity=Math.sin(t*Math.PI)*.19;}
    if(ready&&!paused){
      if(state.heldItem&&state.heldItem!==lastItem)burst(origin,false);
      const bite=state.eating?Math.floor(state.eating.elapsed/.8):-1;
      if(bite>0&&bite!==lastBite&&food)burst(origin,false);
      if(state.stamps>lastStamps)burst(new THREE.Vector3(feet[0],feet[1]+.85,feet[2]),true);
      lastBite=bite;
    }
    ready=true;lastItem=state.heldItem;lastStamps=state.stamps;
    for(const b of bits)if(b.life>0){b.life-=step;b.mesh.visible=b.life>0;b.velocity.y-=step*.45;b.mesh.position.addScaledVector(b.velocity,step);b.mesh.rotation.x+=step*2;b.mesh.material.opacity=Math.max(0,b.life/b.max);}
  },dispose(){if(disposed)return;disposed=true;root.removeFromParent();map.dispose();shadowGeo.dispose();shadowMat.dispose();bitGeo.dispose();for(const m of owned)m.dispose();}};
}
