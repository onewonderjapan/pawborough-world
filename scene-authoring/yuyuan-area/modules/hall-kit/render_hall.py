"""hall-kit 渲染：模块四图（正面/背面/斜俯/园内眼高）+ 总装 before/after 同机位对照 + 格扇立面检色。
图片一律输出到工单包 artifacts/（2026-09-24 机主决定：图不进仓库），不写 worktree。
before = HALL_KIT=0 的总装 scene-areas.glb（程序化体块），after = HALL_KIT=1 的总装；
同机位同光照，空白帧守卫（亮度 std<2/255 或单色>95% = fail，exit 1）。
用法：
  blender -b -t 4 -P modules/hall-kit/render_hall.py -- --module --id <id> --out <目录> [--spp 48] [--glb <模块glb>]
         [--rot-y <弧度，缺省 frame.py>] [--tag <文件名前缀>]
  blender -b -t 4 -P modules/hall-kit/render_hall.py -- --compare --ids <id,id,...> --before <glb> --after <glb> --out <目录>
         [--shots oblique,garden-eye] [--res 800x500] [--spp 32]
      （每个版本只导入一次总装，逐栋逐机位出图：<id>-<shot>-<before|after>.png）
  blender -b -t 4 -P modules/hall-kit/render_hall.py -- --check-image <png> --id <id> --shot garden-eye --out <目录>
         [--rot-y <弧度>] [--meas <measurements.json>]
      （对已有渲染图按同机位重投影检色，用于在旧样板渲染上先跑出不合格）
机位从 layout 重算：面积形心 + 模块朝向（frame.py：footprint 外接矩形上与 facade.dir 最近的一边）推四视角。
格扇立面检色（GOAL wave2 冻结）：园内眼高图里格扇立面区域（measurements.json facadeRegionLocal 四角经同一
放置变换投影到像面）平均色 R>G 且 R>B，HSV 明度 max(R,G,B) ≥ 0.18（显示空间 sRGB）。不合格 → exit 3。
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
sys.path.insert(0, HERE)
import frame as hk_frame                                  # noqa: E402  放置/朝向公式（与 build_hall / assemble 同一份）

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--module', action='store_true')
ap.add_argument('--compare', action='store_true')
ap.add_argument('--check-image', default='')
ap.add_argument('--shot', default='garden-eye')
ap.add_argument('--before', default='')
ap.add_argument('--after', default='')
ap.add_argument('--out', required=True)
ap.add_argument('--spp', type=int, default=48)
ap.add_argument('--res', default='1600x1000')
ap.add_argument('--id', default=os.environ.get('HALL_KIT_ID', 'bld-428179902'))
ap.add_argument('--ids', default='')
ap.add_argument('--shots', default='')
ap.add_argument('--glb', default='')       # 模块 GLB（缺省 out-garden-kits/hallkit-<id>/model.glb）
ap.add_argument('--meas', default='')      # measurements.json（缺省与模块 GLB 同目录）
ap.add_argument('--rot-y', type=float, default=None)   # 模块放置 yaw 覆盖（旧样板按 facade.dir 放置时用）
ap.add_argument('--tag', default='hallkit-module')
ap.add_argument('--legacy-cam', action='store_true')   # wave1 样板机位：朝向取 facade.dir、不缩放（复查旧样板图用）
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)
RX, RY = (int(v) for v in a.res.split('x'))

LAYOUT = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
DEFAULTS = json.load(open(os.path.join(HERE, 'defaults.json'), encoding='utf-8'))


def pose(hid):
    obj = next(o for o in LAYOUT['objects'] if o['id'] == hid)
    return obj, hk_frame.hall_frame(obj, DEFAULTS)


def cams(hid):
    """四张：正面（模块朝向）、背面、斜俯、园内眼高（正面偏 30° 走近）。
    距离按外接矩形最长边缩放（仰山堂 15.4 m 为 1.0，机位与 wave1 样板一致；小轩拉近，最小 0.65）。"""
    _, fr = pose(hid)
    cx, cz = fr['centroid']
    dx, dz = fr['facadeDir'] if a.legacy_cam else fr['front']
    px, pz = -dz, dx                                  # 垂直方向（右手）
    k = 1.0 if a.legacy_cam else max(0.65, min(1.0, max(2 * fr['hu'], 2 * fr['hv']) / 15.4))
    hc = (cx, 2.6, cz)
    return {
        'front': ((cx + dx * 24 * k, 5.0, cz + dz * 24 * k), hc, 40),
        'back': ((cx - dx * 24 * k, 5.0, cz - dz * 24 * k), hc, 40),
        'oblique': ((cx + dx * 16 * k + px * 17 * k, 19.0 * k, cz + dz * 16 * k + pz * 17 * k), hc, 42),
        'garden-eye': ((cx + dx * 14 * k + px * 7.5 * k, 1.65, cz + dz * 14 * k + pz * 7.5 * k),
                       (cx - px * 0.5 * k, 2.6, cz - pz * 0.5 * k), 45),
    }


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
    g = {'std255': round(std * 255, 2), 'dominant': round(dom, 3), 'blank': std < 2 / 255 or dom > 0.95}
    print('GUARD', os.path.basename(path), json.dumps(g), flush=True)
    return g


def make_cam(sc, pos, tgt, lens):
    camd = bpy.data.cameras.new('cam')
    camd.lens = lens
    camd.clip_end = 2500
    cam = bpy.data.objects.new('cam', camd)
    sc.collection.objects.link(cam)
    cam.location = (pos[0], -pos[2], pos[1])
    look = Vector((tgt[0], -tgt[2], tgt[1]))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    bpy.context.view_layer.update()
    return cam


def region_world(hid, rot_y=None, meas_path=''):
    """measurements.json 的 facadeRegionLocal（模块本地 GLB）→ 世界 GLB 坐标（同 assemble.place 变换）。"""
    mp = meas_path or os.path.join(os.path.dirname(a.glb) if a.glb else os.path.join(AREA, 'out-garden-kits', 'hallkit-' + hid),
                                   'measurements.json')
    meas = json.load(open(mp, encoding='utf-8'))
    if not meas.get('facadeRegionLocal'):
        return None                                   # 正立面无格扇（水榭 / 戏台）
    _, fr = pose(hid)
    cx, cz = fr['centroid']
    ry = fr['rotY'] if rot_y is None else rot_y
    c, s = math.cos(ry), math.sin(ry)
    return [(cx + x * c + z * s, y, cz - x * s + z * c) for x, y, z in meas['facadeRegionLocal']]


def facade_check(sc, cam, path, hid, rot_y=None, meas_path=''):
    """格扇立面区域平均色（显示空间 sRGB 0..1）：R>G、R>B、HSV 明度 max(R,G,B) ≥ 0.18。"""
    W, H = sc.render.resolution_x, sc.render.resolution_y
    poly = []
    reg = region_world(hid, rot_y, meas_path)
    if reg is None:
        return {'ok': None, 'reason': 'no front lattice (kind without 格扇 facade) — not applicable'}
    for x, y, z in reg:
        v = world_to_camera_view(sc, cam, Vector((x, -z, y)))
        poly.append((v.x * W, (1 - v.y) * H, v.z))
    if any(p[2] <= 0 for p in poly):
        return {'ok': False, 'reason': 'region behind camera'}
    img = bpy.data.images.load(path)
    iw, ih = img.size
    if (iw, ih) != (W, H):
        bpy.data.images.remove(img)
        return {'ok': False, 'reason': 'image %dx%d != camera %dx%d' % (iw, ih, W, H)}
    px_ = img.pixels[:]
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x0, x1 = max(0, int(min(xs))), min(iw - 1, int(max(xs)))
    y0, y1 = max(0, int(min(ys))), min(ih - 1, int(max(ys)))

    def inside(x, y):
        n = len(poly)
        c = False
        for i in range(n):
            xa, ya = poly[i][0], poly[i][1]
            xb, yb = poly[(i + 1) % n][0], poly[(i + 1) % n][1]
            if (ya > y) != (yb > y) and x < (xb - xa) * (y - ya) / (yb - ya) + xa:
                c = not c
        return c
    sr = sg = sb = 0.0
    cnt = 0
    for yy in range(y0, y1 + 1, 2):
        for xx in range(x0, x1 + 1, 2):
            if not inside(xx + 0.5, yy + 0.5):
                continue
            k = ((ih - 1 - yy) * iw + xx) * 4        # Blender 像素自下而上
            sr += px_[k]
            sg += px_[k + 1]
            sb += px_[k + 2]
            cnt += 1
    bpy.data.images.remove(img)
    if cnt < 200:
        return {'ok': False, 'reason': 'region too small in frame (%d samples)' % cnt}
    r, g, b = sr / cnt, sg / cnt, sb / cnt
    v = max(r, g, b)
    res = {'meanSrgb255': [round(r * 255, 1), round(g * 255, 1), round(b * 255, 1)], 'hsvV': round(v, 3),
           'samples': cnt, 'polyPx': [[round(p[0]), round(p[1])] for p in poly],
           'rule': 'R>G and R>B and V>=0.18', 'ok': bool(r > g and r > b and v >= 0.18)}
    print('FACADE_COLOR', os.path.basename(path), json.dumps(res), flush=True)
    return res


def render_cam(sc, pos, tgt, lens, path, check=None):
    cam = make_cam(sc, pos, tgt, lens)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    g = guard(path)
    if check:
        g['facadeColor'] = facade_check(sc, cam, path, *check)
    bpy.data.objects.remove(cam)
    return g


def import_at(source, x, z, rot_y=0.0):
    """导入 GLB 并变换到地图 (x, z)、绕竖轴 yaw=rot_y（与 assemble.place 同式）。"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=source)
    bpy.context.view_layer.update()
    M = Matrix.Translation((x, -z, 0)) @ Matrix.Rotation(rot_y, 4, 'Z')
    for o in bpy.data.objects:
        if o in before or o.parent is not None:
            continue
        o.matrix_world = M @ o.matrix_world


def fill_pos(hid):
    _, fr = pose(hid)
    cx, cz = fr['centroid']
    dx, dz = fr['front']
    return (cx + dx * 10, 7.0, cz + dz * 10)


results = []
if a.module:
    shots = [s for s in (a.shots or 'front,back,oblique,garden-eye').split(',') if s]
    src = os.path.abspath(a.glb) if a.glb else os.path.join(AREA, 'out-garden-kits', 'hallkit-' + a.id, 'model.glb')
    sc, _ = setup_scene(RX, RY, a.spp)
    add_fill(sc, fill_pos(a.id))
    _, fr = pose(a.id)
    ry = fr['rotY'] if a.rot_y is None else a.rot_y
    import_at(src, fr['centroid'][0], fr['centroid'][1], ry)
    bpy.ops.mesh.primitive_plane_add(size=160, location=(fr['centroid'][0], -fr['centroid'][1], -0.001))
    gnd = bpy.context.object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .55, 1)
    gnd.data.materials.append(gm)
    cs = cams(a.id)
    for name in shots:
        pos, tgt, lens = cs[name]
        g = render_cam(sc, pos, tgt, lens, os.path.join(a.out, '%s-%s.png' % (a.tag, name)),
                       check=(a.id, ry, a.meas) if name == 'garden-eye' else None)
        results.append({'shot': 'module-' + name, 'id': a.id, **g})
def hall_objects(hid):
    """总装里某栋的全部网格对象（锚空节点 = id 的子孙）。"""
    root = bpy.data.objects.get(hid)
    if root is None:
        return set()
    return {o.name for o in root.children_recursive if o.type == 'MESH'}


def visible_frac(sc, pos, pts, names):
    """从机位向各采样点投射射线：到采样点前 0.3 m 之内没有被「别的」网格挡住就算可见（先撞到本栋自身构件也算，
    开敞戏台 / 水榭的采样点在台内，射线可能穿过去不撞任何东西）。机位落在别的封闭网格里时自然为 0。"""
    dg = bpy.context.evaluated_depsgraph_get()
    o = Vector((pos[0], -pos[2], pos[1]))
    hit_n = 0
    for p in pts:
        t = Vector((p[0], -p[2], p[1]))
        d = t - o
        L = d.length
        ok_, loc, _n, _i, ob, _m = sc.ray_cast(dg, o, d.normalized(), distance=max(0.01, L - 0.3))
        if not ok_ or (ob is not None and ob.name in names):
            hit_n += 1
    return hit_n / max(1, len(pts))


def outside(fr, pos, margin=1.5):
    """机位不落在本栋外接矩形外扩 margin 以内（开敞戏台 / 水榭里射线可见度会误把「站在台内」当最佳）。"""
    dx_, dz_ = pos[0] - fr['rectCenter'][0], pos[2] - fr['rectCenter'][1]
    u = dx_ * fr['uAxis'][0] + dz_ * fr['uAxis'][1]
    v = dx_ * fr['front'][0] + dz_ * fr['front'][1]
    return abs(u) > fr['hu'] + margin or abs(v) > fr['hv'] + margin


def choose_cams(sc, hid):
    """在「after」总装里为每个机位挑一个不被邻栋 / 树挡住的位置：候选 = 缺省机位绕正立面转 ±角度、远近缩放；
    打分 = 射向本栋采样点（正立面格扇区 / 屋面外廓）的可见比例，取最高（并列取缺省）。before 复用同一机位。"""
    names = hall_objects(hid)
    base = cams(hid)
    _, fr = pose(hid)
    cx, cz = fr['centroid']
    dx, dz = fr['front']
    px, pz = -dz, dx
    k = max(0.65, min(1.0, max(2 * fr['hu'], 2 * fr['hv']) / 15.4))
    try:
        reg = region_world(hid, None, os.path.join(AREA, 'out-garden-kits', 'hallkit-' + hid, 'measurements.json'))
    except Exception:
        reg = None
    if reg:
        eye_pts = []
        for fu in (0.1, 0.3, 0.5, 0.7, 0.9):
            for fy in (0.25, 0.75):
                a0 = [reg[0][c] + (reg[1][c] - reg[0][c]) * fu for c in range(3)]
                a1 = [reg[3][c] + (reg[2][c] - reg[3][c]) * fu for c in range(3)]
                eye_pts.append([a0[c] + (a1[c] - a0[c]) * fy for c in range(3)])
    else:
        # 正立面无格扇（水榭 / 戏台）：取正立面柱线内侧一排点（眼高 ~2.2 m）
        eye_pts = [(cx + dx * (fr['hv'] - 0.5) + px * su * fr['hu'], 2.2, cz + dz * (fr['hv'] - 0.5) + pz * su * fr['hu'])
                   for su in (-0.7, -0.35, 0.0, 0.35, 0.7)]
    roof_pts = []
    for su in (-0.8, 0.0, 0.8):
        for sv in (-0.6, 0.0, 0.6):
            roof_pts.append((cx + px * su * fr['hu'] + dx * sv * fr['hv'], 5.0, cz + pz * su * fr['hu'] + dz * sv * fr['hv']))
    out, info = {}, {}
    for name, (pos0, tgt0, lens) in base.items():
        pts = eye_pts if name in ('garden-eye', 'front') else roof_pts
        v0 = visible_frac(sc, pos0, pts, names)
        best = (v0 + 0.01, 0, pos0, tgt0, v0)
        rel = [pos0[0] - cx, pos0[1], pos0[2] - cz]
        for ang in (25, -25, 45, -45, 65, -65):
            for sc_d in (1.0, 0.75, 1.3, 0.55):
                ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                rx, rz = rel[0] * ca - rel[2] * sa, rel[0] * sa + rel[2] * ca
                pos = (cx + rx * sc_d, rel[1] if name in ('garden-eye', 'front', 'back') else rel[1] * sc_d, cz + rz * sc_d)
                if name == 'garden-eye':
                    tgt = tgt0
                else:
                    tgt = tgt0
                if not outside(fr, pos):
                    continue
                vis = visible_frac(sc, pos, pts, names)
                v = vis + 0.01 * sc_d     # 可见度相同取更远（构图完整）
                if v > best[0] + 1e-9:
                    best = (v, ang, pos, tgt, vis)
            if best[4] >= 0.9:
                break
        # 斜俯仍被挡（密集园区）：再试更陡的高位机位（高 ×1.6、水平距 ×0.6）
        if name == 'oblique' and best[4] < 0.6:
            for ang in (0, 25, -25, 45, -45, 65, -65, 90, -90):
                ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                rx, rz = rel[0] * ca - rel[2] * sa, rel[0] * sa + rel[2] * ca
                pos = (cx + rx * 0.6, rel[1] * 1.6, cz + rz * 0.6)
                vis = visible_frac(sc, pos, pts, names)
                if vis + 0.006 > best[0] + 1e-9:
                    best = (vis + 0.006, 'steep%+d' % ang, pos, tgt0, vis)
        out[name] = (best[2], best[3], lens)
        info[name] = {'visibleFrac': round(best[4], 2), 'rotDeg': best[1], 'pos': [round(c, 2) for c in best[2]]}
    print('CAMS', hid, json.dumps(info), flush=True)
    return out, info


if a.compare:
    shots = [s for s in (a.shots or 'oblique,garden-eye').split(',') if s]
    ids = [i for i in (a.ids or a.id).split(',') if i]
    pairs = [(v, s) for v, s in (('after', a.after), ('before', a.before)) if s and os.path.exists(s)]
    chosen = {}
    for ver, src in pairs:
        sc, _ = setup_scene(RX, RY, a.spp)
        bpy.ops.import_scene.gltf(filepath=src)
        for hid in ids:
            if hid not in chosen:
                chosen[hid] = choose_cams(sc, hid) if ver == 'after' else (cams(hid), {})
            cs, info = chosen[hid]
            fl = add_fill(sc, fill_pos(hid))
            for name in shots:
                pos, tgt, lens = cs[name]
                chk = None
                if name == 'garden-eye' and ver == 'after':
                    chk = (hid, None, os.path.join(AREA, 'out-garden-kits', 'hallkit-' + hid, 'measurements.json'))
                g = render_cam(sc, pos, tgt, lens, os.path.join(a.out, '%s-%s-%s.png' % (hid, name, ver)), check=chk)
                results.append({'shot': 'scene-%s-%s' % (name, ver), 'id': hid, 'cam': info.get(name), **g})
            bpy.data.objects.remove(fl)
if a.check_image:
    sc, _ = setup_scene(RX, RY, 1)
    pos, tgt, lens = cams(a.id)[a.shot]
    cam = make_cam(sc, pos, tgt, lens)
    res = facade_check(sc, cam, os.path.abspath(a.check_image), a.id, a.rot_y, a.meas)
    results.append({'shot': 'check-' + a.shot, 'id': a.id, 'image': a.check_image, 'facadeColor': res})

bad = [r for r in results if r.get('blank')]
gname = ('hallkit-render-guards-%s.json' % a.tag) if a.module else 'hallkit-render-guards-compare.json' if a.compare \
    else 'hallkit-facade-check-%s.json' % os.path.splitext(os.path.basename(a.check_image))[0]
json.dump(results, open(os.path.join(a.out, gname), 'w'), indent=1, ensure_ascii=False)
colour_bad = [r for r in results if r.get('facadeColor') and r['facadeColor'].get('ok') is False]
print('RENDER_DONE', len(results), 'blank', len(bad), 'facadeColorFail', len(colour_bad))
if bad:
    sys.exit(1)
if colour_bad and (a.module or a.check_image):
    sys.exit(3)
