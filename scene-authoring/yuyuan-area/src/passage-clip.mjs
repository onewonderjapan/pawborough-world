import * as THREE from 'three';
// Subtract convex vertical prisms from triangle soup; interpolate every vertex attribute.
// Retains winding and normals. Cut-wall/soffit geometry is emitted separately from groundFootprints.
export function cutPassages(input, passages) {
 let g=input.index?input.toNonIndexed():input;
 const attrs=Object.keys(g.attributes),sizes=attrs.map(k=>g.attributes[k].itemSize);
 let polygons=[];
 for(let i=0;i<g.attributes.position.count;i+=3){
  polygons.push([0,1,2].map(j=>Object.fromEntries(attrs.map(k=>[k,Array.from(g.attributes[k].array.slice((i+j)*g.attributes[k].itemSize,(i+j+1)*g.attributes[k].itemSize))]))));
 }
 function split(poly,plane){
  const inside=[],outside=[];const val=v=>plane[0]*v.position[0]+plane[1]*v.position[1]+plane[2]*v.position[2]+plane[3];
  for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length],da=val(a),db=val(b);
   (da>=0?inside:outside).push(a);
   if((da>0&&db<0)||(da<0&&db>0)){
    const t=da/(da-db),v=Object.fromEntries(attrs.map(k=>[k,a[k].map((x,j)=>x+(b[k][j]-x)*t)]));inside.push(v);outside.push(v);
   }
  }return [inside,outside];
 }
 for(const p of passages)for(const rect of p.rectangles){
  const cx=rect.reduce((s,a)=>s+a[0],0)/4,cz=rect.reduce((s,a)=>s+a[1],0)/4;
  const planes=rect.map((a,i)=>{const b=rect[(i+1)%4];let nx=-(b[1]-a[1]),nz=b[0]-a[0],d=-nx*a[0]-nz*a[1];if(nx*cx+nz*cz+d<0){nx=-nx;nz=-nz;d=-d;}return[nx,0,nz,d];});
  planes.push([0,1,0,-.06],[0,-1,0,p.clearHeight]);
  const next=[];
  for(const poly of polygons){
   if(planes.some(pl=>poly.every(v=>pl[0]*v.position[0]+pl[1]*v.position[1]+pl[2]*v.position[2]+pl[3]<-1e-8))){next.push(poly);continue;}
   let remainder=poly;
   for(const pl of planes){const [inside,outside]=split(remainder,pl);if(outside.length>=3)next.push(outside);remainder=inside;if(remainder.length<3)break;}
  }polygons=next;
 }
 const arrays=Object.fromEntries(attrs.map(k=>[k,[]]));
 for(const p of polygons)for(let i=1;i<p.length-1;i++){
  const vs=[p[0],p[i],p[i+1]],a=new THREE.Vector3(...vs[0].position),b=new THREE.Vector3(...vs[1].position),c=new THREE.Vector3(...vs[2].position);
  if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-16)continue;
  for(const v of vs)for(const k of attrs)arrays[k].push(...v[k]);
 }
 const out=new THREE.BufferGeometry();attrs.forEach((k,i)=>out.setAttribute(k,new THREE.Float32BufferAttribute(arrays[k],sizes[i])));return out;
}
