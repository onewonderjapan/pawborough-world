"""湖心亭 4 机位渲染（Cycles CPU）+ 渲染后木色实测。
机位全部从 baseline/layout.json + build.py 同一局部系公式重算（不读产物坐标）；R1 机位与 round-0 完全相同。
渲染图只写工单包 artifacts/，不进仓库。

用法：blender -b -t 4 --python modules/huxinting/render.py -- <outDir> [--spp N] [--glb <path>] [--lighting r0|r1]
                                                                    [--measure-only] [--views front,side,...]
- --lighting r0：round-0 布光（太阳 4.2 / 天光 0.85 / 补光 2600 W）。过曝后 AgX 把深红木高光压淡成粉色。
- --lighting r1（默认）：与 hall-kit render_hall.py 同档（太阳 2.5 / 天光 0.65 / 补光 900 W、9 m），太阳方向不变。
- --measure-only：不渲染，只对 <outDir> 里已有的同名 JPG 做木色实测（用于 round-0 图）。
木色实测：按像素网格从相机射线求交（scene.ray_cast），命中材质 ht-wood-red 且十字邻点同材质的像素，
取渲染图 sRGB 均值与 HSV，写 <outDir>/wood-colour.json。
"""
import bpy, colorsys, json, math, os, sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
AREA = ROOT.parent.parent
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_DIR = Path(ARGV[0]) if ARGV and not ARGV[0].startswith('--') else ROOT / 'shots'


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


SPP = int(arg('--spp', 48))
GLB = Path(arg('--glb', str(AREA / 'out-zone' / 'huxin-ting.glb')))
LIGHTING = arg('--lighting', 'r1')
MEASURE_ONLY = '--measure-only' in ARGV
VIEWS = arg('--views', 'front,side,oblique,from-bridge').split(',')
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
bpy.ops.import_scene.gltf(filepath=str(GLB))
bpy.ops.import_scene.gltf(filepath=str(AREA / 'out-zone' / 'jiuqu-bridge.glb'))
# R2：水面高度取运行时同值——layout 中覆盖湖心亭形心的 water 对象的 height（water-62072388 = -0.14；
# build-scene 按此高度出水面）。R1 及以前固定 0.04，比运行时高 0.18 m，把台面下的桩淹掉一半。
def _in_poly(x, z, poly):
    c = False
    for i in range(len(poly)):
        (xi, zi), (xj, zj) = poly[i], poly[i - 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
    return c
WATER_Y = next((o['height'] for o in LAYOUT['objects'] if o.get('kind') == 'water'
                and _in_poly(CX, CZ, o['geometry']['footprint'])), None)
if WATER_Y is None:
    raise SystemExit('no layout water object under huxin-ting centroid')
if '--water-y' in ARGV:                        # 仅供复现 R1 旧图（0.04）
    WATER_Y = float(arg('--water-y'))
bpy.ops.mesh.primitive_plane_add(size=260, location=(CX, -(CZ + 6), WATER_Y))
water = bpy.context.object
wm = bpy.data.materials.new('water')
wm.use_nodes = True
wp = wm.node_tree.nodes['Principled BSDF']
wp.inputs['Base Color'].default_value = (0.13, 0.22, 0.24, 1)
wp.inputs['Roughness'].default_value = 0.25
water.data.materials.append(wm)

LIGHT = {'r0': dict(world=0.85, sun=4.2, fill=2600, fillSize=14),
         'r1': dict(world=0.65, sun=2.5, fill=900, fillSize=9)}[LIGHTING]
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
w.node_tree.nodes['Background'].inputs['Strength'].default_value = LIGHT['world']
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = LIGHT['sun']
sun.angle = math.radians(1.8)
so = bpy.data.objects.new('sun', sun)
SC.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(191))   # 阳光从临桥侧（+v）射向立面
fill = bpy.data.lights.new('fill', 'AREA')
fill.energy = LIGHT['fill']
fill.size = LIGHT['fillSize']
fo = bpy.data.objects.new('fill', fill)
SC.collection.objects.link(fo)
fo.location = W(0, 22, 14)


def cam_obj(name, p, t, fov):
    c = bpy.data.cameras.new(name)
    c.lens_unit = 'FOV'
    c.angle = math.radians(fov)
    o = bpy.data.objects.new(name, c)
    SC.collection.objects.link(o)
    o.location = p
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (t - p).to_track_quat('-Z', 'Y')
    return o


# 机位（与 round-0 相同）
CAMS = {
    'front': (Vector(W(-3.5, 33, 6.0)), Vector(W(0, 0, 4.6)), 38),        # 临九曲桥的 +v 立面（抱厦面）
    'side': (Vector(W(-31, 13, 7.0)), Vector(W(0.5, 0, 4.8)), 40),        # 西端，长剖面 + 塔亭轮廓
    'oblique': (Vector(W(-20, -25, 23)), Vector(W(0.5, 0.5, 3.2)), 40),   # 西南上空
}
# 从九曲桥眼高：桥南侧水面外（局部 v=19），视高 = 桥面 0.55 + 1.55，望临桥立面
_ex = CX + 0.0 * UX + 19.0 * VX
_ez = CZ + 0.0 * UZ + 19.0 * VZ
CAMS['from-bridge'] = (Vector((_ex, -_ez, 0.55 + 1.55)), Vector(W(0, 0, 3.6)), 46)
# R2 自查用近景（不进四图对照）：主楼南坡瓦面 / 西南角台面下桩列
CAMS['roof-close'] = (Vector(W(-9.5, -12.0, 11.5)), Vector(W(-2.0, -3.0, 7.6)), 34)
CAMS['piles-close'] = (Vector(W(-14.0, -12.5, 1.1)), Vector(W(-5.5, -4.5, 0.25)), 40)


def wood_colour(cam, jpg):
    """射线求交找木料像素，取渲染图 sRGB 均值。"""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    img = bpy.data.images.load(str(jpg), check_existing=False)
    Wd, Hd = img.size
    px = img.pixels[:]
    fr = [cam.matrix_world @ v for v in cam.data.view_frame(scene=SC)]   # 右上、右下、左下、左上
    o = cam.matrix_world.translation.copy()

    def mat_at(x, y):
        fx, fy = (x + 0.5) / Wd, (y + 0.5) / Hd                    # y 自下而上（Blender 像素序）
        top = fr[3].lerp(fr[0], fx)
        bot = fr[2].lerp(fr[1], fx)
        d = (bot.lerp(top, fy) - o).normalized()
        hit, _loc, _n, idx, ob, _m = SC.ray_cast(dg, o, d)
        if not hit or ob.type != 'MESH' or not ob.data.materials:
            return None
        mi = ob.data.polygons[idx].material_index
        m = ob.data.materials[mi] if mi < len(ob.data.materials) else None
        return m.name.split('.')[0] if m else None

    acc, n = [0.0, 0.0, 0.0], 0
    for y in range(4, Hd - 4, 8):
        for x in range(4, Wd - 4, 8):
            if mat_at(x, y) != 'ht-wood-red':
                continue
            if any(mat_at(x + dx, y + dy) != 'ht-wood-red' for dx, dy in ((3, 0), (-3, 0), (0, 3), (0, -3))):
                continue
            k = (y * Wd + x) * 4
            for c in range(3):
                acc[c] += px[k + c]
            n += 1
    bpy.data.images.remove(img)
    if not n:
        return dict(samples=0)
    rgb = [a / n for a in acc]
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return dict(samples=n, meanSrgb='#%02x%02x%02x' % tuple(round(c * 255) for c in rgb),
                hueDeg=round(h * 360, 1), sat=round(s, 3), val=round(v, 3))


report = dict(glb=str(GLB), lighting=LIGHTING, light=LIGHT, measureOnly=MEASURE_ONLY, waterY=WATER_Y,
              target=dict(srgb='#6a2e22', hueDeg=10.0, sat=0.679, val=0.416), views={})
for name in VIEWS:
    p, t, fov = CAMS[name]
    c = cam_obj(name, p, t, fov)
    SC.camera = c
    jpg = OUT_DIR / f'{name}.jpg'
    if not MEASURE_ONLY:
        SC.render.filepath = str(jpg)
        bpy.ops.render.render(write_still=True)
    report['views'][name] = wood_colour(c, jpg)
    print('WOOD', name, report['views'][name])
json.dump(report, open(OUT_DIR / 'wood-colour.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('RENDER_DONE', len(VIEWS), '->', OUT_DIR)
