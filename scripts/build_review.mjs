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
// street-completion candidate dataset (?world=street-completion): same strict
// required-file list; surface.glb is required too (visible pavement = ground)
const scFiles=['world/street-completion/review-manifest.json','world/street-completion/instances.json','world/street-completion/collision-world.json','world/street-completion/blocks.json','world/street-completion/route.json','world/street-completion/cameras.json','world/street-completion/surface.glb','world/street-completion/surface-spec.json','world/street-completion/next-four-design.snapshot.json'];
const scBlocks=JSON.parse(await readFile(resolve(root,'world/street-completion/blocks.json'),'utf8'));
for(const b of scBlocks.blocks){
  // the verbatim east-edge block keeps pointing at world/east-edge/* (already
  // whitelisted above); only collect assets that live in this dataset
  if(b.kind!=='assets'||b.id==='block-east-edge-shops')continue;
  for(const a of b.assets){
    for(const p of [a.glb,a.collision]){
      if(typeof p!=='string'||!p.startsWith('./world/street-completion/'))throw Error(`street-completion asset path escapes the dataset dir: ${p}`);
      scFiles.push(p.slice(2));
    }
  }
}
if(!scFiles.some(f=>f.endsWith('surface.glb')))throw Error('street-completion dataset lacks surface.glb — the tail would have no walkable ground');
files.push(...scFiles);
// standalone temple pilot dataset (?world=temple page: temple.html): same strict
// required-file list so a clean dist either carries the whole pilot or fails
const templeFiles=['world/temple-shanmen/review-manifest.json','world/temple-shanmen/cameras.json','world/temple-shanmen/collision-world.json','world/temple-shanmen/temple.glb','world/temple-shanmen/ground.glb','world/temple-shanmen/lions.glb','world/temple-shanmen/ornaments.glb'];
files.push(...templeFiles);
for(const f of files){
  const dest=resolve(root,'dist',f);
  await mkdir(dirname(dest),{recursive:true});
  await copyFile(resolve(root,f),dest);
  const [src,dst]=await Promise.all([stat(resolve(root,f)),stat(dest)]);
  if(src.size!==dst.size)throw Error(`build copy size mismatch: ${f} ${src.size} -> ${dst.size}`);
}
console.log(`Strict review build copied ${files.length} required files incl. ${eastEdgeFiles.length} east-edge + ${scFiles.length} street-completion + ${templeFiles.length} temple pilot dataset files + world/laneb; errors are not suppressed.`);
// the pilot entry must exist in dist (vite emits it as a second rollup input)
const{existsSync}=await import('node:fs');
if(!existsSync(resolve(root,'dist/temple.html')))throw Error('dist/temple.html missing — the standalone pilot entry never reached the build');

// ---- closeout batch 20260919: the OFFICIAL build carries the full current
// world closure. The adoption-era flow relied on verify_all.sh doing
// `cp -r world building dist/` AFTER `npm run build`, so a plain build output
// was NOT the deliverable page set. Now every world/ dataset is copied whole
// (originals + *.cm.glb variants + manifests + collision/route/cameras),
// with a per-dataset review-manifest presence check so an incomplete
// dataset fails the build instead of 404ing at runtime. *.blend stays out —
// no page ever fetches it and it is most of the dead weight.
const worldDir=resolve(root,'world');
let dsCopied=0, dsFiles=0;
const copyTree=async(srcDir,dstDir)=>{
  for(const f of await readdir(srcDir,{withFileTypes:true})){
    if(f.name.endsWith('.blend'))continue;
    const s=resolve(srcDir,f.name), d=resolve(dstDir,f.name);
    if(f.isDirectory()){await mkdir(d,{recursive:true});await copyTree(s,d);continue;}
    await copyFile(s,d);dsFiles++;
  }
};
for(const e of await readdir(worldDir,{withFileTypes:true})){
  if(!e.isDirectory())continue;
  const dsAbs=resolve(worldDir,e.name);
  if(!existsSync(resolve(dsAbs,'review-manifest.json')))
    throw Error(`world/${e.name}/ has no review-manifest.json — not a loadable dataset; fix or remove it from the closure`);
  await mkdir(resolve(root,'dist/world',e.name),{recursive:true});
  await copyTree(dsAbs,resolve(root,'dist/world',e.name));dsCopied++;
}
// root-level world files: the compressed variants of the root GLBs
for(const f of await readdir(worldDir,{withFileTypes:true})){
  if(f.isFile()&&f.name.endsWith('.cm.glb')){
    await mkdir(resolve(root,'dist/world'),{recursive:true});
    await copyFile(resolve(worldDir,f.name),resolve(root,'dist/world',f.name));dsFiles++;
  }
}
// the version manifest and the v1 hub page are part of the deliverable root
await copyFile(resolve(root,'VERSION.json'),resolve(root,'dist/VERSION.json'));
await copyFile(resolve(root,'index-v1.html'),resolve(root,'dist/index-v1.html'));
if(!existsSync(resolve(root,'dist/temple-v3.html')))throw Error('dist/temple-v3.html missing — the temple-v3 entry is a rollup input since the closeout batch and must reach the build');
console.log(`Closeout world closure: ${dsCopied} datasets / ${dsFiles} dataset files + root cm + VERSION.json + index-v1.html copied into dist (blend excluded).`);
