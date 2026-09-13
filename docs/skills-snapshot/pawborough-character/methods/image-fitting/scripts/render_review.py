from pathlib import Path
import bpy,argparse,sys,json,math
from mathutils import Vector,Matrix
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--display-rx',type=float,default=0);p.add_argument('--display-rz',type=float,default=0)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);src=Path(a.input);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.suffix.lower()=='.fbx':bpy.ops.import_scene.fbx(filepath=str(src))
else:bpy.ops.import_scene.gltf(filepath=str(src))
objects=list(bpy.context.scene.objects)
custom_shapes={p.custom_shape for arm in objects if arm.type=='ARMATURE' for p in arm.pose.bones if p.custom_shape}
for ob in custom_shapes:ob.hide_render=True
for ob in objects:
    if ob.type=='ARMATURE':ob.data.pose_position='REST'
bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
dep=bpy.context.evaluated_depsgraph_get();pts=[]
for ob in objects:
    if ob.type=='MESH' and ob not in custom_shapes and not ob.hide_render:
        ev=ob.evaluated_get(dep);pts.extend(ev.matrix_world@Vector(c) for c in ev.bound_box)
orient=Matrix.Rotation(math.radians(a.display_rz),4,'Z')@Matrix.Rotation(math.radians(a.display_rx),4,'X');pts=[orient@q for q in pts]
mn=Vector([min(c[i] for c in pts) for i in range(3)]);mx=Vector([max(c[i] for c in pts) for i in range(3)])
center=(mn+mx)*.5;center.z=mn.z;scale=.32/(mx.z-mn.z)
group=bpy.data.objects.new('ComparisonDisplayTransform',None);bpy.context.scene.collection.objects.link(group)
for ob in objects:
    if ob.parent is None:
        world=ob.matrix_world.copy();ob.parent=group;ob.matrix_world=world
group.matrix_world=Matrix.Scale(scale,4)@Matrix.Translation(-center)@orient
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=6
scene.world=bpy.data.worlds.new('Neutral studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.82,.9,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
scene.view_settings.view_transform='AgX'
for name,loc,energy,size in [('Key',(-.65,-.8,1.0),18,.85),('Fill',(.7,-.1,.5),7,.8),('Rim',(.1,.7,.8),14,.65)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.16))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='ReviewFloor';floor.location.z=-.001
m=bpy.data.materials.new('Review floor');m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.52,.54,.55,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;floor.data.materials.append(m)
d=bpy.data.cameras.new('ReviewCamera');d.type='ORTHO';d.ortho_scale=max(.53,(mx.x-mn.x)*scale*1.35,(mx.y-mn.y)*scale*1.35)
cam=bpy.data.objects.new('ReviewCamera',d);scene.collection.objects.link(cam);scene.camera=cam
scene.render.resolution_x=1000;scene.render.resolution_y=800;scene.render.resolution_percentage=100
views={'front':(0,-1.5,.20),'side':(1.5,0,.20),'back':(0,1.5,.20),'three':(-.85,-1.35,.35)}
for name,loc in views.items():
    cam.location=loc;cam.rotation_euler=(Vector((0,0,.16))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'study.blend'))
clay=bpy.data.materials.new('Neutral clay');clay.use_nodes=True;clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.45,.42,.37,1);clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.85
for ob in objects:
    if ob.type=='MESH':
        ob.data.materials.clear();ob.data.materials.append(clay)
cam.location=views['three'];cam.rotation_euler=(Vector((0,0,.16))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/'clay-three.png');bpy.ops.render.render(write_still=True)
(out/'RENDER.json').write_text(json.dumps({'source':str(src),'display_height_m':.32,'bounds_after_display_orientation':[list(mn),list(mx)],'display_rotation_x_degrees':a.display_rx,'display_rotation_z_degrees':a.display_rz,'source_pose':'REST','views':'coordinate labels; front orientation not assumed','source_files_modified':False,'render_engine':'Cycles CPU','samples':20},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
