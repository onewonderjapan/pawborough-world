import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {worldClosure} from '../scripts/world-closure.mjs';
async function fixture({missing=false,orphan=false}={}){
 const root=join(tmpdir(),'pawborough-closure-'+randomUUID(),'world');await mkdir(join(root,'scene'),{recursive:true});await mkdir(join(root,'library'),{recursive:true});
 await writeFile(join(root,'scene','review-manifest.json'),JSON.stringify({model:'./world/library/model.glb'}));
 if(!missing)await writeFile(join(root,'library','model.glb'),'fixture');if(orphan)await mkdir(join(root,'unreferenced'));return root;
}
test('copies referenced asset library without inventing a scene manifest',async()=>{const r=await worldClosure(await fixture());assert.deepEqual(r.datasets,['scene']);assert.deepEqual(r.libraries,['library']);});
test('still fails on missing referenced asset',async()=>{await assert.rejects(worldClosure(await fixture({missing:true})),/Referenced world asset missing/);});
test('still fails on orphan directory',async()=>{await assert.rejects(worldClosure(await fixture({orphan:true})),/Unclassified/);});

test('historical previousFile does not become a live asset requirement',async()=>{const root=await fixture();await writeFile(join(root,'scene','review-manifest.json'),JSON.stringify({model:'./world/library/model.glb',treeV2:{previousFile:'./world/library/retired.glb'}}));assert.deepEqual((await worldClosure(root)).libraries,['library']);});
