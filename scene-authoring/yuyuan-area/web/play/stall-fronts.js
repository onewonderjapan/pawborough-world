// Play-only frontage: continue the existing street paving across the empty
// strip between the road and counters. Visual slab and collider share dimensions.
import * as THREE from 'three';
export function installStallFronts({scene,layout,RAPIER,zonePhysics}) {
  const physics=zonePhysics.physics,world=physics.world;
  const originalGrounds=new Set(zonePhysics.groundColliders.map(c=>c.handle));
  const pieces=[],geometry=new THREE.BoxGeometry(2.4,.06,1.8);
  let material=null;
  const roadHeight=(x,z)=>{
    const hit=world.castRay(new RAPIER.Ray({x,y:8,z},{x:0,y:-1,z:0}),12,true,
      undefined,undefined,undefined,undefined,c=>originalGrounds.has(c.handle));
    return hit?8-hit.timeOfImpact:null;
  };
  for(const o of layout.objects??[]){
    if(o.kind!=='stall'||o.disposition!=='rendered'||!o.faces?.refPoint)continue;
    const [x,z]=o.geometry.position,dx=o.faces.refPoint[0]-x,dz=o.faces.refPoint[1]-z,len=Math.hypot(dx,dz);
    if(!len)continue;
    const ux=dx/len,uz=dz/len,yaw=Math.atan2(ux,uz),sample={x:x+ux*2.8,z:z+uz*2.8};
    const surface=roadHeight(sample.x,sample.z);if(surface===null||surface<-.1)continue;
    if(!material&&scene){
      const ray=new THREE.Raycaster(new THREE.Vector3(sample.x,surface+.3,sample.z),new THREE.Vector3(0,-1,0),0,.5);
      const hit=ray.intersectObjects(scene.children,true).find(h=>Math.abs(h.point.y-surface)<.04&&h.object.isMesh);
      const source=hit&&(Array.isArray(hit.object.material)?hit.object.material[0]:hit.object.material);
      material=source?.clone()??new THREE.MeshStandardMaterial({color:0x858783,roughness:.95});
    }
    const pos={x:x+ux*1.55,y:surface-.028,z:z+uz*1.55},rotation={x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)};
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x,pos.y,pos.z));
    const floor=world.createCollider(RAPIER.ColliderDesc.cuboid(1.2,.03,.9).setRotation(rotation),body);
    zonePhysics.groundColliders.push(floor);
    // A 10cm contact allowance keeps the visible head/paws outside the counter.
    const guardBody=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x+ux*.75,surface+.6,z+uz*.75));
    const guard=world.createCollider(RAPIER.ColliderDesc.cuboid(1.06,.6,.065).setRotation(rotation),guardBody);
    let mesh=null;
    if(scene){mesh=new THREE.Mesh(geometry,material);mesh.name='play-frontage-'+o.id;mesh.position.set(pos.x,pos.y,pos.z);mesh.rotation.y=yaw;mesh.receiveShadow=true;scene.add(mesh);}
    pieces.push({id:o.id,floor,body,guard,guardBody,mesh,surface});
  }
  world.step();
  return {pieces,dispose(){
    for(const p of pieces){p.mesh?.removeFromParent();world.removeRigidBody(p.body);world.removeRigidBody(p.guardBody);const i=zonePhysics.groundColliders.indexOf(p.floor);if(i>=0)zonePhysics.groundColliders.splice(i,1);}
    pieces.length=0;geometry.dispose();material?.dispose();
  }};
}
