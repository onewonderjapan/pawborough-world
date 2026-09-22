import bpy,math,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[1];OUT=R.parent/'evidence/world-views';OUT.mkdir(exist_ok=True)
shots=[('old-street',[-194.73,1.65,-254.5],[-194.1,1.65,-238]),('jiuqu-square',[-178.25,1.65,-100.75],[-161,1.8,-107])]
for version,source in [('before',R/'baseline/scene-areas.glb'),('after',R/'out/scene-areas.glb')]:
 bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene
 bpy.ops.import_scene.gltf(filepath=str(source));sc.render.engine='CYCLES';sc.cycles.samples=24;sc.cycles.use_denoising=True
 sc.render.threads_mode='FIXED';sc.render.threads=12
 sc.world=bpy.data.worlds.new('daylight');sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.55,.65,.8,1);sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
 light=bpy.data.lights.new('sun','SUN');light.energy=2.5;light.angle=math.radians(12);so=bpy.data.objects.new('sun',light);sc.collection.objects.link(so);so.rotation_euler=(math.radians(28),math.radians(-25),math.radians(-35))
 # Fixed inspection fill lights, identical for before/after; not exported world lighting.
 for x,z in [(-194.4,-244),(-192,-220),(-186,-192),(-180,-175)]:
  ld=bpy.data.lights.new('inspection-fill','AREA');ld.energy=120;ld.size=4
  ob=bpy.data.objects.new('inspection-fill',ld);sc.collection.objects.link(ob);ob.location=(x,-z,3.25)
 for name,pos,target in shots:
  camd=bpy.data.cameras.new('cam');cam=bpy.data.objects.new('cam',camd);sc.collection.objects.link(cam);camd.lens=24;camd.clip_end=2500
  cam.location=(pos[0],-pos[2],pos[1]);look=Vector((target[0],-target[2],target[1]));cam.rotation_euler=(look-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
  sc.render.resolution_x=1280;sc.render.resolution_y=800;sc.render.resolution_percentage=100;sc.render.image_settings.file_format='PNG';sc.render.filepath=str(OUT/(name+'-'+version+'.png'));bpy.ops.render.render(write_still=True)
 print('DONE',version)
