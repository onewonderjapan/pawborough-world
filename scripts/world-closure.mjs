import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
// Dataset roots have a manifest; reusable asset libraries must be referenced by a dataset.
export async function worldClosure(worldDir){
 const entries=(await readdir(worldDir,{withFileTypes:true})).filter(e=>e.isDirectory());
 const names=new Set(entries.map(e=>e.name)),datasets=new Set(),references=new Set();
 const exists=async p=>{try{return(await stat(p)).isFile();}catch{return false;}};
 for(const e of entries)if(await exists(resolve(worldDir,e.name,'review-manifest.json')))datasets.add(e.name);
 const visit=value=>{if(typeof value==='string'&&/^(\.\/)?world\/[^\s?#]+\.(glb|json)$/.test(value))references.add(value.replace(/^\.\//,''));else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.entries(value).forEach(([key,v])=>{if(key!=='previousFile')visit(v);});};
 for(const name of datasets){
  for(const e of await readdir(resolve(worldDir,name),{withFileTypes:true})){
   if(e.isFile()&&e.name.endsWith('.json'))visit(JSON.parse(await readFile(resolve(worldDir,name,e.name),'utf8')));
  }
 }
 const libraries=new Set();
 for(const ref of references){
  const dest=resolve(worldDir,'..',ref),rel=relative(worldDir,dest);
  if(rel.startsWith('..'+sep)||!(await exists(dest)))throw Error('Referenced world asset missing or outside world: '+ref);
  const name=rel.split(sep)[0];if(names.has(name)&&!datasets.has(name))libraries.add(name);
 }
 for(const e of entries)if(!datasets.has(e.name)&&!libraries.has(e.name))throw Error('Unclassified world directory (no manifest and no dataset reference): '+e.name);
 return {datasets:[...datasets].sort(),libraries:[...libraries].sort(),referencedFiles:references.size};
}
