# F2 同机位 before/after 出图（GOAL wave1-fangbang F2 出口）。
# 机位 = F1 的 6 张眼高机位平移到地图坐标（地图 = v7 + (53.5, -17.4)，路线弧长 s=0/25/50/75/100/125，
# 末张正对山门 layout temple-shanmen 锚）。对 OUT_DIR 的 scene.blend 渲染：
#   TAG=after  -> FANGBANG=1 构建（out-zone）
#   TAG=before -> 无 FANGBANG 标准构建（out-zone-standard）
# 输出 artifacts/f2-integrate/<TAG>-eye-N-sNNNm.png；Cycles CPU 48spp 1280x720，空白帧守卫同 COMMON。
# 用法：OUT_DIR=out-zone TAG=after blender -b -t 4 -P artifacts/f2-integrate/render-before-after.py
import bpy, json, math, os

THIS = os.path.abspath(__file__)                                    # workspace/artifacts/f2-integrate/<本文件>
WS = os.path.dirname(os.path.dirname(os.path.dirname(THIS)))        # workspace 根
AREA = os.path.join(WS, 'scene-authoring', 'yuyuan-area')
REPO = WS
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-zone'))
DEST = os.path.join(WS, 'artifacts', 'f2-integrate')
TAG = os.environ.get('TAG', 'shot')
os.makedirs(DEST, exist_ok=True)

route = json.load(open(os.path.join(REPO, 'world', 'fangbang-temple-v7', 'route.json'), encoding='utf-8'))['mainStreet']
SHANMEN = (-127.817, 27.057)          # v7 坐标
OFF = (53.5, -17.4)

di = min(i for i, p in enumerate(route) if p[0] <= -2.3632)
i_shan = min(range(di, len(route)), key=lambda i: math.hypot(route[i][0] - SHANMEN[0], route[i][2] - SHANMEN[1]))
seg = route[di:i_shan + 1]
acc = [0.0]
for i in range(1, len(seg)):
    acc.append(acc[-1] + math.hypot(seg[i][0] - seg[i - 1][0], seg[i][2] - seg[i - 1][2]))
walk_len = acc[-1]

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
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'

cam_data = bpy.data.cameras.new('Cam'); cam_data.lens = 24; cam_data.clip_end = 2000
cam = bpy.data.objects.new('Cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(loc, target):
    from mathutils import Vector
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

stats = []
for k, s in enumerate([0, 25, 50, 75, 100, 125], 1):
    x7, z7 = at(s)
    mx, mz = x7 + OFF[0], z7 + OFF[1]          # 地图坐标
    name = 'shanmen'
    if k < 6:
        x72, z72 = at(min(s + 4, walk_len))
        tx, tz = x72 + OFF[0], z72 + OFF[1]
        th = 1.6
    else:
        tx, tz, th = -74.317, 9.657, 4.0
        name = 'shanmen-gate'
    aim((mx, -mz, 1.6), (tx, -tz, th))
    f = f'{TAG}-eye-{k}-s{int(s):03d}m.png'
    scene.render.filepath = os.path.join(DEST, f)
    bpy.ops.render.render(write_still=True)
    try:
        img = bpy.data.images.load(scene.render.filepath)
        n = img.size[0] * img.size[1]
        px = [0.0] * (n * 4)
        img.pixels.foreach_get(px)
        lum = [(px[i] + px[i + 1] + px[i + 2]) / 3 for i in range(0, len(px), 4)]
        mean = sum(lum) / n
        std = math.sqrt(sum((v - mean) ** 2 for v in lum) / n)
        buckets = {}
        for v in lum:
            b = min(31, int(v * 32)); buckets[b] = buckets.get(b, 0) + 1
        dom = max(buckets.values()) / n
        st = {'mean': round(mean, 4), 'std': round(std, 4), 'dominant': round(dom, 4), 'blank': bool(std < 2 / 255 or dom > 0.95)}
        bpy.data.images.remove(img)
    except Exception as e:
        st = {'statsError': str(e)}
    stats.append({'file': f, **st})
    print('SHOT', f, st)
json.dump(stats, open(os.path.join(DEST, f'{TAG}-shots.json'), 'w'), indent=1)
print('BEFORE/AFTER SHOTS DONE', TAG, len(stats))
