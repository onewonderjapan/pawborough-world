"""Build the four NEW module families for the 90m segment.

Families (PLAN N2): restaurant 饭馆/小酒楼, curio 银楼/小器物店(含字画变体),
plain 普通店宅, corner 转角/弄口单元. Each differs from the baseline units in at
least two of: bay width, eave height, window type, shopfront depth.

Run: blender -b --factory-startup -t 4 -P build_new_unit.py -- <kind>
kinds: restaurant-a restaurant-b curio-a curio-b plain-v1 plain-v2 plain-v3 corner
"""
import sys
from pathlib import Path
import math

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import mb_lib as L

kind = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'plain-v1'


def plane_yz(name, x, y, z, w, h, m, row=None, face_neg_x=False):
    """Quad in the YZ plane; default normal +X, or -X with face_neg_x (side-wall signs)."""
    rows = L.SIGN_ROWS
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)] if row is None else [
        (0, 1 - (row + 1) / rows), (1, 1 - (row + 1) / rows), (1, 1 - row / rows), (0, 1 - row / rows)]
    winding = [(0, 3, 2, 1)] if face_neg_x else [(0, 1, 2, 3)]
    return L.mesh(name, [(x, y - w / 2, z - h / 2), (x, y + w / 2, z - h / 2), (x, y + w / 2, z + h / 2), (x, y - w / 2, z + h / 2)],
                  winding, m, uv)


def lantern(x, y, z, r=.16, h=.34):
    """Red silk lantern with brass caps, hung from a short rod."""
    L.rod('lantern-hanger', (x, y, z), (x, y - .12, z), .02, 'iron')
    L.cyl('lantern-cap-top', (x, y - .12, z), (x, y - .17, z), r * .45, 'gold', 8)
    L.cyl('lantern-body', (x, y - .17, z), (x, y - .17 - h, z), r, 'silkR', 12)
    L.cyl('lantern-cap-bottom', (x, y - .17 - h, z), (x, y - .22 - h, z), r * .45, 'gold', 8)
    L.rod('lantern-tassel', (x, y - .22 - h, z), (x, y - .38 - h, z), .022, 'gold')


def jar(x, h, z, r=.16, jh=.34, m='drawer'):
    """Small urn/jar standing on height h at depth z. Vertical axis is GLB +Y."""
    L.cyl('jar-body', (x, h, z), (x, h + jh, z), r, m, 10)
    L.cyl('jar-neck', (x, h + jh, z), (x, h + jh + .07, z), r * .55, m, 10)
    L.cyl('jar-lip', (x, h + jh + .07, z), (x, h + jh + .10, z), r * .68, m, 10)


def table_round(x, z, r=.42):
    """Round table at depth z; all cylinders along +Y."""
    L.cyl('table-top', (x, .70, z), (x, .78, z), r, 'wood', 14)
    L.cyl('table-column', (x, .10, z), (x, .72, z), .05, 'wood', 8)
    L.cyl('table-foot', (x, .02, z), (x, .12, z), .22, 'wood', 10)


def stool(x, z):
    L.cyl('stool-top', (x, .42, z), (x, .50, z), .15, 'wood', 10)
    L.rod('stool-leg', (x, .02, z), (x, .44, z), .028, 'wood')


# ---------------------------------------------------------------- restaurant
def build_restaurant(sub_row_as_main=False):
    W, D, EAVE, RIDGE = 11.3, 7.0, 7.9, 9.3
    x, z = 0.0, .15
    L.GROUP = 'restaurant'
    main_row, sub_row = (8, 7) if sub_row_as_main else (7, 8)

    # shell
    L.box('left-side', (x - W / 2 + .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
    L.box('right-side', (x + W / 2 - .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
    L.box('back-wall', (x, EAVE / 2, z - D + .14), (W - .55, EAVE, .28), 'plaster', 0, True)
    L.box('shop-floor', (x, .07, z - D / 2), (W, .14, D), 'stone', .005, True)
    L.box('upper-floor', (x, 3.75, z - D / 2), (W - .56, .22, D - .55), 'wood', 0, True)
    L.box('rear-interior', (x, 1.7, z - 3.8), (W - .5, 3.3, .20), 'inner', 0, True)
    for xx in (x - W / 2 - .01, x + W / 2 + .01):
        L.box('brick-base', (xx, .52, z - D / 2), (.31, 1.04, D), 'brick', 0)

    # upper front wall: sill band + header, wider piers (2 windows + balcony panel band)
    L.box('upper-sill-wall', (x, 4.42, z - .13), (W - .5, 1.16, .26), 'plaster', 0)
    L.box('upper-header-wall', (x, (7.15 + EAVE) / 2, z - .13), (W - .5, EAVE - 7.15, .26), 'plaster', 0)
    openings = sorted([(xx - W * .17 - .04, xx + W * .17 + .04) for xx in (x - W * .3, x + W * .3)])
    start = x - W / 2 + .2
    for lo, hi in openings + [(x + W / 2 - .2, x + W / 2 - .2)]:
        if lo > start:
            L.box('upper-window-pier', ((start + lo) / 2, 6.05, z - .13), (lo - start, 2.1, .26), 'plaster', 0)
        start = hi
    for xx in (x - W * .3, x + W * .3):
        L.window(xx, 6.05, z + .05, W * .34, 2.05, False)

    # balcony panel band (二楼栏板) across the front between floor beam and sill
    L.box('balcony-rail-beam', (x, 4.06, z + .18), (W - .3, .12, .16), 'wood', .008)
    nb = int((W - 1.2) // .95)
    for i in range(nb):
        bx = x - (W - 1.2) / 2 + .48 + i * .95
        L.box('balcony-panel', (bx, 4.42, z + .16), (.82, .62, .07), 'wood', .01)
    for xx in (x - W / 2 + .35, x + W / 2 - .35):
        L.box('balcony-end-post', (xx, 4.42, z + .17), (.12, .66, .12), 'wood', .008)

    # street posts (wider 3-span rhythm) + beams
    for xx in (x - W / 2 + .18, x - W / 6, x + W / 6, x + W / 2 - .18):
        L.box('facade-post', (xx, 3.9, z + .09), (.22, 7.7, .26), 'wood', .012, True)
        L.box('stone-post-foot', (xx, .35, z + .09), (.36, .72, .36), 'stone', .016, True)
    for yy in (3.62, 4.42, EAVE - .2):
        L.box('front-long-beam', (x, yy, z + .10), (W, .20, .30), 'wood', .012)

    L.box('threshold', (x, .12, z + .22), (W - .4, .24, .55), 'stone', .015, True)

    # kitchen: stove block + urns at rear
    L.box('kitchen-stove', (x - W * .28, .55, z - D + 1.0), (2.2, 1.1, 1.3), 'brick', .01)
    L.box('kitchen-bench', (x + W * .2, .95, z - D + .9), (3.4, .16, .9), 'wood', .008)
    jar(x + W * .2 - 1.2, .95, z - D + .9, .18, .4)
    jar(x + W * .2 - .2, .95, z - D + .9, .15, .34)
    jar(x + W * .2 + .8, .95, z - D + .9, .2, .44)

    # counter along right-rear + shelf
    L.box('restaurant-counter', (x + W * .26, 1.05, z - 2.2), (1.1, 2.0, 2.5), 'wood', .012, True)
    L.box('counter-top', (x + W * .26, 2.08, z - 2.2), (1.2, .12, 2.6), 'dark', .01)
    L.box('back-shelf', (x + W * .26, 2.6, z - D + .45), (1.15, 1.9, .1), 'wood', .006)

    # two round tables + stools in the front bay
    table_round(x - 1.5, z - 1.9)
    table_round(x + 1.9, z - 2.3)
    for tx, tz in ((x - 1.5, z - 1.9), (x + 1.9, z - 2.3)):
        for dx, dz in ((-.75, -.35), (.75, -.35), (-.75, .45), (.75, .45)):
            stool(tx + dx, tz + dz)

    # carved-looking timber panel closes the middle upper bay (in front of the pier face)
    L.box('middle-bay-panel', (x, 6.05, z + .01), (W * .34 - .12, 2.0, .1), 'wood', .01)
    for k in range(1, 4):
        L.box('middle-bay-panel-batten', (x, 6.05, z + .066), (W * .34 - .32, .05, .025), 'dark', 0)

    # signs + lanterns
    L.sign(x, 4.05, z + .31, W * .5, .6, main_row)
    L.sign(x - W * .3, 2.95, z - .25, W * .34, .26, sub_row)
    lantern(x - W * .3, 3.55, z + .35)
    lantern(x + W * .3, 3.55, z + .35)

    L.roof(x, W, D, EAVE, RIDGE, z, True)
    for j in range(2):
        L.box('upper-eave-timber', (x, EAVE - .43 + j * .11, z + .07 + j * .07), (W, .12, .25 + j * .13), 'wood', .004)
    L.downpipe(x + W / 2, EAVE, z)

    return {'family': 'restaurant', 'variant': 'b-small-eatery' if sub_row_as_main else 'a-main-hall',
            'frontageM': W, 'depthM': D, 'eaveM': EAVE, 'ridgeM': RIDGE,
            'eaveMarginM': 0.4, 'frontProtrusionM': 0.5,
            'distinctFromBaseline': ['bay span ~3.7m vs ~2.5m', 'eave 7.9m vs 7.7/8.0 with balcony panel band', 'openfront dining fitout + lanterns']}


# ---------------------------------------------------------------- curio
def build_curio(is_calligraphy=False):
    W, D, EAVE, RIDGE = 6.2, 5.2, 6.6, 7.6
    x, z = 0.0, .12
    L.GROUP = 'curio'
    main_row, sub_row = (13, 10) if is_calligraphy else (9, 10)

    L.box('left-side', (x - W / 2 + .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
    L.box('right-side', (x + W / 2 - .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
    L.box('back-wall', (x, EAVE / 2, z - D + .14), (W - .55, EAVE, .28), 'plaster', 0, True)
    L.box('shop-floor', (x, .07, z - D / 2), (W, .14, D), 'stone', .005, True)
    L.box('upper-floor', (x, 3.6, z - D / 2), (W - .56, .22, D - .55), 'wood', 0, True)
    L.box('rear-interior', (x, 1.65, z - 3.4), (W - .5, 3.15, .20), 'inner', 0, True)
    for xx in (x - W / 2 - .01, x + W / 2 + .01):
        L.box('brick-base', (xx, .52, z - D / 2), (.31, 1.04, D), 'brick', 0)

    # upper wall: two shutter windows (different window type); windows reach the eave plate
    L.box('upper-sill-wall', (x, 4.31, z - .13), (W - .5, 1.02, .26), 'plaster', 0)
    L.shutter_window(x - 1.35, 5.55, z + .02, 1.35, 1.8)
    L.shutter_window(x + 1.35, 5.55, z + .02, 1.35, 1.8)

    # shallow porch platform + one step
    L.box('porch-platform', (x, .16, z + .5), (W - .4, .22, 1.0), 'stone', .01, True)
    L.box('porch-step', (x, .06, z + 1.05), (W - .8, .12, .5), 'stone', .01)

    # full-width display window: big panes, thin mullions
    wy, wh = 1.55, 1.95
    L.box('display-recess', (x - .55, wy, z - .16), (W - 2.1, wh + .2, .15), 'dark', 0)
    L.box('display-glass', (x - .55, wy, z - .07), (W - 2.4, wh, .022), 'glass', 0)
    for xx in (x - .55 - (W - 2.1) / 2, x - .55, x - .55 + (W - 2.1) / 2):
        L.box('display-mullion', (xx, wy, z + .01), (.06, wh + .16, .11), 'wood', .004)
    for yy in (wy - wh / 2, wy + wh / 2):
        L.box('display-rail', (x - .55, yy, z + .02), (W - 2.0, .07, .11), 'wood', .004)
    L.box('display-sill', (x - .55, wy - wh / 2 - .08, z + .05), (W - 1.9, .14, .3), 'stone', .01)
    # recessed door on the right
    L.box('shop-door', (x + W / 2 - .85, 1.05, z - .06), (1.05, 2.1, .09), 'dark', .008, True)
    L.box('door-frame-l', (x + W / 2 - 1.45, 1.05, z - .05), (.09, 2.2, .13), 'wood', .006)
    L.box('door-frame-r', (x + W / 2 - .28, 1.05, z - .05), (.09, 2.2, .13), 'wood', .006)
    L.box('door-lintel', (x + W / 2 - .86, 2.16, z - .05), (1.3, .12, .13), 'wood', .006)

    # beams + slim posts
    for yy in (3.5, 4.3, EAVE - .2):
        L.box('front-long-beam', (x, yy, z + .08), (W, .18, .26), 'wood', .012)
    for xx in (x - W / 2 + .16, x + W / 2 - .16):
        L.box('facade-post', (xx, 3.6, z + .07), (.18, 7.0, .22), 'wood', .01, True)

    if is_calligraphy:
        # hanging scrolls in the window + an outdoor easel with an open album
        for i, sx in enumerate((x - 1.5, x - .75, x - .05)):
            L.plane('hanging-scroll', sx, 1.75, z - .28, .38, 1.5, 'scroll')
            L.rod('scroll-rod', (sx - .22, 2.55, z - .28), (sx + .22, 2.55, z - .28), .025, 'dark')
        L.box('easel-leg-l', (x - 2.2, .75, z + 1.25), (.05, 1.5, .05), 'wood', .004)
        L.box('easel-leg-r', (x - 1.7, .75, z + 1.25), (.05, 1.5, .05), 'wood', .004)
        L.box('easel-board', (x - 1.95, 1.15, z + 1.05), (.62, .8, .035), 'paper', .006)
        L.box('easel-ledge', (x - 1.95, .78, z + 1.02), (.62, .04, .08), 'wood', .004)
    else:
        # display pedestals with jars
        for i, px in enumerate((x - 1.5, x - .75, x - .05)):
            L.box('display-pedestal', (px, .45, z - .55), (.4, .9, .4), 'wood', .008)
            jar(px, .9, z - .55, .13 + .02 * (i % 2), .3)
        L.box('counter-cabinet', (x - .55, 1.0, z - 1.6), (W - 2.2, 1.9, .5), 'dark', .01, True)

    L.sign(x - .3, 3.62, z + .24, W * .58, .5, main_row)
    L.sign(x - .3, 2.75, z - .22, W * .5, .22, sub_row)
    # brass accents: sign frame ends + door pulls
    L.cyl('door-pull', (x + W / 2 - .95, 1.15, z + .02), (x + W / 2 - .95, 1.15, z + .12), .022, 'gold', 8)

    L.roof(x, W, D, EAVE, RIDGE, z, True)
    L.downpipe(x + W / 2, EAVE, z)

    return {'family': 'curio', 'variant': 'b-calligraphy' if is_calligraphy else 'a-silver',
            'frontageM': W, 'depthM': D, 'eaveM': EAVE, 'ridgeM': RIDGE,
            'eaveMarginM': 0.4, 'frontProtrusionM': 1.3,
            'distinctFromBaseline': ['narrow 6.2m bay', 'full-width big-pane display window', 'shallow porch 1.0m', 'brass accents']}


# ---------------------------------------------------------------- plain
def build_plain(variant):
    W = {'v1': 12.0, 'v2': 10.7, 'v3': 10.7}[variant]
    D, EAVE, RIDGE = 6.4, 6.8, 8.0
    x, z = 0.0, 0.0
    L.GROUP = 'plain-' + variant
    has_main_sign = variant != 'v3'
    main_row, sub_row = {'v1': (11, 12), 'v2': (15, 14), 'v3': (None, None)}[variant]

    # shell with brick plinth also across the front (局部砖脚)
    L.box('left-side', (x - W / 2 + .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
    L.box('right-side', (x + W / 2 - .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
    L.box('back-wall', (x, EAVE / 2, z - D + .14), (W - .55, EAVE, .28), 'plaster', 0, True)
    L.box('shop-floor', (x, .07, z - D / 2), (W, .14, D), 'stone', .005, True)
    L.box('upper-floor', (x, 3.55, z - D / 2), (W - .56, .22, D - .55), 'wood', 0, True)
    L.box('rear-interior', (x, 1.62, z - 3.5), (W - .5, 3.1, .20), 'inner', 0, True)
    for xx in (x - W / 2 - .01, x + W / 2 + .01):
        L.box('brick-base', (xx, .52, z - D / 2), (.31, 1.04, D), 'brick', 0)
    L.box('front-brick-plinth', (x, .30, z + .01), (W - .3, .6, .24), 'brick', 0, True)

    # upper wall: header only (sill band lower), shutter windows differ from baseline lattice
    L.box('upper-sill-wall', (x, 4.25, z - .13), (W - .5, 1.0, .26), 'plaster', 0)
    L.box('upper-header-wall', (x, (6.6 + EAVE) / 2, z - .13), (W - .5, EAVE - 6.6, .26), 'plaster', 0)
    nw = 3 if W <= 11 else 4
    xs = [x - W / 2 + W * (i + .5) / nw for i in range(nw)]
    openings = sorted([(xx - .75, xx + .75) for xx in xs])
    start = x - W / 2 + .2
    for lo, hi in openings + [(x + W / 2 - .2, x + W / 2 - .2)]:
        if lo > start:
            L.box('upper-window-pier', ((start + lo) / 2, 5.65, z - .13), (lo - start, 1.85, .26), 'plaster', 0)
        start = hi
    for xx in xs:
        L.shutter_window(xx, 5.65, z + .02, 1.4, 1.8)

    # ground front: recessed door + display counter window
    dx = x - W * .22
    L.box('shop-door', (dx, 1.05, z - .05), (1.1, 2.1, .09), 'dark', .008, True)
    L.box('door-frame', (dx - .62, 1.05, z - .04), (.1, 2.2, .12), 'wood', .005)
    L.box('door-frame', (dx + .62, 1.05, z - .04), (.1, 2.2, .12), 'wood', .005)
    wx = x + W * .18
    ww = W * .5
    L.box('counter-window-recess', (wx, 1.25, z - .14), (ww, 1.7, .13), 'dark', 0)
    L.box('counter-window-glass', (wx, 1.25, z - .06), (ww - .2, 1.5, .02), 'glass', 0)
    L.box('counter-sill', (wx, .95, z - .02), (ww + .1, .5, .22), 'wood', .008, True)
    L.box('counter-top', (wx, 1.22, z + .02), (ww + .1, .08, .3), 'stone', .008)

    # two posts only + two beams
    for xx in (x - W / 2 + .2, x + W / 2 - .2):
        L.box('facade-post', (xx, 3.5, z + .08), (.2, 6.9, .24), 'wood', .01, True)
    for yy in (3.4, EAVE - .2):
        L.box('front-long-beam', (x, yy, z + .09), (W, .18, .28), 'wood', .01)

    if has_main_sign:
        L.sign(x, 3.7, z + .26, W * .52, .52, main_row)
        L.sign(wx, 2.35, z - .2, ww * .7, .2, sub_row)

    # simple straight slope roof (not the ornate curved one)
    L.roof(x, W, D, EAVE, RIDGE, z, False)
    L.box('upper-eave-timber', (x, EAVE - .4, z + .06), (W, .12, .24), 'wood', .004)
    L.downpipe(x + W / 2, EAVE, z)

    return {'family': 'plain', 'variant': variant,
            'frontageM': W, 'depthM': D, 'eaveM': EAVE, 'ridgeM': RIDGE,
            'eaveMarginM': 0.4, 'frontProtrusionM': 0.45,
            'distinctFromBaseline': ['simple straight slope roof', 'shutter windows vs open lattice', '2 posts vs 4', 'front brick plinth'],
            'signage': 'none (residential cap)' if not has_main_sign else 'main + sub typeset board'}


# ---------------------------------------------------------------- corner
def build_corner():
    WA, DA, EAVE, RIDGE = 10.1, 7.2, 7.4, 8.6
    x, z = 0.0, .12
    L.GROUP = 'corner'
    # main facade +Z (main street); branch facade on -X (placed on the SW quadrant,
    # after the south-row 180 deg rotation the -X side looks east toward 光启路)
    BS = -1  # branch side sign on local X
    BZ0, BZ1 = z - DA, z                       # shell depth range, = [-7.08, 0.12]
    DZ0, DZ1 = z - DA + .475, z - DA + 1.525   # side-door opening z range, width 1.05
    DH = 2.1                                   # opening head height
    wx = x + BS * (WA / 2 - .10)               # branch wall centerline

    L.box('left-side', (x - WA / 2 + .14, EAVE / 2, z - DA / 2), (.28, EAVE, DA), 'plaster', 0, True)
    # branch side wall: parapet-topped, finished; face stands 4cm proud of the
    # roof gable-closure plane (x = -WA/2). Built in three pieces around the real
    # side-door opening so the doorway cuts through the wall instead of a door
    # slab fighting the facade.
    L.box('branch-parapet-wall', (wx, EAVE / 2, (BZ0 + DZ0) / 2), (.28, EAVE, DZ0 - BZ0), 'plaster', 0, True)
    L.box('branch-parapet-wall', (wx, EAVE / 2, (DZ1 + BZ1) / 2), (.28, EAVE, BZ1 - DZ1), 'plaster', 0, True)
    L.box('branch-parapet-wall-head', (wx, (DH + .16 + EAVE) / 2, (DZ0 + DZ1) / 2), (.28, EAVE - DH - .16, DZ1 - DZ0), 'plaster', 0, True)
    L.box('back-wall', (x, EAVE / 2, z - DA + .14), (WA - .55, EAVE, .28), 'plaster', 0, True)
    # floor 1cm narrower each side: its side face must stay buried inside the side
    # walls (at -5.05 it matched the wall outer face and fought it in the door reveal)
    L.box('shop-floor', (x, .07, z - DA / 2), (WA - .02, .14, DA), 'stone', .005, True)
    L.box('upper-floor', (x, 3.7, z - DA / 2), (WA - .56, .22, DA - .55), 'wood', 0, True)
    L.box('rear-interior', (x, 1.7, z - 3.9), (WA - .5, 3.25, .20), 'inner', 0, True)
    for xx in (x + WA / 2 + .01,):
        L.box('brick-base', (xx, .52, z - DA / 2), (.31, 1.04, DA), 'brick', 0)
    # branch-side brick skirt stops at the side-door opening instead of crossing it
    L.box('brick-base', (x - WA / 2 - .01, .52, (BZ0 + DZ0) / 2), (.31, 1.04, DZ0 - BZ0), 'brick', 0)
    L.box('brick-base', (x - WA / 2 - .01, .52, (DZ1 + BZ1) / 2), (.31, 1.04, BZ1 - DZ1), 'brick', 0)

    # upper front wall + 3 windows
    L.box('upper-sill-wall', (x, 4.32, z - .13), (WA - .5, 1.02, .26), 'plaster', 0)
    L.box('upper-header-wall', (x, (7.05 + EAVE) / 2, z - .13), (WA - .5, EAVE - 7.05, .26), 'plaster', 0)
    xs = [x - WA * .3, x, x + WA * .3]
    openings = sorted([(xx - .82, xx + .82) for xx in xs])
    start = x - WA / 2 + .2
    for lo, hi in openings + [(x + WA / 2 - .2, x + WA / 2 - .2)]:
        if lo > start:
            L.box('upper-window-pier', ((start + lo) / 2, 5.85, z - .13), (lo - start, 2.1, .26), 'plaster', 0)
        start = hi
    for xx in xs:
        L.window(xx, 5.85, z + .05, 1.5, 2.05, False)

    # corner pier on the branch side + street posts (main facade)
    L.box('corner-pier', (x + BS * (WA / 2 - .28), 3.85, z + .16), (.4, 7.5, .44), 'wood', .012, True)
    L.box('corner-pier-foot', (x + BS * (WA / 2 - .28), .38, z + .16), (.52, .76, .56), 'stone', .016, True)
    for xx in (x - BS * (WA / 2 - .18), x + BS * WA * .18, x + BS * WA * .02):
        L.box('facade-post', (xx, 3.8, z + .09), (.2, 7.4, .24), 'wood', .012, True)
        L.box('stone-post-foot', (xx, .35, z + .09), (.34, .7, .34), 'stone', .014, True)
    for yy in (3.55, 4.32, EAVE - .2):
        L.box('front-long-beam', (x, yy, z + .10), (WA, .2, .28), 'wood', .012)

    # ground front: open bays, recessed door right of centre
    L.box('threshold', (x, .12, z + .22), (WA - .5, .24, .55), 'stone', .015, True)
    L.box('shop-door', (x + BS * WA * .16, 1.05, z - .06), (1.15, 2.1, .09), 'dark', .008, True)
    L.box('counter-cabinet', (x + BS * WA * .25, 1.0, z - 1.7), (WA * .42, 1.9, .5), 'wood', .01, True)
    L.box('counter-top', (x + BS * WA * .25, 1.98, z - 1.7), (WA * .42 + .12, .12, .62), 'dark', .01)
    for i in range(3):
        jar(x + BS * (WA * .42 - i * .9), 2.04, z - 1.7, .16, .36)

    # branch facade: parapet coping, small high window, street plaque, side door
    sx = x + BS * (WA / 2 + .005)
    L.box('parapet-coping', (sx + BS * .06, (EAVE - .35), z - DA / 2), (.4, .22, DA), 'stone', .01)
    L.box('branch-window-recess', (sx, 4.6, z - DA * .45), (.2, 1.3, 1.3), 'dark', 0)
    L.box('branch-window-glass', (sx - BS * .02, 4.6, z - DA * .45), (.06, 1.1, 1.1), 'glass', 0)
    L.box('branch-sill', (sx - BS * .1, 3.85, z - DA * .45), (.3, .16, 1.5), 'stone', .01)
    plane_yz('street-plaque', sx + BS * .055, 1.35, z - DA * .62, .85, .3, 'sign', 4, face_neg_x=(BS < 0))
    L.box('plaque-backing', (sx + BS * .02, 1.35, z - DA * .62), (.06, 1.0, .42), 'dark', .008)
    # side door: leaf recessed in a real opening, timber lining (jambs + lintel)
    # proud of the skirt, stone sill under the leaf. No leaf face shares a plane
    # with the skirt (outer leaf x=-5.19 vs skirt face -5.215).
    L.box('branch-threshold', (x - WA / 2 - .0825, .06, (DZ0 + DZ1) / 2), (.165, .12, DZ1 - DZ0), 'stone', .015)
    jx0, jx1 = x - WA / 2 - .175, x - WA / 2 + .25  # lining stands 1cm proud of the skirt face
    L.box('branch-door-jamb', ((jx0 + jx1) / 2, DH / 2, DZ0 + .062), (jx1 - jx0, DH, .12), 'wood', .006)
    L.box('branch-door-jamb', ((jx0 + jx1) / 2, DH / 2, DZ1 - .062), (jx1 - jx0, DH, .12), 'wood', .006)
    L.box('branch-door-lintel', ((jx0 + jx1) / 2, DH + .08, (DZ0 + DZ1) / 2), (jx1 - jx0, .16, DZ1 - DZ0), 'wood', .006)
    L.box('branch-door', (x - WA / 2 - .10, (.12 + DH - .02) / 2, (DZ0 + DZ1) / 2),
          (.08, DH - .14, (DZ1 - DZ0) - .26), 'dark', .008, True)

    L.sign(x - BS * WA * .18, 4.0, z + .28, WA * .5, .55, 12)
    L.sign(x - BS * WA * .3, 2.95, z - .22, WA * .4, .24, 14)

    L.roof(x, WA, DA, EAVE, RIDGE, z, True)
    for j in range(2):
        L.box('upper-eave-timber', (x, EAVE - .43 + j * .11, z + .07 + j * .07), (WA, .12, .25 + j * .13), 'wood', .004)
    L.downpipe(x - BS * WA / 2, EAVE, z)  # downpipe away from the branch corner

    return {'family': 'corner', 'variant': 'branch-corner',
            'frontageM': WA, 'depthM': DA, 'eaveM': EAVE, 'ridgeM': RIDGE,
            'eaveMarginM': 0.4, 'frontProtrusionM': 0.55,
            'twoFacades': ['+Z main street', '+X branch street (parapet, plaque, side door)'],
            'distinctFromBaseline': ['two finished visible facades', 'corner pier', 'branch parapet with coping']}


L.reset_scene()
L.build_materials()
builders = {
    'restaurant-a': lambda: build_restaurant(False),
    'restaurant-b': lambda: build_restaurant(True),
    'curio-a': lambda: build_curio(False),
    'curio-b': lambda: build_curio(True),
    'plain-v1': lambda: build_plain('v1'),
    'plain-v2': lambda: build_plain('v2'),
    'plain-v3': lambda: build_plain('v3'),
    'corner': build_corner,
}
assert kind in builders, kind
design = builders[kind]()
design['source'] = 'new module for fangbang-parallel-night-20260913, derived from baseline method'
L.finalize(kind.replace('-', '_') if kind == 'corner' else kind, HERE / kind, design)
