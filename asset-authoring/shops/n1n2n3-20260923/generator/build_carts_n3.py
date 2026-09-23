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


def cart_chassis(w=1.15, d=0.6, top=0.82, wheel_r=0.24):
    """木轮推车底盘：车斗 + 双轮 + 前腿 + 后推把。+Z 朝顾客。"""
    L.GROUP = 'cart'
    L.box('cart-body', (0, top - 0.16, 0), (w, 0.32, d), 'wood', 0.008, True)
    L.box('cart-apron', (0, top - 0.05, 0.06), (w + 0.06, 0.10, d + 0.06), 'iron', 0.006)
    L.box('cart-deck', (0, top - 0.005, 0), (w + 0.04, 0.05, d + 0.02), 'iron', 0.006)
    for sx in (-1, 1):
        # 轮子：轴向沿 X
        L.cyl('cart-wheel', (sx * (w / 2 + 0.02), wheel_r, 0.02), (sx * (w / 2 - 0.04), wheel_r, 0.02), wheel_r, 'wood', 12)
        L.cyl('cart-hub', (sx * (w / 2 + 0.05), wheel_r, 0.02), (sx * (w / 2 - 0.06), wheel_r, 0.02), 0.05, 'dark', 8)
    for sz in (d / 2 - 0.12,):
        for sx in (-1, 1):
            L.box('cart-leg', (sx * (w / 2 - 0.10), (top - 0.32 - wheel_r * 0.4) / 2 + wheel_r * 0.2, sz),
                  (0.05, top - 0.32 - wheel_r * 0.4 + wheel_r * 0.4, 0.05), 'wood', 0, True)
    for sx in (-1, 1):
        L.cyl('cart-handle', (sx * (w / 2 - 0.08), top - 0.18, -d / 2 - 0.02),
              (sx * (w / 2 - 0.08), top - 0.02, -d / 2 - 0.34), 0.022, 'wood', 6)
    L.cyl('cart-handle-bar', (-w / 2 + 0.08, top - 0.02, -d / 2 - 0.34), (w / 2 - 0.08, top - 0.02, -d / 2 - 0.34), 0.022, 'wood', 6)


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
    cart_chassis()
    L.GROUP = 'stove'
    # 煤炉 + 油锅（炉在车面左侧，炉口朝顾客）
    L.cyl('coal-stove-body', (-0.30, 0.82, 0.02), (-0.30, 1.14, 0.02), 0.17, 'brick', 12)
    L.cyl('coal-stove-rim', (-0.30, 1.14, 0.02), (-0.30, 1.19, 0.02), 0.19, 'dark', 12)
    L.box('coal-door', (-0.30, 0.90, 0.16), (0.12, 0.10, 0.04), 'dark', 0)
    L.cyl('fry-pot', (-0.30, 1.10, 0.02), (-0.30, 1.28, 0.02), 0.16, 'iron', 12)
    lathe('oil-surface', -0.30, 0.02, [(0.0, 1.25), (0.13, 1.25), (0.15, 1.22), (0.16, 1.10)], 'oil', 12)
    L.box('wire-rack', (0.28, 0.95, 0.10), (0.26, 0.26, 0.20), 'iron', 0, True)
    L.cyl('oil-bottle', (0.46, 0.86, 0.16), (0.46, 1.00, 0.16), 0.045, 'oil', 8)
    add_instances({'file': 'youdunzi.glb', 'lod': 'LOD0', 'at': [
        [-0.38, 1.29, 0.02], [-0.22, 1.29, 0.08], [0.28, 1.08, 0.10, 0.6], [0.24, 1.08, -0.04, 1.4]]})


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
    L.M['oil'] = L.mat('dark-oil', '3a2c14', .3)
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
    }
    L.finalize(R['id'], OUT, design)


main()
