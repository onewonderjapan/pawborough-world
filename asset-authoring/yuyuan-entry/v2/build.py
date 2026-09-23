"""Yuyuan entrance gate candidate (豫园入口门楼). Design metres, GLB Y-up, facade +Z, depth -Z,
origin = front doorway centre at ground. Blender Z-up internally via source-kit helpers.
Run:  blender --background -t 4 --python build.py [-- --stage clay|full]
Outputs (workspace): model.glb, ground.glb, model.blend, recipe.json, materials.json, collision.json,
measurements.json, reimport-check.json
"""
import bpy,bmesh,sys,math,json,time,hashlib
from pathlib import Path
from mathutils import Vector
T0=time.time()
ROOT=Path(__file__).resolve().parent;PKG=ROOT.parent
sys.path.insert(0,str(PKG/'source-kit'))
from helpers import box_glb,glb_to_blender
TEX=PKG/'source-kit'/'textures'
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
STAGE=argv[argv.index('--stage')+1] if '--stage' in argv else 'full'
META={};COLL=[];GROUP='gate';RECIPE={'designValues':{},'inferred':[]}
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene;sc.unit_settings.system='METRIC';sc.unit_settings.scale_length=1

# ------------------------------------------------------------------ design values (all design_inference unless noted)
D=dict(
 doorW=2.2,doorH=3.0,                     # frozen scale (control/DESIGN_SPEC.json)
 wallW=8.0,wallH=5.33,depth=2.8,          # facade brick mass; derived from G20 pixel ratios against the door
 plinthH=0.52,plinthOut=0.10,             # stone base course
 frameW=0.70,frameHeadH=0.45,frameProud=0.05,   # stone door surround on both faces
 linerDepth=0.40,linerT=0.08,             # stone reveal liners inside the passage at both ends
 bandLo=(3.62,3.90),bandHi=(4.90,5.19),   # 回纹 relief bands (y ranges)
 plaque=(4.00,4.71,3.55),                 # y0,y1,width of blank plaque recess
 corniceY=(5.19,5.33),
 bracketRows=9,bracketSide=3,
 eaveY=6.45,ridgeY=7.72,eaveOut=1.05,     # roof: eave height, ridge height, eave overhang beyond wall
 tipLift=0.85,tipOut=0.28,tipReach=2.1,    # upturned corner: lift, outward push, perimeter length affected
 ridgeHalf=2.75,                          # main ridge half length (hip roof: wallW+2*eaveOut - roofDepth ≈ 5.2..5.5)
 eaveSag=0.05,                            # concave sag of straight eave between corners
)
RECIPE['designValues']=D
RECIPE['scaleSource']='clear doorway 2.2 x 3.0 m frozen by owner; other values scaled from G20 (front) pixel ratios: door 205 px wide / 315 px tall, facade 755 px, roof eave 940 px, ridge 510 px, tips at ±5.4 m / 8.1 m'
RECIPE['inferred']=['depth 2.8 m (G21/G22 oblique only)','hip-roof plan and ridge length (G20 silhouette)','rear face: same masses, plain bands, plain plaque recess, no fret, no stepped door corners (no rear reference)','bracket cluster form (3-tier stepped stone corbels, 9 front/9 back/3 per side)','passage ceiling flat stone (G23 shows flat soffit)']

# ------------------------------------------------------------------ materials
def lin(h):
 a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a]
def mat(name,color='ffffff',rough=.8,metal=0,family=None,tile=(1,1),base=None,normal=None,roughmap=None,tint=None,nstrength=.65,source=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*lin(color),1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 paths={}
 if family:
  for ch,suf in [('color','Color'),('normal','NormalGL'),('roughness','Roughness')]:
   f=list(TEX.glob(f'{family}*{suf}*'));
   if f:paths[ch]=f[0]
 if base:paths['color']=TEX/base
 if normal:paths['normal']=TEX/normal
 if roughmap:paths['roughness']=TEX/roughmap
 for ch,path in paths.items():
  t=n.new('ShaderNodeTexImage');t.extension='REPEAT';t.image=bpy.data.images.load(str(path),check_existing=True);t.image.colorspace_settings.name='sRGB' if ch=='color' else 'Non-Color';t.image.pack()
  if ch=='normal':
   nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=nstrength;l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],p.inputs['Normal'])
  elif ch=='roughness':l.new(t.outputs['Color'],p.inputs['Roughness'])
  else:
   if tint:
    mix=n.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs['Factor'].default_value=1.0
    mix.inputs[7].default_value=(*lin(tint),1);l.new(t.outputs['Color'],mix.inputs[6]);l.new(mix.outputs[2],p.inputs['Base Color'])
   else:l.new(t.outputs['Color'],p.inputs['Base Color'])
 META[name]={'tileMeters':list(tile),'colorSrgb':color,'tintSrgb':tint,'roughness':rough,'metallic':metal,'textures':{k:str(v.relative_to(PKG)) for k,v in paths.items()},'normalConvention':'OpenGL','source':source or ('ambientCG CC0 via source-kit (see PROVENANCE.json)' if paths else 'constant material')}
 return m
M={
 'brick':mat('grey-brick-facade',family='Bricks061',tile=(1.05,1.20),tint='b4bac2',nstrength=.7,source='ambientCG Bricks061, cool-grey tint'),
 'stone':mat('pale-granite-stone',family='PaintedPlaster017',tile=(2.5,2.5),tint='d8d4c8',nstrength=.5,source='ambientCG PaintedPlaster017 as granular stone, tinted'),
 'stoneDk':mat('carved-stone-ground','8d8a80',.9),
 'roof':mat('grey-pan-tile',base='roof-color.jpg',normal='roof-normal.png',tile=(1.44,1.36),source='project analytic roof relief (source-kit)'),
 'dark':mat('dark-fascia-lacquer','3a3632',.6),
 'wood':mat('rafter-timber','5a3a2a',.7,base='wood-stain-color.jpg',normal='Wood092_2K-JPG_NormalGL_1K.jpg',tile=(.75,1.5),tint='e6d6c8',source='project wood colour + ambientCG normal (source-kit)'),
 'mortar':mat('passage-plaster',family='PaintedPlaster017',tile=(2.5,2.5),tint='b9b6ad',nstrength=.5),
 'ground':mat('ground-stone-slab',family='PaintedPlaster017',tile=(2.5,2.5),tint='a9a69c',nstrength=.35),
 'groove':mat('slab-joint','6d6a63',.95),
}
CLAY=None
def tag(o):o['part']=GROUP;return o
def box(name,c,s,m='brick',bevel=.006,collision=False):
 if max(s)/min(s)>55:bevel=0
 o=tag(box_glb(name,c,s,M[m],META[M[m].name]['tileMeters'],bevel))
 if collision:COLL.append({'name':name,'center':list(c),'size':list(s),'type':'box','axis':'glTF Y-up'})
 return o
def rng(name,x0,x1,y0,y1,z0,z1,m='brick',bevel=.006,collision=False):
 """box by extents (design coords)."""
 return box(name,((x0+x1)/2,(y0+y1)/2,(z0+z1)/2),(abs(x1-x0),abs(y1-y0),abs(z1-z0)),m,bevel,collision)
def mesh(name,verts,faces,m,uvs=None,smooth=False):
 me=bpy.data.meshes.new(name);me.from_pydata([glb_to_blender(v) for v in verts],[],faces);me.update()
 me.materials.append(M[m]);uv=me.uv_layers.new(name='UVMap')
 if uvs:
  for p in me.polygons:
   for li in p.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
 else:
  tile=META[M[m].name]['tileMeters']
  for p in me.polygons:
   for li in p.loop_indices:
    v=verts[me.loops[li].vertex_index];nn=p.normal;ax=max(range(3),key=lambda k:abs(nn[k]))
    a,b=((v[2],v[1]) if ax==0 else (v[0],v[1]) if ax==1 else (v[0],v[2]));uv.data[li].uv=(a/tile[0],b/tile[1])
 if smooth:
  for p in me.polygons:p.use_smooth=True
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return tag(o)
def cyl(name,a,b,r,m,sides=8):
 va,vb=glb_to_blender(a),glb_to_blender(b);d=vb-va
 bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=d.length,location=(va+vb)/2)
 o=bpy.context.object;o.name=name;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(M[m]);return tag(o)

# ------------------------------------------------------------------ walls (front layer / core / back layer)
W=D['wallW']/2;H=D['wallH'];Z0=0.0;Z1=-D['depth'];hw=D['doorW']/2+D['linerT'];hh=D['doorH']+D['linerT']
pq0,pq1,pqW=D['plaque'];pw=pqW/2
def face_layer(z_front,z_back,recess,name,collide,top=None):
 top=hh if top is None else top
 """Brick face tiled around the doorway and plaque recess. recess = plaque set-back (m)."""
 rng(name+'-pier-l',-W,-pw,0,H,z_back,z_front,'brick',0,collide)
 rng(name+'-pier-r',pw,W,0,H,z_back,z_front,'brick',0,collide)
 for sx in (-1,1):
  a,b=sorted((sx*hw,sx*pw))
  rng(name+'-mid-lo',a,b,0,pq0,z_back,z_front,'brick',0,collide)
  rng(name+'-mid-hi',a,b,pq1,H,z_back,z_front,'brick',0,collide)
 rng(name+'-over-door',-hw,hw,top,pq0,z_back,z_front,'brick',0,collide)
 rng(name+'-top',-hw,hw,pq1,H,z_back,z_front,'brick',0,collide)
 # plaque: recessed pale panel + stone frame
 zf=z_front-recess if z_front>=Z0-.001 else z_front+recess
 sgn=1 if z_front>=Z0-.001 else -1
 rng(name+'-plaque-back',-pw,pw,pq0,pq1,z_back,zf,'stone',0)
 for x0,x1,y0,y1 in ((-pw-.1,-pw,pq0,pq1),(pw,pw+.1,pq0,pq1),(-pw-.1,pw+.1,pq0-.1,pq0),(-pw-.1,pw+.1,pq1,pq1+.1)):
  rng(name+'-plaque-frame',x0,x1,y0,y1,z_front,z_front+sgn*.04,'stone',.006)
GROUP='gate-wall'
FRONT_TOP=hh+.24   # front opening 3.32: two 0.12 corner steps sit above the 3.0 clear height
face_layer(Z0,Z0-.3,.06,'front',True,FRONT_TOP)
face_layer(Z1,Z1+.3,.04,'back',True)
rng('core-l',-W,-hw,0,H,Z1+.3,Z0-.3,'brick',0,True)
rng('core-r',hw,W,0,H,Z1+.3,Z0-.3,'brick',0,True)
rng('core-top',-hw,hw,hh,H,Z1+.3,Z0-.3,'brick',0,True)
rng('passage-ceiling',-hw,hw,hh-.06,hh,Z1,Z0,'mortar',0)
# plinth (stone base course) left/right of the surround, all four sides
po=D['plinthOut'];ph=D['plinthH'];fw=D['doorW']/2+D['frameW']
for sx in (-1,1):
 a,b=sorted((sx*fw,sx*(W+po)))
 rng('plinth',a,b,0,ph,Z1-po,Z0+po,'stone',.012,True)
 rng('plinth-cap',a,b,ph,ph+.06,Z1-po+.03,Z0+po-.03,'stone',.008)
# ------------------------------------------------------------------ door surround, liners, stepped corners
GROUP='gate-door'
for zf,sgn,steps in ((Z0,1,True),(Z1,-1,False)):
 fp=D['frameProud']*sgn;top=FRONT_TOP if steps else hh
 headH=D['bandLo'][0]-.07-(top-.02)   # head + cap stop exactly under the lower relief band
 for sx in (-1,1):
  a,b=sorted((sx*hw,sx*fw));rng('door-jamb',a,b,0,top,zf,zf+fp,'stone',.01,True)
 rng('door-head',-fw,fw,top-.02,top-.02+headH,zf,zf+fp,'stone',.01)
 rng('door-head-cap',-fw-.06,fw+.06,top-.02+headH,top-.02+headH+.07,zf,zf+fp+.03*sgn,'stone',.008)
 zin=zf-sgn*D['linerDepth'];za,zb=sorted((zf,zin))
 for sx in (-1,1):
  a,b=sorted((sx*(hw-D['linerT']),sx*hw));rng('reveal-liner',a,b,0,top-D['linerT'],za,zb,'stone',.004,True)
 rng('lintel-liner',-hw,hw,top-D['linerT'],top,za,zb,'stone',.004)
 if steps:
  # stepped corner brackets occupy y 3.00-3.24 only (clear 2.2 x 3.0 rectangle stays free)
  for sx in (-1,1):
   for k,(sw,sh) in enumerate(((.30,.12),(.16,.12))):
    a,b=sorted((sx*(hw-D['linerT']),sx*(hw-D['linerT']-sw)));y1=top-D['linerT']-k*sh;rng('door-corner-step',a,b,y1-sh,y1,za,zb,'stone',.004)
  # stone transition between the taller front frame zone and the 3.0 passage ceiling
  rng('passage-head-step',-hw,hw,hh-.06,top,zin-.1,zin,'stone',.004)
# ------------------------------------------------------------------ relief bands, cornice
GROUP='gate-relief'
def fret_band(y0,y1,zf,sgn,with_fret):
 h=y1-y0;x0,x1=-W+.15,W-.15
 rng('band-ground',x0,x1,y0,y1,zf,zf+sgn*.03,'stoneDk',0)
 for yy in (y0-.04,y1):rng('band-edge',x0-.02,x1+.02,yy,yy+.04,zf,zf+sgn*.05,'stone',.004)
 if not with_fret:return
 m=.32;n=int((x1-x0-.1)/m);start=x0+((x1-x0)-n*m)/2;t=.032
 segs=[((0,.18),(.8,.18)),((.8,.18),(.8,.82)),((.8,.82),(.2,.82)),((.2,.82),(.2,.42)),((.2,.42),(.58,.42)),((.58,.42),(.58,.62))]
 for i in range(n):
  bx=start+i*m
  for k,((u0,v0),(u1,v1)) in enumerate(segs):
   xa,xb=sorted((bx+u0*m,bx+u1*m));ya,yb=sorted((y0+v0*h,y0+v1*h));dz=.05 if k%2==0 else .053
   rng('fret',xa-t/2,xb+t/2,ya-t/2,yb+t/2,zf+sgn*.03,zf+sgn*dz,'stone',0)
for zf,sgn,fret in ((Z0,1,True),(Z1,-1,False)):
 fret_band(*D['bandLo'],zf,sgn,fret);fret_band(*D['bandHi'],zf,sgn,fret)
# side bands (plain), wrapping the corners
for sx in (-1,1):
 for y0,y1 in (D['bandLo'],D['bandHi']):
  a,b=sorted((sx*W,sx*(W+.03)));rng('band-side',a,b,y0,y1,Z1+.15,Z0-.15,'stoneDk',0)
  for yy in (y0-.04,y1):
   a,b=sorted((sx*W,sx*(W+.05)));rng('band-side-edge',a,b,yy,yy+.04,Z1+.13,Z0-.13,'stone',.004)
# cornice courses on all four sides
c0,c1=D['corniceY']
for k,(out,yy0,yy1) in enumerate(((.06,c0,c0+.07),(.12,c0+.07,c1))):
 rng('cornice',-W-out,W+out,yy0,yy1,Z1-out,Z0+out,'stone',.006)
# ------------------------------------------------------------------ eave beams + bracket clusters (牌科)
GROUP='gate-eave'
eo=.75;by0=H;by1=D['eaveY']-.2
for x0,x1,z0,z1 in ((-W-eo,W+eo,Z0+eo-.22,Z0+eo),(-W-eo,W+eo,Z1-eo,Z1-eo+.22),(-W-eo,-W-eo+.22,Z1-eo+.22,Z0+eo-.22),(W+eo-.22,W+eo,Z1-eo+.22,Z0+eo-.22)):
 rng('eave-beam',x0,x1,by1,by1+.2,z0,z1,'stone',.01)
rng('wall-top-beam',-W-.1,W+.1,H,H+.2,Z1-.1,Z0+.1,'stone',.01)
rng('eave-soffit',-W-eo-.2,W+eo+.2,by1,by1+.07,Z1-eo-.2,Z0+eo+.2,'mortar',0)   # soffit at the corbel top / eave-beam underside: nothing above it is visible from below
# frieze wall behind the corbels: the brick mass continues up to the soffit (no sky between clusters)
rng('frieze-wall',-W+.04,W-.04,H+.2,by1,Z1+.04,Z0-.04,'brick',0)
def bracket(cx,cz,dz,dx):
 """Stepped stone corbel cluster: stem on the wall-top beam, then alternating wide slab / narrow spacer,
 every course in full contact with the one below; the top slab reaches the eave beam underside."""
 ox,oz=cx,cz;y=H+.2
 def blk(w,h,out,mat='stone'):
  nonlocal y
  if dz:box('bracket-course',(ox,y+h/2,oz+dz*out/2),(w,h,out),mat,0)
  else:box('bracket-course',(ox+dx*out/2,y+h/2,oz),(out,h,w),mat,0)
  y+=h
 blk(.26,.30,.30)              # stem
 blk(.50,.09,.36);blk(.24,.07,.26)
 blk(.74,.09,.52);blk(.24,.07,.36)
 blk(.98,.09,.70);blk(.30,by1-y,.50)   # last spacer closes exactly onto the eave beam underside
n=D['bracketRows'];span=W*2-1.2
for i in range(n):
 x=-span/2+span*i/(n-1)
 bracket(x,Z0,1,0);bracket(x,Z1,-1,0)
for i in range(D['bracketSide']):
 z=Z0-.7-(D['depth']-1.4)*i/(D['bracketSide']-1)
 bracket(-W,z,0,-1);bracket(W,z,0,1)
# ------------------------------------------------------------------ roof (hip, curved eave, upturned corners)
GROUP='gate-roof'
zc=(Z0+Z1)/2;RX=W+D['eaveOut'];RZ=D['depth']/2+D['eaveOut'];EY=D['eaveY'];RY=D['ridgeY'];RH=D['ridgeHalf']
def eave_loop():
 """Closed eave outline, counter-clockwise seen from +Y, starting at the front-left corner. Returns list of (x,y,z,tangent,outnormal,s)."""
 corners=[(-RX,zc+RZ),(RX,zc+RZ),(RX,zc-RZ),(-RX,zc-RZ)]
 pts=[]
 nseg=(44,22,44,22)
 for k in range(4):
  a=corners[k];b=corners[(k+1)%4];ns=nseg[k]
  for i in range(ns):
   t=i/ns;x=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
   seg=math.hypot(b[0]-a[0],b[1]-a[1]);d=min(t,1-t)*seg      # distance to nearest corner along this edge
   f=max(0,1-d/D['tipReach']);lift=D['tipLift']*f**2.0
   sag=D['eaveSag']*math.sin(math.pi*t)                       # concave eave between corners
   ox=(x-0)/RX;oz=(z-zc)/RZ                                   # outward push near corners (diagonal)
   push=D['tipOut']*f**2.5
   pts.append([x+push*math.copysign(1,ox),EY-sag+lift,z+push*math.copysign(1,oz),lift])
 return pts
E=eave_loop();N=len(E)
E=[list(p) for p in E]
def ridge_target(p):
 x,y,z=p[0],p[1],p[2]
 return (max(-RH,min(RH,x)),RY,zc)
NY=9
def ring(t):
 out=[]
 for p in E:
  r=ridge_target(p);tt=t**1.5;base=p[1]-p[3]
  out.append((p[0]+(r[0]-p[0])*t,base+(r[1]-base)*tt+p[3]*(1-t)**2.2,p[2]+(r[2]-p[2])*t))
 return out
rings=[ring(j/NY) for j in range(NY+1)]
verts=[];uvs=[];faces=[]
per=0;plen=[0]
for i in range(N):
 a=E[i];b=E[(i+1)%N];per+=math.hypot(b[0]-a[0],b[2]-a[2]);plen.append(per)
for j,rg in enumerate(rings):
 for i,p in enumerate(rg):verts.append(p);uvs.append((plen[i]/1.44,j/NY*4.2/1.36))
for j in range(NY):
 for i in range(N):
  a=j*N+i;b=j*N+(i+1)%N;c=b+N;d=a+N;faces.append((a,b,c,d))
# ridge cap strip closes the top between the two long sides
top=rings[NY]
roofobj=mesh('roof-surface',verts,faces,'roof',uvs,smooth=True)
# eave fascia (檐口板) + rafters (椽) + tile lips (瓦当)
for i in range(N):
 a=E[i][:3];b=E[(i+1)%N][:3]
 mesh('eave-fascia',[a,b,(b[0],b[1]-.16,b[2]),(a[0],a[1]-.16,a[2])],[(0,3,2,1)],'dark')
 mesh('drip-strip',[(a[0],a[1]+.02,a[2]),(b[0],b[1]+.02,b[2]),(b[0],b[1]-.06,b[2]),(a[0],a[1]-.06,a[2])],[(0,3,2,1)],'roof')
 if i%2==0:
  inner=rings[2][i];tip=(a[0]+(a[0]-inner[0])*.12,a[1]-.05+(a[1]-inner[1])*.12,a[2]+(a[2]-inner[2])*.12)
  # rafters only run from the eave beam outward (ends visible, no dark bars in the soffit slot)
  st=tuple(a[k]+(inner[k]-a[k])*.36 for k in range(3))
  cyl('rafter',(st[0],st[1]-.05,st[2]),tip,.045,'wood',6)
 # half-round tile lip along the local tangent
 tx,tz=b[0]-a[0],b[2]-a[2];L=math.hypot(tx,tz);tx/=L;tz/=L;nx,nz=-tz,tx   # outward-ish normal (loop is CCW seen from +Y)
 # simpler: build the lip in a local frame (u along tangent, n outward)
 v=[]
 mid=((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2)
 for s in (-.13,.06):
  for k in range(7):
   ang=k*math.pi/6;r=.118*math.cos(ang);up=.06*math.sin(ang)
   v.append((mid[0]+tx*r+nx*s,mid[1]+up,mid[2]+tz*r+nz*s))
 mesh('tile-lip',v,[(k,k+7,k+8,k+1) for k in range(6)],'roof')
# main ridge + ends, hip ridges, corner tips
cyl('main-ridge',(-RH,RY+.06,zc),(RH,RY+.06,zc),.14,'roof',10)
for sx in (-1,1):
 box('ridge-end-block',(sx*RH,RY+.22,zc),(.46,.5,.36),'roof',.01)
 box('ridge-end-cap',(sx*RH,RY+.5,zc),(.56,.08,.46),'dark',.01)
corner_idx=[0,44,66,110]
for ci in corner_idx:
 path=[rings[j][ci] for j in range(NY+1)]
 for j in range(NY):
  a,b=path[j],path[j+1];cyl('hip-ridge',(a[0],a[1]+.05,a[2]),(b[0],b[1]+.05,b[2]),.085,'roof',8)
 # 嫩戗: tip continues beyond the eave corner, curving up
 p=E[ci][:3];inner=rings[1][ci];dx,dz=p[0]-inner[0],p[2]-inner[2];L=math.hypot(dx,dz);dx/=L;dz/=L
 prev=(p[0],p[1]+.05,p[2])
 for k in range(1,3):
  q=(p[0]+dx*.14*k,p[1]+.05+.06*k*k,p[2]+dz*.14*k);cyl('corner-tip',prev,q,.075-.015*k,'roof',8);prev=q
 mesh('corner-tip-cap',[prev,(prev[0]+.02,prev[1]+.06,prev[2]),(prev[0]-.02,prev[1]+.06,prev[2])],[(0,1,2)],'dark')
RECIPE['roof']={'eavePoints':N,'rings':NY,'planAtEave':[round(2*RX,2),round(2*RZ,2)],'ridgeLength':2*RH}

# ------------------------------------------------------------------ collision for roof (unreachable, recorded for completeness)
COLL.append({'name':'roof-volume','center':[0,(EY+RY)/2,zc],'size':[2*RX,RY-EY+.6,2*RZ],'type':'box','axis':'glTF Y-up','reachable':False})

# ------------------------------------------------------------------ ground display patch (separate GLB)
GROUP='ground'
GROUND=[]
g=rng('ground-slab',-9,9,-.08,0,-8,6,'ground',0);GROUND.append(g)
for x in range(-9,10):
 GROUND.append(rng('joint-x',x-.008,x+.008,-.004,0.002,-8,6,'groove',0))
for z in range(-8,7):
 GROUND.append(rng('joint-z',-9,9,-.004,.002,z-.008,z+.008,'groove',0))

# ------------------------------------------------------------------ join by (part,material), triangulate, export
def finalize(items,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in items:o.select_set(True)
 bpy.context.view_layer.objects.active=items[0]
 if len(items)>1:bpy.ops.object.join()
 o=bpy.context.object;o.name=name;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 bpy.ops.object.select_all(action='DESELECT');return o
parts={}
for o in list(sc.objects):
 if o.type=='MESH':parts.setdefault((o.get('part','misc'),o.data.materials[0].name),[]).append(o)
final=[]
for (group,material),items in parts.items():final.append(finalize(items,group+'__'+material))
gate=[o for o in final if not o.name.startswith('ground')];ground=[o for o in final if o.name.startswith('ground')]
for image in bpy.data.images:
 if image.filepath:image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'model.blend'))
def export(objs,path):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objs:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,use_selection=True,export_animations=False,export_tangents=True,export_image_format='AUTO',export_cameras=False,export_lights=False)
export(gate,ROOT/'model.glb');export(ground,ROOT/'ground.glb')
tris={};tot=0
for o in gate:
 o.data.calc_loop_triangles();n=len(o.data.loop_triangles);tris[o.name]=n;tot+=n
gtris=0
for o in ground:o.data.calc_loop_triangles();gtris+=len(o.data.loop_triangles)
(ROOT/'collision.json').write_text(json.dumps({'axis':'Y-up +Z facade','origin':'front doorway centre at ground','integratedIntoWorld':False,'note':'coarse proxy; passage clear 2.2 x 3.0 between reveal liners','colliders':COLL},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'materials.json').write_text(json.dumps(META,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'recipe.json').write_text(json.dumps(RECIPE,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'measurements.json').write_text(json.dumps({'gateTriangles':tot,'gateTrianglesByNode':tris,'groundTriangles':gtris,'gateGlbBytes':(ROOT/'model.glb').stat().st_size,'groundGlbBytes':(ROOT/'ground.glb').stat().st_size,'designDimensions':{'wallWidth':D['wallW'],'wallHeight':D['wallH'],'depth':D['depth'],'eaveHeight':D['eaveY'],'ridgeHeight':D['ridgeY'],'roofPlanAtEave':[round(2*RX,2),round(2*RZ,2)],'cornerTipTopActual':round(max(p[1] for p in E)+.05+.06*4+.02,2),'maxYActual(ridgeEndCaps)':round(max(v.co.z for o in gate for v in o.data.vertices),3),'clearDoor':[D['doorW'],D['doorH']]},'units':'metres','surveyed':False,'buildSeconds':round(time.time()-T0,1)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
check=bpy.data.scenes.new('GLB_REIMPORT_CHECK');bpy.context.window.scene=check
bpy.ops.import_scene.gltf(filepath=str(ROOT/'model.glb'))
obs=[]
for m in {m for o in check.objects if o.type=='MESH' for m in o.data.materials}:
 p=[n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'][0]
 obs.append({'name':m.name,'baseColorFactor':[round(v,3) for v in p.inputs['Base Color'].default_value],'imageNodes':[{'name':n.image.name,'size':list(n.image.size),'colorSpace':n.image.colorspace_settings.name} for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]})
(ROOT/'reimport-check.json').write_text(json.dumps({'imported':True,'meshes':len([o for o in check.objects if o.type=='MESH']),'materials':obs},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('GATE_READY',tot,(ROOT/'model.glb').stat().st_size,round(time.time()-T0,1))
