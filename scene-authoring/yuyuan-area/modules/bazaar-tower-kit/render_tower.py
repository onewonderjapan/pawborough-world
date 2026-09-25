"""bazaar-tower-kit 渲染：从 model.blend（世界坐标/地图系）出四个机位 JPEG + 空白帧守卫。

机位全部由 params.frontEdge + baseline/layout.json footprint 重算（局部系 u 沿前街边、v 指楼内），距离按 footprint
包围盒定；四张：front（正）、aerial-3q（斜俯）、back（背）、street-eye（前街眼高 1.6 m 3/4）。
--procedural <zone glb>：改为导入该 GLB 里同 id 的程序化 bazaarBlock 体块，同机位出对照图（写 renders-procedural/）。
--blend <path>：渲染别的 model.blend（例：旧版生成器产物，做同机位 before）。

运行：blender -b -t 4 --python-exit-code 1 -P modules/bazaar-tower-kit/render_tower.py -- \
      --dir out-bazaar-towers/<id> [--cams front,aerial-3q,back,street-eye] [--spp 48] [--out-sub renders] \
      [--procedural out-zone/zone-bazaar-2.glb] [--blend <other model.blend>]
守卫：任一帧亮度 std < 2/255 或主色占比 > 95% 视为空白，exit 2。
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

DIR = os.path.join(ROOT, arg('--dir', 'out-bazaar-towers/bld-428202599'))
MEAS = json.load(open(os.path.join(DIR, 'measurements.json'), encoding='utf-8'))
P = json.load(open(os.path.join(HERE, MEAS['params']), encoding='utf-8'))
PROC = arg('--procedural', None)
SUB = arg('--out-sub', 'renders-procedural' if PROC else 'renders')
REND = SUB if os.path.isabs(SUB) else os.path.join(DIR, SUB)
os.makedirs(REND, exist_ok=True)

LAYOUT = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
OBJ = next(o for o in LAYOUT['objects'] if o['id'] == P['id'])
FP = [list(q) for q in OBJ['geometry']['footprint']]
if FP[0] == FP[-1]:
    FP = FP[:-1]
i0, i1 = P['frontEdge']
O = Vector((FP[i0][0], FP[i0][1]))
du = Vector((FP[i1][0] - FP[i0][0], FP[i1][1] - FP[i0][1])).normalized()
dv = Vector((-du.y, du.x))
def uv_of(q):
    d = Vector((q[0], q[1])) - O
    return d.dot(du), d.dot(dv)
def to_b(u, v, h):
    return Vector((O.x + u * du.x + v * dv.x, -(O.y + u * du.y + v * dv.y), h))
UVP = [uv_of(q) for q in FP]
U0, U1 = min(p[0] for p in UVP), max(p[0] for p in UVP)
V0, V1 = min(p[1] for p in UVP), max(p[1] for p in UVP)
UC, VC = (U0 + U1) / 2, (V0 + V1) / 2
WID, DEP = U1 - U0, V1 - V0
TOP = MEAS['maxY']

if PROC:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, PROC))
    keep = [o for o in bpy.data.objects if P['id'] in o.name and o.type == 'MESH']
    if not keep:
        raise SystemExit('procedural block %s not found in %s' % (P['id'], PROC))
    for o in keep:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene
else:
    bpy.ops.wm.open_mainfile(filepath=arg('--blend', os.path.join(DIR, 'model.blend')))
    sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.render.threads_mode = 'FIXED'
sc.render.threads = 4
sc.cycles.samples = int(arg('--spp', '48'))
sc.cycles.use_denoising = True
sc.render.resolution_x = 1600
sc.render.resolution_y = 1000
sc.render.resolution_percentage = int(arg('--pct', '100'))
sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 90
sc.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
n = w.node_tree.nodes
l = w.node_tree.links
tc = n.new('ShaderNodeTexCoord')
sep = n.new('ShaderNodeSeparateXYZ')
ramp = n.new('ShaderNodeValToRGB')
l.new(tc.outputs['Generated'], sep.inputs['Vector'])
l.new(sep.outputs['Z'], ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position = .45
ramp.color_ramp.elements[0].color = (.72, .7, .66, 1)
ramp.color_ramp.elements[1].position = .8
ramp.color_ramp.elements[1].color = (.42, .55, .78, 1)
bg = n['Background']
bg.inputs['Strength'].default_value = .72
l.new(ramp.outputs['Color'], bg.inputs['Color'])
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 4.6
sun.angle = math.radians(1.5)
so = bpy.data.objects.new('sun', sun)
sc.collection.objects.link(so)
# 阳光从前街一侧斜射（机位与光位都跟前街边走，各楼同一相对光照）
sd = (-dv + du * 0.45).normalized()
to_sun = Vector((sd.x, -sd.y, 0.0)).normalized() * math.cos(math.radians(48)) + Vector((0, 0, math.sin(math.radians(48))))
so.rotation_mode = 'QUATERNION'
so.rotation_quaternion = (-to_sun).to_track_quat('-Z', 'Y')
bpy.ops.mesh.primitive_plane_add(size=600, location=to_b(UC, VC, -0.001))
g = bpy.context.object
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .55, 1)
g.data.materials.append(gm)

D = max(34.0, WID * 1.1)
FL = UVP[i1][0] - UVP[i0][0]                     # 前街边（params.frontEdge）长度；正视 / 街道眼高都对着它
FUC = (UVP[i0][0] + UVP[i1][0]) / 2
DF = max(34.0, FL * 1.1)
CAMS = {
    'front': (to_b(FUC, V0 - DF, 7.0), to_b(FUC, V0, TOP * 0.42), 52),
    'aerial-3q': (to_b(UC + WID * 0.75, V0 - DEP * 1.15, TOP + 34), to_b(UC, VC, 5), 48),
    'back': (to_b(UC, V1 + D, 7.0), to_b(UC, V1, TOP * 0.42), 52),
    'street-eye': (to_b(FUC + FL * 0.32, V0 - 24, 1.6), to_b(FUC - FL * 0.05, V0 + 1, TOP * 0.42), 62),
}
extra = arg('--cam-json', None)                        # 追加机位（例：B5 挂落 / 店面近景）{"name": [[u,v,h],[u,v,h],fov]}
if extra:
    for k, (pp, ll, fv) in json.loads(extra).items():
        CAMS[k] = (to_b(*pp), to_b(*ll), fv)
names = arg('--cams', 'front,aerial-3q,back,street-eye').split(',')
def cam(name, pos, look, fov):
    c = bpy.data.cameras.new(name)
    c.lens_unit = 'FOV'
    c.angle = math.radians(fov)
    c.clip_end = 2000
    o = bpy.data.objects.new(name, c)
    sc.collection.objects.link(o)
    o.location = pos
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (look - pos).to_track_quat('-Z', 'Y')
    return o
blank = []
stats = {}
for nm in names:
    pos, look, fov = CAMS[nm]
    sc.camera = cam(nm, pos, look, fov)
    sc.render.filepath = os.path.join(REND, nm + '.jpg')
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(sc.render.filepath)
    px = np.array(img.pixels[:]).reshape(-1, 4)
    lum = .2126 * px[:, 0] + .7152 * px[:, 1] + .0722 * px[:, 2]
    std255 = lum.std() * 255
    vals, counts = np.unique((lum * 255).astype(int), return_counts=True)
    dom = counts.max() / counts.sum()
    ok = std255 >= 2.0 and dom <= 0.95
    stats[nm] = {'std255': round(float(std255), 1), 'dominant': round(float(dom), 3), 'ok': bool(ok),
                 'cam': [round(x, 2) for x in pos], 'look': [round(x, 2) for x in look], 'fov': fov}
    print('RENDER', nm, 'std255=%.1f' % std255, 'dominant=%.1f%%' % (dom * 100), 'OK' if ok else 'BLANK')
    if not ok:
        blank.append(nm)
    bpy.data.images.remove(img)
json.dump(stats, open(os.path.join(REND, 'render-stats.json'), 'w'), indent=1)
if blank:
    print('BLANK_FRAMES', blank)
    sys.exit(2)
print('RENDER_TOWER_DONE', names)
