"""Ray-check actual final GLB geometry, independently of layout footprint declarations."""
import bpy,os,json,math,hashlib,sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
R=Path(__file__).resolve().parents[1];O=R/os.environ.get('OUT_DIR','out')
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(O/'scene-areas.glb'));bpy.context.view_layer.update()
verts=[];faces=[];owners=[];projected=[]
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 me=o.data;me.calc_loop_triangles();base=len(verts);world=[o.matrix_world@v.co for v in me.vertices];verts.extend(world);faces.extend(tuple(base+i for i in t.vertices) for t in me.loop_triangles);owners.extend([o.name+' parents='+str([a.name for a in [o.parent,o.parent.parent if o.parent else None] if a])]*len(me.loop_triangles))
 for tri in me.loop_triangles:
  poly=[world[i] for i in tri.vertices]
  if min(v.z for v in poly)>2.5 or max(v.z for v in poly)<.15:continue
  for level,sign in [(.15,1),(2.5,-1)]:
   clipped=[]
   for i,a in enumerate(poly):
    b=poly[(i+1)%len(poly)];da=(a.z-level)*sign;db=(b.z-level)*sign
    if da>=0:clipped.append(a)
    if da*db<0:clipped.append(a+(b-a)*(da/(da-db)))
   poly=clipped
  if len(poly)>=3:projected.append([[round(v.x,5),round(-v.y,5)] for v in poly])
(O/'actual-body-projections.json').write_text(json.dumps({'sourceSha256':hashlib.sha256((O/'scene-areas.glb').read_bytes()).hexdigest(),'heightRangeM':[.15,2.5],'polygons':projected}),encoding='utf-8')
bvh=BVHTree.FromPolygons(verts,faces,all_triangles=True)
probe=[]
for loc in [(-194.71,-251.12),(-194.1,-248),(-179.71,-171.79)]:
 for dir in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0)]:
  hit,n,idx,dist=bvh.ray_cast(Vector((loc[0],-loc[1],1.2)),Vector(dir),10)
  if hit is not None:probe.append({'at':loc,'direction':dir,'hit':owners[idx],'dist':dist})
(O/'passage-probes.json').write_text(json.dumps(probe,ensure_ascii=False,indent=1),encoding='utf-8')
if os.environ.get('PROJECT_ONLY')=='1':
 print('Actual final-GLB body projections saved');sys.exit(0)
routes=json.loads((O/'commercial-route.json').read_text(encoding='utf-8'))['routes'];issues=[];rays=0
for r in routes:
 pts=r['points'];
 if not pts:
  issues.append({'route':r['from']+'->'+r['to'],'kind':'missingRoute'});continue
 name=r['from']+'->'+r['to']
 for a,b in zip(pts,pts[1:]):
  dx,dz=b[0]-a[0],b[1]-a[1];L=math.hypot(dx,dz);nx,nz=-dz/L,dx/L
  for offset in [-1.4,-.7,0,.7,1.4]:
   for h in [.2,1.2,2.4]:
    start=Vector((a[0]+nx*offset,-(a[1]+nz*offset),h));direction=Vector((dx,-dz,0)).normalized()
    hit,normal,idx,dist=bvh.ray_cast(start,direction,L);rays+=1
    if hit is not None:issues.append({'route':name,'kind':'bodyBlocked','at':[round(hit.x,3),round(hit.z,3),round(-hit.y,3)],'offset':offset,'height':h,'mesh':owners[idx]})
  for k in range(math.ceil(L/.6)+1):
   t=min(1,k*.6/L)
   for offset in [-1.4,0,1.4]:
    p=Vector((a[0]+dx*t+nx*offset,-(a[1]+dz*t+nz*offset),.14));hit,normal,idx,dist=bvh.ray_cast(p,Vector((0,0,-1)),.22);rays+=1
    if hit is None:issues.append({'route':name,'kind':'noPaving','at':[round(p.x,3),0,round(-p.y,3)],'offset':offset})
report={'source':'scene-areas.glb reimported with world transforms; BVH from actual triangles','rays':rays,'issueCount':len(issues),'issues':issues[:100],'pass':not issues,'note':'2.8m body band within 3m planned ribbon; ground support and horizontal probes at 0.2/1.2/2.4m; not full physics playtest'}
(O/'route-glb-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=1)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=False));
if issues:raise RuntimeError('Actual GLB path obstruction')
