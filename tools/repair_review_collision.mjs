// Collision-only repair: never rebuild/delete GLBs, routes or active render inputs.
import { readFile, writeFile } from 'node:fs/promises';
import { obbToWorld } from '../src/world/collisionAdapter.js';
const root = new URL('../', import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const write = async (p, j) => {
  const text = await readFile(new URL(p, root), 'utf8');
  const indent = text.match(/\n( +)"/)?.[1].length ?? 2;
  await writeFile(new URL(p, root), JSON.stringify(j, null, indent) + '\n');
};
const bounds = (r) => {
  const { center: p, halfExtents: h, yaw } = obbToWorld(r);
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const e = [c*h[0]+s*h[2], h[1], s*h[0]+c*h[2]];
  return { ...r, min: p.map((v,i)=>v-e[i]), max: p.map((v,i)=>v+e[i]) };
};
const localPath = 'kit/out/yimen-stage/collision.json';
const local = await read(localPath), cfg = await read('kit/yimen-stage.config.json');
local.colliders = local.colliders.filter(c=>c.name !== 'stage-wing-wall');
const w = cfg.wingWalls;
for (const side of [-1, 1]) {
  const center = [side*(Math.abs(w.xM[1])-.09), w.topY/2, (w.zLocal[0]+w.zLocal[1])/2];
  const size = [.18, w.topY, Math.abs(w.zLocal[1]-w.zLocal[0])];
  local.colliders.push({ name:'stage-wing-wall', group:'yimen-stage-body', type:'box', center, size });
}
local.colliders = local.colliders.map(r=>bounds({ ...r, obb: r.obb ?? { pos:[0,0,0], theta:0, center:r.center, size:r.size } }));
await write(localPath,local);
const axisPath = 'world/temple-axis-v3/collision-world.json';
const axis = await read(axisPath);
axis.colliders = axis.colliders.filter(c=>c.name!=='yimenstage:stage-wing-wall');
const inst = (await read('world/temple-axis-v3/instances.json')).instances.find(i=>i.id==='yimenstage');
const added = local.colliders.map(r=>bounds({ ...r, name:'yimenstage:'+r.name,
  obb: { ...r.obb, pos:inst.positionGlb, theta:inst.rotationYRad } }));
axis.colliders.push(...added.filter(c=>c.name==='yimenstage:stage-wing-wall'));
await write(axisPath,axis);
const v4Path = 'world/fangbang-temple-v4/collision-world.json', v4 = await read(v4Path);
// Use the established instance transform, avoiding a second placement authority.
const old = v4.colliders.find(c=>c.name==='yimenstage:stage-column');
const src = added.find(c=>c.name==='yimenstage:stage-column');
const yaw = old.obb.theta, co=Math.cos(yaw), si=Math.sin(yaw);
const wc=obbToWorld(old).center, lc=src.obb.center;
const anchor=[wc[0]-co*lc[0]-si*lc[2], wc[1]-lc[1], wc[2]+si*lc[0]-co*lc[2]];
v4.colliders = v4.colliders.filter(c=>c.name!=='yimenstage:stage-wing-wall');
v4.colliders.push(...local.colliders.filter(r=>r.name==='stage-wing-wall').map(r=>bounds({ ...r, name:'yimenstage:'+r.name,
  obb:{...r.obb,pos:anchor,theta:yaw} })));
let fixedY=0;
for (const r of v4.colliders) {
  const b=bounds(r);
  if(Math.abs(r.min[1]-b.min[1])>1e-5 || Math.abs(r.max[1]-b.max[1])>1e-5)fixedY++;
  r.min[1]=b.min[1];r.max[1]=b.max[1];
}
await write(v4Path,v4);
console.log(JSON.stringify({stageRecords:added.length,correctedY:fixedY,axisColliders:axis.colliders.length,v4Colliders:v4.colliders.length}));
