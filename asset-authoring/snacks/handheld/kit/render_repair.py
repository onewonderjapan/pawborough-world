import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[1];OUT=R/'renders';OUT.mkdir(exist_ok=True)
def run(asset,name,bean=False):
 bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene
 sc.render.engine='CYCLES';sc.cycles.samples=48;sc.cycles.use_denoising=True
 sc.render.threads_mode='FIXED';sc.render.threads=12
 bpy.ops.import_scene.gltf(filepath=str(asset));bpy.context.view_layer.update()
 roots=[o for o in sc.objects if o.parent is None];roots.sort(key=lambda o:o.name)
 if bean:
  chosen=next(o for o in roots if o.name.startswith('wuxiangdou-bean-v1'))
  for root in roots:
   if root!=chosen:
    for o in [root,*root.children_recursive]:o.hide_render=True
 for o in sc.objects:
  if '_LOD1' in o.name or '_LOD2' in o.name or 'socket_' in o.name:o.hide_render=True
 pts=[o.matrix_world@Vector(c) for o in sc.objects if o.type=='MESH' and not o.hide_render for c in o.bound_box]
 lo=Vector(tuple(min(p[k] for p in pts) for k in range(3)));hi=Vector(tuple(max(p[k] for p in pts) for k in range(3)))
 cen=(lo+hi)/2;dim=max(hi-lo)
 world=bpy.data.worlds.new('neutral');sc.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
 def area(name,pos,energy,size):
  l=bpy.data.lights.new(name,'AREA');l.energy=energy;l.shape='DISK';l.size=size;o=bpy.data.objects.new(name,l);sc.collection.objects.link(o);o.location=pos;o.rotation_euler=(cen-o.location).to_track_quat('-Z','Y').to_euler()
 area('large-key',cen+Vector((dim*1.2,-dim*2,dim*3)),8 if not bean else .08,dim*3)
 area('soft-fill',cen+Vector((-dim*2,-dim,dim)),3 if not bean else .03,dim*2)
 bpy.ops.mesh.primitive_plane_add(size=dim*12,location=(0,0,-.0002));m=bpy.data.materials.new('warm-neutral');m.diffuse_color=(.38,.34,.28,1);bpy.context.object.data.materials.append(m)
 c=bpy.data.cameras.new('review-camera');cam=bpy.data.objects.new('review-camera',c);sc.collection.objects.link(cam)
 c.type='ORTHO';c.ortho_scale=dim*1.65;c.clip_start=.0001;c.dof.use_dof=False
 cam.location=cen+Vector((dim*.7,-dim*2.6,dim*(1.4 if bean else .7)));cam.rotation_euler=(cen-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
 sc.render.resolution_x=1200;sc.render.resolution_y=1000;sc.render.resolution_percentage=100;sc.render.image_settings.file_format='PNG';sc.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
 print('REVIEW_RENDER',name)
old=Path(__file__).resolve().parents[4] / 'scene-authoring/yuyuan-area/resources/foods/handheld'
import os
if not os.environ.get('JAR_ONLY'):run(old/'bean-jar.glb','bean-jar-before')
run(R/'props/bean-jar.glb','bean-jar-after')
if not os.environ.get('JAR_ONLY'):run(old/'bean-single.glb','bean-single-before',True)
if not os.environ.get('JAR_ONLY'):run(R/'props/bean-single.glb','bean-single-after',True)
