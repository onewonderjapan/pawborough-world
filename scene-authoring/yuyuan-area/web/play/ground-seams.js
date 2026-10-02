// Reversible paving connector at the measured outer/fangbang clipped edge.
// Original GLBs and global ground/drop limits remain unchanged.
import * as T from 'three';
import {addGroundCollider,removeColliderWithBody} from '../../../../src/world/physics.js';
export const STREET_SEAM={id:'outer-fangbang-stone-join',sourceEdges:{outerX:-96.800003,outerY:.02,
  fangbang:[[-96.819443,.09,20.551008],[-96.63649,.09,21.635687]]},
  positions:[-96.900003,.02,20.551008,-96.799443,.09,20.551008,-96.61649,.09,21.635687,-96.900003,.02,21.635687],indices:[0,2,1,0,3,2]};
export function installGroundSeams({scene=null,RAPIER,zonePhysics}){
  if(!zonePhysics?.zones.has('outer')||!zonePhysics.zones.has('fangbang'))return null;
  if(zonePhysics.pavingSeamOwner)return zonePhysics.pavingSeamOwner;
  const positions=new Float32Array(STREET_SEAM.positions),indices=new Uint32Array(STREET_SEAM.indices);
  const added=addGroundCollider(RAPIER,zonePhysics.physics.world,{positions,indices});
  zonePhysics.groundColliders.push(added.collider);zonePhysics.physics.groundTriangleCount+=2;
  let mesh=null,geometry=null,material=null;
  if(scene){geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setIndex(new T.BufferAttribute(indices,1));geometry.computeVertexNormals();
    material=new T.MeshStandardMaterial({color:0xb9b6aa,roughness:.94});mesh=new T.Mesh(geometry,material);mesh.name=STREET_SEAM.id;mesh.receiveShadow=true;scene.add(mesh);}
  zonePhysics.physics.world.step();let disposed=false;
  const owner={mesh,collider:added.collider,dispose(){if(disposed)return;disposed=true;mesh?.removeFromParent();geometry?.dispose();material?.dispose();
    removeColliderWithBody(zonePhysics.physics.world,added.collider,added.body);const index=zonePhysics.groundColliders.indexOf(added.collider);if(index>=0)zonePhysics.groundColliders.splice(index,1);
    zonePhysics.physics.groundTriangleCount-=2;if(zonePhysics.pavingSeamOwner===owner)zonePhysics.pavingSeamOwner=null;}};
  zonePhysics.pavingSeamOwner=owner;return owner;
}
