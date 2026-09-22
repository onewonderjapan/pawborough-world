"""Fixed cameras, one light rig, CPU <= 4 threads. Usage: blender -b -t 4 --python render.py -- [--clay] [--cams a,b] [--spp N]"""
import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'shots';OUT.mkdir(exist_ok=True)
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'model.blend'))
sc=bpy.data.scenes['Scene'];bpy.context.window.scene=sc
for s in list(bpy.data.scenes):
 if s.name!='Scene':bpy.data.scenes.remove(s)
sc.view_settings.view_transform='AgX';sc.view_settings.exposure=0.0
sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.render.threads_mode='FIXED';sc.render.threads=4
sc.cycles.samples=int(argv[argv.index('--spp')+1]) if '--spp' in argv else 64;sc.cycles.use_denoising=True
sc.render.resolution_x=1600;sc.render.resolution_y=1000;sc.render.image_settings.file_format='JPEG';sc.render.image_settings.quality=92
w=bpy.data.worlds.new('sky');sc.world=w;w.use_nodes=True;n=w.node_tree.nodes;l=w.node_tree.links
# plain sky-blue gradient world (Nishita made sky-facing roofs wash out)
tc=n.new('ShaderNodeTexCoord');grad=n.new('ShaderNodeTexGradient');sep=n.new('ShaderNodeSeparateXYZ');ramp=n.new('ShaderNodeValToRGB')
l.new(tc.outputs['Generated'],sep.inputs['Vector']);l.new(sep.outputs['Z'],ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position=.45;ramp.color_ramp.elements[0].color=(.72,.7,.66,1);ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(.42,.55,.78,1)
bg=n['Background'];bg.inputs['Strength'].default_value=0.72;l.new(ramp.outputs['Color'],bg.inputs['Color'])
sun=bpy.data.lights.new('sun','SUN');sun.energy=4.6;sun.angle=math.radians(1.5);so=bpy.data.objects.new('sun',sun);sc.collection.objects.link(so);so.rotation_euler=(math.radians(42),0,math.radians(-32))
def cam(name,pos,look,fov=45):
 c=bpy.data.cameras.new(name);c.lens_unit='FOV';c.angle=math.radians(fov);o=bpy.data.objects.new(name,c);sc.collection.objects.link(o)
 p=Vector((pos[0],-pos[2],pos[1]));t=Vector((look[0],-look[2],look[1]));o.location=p;o.rotation_mode='QUATERNION';o.rotation_quaternion=(t-p).to_track_quat('-Z','Y');return o
CAMS={
 'front':cam('front',(0,4.2,22),(0,4.2,-1.4),36),
 'left-3q':cam('left-3q',(-15,5.5,15),(0,4.0,-1.4),38),
 'right-3q':cam('right-3q',(15,5.5,15),(0,4.0,-1.4),38),
 'side':cam('side',(-20,4.0,-1.4),(0,3.9,-1.4),38),
 'back':cam('back',(0,4.2,-24),(0,4.2,-1.4),36),
 'through-door':cam('through-door',(0,1.6,6.5),(0,2.2,-6),58),
 'eave-close':cam('eave-close',(3.2,4.8,5.5),(1.2,6.0,-.2),42),
}
INFERRED={'back':'INFERRED VIEW (no rear reference)','side':'INFERRED (side seen only obliquely in G22)'}
modes=['clay'] if '--clay' in argv else ['pbr']
names=argv[argv.index('--cams')+1].split(',') if '--cams' in argv else list(CAMS)
clay=bpy.data.materials.new('clay');clay.use_nodes=True;clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.58,.58,.58,1)
log={}
for mode in modes:
 sc.view_layers[0].material_override=clay if mode=='clay' else None
 for name in names:
  sc.camera=CAMS[name];sc.render.filepath=str(OUT/f'{name}-{mode}.jpg');bpy.ops.render.render(write_still=True);log[f'{name}-{mode}']={'file':sc.render.filepath,'inferred':INFERRED.get(name)}
(OUT/'render-log.json').write_text(json.dumps({'engine':'CYCLES CPU 4 threads','samples':sc.cycles.samples,'resolution':[1600,1000],'files':log},indent=2)+'\n',encoding='utf-8')
print('RENDER_DONE',len(log))
