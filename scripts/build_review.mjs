import {spawnSync} from 'node:child_process';
import {readFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const built=spawnSync(resolve(root,'node_modules/.bin/vite'),['build'],{cwd:root,stdio:'inherit'});
if(built.status!==0)process.exit(built.status??1);
const catalog=JSON.parse(await readFile(resolve(root,'world/asset-catalog.json'),'utf8'));
const files=['world/instances.json','world/segment.json','world/segment-spec.json','world/asset-catalog.json','world/cameras.json','world/render-setup.json','world/review-manifest.json','world/collision-world.json','world/route.json','world/street-kit.glb','world/street-reviewed.glb'];
for(const item of catalog.modules){if(!/^[a-z0-9_-]+$/.test(item.id))throw Error('Invalid module id');files.push(`building/${item.id}/model.glb`);}
for(const f of files){const dest=resolve(root,'dist',f);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(root,f),dest);}
// lane-B candidate dataset (N5): copied whole
const lanebDir=resolve(root,'world/laneb');
await mkdir(resolve(root,'dist/world/laneb'),{recursive:true});
for(const f of await readdir(lanebDir)){await copyFile(resolve(lanebDir,f),resolve(root,'dist/world/laneb',f));}
console.log(`Strict review build copied ${files.length} required files + world/laneb; errors are not suppressed.`);
