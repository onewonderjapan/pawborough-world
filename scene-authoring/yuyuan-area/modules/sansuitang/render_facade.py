"""三穗堂格扇立面检色（wave4-huxinting2，主控：格扇偏暗，与厅堂套件统一配色，园内眼高格扇立面平均 HSV 明度 ≥ 0.22）。
口径照抄 hall-kit render_hall.py（facade_check + setup_scene + add_fill，模块级同光照，灯不动）：
  Cycles CPU、AgX、天光 (.55,.65,.8)×0.65、太阳 2.5 / 角径 12° / 旋转 (28°,-25°,-35°)、补光 900 W / 9 m 放在
  立面前 10 m、高 7 m；只导入三穗堂模块（按总装同一位姿放置）+ 地面；
  检色区 = 格扇墙（模块本地 z = 格扇墙线 ZW + REANCHOR = 4.25）x ±8.34、y 0.67–3.95（台基 +0.12 至柱高）四角投影到像面，
  区域内每 2 px 取样平均（显示空间 sRGB），判 R>G、R>B、V = max(R,G,B) ≥ 0.22。
机位：
  garden-eye      hall-kit cams() 同式：锚点 + 立面方向 14 m + 右侧 7.5 m、眼高 1.65，看锚点左 0.5 m、高 2.6，45 mm（主判定）；
  tour            OUT_DIR/tour.json 的 sansuitang 导览机位（p / t），web 相机 46° 垂直视角；
  entrance-eye    园门内：layout path-gate-sansuitang 折线第 2 点、眼高 1.6，看导览机位同一注视点，46°。
位姿：OUT_DIR/sansuitang-collision-world.json 的 instance（assemble 从 layout 算：外接矩形中心 + 共用边平移，rotY = atan2(dir)）。
图片只写到命令行给的目录（工单包 artifacts/），不进仓库。
退出码：空白帧 1，检色不合格 3（同 hall-kit render_hall.py）。
用法：blender -b -t 4 -P modules/sansuitang/render_facade.py -- --glb <model.glb> --out <dir> [--tag before|after] [--spp 48]
      [--shots garden-eye,tour,entrance-eye]
"""
import argparse
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--glb', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--tag', default='render')
ap.add_argument('--spp', type=int, default=48)
ap.add_argument('--shots', default='garden-eye,tour,entrance-eye')
ap.add_argument('--out-dir', default=os.environ.get('OUT_DIR', 'out-zone'))
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)
RX, RY = 1600, 1000

LAYOUT = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
OBJ = {o['id']: o for o in LAYOUT['objects']}
INST = json.load(open(os.path.join(AREA, a.out_dir, 'sansuitang-collision-world.json'), encoding='utf-8'))['instance']
CX, CZ = INST['position']
ROT = INST['rotY']
TOUR = json.load(open(os.path.join(AREA, a.out_dir, 'tour.json'), encoding='utf-8'))['sansuitang']
GATE = OBJ['path-gate-sansuitang']['geometry']['polyline'][1]
REGION_LOCAL = [(-8.34, 0.67, 4.25), (8.34, 0.67, 4.25), (8.34, 3.95, 4.25), (-8.34, 3.95, 4.25)]


def to_world(x, y, z):
    """模块本地 GLB (x,y,z) -> 地图 (x, 高, z)，同 assemble.place：绕 +Y 转 rotY 再平移。"""
    c, s = math.cos(ROT), math.sin(ROT)
    return (CX + x * c + z * s, y, CZ - x * s + z * c)


FRONT = (math.sin(ROT), math.cos(ROT))            # 本地 +Z（格扇立面朝向）在地图上的方向
RIGHT = (-FRONT[1], FRONT[0])                      # hall-kit cams()：px, pz = -dz, dx


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = a.spp
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = RX, RY, 100
    sc.view_settings.view_transform = 'AgX'
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
    fl = bpy.data.lights.new('fill', 'AREA')
    fl.energy, fl.size = 900.0, 9.0
    fo = bpy.data.objects.new('fill', fl)
    sc.collection.objects.link(fo)
    fp = (CX + FRONT[0] * 10, 7.0, CZ + FRONT[1] * 10)
    fo.location = (fp[0], -fp[2], fp[1])
    return sc


sc = setup_scene()
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
bpy.context.view_layer.update()
M = Matrix.Translation((CX, -CZ, 0)) @ Matrix.Rotation(ROT, 4, 'Z')
for o in bpy.data.objects:
    if o in before or o.parent is not None:
        continue
    o.matrix_world = M @ o.matrix_world
bpy.ops.mesh.primitive_plane_add(size=160, location=(CX, -CZ, -0.001))
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .55, 1)
bpy.context.object.data.materials.append(gm)

CAMS = {
    'garden-eye': ((CX + FRONT[0] * 14 + RIGHT[0] * 7.5, 1.65, CZ + FRONT[1] * 14 + RIGHT[1] * 7.5),
                   (CX - RIGHT[0] * 0.5, 2.6, CZ - RIGHT[1] * 0.5), ('lens', 45)),
    'tour': (tuple(TOUR['p']), tuple(TOUR['t']), ('vfov', 46)),
    'entrance-eye': ((GATE[0], 1.6, GATE[1]), tuple(TOUR['t']), ('vfov', 46)),
}


def make_cam(pos, tgt, optics):
    cd = bpy.data.cameras.new('cam')
    if optics[0] == 'lens':
        cd.lens = optics[1]
    else:
        cd.sensor_fit = 'VERTICAL'
        cd.angle = math.radians(optics[1])        # web PerspectiveCamera 46° 为垂直视角
    cd.clip_end = 2500
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    cam.location = (pos[0], -pos[2], pos[1])
    look = Vector((tgt[0], -tgt[2], tgt[1]))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    bpy.context.view_layer.update()
    return cam


def guard(path):
    img = bpy.data.images.load(path)
    px = img.pixels[:]
    cnt = len(px) // 4
    step = max(1, cnt // 40000)
    s = sq = 0.0
    colors = {}
    k = 0
    for i in range(0, cnt, step):
        r, g, b = px[i * 4], px[i * 4 + 1], px[i * 4 + 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        s += lum
        sq += lum * lum
        key = (round(r, 1), round(g, 1), round(b, 1))
        colors[key] = colors.get(key, 0) + 1
        k += 1
    bpy.data.images.remove(img)
    mean = s / k
    std = math.sqrt(max(0.0, sq / k - mean * mean))
    dom = max(colors.values()) / k
    return {'std255': round(std * 255, 2), 'dominant': round(dom, 3), 'blank': std < 2 / 255 or dom > 0.95}


def facade_check(cam, path):
    poly = []
    for x, y, z in (to_world(*p) for p in REGION_LOCAL):
        v = world_to_camera_view(sc, cam, Vector((x, -z, y)))
        poly.append((v.x * RX, (1 - v.y) * RY, v.z))
    if any(p[2] <= 0 for p in poly):
        return {'ok': False, 'reason': 'region behind camera'}
    img = bpy.data.images.load(path)
    iw, ih = img.size
    px = img.pixels[:]
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]

    def inside(x, y):
        c = False
        for i in range(4):
            xa, ya = poly[i][0], poly[i][1]
            xb, yb = poly[(i + 1) % 4][0], poly[(i + 1) % 4][1]
            if (ya > y) != (yb > y) and x < (xb - xa) * (y - ya) / (yb - ya) + xa:
                c = not c
        return c
    sr = sg = sb = 0.0
    n = 0
    for yy in range(max(0, int(min(ys))), min(ih - 1, int(max(ys))) + 1, 2):
        for xx in range(max(0, int(min(xs))), min(iw - 1, int(max(xs))) + 1, 2):
            if not inside(xx + 0.5, yy + 0.5):
                continue
            k = ((ih - 1 - yy) * iw + xx) * 4
            sr += px[k]
            sg += px[k + 1]
            sb += px[k + 2]
            n += 1
    bpy.data.images.remove(img)
    if n < 200:
        return {'ok': False, 'reason': 'region too small (%d samples)' % n}
    r, g, b = sr / n, sg / n, sb / n
    v = max(r, g, b)
    return {'meanSrgb255': [round(r * 255, 1), round(g * 255, 1), round(b * 255, 1)], 'hsvV': round(v, 3), 'samples': n,
            'polyPx': [[round(p[0]), round(p[1])] for p in poly], 'rule': 'R>G and R>B and V>=0.22',
            'ok': bool(r > g and r > b and v >= 0.22)}


report = {'glb': os.path.abspath(a.glb), 'tag': a.tag, 'spp': a.spp, 'instance': INST, 'shots': {}}
for name in [s for s in a.shots.split(',') if s]:
    pos, tgt, optics = CAMS[name]
    cam = make_cam(pos, tgt, optics)
    path = os.path.join(a.out, '%s-%s.png' % (a.tag, name))
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    res = {'cam': {'p': [round(v, 2) for v in pos], 't': [round(v, 2) for v in tgt], 'optics': list(optics)},
           'guard': guard(path), 'facadeColor': facade_check(cam, path)}
    report['shots'][name] = res
    print('FACADE_COLOR', name, json.dumps(res['facadeColor']), flush=True)
    bpy.data.objects.remove(cam)
json.dump(report, open(os.path.join(a.out, '%s-facade.json' % a.tag), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
bad = [k for k, v in report['shots'].items() if v['guard']['blank']]
dark = [k for k, v in report['shots'].items() if not v['facadeColor'].get('ok')]
print('RENDER_DONE', a.tag, 'blank' if bad else 'ok', 'facade-fail ' + ','.join(dark) if dark else 'facade-ok')
sys.exit(1 if bad else (3 if dark else 0))           # 同 hall-kit：检色不合格 exit 3
