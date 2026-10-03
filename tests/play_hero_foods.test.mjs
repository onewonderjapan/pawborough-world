// Actual hero resource contracts. Semantic materials are read from rendered
// primitives, not merely from the global materials array.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const area=new URL('../scene-authoring/yuyuan-area/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('inputs/play-foods.json',area),'utf8'));
const ids=['xiaolongbao','xiajiao','changfen','congyoubing','roujiamo','boboji','luosifen','portuguese-egg-tart'];
function binary(id){const a=manifest.foods.find(a=>a.id===id),buf=readFileSync(new URL(a.path,area));const n=buf.readUInt32LE(12);return {a,buf,g:JSON.parse(buf.subarray(20,20+n).toString())};}
function materialsFor(g,nodeName){const names=new Set();const visit=i=>{const n=g.nodes[i];if(n.mesh!=null)for(const p of g.meshes[n.mesh].primitives)names.add(g.materials[p.material]?.name);for(const child of n.children??[])visit(child);};const index=g.nodes.findIndex(n=>n.name===nodeName);assert.ok(index>=0,nodeName+' exists');visit(index);return [...names];}
function checkNoodleLayers(g){const names=materialsFor(g,'edible');for(const token of ['noodle','scallion','bamboo','oil'])assert.ok(names.some(n=>n.includes(token)), 'rendered edible preserves '+token+' material');}
for(const id of ids){const{buf,g}=binary(id);assert.ok(buf.length<=1572864,id+' byte budget');let triangles=0;for(const m of g.meshes)for(const p of m.primitives)triangles+=(p.indices==null?g.accessors[p.attributes.POSITION].count:g.accessors[p.indices].count)/3;assert.ok(triangles<=20000,id+' low geometry budget');assert.ok(g.materials.length<=8,id+' material budget');assert.ok(!g.nodes.some(n=>n.name?.startsWith('SCULPT_HIGH_')),id+' high source excluded');assert.ok((g.images?.length??0)>=2,id+' portable texture images');assert.ok(g.images.every(i=>i.bufferView!=null),id+' embedded textures');console.log('PASS hero binary',id,triangles,buf.length);}
const noodle=binary('luosifen').g;checkNoodleLayers(noodle);
// A fully red edible mesh must fail even while all declared materials remain.
const bad=structuredClone(noodle),oil=bad.materials.findIndex(m=>m.name.includes('mat_oil'));for(const m of bad.meshes)for(const p of m.primitives)p.material=oil;assert.throws(()=>checkNoodleLayers(bad),/preserves/,'single-material negative control');
const bobo=binary('boboji').g;assert.ok(materialsFor(bobo,'container').some(n=>n.includes('cobalt')),'blue bowl rim preserved');for(const token of ['chicken','lotus','green_veg'])assert.ok(materialsFor(bobo,'edible').some(n=>n.includes(token)),'bobo ingredient '+token);
console.log('ALL HERO RESOURCE CONTRACTS PASS');
