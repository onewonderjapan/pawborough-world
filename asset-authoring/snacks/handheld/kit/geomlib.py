"""Shared procedural primitives for Pawborough props. Design coords: GLB Y-up; Blender Z-up internally.
Import inside Blender. Materials live in M (key -> bpy material) and META (records for materials.json)."""
import bpy,bmesh,math
from pathlib import Path
from mathutils import Vector
from helpers import box_glb,glb_to_blender
M={};META={};TEX=Path('.');GROUP=['misc']
def lin(hex):
 a=[int(hex[i:i+2],16)/255 for i in (0,2,4)]
 return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a]
def mat(key,name,color='ffffff',rough=.8,metal=0,tile=(1,1),base=None,normal=None,roughmap=None,source=None,alpha=None,clamp=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*lin(color),1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if alpha is not None:p.inputs['Alpha'].default_value=alpha;m.blend_method='BLEND'
 paths={}
 if base:paths['color']=TEX/base
 if normal:paths['normal']=TEX/normal
 if roughmap:paths['roughness']=TEX/roughmap
 for ch,path in paths.items():
  t=n.new('ShaderNodeTexImage');t.extension='EXTEND' if clamp else 'REPEAT';t.image=bpy.data.images.load(str(path),check_existing=True);t.image.colorspace_settings.name='sRGB' if ch=='color' else 'Non-Color';t.image.pack()
  if ch=='normal':
   norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.65;l.new(t.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],p.inputs['Normal'])
  elif ch=='roughness':l.new(t.outputs['Color'],p.inputs['Roughness'])
  else:l.new(t.outputs['Color'],p.inputs['Base Color'])
 META[name]={'tileMeters':list(tile),'colorSrgb':color,'roughness':rough,'metallic':metal,'alpha':alpha,'textures':{k:path.name for k,path in paths.items()},'normalConvention':'OpenGL','source':source or 'locally authored / constant material'}
 M[key]=m;return m
def tag(o):o['part']=GROUP[0];return o
def box(name,c,s,m,bevel=.004):
 if max(s)/min(s)>55:bevel=0
 return tag(box_glb(name,c,s,M[m],META[M[m].name]['tileMeters'],bevel))
def mesh(name,verts,faces,m,uvs=None,face_mats=None,smooth=False):
 me=bpy.data.meshes.new(name);me.from_pydata([glb_to_blender(v) for v in verts],[],faces);me.update()
 mats=[m] if isinstance(m,str) else list(m)
 for k in mats:me.materials.append(M[k])
 if face_mats:
  for p,idx in zip(me.polygons,face_mats):p.material_index=idx
 uv=me.uv_layers.new(name='UVMap')
 if uvs:
  for p in me.polygons:
   for li in p.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
 else:
  tile=META[M[mats[0]].name]['tileMeters']
  for p in me.polygons:
   for li in p.loop_indices:
    v=verts[me.loops[li].vertex_index];normal=p.normal;axis=max(range(3),key=lambda k:abs(normal[k]))
    a,b=((v[2],v[1]) if axis==0 else (v[0],v[1]) if axis==1 else (v[0],v[2]));uv.data[li].uv=(a/tile[0],b/tile[1])
 if smooth:
  for p in me.polygons:p.use_smooth=True
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return tag(o)
def cyl(name,a,b,r,m,sides=10):
 va,vb=glb_to_blender(a),glb_to_blender(b);d=vb-va
 bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=d.length,location=(va+vb)/2)
 o=bpy.context.object;o.name=name;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(M[m]);return tag(o)
def rod(name,a,b,w,m):return cyl(name,a,b,w,m,6)
# Winding: quad (a, d, c, b) with a,b on the lower ring, d,c above faces outward (counter-clockwise seen from +Y).
def lathe(name,origin,rings,m,sides=24,pleats=0,twist=0,cap_bottom=True,cap_top=True,mat_by_y=None,uv_top_planar=None,smooth=True,uvscale=1.0,scale_x=1.0,axis='y',bumps=None):
 """rings=[(y,r,amp)...] bottom to top; r==0 -> apex. amp modulates r by cos(pleats*theta).
 axis='z' lays the solid along +Z (origin = axis start, centred on y). bumps=(count,amp) adds a second lobe pattern."""
 ox,oy,oz=origin;verts=[];uvs=[];faces=[];idx=[];n=len(rings)
 def place(rc,h,rs):
  if axis=='z':return (ox+rc*scale_x,oy+rs,oz+h)
  return (ox+rc*scale_x,oy+h,oz+rs)
 def uv_of(v,i,t):
  if uv_top_planar:return ((v[0]-ox)/uv_top_planar+.5,((v[2]-oz) if axis=='y' else (v[1]-oy))/uv_top_planar+.5)
  return (i/sides*uvscale,t*uvscale)
 for j,(y,r,amp) in enumerate(rings):
  t=j/(n-1)
  if r<=0:
   idx.append([len(verts)]*sides);verts.append(place(0,y,0));uvs.append(uv_of(verts[-1],0,t))
  else:
   base=len(verts);idx.append(list(range(base,base+sides)))
   for i in range(sides):
    th=2*math.pi*i/sides+twist*t;rr=r*(1+amp*math.cos(pleats*th)) if pleats else r
    if bumps:rr*=1+bumps[1]*math.cos(bumps[0]*th)
    v=place(rr*math.cos(th),y,rr*math.sin(th));verts.append(v);uvs.append(uv_of(v,i,t))
 for j in range(n-1):
  lo,hi=idx[j],idx[j+1]
  for i in range(sides):
   a,b=lo[i],lo[(i+1)%sides];d,c=hi[i],hi[(i+1)%sides]
   if a==b:
    if d!=c:faces.append((a,d,c))
   elif d==c:faces.append((a,d,b))
   else:faces.append((a,d,c,b))
 def cap(j,top):
  cidx=len(verts);verts.append(place(0,rings[j][0],0));uvs.append((.5,.5) if uv_top_planar else (.5,1 if top else 0))
  for i in range(sides):
   a=idx[j][i];b=idx[j][(i+1)%sides];faces.append((cidx,b,a) if top else (cidx,a,b))
 if cap_bottom and rings[0][1]>0:cap(0,False)
 if cap_top and rings[-1][1]>0:cap(n-1,True)
 if axis=='z':faces=[tuple(reversed(f)) for f in faces]   # y/z swap is a reflection
 fm=None
 if mat_by_y:
  thr,lo_i,hi_i=mat_by_y;key=1 if axis=='y' else 2;o0=oy if axis=='y' else oz
  fm=[lo_i if sum(verts[k][key]-o0 for k in f)/len(f)<thr else hi_i for f in faces]
 return mesh(name,verts,faces,m,uvs,fm,smooth)
def band(name,origin,R,y0,y1,m,sides=32,uv_rep=4):
 ox,oy,oz=origin;verts=[];uvs=[]
 for y in (y0,y1):
  for i in range(sides):
   th=2*math.pi*i/sides;verts.append((ox+R*math.cos(th),oy+y,oz+R*math.sin(th)));uvs.append((i/sides*uv_rep,0 if y==y0 else 1))
 return mesh(name,verts,[(i,i+sides,(i+1)%sides+sides,(i+1)%sides) for i in range(sides)],m,uvs,None,True)
def ring_shell(name,origin,R,h,thick,m,sides=32,y0=0,inner_floor=None):
 ox,oy,oz=origin;verts=[];uvs=[];faces=[];ib=inner_floor if inner_floor is not None else y0
 levels=[(y0,R),(y0+h,R),(y0+h,R-thick),(ib,R-thick)]
 for j,(y,r) in enumerate(levels):
  for i in range(sides):
   th=2*math.pi*i/sides;verts.append((ox+r*math.cos(th),oy+y,oz+r*math.sin(th)));uvs.append((i/sides*4,(y-y0)/h))
 for j in range(len(levels)-1):
  for i in range(sides):
   a=j*sides+i;b=j*sides+(i+1)%sides;c=b+sides;d=a+sides;faces.append((a,d,c,b))
 return mesh(name,verts,faces,m,uvs,None,True)
def disc(name,origin,r,thick,m,sides=32,tilt=0.0,axis='x',scale_x=1.0):
 ox,oy,oz=origin;verts=[];uvs=[];faces=[];ct,st=math.cos(tilt),math.sin(tilt)
 def tr(x,y,z):
  x*=scale_x
  if axis=='x':return (ox+x,oy+y*ct-z*st,oz+y*st+z*ct)
  return (ox+x*ct-y*st,oy+x*st+y*ct,oz+z)
 for y in (0,thick):
  for i in range(sides):
   th=2*math.pi*i/sides;x,z=r*math.cos(th),r*math.sin(th);verts.append(tr(x,y,z));uvs.append((x/(2*r)+.5,z/(2*r)+.5))
 for i in range(sides):
  a=i;b=(i+1)%sides;faces.append((a,a+sides,b+sides,b))
 for top in (False,True):
  cidx=len(verts);verts.append(tr(0,thick if top else 0,0));uvs.append((.5,.5));base=sides if top else 0
  for i in range(sides):
   a=base+i;b=base+(i+1)%sides;faces.append((cidx,b,a) if top else (cidx,a,b))
 return mesh(name,verts,faces,m,uvs,None,False)
def vessel(name,origin,profile,m,rim_mat=None,rim_from=None,sides=32,thick=.004):
 """Open vessel (bowl/plate/jar) from an OUTER profile [(y,r)...] bottom->top; inner wall follows at -thick.
 rim_mat paints faces above rim_from (height) with a second material (e.g. blue rim on porcelain)."""
 outer=[(y,r,0) for y,r in profile];top_y,top_r=profile[-1]
 inner=[(top_y,top_r-thick,0)]+[(max(y-thick,thick),max(r-thick,.002),0) for y,r in reversed(profile[1:])]+[(thick,0,0)]
 rings=outer+inner
 mats=[m] if rim_mat is None else [m,rim_mat]
 o=lathe(name,origin,rings,mats,sides,cap_bottom=True,cap_top=False,smooth=True,uvscale=2)
 if rim_mat is not None:
  ox,oy,oz=origin;me=o.data
  for p in me.polygons:
   c=p.center;   # blender coords: z is up
   if c.z-oy>=rim_from:p.material_index=1
 return o
def sphere(name,origin,r,m,sides=16,rings=8,squash=1.0,scale_x=1.0,uv_top_planar=None):
 rr=[(r*(1-math.cos(math.pi*j/rings))*squash,r*math.sin(math.pi*j/rings),0) for j in range(rings+1)]
 rr[0]=(0,0,0);rr[-1]=(2*r*squash,0,0)
 return lathe(name,origin,rr,m,sides,cap_bottom=False,cap_top=False,smooth=True,scale_x=scale_x,uv_top_planar=uv_top_planar)
def ring_positions(radii_counts,phase=7):
 pts=[(0,0)]
 for r,cnt in radii_counts:
  for i in range(cnt):
   a=2*math.pi*i/cnt+r*phase;pts.append((r*math.cos(a),r*math.sin(a)))
 return pts
def join(items,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in items:o.select_set(True)
 bpy.context.view_layer.objects.active=items[0]
 if len(items)>1:bpy.ops.object.join()
 o=bpy.context.object;o.name=name
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 bpy.ops.object.select_all(action='DESELECT');return o
