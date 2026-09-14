import {spawnSync} from 'node:child_process';
import {readFile,mkdir,copyFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const built=spawnSync(resolve(root,'node_modules/.bin/vite'),['build'],{cwd:root,stdio:'inherit'});
if(built.status!==0)process.exit(built.status??1);
const catalog=JSON.parse(await readFile(resolve(root,'world/asset-catalog.json'),'utf8'));
const files=['world/instances.json','world/segment.json','world/segment-spec.json','world/asset-catalog.json','world/blocks.json','world/cameras.json','world/render-setup.json','world/review-manifest.json','world/collision-world.json','world/route.json','world/street-kit.glb','world/street-reviewed.glb'];
for(const item of catalog.modules){if(!/^[a-z0-9_-]+$/.test(item.id))throw Error('Invalid module id');files.push(`building/${item.id}/model.glb`);}
// lane-B candidate dataset (N5): copied whole
const lanebDir=resolve(root,'world/laneb');
await mkdir(resolve(root,'dist/world/laneb'),{recursive:true});
for(const f of await readdir(lanebDir)){await copyFile(resolve(lanebDir,f),resolve(root,'dist/world/laneb',f));}
// east-edge candidate dataset (block-level replacement, ?world=east-edge):
// strict required-file list so a clean build either carries the whole
// dependency set or fails — a dist without it silently serves the frozen
// 16-façade world and the candidate can never reach lead review (R1).
const eastEdgeFiles=['world/east-edge/review-manifest.json','world/east-edge/instances.json','world/east-edge/collision-world.json','world/east-edge/blocks.json','world/east-edge/route.json','world/east-edge/cameras.json','world/east-edge/design-spec.snapshot.json'];
// GLB/collision sidecars come from the dataset itself, not a hardcoded list
const eeBlocks=JSON.parse(await readFile(resolve(root,'world/east-edge/blocks.json'),'utf8'));
for(const b of eeBlocks.blocks){
  if(b.kind!=='assets')continue;
  for(const a of b.assets){
    for(const p of [a.glb,a.collision]){
      if(typeof p!=='string'||!p.startsWith('./world/east-edge/'))throw Error(`east-edge asset path escapes the dataset dir: ${p}`);
      eastEdgeFiles.push(p.slice(2));
    }
  }
}
if(!eastEdgeFiles.some(f=>f.endsWith('.glb')))throw Error('east-edge dataset declares no asset GLBs — refusing to build an empty candidate');
files.push(...eastEdgeFiles);
for(const f of files){
  const dest=resolve(root,'dist',f);
  await mkdir(dirname(dest),{recursive:true});
  await copyFile(resolve(root,f),dest);
  const [src,dst]=await Promise.all([stat(resolve(root,f)),stat(dest)]);
  if(src.size!==dst.size)throw Error(`build copy size mismatch: ${f} ${src.size} -> ${dst.size}`);
}
console.log(`Strict review build copied ${files.length} required files incl. ${eastEdgeFiles.length} east-edge dataset files + world/laneb; errors are not suppressed.`);
