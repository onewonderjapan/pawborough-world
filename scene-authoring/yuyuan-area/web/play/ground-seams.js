// Reversible paving connectors at measured gaps between zones or GLB meshes.
// Original GLBs and global ground/drop limits remain unchanged.
import * as T from 'three';
import {addGroundCollider,removeColliderWithBody} from '../../../../src/world/physics.js';

export const STREET_SEAM={
  id:'outer-fangbang-stone-join',
  sourceEdges:{
    outerX:-96.800003,outerY:.02,
    fangbang:[[-96.819443,.09,20.551008],[-96.63649,.09,21.635687]]
  },
  positions:[-96.900003,.02,20.551008,-96.799443,.09,20.551008,-96.61649,.09,21.635687,-96.900003,.02,21.635687],
  indices:[0,2,1,0,3,2],
  materialColor:0xb9b6aa,
  roughness:0.94
};

export const RETURN_SEAM={
  id:'fangbang-asphalt-return-join',
  geometryKind:'narrow measured edge connector, not its filled AABB',
  positions:[
    50.203534934997556,0.001,-20.76095962524414,
    50.23045665103786,0.001,-20.76095962524414,
    51.611588019416956,0.001,-16.74704663054206,
    51.60758801941695,0.001,-16.74704663054206
  ],
  indices:[0,2,1,0,3,2],
  bounds:{
    minX:50.203534934997556,
    maxX:51.611588019416956,
    minZ:-20.76095962524414,
    maxZ:-16.74704663054206
  },
  topY:0.001,
  sideOverlapX:0.002,
  approxAreaM2:0.06205853891634566,
  materialColor:0x565247,
  roughness:0.92
};

export function installGroundSeams({scene=null,RAPIER,zonePhysics}){
  if(!zonePhysics?.zones?.has('fangbang'))return null;
  if(zonePhysics.pavingSeamOwner)return zonePhysics.pavingSeamOwner;

  const patches=[];
  if(zonePhysics.zones.has('outer'))patches.push(STREET_SEAM);
  patches.push(RETURN_SEAM);

  const meshes=[],colliders=[],addedItems=[];
  let totalTriangles=0;

  for(const patch of patches){
    const positions=new Float32Array(patch.positions);
    const indices=new Uint32Array(patch.indices);
    const added=addGroundCollider(RAPIER,zonePhysics.physics.world,{positions,indices});
    zonePhysics.groundColliders.push(added.collider);
    const triCount=indices.length/3;
    zonePhysics.physics.groundTriangleCount+=triCount;
    totalTriangles+=triCount;
    colliders.push(added.collider);
    addedItems.push(added);

    if(scene){
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.BufferAttribute(positions,3));
      geometry.setIndex(new T.BufferAttribute(indices,1));
      geometry.computeVertexNormals();
      const material=new T.MeshStandardMaterial({color:patch.materialColor,roughness:patch.roughness});
      const mesh=new T.Mesh(geometry,material);
      mesh.name=patch.id;
      mesh.receiveShadow=true;
      scene.add(mesh);
      meshes.push(mesh);
    }
  }

  zonePhysics.physics.world.step();
  let disposed=false;

  const owner={
    mesh:meshes[0]??null,
    meshes,
    collider:colliders[0]??null,
    colliders,
    dispose(){
      if(disposed)return;
      disposed=true;
      for(const m of meshes){
        m.removeFromParent();
        m.geometry?.dispose();
        m.material?.dispose();
      }
      for(const item of addedItems){
        removeColliderWithBody(zonePhysics.physics.world,item.collider,item.body);
        const index=zonePhysics.groundColliders.indexOf(item.collider);
        if(index>=0)zonePhysics.groundColliders.splice(index,1);
      }
      zonePhysics.physics.groundTriangleCount-=totalTriangles;
      if(zonePhysics.pavingSeamOwner===owner)zonePhysics.pavingSeamOwner=null;
    }
  };

  zonePhysics.pavingSeamOwner=owner;
  return owner;
}
