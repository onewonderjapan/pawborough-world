"""hall-kit 渲染：模块四图（正面/背面/斜俯/园内眼高）+ 总装 before/after 同机位对照。
图片一律输出到工单包 artifacts/（2026-09-24 机主决定：图不进仓库），不写 worktree。
before = HALL_KIT=0 的总装 scene-areas.glb（现程序化体块），after = HALL_KIT=1 的总装；
同机位同光照，空白帧守卫（亮度 std<2/255 或单色>95% = fail，exit 1）。
用法：
  blender -b -t 4 -P modules/hall-kit/render_hall.py -- --module --out <artifacts目录> [--spp 48]
  blender -b -t 4 -P modules/hall-kit/render_hall.py -- --compare --before <glb> --after <glb> --out <目录>
机位从 layout 重算：形心 + facade.dir 推正面/背面/斜俯/眼高四视角。
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--module', action='store_true')
ap.add_argument('--compare', action='store_true')
ap.add_argument('--before', default='')
ap.add_argument('--after', default='')
ap.add_argument('--out', required=True)
ap.add_argument('--spp', type=int, default=48)
ap.add_argument('--id', default=os.environ.get('HALL_KIT_ID', 'bld-428179902'))
ap.add_argument('--glb', default='')      # 模块 GLB（缺省 out-garden-kits/hallkit-<id>/model.glb）
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)

LAYOUT = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
OBJ = next(o for o in LAYOUT['objects'] if o['id'] == a.id)
fp = OBJ['geometry']['footprint']
fp = fp[:-1] if fp[0] == fp[-1] else fp
n = len(fp)
A2 = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n)) / 2
cx = sum((fp[i][0] + fp[(i + 1) % n][0]) * (fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1]) for i in range(n)) / (6 * A2)
cz = sum((fp[i][1] + fp[(i + 1) % n][1]) * (fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1]) for i in range(n)) / (6 * A2)
dx, dz = OBJ['facade']['dir']
dl = math.hypot(dx, dz)
dx, dz = dx / dl, dz / dl
px, pz = -dz, dx                                  # 垂直方向（右手）

HALL_C = (cx, 2.6, cz)


def cams():
    """四张：正面（facade.dir 向）、背面、斜俯、园内眼高（正面偏 30° 走近）。"""
    return [
        ('front', (cx + dx * 24, 5.0, cz + dz * 24), HALL_C, 40),
        ('back', (cx - dx * 24, 5.0, cz - dz * 24), HALL_C, 40),
        ('oblique', (cx + dx * 16 + px * 17, 19.0, cz + dz * 16 + pz * 17), HALL_C, 42),
        ('garden-eye', (cx + dx * 14 + px * 7.5, 1.65, cz + dz * 14 + pz * 7.5),
         (cx - px * 0.5, 2.6, cz - pz * 0.5), 45),
    ]


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
    return sc, so


def add_fill(sc, pos, energy=900.0, size=9.0):
    """固定检查补光（before/after 同参数，只照明不参与导出）。"""
    lt = bpy.data.lights.new('fill', 'AREA')
    lt.energy = energy
    lt.size = size
    ob = bpy.data.objects.new('fill', lt)
    sc.collection.objects.link(ob)
    ob.location = (pos[0], -pos[2], pos[1])
    return ob


def guard(path):
    img = bpy.data.images.load(path)
    px_ = list(img.pixels)
    cnt = len(px_) // 4
    step = max(1, cnt // 40000)
    s = sq = 0.0
    colors = {}
    k = 0
    for i in range(0, cnt, step):
        r, g, b = px_[i * 4], px_[i * 4 + 1], px_[i * 4 + 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        s += lum
        sq += lum * lum
        key = (round(r, 1), round(g, 1), round(b, 1))
        colors[key] = colors.get(key, 0) + 1
        k += 1
    mean = s / k
    std = math.sqrt(max(0.0, sq / k - mean * mean))
    dom = max(colors.values()) / k
    bpy.data.images.remove(img)
    g = {'std255': round(std * 255, 2), 'dominant': round(dom, 3), 'blank': std < 2 / 255 or dom > 0.95}
    print('GUARD', os.path.basename(path), json.dumps(g), flush=True)
    return g


def render_cam(sc, pos, tgt, lens, path):
    camd = bpy.data.cameras.new('cam')
    camd.lens = lens
    camd.clip_end = 2500
    cam = bpy.data.objects.new('cam', camd)
    sc.collection.objects.link(cam)
    cam.location = (pos[0], -pos[2], pos[1])
    look = Vector((tgt[0], -tgt[2], tgt[1]))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    return guard(path)


def import_at(source, x, z, rot_y=0.0):
    """导入 GLB 并变换到地图 (x, z)、绕竖轴 yaw=rot_y（与 assemble.place 同式）。
    模块 GLB 原点在局部 0,0，网格绝对坐标、对象 transform=0，所以要整体矩阵左乘。"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=source)
    bpy.context.view_layer.update()
    M = Matrix.Translation((x, -z, 0)) @ Matrix.Rotation(rot_y, 4, 'Z')
    for o in bpy.data.objects:
        if o in before or o.parent is not None:
            continue
        o.matrix_world = M @ o.matrix_world


results = []
if a.module:
    src = os.path.abspath(a.glb) if a.glb else os.path.join(AREA, 'out-garden-kits', 'hallkit-' + a.id, 'model.glb')
    sc, _ = setup_scene(1600, 1000, a.spp)
    add_fill(sc, (cx + dx * 10, 7.0, cz + dz * 10))
    import_at(src, cx, cz, math.atan2(dx, dz))
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, -0.001, 0))
    gnd = bpy.context.object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .55, 1)
    gnd.data.materials.append(gm)
    for name, pos, tgt, lens in cams():
        g = render_cam(sc, pos, tgt, lens, os.path.join(a.out, 'hallkit-module-%s.png' % name))
        results.append({'shot': 'module-' + name, **g})
if a.compare:
    pairs = [(v, s) for v, s in (('before', a.before), ('after', a.after)) if s and os.path.exists(s)]
    for name, pos, tgt, lens in cams():
        for ver, src in pairs:
            sc, _ = setup_scene(1600, 1000, a.spp)
            add_fill(sc, (cx + dx * 10, 7.0, cz + dz * 10))
            bpy.ops.import_scene.gltf(filepath=src)
            g = render_cam(sc, pos, tgt, lens, os.path.join(a.out, 'hallkit-scene-%s-%s.png' % (name, ver)))
            results.append({'shot': 'scene-%s-%s' % (name, ver), **g})

bad = [r for r in results if r.get('blank')]
json.dump(results, open(os.path.join(a.out, 'hallkit-render-guards.json'), 'w'), indent=1)
print('RENDER_DONE', len(results), 'blank', len(bad))
if bad:
    sys.exit(1)
