"""三穗堂细化模块（T2，2026-09-23）。基于主控灰模 reference-greymodel-build.py，冻结剖面（台基/柱网/檐高/面宽/进深）逐值不改。
细化项（灰模 README「交 GLM 细化时的要求」）：格扇格心（解析 alpha 贴图 1 张）、次间栏杆望柱栏板、
檐下椽头与檐枋、瓦当滴水、正脊吻/垂脊/戗脊收头。材质走 source-kit：灰瓦 / 深红栗木 tint 6a2e22 / 白墙 / 青石。
坐标契约：GLB Y-up，立面 +Z 朝园水。灰模原点 = 前廊柱列中心；本模块导出前整体 +Z 平移 REANCHOR，
使原点 = 台基外包平面中心（assemble 直接把原点放在 layout footprint 形心）。碰撞 JSON 同步平移（实例/本地坐标）。
预算 ≤32k tris。运行：blender -b -t 4 --python-exit-code 1 -P modules/sansuitang/build.py [-- --out <dir>]
（--out 缺省 = 本目录；管线输入是 out-garden-kits/sansuitang-bld-428179901/，按 sha 清单登记，不进 LFS。）
wave2-sansuitang（主控 2026-09-25）：只改背面——三穗堂背靠仰山堂共用边，背面任何构件不得越过后墙外皮。
  plinthOutBack：台基后缘与后墙外皮齐平（原同侧面 0.6 m）；lowerOverBack / upperOverBack：上下檐背面出檐
  （从 ZB / UZB 量；背面檐口线收进墙厚内，背面檐口饰件与封檐板不做）。背面檐口环点在 z < PIVOT（= 原点所在横截面，
  GLB 本地 z<0）的一段按比例压缩，前半（本地 z ≥ 0）所有顶点不变；REANCHOR 保持 6.65 不变（原点不动，前半逐顶点不变）。
"""
import bpy,bmesh,sys,math,json,time,os
from pathlib import Path
from mathutils import Vector,Matrix
T0=time.time();ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
_argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUTD=Path(_argv[_argv.index('--out')+1]).resolve() if '--out' in _argv else ROOT
OUTD.mkdir(parents=True,exist_ok=True)
from helpers import box_glb,glb_to_blender,blender_to_glb

TEX_DIRS=[os.path.abspath(os.path.join(ROOT,'..','..','..','..','..','asset-authoring','yuyuan-entry','source-kit','textures')),
          '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures']
TEX_DIR=next((d for d in TEX_DIRS if os.path.isdir(d)),None)
if not TEX_DIR:raise RuntimeError('source-kit textures not found')

bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene
D=dict(bays=[3.2,3.4,3.8,3.4,3.2],W=17.0,porch=2.4,bodyDepth=11.3,plinth=0.55,plinthOutFront=1.0,plinthOutSide=0.6,
 colFrontD=0.30,colH=3.4,lowerEave=4.35,lowerOver=1.1,lowerTop=5.6,upperWallIn=0.5,upperEave=6.6,upperOver=1.2,ridge=9.4,
 gableX=6.2,gableBreakY=7.9,cornerLift=0.45,cornerReach=1.6,eaveSag=0.05,
 plinthOutBack=0.18,lowerOverBack=0.0,upperOverBack=0.2)
REANCHOR=6.65   # 灰模原点(前廊柱列) -> 原台基外包平面中心: 前缘 +1.0, 后缘 -13.7-0.6=-14.3, 中心 (1.0-14.3)/2=-6.65
                # （wave2 背面收齐后台基后缘改为 -13.88，原点仍保持此值：前半几何逐顶点不变）
PIVOT=-REANCHOR # 背面檐口环压缩的支点（灰模 z；前半 z>=PIVOT 不动）
RECIPE={'base':'lead grey model (reference-greymodel-build.py), frozen section unchanged',
 'designValues':D,
 'refinements':['lattice-door-cores (analytic alpha texture x1)','side-bay rail wangzhu+lanban','eave rafters + 檐枋',
                'wadang+dishui rows on both eaves','main-ridge chiwen / chuiji+qiangji end caps'],
 'materials':{'roofTile':{'base':'roof-color.jpg','normal':'roof-normal.png','tile':[1.4,1.2]},
              'timber':{'baseColorSrgb':'6a2e22','normal':'Wood092_2K-JPG_NormalGL_1K.jpg','tile':[0.9,2.2],
                        'note':'wave4-huxinting2: flat base colour like hall-kit hk-timber-darkred (wood-stain multiply removed)'},
              'whiteWall':{'base':'PaintedPlaster017_2K-JPG_Color_1K.jpg','tint':'f2efe8','tile':[2.2,2.2]},
              'blueStone':{'base':'Bricks061_2K-JPG_Color_1K.jpg','tint':'8b9089','tile':[2.0,1.0]},
              'latticeCore':{'alpha':'textures/lattice-core-alpha.png','cellM':0.125,'alphaMode':'MASK',
                             'image':'modules/hall-kit/textures/lattice-core-alpha.png (same bytes, wave4-huxinting2)'}},
 'reanchor':{'from':'front colonnade centre (lead grey model)','to':'plan centre of the pre-wave2 plinth extents (kept fixed)','shiftGlbZ':REANCHOR},
 'backSide':{'decision':'wave2-sansuitang lead 2026-09-25: back only; nothing may cross the shared edge with 仰山堂','plinthOutBack':'flush with rear wall outer face','lowerOverBack':'from ZB','upperOverBack':'from UZB','backEaveDressing':False,'frontHalfUnchanged':'every triangle lying entirely at local z>=0 (position, normal, UV) identical to the 2026-09-23 build'},
 'textureDir':TEX_DIR}
META={};COLL=[];GROUP='hall'
MAT_TILE={}

def lin(h):
 a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a]

def mat(name,rgb=None,rough=.8,base=None,normal=None,tint=None,tile=(1,1)):
 m=bpy.data.materials.new(name);m.use_nodes=True;nodes,links=m.node_tree.nodes,m.node_tree.links
 p=nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*(rgb if rgb else lin('ffffff')),1)
 p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=0
 if base:
  t=nodes.new('ShaderNodeTexImage');t.extension='REPEAT'
  t.image=bpy.data.images.load(os.path.join(TEX_DIR,base),check_existing=True)
  t.image.colorspace_settings.name='sRGB'
  t.image.pack()
  if tint:
   mix=nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs['Factor'].default_value=1.0
   mix.inputs[7].default_value=(*lin(tint),1)
   links.new(t.outputs['Color'],mix.inputs[6]);links.new(mix.outputs[2],p.inputs['Base Color'])
  else:links.new(t.outputs['Color'],p.inputs['Base Color'])
 if normal:
  t=nodes.new('ShaderNodeTexImage');t.extension='REPEAT'
  t.image=bpy.data.images.load(os.path.join(TEX_DIR,normal),check_existing=True)
  t.image.colorspace_settings.name='Non-Color';t.image.pack()
  nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.65
  links.new(t.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs['Normal'])
 META[name]={'tintSrgb':tint,'roughness':rough,'textures':{k:v for k,v in (('color',base),('normal',normal)) if v},'tileMeters':list(tile)}
 MAT_TILE[name]=tile
 return m

M={'wall':mat('sst-white-wall',rough=.85,base='PaintedPlaster017_2K-JPG_Color_1K.jpg',tint='f2efe8',tile=(2.2,2.2)),
   'stone':mat('sst-blue-stone',rough=.92,base='Bricks061_2K-JPG_Color_1K.jpg',tint='8b9089',tile=(2.0,1.0)),
   # wave4-huxinting2（主控：格扇偏暗，与厅堂套件统一配色，框料 #6a2e22）：同 hall-kit hk-timber-darkred 做法，
   # 底色直接 = sRGB #6a2e22，不再乘 wood-stain 贴图（贴图均值 sRGB(68,38,28) × #6a2e22 线性值 → 有效底色约 sRGB(26,5,3)，
   # 格扇整面读成黑色）；木纹只走法线图。几何与 UV 不变。
   'wood':mat('sst-timber-darkred',lin('6a2e22'),rough=.7,normal='Wood092_2K-JPG_NormalGL_1K.jpg',tile=(0.9,2.2)),
   'roof':mat('sst-roof-tile',rough=.8,base='roof-color.jpg',normal='roof-normal.png',tile=(1.4,1.2)),
   'dark':mat('sst-dark-timber',lin('241d18'),.6),
   'eave':mat('sst-eave-dark',lin('2f2c28'),.75)}

# ---------- 格心 alpha 贴图：复用 hall-kit 同一张（wave4-huxinting2） ----------
# 原先本模块自画 160×160「lattice-core-alpha」（棂条 #241d18），与 hall-kit / 湖心亭的同名同尺寸图（棂条 = hall-kit timberSrgb）
# 在 assemble 贴图去重（名称 + 尺寸）时合并成一张，先导入的三穗堂版胜出——运行时所有厅堂和湖心亭的格心都变成 #241d18。
# 现在直接读 modules/hall-kit/textures/lattice-core-alpha.png（字节不变），去重前后颜色一致；格网（1 m = 8 格、方格 + 斜格）相同。
HK_LATTICE=ROOT.parent/'hall-kit'/'textures'/'lattice-core-alpha.png'
def make_lattice_image():
 img=bpy.data.images.load(str(HK_LATTICE),check_existing=False)
 img.name='lattice-core-alpha'
 out=OUTD/'textures'/'lattice-core-alpha.png';out.parent.mkdir(exist_ok=True)
 out.write_bytes(HK_LATTICE.read_bytes())
 img.pack()
 m=bpy.data.materials.new('sst-lattice-core');m.use_nodes=True
 nodes,links=m.node_tree.nodes,m.node_tree.links
 p=nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.7;p.inputs['Metallic'].default_value=0
 t=nodes.new('ShaderNodeTexImage');t.image=img;t.extension='REPEAT'
 links.new(t.outputs['Color'],p.inputs['Base Color']);links.new(t.outputs['Alpha'],p.inputs['Alpha'])
 try:m.blend_method='CLIP'
 except AttributeError:pass
 META['sst-lattice-core']={'alpha':'textures/lattice-core-alpha.png','cellM':0.125,'alphaMode':'MASK','alphaCutoff':0.5,
  'sharedImage':'modules/hall-kit/textures/lattice-core-alpha.png（字节相同；总装按名 + 尺寸去重）'}
 MAT_TILE['sst-lattice-core']=(1.0,1.0)  # UV 单位=米，纹理即 1m 格网
 return m
M['lattice']=make_lattice_image()

TILE_OF={'wall':(2.2,2.2),'stone':(2.0,1.0),'wood':(0.9,2.2),'roof':(1.4,1.2),'dark':(1,1),'eave':(1,1),'lattice':(1.0,1.0)}

def tag(o):o['part']=GROUP;return o
def box(name,c,s,m='wall',bevel=0,collision=False,tile=None):
 o=tag(box_glb(name,c,s,M[m],tile if tile else TILE_OF[m],bevel))
 if collision:COLL.append({'name':name,'center':list(c),'size':list(s),'type':'box'})
 return o
def rng(name,x0,x1,y0,y1,z0,z1,m='wall',bevel=0,collision=False):return box(name,((x0+x1)/2,(y0+y1)/2,(z0+z1)/2),(abs(x1-x0),abs(y1-y0),abs(z1-z0)),m,bevel,collision)
def trim_back(o,z_old,z_new):
 """wave2 背面收齐：盒按原尺寸建（对象原点不变 → 合并时其余顶点的浮点运算与旧构建逐位相同），
 再只把 GLB z==z_old 的背面顶点移到 z_new，并按 box_glb 同式重算这些顶点所在 loop 的 UV。"""
 me=o.data;loc=o.location;c=Vector(o['design_glb_center']);tile=o['uv_tile_m'];moved=set()
 for vv in me.vertices:
  if abs(-(loc.y+vv.co.y)-z_old)<1e-6:vv.co.y=-z_new-loc.y;moved.add(vv.index)
 me.update();uv=me.uv_layers['UVMap']
 for f in me.polygons:
  n=blender_to_glb(f.normal);axis=max(range(3),key=lambda i:abs(n[i]))
  for li in f.loop_indices:
   vi=me.loops[li].vertex_index
   if vi not in moved:continue
   q=blender_to_glb(me.vertices[vi].co)+c
   u,v=((-q.z,q.y) if axis==0 else (q.x,-q.z) if axis==1 else (q.x,q.y))
   uv.data[li].uv=(u/tile[0],v/tile[1])
 return o

def mesh_uv(name,items,faces,m,smooth=False):
 """items=[(glb_vert,(u,v))]; Blender 坐标转换后建 mesh。"""
 me=bpy.data.meshes.new(name);me.from_pydata([glb_to_blender(v) for v,_ in items],[],faces);me.update();me.materials.append(M[m])
 uv=me.uv_layers.new(name='UVMap')
 for p in me.polygons:
  for li in p.loop_indices:uv.data[li].uv=items[me.loops[li].vertex_index][1]
 for p in me.polygons:p.use_smooth=smooth
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return tag(o)

def mesh(name,verts,faces,m,smooth=False):
 t=TILE_OF[m]
 return mesh_uv(name,[(v,(v[0]/t[0],v[2]/t[1])) for v in verts],faces,m,smooth)

def quad_panel(name,center,w,h,yaw,m):
 """竖直面板：GLB 本地 X 宽 w、Y 高 h，yaw 绕 GLB +Y（本地 +X -> GLB (cos,-sin)）；UV=米。"""
 ax,az=math.cos(yaw),-math.sin(yaw)
 cx,cy,cz=center
 corners=[(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]
 items=[((cx+ux*ax,cy+uy,cz+ux*az),(ux+w/2,uy+h/2)) for ux,uy in corners]
 return mesh_uv(name,items,[(0,1,2,3)],m)

def obox(name,center,size,yaw,m,bevel=0):
 """任意 yaw（GLB +Y 轴）盒：用于椽头等朝向构件。GLB yaw = Blender Z 旋转。"""
 hx,hy,hz=[v/2 for v in size]
 loc=glb_to_blender(center)
 src=[(-hx,-hy,-hz),(hx,-hy,-hz),(hx,hy,-hz),(-hx,hy,-hz),(-hx,-hy,hz),(hx,-hy,hz),(hx,hy,hz),(-hx,hy,hz)]
 faces=[(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(0,1,5,4),(3,7,6,2)]
 rot=Matrix.Rotation(yaw,4,'Z')
 vs=[(rot@glb_to_blender((x,y,z)))+loc for x,y,z in src]
 t=TILE_OF[m]
 me=bpy.data.meshes.new(name);me.from_pydata([tuple(v) for v in vs],[],faces);me.update();me.materials.append(M[m])
 uv=me.uv_layers.new(name='UVMap')
 for f in me.polygons:
  nrm=f.normal
  axis=max(range(3),key=lambda i:abs(nrm[i]))
  for li in f.loop_indices:
   p=vs[me.loops[li].vertex_index]
   u,vv=((-p.z,p.y) if axis==0 else (p.x,-p.z) if axis==1 else (p.x,p.y))
   uv.data[li].uv=(u/t[0],vv/t[1])
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return tag(o)

def cyl(name,a,b,r,m,sides=12):
 va,vb=glb_to_blender(a),glb_to_blender(b);d=vb-va
 bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=d.length,location=(va+vb)/2)
 o=bpy.context.object;o.name=name;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(M[m]);return tag(o)

W=D['W'];hw=W/2;P0=D['plinth'];ZF=0.0;ZW=-D['porch'];ZB=-(D['porch']+D['bodyDepth'])
xs=[-hw];[xs.append(xs[-1]+b) for b in D['bays']]   # 6 column lines
# ---------------- platform, steps, rail（台基/踏步/望柱栏板栏杆）
GROUP='hall-base'
trim_back(rng('platform',-hw-D['plinthOutSide'],hw+D['plinthOutSide'],0,P0,ZB-D['plinthOutSide'],ZF+D['plinthOutFront'],'stone'),ZB-D['plinthOutSide'],ZB-D['plinthOutBack'])
COLL.append({'name':'platform','center':[0.0,P0/2,(ZB-D['plinthOutBack']+ZF+D['plinthOutFront'])/2],'size':[W+2*D['plinthOutSide'],P0,ZF+D['plinthOutFront']-(ZB-D['plinthOutBack'])],'type':'box'})
trim_back(rng('platform-cap',-hw-D['plinthOutSide']-.04,hw+D['plinthOutSide']+.04,P0-.08,P0,ZB-D['plinthOutSide']-.04,ZF+D['plinthOutFront']+.04,'stone'),ZB-D['plinthOutSide']-.04,ZB-D['plinthOutBack'])  # 背面与后墙外皮齐
def steps(xc,w,z0):
 n=4;rise=P0/n;tread=.32
 for k in range(n):
  zf=z0+tread*(n-k);rng('step',xc-w/2,xc+w/2,0,rise*(k+1),zf-tread,zf,'stone',0,True)
steps(0,D['bays'][2],ZF+D['plinthOutFront'])
steps((xs[0]+xs[1])/2,1.6,ZF+D['plinthOutFront']);steps((xs[4]+xs[5])/2,1.6,ZF+D['plinthOutFront'])
# 次间栏杆升级：望柱(带柱帽) + 栏板 + 下枋，扶手沿用
for i in (1,3):
 a,b=xs[i]+.18,xs[i+1]-.18;z=ZF+D['plinthOutFront']-.25
 rng('rail-hand',a,b,P0+.85,P0+.95,z-.05,z+.05,'wood')
 posts=[a+.07,(a+b)/2,b-.07]
 for px_ in posts:
  rng('rail-wangzhu',px_-.07,px_+.07,P0,P0+.85,z-.07,z+.07,'wood')
  rng('rail-wangzhu-cap',px_-.09,px_+.09,P0+.85,P0+.92,z-.09,z+.09,'stone')
 for p0x,p1x in zip(posts[:-1],posts[1:]):
  rng('rail-lanban',p0x+.08,p1x-.08,P0+.30,P0+.68,z-.03,z+.03,'wood')
  rng('rail-xiafang',p0x+.05,p1x-.05,P0+.02,P0+.22,z-.025,z+.025,'wood')
 COLL.append({'name':'porch-rail','center':[(a+b)/2,P0+.5,z],'size':[b-a+.1,1.0,.2],'type':'box'})
# ---------------- columns（柱网冻结不改）
GROUP='hall-frame'
def column(x,z,r,h0,h1,name='column'):
 cyl(name,(x,h0,z),(x,h1,z),r,'wood',12);box('column-base',(x,h0+.08,z),(r*2.3,.16,r*2.3),'stone');COLL.append({'name':name,'center':[x,(h0+h1)/2,z],'size':[r*2,h1-h0,r*2],'type':'box'})
for x in xs:
 column(x,ZF,D['colFrontD']/2,P0,P0+D['colH'],'front-column')
 top=D['lowerEave']-.34 if abs(x)>hw-.1 else D['lowerTop']-.3
 column(x,ZW,.16,P0,top,'wall-column')
 column(x,ZB,.16,P0,top,'rear-column')
for x in xs:
 if abs(x)>hw-.1:continue
 for z in (ZW-3.2,ZB+3.2):column(x,z,.17,P0,D['gableBreakY']-1.4,'inner-column')
# 额枋/檐枋：前（灰模已有）+ 后 + 两侧补齐；上檐另加檐枋一圈
rng('front-architrave',-hw-.2,hw+.2,P0+D['colH'],P0+D['colH']+.38,ZF-.14,ZF+.14,'wood')
rng('rear-architrave',-hw-.2,hw+.2,P0+D['colH'],P0+D['colH']+.38,ZB-.14,ZB+.14,'wood')
rng('side-architrave-l',-hw-.2,-hw+.14,P0+D['colH'],P0+D['colH']+.38,ZB,ZF,'wood')
rng('side-architrave-r',hw-.14,hw+.2,P0+D['colH'],P0+D['colH']+.38,ZB,ZF,'wood')
for x in xs:rng('porch-tie',x-.1,x+.1,P0+D['colH'],P0+D['colH']+.3,ZW,ZF,'wood')
eo=.55
eoB=min(eo,D['plinthOutBack'])   # 背面檐枋收到后墙外皮以内（wave2）；两侧檐枋按原尺寸建后只移背端顶点
rng('lower-eave-beam',-hw-eo,hw+eo,D['lowerEave']-.32,D['lowerEave']-.12,ZF+eo-.2,ZF+eo,'wood')
rng('lower-eave-beam',-hw-eo,hw+eo,D['lowerEave']-.32,D['lowerEave']-.12,ZB-eoB,ZB-eoB+.2,'wood')
for x0,x1 in ((-hw-eo,-hw-eo+.2),(hw+eo-.2,hw+eo)):
 trim_back(rng('lower-eave-beam',x0,x1,D['lowerEave']-.32,D['lowerEave']-.12,ZB-eo+.2,ZF+eo-.2,'wood'),ZB-eo+.2,ZB-eoB+.2)
# 上层檐枋（上檐下皮）
ui=D['upperWallIn'];UX=hw-ui;UZF=ZF-.6;UZB=ZB+.2
rng('upper-eave-fascia',-UX-.1,UX+.1,D['upperEave']-.5,D['upperEave']-.24,UZF+.1,UZF+.24,'wood')
rng('upper-eave-fascia',-UX-.1,UX+.1,D['upperEave']-.5,D['upperEave']-.24,UZB-.24,UZB-.1,'wood')
rng('upper-eave-fascia',-UX-.1,-UX+.1,D['upperEave']-.5,D['upperEave']-.24,UZB-.1,UZF+.1,'wood')
rng('upper-eave-fascia',UX-.1,UX+.1,D['upperEave']-.5,D['upperEave']-.24,UZB-.1,UZF+.1,'wood')
# ---------------- walls（下层墙身，冻结）
GROUP='hall-wall'
t=.36
rng('side-wall-l',-hw-t/2,-hw+t/2,P0,D['lowerTop'],ZB,ZW,'wall',0,True);rng('side-wall-r',hw-t/2,hw+t/2,P0,D['lowerTop'],ZB,ZW,'wall',0,True)
rng('rear-wall',-hw,hw,P0,D['lowerTop'],ZB-t/2,ZB+t/2,'wall',0,True)
# 前墙：梢间槛墙+半窗（格心 alpha），次/明间 6 扇格扇（格心 alpha + 绦环板 + 裙板）
for i in range(5):
 a,b=xs[i]+.16,xs[i+1]-.16
 if i in (0,4):
  rng('sill-wall',a,b,P0,P0+.9,ZW-t/2,ZW+t/2,'wall',0,True)
  rng('half-window-frame',a,b,P0+.9,P0+D['colH'],ZW-.06,ZW+.06,'wood')
  quad_panel('half-window-core',((a+b)/2,P0+.98+(D['colH']-.98-.12)/2,ZW+.07),b-a-.16,D['colH']-.98-.12,0.0,'lattice')
  COLL.append({'name':'half-window','center':[(a+b)/2,(P0+.9+P0+D['colH'])/2,ZW],'size':[b-a,D['colH']-.9,.12],'type':'box'})
 else:
  n=6;pw=(b-a)/n
  for k in range(n):
   x0=a+pw*k;open_=(i==2 and k in (2,3))
   if open_:continue
   rng('door-frame',x0,x0+pw,P0,P0+D['colH'],ZW-.05,ZW+.05,'wood')
   quad_panel('door-core',((x0+pw/2),P0+1.05+(D['colH']-1.05-.12)/2,ZW+.06),pw-.14,D['colH']-1.05-.12,0.0,'lattice')
   rng('door-tieband',x0+.06,x0+pw-.06,P0+.92,P0+1.05,ZW+.02,ZW+.05,'dark')
   rng('door-panel',x0+.08,x0+pw-.08,P0+.12,P0+.92,ZW-.03,ZW+.03,'dark')
   COLL.append({'name':'door-leaf','center':[x0+pw/2,(P0+P0+D['colH'])/2,ZW],'size':[pw,D['colH'],.1],'type':'box'})
 rng('front-lintel',xs[i],xs[i+1],P0+D['colH'],D['lowerTop'],ZW-t/2,ZW+t/2,'wall',0,True)
# 上层墙 + 格纹带（alpha 面板，每面外皮外 3 cm）
GROUP='hall-upper'
yh0,yh1=D['lowerTop']+.25,D['upperEave']-.35
for side in ('front','back','left','right'):
 if side=='front':quad_panel('upper-lattice-band',(0,(yh0+yh1)/2,UZF+t/2+.03),2*UX-.6,yh1-yh0,0.0,'lattice')
 elif side=='back':quad_panel('upper-lattice-band',(0,(yh0+yh1)/2,UZB-t/2-.03),2*UX-.6,yh1-yh0,0.0,'lattice')
 elif side=='left':quad_panel('upper-lattice-band',(-UX-t/2-.03,(yh0+yh1)/2,(UZF+UZB)/2),abs(UZF-UZB)-.6,yh1-yh0,math.pi/2,'lattice')
 else:quad_panel('upper-lattice-band',(UX+t/2+.03,(yh0+yh1)/2,(UZF+UZB)/2),abs(UZF-UZB)-.6,yh1-yh0,math.pi/2,'lattice')
# ---------------- roofs（坡面 loft 冻结；檐口饰件=封檐板+椽头+瓦当滴水）
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
def back_compress(pts,z_old,z_new):
 """背面收檐：以原点横截面（PIVOT）后的第一个环采样点 zp 为支点，z<zp 的环点按比例压缩到 [z_new, zp]；
 z>=zp 的点原样（前半及跨 PIVOT 的那一段檐口饰件都不变）。"""
 zp=max(p[2] for p in pts if p[2]<PIVOT)
 k=(zp-z_new)/(zp-z_old)
 return [[p[0],p[1],(zp+(p[2]-zp)*k) if p[2]<zp else p[2],p[3]] for p in pts]
BACK_SEGS=set(range(64,100))   # loop() 顺序：前 0-35 / 右 36-63 / 后 64-99 / 左 100-127
def eave_fascia(lo,name,skip=()):
 N=len(lo)
 for i in range(N):
  if i in skip:continue
  a=lo[i][:3];b=lo[(i+1)%N][:3];mesh(name+'-fascia',[a,b,(b[0],b[1]-.16,b[2]),(a[0],a[1]-.16,a[2])],[(0,3,2,1)],'dark')
def eave_dressing(lo,name,skip=()):
 """椽头（方椽，外法线向）+ 瓦当（8 边盘）+ 滴水（三角盘）。外法线 n=(-dz,dx)。"""
 N=len(lo);count=0
 for i in range(N):
  if i in skip:continue
  a=lo[i][:3];b=lo[(i+1)%N][:3]
  L=math.hypot(b[0]-a[0],b[2]-a[2])
  if L<1e-6:continue
  nraf=max(1,int(round(L/0.30)))
  dx,dz=(b[0]-a[0])/L,(b[2]-a[2])/L
  nx,nz=-dz,dx
  yaw=math.atan2(-nz,nx)   # 本地 +X -> GLB (cos yaw, -sin yaw) = (nx, nz)
  for k in range(nraf):
   tt=(k+0.5)/nraf;px=a[0]+(b[0]-a[0])*tt;py=a[1]+(b[1]-a[1])*tt;pz=a[2]+(b[2]-a[2])*tt
   obox(name+'-rafter',(px-nx*0.125,py-0.20,pz-nz*0.125),(0.75,0.09,0.09),yaw,'wood')
   # 瓦当：竖立 8 边盘，圆心在封檐板外皮前 3 cm，y=eave-0.10
   c=(px+nx*0.03,py-0.10,pz+nz*0.03)
   ring=[(c[0]+dx*0.075*math.cos(2*math.pi*j/8),c[1]+0.075*math.sin(2*math.pi*j/8),c[2]+dz*0.075*math.cos(2*math.pi*j/8)) for j in range(8)]
   mesh(name+'-wadang',ring,[(0,1,2,3,4,5,6,7)],'eave')
   # 滴水：三角盘，上沿与封檐板下皮搭接，垂 0.14
   ty=py-0.16
   A=(px-dx*0.08,ty,pz-dz*0.08);B=(px+dx*0.08,ty,pz+dz*0.08);C=(px,ty-0.14,pz)
   th=0.014;f=[(v[0]+nx*th,v[1],v[2]+nz*th) for v in (A,B,C)];bk=[(v[0]-nx*th,v[1],v[2]-nz*th) for v in (A,B,C)]
   mesh(name+'-dishui',f+bk,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],'eave')
   count+=1
 return count
def hip_rods(verts,N,rings,idxs,name):
 for ci in idxs:
  for j in range(rings):
   a=verts[j*N+ci];b=verts[(j+1)*N+ci];cyl(name,(a[0],a[1]+.05,a[2]),(b[0],b[1]+.05,b[2]),.08,'roof',8)
# lower skirt roof
lo=loop(-hw-D['lowerOver'],hw+D['lowerOver'],ZB-D['lowerOver'],ZF+D['lowerOver'],D['lowerEave'],D['cornerLift'],D['cornerReach'],D['eaveSag'])
lo=back_compress(lo,ZB-D['lowerOver'],ZB-D['lowerOverBack'])
hi=loop(-UX+.02,UX-.02,UZB+.02,UZF-.02,D['lowerTop'],0,0,0)
o,v,N,R=loft('lower-roof',lo,hi,6);eave_fascia(lo,'lower',BACK_SEGS);hip_rods(v,N,R,[0,36,64,100],'lower-hip')
nlower=eave_dressing(lo,'lower',BACK_SEGS)
# upper roof
UO=D['upperOver'];lo2=loop(-UX-UO,UX+UO,UZB-UO,UZF+UO,D['upperEave'],D['cornerLift']+.15,D['cornerReach'],D['eaveSag'])
lo2=back_compress(lo2,UZB-UO,UZB-D['upperOverBack'])
zc=(UZF+UZB)/2;half=(UZF-UZB)/2;yb=D['gableBreakY'];fr=(yb-D['upperEave'])/(D['ridge']-D['upperEave']);zin=(half+UO)*(1-fr)
hi2=loop(-D['gableX'],D['gableX'],zc-zin,zc+zin,yb,0,0,0)
o2,v2,N2,R2=loft('upper-roof-skirt',lo2,hi2,7);eave_fascia(lo2,'upper',BACK_SEGS);hip_rods(v2,N2,R2,[0,36,64,100],'upper-hip')
nupper=eave_dressing(lo2,'upper',BACK_SEGS)
# gable slopes + 山花（平三角面，冻结取舍）
gx=D['gableX'];RY=D['ridge']
for side,(z0,z1) in enumerate(((zc+zin,zc),(zc-zin,zc))):
 vs=[(-gx-.5,yb,z0),(gx+.5,yb,z0),(gx+.5,RY,z1),(-gx-.5,RY,z1)];mesh('upper-gable-slope',vs,[(0,1,2,3) if side==0 else (0,3,2,1)],'roof')
for sx in (-1,1):
 x=sx*gx;vs=[(x,yb,zc+zin),(x,yb,zc-zin),(x,RY,zc)];mesh('shanhua',vs,[(0,1,2) if sx>0 else (0,2,1)],'wall')
# 正脊 + 两端吻（收头：三段递进 + 顶珠）
cyl('main-ridge',(-gx-.5,RY+.07,zc),(gx+.5,RY+.07,zc),.15,'roof',10)
for sx in (-1,1):
 bx=sx*(gx+.5)
 box('chiwen-base',(bx+sx*.10,RY+.26,zc),(.42,.38,.34),'eave')
 box('chiwen-mid',(bx+sx*.20,RY+.55,zc),(.34,.30,.30),'eave')
 box('chiwen-top',(bx+sx*.30,RY+.80,zc),(.26,.24,.26),'eave')
 box('chiwen-pearl',(bx+sx*.34,RY+.98,zc),(.15,.15,.15),'eave')
# 垂脊收头（上层垂脊下端 = 裙檐 loft 末环 4 处）+ 戗脊收头（下层戗脊檐角端 4 处）：小斗+顶珠，沿脊向延伸
def ridge_end_caps(verts,NR,ci_list,name):
 for ci in ci_list:
  a=verts[NR*N+ci];b=verts[(NR-1)*N+ci]
  dx_,dy_,dz_=a[0]-b[0],a[1]-b[1],a[2]-b[2];L=math.sqrt(dx_*dx_+dy_*dy_+dz_*dz_) or 1.0
  ux,uy,uz=dx_/L,dy_/L,dz_/L
  box(name+'-cap',(a[0]+ux*0.10,a[1]+uy*0.10,a[2]+uz*0.10),(.18,.18,.18),'eave')
  box(name+'-pearl',(a[0]+ux*0.24,a[1]+uy*0.24,a[2]+uz*0.24),(.11,.11,.11),'eave')
ridge_end_caps(v2,R2,[0,36,64,100],'chuiji')
def eave_end_caps(verts,ci_list,name):
 for ci in ci_list:
  a=verts[0*N+ci];b=verts[1*N+ci]
  dx_,dy_,dz_=a[0]-b[0],a[1]-b[1],a[2]-b[2];L=math.sqrt(dx_*dx_+dy_*dy_+dz_*dz_) or 1.0
  ux,uy,uz=dx_/L,dy_/L,dz_/L
  box(name+'-cap',(a[0]+ux*0.10,a[1]+uy*0.10,a[2]+uz*0.10),(.18,.16,.18),'eave')
  box(name+'-pearl',(a[0]+ux*0.22,a[1]+uy*0.22,a[2]+uz*0.22),(.10,.10,.10),'eave')
eave_end_caps(v,[0,36,64,100],'qiangji')
# ---------------- interior frames, screen doors, floor（冻结）
GROUP='hall-interior'
rng('floor',-hw+.2,hw-.2,P0-.02,P0+.02,ZB+.2,ZW-.2,'stone')
for x in xs:
 if abs(x)>hw-.1:continue
 rng('main-beam',x-.15,x+.15,D['gableBreakY']-1.6,D['gableBreakY']-1.2,ZB+.2,ZW-.2,'wood')
 for z in (ZW-3.2,ZB+3.2):rng('guazhu',x-.12,x+.12,D['gableBreakY']-1.2,D['gableBreakY']-.1,z-.12,z+.12,'wood')
 if abs(x)<D['gableX']-.2:
  rng('upper-beam',x-.12,x+.12,D['gableBreakY']-.1,D['gableBreakY']+.2,ZB+3.2,ZW-3.2,'wood')
  rng('ridge-post',x-.1,x+.1,D['gableBreakY']+.2,RY-.35,zc-.1,zc+.1,'wood')
zs_=ZB+3.2
for k in range(4):
 x0=-1.9+k*.95
 rng('screen-frame',x0+.03,x0+.92,P0,P0+2.8,zs_-.05,zs_-.02,'wood')
 quad_panel('screen-core',(x0+.475,P0+1.46,zs_+0.0),.80,2.66,0.0,'lattice')
 COLL.append({'name':'screen-door','center':[x0+.475,P0+1.4,zs_],'size':[.95,2.8,.1],'type':'box'})
# ---------------- join per (part,material), re-anchor, triangulate, export
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
# 重锚：整体 +REANCHOR (GLB z) = Blender y 平移 -REANCHOR（网格数据级，不依赖对象变换）
for o in final:o.data.transform(Matrix.Translation((0,-REANCHOR,0)))
bpy.ops.wm.save_as_mainfile(filepath=str(OUTD/'model.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in final:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUTD/'model.glb'),export_format='GLB',export_yup=True,export_apply=True,use_selection=True,export_animations=False,export_cameras=False,export_lights=False)
# alphaMode 兜底：确保格心材质 = MASK + cutoff（Blender 4.5 导出为 BLEND）
glb=OUTD/'model.glb';buf=bytearray(glb.read_bytes())
jl=int.from_bytes(buf[12:16],'little')
assert bytes(buf[16:20])==b'JSON'
j=json.loads(bytes(buf[20:20+jl]))
bl_off=20+jl
bl=int.from_bytes(buf[bl_off:bl_off+4],'little')
assert bytes(buf[bl_off+4:bl_off+8])==b'BIN\x00'
bindata=bytes(buf[bl_off+8:bl_off+8+bl])
changed=False
for m in j.get('materials',[]):
 if 'lattice' in m.get('name',''):
  if m.get('alphaMode')!='MASK':m['alphaMode']='MASK';changed=True
  if m.get('alphaCutoff')!=0.5:m['alphaCutoff']=0.5;changed=True
if changed:
 nj=json.dumps(j,separators=(',',':')).encode();njp=nj+b' '*((-len(nj))%4)
 total=12+8+len(njp)+8+bl
 out=b'glTF'+(2).to_bytes(4,'little')+total.to_bytes(4,'little')+len(njp).to_bytes(4,'little')+b'JSON'+njp+bl.to_bytes(4,'little')+b'BIN\x00'+bindata
 glb.write_bytes(out)
tris=0;by={}
for o in final:o.data.calc_loop_triangles();n=len(o.data.loop_triangles);tris+=n;by[o.name]=n
maxy=max(v.co.z for o in final for v in o.data.vertices)
minx=min(v.co.x for o in final for v in o.data.vertices);maxx=max(v.co.x for o in final for v in o.data.vertices)
miny=min(v.co.y for o in final for v in o.data.vertices);maxy2=max(v.co.y for o in final for v in o.data.vertices)
json.dump({'triangles':tris,'byNode':by,'glbBytes':glb.stat().st_size,'maxY':round(maxy,3),
 'planExtentsBlenderY':[round(miny,2),round(maxy2,2)],'planWidthX':[round(minx,2),round(maxx,2)],
 'reanchored':REANCHOR,'eaveDressingCounts':{'lower':nlower,'upper':nupper},
 'designDimensions':{'facadeWidth':W,'depth':D['porch']+D['bodyDepth'],'platform':P0,'lowerEave':D['lowerEave'],'upperEave':D['upperEave'],'ridge':D['ridge'],'footprintWithPlinth':[W+2*D['plinthOutSide'],D['porch']+D['bodyDepth']+D['plinthOutFront']+D['plinthOutBack']]},'buildSeconds':round(time.time()-T0,1)},open(OUTD/'measurements.json','w'),ensure_ascii=False,indent=2)
for c in COLL:c['center'][2]+=REANCHOR   # 碰撞同步重锚（实例/本地坐标，z= facade 轴）
json.dump({'axis':'Y-up +Z facade','origin':'plan centre of the pre-wave2 plinth extents (reanchored from front colonnade by +%.2f GLB z; kept fixed after the wave2 back-side trim)'%REANCHOR,'instanceSpace':True,'integratedIntoWorld':False,'colliders':COLL},open(OUTD/'collision.json','w'),ensure_ascii=False,indent=2)
json.dump(RECIPE,open(OUTD/'recipe.json','w'),ensure_ascii=False,indent=2)
print('SANSUITANG_REFINED',tris,glb.stat().st_size,round(maxy,2),'eaveDressing',nlower+nupper)
