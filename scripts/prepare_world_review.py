"""Package the delivered world for web review and later Blender rendering. Source assets stay untouched."""
from pathlib import Path
import ast,bpy,bmesh,json,hashlib,math,sys
from mathutils import Vector
WS=Path(__file__).resolve().parents[1];WORLD=WS/'world';ROOT=WS.parent
source=WORLD/'street.glb';source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source))
scene=bpy.context.scene;placements=json.loads((WORLD/'instances.json').read_text(encoding='utf-8'))['instances'];ids=[p['id'] for p in placements]
building=[];kit=[]
for o in scene.objects:
 if o.type!='MESH':continue
 (building if any(o.name.startswith(i+'__') for i in ids) else kit).append(o)
assert building and kit
flipped_faces=0;reoriented=[]
for o in kit:
 if not o.name.startswith('ribbon'):continue
 bm=bmesh.new();bm.from_mesh(o.data);bm.normal_update()
 faces=[f for f in bm.faces if f.normal.z<-.5]
 if faces:
  bmesh.ops.reverse_faces(bm,faces=faces);flipped_faces+=len(faces);reoriented.append(o.name)
 bm.normal_update();bm.to_mesh(o.data);bm.free()
def triangles(objects):
 total=0
 for o in objects:o.data.calc_loop_triangles();total+=len(o.data.loop_triangles)
 return total
before=triangles(building+kit);kit_tris=triangles(kit);kit_count=len(kit)
# Merge only the static street kit by material. Buildings keep their instance identities.
buckets={}
for o in kit:
 assert len(o.data.materials)==1,o.name
 buckets.setdefault(o.data.materials[0].name,[]).append(o)
merged=[]
for name,obs in buckets.items():
 bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0]
 if len(obs)>1:bpy.ops.object.join()
 o=bpy.context.object;o.name='street-kit__'+name;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();merged.append(o)
assert triangles(merged)==kit_tris
bpy.ops.object.select_all(action='DESELECT')
for o in merged:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(WORLD/'street-kit.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_tangents=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=92,export_cameras=False,export_lights=False)

def collection(name):
 c=bpy.data.collections.new(name);scene.collection.children.link(c);return c
def move(o,c):
 for old in list(o.users_collection):old.objects.unlink(o)
 c.objects.link(o)
bc=collection('01_Buildings');rc=collection('02_Street_And_Props');lc=collection('03_Lighting');cc=collection('04_Cameras');ctx=collection('05_Render_Context')
for o in building:move(o,bc)
for o in merged:move(o,rc)
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=4
scene.world=bpy.data.worlds.new('Original_Offline_Daylight');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.78,.82,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.42
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
ld=bpy.data.lights.new('DaylightSun','SUN');ld.energy=2.8;ld.angle=math.radians(10);sun=bpy.data.objects.new('DaylightSun',ld);lc.objects.link(sun);sun.rotation_euler=tuple(math.radians(v) for v in (26,-22,-35))
pts=[o.matrix_world@Vector(p) for o in building+merged for p in o.bound_box]
lo=Vector([min(v[i] for v in pts)for i in range(3)]);hi=Vector([max(v[i] for v in pts)for i in range(3)])
bpy.ops.mesh.primitive_plane_add(size=max(hi-lo)*6,location=((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z-.03));floor=bpy.context.object;floor.name='Render_Context_Outside_Segment';move(floor,ctx)
fm=bpy.data.materials.new('Render_Context_Ground');fm.use_nodes=True;fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.42,.43,.40,1);fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.98;floor.data.materials.append(fm)
tree=ast.parse((WS/'scripts/render_segment.py').read_text(encoding='utf-8'))
views=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='VIEWS' for t in n.targets))
camera_rows=[]
for name,v in views.items():
 d=bpy.data.cameras.new(name);d.lens=v['lens'];d.sensor_width=36;d.sensor_fit='HORIZONTAL';d.clip_start=.05;d.clip_end=600
 o=bpy.data.objects.new('Camera_'+name,d);cc.objects.link(o)
 p,t=v['pos'],v['target'];o.location=(p[0],-p[2],p[1]);target=Vector((t[0],-t[2],t[1]));o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
 camera_rows.append({'id':name,'positionGlb':p,'targetGlb':t,'lensMm':v['lens'],'sensorWidthMm':36,'sensorFit':'HORIZONTAL','source':'delivered render_segment.py VIEWS'})
 if name=='eye-west':scene.camera=o
scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
bpy.ops.object.select_all(action='DESELECT')
for o in building+merged:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(WORLD/'street-reviewed.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_tangents=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=92,export_cameras=False,export_lights=False)
sys.path.insert(0,str(WS/'scripts'))
from world_texture_pack import pack_source_images
pack_source_images(source)
bpy.ops.wm.save_as_mainfile(filepath=str(WORLD/'scene.blend'))
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
write(WORLD/'cameras.json',{'axis':'glTF Y-up X-east Z-south','resolution':[1280,720],'sourceGlbSha256':source_hash,'reviewedWorldGlb':'street-reviewed.glb','roadWindingCorrected':True,'cameras':camera_rows})
write(WORLD/'render-setup.json',{'sourceGlbSha256':source_hash,'reviewedWorldGlb':'street-reviewed.glb','roadWindingCorrected':True,'sceneBlend':'scene.blend','engine':'Cycles CPU','samples':24,'threads':4,'viewTransform':'AgX','look':'AgX - Medium High Contrast','worldColorLinear':[.72,.78,.82],'worldStrength':.42,'sunEulerBlenderDegrees':[26,-22,-35],'sunEnergy':2.8,'sunAngleDegrees':10,'bakedGlobalIllumination':False,'texturesPacked':True,'browserLighting':'separate real-time setup; not pixel-identical to Cycles','contextFloorExportedAsGameGeometry':False})
receipt={'roadWindingFacesCorrected':flipped_faces,'roadRibbonsCorrected':reoriented,'source':str(source),'sourceSha256':source_hash,'sourceUntouched':hashlib.sha256(source.read_bytes()).hexdigest()==source_hash,'sourceWorldTriangles':before,'buildingObjects':len(building),'streetKitObjectsBefore':kit_count,'streetKitObjectsAfter':len(merged),'streetKitTriangles':kit_tris,'streetKitBytes':(WORLD/'street-kit.glb').stat().st_size,'cameraCount':len(camera_rows),'sceneBlendBytes':(WORLD/'scene.blend').stat().st_size,'sceneTextureFiles':[{'name':im.name,'packed':bool(im.packed_file)}for im in bpy.data.images if im.source=='FILE'],'geometryCountsPreserved':triangles(building+merged)==before}
write(ROOT/'artifacts/lead-review/world-package.json',receipt)
print('WORLD_PACKAGE_READY',json.dumps({k:receipt[k]for k in ['sourceWorldTriangles','streetKitTriangles','streetKitObjectsAfter','streetKitBytes','cameraCount','geometryCountsPreserved']}))
