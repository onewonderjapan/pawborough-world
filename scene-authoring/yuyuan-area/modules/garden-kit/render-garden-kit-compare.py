"""garden-kit before/after 同机位对照 + 专项图（R1 返修版）。
before = 上一版总装（R1_BEFORE env，默认主仓 baseline 占位版）
after  = OUT_DIR/scene-areas.glb（本版）
6 组同机位对 1600x1000 48spp（5 组原有机位 + 龙头 8 m 视距对照）；
专项图（after）：龙头三视 1200x900 + 8 m、月洞正/穿、桥面视角、鸟瞰正交 1500x2000。
全部过空白帧守卫（std<2/255 或单色>95% = fail, exit 1）。GPU>20% 时按纪律用 CPU 4 线程。
输出根：R1_ARTIFACTS env（缺省 artifacts/garden-kit，R1 批指向本包 artifacts/r1）。
用法：blender -b -P modules/garden-kit/render-garden-kit-compare.py
"""
import bpy, json, math, os, sys
from mathutils import Vector

AREA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-garden-kit'))
PKG = os.path.dirname(os.path.dirname(os.path.dirname(AREA)))  # outbox 包根
ART = os.environ.get('R1_ARTIFACTS') or os.path.join(PKG, 'artifacts', 'garden-kit')
CMP = os.path.join(ART, 'compare')
RND = os.path.join(ART, 'renders')
os.makedirs(CMP, exist_ok=True)
os.makedirs(RND, exist_ok=True)
BEFORE = os.environ.get('R1_BEFORE') or '/home/baibai/work/onewonderjapan/pawborough-world/scene-authoring/yuyuan-area/baseline/scene-areas.glb'
AFTER = os.path.join(OUT, 'scene-areas.glb')

# (名, 相机地图位(x, 高, z), 目标(x, 高, z), lens)
# 龙头位 (-165.46,-158.87) rotY -2.766，面向 (-0.366,-0.930)（沿 seg8 run）；R1#5 机位均换到脸侧。
PAIRS = [
    ('dragon-head-close', (-163.50, 4.30, -162.64), (-165.46, 3.70, -158.87), 50),
    # R1#5：机位锚定 path-gate-sansuitang 折线第 2 点所对的龙墙段端（seg7 端 -155.99,-162.57），
    # 离墙 6 m、y1.6、朝墙看。第 2 点正北/西北 6 m 落点被临街砖砌建筑遮挡（射线验证），
    # 机位最终取 seg7 中窗（t=12.9m, -143.69,-166.62）正南 6 m 净空位（程序化净空+透窗视线双检测选定），正对漏窗带（t=7.4/12.9/18.4 三窗）
    ('wall-run-from-path-gate-sansuitang', (-145.57, 1.60, -172.32), (-143.69, 1.55, -166.62), 35),
    ('moon-gate-front', (-97.84, 1.7, -137.4), (-97.84, 1.35, -142.8), 40),
    # 湖心亭 footprint (layout pond|huxin-ting) 中心内无光，机位移至亭东南角外朝九曲桥
    ('bridge-from-huxin', (-143.60, 2.30, -135.30), (-150.60, 0.80, -136.60), 35),
    # R1#5 新增：龙头 8 m 视距可读性对照
    ('dragon-head-8m', (-164.64, 3.60, -166.61), (-165.46, 3.75, -158.87), 50),
]
SPECIALS = [
    ('dragon-head-34', (-164.37, 4.50, -162.23), (-165.46, 3.70, -158.87), 45, 1200, 900),
    ('dragon-head-side', (-162.11, 3.80, -160.19), (-165.46, 3.70, -158.87), 45, 1200, 900),
    ('dragon-head-front', (-166.85, 3.80, -162.40), (-165.46, 3.75, -158.87), 45, 1200, 900),
    ('dragon-head-8m', (-164.64, 3.60, -166.61), (-165.46, 3.75, -158.87), 50, 1200, 900),
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

# ---------- 6 组同机位对 ----------
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
