"""N3 street carts (1990s): three push-cart props, asset-only.
Coordinate contract: GLB Y-up, origin = ground centre, +Z faces the customer.
Snacks reuse the reviewed handheld library (youdunzi / congyoubing / xiekehuang),
imported as linked instances, non-matching LOD subtrees dropped.
Run: blender -b --factory-startup -t 4 -P build_carts_n3.py -- <recipe.json> <out_dir>
"""
import sys, json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent / 'source-kit'
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
import mb_lite as L
from helpers import glb_to_blender

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
R = json.loads(Path(argv[0]).read_text(encoding='utf-8'))
OUT = Path(argv[1])
HANDHELD = Path('/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/snacks/handheld/props')


def lathe(name, x, z, prof, m, sides=10, smooth=False):
    verts, faces = [], []
    for rr, yy in prof:
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((x + rr * math.cos(a), yy, z + rr * math.sin(a)))
    rings = len(prof)
    for ri in range(rings - 1):
        for k in range(sides):
            A = ri * sides + k; B = ri * sides + (k + 1) % sides
            faces.append((A, B, B + sides, A + sides))
    faces.append(tuple(range((rings - 1) * sides, rings * sides)))
    return L.mesh(name, verts, faces, m, smooth=smooth)


def cart_chassis(w=1.15, d=0.6, top=0.82, wheel_r=0.24, axle='mid'):
    """木轮推车底盘。+Z 朝顾客。
    axle='mid'：轮在中部、支腿靠前（葱油饼车，保持原布局）。
    axle='ends'：两轮在顾客端、两支腿在把手端，包围盒沿 Z 分开。
    """
    L.GROUP = 'cart'
    L.box('cart-body', (0, top - 0.16, 0), (w, 0.32, d), 'wood', 0.008, True)
    L.box('cart-apron', (0, top - 0.05, 0.06), (w + 0.06, 0.10, d + 0.06), 'iron', 0.006)
    L.box('cart-deck', (0, top - 0.005, 0), (w + 0.04, 0.05, d + 0.02), 'iron', 0.006)
    if axle == 'ends':
        wheel_z = d / 2 - 0.10
        leg_z = -d / 2 + 0.10
        leg_x = w / 2 - 0.18
    else:
        wheel_z = 0.02
        leg_z = d / 2 - 0.12
        leg_x = w / 2 - 0.10
    for sx in (-1, 1):
        # 轮子：轴向沿 X
        L.cyl('cart-wheel', (sx * (w / 2 + 0.02), wheel_r, wheel_z), (sx * (w / 2 - 0.04), wheel_r, wheel_z), wheel_r, 'wood', 12)
        L.cyl('cart-hub', (sx * (w / 2 + 0.05), wheel_r, wheel_z), (sx * (w / 2 - 0.06), wheel_r, wheel_z), 0.05, 'dark', 8)
    leg_h = top - 0.32
    for sx in (-1, 1):
        L.box('cart-leg', (sx * leg_x, leg_h / 2, leg_z), (0.05, leg_h, 0.05), 'wood', 0, True)
    for sx in (-1, 1):
        L.cyl('cart-handle', (sx * (w / 2 - 0.08), top - 0.18, -d / 2 - 0.02),
              (sx * (w / 2 - 0.08), top - 0.02, -d / 2 - 0.34), 0.022, 'wood', 6)
    L.cyl('cart-handle-bar', (-w / 2 + 0.08, top - 0.02, -d / 2 - 0.34), (w / 2 - 0.08, top - 0.02, -d / 2 - 0.34), 0.022, 'wood', 6)


def tube(name, x, z, y0, y1, r_out, r_in, m, sides=16):
    """闭合厚壁圆环（外壁、顶沿、内壁、底沿）。"""
    return ring(name, x, z, ((r_out, y0), (r_out, y1), (r_in, y1), (r_in, y0)), m, sides)


def ring(name, x, z, profile, m, sides=16):
    """profile: (radius, y) 顺时针一圈，收成闭合厚壁。"""
    verts = []
    for rr, yy in profile:
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append((x + rr * math.cos(a), yy, z + rr * math.sin(a)))
    n = len(profile)
    faces = []
    for i in range(n):
        j = (i + 1) % n
        for k in range(sides):
            A = i * sides + k
            B = i * sides + (k + 1) % sides
            C = j * sides + (k + 1) % sides
            D = j * sides + k
            faces.append((A, B, C, D))
    return L.mesh(name, verts, faces, m)


def assert_wheel_leg_disjoint():
    """车轮（含轮毂）包围盒与任何支腿包围盒不相交。须在 finalize 合并之前调用。"""
    import bpy
    from helpers import blender_to_glb

    def aabb(obj):
        mn = [1e9] * 3
        mx = [-1e9] * 3
        for v in obj.data.vertices:
            p = blender_to_glb(obj.matrix_world @ v.co)
            for k in range(3):
                mn[k] = min(mn[k], p[k])
                mx[k] = max(mx[k], p[k])
        return mn, mx

    def separated(a, b):
        return any(a[1][k] <= b[0][k] + 1e-6 or b[1][k] <= a[0][k] + 1e-6 for k in range(3))

    wheels = [o for o in bpy.context.scene.objects
              if o.type == 'MESH' and (o.name.startswith('cart-wheel') or o.name.startswith('cart-hub'))]
    legs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('cart-leg')]
    overlaps = []
    gaps = []
    for w in wheels:
        wa = aabb(w)
        for g in legs:
            ga = aabb(g)
            if not separated(wa, ga):
                overlaps.append(f'{w.name}~{g.name}')
            else:
                gap = max(max(ga[0][k] - wa[1][k], wa[0][k] - ga[1][k]) for k in range(3))
                gaps.append(round(gap, 4))
    detail = f'wheels={len(wheels)} legs={len(legs)} overlaps={overlaps or 0} minGapM={min(gaps) if gaps else None}'
    L.assert_true('wheel-leg-bbox-disjoint', len(wheels) >= 2 and len(legs) >= 2 and not overlaps, detail)
    return detail


def mat_blend(name, color, alpha, rough=0.2, metal=0.0):
    """恒定色 + Alpha 插座。Blender 4.5 的 glTF 导出在 Alpha<1 时写 alphaMode=BLEND。"""
    m = L.mat(name, color, rough, metal)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Alpha'].default_value = alpha
    col = list(p.inputs['Base Color'].default_value)
    col[3] = alpha
    p.inputs['Base Color'].default_value = col
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    L.META[name]['alpha'] = alpha
    L.META[name]['alphaMode'] = 'BLEND'
    return m


def add_instances(spec):
    path = HANDHELD / spec['file']
    before_set = set(__import__('bpy').data.objects)
    import bpy
    bpy.ops.import_scene.gltf(filepath=str(path))
    src = [o for o in bpy.data.objects if o not in before_set]
    want = spec.get('lod', 'LOD0')
    for o in list(src):
        nm = o.name
        if '_LOD' in nm or nm.startswith('socket'):
            if not nm.endswith('_' + want):
                bpy.data.objects.remove(o, do_unlink=True)
                src.remove(o)
    L.GROUP = 'food-' + spec['file'].replace('.glb', '')
    root = bpy.data.objects.new('food-root-' + spec['file'], None)
    bpy.context.collection.objects.link(root)
    for o in src:
        if o.parent is None:
            o.parent = root

    def dup_tree(obj):
        c = obj.copy()
        bpy.context.collection.objects.link(c)
        for ch in obj.children:
            cc = dup_tree(ch)
            cc.parent = c
        return c

    first = spec['at'][0]
    root.location = glb_to_blender((first[0], first[1], first[2]))
    L.tag(root)
    roots = [root]
    for p in spec['at'][1:]:
        r2 = dup_tree(root)
        r2.location = glb_to_blender((p[0], p[1], p[2]))
        L.tag(r2)
        roots.append(r2)
    L.assert_true(f"food-{spec['file']}", len(roots) == len(spec['at']), f"{len(roots)}/{len(spec['at'])}")


def build_youdunzi():
    dim = R.get('dimensionsM') or {}
    body_l = float(dim.get('bodyLength', 1.15))
    body_w = float(dim.get('bodyWidth', 0.60))
    deck = float(dim.get('bodyHeight', 0.82))
    wheel_d = float(dim.get('wheelDiameter', 0.48))
    stove_d = float(dim.get('stoveDiameter', 0.34))
    stove_h = float(dim.get('stoveHeight', 0.32))
    pot_d = float(dim.get('potDiameter', 0.48))
    pot_depth = float(dim.get('potDepth', 0.12))
    cart_chassis(w=body_l, d=body_w, top=deck, wheel_r=wheel_d / 2, axle='ends')
    wheel_leg = assert_wheel_leg_disjoint()

    # 煤炉在台面左侧。炉身直径小于锅径，锅底坐在炉沿上。
    sx, sz = -0.10, 0.0
    stove_r = stove_d / 2
    stove_base = deck
    stove_top = deck + stove_h
    L.GROUP = 'stove'
    L.cyl('coal-stove-body', (sx, stove_base, sz), (sx, stove_top - 0.04, sz), stove_r, 'brick', 12)
    L.cyl('coal-stove-rim', (sx, stove_top - 0.04, sz), (sx, stove_top, sz), stove_r + 0.02, 'dark', 12)
    L.box('coal-door', (sx, stove_base + 0.10, sz + stove_r - 0.01), (0.12, 0.10, 0.04), 'dark', 0)

    # 厚壁铁油锅：上口 pot_d，深 pot_depth，壁厚 0.014 m，底略收成锅形。
    wall = 0.014
    pot_r = pot_d / 2
    r_bot = pot_r - 0.04
    inner_top = pot_r - wall
    inner_bot = r_bot - wall
    y0 = stove_top
    y_floor = y0 + wall
    y1 = y0 + pot_depth
    L.GROUP = 'pot'
    L.cyl('fry-pot-floor', (sx, y0, sz), (sx, y_floor, sz), r_bot, 'iron', 16)
    ring('fry-pot-wall', sx, sz, (
        (r_bot, y_floor), (pot_r, y1 - 0.012), (pot_r + 0.01, y1),
        (inner_top, y1), (inner_bot, y_floor),
    ), 'iron', 20)
    L.assert_true('pot-diameter', 0.45 <= pot_d <= 0.50 and abs(pot_depth - 0.12) < 1e-6,
                  f'diameter={pot_d:.3f} depth={pot_depth:.3f} wall={wall:.3f}')

    # 油体灌到锅沿下 1 cm。低机位看不到锅底，侧面能看到琥珀油壁；油墩子上半截冒出锅口。
    oil_y = y1 - 0.012
    cake_half = 0.017
    L.GROUP = 'oil'
    L.cyl('oil-surface', (sx, oil_y - 0.032, sz), (sx, oil_y, sz), inner_top - 0.02, 'oil', 20)
    in_oil_y = oil_y - cake_half
    in_oil = [
        [sx - 0.05, in_oil_y, sz - 0.06],
        [sx + 0.05, in_oil_y, sz + 0.06],
    ]

    # 沥油铁丝架挂在锅沿 +X，探出锅身，两只油墩子分开，不叠在锅盖位置。
    L.GROUP = 'rack'
    rack_y = y1 - 0.004
    rim_x = sx + pot_r
    for zz in (-0.07, 0.07):
        L.cyl('rack-hook', (rim_x - 0.02, y1 - 0.02, sz + zz), (rim_x + 0.01, y1 + 0.014, sz + zz), 0.005, 'iron', 6)
        L.cyl('rack-hook-out', (rim_x + 0.01, y1 + 0.014, sz + zz), (rim_x + 0.06, rack_y, sz + zz), 0.005, 'iron', 6)
    for zz in (-0.07, 0.0, 0.07):
        L.cyl('rack-wire', (rim_x + 0.05, rack_y, sz + zz), (rim_x + 0.20, rack_y, sz + zz), 0.005, 'iron', 6)
    L.cyl('rack-rail', (rim_x + 0.07, rack_y, sz - 0.08), (rim_x + 0.07, rack_y, sz + 0.08), 0.005, 'iron', 6)
    L.cyl('rack-rail-end', (rim_x + 0.18, rack_y, sz - 0.08), (rim_x + 0.18, rack_y, sz + 0.08), 0.005, 'iron', 6)
    on_rack = [
        [rim_x + 0.10, rack_y, sz - 0.055],
        [rim_x + 0.16, rack_y, sz + 0.055],
    ]

    # 面糊桶 Ø0.25 + 萝卜丝盆，替换原先没有依据的灰箱。
    L.GROUP = 'batter'
    buck_x, buck_z, buck_r, buck_h = 0.42, -0.14, 0.125, 0.22
    deck_top = deck + 0.02
    L.cyl('batter-bucket-floor', (buck_x, deck_top, buck_z), (buck_x, deck_top + wall, buck_z), buck_r, 'iron', 12)
    tube('batter-bucket-wall', buck_x, buck_z, deck_top + wall, deck_top + buck_h, buck_r, buck_r - 0.008, 'iron', 12)
    L.cyl('batter-surface', (buck_x, deck_top + 0.15, buck_z), (buck_x, deck_top + 0.156, buck_z), buck_r - 0.02, 'batter', 12)
    L.assert_true('batter-bucket-diameter', abs(buck_r * 2 - 0.25) < 1e-6, f'diameter={buck_r * 2:.3f}')

    L.GROUP = 'basin'
    bas_x, bas_z, bas_r = 0.22, 0.20, 0.10
    L.cyl('radish-basin-floor', (bas_x, deck_top, bas_z), (bas_x, deck_top + 0.012, bas_z), bas_r, 'iron', 12)
    tube('radish-basin-wall', bas_x, bas_z, deck_top + 0.012, deck_top + 0.055, bas_r, bas_r - 0.008, 'iron', 12)
    L.cyl('radish-shreds', (bas_x, deck_top + 0.03, bas_z), (bas_x, deck_top + 0.048, bas_z), bas_r - 0.02, 'radish', 12)

    # 长柄油墩子模子 ×2：扁圆勺 Ø0.09 + 0.35 m 铁柄，沿 -Z 平放，柄留在台面内。
    L.GROUP = 'mold'
    spoon_r = 0.045
    handle_len = 0.35
    molds = [(-0.48, 0.16, -1), (-0.40, 0.16, -1)]
    for i, (mx, mz, direction) in enumerate(molds):
        L.cyl(f'mold-bowl-{i}', (mx, deck_top + 0.004, mz), (mx, deck_top + 0.016, mz), spoon_r, 'iron', 12)
        hz = mz + direction * handle_len
        L.cyl(f'mold-handle-{i}', (mx, deck_top + 0.012, mz), (mx, deck_top + 0.012, hz), 0.006, 'iron', 6)
        L.assert_true(f'mold-{i}', abs(abs(hz - mz) - handle_len) < 1e-6 and abs(spoon_r * 2 - 0.09) < 1e-6,
                      f'bowlZ={mz:.3f} handleEndZ={hz:.3f} diameter=0.090')

    add_instances({'file': 'youdunzi.glb', 'lod': 'LOD0', 'at': in_oil + on_rack})
    # 半浸：两只的底在油面下 cake_half，顶在油面上。沥油架上的两只底贴在铁丝上、在锅外。
    for p in in_oil:
        inside = math.hypot(p[0] - sx, p[2] - sz) + 0.04 < inner_top
        L.assert_true('youdunzi-in-oil', inside and abs((p[1] + cake_half) - oil_y) < 1e-6,
                      f'at={p} oilY={oil_y:.3f} innerR={inner_top:.3f}')
    for p in on_rack:
        outside = math.hypot(p[0] - sx, p[2] - sz) > pot_r
        L.assert_true('youdunzi-on-rack', outside and abs(p[1] - rack_y) < 1e-6,
                      f'at={p} rackY={rack_y:.3f}')
    print('WHEEL_LEG', wheel_leg)


def build_congyoubing():
    cart_chassis(w=1.25)
    L.GROUP = 'griddle'
    L.cyl('griddle-stove', (-0.18, 0.82, 0.0), (-0.18, 1.04, 0.0), 0.27, 'brick', 12)
    L.cyl('griddle-plate', (-0.18, 1.04, 0.0), (-0.18, 1.10, 0.0), 0.30, 'iron', 14)
    L.cyl('griddle-rim', (-0.18, 1.10, 0.0), (-0.18, 1.13, 0.0), 0.31, 'dark', 14)
    L.box('dough-board', (0.38, 0.86, 0.10), (0.40, 0.04, 0.32), 'wood', 0.004)
    for dx, dz in ((0.30, 0.02), (0.44, 0.10), (0.40, -0.08)):
        lathe('dough-ball', dx, dz, [(0.0, 0.905), (0.045, 0.905), (0.05, 0.93), (0.03, 0.95), (0.0, 0.955)], 'dough', 8)
    L.cyl('oil-tin', (0.56, 0.90, -0.18), (0.56, 1.00, -0.18), 0.05, 'iron', 8)
    add_instances({'file': 'congyoubing.glb', 'lod': 'LOD0', 'at': [
        [-0.26, 1.14, 0.06], [-0.10, 1.14, -0.06], [0.38, 0.90, 0.10]]})


def build_xiekehuang():
    L.GROUP = 'oven'
    # 炭炉桶：铁皮大桶，上口敞开内嵌炭膛，沿口贴炉壁放蟹壳黄
    L.cyl('oven-barrel', (0.0, 0.06, 0.0), (0.0, 1.00, 0.0), 0.30, 'iron', 14)
    L.cyl('oven-mouth', (0.0, 1.00, 0.0), (0.0, 1.04, 0.0), 0.31, 'dark', 14)
    L.cyl('oven-throat', (0.0, 0.86, 0.0), (0.0, 1.00, 0.0), 0.21, 'dark', 12)
    lathe('charcoal-bed', 0.0, 0.0, [(0.0, 0.90), (0.10, 0.90), (0.16, 0.94), (0.20, 1.00)], 'charcoal', 12)
    for k in range(6):
        a = 2 * math.pi * k / 6
        L.box('oven-ledge-shoe', (0.26 * math.cos(a), 1.005, 0.26 * math.sin(a)), (0.05, 0.03, 0.05), 'iron', 0)
    L.box('oven-draft', (0.0, 0.16, 0.30), (0.14, 0.10, 0.04), 'dark', 0)
    # 竹篮 ×2（一只叠放）
    lathe('bamboo-basket', -0.52, 0.10, [(0.0, 0.0), (0.20, 0.0), (0.21, 0.03), (0.17, 0.15), (0.19, 0.17), (0.16, 0.19), (0.0, 0.19)], 'bamboo', 12)
    lathe('bamboo-basket', -0.50, 0.10, [(0.0, 0.19), (0.185, 0.19), (0.195, 0.21), (0.155, 0.33), (0.175, 0.35), (0.145, 0.37), (0.0, 0.37)], 'bamboo', 12)
    L.box('paper-bag', (0.42, 0.09, 0.20), (0.16, 0.18, 0.10), 'paper', 0)
    add_instances({'file': 'xiekehuang.glb', 'lod': 'LOD0', 'at': [
        [0.0, 1.045, 0.26], [0.22, 1.045, -0.13],
        [-0.52, 0.38, 0.10], [-0.46, 0.38, -0.06], [-0.56, 0.38, -0.02]]})


BUILDERS = {'cart-youdunzi': build_youdunzi, 'cart-congyoubing': build_congyoubing, 'cart-xiekehuang': build_xiekehuang}


def main():
    import bpy
    L.reset_scene()
    L.build_materials()
    L.M['iron'] = L.mat('galvanized-iron', 'b6bab6', .45, metal=.6)
    L.M['oil'] = mat_blend('dark-amber-oil', '8a5a1c', 0.85, rough=0.22, metal=0.05)
    L.M['batter'] = L.mat('rice-batter', 'e4d39a', .6)
    L.M['radish'] = L.mat('radish-shred', 'f3efe6', .75)
    L.M['dough'] = L.mat('wheat-dough', 'e8ddc8', .8)
    L.M['bamboo'] = L.mat('bamboo-woven', 'c8a86a', .75)
    L.M['charcoal'] = L.mat('charcoal', '1c1a18', .9)
    L.M['paper'] = L.mat('paper-bag', 'cfc4a8', .85)
    BUILDERS[R['id']]()
    # bounds 断言：原点地面中心，+Z 顾客
    from helpers import blender_to_glb
    mn = [1e9] * 3; mx = [-1e9] * 3
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or o.hide_render:
            continue
        for v in o.data.vertices:
            p = blender_to_glb(o.matrix_world @ v.co)
            for k in range(3):
                mn[k] = min(mn[k], p[k]); mx[k] = max(mx[k], p[k])
    L.assert_true('origin-ground-centre', abs((mn[0] + mx[0]) / 2) < 0.75 and abs(mn[1]) < 0.06,
                  f'x-centre {(mn[0]+mx[0])/2:.3f}, y-min {mn[1]:.3f}')
    L.assert_true('glb-bounds', mx[1] < 1.8 and mn[2] > -1.2 and mx[2] < 1.2,
                  f'y-max {mx[1]:.3f}, z [{mn[2]:.3f}, {mx[2]:.3f}]')
    design = {
        'specId': R['id'], 'name': R['name'],
        'frontageM': round(mx[0] - mn[0], 3), 'depthM': round(mx[2] - mn[2], 3), 'ridgeM': round(mx[1], 3),
        'family': '1990s street vending cart prop, asset-only',
        'designInference': True, 'notHistoricalReconstruction': True,
        'axis': 'glTF Y-up, origin = ground centre, +Z faces the customer',
        'features': R['features'],
        'instances': R.get('instances'),
        'foodSource': 'handheld library (reviewed R1/R2), linked instances, non-matching LODs dropped',
        'generator': 'generator/build_carts_n3.py',
        'recipe': R['id'] + '.json',
        'dimensionsM': R.get('dimensionsM'),
    }
    L.finalize(R['id'], OUT, design)


main()
