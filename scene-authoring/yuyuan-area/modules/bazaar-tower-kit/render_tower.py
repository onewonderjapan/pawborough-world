"""bazaar-tower-kit 渲染：从 model.blend（世界坐标/地图系）出指定机位 JPEG + 空白帧守卫。

机位由参数 + layout footprint 重算（局部系 u,v 定义，经同一 to_b 变换到 Blender）。
运行：blender -b -t 4 --python-exit-code 1 -P modules/bazaar-tower-kit/render_tower.py -- \
      [--dir out-bazaar-towers/bld-428202599] [--cams south-3q,north-3q,aerial-3q,photo-match] [--spp 48]
守卫：任一帧亮度 std < 2/255 或主色占比 > 95% 视为空白，exit 2。
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

DIR = os.path.join(os.path.abspath(os.path.join(HERE, '..', '..')), arg('--dir', 'out-bazaar-towers/bld-428202599'))
P = json.load(open(os.path.join(HERE, 'params', os.path.basename(DIR) if False else
                            json.load(open(os.path.join(DIR, 'measurements.json')))['params'].split('/')[-1]),
                   encoding='utf-8'))
REND = os.path.join(DIR, 'renders')
os.makedirs(REND, exist_ok=True)

LAYOUT = json.load(open(os.path.abspath(os.path.join(HERE, '..', '..', 'baseline', 'layout.json')), encoding='utf-8'))
OBJ = next(o for o in LAYOUT['objects'] if o['id'] == P['id'])
FP = [q for q in OBJ['geometry']['footprint'] if q != OBJ['geometry']['footprint'][-1] or True]
if FP[0] == FP[-1]:
    FP = FP[:-1]
i0, i1 = P['frontEdge']
O = Vector((FP[i0][0], FP[i0][1]))
du = Vector((FP[i1][0] - FP[i0][0], FP[i1][1] - FP[i0][1])).normalized()
dv = Vector((-du.y, du.x))

def to_b(u, v, h):
    return Vector((O.x + u * du.x + v * dv.x, -(O.y + u * du.y + v * dv.y), h))

# 局部系包络（与 build 一致的近似尺寸，用于机位摆放）
U0, U1, V0, V1 = 0.3, 43.5, 0.3, 29.2
ZT = [0.0]
for h in P['massing']['storeyHeightsM']:
    ZT.append(ZT[-1] + h)
UC = (U0 + U1) / 2
VC = (V0 + V1) / 2
TOP = P['pavilion']['finial']['topM'] if P.get('pavilion') else ZT[-1] + 3.5

bpy.ops.wm.open_mainfile(filepath=os.path.join(DIR, 'model.blend'))
sc = bpy.data.scenes['Scene']
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.render.threads_mode = 'FIXED'
sc.render.threads = 4
sc.cycles.samples = int(arg('--spp', '48'))
sc.cycles.use_denoising = True
sc.render.resolution_x = 1600
sc.render.resolution_y = 1000
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
# 阳光从临街面（前街 = -v 侧）斜射：Rz 后 -Z 光轴 y 分量 = sin(rx)*cos(rz) > 0 需 cos(rz)>0
so.rotation_euler = (math.radians(42), 0, math.radians(-32))
# 地面（世界系大平面）
bpy.ops.mesh.primitive_plane_add(size=400, location=to_b(UC, VC, -0.001))
g = bpy.context.object
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .55, 1)
g.data.materials.append(gm)

CAMS = {
    # 前街（中心广场）3/4 视：眼高 1.6 m，距前街 ~30 m（spec），沿街偏移取 3/4 角度
    'south-3q': (to_b(UC + 14, -30, 1.6), to_b(UC, V0 + 1, ZT[2] + 1.2), 55),
    # 后街（方浜中路）3/4 视：眼高 1.6 m
    'north-3q': (to_b(UC - 14, V1 + 30, 1.6), to_b(UC, V1 - 1, ZT[2] + 1.2), 55),
    # 高空 3/4
    'aerial-3q': (to_b(UC + 34, VC - 44, 52), to_b(UC - 3, VC, 4), 46),
    # 对照 PBR-SH-0003-006：东南角（亭楼角）斜上看
    'photo-match': (to_b(U1 - 16, -18, 1.6), to_b(U1 - 1.5, 2.0, 12.5), 58),
}
names = arg('--cams', 'south-3q,north-3q,aerial-3q,photo-match').split(',')
def cam(name, pos, look, fov):
    c = bpy.data.cameras.new(name)
    c.lens_unit = 'FOV'
    c.angle = math.radians(fov)
    o = bpy.data.objects.new(name, c)
    sc.collection.objects.link(o)
    o.location = pos
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (look - pos).to_track_quat('-Z', 'Y')
    return o
blank = []
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
    print('RENDER', nm, 'std255=%.1f' % std255, 'dominant=%.1f%%' % (dom * 100), 'OK' if ok else 'BLANK')
    if not ok:
        blank.append(nm)
    bpy.data.images.remove(img)
if blank:
    print('BLANK_FRAMES', blank)
    sys.exit(2)
print('RENDER_TOWER_DONE', names)
