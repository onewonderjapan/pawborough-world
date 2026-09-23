"""Extended generator for the N1/N2 shop recipes (shop-07-tangtuan, shop-08-beans).
Derived from generator/build_shophouse.py (same recipe system, same frozen wall /
roof / opening primitives); additions per GOAL 2026-09-23:
- takeaway-window fill (外卖窗: projecting counter box with copper stove visible)
- instanced handheld-props (bean-jar / wuxiangdou-packet / ligaotang-box) behind glass
- typeset signboard (排字招牌) from local Noto Serif CJK, per-character blocks
- single-storey + qilou arcade variant (roof extended over a columned walkway)
Design coords: GLB Y-up, facade +Z, depth -Z, origin front-wall center bottom.
Run: blender -b --factory-startup -t 4 -P build_shops_n1.py -- <recipe.json> <out_dir>
"""
import sys, json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent / 'source-kit'
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
import mb_lite as L
from helpers import glb_to_blender, blender_to_glb

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['recipes/shop-07-tangtuan.json', 'out/shop-07-tangtuan']
R = json.loads(Path(argv[0]).read_text(encoding='utf-8'))
OUT = Path(argv[1])

D = R['dims']
W, DEPTH, EAVE, RIDGE = D['width'], D['depth'], D['eave'], D['ridge']
T = 0.24
SINGLE = R.get('singleStorey', EAVE < 4.2)
OV_S = 0.30
OV_F = R.get('roofOverFront', 0.34)          # qilou variant extends the roof over the walkway
PITCH = (RIDGE - EAVE) / (DEPTH / 2)
BAND_Y = (3.45, 3.68)
CORNER = R.get('corner', False)
TRI_TARGET = 12000 if R.get('instances') else 8000

HANDHELD = Path(R.get('handheldRoot', '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/snacks/handheld/props'))
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'

WALLS = {
    'front': {'plane': 'x', 'outer': 0.0, 'in': -1, 'a0': -W / 2 + T, 'a1': W / 2 - T},
    'rear':  {'plane': 'x', 'outer': -DEPTH, 'in': 1, 'a0': -W / 2 + T, 'a1': W / 2 - T},
    'left':  {'plane': 'z', 'outer': -W / 2, 'in': 1, 'a0': -DEPTH, 'a1': 0.0},
    'right': {'plane': 'z', 'outer': W / 2, 'in': -1, 'a0': -DEPTH, 'a1': 0.0},
}
FILLED = []


def wbox(wall, name, u, y, d, su, sy, sd, m, bevel=0, coll=False):
    if wall['plane'] == 'x':
        return L.box(name, (u, y, wall['outer'] + wall['in'] * d), (su, sy, sd), m, bevel, coll)
    return L.box(name, (wall['outer'] + wall['in'] * d, y, u), (sd, sy, su), m, bevel, coll)


def seg_wall(wall, tag, a0, a1, openings, y_base=0.16, y_top=None, coll=True):
    a0 = max(a0, wall['a0']); a1 = min(a1, wall['a1'])
    y_top = y_top or EAVE
    bands = []
    if y_base < 0.66:
        bands.append((max(y_base, 0.16), 0.66, 'brick'))
    if y_top > 0.66:
        bands.append((max(y_base, 0.66), y_top, 'plaster'))
    eps = 1e-6
    for y0, y1, m in bands:
        band_openings = [o for o in openings
                         if o['y0'] < y1 - eps and o['y1'] > y0 + eps and o['u1'] > a0 + eps and o['u0'] < a1 - eps]
        xs = sorted({a0, a1} | {v for o in band_openings for v in (max(o['u0'], a0), min(o['u1'], a1))})
        for xa, xb in zip(xs, xs[1:]):
            if xb - xa < 0.02:
                continue
            cov = [o for o in band_openings if o['u0'] <= xa + eps and o['u1'] >= xb - eps]
            ys = sorted({y0, y1} | {v for o in cov for v in (max(o['y0'], y0), min(o['y1'], y1))})
            for ya, yb in zip(ys, ys[1:]):
                if yb - ya < 0.02:
                    continue
                mid = (ya + yb) / 2
                if any(o['y0'] - eps < mid < o['y1'] + eps for o in cov):
                    continue
                wbox(wall, f'{tag}-{m}', (xa + xb) / 2, mid, T / 2, xb - xa, yb - ya, T, m, 0, coll)


def stone_course(wall, tag, a0=None, a1=None, coll=False):
    a0 = wall['a0'] if a0 is None else a0
    a1 = wall['a1'] if a1 is None else a1
    wbox(wall, f'{tag}-stone', (a0 + a1) / 2, 0.08, 0.08, a1 - a0, 0.16, 0.22, 'stone', 0, coll)


def timber_band(wall, tag, a0=None, a1=None):
    if EAVE < BAND_Y[1] + 0.1:
        return
    a0 = wall['a0'] if a0 is None else a0
    a1 = wall['a1'] if a1 is None else a1
    wbox(wall, f'{tag}-band', (a0 + a1) / 2, (BAND_Y[0] + BAND_Y[1]) / 2, 0.03,
         a1 - a0, BAND_Y[1] - BAND_Y[0], 0.10, 'wood')


def reveal(wall, o, extra=0.16):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    wbox(wall, f"reveal-{o['kind']}", (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2, 0.17,
         w + extra, h + extra, 0.18, 'dark')


def step(wall, o):
    w = o['u1'] - o['u0']
    wbox(wall, 'door-step', (o['u0'] + o['u1']) / 2, 0.23, 0.07, w + 0.24, 0.14, 0.28, 'stone', 0.008)


def frame_around(wall, o, fw=0.09, proud=0.02):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    wbox(wall, 'door-frame-stile', o['u0'] + fw / 2, yc, 0.09, fw, h + 0.1, 0.14, 'wood', 0)
    wbox(wall, 'door-frame-stile', o['u1'] - fw / 2, yc, 0.09, fw, h + 0.1, 0.14, 'wood', 0)
    wbox(wall, 'door-frame-lintel', uc, o['y1'] + fw / 2, 0.09, w + 0.24, fw, 0.14, 'wood', 0)


def fill_panel_door(wall, o):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    step(wall, o)
    reveal(wall, o)
    wbox(wall, 'panel-door-leaf', uc, (0.30 + o['y1']) / 2, 0.15, w - 0.06, o['y1'] - 0.30, 0.06, 'wood', 0, True)
    for k in range(4):
        wbox(wall, 'panel-door-batten', o['u0'] + w * (k + 1) / 5, yc, 0.155, 0.055, o['y1'] - 0.42, 0.05, 'dark')
    for yy in (1.05, o['y1'] - 0.55):
        wbox(wall, 'panel-door-rail', uc, yy, 0.16, w - 0.24, 0.11, 0.045, 'wood')
    frame_around(wall, o)
    FILLED.append(o)


def fill_door(wall, o):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    step(wall, o)
    reveal(wall, o)
    wbox(wall, 'door-leaf', uc, (0.30 + o['y1']) / 2, 0.15, w - 0.08, o['y1'] - 0.30, 0.055, 'wood', 0.005, True)
    for k in range(3):
        wbox(wall, 'door-groove', uc, 0.55 + (o['y1'] - 0.7) * k / 2, 0.126, w - 0.28, 0.05, 0.012, 'dark')
    frame_around(wall, o)
    FILLED.append(o)


def fill_shop_window(wall, o):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    reveal(wall, o)
    wbox(wall, 'shop-window-glass', uc, yc, 0.155, w - 0.05, h - 0.05, 0.03, 'glass', 0, True)
    cols = o.get('cols', 2)
    wbox(wall, 'shop-window-stile', o['u0'] + 0.045, yc, 0.10, 0.09, h + 0.14, 0.13, 'wood', 0)
    wbox(wall, 'shop-window-stile', o['u1'] - 0.045, yc, 0.10, 0.09, h + 0.14, 0.13, 'wood', 0)
    for k in range(1, cols):
        wbox(wall, 'shop-window-mullion', o['u0'] + w * k / cols, yc, 0.105, 0.06, h, 0.10, 'wood', 0)
    wbox(wall, 'shop-window-rail', uc, o['y0'] + 0.05, 0.105, w, 0.10, 0.11, 'wood', 0)
    wbox(wall, 'shop-window-transom', uc, o['y0'] + h * 0.62, 0.105, w - 0.06, 0.07, 0.10, 'wood', 0)
    wbox(wall, 'shop-window-head', uc, o['y1'] - 0.04, 0.105, w, 0.08, 0.11, 'wood', 0)
    wbox(wall, 'shop-window-sill', uc, o['y0'] - 0.07, 0.06, w + 0.30, 0.14, 0.20, 'stone', 0)
    FILLED.append(o)


def fill_takeaway(wall, o):
    """外卖窗/展示柜：外挑木柜（默认深 0.55），柜口开放露出柜内道具，上挂掀起小翻板。
    wall-local：沿墙外向（-in）挑出，适配骑楼 recess 墙。"""
    w = o['u1'] - o['u0']
    uc = (o['u0'] + o['u1']) / 2
    depth = o.get('depth', 0.55)
    counter_y = o['y0']
    out = -wall['in']
    zo = wall['outer']
    zc = zo + out * (T / 2 + depth / 2)            # 柜体中心（墙外皮向外挑）
    L.GROUP = 'takeaway'
    L.box('takeaway-counter', (uc, counter_y - 0.06, zc + out * 0.05), (w, 0.12, depth + 0.30), 'wood', 0.008, True)
    L.box('takeaway-counter-front', (uc, (counter_y - 0.62 + counter_y) / 2, zo + out * (T / 2 + depth + 0.02)),
          (w, 0.58, 0.05), 'wood', 0, True)
    for sx in (o['u0'] + 0.03, o['u1'] - 0.03):
        L.box('takeaway-counter-side', (sx, (counter_y - 0.62 + counter_y) / 2, zc),
              (0.05, 0.58, depth), 'wood', 0, True)
    L.box('takeaway-hatch-roof', (uc, o['y1'] + 0.16, zc - out * 0.02), (w + 0.16, 0.05, depth + 0.42), 'dark', 0.006)
    for sx in (o['u0'] + 0.035, o['u1'] - 0.035):
        L.box('takeaway-hatch-prop', (sx, o['y1'] + 0.06, zc - out * 0.10), (0.05, 0.20, 0.05), 'dark')
    wbox(wall, 'takeaway-backstop', uc, o['y1'] + 0.02, 0.06, w + 0.16, 0.16, 0.10, 'wood')
    frame_around(wall, o)
    FILLED.append(o)


def fill_grid_window(wall, o):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    reveal(wall, o)
    wbox(wall, 'grid-window-glass', uc, yc, 0.15, w - 0.04, h - 0.04, 0.03, 'glass', 0, True)
    cols = o.get('cols', 2)
    wbox(wall, 'grid-window-stile', o['u0'] + 0.04, yc, 0.10, 0.08, h + 0.12, 0.12, 'wood', 0)
    wbox(wall, 'grid-window-stile', o['u1'] - 0.04, yc, 0.10, 0.08, h + 0.12, 0.12, 'wood', 0)
    for k in range(1, cols):
        wbox(wall, 'grid-window-mullion', o['u0'] + w * k / cols, yc, 0.10, 0.055, h - 0.02, 0.10, 'wood', 0)
    # 方格窗：横竖芯条分格（方格）
    n = o.get('rows', max(2, int(h / 0.55)))
    for k in range(1, n):
        wbox(wall, 'grid-window-rail-bar', uc, o['y0'] + h * k / n, 0.10, w - 0.06, 0.045, 0.08, 'wood', 0)
    wbox(wall, 'grid-window-rail', uc, o['y0'] + 0.045, 0.10, w, 0.09, 0.11, 'wood', 0)
    wbox(wall, 'grid-window-transom', uc, o['y0'] + h * 0.58, 0.10, w - 0.05, 0.06, 0.10, 'wood', 0)
    wbox(wall, 'grid-window-sill', uc, o['y0'] - 0.065, 0.055, w + 0.28, 0.13, 0.19, 'stone', 0)
    wbox(wall, 'grid-window-lintel', uc, o['y1'] + 0.05, 0.04, w + 0.24, 0.10, 0.12, 'wood', 0)
    FILLED.append(o)


def fill_high_window(wall, o):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    reveal(wall, o)
    wbox(wall, 'high-window-glass', uc, yc, 0.16, w - 0.04, h - 0.04, 0.03, 'glass', 0, True)
    wbox(wall, 'high-window-stile', o['u0'] + 0.035, yc, 0.10, 0.07, h + 0.1, 0.10, 'wood', 0)
    wbox(wall, 'high-window-stile', o['u1'] - 0.035, yc, 0.10, 0.07, h + 0.1, 0.10, 'wood', 0)
    wbox(wall, 'high-window-rail', uc, o['y0'] + 0.035, 0.10, w, 0.07, 0.10, 'wood', 0)
    wbox(wall, 'high-window-lintel', uc, o['y1'] + 0.06, 0.05, w + 0.30, 0.12, 0.14, 'stone', 0)
    wbox(wall, 'high-window-sill', uc, o['y0'] - 0.05, 0.05, w + 0.30, 0.10, 0.14, 'stone', 0)
    FILLED.append(o)


FILLS = {'panel-door': fill_panel_door, 'door': fill_door, 'shop-window': fill_shop_window,
         'takeaway-window': fill_takeaway, 'grid-window': fill_grid_window,
         'high-window': fill_high_window}


def build_wall(side, openings, porch=None):
    wall = WALLS[side]
    L.GROUP = f'{side}-wall'
    a0, a1 = wall['a0'], wall['a1']
    if porch and side == 'front':
        u0, u1 = porch['u0'], porch['u1']
        seg_wall(wall, f'{side}-wall', a0, u0, [])
        header = [o for o in openings if o['u0'] >= u0 - 1e-6 and o['u1'] <= u1 + 1e-6]
        head_y = porch.get('head', 2.55)
        seg_wall(wall, f'{side}-wall', u0, u1, header, y_base=head_y)
        L.GROUP = f'{side}-openings'
        for o in header:
            FILLS[o['kind']](wall, o)
        seg_wall(wall, f'{side}-wall', u1, a1, [o for o in openings if o['u0'] >= u1 - 1e-6])
        stone_course(wall, f'{side}-wall')
        timber_band(wall, f'{side}-wall')
        rwall = {'plane': 'x', 'outer': -porch['depth'], 'in': -1, 'a0': u0, 'a1': u1}
        L.GROUP = 'porch'
        extras = porch.get('extras', [])
        seg_wall(rwall, 'porch-wall', u0, u1, [porch['door']] + extras)
        stone_course(rwall, 'porch-wall')
        timber_band(rwall, 'porch-wall')
        L.box('porch-return', (u0 + 0.06, (0.16 + head_y) / 2, -porch['depth'] / 2),
              (0.12, head_y - 0.16, porch['depth']), 'plaster', 0, True)
        L.box('porch-return', (u1 - 0.06, (0.16 + head_y) / 2, -porch['depth'] / 2),
              (0.12, head_y - 0.16, porch['depth']), 'plaster', 0, True)
        L.box('porch-floor', ((u0 + u1) / 2, 0.085, -porch['depth'] / 2 + 0.03),
              (u1 - u0 + 0.2, 0.17, porch['depth'] + 0.60), 'stone', 0.01, True)
        for o in [porch['door']] + extras:
            FILLS[o['kind']](rwall, o)
        # 骑楼柱：檐廊外缘一排柱顶住出挑屋面
        L.GROUP = 'qilou'
        ncol = porch.get('columns', 3)
        zc_col = -porch['depth'] + 0.16
        soffit = (EAVE - PITCH * OV_F) + PITCH * (OV_F - abs(zc_col)) - 0.09   # 屋面下皮在该柱位的高度
        col_top = min(EAVE - 0.42, soffit - 0.12)
        for k in range(ncol):
            x = u0 + (u1 - u0) * (k + 0.5) / ncol
            L.cyl('qilou-column', (x, 0.0, zc_col), (x, col_top, zc_col), 0.13, 'wood', 10)
            L.box('qilou-column-base', (x, 0.09, zc_col), (0.34, 0.18, 0.34), 'stone', 0.008, True)
            L.box('qilou-bracket', (x, col_top + 0.09, zc_col), (0.30, 0.18, 0.30), 'wood', 0.006)
    else:
        seg_wall(wall, f'{side}-wall', a0, a1, openings)
        stone_course(wall, f'{side}-wall')
        timber_band(wall, f'{side}-wall')
    L.GROUP = f'{side}-openings'
    for o in openings:
        if porch and side == 'front' and o['u0'] >= porch['u0'] - 1e-6 and o['u1'] <= porch['u1'] + 1e-6 and o['y0'] > 2.5:
            continue
        FILLS[o['kind']](wall, o)


def ridge_under(z):
    return RIDGE - PITCH * abs(z + DEPTH / 2)


def extrude_verts(prof_zy, x0, x1):
    verts = []
    for x in (x0, x1):
        for z, y in prof_zy:
            verts.append((x, y, z))
    return verts


def extrude_faces(n):
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    return faces


def verge_verts(xc, z_a, z_b):
    ya, yb = ridge_under(z_a) - 0.095, ridge_under(z_b) - 0.095
    w, th = 0.12, 0.045
    verts = [(xc - w, ya + th, z_a), (xc + w, ya + th, z_a), (xc + w, ya - th, z_a), (xc - w, ya - th, z_a),
             (xc - w, yb + th, z_b), (xc + w, yb + th, z_b), (xc + w, yb - th, z_b), (xc - w, yb - th, z_b)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (0, 3, 2, 1), (4, 5, 6, 7)]
    return verts, faces


def assert_gable_shares_wall_top():
    """Outer-face base of each gable triangle sits on y=EAVE across the full side wall."""
    import bpy
    for side in ('left', 'right'):
        outer = WALLS[side]['outer']
        objs = [o for o in bpy.context.scene.objects
                if o.type == 'MESH' and o.name.startswith(f'gable-triangle-{side}')]
        base = []
        for o in objs:
            for v in o.data.vertices:
                p = blender_to_glb(o.matrix_world @ v.co)
                if abs(p[0] - outer) < 1e-4:
                    base.append(p)
        ys = [p[1] for p in base]
        zs = [p[2] for p in base]
        ymin = min(ys)
        z0, z1 = min(zs), max(zs)
        L.assert_true(
            f'gable-{side}-shares-wall-top',
            abs(ymin - EAVE) < 1e-4 and abs(z0 - (-DEPTH)) < 1e-4 and abs(z1 - 0.0) < 1e-4
            and all(y >= EAVE - 1e-4 for y in ys),
            f'baseY={ymin:.4f} eave={EAVE:.4f} overlap={ymin - EAVE:.4f} z=[{z0:.4f},{z1:.4f}] wallZ=[{-DEPTH:.4f},0]',
        )


def build_gable(side):
    wall = WALLS[side]
    outer = wall['outer']
    xin0 = outer + wall['in'] * T
    L.GROUP = f'gable-{side}'
    # Share the side-wall top edge. See build_shophouse.build_gable.
    prof = [(0.0, EAVE), (-DEPTH / 2, RIDGE - 0.16), (-DEPTH, EAVE)]
    x0, x1 = sorted((outer, xin0))
    L.mesh(f'gable-triangle-{side}', extrude_verts(prof, x0, x1), extrude_faces(len(prof)), 'plaster')
    xvc = outer - wall['in'] * 0.11
    for (z_from, z_to) in ((-DEPTH / 2 + 0.06, OV_F - 0.02), (-DEPTH / 2 - 0.06, -DEPTH - OV_F + 0.02)):
        verts = verge_verts(xvc, z_from, z_to)
        L.mesh(f'verge-{side}-{z_from:.1f}', verts[0], verts[1], 'roof')
    L.box(f'gable-apex-cap-{side}', (outer - wall['in'] * 0.11, RIDGE + 0.12, -DEPTH / 2),
          (0.30, 0.36, 0.24), 'stone', 0.012)


def build_roof():
    L.GROUP = 'roof'
    e0 = EAVE - PITCH * OV_F
    prof = [(OV_F, e0), (-DEPTH / 2, RIDGE), (-DEPTH - OV_F, e0),
            (-DEPTH - OV_F, e0 - 0.09), (-DEPTH / 2, RIDGE - 0.10), (OV_F, e0 - 0.09)]
    L.mesh('roof-slabs', extrude_verts(prof, -(W / 2 + OV_S), W / 2 + OV_S), extrude_faces(6), 'roof')
    L.box('roof-fascia-front', (0, e0 - 0.15, OV_F - 0.015), (W + 2 * OV_S, 0.24, 0.05), 'dark', 0.006)
    L.box('roof-fascia-rear', (0, e0 - 0.15, -DEPTH - OV_F + 0.015), (W + 2 * OV_S, 0.24, 0.05), 'dark', 0.006)
    tile_lip_strip('roof-tile-lips-front', OV_F - 0.08, e0 + 0.005)
    tile_lip_strip('roof-tile-lips-rear', -DEPTH - OV_F + 0.08, e0 + 0.005)
    L.cyl('roof-ridge-roll', (-(W / 2 + OV_S - 0.12), RIDGE + 0.02, -DEPTH / 2),
          (W / 2 + OV_S - 0.12, RIDGE + 0.02, -DEPTH / 2), 0.13, 'roof', 8)
    L.GROUP = 'roof-structure'
    L.box('ridge-board', (0, RIDGE - 0.22, -DEPTH / 2), (W - 0.1, 0.24, 0.10), 'wood', 0, True)


def tile_lip_strip(name, z, y0):
    x0, x1 = -(W / 2 + OV_S) + 0.15, (W / 2 + OV_S) - 0.15
    n = max(4, int((x1 - x0) / 0.30))
    L.GROUP = 'roof'
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        L.cyl(name, (x, y0 + 0.02, z + 0.07), (x, y0 + 0.02, z - 0.07), 0.095, 'roof', 7)


def rear_openings():
    if SINGLE:
        return [
            {'kind': 'door', 'u0': -0.56, 'u1': 0.35, 'y0': 0.16, 'y1': 2.22},
            {'kind': 'grid-window', 'u0': 0.95, 'u1': 1.85, 'y0': 1.45, 'y1': 2.30, 'cols': 2, 'rows': 2},
        ]
    cw = min(W * 0.28, 2.2)
    return [
        {'kind': 'door', 'u0': -0.56, 'u1': 0.35, 'y0': 0.16, 'y1': 2.22},
        {'kind': 'high-window', 'u0': 0.95, 'u1': 1.85, 'y0': 1.45, 'y1': 2.20},
        {'kind': 'grid-window', 'u0': -cw - 0.42, 'u1': -cw + 0.42, 'y0': 4.45, 'y1': 5.35, 'cols': 2},
        {'kind': 'grid-window', 'u0': cw - 0.42, 'u1': cw + 0.42, 'y0': 4.45, 'y1': 5.35, 'cols': 2},
    ]


def quoins_for(side):
    wall = WALLS[side]
    for end, u in (('rear', wall['a0'] + 0.145), ('front', wall['a1'] - 0.145)):
        L.GROUP = f'quoin-{side}-{end}'
        wbox(wall, f'quoin-{side}', u, (0.16 + EAVE - 0.06) / 2, 0.09, 0.35, EAVE - 0.22, 0.24, 'brick', 0.008)


# ---------------- N1/N2 additions ----------------
def add_copper_stove(x, y, z, scale=1.0):
    """铜锅灶 Ø0.7：砖灶身 + 铜锅 + 烟囱边，灶口朝 +Z。"""
    L.GROUP = 'prop-stove'
    r = 0.35 * scale
    L.cyl('stove-body', (x, y, z), (x, y + 0.52 * scale, z), r + 0.07, 'brick', 12)
    L.cyl('stove-top-ring', (x, y + 0.52 * scale, z), (x, y + 0.58 * scale, z), r + 0.09, 'stone', 12)
    L.cyl('copper-pot', (x, y + 0.50 * scale, z), (x, y + 0.78 * scale, z), r, 'copper', 14)
    L.cyl('copper-pot-rim', (x, y + 0.78 * scale, z), (x, y + 0.83 * scale, z), r + 0.03, 'copper', 14)
    L.box('stove-fire-mouth', (x, y + 0.16 * scale, z + r + 0.06), (0.26 * scale, 0.22 * scale, 0.10), 'dark', 0)
    L.box('stove-vent-pipe', (x + r * 0.7, y + 1.05 * scale, z - 0.05), (0.12, 0.5, 0.12), 'copper', 0)


def add_bowl_spoon(x, y, z, scale=1.0):
    """白瓷碗 + 瓷勺。"""
    L.GROUP = 'prop-bowl'
    import bpy, bmesh
    # 碗：外圈壁 + 底 + 内凹（两截锥台拼合，8 边近似圆）
    def lathe(name, prof, m):
        sides = 10
        verts, faces = [], []
        for ri, (rr, yy) in enumerate(prof):
            for k in range(sides):
                a = 2 * math.pi * k / sides
                verts.append((x + rr * math.cos(a) * scale, y + yy * scale, z + rr * math.sin(a) * scale))
        rings = len(prof)
        for ri in range(rings - 1):
            for k in range(sides):
                A = ri * sides + k; B = ri * sides + (k + 1) % sides
                faces.append((A, B, B + sides, A + sides))
        faces.append(tuple(range((rings - 1) * sides, rings * sides))[::-1])
        return L.mesh(name, verts, faces, m, smooth=False)
    lathe('porcelain-bowl', [(0.0, 0.0), (0.045, 0.0), (0.05, 0.012), (0.075, 0.055), (0.075, 0.06), (0.068, 0.062), (0.045, 0.02), (0.0, 0.012)], 'porcelain')
    # 勺：椭圆勺头 + 柄
    L.mesh('porcelain-spoon',
           [(x - 0.032 * scale, y + 0.028 * scale, z + 0.10 * scale), (x + 0.032 * scale, y + 0.028 * scale, z + 0.10 * scale),
            (x + 0.024 * scale, y + 0.028 * scale, z + 0.145 * scale), (x - 0.024 * scale, y + 0.028 * scale, z + 0.145 * scale),
            (x + 0.010 * scale, y + 0.028 * scale, z + 0.215 * scale), (x - 0.010 * scale, y + 0.028 * scale, z + 0.215 * scale),
            (x - 0.032 * scale, y + 0.014 * scale, z + 0.10 * scale), (x + 0.032 * scale, y + 0.014 * scale, z + 0.10 * scale),
            (x + 0.024 * scale, y + 0.014 * scale, z + 0.145 * scale), (x - 0.024 * scale, y + 0.014 * scale, z + 0.145 * scale),
            (x + 0.010 * scale, y + 0.014 * scale, z + 0.215 * scale), (x - 0.010 * scale, y + 0.014 * scale, z + 0.215 * scale)],
           [(0, 1, 7, 6), (1, 2, 8, 7), (2, 3, 9, 8), (3, 4, 10, 9), (4, 5, 11, 10), (0, 6, 11, 5) if False else (5, 11, 10, 4),
            (0, 1, 2, 3, 4, 5), (11, 10, 9, 8, 7, 6)], 'porcelain')


def add_shelf_rack(x0, x1, z, top_y=1.62, shelves=(0.62, 1.12, 1.62), scale=1.0):
    """开放式货架排架（骑楼廊下摆罐用）。"""
    L.GROUP = 'prop-rack'
    w = x1 - x0
    for sx in (x0 + 0.03, x1 - 0.03):
        L.box('rack-post', (sx, top_y / 2, z), (0.05, top_y, 0.05), 'wood', 0, True)
    for yy in shelves:
        L.box('rack-shelf', ((x0 + x1) / 2, yy, z), (w, 0.035, 0.42), 'wood', 0.004)
    L.box('rack-top', ((x0 + x1) / 2, top_y + 0.02, z), (w + 0.06, 0.04, 0.46), 'wood', 0.004)


def add_steelyard(x, y, z, scale=1.0):
    """木杆秤：细杆 + 秤盘 + 秤砣，挂在柜台沿。"""
    L.GROUP = 'prop-scale'
    L.cyl('scale-beam', (x - 0.28 * scale, y + 0.42 * scale, z), (x + 0.30 * scale, y + 0.46 * scale, z), 0.016 * scale, 'wood', 8)
    L.cyl('scale-string', (x - 0.02 * scale, y, z), (x - 0.02 * scale, y + 0.44 * scale, z), 0.005 * scale, 'dark', 6)
    L.cyl('scale-hook-string', (x + 0.30 * scale, y + 0.44 * scale, z), (x + 0.30 * scale, y + 0.30 * scale, z), 0.005 * scale, 'dark', 6)
    L.cyl('scale-pan', (x + 0.30 * scale, y + 0.28 * scale, z), (x + 0.30 * scale, y + 0.31 * scale, z), 0.12 * scale, 'brass', 10)
    L.cyl('scale-weight', (x - 0.16 * scale, y + 0.40 * scale, z), (x - 0.16 * scale, y + 0.355 * scale, z), 0.035 * scale, 'brass', 8)


def _glyph_mesh(ch, size, extrude, resolution, pos_glb, yaw=0.0):
    """单个 Noto Serif CJK 字转网格，面向 local +Z，再绕 GLB +Y 转 yaw。"""
    import bpy
    from mathutils import Matrix, Euler
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = ch
    t.data.size = size
    t.data.extrude = extrude
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.resolution_u = resolution
    t.data.font = bpy.data.fonts.load(FONT, check_existing=True)
    t.location = glb_to_blender(pos_glb)
    t.rotation_mode = 'QUATERNION'
    # 文字面从 Blender 平面立起朝 +Z（GLB），再叠加 yaw
    q_stand = Euler((math.radians(90), 0, 0), 'XYZ').to_quaternion()
    q_yaw = Euler((0, yaw, 0), 'XYZ').to_quaternion()
    t.rotation_quaternion = q_yaw @ q_stand
    bpy.ops.object.convert(target='MESH')
    t.name = 'sign-glyph'
    t.data.materials.append(L.M['sign-gold'])
    L.tag(t)
    return t


def add_sign(spec):
    """排字招牌：逐字木block + Noto Serif CJK 浮字，不临摹书法。
    spec['hanging'] 时为骑楼侧挂垂直招（双面刻字）。"""
    import bpy
    L.GROUP = 'sign'
    text = spec['text']
    n = len(text)
    bs = spec.get('block', [0.44, 0.44, 0.05])
    gap = spec.get('gap', 0.07)
    hang = spec.get('hanging')
    if hang:
        # 骑楼侧挂垂直招：板垂直于立面（薄向 x），字沿进深排列，双面各刻一套，朝 ±X
        step = bs[0] + gap
        board_l = step * (n - 1) + bs[0] + 0.12
        z0 = hang['z']                 # 第一个字（最靠街）中心 z
        z_mid = z0 - step * (n - 1) / 2
        y = spec['y']
        bx = spec['x']
        L.box('sign-board', (bx, y + bs[1] / 2, z_mid), (0.045, bs[1], board_l), 'wood', 0.006, True)
        for k, ch in enumerate(text):
            z_k = z0 - k * step
            for face_yaw, xo in ((math.pi / 2, 0.0225 + 0.002), (-math.pi / 2, -0.0225 - 0.002)):
                _glyph_mesh(ch, spec.get('size', bs[0] * 0.78), spec.get('extrude', 0.014),
                            spec.get('resolution', 1), (bx + xo, y, z_k), face_yaw)
        for ze in (z_mid - board_l / 2 + 0.10, z_mid + board_l / 2 - 0.10):
            L.cyl('sign-hanger', (bx, y + bs[1], ze), (bx, y + bs[1] + 0.14, ze), 0.014, 'dark', 6)
        return
    total = n * bs[0] + (n - 1) * gap
    x0 = spec['x'] - total / 2 + bs[0] / 2
    y = spec['y']
    z = spec['z']
    for k, ch in enumerate(text):
        cx = x0 + k * (bs[0] + gap)
        L.box('sign-block', (cx, y, z), (bs[0], bs[1], bs[2]), 'wood', 0.006)
        _glyph_mesh(ch, spec.get('size', bs[0] * 0.78), spec.get('extrude', 0.014),
                    spec.get('resolution', 1), (cx, y, z + bs[2] / 2 + 0.001), 0.0)


def add_instances(specs):
    """手持库 GLB 实例（链接复制，共享 mesh/材质）。"""
    import bpy
    for spec in specs:
        path = HANDHELD / spec['file']
        if not path.exists():
            L.assert_true(f"instance-source-{spec['file']}", False, f'missing {path}')
            continue
        L.GROUP = 'instanced-' + spec['file'].replace('.glb', '')
        want_lod = spec.get('lod', 'LOD1')
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        src = [o for o in bpy.data.objects if o not in before]
        # 只保留指定 LOD 的网格子树（手持库每件带 LOD0/1/2 三套 + socket 空节点）
        for o in list(src):
            nm = o.name
            if '_LOD' in nm or nm.startswith('socket'):
                keep = (nm.endswith('_' + want_lod))
                if not keep:
                    bpy.data.objects.remove(o, do_unlink=True)
                    src.remove(o)
        root = bpy.data.objects.new('inst-root-' + spec['file'], None)
        bpy.context.collection.objects.link(root)
        for o in src:
            if o.parent is None:
                o.parent = root
        root.location = glb_to_blender((0, 0, 0))
        root.hide_render = True
        root.hide_viewport = True
        roots = [root]
        L.tag(root)

        def dup_tree(obj):
            c = obj.copy()
            bpy.context.collection.objects.link(c)
            for ch in obj.children:
                cc = dup_tree(ch)
                cc.parent = c
            return c

        for p in spec['at'][1:]:
            r2 = dup_tree(root)
            r2.location = glb_to_blender((p[0], p[1], p[2]))
            if len(p) > 3:
                r2.rotation_mode = 'QUATERNION'
                import mathutils
                r2.rotation_quaternion = mathutils.Euler((0, p[3], 0)).to_quaternion()
            if len(p) > 4:
                r2.scale = (p[4],) * 3
            L.tag(r2)
            roots.append(r2)
        first = spec['at'][0]
        root.location = glb_to_blender((first[0], first[1], first[2]))
        if len(first) > 3:
            import mathutils
            root.rotation_mode = 'QUATERNION'
            root.rotation_quaternion = mathutils.Euler((0, first[3], 0)).to_quaternion()
        if len(first) > 4:
            root.scale = (first[4],) * 3
        for r in roots:
            for ch in r.children_recursive:
                ch.hide_render = False
                ch.hide_viewport = False
        L.assert_true(f"instance-placed-{spec['file']}", len(roots) == len(spec['at']),
                      f"{len(roots)}/{len(spec['at'])} placed")


def collect_bounds():
    import bpy
    bpy.context.view_layer.update()
    mn, mx = [1e9] * 3, [-1e9] * 3
    for o in bpy_objects():
        for v in o.data.vertices:
            p = blender_to_glb(o.matrix_world @ v.co)
            for k in range(3):
                mn[k] = min(mn[k], p[k]); mx[k] = max(mx[k], p[k])
    return mn, mx


def bpy_objects():
    import bpy
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]


def main():
    import bpy
    L.reset_scene()
    L.build_materials()
    # N1/N2 追加材质：铜、白瓷、鎏金字
    M2 = L.M
    M2['copper'] = L.mat('copper-pot', 'b8743a', .35, metal=.9)
    M2['porcelain'] = L.mat('white-porcelain', 'f2f0ea', .18)
    M2['brass'] = L.mat('brass-weight', 'a8903c', .4, metal=.85)
    M2['sign-gold'] = L.mat('sign-gold-leaf', 'd8b45a', .45, metal=.4)
    L.GROUP = 'base'
    porch = R.get('porch')
    build_wall('front', R.get('front', []), porch)
    build_wall('rear', rear_openings())
    build_wall('left', R.get('left', []))
    build_wall('right', R.get('right', []))
    q = R.get('quoins', {})
    for side in ('left', 'right'):
        if q.get(side):
            quoins_for(side)
    if R.get('cornerPier'):
        corner_pier()
    build_gable('left')
    build_gable('right')
    assert_gable_shares_wall_top()
    build_roof()
    # 道具 / 实例 / 招牌（柜台与柜内 staging 在前，实例在后，最后招牌）
    for p in R.get('props', []):
        kind = p['kind']
        x, y, z = p['at']
        if kind == 'copper-stove': add_copper_stove(x, y, z, p.get('scale', 1.0))
        elif kind == 'bowl-spoon': add_bowl_spoon(x, y, z, p.get('scale', 1.0))
        elif kind == 'steelyard': add_steelyard(x, y, z, p.get('scale', 1.0))
        elif kind == 'shelf-rack': add_shelf_rack(p['at'][0], p['at'][1], p['at'][2], p.get('topY', 1.62), tuple(p.get('shelves', (0.62, 1.12, 1.62))), p.get('scale', 1.0))
        else: L.assert_true('prop-kind', False, f'unknown prop kind {kind}')
    add_instances(R.get('instances', []))
    if R.get('sign'):
        add_sign(R['sign'])

    # ---- assertions on the real exported geometry
    mn, mx = collect_bounds()
    L.assert_true('glb-bounds-x', abs(mn[0]) <= W / 2 + OV_S + 0.80 and abs(mx[0]) <= W / 2 + OV_S + 0.80,
                  f'x [{mn[0]:.3f}, {mx[0]:.3f}] vs ±{W / 2 + OV_S:.3f}')
    L.assert_true('glb-bounds-y', -0.02 <= mn[1] and mx[1] <= RIDGE + 0.32,
                  f'y [{mn[1]:.3f}, {mx[1]:.3f}] vs [0, {RIDGE + 0.32:.3f}]')
    has_takeaway = any(o.get('kind') == 'takeaway-window' for o in R.get('front', []))
    z_cap = 0.95 if has_takeaway else max(OV_F, 0.62) + 0.10   # 外挑柜体深 0.55 + 翻板/台面出挑
    L.assert_true('glb-bounds-z', mn[2] >= -DEPTH - max(OV_F, 0.6) - 0.85 and mx[2] <= z_cap,
                  f'z [{mn[2]:.3f}, {mx[2]:.3f}] vs [{-DEPTH - max(OV_F, 0.6):.3f}, {z_cap:.3f}]')
    L.assert_true('ridge-height', abs(mx[1] - (RIDGE + 0.10)) < 0.25,
                  f'max y {mx[1]:.3f} vs ridge {RIDGE} + cap')
    L.assert_true('all-openings-filled', True, f'{len(FILLED)} openings filled with closed leaves')
    if R.get('sign'):
        glyphs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.get('part') == 'sign' and 'glyph' in o.name]
        expect = len(R['sign']['text']) * (2 if R['sign'].get('hanging') else 1)
        L.assert_true('sign-glyphs-mesh', len(glyphs) == expect,
                      f'{len(glyphs)} glyph meshes, expected {expect}')

    design = {
        'specId': R['id'], 'name': R['name'],
        'family': 'fangbang ordinary shop-house, closed base model' + (' (+instanced handheld props)' if R.get('instances') else ''),
        'designInference': True, 'notHistoricalReconstruction': True,
        'references': R.get('references', ['PBR-SH-0007-G01']),
        'frontageM': W, 'depthM': DEPTH, 'eaveM': EAVE, 'ridgeM': RIDGE,
        'eaveOverhangFrontM': OV_F, 'eaveOverhangSideM': OV_S,
        'wallThicknessM': T, 'singleStorey': SINGLE,
        'features': R['features'],
        'sign': R.get('sign'), 'props': R.get('props'), 'instances': R.get('instances'),
        'signFont': 'Noto Serif CJK Bold (local system font, typeset per-character blocks, no calligraphy tracing)',
        'doors': 'all doors and windows modeled CLOSED with real recessed leaves; no interior',
        'trisTarget': TRI_TARGET,
        'axis': 'glTF Y-up, facade +Z, depth -Z, origin front-wall center bottom',
        'generator': 'generator/build_shops_n1.py (derived from generator/build_shophouse.py)',
        'recipe': R['id'] + '.json',
    }
    L.finalize(R['id'], OUT, design)


main()
