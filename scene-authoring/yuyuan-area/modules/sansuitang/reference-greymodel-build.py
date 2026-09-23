"""三穗堂 grey model (lead design, batch-3 B). Design metres, GLB Y-up, facade +Z (toward garden water), depth -Z,
origin = centre of the front colonnade line at garden ground (y=0). Platform top y=0.55.
Run: blender --background -t 4 --python build.py
"""
import bpy,bmesh,sys,math,json,time
from pathlib import Path
from mathutils import Vector
T0=time.time();ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from helpers import box_glb,glb_to_blender
bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene
D=dict(bays=[3.2,3.4,3.8,3.4,3.2],W=17.0,porch=2.4,bodyDepth=11.3,plinth=0.55,plinthOutFront=1.0,plinthOutSide=0.6,
 colFrontD=0.30,colH=3.4,lowerEave=4.35,lowerOver=1.1,lowerTop=5.6,upperWallIn=0.5,upperEave=6.6,upperOver=1.2,ridge=9.4,
 gableX=6.2,gableBreakY=7.9,cornerLift=0.45,cornerReach=1.6,eaveSag=0.05)
RECIPE={'designValues':D,'inference':'all design_inference; facade 17.0 = 3.2/3.4/3.8/3.4/3.2, depth 13.7 = porch 2.4 + body 11.3; double-eave 歇山 per gardenNodes feature (doubleEave, fiveBay colonnade, plinth 0.55, frontRail); only reference is generated sheet PBR-SH-0004-G21'}
META={};COLL=[];GROUP='hall'
def mat(name,rgb,rough=.8):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=rough;META[name]={'grey':rgb};return m
M={'wall':mat('grey-wall',(.72,.71,.68)),'stone':mat('grey-stone',(.55,.55,.53),.9),'wood':mat('grey-timber',(.36,.30,.27),.7),'roof':mat('grey-tile',(.30,.31,.32),.85),'dark':mat('grey-dark',(.18,.17,.16),.6),'lattice':mat('grey-lattice',(.42,.36,.32),.7)}
def tag(o):o['part']=GROUP;return o
def box(name,c,s,m='wall',bevel=0,collision=False):
 o=tag(box_glb(name,c,s,M[m],(1,1),bevel))
 if collision:COLL.append({'name':name,'center':list(c),'size':list(s),'type':'box'})
 return o
def rng(name,x0,x1,y0,y1,z0,z1,m='wall',bevel=0,collision=False):return box(name,((x0+x1)/2,(y0+y1)/2,(z0+z1)/2),(abs(x1-x0),abs(y1-y0),abs(z1-z0)),m,bevel,collision)
def mesh(name,verts,faces,m,smooth=False):
 me=bpy.data.meshes.new(name);me.from_pydata([glb_to_blender(v) for v in verts],[],faces);me.update();me.materials.append(M[m]);uv=me.uv_layers.new(name='UVMap')
 for p in me.polygons:
  for li in p.loop_indices:v=verts[me.loops[li].vertex_index];uv.data[li].uv=(v[0],v[2])
  p.use_smooth=smooth
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return tag(o)
def cyl(name,a,b,r,m,sides=12):
 va,vb=glb_to_blender(a),glb_to_blender(b);d=vb-va
 bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=d.length,location=(va+vb)/2)
 o=bpy.context.object;o.name=name;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(M[m]);return tag(o)
W=D['W'];hw=W/2;P0=D['plinth'];ZF=0.0;ZW=-D['porch'];ZB=-(D['porch']+D['bodyDepth'])
xs=[-hw];[xs.append(xs[-1]+b) for b in D['bays']]   # 6 column lines
# ---------------- platform, steps, rail
GROUP='hall-base'
rng('platform',-hw-D['plinthOutSide'],hw+D['plinthOutSide'],0,P0,ZB-D['plinthOutSide'],ZF+D['plinthOutFront'],'stone',0,True)
rng('platform-cap',-hw-D['plinthOutSide']-.04,hw+D['plinthOutSide']+.04,P0-.08,P0,ZB-D['plinthOutSide']-.04,ZF+D['plinthOutFront']+.04,'stone')
def steps(xc,w,z0):
 n=4;rise=P0/n;tread=.32
 for k in range(n):  # k=0 lowest, farthest out
  zf=z0+tread*(n-k);rng('step',xc-w/2,xc+w/2,0,rise*(k+1),zf-tread,zf,'stone',0,True)
steps(0,D['bays'][2],ZF+D['plinthOutFront'])
steps((xs[0]+xs[1])/2,1.6,ZF+D['plinthOutFront']);steps((xs[4]+xs[5])/2,1.6,ZF+D['plinthOutFront'])
# porch-edge rail on bays 2 and 4 (between the stairs)
for i in (1,3):
 a,b=xs[i]+.18,xs[i+1]-.18;z=ZF+D['plinthOutFront']-.25
 rng('rail-top',a,b,P0+.85,P0+.95,z-.06,z+.06,'wood');rng('rail-mid',a,b,P0+.45,P0+.52,z-.04,z+.04,'wood')
 for k in range(6):
  x=a+(b-a)*k/5;rng('rail-post',x-.06,x+.06,P0,P0+.85,z-.05,z+.05,'wood')
 COLL.append({'name':'porch-rail','center':[(a+b)/2,P0+.5,z],'size':[b-a+.1,1.0,.2],'type':'box'})
# ---------------- columns
GROUP='hall-frame'
def column(x,z,r,h0,h1,name='column'):
 cyl(name,(x,h0,z),(x,h1,z),r,'wood',12);box('column-base',(x,h0+.08,z),(r*2.3,.16,r*2.3),'stone');COLL.append({'name':name,'center':[x,(h0+h1)/2,z],'size':[r*2,h1-h0,r*2],'type':'box'})
for x in xs:
 column(x,ZF,D['colFrontD']/2,P0,P0+D['colH'],'front-column')
 top=D['lowerEave']-.34 if abs(x)>hw-.1 else D['lowerTop']-.3   # end columns stop under the eave beam ring (no poke through the skirt roof)
 column(x,ZW,.16,P0,top,'wall-column')
 column(x,ZB,.16,P0,top,'rear-column')
for x in xs:
 if abs(x)>hw-.1:continue   # no inner columns on the side-wall lines
 for z in (ZW-3.2,ZB+3.2):column(x,z,.17,P0,D['gableBreakY']-1.4,'inner-column')
# front 额枋 + porch beams + lower eave beam ring
rng('front-architrave',-hw-.2,hw+.2,P0+D['colH'],P0+D['colH']+.38,ZF-.14,ZF+.14,'wood')
for x in xs: rng('porch-tie',x-.1,x+.1,P0+D['colH'],P0+D['colH']+.3,ZW,ZF,'wood')
eo=.55
for x0,x1,z0,z1 in ((-hw-eo,hw+eo,ZF+eo-.2,ZF+eo),(-hw-eo,hw+eo,ZB-eo,ZB-eo+.2),(-hw-eo,-hw-eo+.2,ZB-eo+.2,ZF+eo-.2),(hw+eo-.2,hw+eo,ZB-eo+.2,ZF+eo-.2)):
 rng('lower-eave-beam',x0,x1,D['lowerEave']-.32,D['lowerEave']-.12,z0,z1,'wood')
# ---------------- walls (lower body)
GROUP='hall-wall'
t=.36
rng('side-wall-l',-hw-t/2,-hw+t/2,P0,D['lowerTop'],ZB,ZW,'wall',0,True);rng('side-wall-r',hw-t/2,hw+t/2,P0,D['lowerTop'],ZB,ZW,'wall',0,True)
rng('rear-wall',-hw,hw,P0,D['lowerTop'],ZB-t/2,ZB+t/2,'wall',0,True)
# front wall at z=ZW: end bays = sill wall 0.9 + half window; middle 3 bays = 6 lattice doors each
for i in range(5):
 a,b=xs[i]+.16,xs[i+1]-.16
 if i in (0,4):
  rng('sill-wall',a,b,P0,P0+.9,ZW-t/2,ZW+t/2,'wall',0,True)
  rng('half-window-frame',a,b,P0+.9,P0+D['colH'],ZW-.06,ZW+.06,'wood');rng('half-window-lattice',a+.1,b-.1,P0+1.0,P0+D['colH']-.1,ZW-.02,ZW+.02,'lattice')
  COLL.append({'name':'half-window','center':[(a+b)/2,(P0+.9+P0+D['colH'])/2,ZW],'size':[b-a,D['colH']-.9,.12],'type':'box'})
 else:
  n=6;pw=(b-a)/n
  for k in range(n):
   x0=a+pw*k;open_=(i==2 and k in (2,3))   # 明间中央两扇开着（可进）
   if open_:continue
   rng('door-frame',x0+.02,x0+pw-.02,P0,P0+D['colH'],ZW-.05,ZW+.05,'wood');rng('door-lattice',x0+.08,x0+pw-.08,P0+1.1,P0+D['colH']-.15,ZW-.015,ZW+.015,'lattice');rng('door-panel',x0+.08,x0+pw-.08,P0+.12,P0+1.0,ZW-.03,ZW+.03,'dark')
   COLL.append({'name':'door-leaf','center':[x0+pw/2,(P0+P0+D['colH'])/2,ZW],'size':[pw,D['colH'],.1],'type':'box'})
 rng('front-lintel',xs[i],xs[i+1],P0+D['colH'],D['lowerTop'],ZW-t/2,ZW+t/2,'wall',0,True)
# upper walls between lower roof top and upper eave, set in by upperWallIn
GROUP='hall-upper'
ui=D['upperWallIn'];UX=hw-ui;UZF=ZF-.6;UZB=ZB+.2
for x0,x1,z0,z1 in ((-UX,UX,UZF-t/2,UZF+t/2),(-UX,UX,UZB-t/2,UZB+t/2),(-UX-t/2,-UX+t/2,UZB,UZF),(UX-t/2,UX+t/2,UZB,UZF)):
 rng('upper-wall',x0,x1,D['lowerTop']-.2,D['upperEave'],z0,z1,'wall')
 # lattice band (recessed strip) on each upper wall
 if abs(z1-z0)<1: rng('upper-lattice-band',x0+.3,x1-.3,D['lowerTop']+.25,D['upperEave']-.35,z0-.02,z1+.02,'lattice')
 else: rng('upper-lattice-band',x0-.02,x1+.02,D['lowerTop']+.25,D['upperEave']-.35,z0+.3,z1-.3,'lattice')
# ---------------- roofs
GROUP='hall-roof'
def loop(x0,x1,z0,z1,y,lift,reach,sag,nx=36,nz=28):
 corners=[(x0,z1),(x1,z1),(x1,z0),(x0,z0)];pts=[];nseg=(nx,nz,nx,nz)
 for k in range(4):
  a=corners[k];b=corners[(k+1)%4];ns=nseg[k]
  for i in range(ns):
   tt=i/ns;x=a[0]+(b[0]-a[0])*tt;z=a[1]+(b[1]-a[1])*tt;seg=math.hypot(b[0]-a[0],b[1]-a[1]);d=min(tt,1-tt)*seg
   f=max(0,1-d/reach) if reach>0 else 0;pts.append([x,y-sag*math.sin(math.pi*tt)+lift*f*f,z,lift*f*f])
 return pts
def loft(name,lo,hi,rings=8,m='roof',lift_fade=2.2):
 verts=[];faces=[];N=len(lo)
 for j in range(rings+1):
  tt=j/rings;t2=tt**1.4
  for i in range(N):
   a,b=lo[i],hi[i];base=a[1]-a[3]
   verts.append((a[0]+(b[0]-a[0])*tt,base+(b[1]-base)*t2+a[3]*(1-tt)**lift_fade,a[2]+(b[2]-a[2])*tt))
 for j in range(rings):
  for i in range(N):
   A=j*N+i;B=j*N+(i+1)%N;faces.append((A,B,B+N,A+N))
 return mesh(name,verts,faces,m,True),verts,N,rings
def eave_dress(lo,name):
 N=len(lo)
 for i in range(N):
  a=lo[i][:3];b=lo[(i+1)%N][:3];mesh(name+'-fascia',[a,b,(b[0],b[1]-.16,b[2]),(a[0],a[1]-.16,a[2])],[(0,3,2,1)],'dark')
  if i%2==0:
   tx,tz=b[0]-a[0],b[2]-a[2];L=math.hypot(tx,tz) or 1;tx/=L;tz/=L;nx,nz=-tz,tx;mid=((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);v=[]
   for s in (-.12,.06):
    for k in range(7):
     ang=k*math.pi/6;r=.11*math.cos(ang);up=.06*math.sin(ang);v.append((mid[0]+tx*r+nx*s,mid[1]+up,mid[2]+tz*r+nz*s))
   mesh(name+'-lip',v,[(k,k+7,k+8,k+1) for k in range(6)],'roof')
def hip_rods(verts,N,rings,idxs,name):
 for ci in idxs:
  for j in range(rings):
   a=verts[j*N+ci];b=verts[(j+1)*N+ci];cyl(name,(a[0],a[1]+.05,a[2]),(b[0],b[1]+.05,b[2]),.08,'roof',8)
# lower skirt roof: from eave loop to the upper-wall foot loop
lo=loop(-hw-D['lowerOver'],hw+D['lowerOver'],ZB-D['lowerOver'],ZF+D['lowerOver'],D['lowerEave'],D['cornerLift'],D['cornerReach'],D['eaveSag'])
hi=loop(-UX+.02,UX-.02,UZB+.02,UZF-.02,D['lowerTop'],0,0,0)
o,v,N,R=loft('lower-roof',lo,hi,6);eave_dress(lo,'lower');hip_rods(v,N,R,[0,36,64,100],'lower-hip')
# upper roof: hip skirt up to the gable break loop, then gable to the ridge with 山花
UO=D['upperOver'];lo2=loop(-UX-UO,UX+UO,UZB-UO,UZF+UO,D['upperEave'],D['cornerLift']+.15,D['cornerReach'],D['eaveSag'])
zc=(UZF+UZB)/2;half=(UZF-UZB)/2;yb=D['gableBreakY'];fr=(yb-D['upperEave'])/(D['ridge']-D['upperEave']);zin=(half+UO)*(1-fr)
hi2=loop(-D['gableX'],D['gableX'],zc-zin,zc+zin,yb,0,0,0)
o2,v2,N2,R2=loft('upper-roof-skirt',lo2,hi2,7);eave_dress(lo2,'upper');hip_rods(v2,N2,R2,[0,36,64,100],'upper-hip')
# gable roof: two slopes from hi2 long sides to the ridge
gx=D['gableX'];RY=D['ridge']
for side,(z0,z1) in enumerate(((zc+zin,zc),(zc-zin,zc))):
 vs=[(-gx-.5,yb,z0),(gx+.5,yb,z0),(gx+.5,RY,z1),(-gx-.5,RY,z1)];mesh('upper-gable-slope',vs,[(0,1,2,3) if side==0 else (0,3,2,1)],'roof')
for sx in (-1,1):
 x=sx*gx;vs=[(x,yb,zc+zin),(x,yb,zc-zin),(x,RY,zc)];mesh('shanhua',vs,[(0,1,2) if sx>0 else (0,2,1)],'wall')
cyl('main-ridge',(-gx-.5,RY+.07,zc),(gx+.5,RY+.07,zc),.15,'roof',10)
for sx in (-1,1):box('ridge-end',(sx*(gx+.4),RY+.3,zc),(.5,.6,.4),'roof')
for sx in (-1,1):
 for zz in (zc+zin,zc-zin):cyl('chuiji',(sx*gx,yb,zz),(sx*(gx+.5),RY+.05,zc),.08,'roof',8)
# ---------------- interior frames, screen doors, floor
GROUP='hall-interior'
rng('floor',-hw+.2,hw-.2,P0-.02,P0+.02,ZB+.2,ZW-.2,'stone')
for x in xs:
 if abs(x)>hw-.1:continue   # outer frames: the side walls carry the roof; no beams above the skirt roof
 rng('main-beam',x-.15,x+.15,D['gableBreakY']-1.6,D['gableBreakY']-1.2,ZB+.2,ZW-.2,'wood')
 for z in (ZW-3.2,ZB+3.2):rng('guazhu',x-.12,x+.12,D['gableBreakY']-1.2,D['gableBreakY']-.1,z-.12,z+.12,'wood')
 if abs(x)<D['gableX']-.2:
  rng('upper-beam',x-.12,x+.12,D['gableBreakY']-.1,D['gableBreakY']+.2,ZB+3.2,ZW-3.2,'wood')
  rng('ridge-post',x-.1,x+.1,D['gableBreakY']+.2,RY-.35,zc-.1,zc+.1,'wood')
zs_=ZB+3.2
for k in range(4):
 x0=-1.9+k*.95;rng('screen-door',x0+.03,x0+.92,P0,P0+2.8,zs_-.04,zs_+.04,'lattice');COLL.append({'name':'screen-door','center':[x0+.475,P0+1.4,zs_],'size':[.95,2.8,.1],'type':'box'})
# ---------------- join per (part,material), triangulate, export
def finalize(items,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in items:o.select_set(True)
 bpy.context.view_layer.objects.active=items[0]
 if len(items)>1:bpy.ops.object.join()
 o=bpy.context.object;o.name=name;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();bpy.ops.object.select_all(action='DESELECT');return o
parts={}
for o in list(sc.objects):
 if o.type=='MESH':parts.setdefault((o.get('part','misc'),o.data.materials[0].name),[]).append(o)
final=[finalize(items,g+'__'+m) for (g,m),items in parts.items()]
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'model.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in final:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'model.glb'),export_format='GLB',export_yup=True,export_apply=True,use_selection=True,export_animations=False,export_cameras=False,export_lights=False)
tris=0;by={}
for o in final:o.data.calc_loop_triangles();n=len(o.data.loop_triangles);tris+=n;by[o.name]=n
maxy=max(v.co.z for o in final for v in o.data.vertices)
json.dump({'triangles':tris,'byNode':by,'glbBytes':(ROOT/'model.glb').stat().st_size,'maxY':round(maxy,3),'designDimensions':{'facadeWidth':W,'depth':D['porch']+D['bodyDepth'],'platform':P0,'lowerEave':D['lowerEave'],'upperEave':D['upperEave'],'ridge':D['ridge'],'footprintWithPlinth':[W+2*D['plinthOutSide'],D['porch']+D['bodyDepth']+D['plinthOutFront']+D['plinthOutSide']]},'buildSeconds':round(time.time()-T0,1)},open(ROOT/'measurements.json','w'),ensure_ascii=False,indent=2)
json.dump({'axis':'Y-up +Z facade','origin':'front colonnade centre at garden ground','integratedIntoWorld':False,'colliders':COLL},open(ROOT/'collision.json','w'),ensure_ascii=False,indent=2)
json.dump(RECIPE,open(ROOT/'recipe.json','w'),ensure_ascii=False,indent=2)
print('SANSUITANG_READY',tris,(ROOT/'model.glb').stat().st_size,round(maxy,2))
