"""湖心亭 4 机位渲染（Cycles CPU，空白帧守卫在 contact-sheet 之外由亮度检查做）。
机位全部从 baseline/layout.json + build.py 同一局部系公式重算（不读产物坐标）。
渲染图只写工单包 artifacts/，不进仓库。
用法：blender -b -t 4 --python modules/huxinting/render.py -- <outDir> [--spp N]
"""
import bpy, json, math, os, sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
AREA = ROOT.parent.parent
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_DIR = Path(ARGV[0]) if ARGV else ROOT / 'shots'
SPP = int(ARGV[ARGV.index('--spp') + 1]) if '--spp' in ARGV else 48
OUT_DIR.mkdir(parents=True, exist_ok=True)

LAYOUT = json.load(open(AREA / 'baseline' / 'layout.json', encoding='utf-8'))
HT = next(o for o in LAYOUT['objects'] if o['id'] == 'huxin-ting')
FP = HT['geometry']['footprint']
if FP[0] == FP[-1]:
    FP = FP[:-1]
A2 = sum(FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1] for i in range(len(FP)))
CX = sum((FP[i][0] + FP[(i + 1) % len(FP)][0]) * (FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1]) for i in range(len(FP))) / (3 * A2)
CZ = sum((FP[i][1] + FP[(i + 1) % len(FP)][1]) * (FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1]) for i in range(len(FP))) / (3 * A2)
L0, A0, B0 = max((math.hypot(FP[(i + 1) % len(FP)][0] - FP[i][0], FP[(i + 1) % len(FP)][1] - FP[i][1]), FP[i], FP[(i + 1) % len(FP)]) for i in range(len(FP)))
UX, UZ = (B0[0] - A0[0]) / L0, (B0[1] - A0[1]) / L0
if UX < 0:
    UX, UZ = -UX, -UZ
VX, VZ = UZ, -UX

def W(u, v, h):
    """本地 (u,v,h) -> Blender (x,-z,h)。"""
    return (CX + u * UX + v * VX, -(CZ + u * UZ + v * VZ), h)

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene

# 场景：湖心亭 GLB + 九曲桥 GLB（上下文）+ 水面
bpy.ops.import_scene.gltf(filepath=str(AREA / 'out-zone' / 'huxin-ting.glb'))
bpy.ops.import_scene.gltf(filepath=str(AREA / 'out-zone' / 'jiuqu-bridge.glb'))
bpy.ops.mesh.primitive_plane_add(size=260, location=(CX, -(CZ + 6), 0.04))
water = bpy.context.object
wm = bpy.data.materials.new('water')
wm.use_nodes = True
wp = wm.node_tree.nodes['Principled BSDF']
wp.inputs['Base Color'].default_value = (0.13, 0.22, 0.24, 1)
wp.inputs['Roughness'].default_value = 0.25
water.data.materials.append(wm)

SC.render.engine = 'CYCLES'
SC.cycles.device = 'CPU'
SC.render.threads_mode = 'FIXED'
SC.render.threads = 4
SC.cycles.samples = SPP
SC.cycles.use_denoising = True
SC.render.resolution_x = 1600
SC.render.resolution_y = 1000
SC.render.image_settings.file_format = 'JPEG'
SC.render.image_settings.quality = 90
SC.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new('w')
SC.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.85
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 4.2
sun.angle = math.radians(1.8)
so = bpy.data.objects.new('sun', sun)
SC.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(191))   # 阳光从临桥侧（+v）射向立面
fill = bpy.data.lights.new('fill', 'AREA')
fill.energy = 2600
fill.size = 14
fo = bpy.data.objects.new('fill', fill)
SC.collection.objects.link(fo)
fo.location = W(0, 22, 14)

def cam(name, pos_l, look_l, fov=44):
    c = bpy.data.cameras.new(name)
    c.lens_unit = 'FOV'
    c.angle = math.radians(fov)
    o = bpy.data.objects.new(name, c)
    SC.collection.objects.link(o)
    p = Vector(W(*pos_l))
    t = Vector(W(*look_l))
    o.location = p
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (t - p).to_track_quat('-Z', 'Y')
    SC.camera = o
    SC.render.filepath = str(OUT_DIR / f'{name}.jpg')
    bpy.ops.render.render(write_still=True)
    return o

# 正面：临九曲桥的 +v 立面（抱厦面），视点略偏西
cam('front', (-3.5, 33, 6.0), (0, 0, 4.6), 38)
# 侧面：西端视点，长剖面 + 东端塔亭轮廓
cam('side', (-31, 13, 7.0), (0.5, 0, 4.8), 40)
# 斜俯：西南上空
cam('oblique', (-20, -25, 23), (0.5, 0.5, 3.2), 40)
# 从九曲桥上眼高：站在桥上 B9->B10 段 t=0.3（承台西南侧外的桥面上），视高 = 桥面 0.55 + 1.55
BR = next(o for o in LAYOUT['objects'] if o['id'] == 'jiuqu-bridge')
poly = BR['geometry']['polyline']
B10 = poly[9]
B9 = poly[8]
# 眼高机位：桥南侧水面外（局部 v≈9.5，与桥面同视高 0.55+1.55），桥栏作前景望临桥立面
_lx, _lz = 0.0, 19.0
ex = CX + _lx * UX + _lz * VX
ez = CZ + _lx * UZ + _lz * VZ
c = bpy.data.cameras.new('from-bridge')
c.lens_unit = 'FOV'
c.angle = math.radians(46)
o = bpy.data.objects.new('from-bridge', c)
SC.collection.objects.link(o)
p = Vector((ex, -ez, 0.55 + 1.55))
t3 = Vector(W(0, 0, 3.6))
o.location = p
o.rotation_mode = 'QUATERNION'
o.rotation_quaternion = (t3 - p).to_track_quat('-Z', 'Y')
SC.camera = o
SC.render.filepath = str(OUT_DIR / 'from-bridge.jpg')
bpy.ops.render.render(write_still=True)
print('RENDER_DONE 4 ->', OUT_DIR)
