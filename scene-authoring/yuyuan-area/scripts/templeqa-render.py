"""庙区模块普查渲染（wave5-templeqa）：逐模块四图（正 / 斜俯 / 背 / 院内眼高 1.6 m）+ 背面掩膜 + 格扇立面检色。
图片只写到 --out（工单包 artifacts/，不进仓库）。
模块按 baseline/layout.json 的实例位姿放置（同 assemble.place：Blender (x, -z, 0) + 绕 Z 转 rotY）；
机位按模块本地包围盒 + 模块本地 +Z（正面）推四视角，再经同一放置变换到世界。
  front  : 正面中线，距 max(1.3·面宽, 2·高)，高 0.4·H + 1
  oblique: 右前上方 45°，俯角约 35°
  back   : 背面中线（front 镜像）
  eye    : 院内眼高 1.6 m，正面前 max(6, 0.55·面宽)、偏右 0.28·面宽，看向立面
  （院落模块 entry-court / dadian-court / court3：eye 取院南 1/3 处向北看）
--mask：同机位再出一张背面掩膜（view layer 材质覆盖 = 发光，Geometry.Backfacing=1 → 纯红，否则灰），
       红像素占比 = 该视角可见的「背面朝相机」的面积比。Cycles 的 Backfacing 以三角绕序的几何法线判定。
--context：同时放入全部庙区实例（看互穿 / 邻栋关系用）。
空白帧守卫同 COMMON：亮度 std < 2/255 或主色 > 95% 判空白，exit 1。
用法：
  blender -b -t 4 -P scripts/templeqa-render.py -- --out <dir> [--modules temple.glb,dadian.glb] [--views front,oblique,back,eye]
          [--mask] [--context] [--dir <模块目录>] [--res 960x600] [--spp 32] [--tag before]
          [--cams <json>]（自定义机位 [{name, inst, pos:[X,Y,Z], tgt:[X,Y,Z], lens}]，地图坐标 Y-up）
"""
import argparse
import json
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(HERE)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--dir', default=os.path.join(AREA, 'resources', 'temple-v3'))
ap.add_argument('--modules', default='')
ap.add_argument('--views', default='front,oblique,back,eye')
ap.add_argument('--mask', action='store_true')
ap.add_argument('--mask-only', action='store_true')
ap.add_argument('--context', action='store_true')
ap.add_argument('--res', default='960x600')
ap.add_argument('--spp', type=int, default=32)
ap.add_argument('--tag', default='before')
ap.add_argument('--cams', default='')
ap.add_argument('--inst', default='')     # 只渲这些实例 id（缺省每个模块取第一个实例）
ap.add_argument('--fill', action='store_true')    # hall-kit 固定检查补光（AREA 900 W、9 m，模块中心正前 10 m、高 7 m）
ap.add_argument('--facade', action='store_true')  # eye 图上做格扇立面检色（hall-kit 口径）
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)
RX, RY = (int(v) for v in a.res.split('x'))

src = open(os.path.join(AREA, 'scripts', 'assemble.py'), encoding='utf-8').read()
MF = dict(re.findall(r"'([^']+)'\s*:\s*'([^']+)'", re.search(r'MODULE_FILE\s*=\s*\{([\s\S]*?)\}', src).group(1)))
LAYOUT = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
INSTS = [dict(i, file=MF[i['module']]) for i in LAYOUT['instances'] if i['module'] in MF]
COURTS = {'entry-court-v3.glb', 'dadian-court-v2.glb', 'court3.glb'}
# 格扇 / 格窗立面区域（模块本地 GLB 坐标，前立面上的矩形 [x0, x1, y0, y1, z]），取自 kit/<模块>.config.json：
#   dadian  latticeBays.baySpansX ±[2.51,6.29] ±[6.71,10.19]、latticeY [0.35,3.6]，格心面 z ≈ −0.11
#   peidian sideBays.windowSpansX ±[1.3,3.1]、lattice sillY 0.9 .. topY 2.6，前墙 wallLocalZ 0
#   houdian sideBays.windowSpansX ±[2.4,6.1]、lattice sillY 1.0 .. topY 3.2，前墙 0
#   yimen   sideBays innerEdgeX 2.0 .. outerEdgeX 6.15，格扇门 y 0 .. 3.4（GLB 实测），格心面 z ≈ −0.13
FACADE = {
    'dadian.glb': [(s * a, s * b, .35, 3.6, -.11) for s in (-1, 1) for a, b in ((2.51, 6.29), (6.71, 10.19))],
    'peidian.glb': [(s * 1.3, s * 3.1, .9, 2.6, 0.0) for s in (-1, 1)],
    'houdian.glb': [(s * 2.4, s * 6.1, 1.0, 3.2, 0.0) for s in (-1, 1)],
    'yimen.glb': [(s * 2.0, s * 6.15, 0.1, 3.4, -.13) for s in (-1, 1)],
}


def place_fn(inst):
    x, z = inst['position']
    r = inst['rotY']
    c, s = math.cos(r), math.sin(r)
    return lambda lx, ly, lz: (x + c * lx + s * lz, ly, z - s * lx + c * lz)


def to_bl(p):
    return Vector((p[0], -p[2], p[1]))


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = a.spp
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    sc.render.resolution_x = RX
    sc.render.resolution_y = RY
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.world = bpy.data.worlds.new('daylight')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .65, .8, 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
    lt = bpy.data.lights.new('sun', 'SUN')        # 同 hall-kit render_hall.py 的固定光位
    lt.energy = 2.5
    lt.angle = math.radians(12)
    so = bpy.data.objects.new('sun', lt)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(28), math.radians(-25), math.radians(-35))
    return sc


def import_inst(inst):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(a.dir, inst['file']))
    bpy.context.view_layer.update()
    x, z = inst['position']
    M = Matrix.Translation((x, -z, 0)) @ Matrix.Rotation(inst['rotY'], 4, 'Z')
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.parent is None:
            o.matrix_world = M @ o.matrix_world
    return new


def local_bbox(objs, inst):
    """模块本地包围盒（导入前 GLB 坐标）：从世界顶点反变换。"""
    x, z = inst['position']
    Minv = (Matrix.Translation((x, -z, 0)) @ Matrix.Rotation(inst['rotY'], 4, 'Z')).inverted()
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for o in objs:
        if o.type != 'MESH':
            continue
        for v in o.data.vertices:
            w = Minv @ (o.matrix_world @ v.co)            # Blender 本地 (lx, -lz, ly)
            p = (w.x, w.z, -w.y)
            for k in range(3):
                mn[k] = min(mn[k], p[k])
                mx[k] = max(mx[k], p[k])
    return mn, mx


def cams_for(inst, mn, mx):
    pf = place_fn(inst)
    W, H, D = mx[0] - mn[0], mx[1], mx[2] - mn[2]
    cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    if inst['file'] in COURTS:
        dist = max(1.1 * W, 1.0 * D)
        loc = {
            'front': ((cx, 6.0, mx[2] + 0.35 * dist), (cx, 1.0, cz), 30),
            'oblique': ((cx + 0.55 * dist, 0.75 * dist, cz + 0.55 * dist), (cx, 0.5, cz), 32),
            'back': ((cx, 6.0, mn[2] - 0.35 * dist), (cx, 1.0, cz), 30),
            'eye': ((cx + 0.2 * W, 1.6, mx[2] - 0.2 * D), (cx - 0.1 * W, 1.6, cz - 0.2 * D), 24),
        }
    else:
        d = max(1.3 * W, 2.0 * H, 6.0)
        R = math.hypot(W, D, H)
        loc = {
            'front': ((cx, 0.4 * H + 1.0, mx[2] + d), (cx, 0.45 * H, cz), 40),
            'oblique': ((cx + 0.62 * R * 1.25, 0.25 * H + 0.75 * R, mx[2] + 0.62 * R * 1.25), (cx, 0.4 * H, cz), 36),
            'back': ((cx, 0.4 * H + 1.0, mn[2] - d), (cx, 0.45 * H, cz), 40),
            'eye': ((cx + 0.28 * W, 1.6, mx[2] + max(6.0, 0.55 * W)), (cx - 0.05 * W, 0.4 * H, cz), 24),
        }
    return {k: (pf(*p), pf(*t), lens) for k, (p, t, lens) in loc.items()}


def make_cam(sc, pos, tgt, lens):
    camd = bpy.data.cameras.new('cam')
    camd.lens = lens
    camd.clip_start = 0.05
    camd.clip_end = 2500
    cam = bpy.data.objects.new('cam', camd)
    sc.collection.objects.link(cam)
    cam.location = to_bl(pos)
    cam.rotation_euler = (to_bl(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    bpy.context.view_layer.update()
    return cam


def guard(path):
    img = bpy.data.images.load(path)
    px_ = img.pixels[:]
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
    return {'std255': round(std * 255, 2), 'dominant': round(dom, 3), 'blank': std < 2 / 255 or dom > 0.95}


def mask_material():
    m = bpy.data.materials.new('backface-mask')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (0.5, 0.5, 0.5, 1)
    mix.inputs['B'].default_value = (1, 0, 0, 1)
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(geo.outputs['Backfacing'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def mask_stats(path):
    img = bpy.data.images.load(path)
    px_ = img.pixels[:]
    cnt = len(px_) // 4
    red = geo = 0
    for i in range(cnt):
        r, g, b = px_[i * 4], px_[i * 4 + 1], px_[i * 4 + 2]
        if r + g + b < 0.1:          # 背景（掩膜时世界光 = 0）
            continue
        geo += 1
        if r > 0.5 and g < 0.3 and b < 0.3:
            red += 1
    bpy.data.images.remove(img)
    return {'redPx': red, 'geomPx': geo, 'redFrac': round(red / geo, 5) if geo else None}


def add_fill(sc, pos, energy=900.0, size=9.0):
    lt = bpy.data.lights.new('fill', 'AREA')
    lt.energy = energy
    lt.size = size
    ob = bpy.data.objects.new('fill', lt)
    sc.collection.objects.link(ob)
    ob.location = to_bl(pos)
    return ob


def facade_check(sc, cam, path, inst):
    """hall-kit render_hall.facade_check 同口径：区域平均色（显示空间 sRGB 0..1），R>G、R>B、HSV 明度 max ≥ 0.22。"""
    from bpy_extras.object_utils import world_to_camera_view
    W, H = sc.render.resolution_x, sc.render.resolution_y
    pf = place_fn(inst)
    polys = []
    for x0, x1, y0, y1, z in FACADE[inst['file']]:
        poly = []
        for lx, ly in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            v = world_to_camera_view(sc, cam, to_bl(pf(lx, ly, z)))
            poly.append((v.x * W, (1 - v.y) * H, v.z))
        if any(p[2] <= 0 for p in poly):
            return {'ok': False, 'reason': 'region behind camera'}
        polys.append(poly)
    img = bpy.data.images.load(path)
    iw, ih = img.size
    px_ = img.pixels[:]

    def inside(poly, x, y):
        c = False
        for i in range(len(poly)):
            xa, ya = poly[i][0], poly[i][1]
            xb, yb = poly[(i + 1) % len(poly)][0], poly[(i + 1) % len(poly)][1]
            if (ya > y) != (yb > y) and x < (xb - xa) * (y - ya) / (yb - ya) + xa:
                c = not c
        return c
    sr = sg = sb = 0.0
    cnt = 0
    for poly in polys:
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        for yy in range(max(0, int(min(ys))), min(ih - 1, int(max(ys))) + 1, 2):
            for xx in range(max(0, int(min(xs))), min(iw - 1, int(max(xs))) + 1, 2):
                if not inside(poly, xx + .5, yy + .5):
                    continue
                k = ((ih - 1 - yy) * iw + xx) * 4
                sr += px_[k]
                sg += px_[k + 1]
                sb += px_[k + 2]
                cnt += 1
    bpy.data.images.remove(img)
    if not cnt:
        return {'ok': False, 'reason': 'region off-frame'}
    m = (sr / cnt, sg / cnt, sb / cnt)
    v = max(m)
    return {'ok': m[0] > m[1] and m[0] > m[2] and v >= 0.22, 'meanSrgb': [round(c, 4) for c in m], 'value': round(v, 4),
            'pixels': cnt, 'threshold': 0.22}


def render(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


results = []
sc = setup_scene()
ground = None
bpy.ops.mesh.primitive_plane_add(size=600, location=(-80, 20, -0.002))
ground = bpy.context.object
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .55, 1)
ground.data.materials.append(gm)

want_mods = [m for m in a.modules.split(',') if m] or list(dict.fromkeys(i['file'] for i in INSTS))
want_inst = [i for i in a.inst.split(',') if i]
targets = []
for f in want_mods:
    cand = [i for i in INSTS if i['file'] == f and (not want_inst or i['id'] in want_inst)]
    targets += cand if want_inst else cand[:1]

ctx_objs = {}
if a.context:
    for inst in INSTS:
        ctx_objs[inst['id']] = import_inst(inst)

mask_mat = mask_material() if (a.mask or a.mask_only) else None
views = [v for v in a.views.split(',') if v and v != 'none']
for inst in targets:
    objs = ctx_objs.get(inst['id']) or import_inst(inst)
    mn, mx = local_bbox(objs, inst)
    cams = cams_for(inst, mn, mx)
    fill = add_fill(sc, place_fn(inst)((mn[0] + mx[0]) / 2, 7.0, (mn[2] + mx[2]) / 2 + 10)) if a.fill else None
    base = inst['file'][:-4] + ('' if inst['id'] == [i for i in INSTS if i['file'] == inst['file']][0]['id'] else '-' + inst['id'])
    for v in views:
        pos, tgt, lens = cams[v]
        cam = make_cam(sc, pos, tgt, lens)
        rec = {'module': inst['file'], 'inst': inst['id'], 'view': v, 'pos': [round(c, 3) for c in pos], 'tgt': [round(c, 3) for c in tgt], 'lens': lens}
        if not a.mask_only:
            p = os.path.join(a.out, '%s-%s-%s.png' % (base, v, a.tag))
            render(sc, p)
            rec['image'] = p
            rec['guard'] = guard(p)
            print('RENDER', os.path.basename(p), json.dumps(rec['guard']), flush=True)
            if a.facade and v == 'eye' and inst['file'] in FACADE:
                rec['facadeColor'] = facade_check(sc, cam, p, inst)
                print('FACADE', os.path.basename(p), json.dumps(rec['facadeColor']), flush=True)
        if mask_mat:
            vl = bpy.context.view_layer
            vl.material_override = mask_mat
            sp, dn = sc.cycles.samples, sc.cycles.use_denoising
            sc.cycles.samples, sc.cycles.use_denoising = 4, False
            sc.view_settings.view_transform = 'Standard'
            bgs = sc.world.node_tree.nodes['Background'].inputs['Strength']
            bgs.default_value = 0.0
            ground.hide_render = True
            p2 = os.path.join(a.out, '%s-%s-mask-%s.png' % (base, v, a.tag))
            render(sc, p2)
            ground.hide_render = False
            sc.cycles.samples, sc.cycles.use_denoising = sp, dn
            sc.view_settings.view_transform = 'AgX'
            bgs.default_value = 0.65
            vl.material_override = None
            rec['mask'] = p2
            rec['maskStats'] = mask_stats(p2)
            print('MASK', os.path.basename(p2), json.dumps(rec['maskStats']), flush=True)
        bpy.data.objects.remove(cam)
        results.append(rec)
    if fill:
        bpy.data.objects.remove(fill)
    if not a.context:
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)

if a.cams:
    for c in json.load(open(a.cams, encoding='utf-8')):
        cam = make_cam(sc, c['pos'], c['tgt'], c.get('lens', 30))
        p = os.path.join(a.out, '%s-%s.png' % (c['name'], a.tag))
        render(sc, p)
        g = guard(p)
        print('RENDER', os.path.basename(p), json.dumps(g), flush=True)
        results.append({'name': c['name'], 'image': p, 'guard': g, **c})
        bpy.data.objects.remove(cam)

gp = os.path.join(a.out, 'render-guards-%s.json' % a.tag)
old = []
if os.path.exists(gp):
    old = [r for r in json.load(open(gp, encoding='utf-8')) if not any(
        r.get('image') == n.get('image') and r.get('mask') == n.get('mask') and r.get('view') == n.get('view') and r.get('inst') == n.get('inst') for n in results)]
json.dump(old + results, open(gp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
bad = [r for r in results if r.get('guard', {}).get('blank')]
dark = [r for r in results if r.get('facadeColor', {}).get('ok') is False]
print('TEMPLEQA_RENDER done', len(results), 'blank', len(bad), 'facadeFail', len(dark), flush=True)
# 同 hall-kit render_hall.py：空白帧 exit 1；格扇立面检色不合格 exit 3
sys.exit(1 if bad else 3 if dark else 0)
