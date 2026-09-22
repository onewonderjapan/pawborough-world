"""garden-kit before/after 同机位对照 + 专项图（S4）。
before = 主仓 baseline/scene-areas.glb（占位墙体/龙头/月洞门/木桥）
after  = OUT_DIR/scene-areas.glb（站点模块批）
5 组同机位对 1600x1000 48spp；专项图（after）龙头三视 1200x900、月洞正/穿、桥面视角、鸟瞰正交 1500x2000。
全部过空白帧守卫（std<2/255 或单色>95% = fail, exit 1）。GPU>20% 时按纪律用 CPU 4 线程。
用法：blender -b -P modules/garden-kit/render-garden-kit-compare.py
输出：artifacts/garden-kit/compare/*.png（对）、artifacts/garden-kit/renders/*.png（专项）
"""
import bpy, json, math, os, sys
from mathutils import Vector

AREA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-garden-kit'))
PKG = os.path.dirname(os.path.dirname(os.path.dirname(AREA)))  # outbox 包根
CMP = os.path.join(PKG, 'artifacts', 'garden-kit', 'compare')
RND = os.path.join(PKG, 'artifacts', 'garden-kit', 'renders')
os.makedirs(CMP, exist_ok=True)
os.makedirs(RND, exist_ok=True)
BEFORE = '/home/baibai/work/onewonderjapan/pawborough-world/scene-authoring/yuyuan-area/baseline/scene-areas.glb'
AFTER = os.path.join(OUT, 'scene-areas.glb')

# (名, 相机地图位(x, 高, z), 目标(x, 高, z), lens)
PAIRS = [
    ('dragon-head-close', (-163.6, 3.5, -156.8), (-165.46, 3.45, -158.87), 50),
    ('wall-run-from-path-gate-sansuitang', (-153.6, 1.65, -159.2), (-165.5, 2.6, -161.6), 35),
    ('moon-gate-front', (-97.84, 1.7, -137.4), (-97.84, 1.35, -142.8), 40),
    ('bridge-from-huxin', (-149.3, 2.3, -125.6), (-163.0, 0.9, -115.0), 35),
]
SPECIALS = [
    ('dragon-head-34', (-163.4, 4.3, -157.0), (-165.46, 3.6, -158.87), 45, 1200, 900),
    ('dragon-head-side', (-165.2, 3.6, -156.6), (-165.46, 3.5, -158.87), 45, 1200, 900),
    ('dragon-head-front', (-166.9, 3.5, -160.3), (-165.46, 3.5, -158.87), 45, 1200, 900),
    ('moon-gate-front-hi', (-97.84, 1.7, -137.4), (-97.84, 1.35, -142.8), 40, 1200, 900),
    ('moon-gate-through', (-97.84, 1.6, -147.6), (-97.84, 1.4, -142.8), 40, 1200, 900),
    ('bridge-from-deck', (-175.7, 1.35, -109.9), (-168.0, 1.0, -112.6), 28, 1200, 900),
]
AERIAL = ('garden-aerial', (-113.0, -128.0), 95.0)  # 中心(map), ortho_scale

def setup_scene(rx, ry, spp):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = spp
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    sc.render.resolution_x = rx
    sc.render.resolution_y = ry
    sc.render.resolution_percentage = 100
    sc.world = bpy.data.worlds.new('daylight')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .65, .8, 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
    lt = bpy.data.lights.new('sun', 'SUN')
    lt.energy = 2.5
    lt.angle = math.radians(12)
    so = bpy.data.objects.new('sun', lt)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(28), math.radians(-25), math.radians(-35))
    return sc

def guard(path):
    img = bpy.data.images.load(path)
    px = list(img.pixels)
    n = len(px) // 4
    step = max(1, n // 40000)
    cnt = 0
    s = 0.0
    sq = 0.0
    colors = {}
    for i in range(0, n, step):
        r, g, b = px[i*4], px[i*4+1], px[i*4+2]
        lum = 0.2126*r + 0.7152*g + 0.0722*b
        s += lum; sq += lum*lum
        key = (round(r, 1), round(g, 1), round(b, 1))
        colors[key] = colors.get(key, 0) + 1
        cnt += 1
    mean = s/cnt
    std = math.sqrt(max(0.0, sq/cnt - mean*mean))
    dom = max(colors.values())/cnt
    bpy.data.images.remove(img)
    return {'std255': round(std*255, 2), 'dominant': round(dom, 3), 'blank': std < 2/255 or dom > 0.95}

def render_cam(sc, name, pos, tgt, lens, path):
    camd = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new(name, camd)
    sc.collection.objects.link(cam)
    camd.lens = lens
    camd.clip_end = 2500
    cam.location = (pos[0], -pos[2], pos[1])
    look = Vector((tgt[0], -tgt[2], tgt[1]))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    return guard(path)

def render_aerial(sc, center, scale, path, rx, ry):
    camd = bpy.data.cameras.new('aerial')
    camd.type = 'ORTHO'
    camd.ortho_scale = scale
    cam = bpy.data.objects.new('aerial', camd)
    sc.collection.objects.link(cam)
    cam.location = (center[0], -center[1], 80)
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    return guard(path)

results = []

# ---------- 5 组同机位对 ----------
for name, pos, tgt, lens in PAIRS:
    for ver, src in (('before', BEFORE), ('after', AFTER)):
        sc = setup_scene(1600, 1000, 48)
        bpy.ops.import_scene.gltf(filepath=src)
        g = render_cam(sc, name, pos, tgt, lens, os.path.join(CMP, f'{name}-{ver}.png'))
        g['shot'] = f'{name}-{ver}'
        results.append(g)
        print('GUARD', json.dumps(g), flush=True)

# ---------- 鸟瞰对 ----------
for ver, src in (('before', BEFORE), ('after', AFTER)):
    sc = setup_scene(1500, 2000, 48)
    bpy.ops.import_scene.gltf(filepath=src)
    g = render_aerial(sc, AERIAL[1], AERIAL[2], os.path.join(CMP, f'{AERIAL[0]}-{ver}.png'), 1500, 2000)
    g['shot'] = f'{AERIAL[0]}-{ver}'
    results.append(g)
    print('GUARD', json.dumps(g), flush=True)

# ---------- 专项图（after） ----------
for name, pos, tgt, lens, rx, ry in SPECIALS:
    sc = setup_scene(rx, ry, 48)
    bpy.ops.import_scene.gltf(filepath=AFTER)
    g = render_cam(sc, name, pos, tgt, lens, os.path.join(RND, f'{name}.png'))
    g['shot'] = name
    results.append(g)
    print('GUARD', json.dumps(g), flush=True)
sc = setup_scene(1500, 2000, 48)
bpy.ops.import_scene.gltf(filepath=AFTER)
g = render_aerial(sc, AERIAL[1], AERIAL[2], os.path.join(RND, f'{AERIAL[0]}.png'), 1500, 2000)
g['shot'] = AERIAL[0]
results.append(g)
print('GUARD', json.dumps(g), flush=True)

json.dump(results, open(os.path.join(RND, 'guard.json'), 'w'), indent=1)
blanks = [r for r in results if r['blank']]
if blanks:
    print('BLANK FRAMES:', json.dumps(blanks))
    sys.exit(1)
print('COMPARE RENDER OK')
