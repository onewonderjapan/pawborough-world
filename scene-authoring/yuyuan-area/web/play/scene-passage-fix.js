// Restore the authored 3.5m soffit under the adopted old-north tower.
// Source GLBs stay read-only: clip owned geometry before batching, and build
// the missing ceiling from the same layout footprint as the authoring client.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cutPassages } from '../../src/passage-clip.mjs';

function planBuilding(layout,id) {
  const building = layout.objects?.find(o => o.id === id);
  if (!building?.geometry?.groundFootprints) return null;
  const footprint = building.geometry.footprint.slice();
  if (footprint[0][0] === footprint.at(-1)[0] && footprint[0][1] === footprint.at(-1)[1]) footprint.pop();
  const passages = (layout.reviewRepair?.passages ?? []).filter(p => p.buildingIds.includes(building.id));
  const bounds = { minX: Math.min(...footprint.map(p=>p[0]))-.6, maxX: Math.max(...footprint.map(p=>p[0]))+.6,
    minZ: Math.min(...footprint.map(p=>p[1]))-.6, maxZ: Math.max(...footprint.map(p=>p[1]))+.6 };
  return { buildingId: building.id, footprint, passages, height: building.geometry.passageHeight, bounds };
}

export function planPassageCeiling(layout) {
  const plan=planBuilding(layout,'bld-428202606');
  if(!plan)return null;
  const road=plan.passages.find(p=>p.roadId==='road-428199190');
  plan.companions=(road?.buildingIds??[]).filter(id=>id!==plan.buildingId).map(id=>planBuilding(layout,id)).filter(Boolean);
  return plan;
}
export function ceilingGeometry(plan) {
  const parts=[plan,...(plan.companions??[])].map(p=>{
    const shape = new THREE.Shape(p.footprint.map(([x,z]) => new THREE.Vector2(x,-z)));
    return new THREE.ExtrudeGeometry(shape,{depth:.06,bevelEnabled:false,steps:1})
      .rotateX(-Math.PI/2).translate(0,p.height,0);
  });
  const geometry=mergeGeometries(parts);for(const part of parts)part.dispose();return geometry;
}

export function patchPassageRoot(root, plan) {
  const owned = [];
  if (!plan) return { count:0, dispose(){} };
  root.updateMatrixWorld(true);
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || Array.isArray(mesh.material)
      || !mesh.material?.name?.startsWith('btk-') || mesh.userData.pbPassageClipped) return;
    const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(mesh.matrixWorld);
    const candidate=[plan,...(plan.companions??[])].find(p=>{const b=p.bounds;
      return box.min.x>=b.minX&&box.max.x<=b.maxX&&box.min.z>=b.minZ&&box.max.z<=b.maxZ&&box.min.y<=p.height&&box.max.y>=.06;});
    if(!candidate)return;
    const original=mesh.geometry, normalized=new THREE.BufferGeometry();
    for(const [name,attr] of Object.entries(original.attributes)){
      const array=new Float32Array(attr.count*attr.itemSize);
      for(let i=0;i<attr.count;i++)for(let k=0;k<attr.itemSize;k++)array[i*attr.itemSize+k]=attr.getComponent(i,k);
      normalized.setAttribute(name,new THREE.BufferAttribute(array,attr.itemSize));
    }
    if(original.index)normalized.setIndex(Array.from(original.index.array));
    normalized.applyMatrix4(mesh.matrixWorld);
    const clipped=cutPassages(normalized,candidate.passages);
    clipped.applyMatrix4(mesh.matrixWorld.clone().invert());
    normalized.dispose();
    mesh.geometry=clipped;mesh.userData.pbPassageClipped=true;
    owned.push({mesh,original,clipped});
  });
  return {count:owned.length,dispose(){for(const p of owned){p.mesh.geometry=p.original;delete p.mesh.userData.pbPassageClipped;p.clipped.dispose();}owned.length=0;}};
}

export function installPassageCeiling({scene,layout,RAPIER,zonePhysics}) {
  const plan=planPassageCeiling(layout);
  if(!plan || scene.getObjectByName('play-oldnorth-soffit'))return null;
  const geometry=ceilingGeometry(plan);
  let source=null;
  scene.traverse(o=>{if(!source&&o.isMesh&&!Array.isArray(o.material)&&o.material?.name?.startsWith('garden-white-plaster'))source=o.material;});
  const material=source?.clone()??new THREE.MeshStandardMaterial({color:0xb7ab98,roughness:.94});
  material.side=THREE.DoubleSide;
  const group=new THREE.Group();group.name='play-oldnorth-soffit';
  const ceiling=new THREE.Mesh(geometry,material);ceiling.name='oldnorth-ceiling-panel';group.add(ceiling);
  // A local corridor lamp, not a global lighting change. Place it over the
  // midpoint of the final authored north-passage segment.
  const road=plan.passages.find(p=>p.roadId==='road-428199190');
  if(road){const a=road.polyline.at(-2),b=road.polyline.at(-1);const light=new THREE.PointLight(0xffecd8,18,12,2);
    light.position.set((a[0]+b[0])/2,plan.height-.3,(a[1]+b[1])/2);group.add(light);}
  scene.add(group);
  const physics=zonePhysics.physics,world=physics.world;
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const positions=geometry.attributes.position.array;
  const indices=geometry.index?.array??Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i);
  const collider=world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)),body);
  const entry={body,collider,handle:collider.handle,record:{name:'play-oldnorth-soffit',module:'passage-ceiling',type:'trimesh'}};
  physics.colliders.push(entry);physics.wallCount++;world.step();
  // Never register this overhead surface as walkable ground.
  return {plan,group,collider,dispose(){group.removeFromParent();world.removeRigidBody(body);const i=physics.colliders.indexOf(entry);if(i>=0)physics.colliders.splice(i,1);geometry.dispose();material.dispose();}};
}
