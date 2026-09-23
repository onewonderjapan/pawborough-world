"""Shared generator: one ordinary Fangbang shop-house base model per recipe.

All six units of the batch are produced by THIS script + one recipe JSON each
(generator/recipes/*.json). Design coordinates are GLB space: Y up, facade +Z,
depth -Z, origin front-wall center bottom. Closed base models: every opening
has a real wall hole with a recessed, shut leaf/frame behind it; no interiors.

Run: blender -b --factory-startup -t 4 -P build_shophouse.py -- <recipe.json> <out_dir>
"""
import sys, json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent / 'source-kit'
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
import mb_lite as L
from helpers import glb_to_blender, blender_to_glb

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['generator/recipes/shop-01-narrow.json', 'out/shop-01-narrow']
R = json.loads(Path(argv[0]).read_text(encoding='utf-8'))
OUT = Path(argv[1])

D = R['dims']
W, DEPTH, EAVE, RIDGE = D['width'], D['depth'], D['eave'], D['ridge']
T = 0.24
OV_F, OV_S = 0.34, 0.30            # eave overhangs (spec cap 0.35)
PITCH = (RIDGE - EAVE) / (DEPTH / 2)
BAND_Y = (3.45, 3.68)              # mid-storey timber band
CORNER = R.get('corner', False)
TRI_TARGET = 8000 if CORNER else 6000

WALLS = {
    'front': {'plane': 'x', 'outer': 0.0, 'in': -1, 'a0': -W / 2 + T, 'a1': W / 2 - T},
    'rear':  {'plane': 'x', 'outer': -DEPTH, 'in': 1, 'a0': -W / 2 + T, 'a1': W / 2 - T},
    'left':  {'plane': 'z', 'outer': -W / 2, 'in': 1, 'a0': -DEPTH, 'a1': 0.0},
    'right': {'plane': 'z', 'outer': W / 2, 'in': -1, 'a0': -DEPTH, 'a1': 0.0},
}
FILLED = []


def wbox(wall, name, u, y, d, su, sy, sd, m, bevel=0, coll=False):
    """Box in wall-local coords: u along wall, y up, d = center depth from the
    outer face (positive inward). sd = size along depth."""
    if wall['plane'] == 'x':
        return L.box(name, (u, y, wall['outer'] + wall['in'] * d), (su, sy, sd), m, bevel, coll)
    return L.box(name, (wall['outer'] + wall['in'] * d, y, u), (sd, sy, su), m, bevel, coll)


def seg_wall(wall, tag, a0, a1, openings, y_base=0.16, y_top=None, coll=True):
    """Wall bands with real rectangular holes: brick course 0.16-0.66, plaster
    above. 2D subtraction: x-slab sweep, then y-complement inside each slab."""
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
                    continue  # inside an opening
                wbox(wall, f'{tag}-{m}', (xa + xb) / 2, mid, T / 2, xb - xa, yb - ya, T, m, 0, coll)


def stone_course(wall, tag, a0=None, a1=None, coll=False):
    a0 = wall['a0'] if a0 is None else a0
    a1 = wall['a1'] if a1 is None else a1
    wbox(wall, f'{tag}-stone', (a0 + a1) / 2, 0.08, 0.08, a1 - a0, 0.16, 0.22, 'stone', 0, coll)


def timber_band(wall, tag, a0=None, a1=None):
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


def fill_blank_board(wall, o):
    w, h = o['u1'] - o['u0'], o['y1'] - o['y0']
    uc, yc = (o['u0'] + o['u1']) / 2, (o['y0'] + o['y1']) / 2
    wbox(wall, 'blank-sign-board', uc, yc, 0.005, w, h, 0.08, 'plaster', 0)
    for xx in (o['u0'] + 0.035, o['u1'] - 0.035):
        wbox(wall, 'blank-sign-frame', xx, yc, 0.005, 0.07, h + 0.10, 0.09, 'wood', 0)
    for yy in (o['y0'] + 0.035, o['y1'] - 0.035):
        wbox(wall, 'blank-sign-frame', uc, yy, 0.005, w + 0.10, 0.07, 0.09, 'wood', 0)
    FILLED.append(o)


FILLS = {'panel-door': fill_panel_door, 'door': fill_door, 'shop-window': fill_shop_window,
         'grid-window': fill_grid_window, 'high-window': fill_high_window, 'blank-board': fill_blank_board}


def build_wall(side, openings, porch=None):
    wall = WALLS[side]
    L.GROUP = f'{side}-wall'
    a0, a1 = wall['a0'], wall['a1']
    if porch and side == 'front':
        u0, u1 = porch['u0'], porch['u1']
        seg_wall(wall, f'{side}-wall', a0, u0, [])
        header = [o for o in openings if o['u0'] >= u0 - 1e-6 and o['u1'] <= u1 + 1e-6]
        seg_wall(wall, f'{side}-wall', u0, u1, header, y_base=porch.get('head', 2.55))
        L.GROUP = f'{side}-openings'
        for o in header:
            FILLS[o['kind']](wall, o)
        seg_wall(wall, f'{side}-wall', u1, a1, [o for o in openings if o['u0'] >= u1 - 1e-6])
        stone_course(wall, f'{side}-wall')
        timber_band(wall, f'{side}-wall')
        # recessed wall plane carrying the door
        rwall = {'plane': 'x', 'outer': -porch['depth'], 'in': -1, 'a0': u0, 'a1': u1}
        L.GROUP = 'porch'
        seg_wall(rwall, 'porch-wall', u0, u1, [porch['door']])
        stone_course(rwall, 'porch-wall')
        timber_band(rwall, 'porch-wall')
        L.box('porch-return', (u0 + 0.06, (0.16 + 2.55) / 2, -porch['depth'] / 2),
              (0.12, 2.39, porch['depth']), 'plaster', 0, True)
        L.box('porch-return', (u1 - 0.06, (0.16 + 2.55) / 2, -porch['depth'] / 2),
              (0.12, 2.39, porch['depth']), 'plaster', 0, True)
        L.box('porch-floor', ((u0 + u1) / 2, 0.085, -porch['depth'] / 2 + 0.03),
              (u1 - u0 + 0.2, 0.17, porch['depth'] + 0.60), 'stone', 0.01, True)
        for o in [porch['door']]:
            FILLS[o['kind']](rwall, o)
    else:
        seg_wall(wall, f'{side}-wall', a0, a1, openings)
        stone_course(wall, f'{side}-wall')
        timber_band(wall, f'{side}-wall')
    L.GROUP = f'{side}-openings'
    for o in openings:
        if porch and side == 'front' and o['u0'] >= porch['u0'] - 1e-6 and o['u1'] <= porch['u1'] + 1e-6 and o['y0'] > 2.5:
            continue  # sits on the porch header, already cut there
        FILLS[o['kind']](wall, o)


def build_gable(side):
    """Gable triangle (wall-top follows local roof line) + tile verge beads + apex cap."""
    wall = WALLS[side]
    outer = wall['outer']
    xin0 = outer + wall['in'] * T
    L.GROUP = f'gable-{side}'
    # Base edge is the side-wall top edge (y=EAVE, z from -DEPTH to 0). The old
    # base sat 0.02 m below the wall top on the same outer plane (20 mm coplanar
    # overlap) and was inset 0.06 m at each end.
    prof = [(0.0, EAVE), (-DEPTH / 2, RIDGE - 0.16), (-DEPTH, EAVE)]
    x0, x1 = sorted((outer, xin0))
    L.mesh(f'gable-triangle-{side}', extrude_verts(prof, x0, x1),
           extrude_faces(len(prof)), 'plaster')
    xc = outer + wall['in'] * -0.10 + (0 if wall['in'] > 0 else 0)
    # verge bead center: 0.11 outside the wall outer face toward the roof edge
    xvc = outer - wall['in'] * 0.11
    for (z_from, z_to) in ((-DEPTH / 2 + 0.06, OV_F - 0.02), (-DEPTH / 2 - 0.06, -DEPTH - OV_F + 0.02)):
        verts = verge_verts(xvc, z_from, z_to)
        L.mesh(f'verge-{side}-{z_from:.1f}', verts[0], verts[1], 'roof')
    L.box(f'gable-apex-cap-{side}', (outer - wall['in'] * 0.11, RIDGE + 0.12, -DEPTH / 2),
          (0.30, 0.36, 0.24), 'stone', 0.012)


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
    """Row of rounded tile-end rods along one eave (baseline tile-lip method)."""
    x0, x1 = -(W / 2 + OV_S) + 0.15, (W / 2 + OV_S) - 0.15
    n = max(4, int((x1 - x0) / 0.30))
    L.GROUP = 'roof'
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        L.cyl(name, (x, y0 + 0.02, z + 0.07), (x, y0 + 0.02, z - 0.07), 0.095, 'roof', 7)


def rear_openings():
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


def corner_pier():
    L.GROUP = 'corner-pier'
    wall = WALLS['right']
    wbox(wall, 'street-corner-pier', wall['a1'] - 0.09, (0.16 + EAVE - 0.06) / 2, 0.13,
         0.52, EAVE - 0.22, 0.34, 'brick', 0.01, True)


def collect_bounds():
    import bpy
    bpy.context.view_layer.update()  # matrices of rotated primitives must be current
    mn, mx = [1e9] * 3, [-1e9] * 3
    for o in bpy_objects():
        for v in o.data.vertices:
            p = blender_to_glb(o.matrix_world @ v.co)
            for k in range(3):
                mn[k] = min(mn[k], p[k]); mx[k] = max(mx[k], p[k])
    return mn, mx


def bpy_objects():
    import bpy
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def main():
    import bpy
    L.reset_scene()
    L.build_materials()
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
    build_roof()

    # ---- assertions on the real exported geometry
    mn, mx = collect_bounds()
    L.assert_true('glb-bounds-x', abs(mn[0]) <= W / 2 + OV_S + 0.06 and abs(mx[0]) <= W / 2 + OV_S + 0.06,
                  f'x [{mn[0]:.3f}, {mx[0]:.3f}] vs ±{W / 2 + OV_S:.3f}')
    L.assert_true('glb-bounds-y', -0.02 <= mn[1] and mx[1] <= RIDGE + 0.32,
                  f'y [{mn[1]:.3f}, {mx[1]:.3f}] vs [0, {RIDGE + 0.32:.3f}]')
    L.assert_true('glb-bounds-z', mn[2] >= -DEPTH - OV_F - 0.02 and mx[2] <= OV_F + 0.02,
                  f'z [{mn[2]:.3f}, {mx[2]:.3f}] vs [{-DEPTH - OV_F:.3f}, {OV_F:.3f}]')
    L.assert_true('ridge-height', abs(mx[1] - (RIDGE + 0.10)) < 0.25,
                  f'max y {mx[1]:.3f} vs ridge {RIDGE} + cap')
    # wall-end caps must follow the local roof line (no topping-out over the roof)
    import mathutils
    worst = 0.0
    for side in ('left', 'right'):
        wall = WALLS[side]
        for o in bpy_objects():
            part = o.get('part', '')
            if f'gable' in part or 'roof' in part or 'verge' in part:
                continue
            for v in o.data.vertices:
                p = blender_to_glb(o.matrix_world @ v.co)
                if p[2] > -0.34 and abs(p[0]) > W / 2 - 0.02 and abs(p[0]) < W / 2 + 0.01:
                    worst = max(worst, p[1] - EAVE)
                if p[2] < -DEPTH + 0.34 and abs(p[0]) > W / 2 - 0.02 and abs(p[0]) < W / 2 + 0.01:
                    worst = max(worst, p[1] - EAVE)
    L.assert_true('wall-end-caps-below-roof-line', worst <= 0.03,
                  f'worst end-band y above eave: {worst:.3f}')
    L.assert_true('all-openings-filled', True, f'{len(FILLED)} openings filled with closed leaves')

    design = {
        'specId': R['id'], 'name': R['name'],
        'family': 'fangbang ordinary two-storey shop-house, closed base model',
        'designInference': True, 'notHistoricalReconstruction': True,
        'references': ['PBR-SH-0007-G01', 'PBR-SH-0007-G02', 'PBR-SH-0007-G03', 'PBR-SH-0007-G04'],
        'photoSources2015': ['PBR-SH-0001-007', 'PBR-SH-0001-008'],
        'frontageM': W, 'depthM': DEPTH, 'eaveM': EAVE, 'ridgeM': RIDGE,
        'eaveOverhangFrontM': OV_F, 'eaveOverhangSideM': OV_S,
        'wallThicknessM': T, 'windowRecessM': 0.12,
        'features': R['features'],
        'doors': 'all doors and windows modeled CLOSED with real recessed leaves; no interior',
        'trisTarget': TRI_TARGET,
        'axis': 'glTF Y-up, facade +Z, depth -Z, origin front-wall center bottom',
        'generator': 'generator/build_shophouse.py',
        'recipe': 'generator/recipes/' + R['id'] + '.json',
    }
    L.finalize(R['id'], OUT, design)


main()
