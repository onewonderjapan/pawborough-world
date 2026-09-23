"""Batch of Shanghai / Chenghuangmiao snack props. Each prop is one multi-material node at its own origin
(ground centre). Design metres, GLB Y-up. Run: blender --background --python build_snacks.py
Outputs: snacks-batch.glb, snacks-batch.blend, catalog.json, materials.json, shots/snacks-batch-*.jpg"""
import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
import geomlib as G
from geomlib import box,mesh,cyl,rod,lathe,band,ring_shell,disc,vessel,sphere,ring_positions,join
G.TEX=ROOT/'textures'
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene;sc.unit_settings.system='METRIC'
mat=G.mat
mat('porcelain','white-porcelain','f2f0ea',.18)
mat('rim','porcelain-blue-rim','3a5a8c',.2)
mat('dough','glutinous-dough','f3ede2',.38)
mat('soup','clear-soup','d9d2c0',.08,alpha=.55)
mat('osoup','osmanthus-sweet-soup',base='osmanthus-soup.jpg',rough=.08,source='make_maps.py')
mat('milk','soy-milk','f1e9d6',.15)
mat('crust','fried-crust',base='fried-crust.jpg',rough=.5,tile=(.12,.12),source='make_maps.py')
mat('sesame','sesame-flatbread-top',base='sesame-top.jpg',rough=.55,source='make_maps.py')
mat('pancake','scallion-pancake-top',base='scallion-pancake.jpg',rough=.5,source='make_maps.py')
mat('babao','babaofan-top',base='babaofan-top.jpg',rough=.35,source='make_maps.py')
mat('sauce','sweet-soy-glaze','5a2a12',.12)
mat('rib','braised-pork-rib','6b3a1e',.3)
mat('niangao','rice-cake-glazed','d9b98a',.22)
mat('bamboo','bamboo-tray','c9a86a',.62)
mat('weave','bamboo-weave','a88750',.72)
mat('iron','dark-iron','44453d',.64,.48)
mat('steel','brushed-steel','9da0a3',.35,.85)
mat('glass','clear-glass-jar','f4f8f8',.02,alpha=.12)
mat('beans','five-spice-beans',base='bean-mass.jpg',rough=.6,tile=(.06,.06),source='make_maps.py')
mat('paper','kraft-paper','d8c39a',.9)
mat('label','label-atlas',base='labels-atlas.png',rough=.7,clamp=True,source='typeset make_maps.py')
mat('amber','pear-syrup-candy','c78a2a',.15)
mat('boxcard','paper-box-card','e7dcc4',.85)
mat('wood','chopstick-wood','b48a5a',.6)
mat('vinegar','dark-vinegar','2a1810',.05)
mat('tea','clay-teapot','6e3f2a',.45)
mat('greens','scallion-greens','5c8a3a',.6)

def label(name,c,w,h,row,face='+z',rows=4):
 """Quad showing atlas row on a box face; face '+z' (front), '+y' (top), '+x'."""
 x,y,z=c;v0,v1=1-(row+1)/rows,1-row/rows
 if face=='+z':vs=[(x-w/2,y-h/2,z),(x+w/2,y-h/2,z),(x+w/2,y+h/2,z),(x-w/2,y+h/2,z)]
 elif face=='+y':vs=[(x-w/2,y,z+h/2),(x+w/2,y,z+h/2),(x+w/2,y,z-h/2),(x-w/2,y,z-h/2)]
 else:vs=[(x,y-h/2,z+w/2),(x,y-h/2,z-w/2),(x,y+h/2,z-w/2),(x,y+h/2,z+w/2)]
 return mesh(name,vs,[(0,1,2,3)],'label',[(0,v0),(1,v0),(1,v1),(0,v1)])
def plate(name,origin,r=.11):
 return vessel(name,origin,[(0,r*.55),(.004,r*.68),(.012,r*.9),(.02,r)],'porcelain','rim',.017,36)
def bowl(name,origin,r=.066,h=.06):
 return vessel(name,origin,[(0,r*.45),(.004,r*.53),(.02,r*.76),(h*.75,r*.94),(h,r)],'porcelain','rim',h-.008,32)
def liquid(name,origin,r,y,m):return disc(name,(origin[0],origin[1]+y,origin[2]),r,.002,m,32)
def spoon(origin,ang=0):
 ox,oy,oz=origin;c,s=math.cos(ang),math.sin(ang)
 sphere('spoon-bowl',(ox,oy,oz),.016,'porcelain',12,5,squash=.45,scale_x=1.5)
 box('spoon-handle',(ox+.05*c,oy+.012,oz+.05*s),(.07,.008,.014),'porcelain',.002)

# ---------- 1. 汤团 ----------
def tangyuan_bowl():
 o=(0,0,0);bowl('bowl',o);liquid('soup',o,.058,.046,'soup')
 for k,(bx,bz) in enumerate(ring_positions([(.03,5)])):
  if k==0:lathe('tangyuan-meat',(bx,.028,bz),[(0,.012,0),(.006,.017,0),(.016,.016,0),(.026,.009,0),(.034,0,0)],'dough',16,cap_top=False)
  else:sphere('tangyuan',(bx,.026,bz),.0175,'dough',16,8)
 spoon((.02,.03,-.03),.6)
# ---------- 2. 酒酿圆子 ----------
def jiuniang_bowl():
 o=(0,0,0);bowl('bowl',o);liquid('sweet-soup',o,.058,.047,'osoup')
 for k,(bx,bz) in enumerate(ring_positions([(.018,6),(.036,12),(.05,7)])):
  if math.hypot(bx,bz)<.052:sphere('yuanzi',(bx,.041,bz),.0065,'dough',10,5)
# ---------- 3. 豆浆 ----------
def soymilk_bowl():
 o=(0,0,0);bowl('bowl',o,.07,.065);liquid('soy-milk',o,.062,.052,'milk')
 lathe('youtiao-piece',(-.02,.058,-.02),[(0,.008,0),(.01,.012,0),(.04,.012,0),(.05,.008,0),(.052,0,0)],'crust',12,axis='z',bumps=(2,.25),twist=1.2)
# ---------- 4. 油条 ----------
def youtiao_pair():
 plate('plate',(0,0,0),.12)
 for k,xx in enumerate((-.022,.022)):
  lathe('youtiao',(xx,.038,-.13),[(0,.006,0),(.02,.015,0),(.13,.017,0),(.24,.016,0),(.255,.008,0),(.26,0,0)],'crust',14,axis='z',bumps=(2,.28),twist=2.4+k)
# ---------- 5. 蟹壳黄 ----------
def xiekehuang_tray():
 ring_shell('tray-rim',(0,0,0),.175,.035,.008,'bamboo',40,inner_floor=.006)
 disc('tray-floor',(0,.004,0),.168,.004,'weave',40)
 for (bx,bz) in ring_positions([(.058,6),(.115,10)]):
  sphere('xiekehuang',(bx,.008,bz),.031,'sesame',16,6,squash=.36,scale_x=1.3,uv_top_planar=.08)
# ---------- 6. 大饼 ----------
def dabing_stack():
 for k in range(4):
  sphere('dabing',(.004*k,.011*k,-.003*k),.075,'sesame',24,4,squash=.075,uv_top_planar=.16)
# ---------- 7. 葱油饼 ----------
def congyoubing_plate():
 plate('plate',(0,0,0),.11)
 for k in range(5):
  lathe('congyoubing',(.003*(k%2),.02+.012*k,.002*k),[(0,.05,0),(.003,.06,0),(.009,.06,0),(.012,.05,0),(.012,0,0)],['pancake','crust'],28,cap_bottom=True,cap_top=False,mat_by_y=(.008,1,0),uv_top_planar=.125)
# ---------- 8. 粢饭糕 ----------
def cifangao_plate():
 plate('plate',(0,0,0),.11)
 for i in range(3):
  for j in range(2):
   box('cifangao',(-.03+.03*i,.028+.006*(i%2),-.025+.05*j),(.028,.015,.075),'crust',.003)
# ---------- 9. 油墩子 ----------
def youdunzi_rack():
 disc('rack',(0,.0,0),.16,.006,'iron',36);band('rack-rim',(0,0,0),.16,0,.02,'iron',36)
 for (bx,bz) in ring_positions([(.075,5)]):
  lathe('youdunzi',(bx,.008,bz),[(0,.028,0),(.008,.034,0),(.022,.035,0),(.03,.03,0),(.032,.02,0),(.033,0,0)],'crust',18,cap_top=False,bumps=(7,.04))
  sphere('radish-shreds',(bx,.036,bz),.017,'greens',10,3,squash=.3)
# ---------- 10. 排骨年糕 ----------
def paigu_niangao_plate():
 plate('plate',(0,0,0),.12);disc('glaze',(0,.021,0),.085,.002,'sauce',32)
 box('niangao',(-.035,.03,-.005),(.03,.014,.11),'niangao',.005);box('niangao',(.0,.03,.01),(.03,.014,.11),'niangao',.005)
 box('pork-rib',(.045,.03,-.01),(.055,.013,.09),'rib',.006);box('rib-bone',(.045,.03,.045),(.05,.016,.016),'porcelain',.004)
# ---------- 11. 春卷 ----------
def chunjuan_plate():
 plate('plate',(0,0,0),.11)
 for k in range(6):
  xx=-.05+.02*k;lathe('chunjuan',(xx,.03,-.05),[(0,.006,0),(.006,.012,0),(.095,.012,0),(.1,.006,0),(.102,0,0)],'crust',12,axis='z',twist=.3)
# ---------- 12. 八宝饭 ----------
def babaofan():
 plate('plate',(0,0,0),.10);sphere('babaofan',(0,.02,0),.07,'babao',32,10,squash=.5,uv_top_planar=.14)
# ---------- 13. 五香豆 ----------
def wuxiangdou_jar():
 vessel('jar',(0,0,0),[(0,.07),(.004,.078),(.17,.078),(.19,.07),(.2,.06),(.215,.06)],'glass',None,None,32,.003)
 lathe('beans',(0,.006,0),[(0,.06,0),(.02,.073,0),(.12,.074,0),(.145,.065,0),(.15,0,0)],'beans',32,bumps=(11,.03))
 lathe('jar-lid',(0,.213,0),[(0,.063,0),(.014,.063,0),(.014,0,0)],'steel',32)
 label('jar-label',(0,.10,.0785),.10,.032,0)
def wuxiangdou_packet():
 box('packet',(0,.06,0),(.09,.12,.032),'paper',.003)
 box('packet-fold',(0,.125,0),(.09,.012,.012),'paper',.002)
 label('packet-label',(0,.055,.0165),.08,.026,0);label('packet-mark',(0,.09,.0165),.05,.016,3)
# ---------- 14. 梨膏糖 ----------
def ligaotang_box():
 box('box-body',(0,.015,0),(.12,.03,.08),'boxcard',.002)
 box('box-lid',(0,.015,-.062),(.124,.03,.006),'boxcard',.002);label('lid-label',(0,.015,-.0585),.1,.024,1)
 for i in range(3):
  for j in range(2):
   box('ligaotang',(-.037+.037*i,.033,-.017+.034*j),(.032,.012,.026),'amber',.003)
# ---------- 15. 桌上小件 ----------
def chopstick_cup():
 vessel('cup',(0,0,0),[(0,.03),(.003,.033),(.07,.036),(.075,.036)],'porcelain','rim',.068,20,.003)
 for k in range(14):
  a=k*2.4;r=.02*math.sqrt((k+1)/14);rod('chopstick',(r*math.cos(a),.01,r*math.sin(a)),(r*1.6*math.cos(a),.24,r*1.6*math.sin(a)),.0035,'wood')
def vinegar_dish():
 vessel('dish',(0,0,0),[(0,.02),(.003,.026),(.012,.036),(.015,.038)],'porcelain','rim',.012,24,.003);disc('vinegar',(0,.01,0),.03,.002,'vinegar',24)
def teapot_cups():
 lathe('teapot',(0,0,0),[(0,.035,0),(.01,.05,0),(.05,.055,0),(.085,.045,0),(.095,.03,0),(.1,.03,0)],'tea',24)
 lathe('teapot-lid',(0,.1,0),[(0,.032,0),(.008,.032,0),(.012,.02,0),(.02,.008,0),(.024,0,0)],'tea',20)
 rod('spout',(.045,.04,0),(.085,.095,0),.008,'tea');rod('handle-top',(-.05,.085,0),(-.085,.06,0),.006,'tea');rod('handle-bottom',(-.085,.06,0),(-.05,.03,0),.006,'tea')
 for k,(cx,cz) in enumerate(((.12,.02),(.11,-.08),(-.11,.07))):vessel('teacup',(cx,0,cz),[(0,.018),(.003,.022),(.03,.03),(.04,.032)],'porcelain','rim',.035,20,.003)

PROPS={'tangyuan-bowl':tangyuan_bowl,'jiuniang-yuanzi-bowl':jiuniang_bowl,'soymilk-bowl':soymilk_bowl,'youtiao-pair-plate':youtiao_pair,
 'xiekehuang-tray':xiekehuang_tray,'dabing-stack':dabing_stack,'congyoubing-plate':congyoubing_plate,'cifangao-plate':cifangao_plate,
 'youdunzi-rack':youdunzi_rack,'paigu-niangao-plate':paigu_niangao_plate,'chunjuan-plate':chunjuan_plate,'babaofan-plate':babaofan,
 'wuxiangdou-jar':wuxiangdou_jar,'wuxiangdou-packet':wuxiangdou_packet,'ligaotang-box':ligaotang_box,
 'chopstick-cup':chopstick_cup,'vinegar-dish':vinegar_dish,'teapot-cups':teapot_cups}
objs=[];catalog={}
for name,fn in PROPS.items():
 G.GROUP[0]=name;before=set(sc.objects);fn();items=[o for o in sc.objects if o not in before]
 o=join(items,'prop__'+name);objs.append(o)
 o.data.calc_loop_triangles();catalog[name]={'triangles':len(o.data.loop_triangles),'materials':[m.name for m in o.data.materials],'sizeMeters':{'x':round(o.dimensions.x,3),'y':round(o.dimensions.z,3),'z':round(o.dimensions.y,3)},'origin':'ground centre'}
bpy.ops.object.select_all(action='DESELECT')
for o in objs:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'snacks-batch.glb'),export_format='GLB',export_yup=True,export_apply=True,use_selection=True,export_animations=False,export_tangents=True,export_image_format='AUTO',export_cameras=False,export_lights=False)
# contact-sheet layout for the render: 6 columns
cols=6;pitch=.5
for i,o in enumerate(objs):o.location=((i%cols)*pitch,-(i//cols)*pitch,0)
w=bpy.data.worlds.new('w');sc.world=w;w.use_nodes=True;w.node_tree.nodes['Background'].inputs['Strength'].default_value=.8
sun=bpy.data.lights.new('sun','SUN');sun.energy=3.5;sun.angle=math.radians(3);so=bpy.data.objects.new('sun',sun);sc.collection.objects.link(so);so.rotation_euler=(math.radians(48),0,math.radians(140))
bpy.ops.mesh.primitive_plane_add(size=8,location=((cols-1)*pitch/2,-pitch,-.002));tbl=bpy.context.object;tm=bpy.data.materials.new('table');tm.use_nodes=True;tm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.33,.25,.19,1);tbl.data.materials.append(tm)
def cam(name,pos,look,fov):
 c=bpy.data.cameras.new(name);c.lens_unit='FOV';c.angle=math.radians(fov);o=bpy.data.objects.new(name,c);sc.collection.objects.link(o)
 p=Vector(pos);t=Vector(look);o.location=p;o.rotation_mode='QUATERNION';o.rotation_quaternion=(t-p).to_track_quat('-Z','Y');return o
rows=(len(objs)+cols-1)//cols;cx=(cols-1)*pitch/2;cy=-(rows-1)*pitch/2
CAMS={'overview':cam('overview',(cx,cy-2.9,2.4),(cx,cy+.05,.05),52)}
sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=64;sc.cycles.use_denoising=True
sc.render.resolution_x=1600;sc.render.resolution_y=800;sc.render.image_settings.file_format='JPEG';sc.render.image_settings.quality=92
(ROOT/'shots').mkdir(exist_ok=True);(ROOT/'shots'/'tiles').mkdir(exist_ok=True)
for name,c in CAMS.items():
 sc.camera=c;sc.render.filepath=str(ROOT/'shots'/f'snacks-batch-{name}.jpg');bpy.ops.render.render(write_still=True)
# one framed tile per prop: camera distance scales with the prop's largest dimension
sc.render.resolution_x=480;sc.render.resolution_y=480;sc.cycles.samples=48
for o in objs:
 bb=[o.matrix_world@Vector(b) for b in o.bound_box];cen=sum(bb,Vector())/8;d=max(o.dimensions)*2.1+.05
 c=cam('tile-'+o.name,(cen.x+d*.55,cen.y-d*.85,cen.z+d*.7),(cen.x,cen.y,cen.z-.01*d),40)
 sc.camera=c;sc.render.filepath=str(ROOT/'shots'/'tiles'/(o.name[6:]+'.jpg'));bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'snacks-batch.blend'))
total=sum(v['triangles'] for v in catalog.values())
(ROOT/'catalog.json').write_text(json.dumps({'file':'snacks-batch.glb','axis':'glTF Y-up, each prop at its own ground-centre origin','props':catalog,'totalTriangles':total,'fileBytes':(ROOT/'snacks-batch.glb').stat().st_size,'layoutOrder':list(PROPS),'contactSheetPitchMeters':pitch,'columns':cols},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'materials.json').write_text(json.dumps(G.META,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('SNACKS_BATCH_READY',len(objs),total,(ROOT/'snacks-batch.glb').stat().st_size)
