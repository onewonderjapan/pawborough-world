// Smooth only the shoulder/underarm transition on an owned posed-skin clone.
// Frozen paw-pad vertices keep the existing real-contact anchors unchanged.
import * as THREE from 'three';
export function smoothPlushShoulders(mesh, geometry) {
  const pos=geometry.attributes.position, si=geometry.attributes.skinIndex, sw=geometry.attributes.skinWeight;
  const bones=mesh.skeleton.bones, count=bones.length, spine=bones.findIndex(b=>b.name==='spine');
  if(spine<0)return;
  const groups=[],lookup=new Map(),vertexGroup=new Uint32Array(pos.count);
  for(let i=0;i<pos.count;i++){
    const key=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(x=>Math.round(x*1e5)).join(',');
    let gi=lookup.get(key);if(gi===undefined){gi=groups.length;lookup.set(key,gi);groups.push({ids:[],p:new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i)),links:new Set(),locked:false});}
    groups[gi].ids.push(i);vertexGroup[i]=gi;
  }
  for(const side of ['armL','armR']){
    const bi=bones.findIndex(b=>b.name===side);if(bi<0)continue;
    const inv=mesh.skeleton.boneInverses[bi],samples=[],v=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){let weight=0;for(let k=0;k<4;k++)if(si.getComponent(i,k)===bi)weight+=sw.getComponent(i,k);v.fromBufferAttribute(pos,i).applyMatrix4(inv);if(weight>=.75&&v.length()>.13)samples.push({i,y:v.y});}
    const low=Math.min(...samples.map(s=>s.y));for(const s of samples)if(s.y<=low+.035)groups[vertexGroup[s.i]].locked=true;
  }
  const idx=geometry.index,n=idx?.count??pos.count;
  for(let i=0;i<n;i+=3){const tri=[0,1,2].map(k=>vertexGroup[idx?idx.getX(i+k):i+k]);for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3];if(a!==b){groups[a].links.add(b);groups[b].links.add(a);}}}
  let weights=groups.map(g=>{const v=new Float64Array(count),i=g.ids[0];for(let k=0;k<4;k++)v[si.getComponent(i,k)]+=sw.getComponent(i,k);return v;});
  const movable=groups.map(g=>!g.locked&&Math.abs(g.p.x)>.145&&Math.abs(g.p.x)<.37&&g.p.y>.10&&g.p.y<.505&&g.p.z>-.09);
  for(let i=0;i<groups.length;i++)if(movable[i]&&groups[i].p.y<.47){for(const name of['earL','earR']){const bi=bones.findIndex(b=>b.name===name);if(bi>=0){weights[i][spine]+=weights[i][bi];weights[i][bi]=0;}}}
  for(let pass=0;pass<48;pass++){
    const next=weights.map((v,i)=>{
      if(!movable[i]||!groups[i].links.size)return v;
      const out=new Float64Array(count);for(let k=0;k<count;k++){let sum=0;for(const j of groups[i].links)sum+=weights[j][k];out[k]=.25*v[k]+.75*sum/groups[i].links.size;}return out;
    });weights=next;
  }
  for(let gi=0;gi<groups.length;gi++){
    if(!movable[gi])continue;
    const ranked=Array.from(weights[gi],(w,b)=>({w,b})).sort((a,b)=>b.w-a.w).slice(0,4),sum=ranked.reduce((s,x)=>s+x.w,0);
    for(const i of groups[gi].ids)for(let k=0;k<4;k++){si.setComponent(i,k,ranked[k]?.b??0);sw.setComponent(i,k,(ranked[k]?.w??0)/sum);}
  }
  si.needsUpdate=true;sw.needsUpdate=true;
}

export function cupPalmVertices(mesh,name) {
  const clusterBone=mesh.skeleton.bones.findIndex(b=>b.name===name);
  if(clusterBone<0)return [];
  const geo=mesh.geometry,inv=mesh.skeleton.boneInverses[clusterBone],v=new THREE.Vector3(),samples=[];
  for(let i=0;i<geo.attributes.position.count;i++){
    let w=0;for(let k=0;k<4;k++)if(geo.attributes.skinIndex.getComponent(i,k)===clusterBone)w+=geo.attributes.skinWeight.getComponent(i,k);
    v.fromBufferAttribute(geo.attributes.position,i).applyMatrix4(inv);
    if(w>=.75&&v.length()>.13)samples.push({i,y:v.y});
  }
  const low=Math.min(...samples.map(s=>s.y));return samples.filter(s=>s.y<=low+.035).map(s=>s.i);
}
