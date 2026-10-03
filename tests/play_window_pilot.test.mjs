import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import * as T from 'three';import{GLTFLoader}from 'three/addons/loaders/GLTFLoader.js';import{MeshoptDecoder}from 'three/addons/libs/meshopt_decoder.module.js';import{applyWorldArtStyle}from '../scene-authoring/yuyuan-area/web/material-style.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
const area=new URL('../scene-authoring/yuyuan-area/',import.meta.url),style=JSON.parse(await fs.readFile(new URL('inputs/world-art-style.json',area),'utf8'));
test('actual shipped cm bazaar pieces isolate the two glass rectangles and restore geometry/material',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('out-zone/zones-manifest.json',area),'utf8'));let changed=0,inside=0;
 for(const part of manifest.zones.filter(p=>p.id==='bazaar')){
  const b=await fs.readFile(new URL('out-zone/'+part.cm.file,area));const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'GEOMETRY_ONLY_TEST',loadTexture:async()=>new T.Texture()}));
  const g=await new Promise((y,n)=>loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',y,n));g.scene.updateMatrixWorld(true);
  const originals=new Map();g.scene.traverse(m=>{if(m.isMesh&&m.material.name?.startsWith('btk-glass'))originals.set(m,{geometry:m.geometry,material:m.material,count:m.geometry.index?.count??m.geometry.attributes.position.count});});
  const windowStyle={...style,families:style.families.filter(f=>f.id==='center-window-pilot')};const owner=applyWorldArtStyle(g.scene,{style:windowStyle});inside+=owner.stats.insideTriangleCount;
  for(const[m,o]of originals){if(m.geometry===o.geometry)continue;changed++;assert.equal(m.material[0],o.material);assert.equal(m.geometry.index.count,o.count);assert.equal(m.geometry.groups.length,2);assert.equal(m.material[1].map.colorSpace,T.SRGBColorSpace);}
  owner.dispose();owner.dispose();for(const[m,o]of originals){assert.equal(m.geometry,o.geometry);assert.equal(m.material,o.material);}
 }
 assert.ok(changed>0&&changed<=2,`affected shipped glass meshes ${changed}`);assert.ok(inside>0,`actual scoped glass triangles ${inside}`);
});
test('zero eligible triangles allocate no shared material or texture entry',()=>{
 const geom=new T.BufferGeometry();geom.setAttribute('position',new T.Float32BufferAttribute([-1000,0,50,0,0,-1000,1000,0,50],3));const mat=new T.MeshStandardMaterial({name:'facades-wood'}),mesh=new T.Mesh(geom,mat),root=new T.Group();root.add(mesh);const cache=new Map();const s={...style,families:style.families.filter(f=>f.id==='closed-door-lacquer')};const owner=applyWorldArtStyle(root,{style:s,sharedMaterials:cache});assert.equal(cache.size,0);assert.equal(mesh.geometry,geom);assert.equal(mesh.material,mat);owner.dispose();assert.equal(cache.size,0);geom.dispose();mat.dispose();
});
