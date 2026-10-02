// Owned finish layer for the adopted gray-cat asset; no identity/rig replacement.
import * as THREE from 'three';
export function installCharacterArt(avatar) {
  const changes=[],materials=new Map(),glints=[],spine=avatar.model.getObjectByName('spine');
  avatar.root.updateMatrixWorld(true);
  avatar.model.traverse(o=>{
    if(!o.isMesh||Array.isArray(o.material))return;
    const original=o.material;
    if(!materials.has(original)){
      const m=new THREE.MeshPhysicalMaterial();THREE.MeshStandardMaterial.prototype.copy.call(m,original);m.defines={STANDARD:'',PHYSICAL:''};
      if(original.name==='coat'){m.roughness=.88;m.sheen=.55;m.sheenColor.set('#c5c5c3');m.sheenRoughness=.9;m.specularIntensity=.16;}
      else if(original.name==='eye'){m.roughness=.09;m.clearcoat=1;m.clearcoatRoughness=.08;m.specularIntensity=.8;}
      else if(original.name==='nose'){m.roughness=.42;m.clearcoat=.2;}
      materials.set(original,m);
    }
    changes.push({o,original});o.material=materials.get(original);
  });
  const geometry=new THREE.SphereGeometry(1,12,8),material=new THREE.MeshBasicMaterial({color:0xfffbef,toneMapped:false});
  if(spine)for(const name of['cat_eyeL','cat_eyeR']){
    const eye=avatar.model.getObjectByName(name);if(!eye)continue;
    const box=new THREE.Box3().setFromObject(eye,true),center=box.getCenter(new THREE.Vector3());
    for(const [dx,dy,r]of[[-.005,.006,.0036],[.005,-.003,.0016]]){
      const glint=new THREE.Mesh(geometry,material);glint.name='plush-eye-catchlight';glint.raycast=()=>{};
      const target=new THREE.Vector3(center.x+dx,center.y+dy,box.max.z),v=new THREE.Vector3();let vertex=0,best=Infinity;
      for(let i=0;i<eye.geometry.attributes.position.count;i++){eye.getVertexPosition(i,v).applyMatrix4(eye.matrixWorld);const d=v.distanceToSquared(target);if(d<best){best=d;vertex=i;}}
      glint.scale.set(r,r,.0015);avatar.root.add(glint);glints.push({mesh:glint,eye,vertex});
    }
  }
  let disposed=false;
  return {update(){for(const g of glints){const dict=g.eye.morphTargetDictionary,w=g.eye.morphTargetInfluences;g.mesh.visible=!w||Math.max(w[dict?.sleepy]??0,w[dict?.happy]??0)<.65;g.eye.skeleton?.update();const p=g.eye.getVertexPosition(g.vertex,new THREE.Vector3()).applyMatrix4(g.eye.matrixWorld);p.add(new THREE.Vector3(0,0,.001).applyQuaternion(avatar.root.getWorldQuaternion(new THREE.Quaternion())));g.mesh.position.copy(avatar.root.worldToLocal(p));}},dispose(){if(disposed)return;disposed=true;for(const {o,original}of changes)o.material=original;for(const m of materials.values())m.dispose();for(const g of glints)g.mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
