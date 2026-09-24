# R1 eye-3 (s=50) / eye-5 (s=100)，机位与 F2 render-before-after.py 相同。
import bpy, json, math, os
from mathutils import Vector

THIS = os.path.abspath(__file__)
WS = os.path.dirname(os.path.dirname(os.path.dirname(THIS)))
AREA = os.path.join(WS, 'scene-authoring', 'yuyuan-area')
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-zone'))
DEST = os.path.dirname(THIS)
route = json.load(open(os.path.join(WS, 'world', 'fangbang-temple-v7', 'route.json'), encoding='utf-8'))['mainStreet']
SHANMEN = (-127.817, 27.057)
OFF = (53.5, -17.4)
di = min(i for i, p in enumerate(route) if p[0] <= -2.3632)
i_shan = min(range(di, len(route)), key=lambda i: math.hypot(route[i][0] - SHANMEN[0], route[i][2] - SHANMEN[1]))
seg = route[di:i_shan + 1]
acc = [0.0]
for i in range(1, len(seg)):
    acc.append(acc[-1] + math.hypot(seg[i][0] - seg[i - 1][0], seg[i][2] - seg[i - 1][2]))

def at(s):
    for i in range(1, len(seg)):
        if acc[i] >= s:
            t = (s - acc[i - 1]) / max(acc[i] - acc[i - 1], 1e-9)
            return (seg[i - 1][0] + (seg[i][0] - seg[i - 1][0]) * t,
                    seg[i - 1][2] + (seg[i][2] - seg[i - 1][2]) * t)
    return seg[-1][0], seg[-1][2]

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'scene.blend'))
scene = bpy.context.scene
world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.82, 0.86, 0.92, 1.0)
    bg.inputs[1].default_value = 0.75
if not any(o.type == 'LIGHT' and o.data.type == 'SUN' for o in scene.objects):
    sd = bpy.data.lights.new('Sun', 'SUN'); sd.energy = 3.2; sd.angle = math.radians(4)
    sun = bpy.data.objects.new('Sun', sd)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-115))
    scene.collection.objects.link(sun)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'
cam_data = bpy.data.cameras.new('Cam'); cam_data.lens = 24; cam_data.clip_end = 2000
cam = bpy.data.objects.new('Cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(loc, target):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

for k, s in ((3, 50), (5, 100)):
    x7, z7 = at(s)
    mx, mz = x7 + OFF[0], z7 + OFF[1]
    x72, z72 = at(s + 4)
    tx, tz = x72 + OFF[0], z72 + OFF[1]
    aim((mx, -mz, 1.6), (tx, -tz, 1.6))
    f = os.path.join(DEST, f'after-eye-{k}-s{int(s):03d}m.png')
    scene.render.filepath = f
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(f)
    n = img.size[0] * img.size[1]
    px = [0.0] * (n * 4)
    img.pixels.foreach_get(px)
    lum = [(px[i] + px[i + 1] + px[i + 2]) / 3 for i in range(0, len(px), 4)]
    mean = sum(lum) / n
    std = math.sqrt(sum((v - mean) ** 2 for v in lum) / n)
    bpy.data.images.remove(img)
    print('SHOT', os.path.basename(f), 'std', round(std, 4), 'blank', std < 2 / 255)
print('R1 EYES DONE')
