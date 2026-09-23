import bpy,sys,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'shots';OUT.mkdir(exist_ok=True)
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'model.blend'));sc=bpy.data.scenes['Scene']
sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.render.threads_mode='FIXED';sc.render.threads=4;sc.cycles.samples=int(argv[argv.index('--spp')+1]) if '--spp' in argv else 48;sc.cycles.use_denoising=True
sc.render.resolution_x=1600;sc.render.resolution_y=1000;sc.render.image_settings.file_format='JPEG';sc.render.image_settings.quality=90;sc.view_settings.view_transform='AgX'
w=bpy.data.worlds.new('w');sc.world=w;w.use_nodes=True;n=w.node_tree.nodes;l=w.node_tree.links
tc=n.new('ShaderNodeTexCoord');sep=n.new('ShaderNodeSeparateXYZ');ramp=n.new('ShaderNodeValToRGB');l.new(tc.outputs['Generated'],sep.inputs['Vector']);l.new(sep.outputs['Z'],ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position=.45;ramp.color_ramp.elements[0].color=(.72,.7,.66,1);ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(.42,.55,.78,1)
bg=n['Background'];bg.inputs['Strength'].default_value=.72;l.new(ramp.outputs['Color'],bg.inputs['Color'])
sun=bpy.data.lights.new('sun','SUN');sun.energy=4.6;sun.angle=math.radians(1.5);so=bpy.data.objects.new('sun',sun);sc.collection.objects.link(so);so.rotation_euler=(math.radians(42),0,math.radians(-32))
bpy.ops.mesh.primitive_plane_add(size=80,location=(0,6,-0.001));g=bpy.context.object;gm=bpy.data.materials.new('ground');gm.use_nodes=True;gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.62,.6,.55,1);g.data.materials.append(gm)
fill=bpy.data.lights.new('fill','AREA');fill.energy=1500;fill.size=6;fo=bpy.data.objects.new('fill',fill);sc.collection.objects.link(fo);fo.location=(0,6.5,5.5);fo.rotation_euler=(0,0,0)
def cam(name,pos,look,fov=42):
 c=bpy.data.cameras.new(name);c.lens_unit='FOV';c.angle=math.radians(fov);o=bpy.data.objects.new(name,c);sc.collection.objects.link(o)
 p=Vector((pos[0],-pos[2],pos[1]));t=Vector((look[0],-look[2],look[1]));o.location=p;o.rotation_mode='QUATERNION';o.rotation_quaternion=(t-p).to_track_quat('-Z','Y');return o
# 原点已重锚到台基平面中心；机位与灰模同风格，看向原点
CAMS={'front':cam('front',(0,4.5,30),(0,4.6,0),40),'left-3q':cam('left-3q',(-24,7,20),(0,4.5,0),40),'side':cam('side',(-32,5,-2),(0,4.5,-2),40),'back':cam('back',(6,6,-34),(0,4.5,0),40),
 'porch':cam('porch',(4.5,1.7,9),(-1,2.6,2),62),'interior':cam('interior',(0,1.7,3.2),(0,4,-6),70),'aerial':cam('aerial',(-30,42,26),(0,3,0),42)}
names=argv[argv.index('--cams')+1].split(',') if '--cams' in argv else list(CAMS)
for nm in names:sc.camera=CAMS[nm];sc.render.filepath=str(OUT/f'{nm}.jpg');bpy.ops.render.render(write_still=True)
print('RENDER_DONE',len(names))
