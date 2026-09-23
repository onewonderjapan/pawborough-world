"""Item registry for the 27 handheld snack props.
Import INSIDE Blender after `import geomlib as G` with G.TEX set to kit/textures.
Design coords are GLB Y-up metres; geomlib converts to Blender internally.
Each entry: id -> {zh, cls, size, mass, budget, build(lod)->[objs], grip, grip2,
collision, extra_nodes, closed, tangents}
Sockets: grip/grip2 = (pos, x_axis, z_axis) in GLB coords; rest always origin +Y up.
"""
import math
from geomlib import box, mesh, cyl, rod, lathe, band, ring_shell, disc, vessel, sphere, ring_positions

TAU = math.tau
UP, FRONT, RT, LT, BK = (0, 1, 0), (0, 0, 1), (1, 0, 0), (-1, 0, 0), (0, 0, -1)


def cap(a, b, r):
    return {'type': 'capsule', 'a': list(a), 'b': list(b), 'radius': r}


def bx(c, s):
    return {'type': 'box', 'center': list(c), 'size': list(s)}


def pleated_bun(name, origin, rings, pleats, amp, twist, matk, sides=24, knot=None, uv_top=None):
    """rings entries: (y, r) -> amp applied, or (y, r, a) kept as-is."""
    rr = [(t if len(t) == 3 else (t[0], t[1], amp)) for t in rings]
    objs = [lathe(name, origin, rr, matk, sides, pleats=pleats, twist=twist,
                  cap_bottom=True, cap_top=True, uv_top_planar=uv_top)]
    if knot:
        objs.append(lathe(name + '-knot', knot,
                          [(0, .002, 0), (.004, .004, 0), (.005, .002, 0), (.006, 0, 0)],
                          matk, 10, cap_top=True, cap_bottom=False))
    return objs


def bun_rings(h, r, n=5):
    full = [(0, r * .62), (.12 * h, r * .80), (.28 * h, r * .92), (.45 * h, r * .97),
            (.60 * h, r * .955), (.75 * h, r * .88), (.86 * h, r * .68),
            (.92 * h, r * .40), (.985 * h, r * .10)]
    if n >= len(full):
        return full
    idx = [round(i * (len(full) - 1) / (n - 1)) for i in range(n)]
    return [full[i] for i in dict.fromkeys(idx)]


# ---------- shared bowl builders (carry class, single vessel) --------------

def tangyuan_bowl_build(lod=0):
    o = (0, 0, 0)
    vs = 32 if lod == 0 else (18 if lod == 1 else 6)
    ts = 16 if lod == 0 else (10 if lod == 1 else 6)
    tr = 8 if lod == 0 else (5 if lod == 1 else 3)
    nt = 5 if lod < 2 else 2
    objs = [vessel('bowl', o, [(0, .030), (.004, .035), (.02, .050), (.045, .062), (.06, .066)],
                   'porcelain', 'rim', .052, vs),
            disc('soup', (0, .046, 0), .058, .002, 'soup', vs)]
    for k, (bx_, bz) in enumerate(ring_positions([(.03, 5)][:1] if lod < 2 else [(.03, 3)])):
        if k >= nt:
            break
        if k == 0:
            objs.append(lathe('tangyuan-meat', (bx_, .028, bz),
                              [(0, .012, 0), (.006, .017, 0), (.016, .016, 0), (.026, .009, 0), (.034, 0, 0)][: tr + 1],
                              'dough', ts, cap_top=False))
        else:
            objs.append(sphere('tangyuan', (bx_, .026, bz), .0175, 'dough', ts, tr))
    if lod < 2:
        objs.append(sphere('spoon-bowl', (-.03, .038, .012), .016, 'porcelain', 12, 5, squash=.45, scale_x=1.5))
        objs.append(box('spoon-handle', (.005, .044, -.005), (.075, .007, .012), 'porcelain', .002))
    return objs


def jiuniang_bowl_build(lod=0):
    vs = 32 if lod == 0 else (18 if lod == 1 else 6)
    objs = [vessel('bowl', (0, 0, 0), [(0, .030), (.004, .035), (.02, .050), (.045, .062), (.06, .066)],
                   'porcelain', 'rim', .052, vs),
            disc('sweet-soup', (0, .047, 0), .058, .002, 'osoup', vs)]
    rings = [(.018, 6), (.036, 12), (.05, 7)] if lod == 0 else ([(.02, 6), (.04, 8)] if lod == 1 else [(.03, 4)])
    for (bx_, bz) in ring_positions(rings):
        if math.hypot(bx_, bz) < .052:
            objs.append(sphere('yuanzi', (bx_, .041, bz), .0065, 'dough',
                               10 if lod == 0 else (6 if lod == 1 else 5), 5 if lod == 0 else 3))
    return objs


def soymilk_bowl_build(lod=0):
    vs = 32 if lod == 0 else (18 if lod == 1 else 6)
    return [vessel('bowl', (0, 0, 0), [(0, .032), (.004, .038), (.022, .054), (.05, .066), (.065, .07)],
                   'porcelain', 'rim', .057, vs),
            disc('soy-milk', (0, .052, 0), .062, .002, 'milk', vs),
            lathe('youtiao-piece', (-.02, .058, -.02),
                  [(0, .008, 0), (.01, .012, 0), (.04, .012, 0), (.05, .008, 0), (.052, 0, 0)],
                  'crust', 12 if lod == 0 else (8 if lod == 1 else 6), axis='z',
                  bumps=(2, .25) if lod < 2 else (0, 0), twist=1.2)]


def paigu_niangao_build(lod):
    """plate + 2 niangao + irregular-outline rib (>=8-sided silhouette) + bone stub + glaze."""
    objs = [vessel('plate', (0, 0, 0), [(0, .066), (.004, .082), (.012, .108), (.02, .12)],
                   'porcelain', 'rim', .017, 36 if lod == 0 else (24 if lod == 1 else 8)),
            disc('glaze', (0, .021, 0), .085, .002, 'sauce', 32 if lod == 0 else (16 if lod == 1 else 8)),
            box('niangao', (-.035, .03, -.005), (.03, .014, .11), 'niangao', .005 if lod < 2 else 0),
            box('niangao', (.0, .03, .01), (.03, .014, .11), 'niangao', .005 if lod < 2 else 0)]
    outline = [(0.500, 1.00), (0.720, 0.92), (0.880, 0.72), (0.960, 0.50), (0.900, 0.28),
               (0.720, 0.10), (0.500, 0.04), (0.300, 0.10), (0.120, 0.26), (0.040, 0.48),
               (0.110, 0.70), (0.290, 0.92)]
    if lod == 2:
        outline = outline[::2]
    L, W = .085, .040
    rings_y = [(.026, 1.0), (.034, .92), (.040, .55)] if lod == 0 else [(.026, 1.0), (.037, .6)]
    verts, faces, uvs = [], [], []
    for (yy, wy) in rings_y:
        for (pz, px) in outline:
            verts.append(((px - .5) * W * wy + .045, yy, (pz - .5) * L))
            uvs.append(((px - .5) * W / .04 + .5, (pz - .5) * L / .085 + .5))
    n = len(outline)
    for j in range(len(rings_y) - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, a + n, b + n, b))
    cidx = len(verts)
    verts.append((.045, .025, 0))
    uvs.append((.5, .5))
    for i in range(n):
        faces.append((cidx, (i + 1) % n, i))
    objs.append(mesh('pork-rib', verts, faces, 'rib', uvs))
    objs.append(cyl('rib-bone', (.045, .034, .042), (.045, .034, .072), .008, 'porcelain', 8 if lod == 0 else (6 if lod == 1 else 4)))
    return objs


def steamer_build(lod):
    """R=0.10 shallow steamer + 8 buns; the lid is a separate 'lid' node (extra_nodes)."""
    sides = 40 if lod == 0 else (24 if lod == 1 else 12)
    objs = [ring_shell('steamer-wall', (0, 0, 0), .10, .045, .006, 'bamboo', sides, inner_floor=.006),
            disc('steamer-floor', (0, .004, 0), .096, .004, 'weave', sides)]
    bsides, brings = (27, 8) if lod == 0 else ((12, 5) if lod == 1 else (6, 3))
    for i, (bx_, bz) in enumerate(ring_positions([(.048, 8)], phase=3)):
        objs += pleated_bun('bun-%d' % i, (bx_, .008, bz), bun_rings(.034, .027, n=brings),
                            9 if lod < 2 else 0, .06 if lod < 2 else 0, .25, 'dough', bsides)
    return objs


def steamer_lid_build(lod=0):
    sides = 40 if lod == 0 else 20
    return [lathe('lid', (0, .045, 0),
                  [(0, .102, 0), (.012, .102, 0), (.02, .098, 0), (.032, .088, 0),
                   (.042, .06, 0), (.045, .02, 0), (.046, 0, 0)],
                  'bamboo', sides, cap_bottom=True),
            lathe('lid-knob', (0, .089, 0),
                  [(0, .012, 0), (.005, .014, 0), (.008, .008, 0), (.009, 0, 0)], 'bamboo', 12, cap_top=True)]


def ligaotang_box_build(lod):
    bev = .002 if lod < 2 else 0
    pbev = .003 if lod == 0 else 0
    objs = [box('box-body', (0, .015, 0), (.12, .03, .10), 'boxcard', bev),
            box('box-lid', (0, .015, -.083), (.124, .028, .006), 'boxcard', bev)]
    if lod == 0:
        objs.append(mesh('lid-label',
                         [(-.05, .0293, -.0835), (.05, .0293, -.0835), (.05, .0293, -.0825), (-.05, .0293, -.0825)],
                         [(0, 3, 2, 1)], 'label', [(0, .5), (1, .5), (1, .75), (0, .75)]))
    for i in range(3):
        for j in range(2):
            objs.append(box('ligaotang', (-.037 + .037 * i, .026, -.025 + .05 * j), (.032, .012, .026), 'amber', pbev))
    return objs


def packet_closed_build(lod):
    bev = .003 if lod == 0 else 0
    objs = [box('packet', (0, .06, 0), (.09, .12, .032), 'paper', bev),
            box('packet-fold', (0, .126, 0), (.09, .012, .012), 'paper', bev)]
    if lod == 0:
        # labels on the front face (+z) of the standing packet: 奶油五香豆 row + shop mark row
        objs.append(mesh('packet-label',
                         [(-.04, .03, .0166), (.04, .03, .0166), (.04, .082, .0166), (-.04, .082, .0166)],
                         [(0, 1, 2, 3)], 'label', [(0, .75), (1, .75), (1, 1), (0, 1)]))
        objs.append(mesh('packet-mark',
                         [(-.025, .088, .0167), (.025, .088, .0167), (.025, .12, .0167), (-.025, .12, .0167)],
                         [(0, 1, 2, 3)], 'label', [(0, .75), (1, .75), (1, 1), (0, 1)]))
        for sx in (-1, 1):
            objs.append(box('packet-crimp', (sx * .044, .06, 0), (.004, .116, .03), 'paper', .001))
    return objs


def vinegar_dish_build(lod):
    sides = 24 if lod == 0 else (18 if lod == 1 else 10)
    return [vessel('dish', (0, 0, 0), [(0, .02), (.003, .026), (.012, .036), (.015, .038)],
                   'porcelain', 'rim', .012, sides, .003),
            disc('vinegar', (0, .01, 0), .03, .002, 'vinegar', sides)]


def teacup_build(lod):
    sides = 20 if lod == 0 else (14 if lod == 1 else 6)
    return [vessel('teacup', (0, 0, 0), [(0, .018), (.003, .022), (.03, .03), (.04, .032)],
                   'porcelain', 'rim', .035, sides, .003),
            disc('tea-liquid', (0, .031, 0), .027, .002, 'tea-liquid', sides)]


def congyoubing_build(lod):
    """Single scallion pancake folded in half (semicircle lying flat), fold lip toward -x.
    Actual rest-pose bounds ~[0.12, 0.021, 0.062] (spec z=.12 unachievable for a semicircle;
    recorded in PROGRESS.assumptions)."""
    seg = 14 if lod == 0 else (10 if lod == 1 else 6)
    r = .06
    y0, y1 = 0.0, .014
    verts, faces, uvs = [], [], []
    for yy, lift in ((y0, 0.0), (y1, .003)):
        for i in range(seg + 1):
            th = math.pi * i / seg
            x = .06 - r * math.cos(th)
            z = r * math.sin(th)
            verts.append((x, yy + (lift * math.sin(th * .5) if yy > 0 else 0.0), z))
            uvs.append((x / .125, z / .125))
    n1 = seg + 1
    for i in range(seg):  # outer arc wall
        faces.append((i, i + 1, i + 1 + n1, i + n1))
    faces.append((0, n1, 2 * n1 - 1, n1 - 1))          # crease wall (diameter edge)
    c_top, c_bot = 2 * n1, 2 * n1 + 1
    verts.append((.052, .011, .028)); uvs.append((.42, .22))
    verts.append((.052, -.001, .028)); uvs.append((.42, .22))
    for i in range(seg):  # top + bottom caps
        faces.append((c_top, n1 + i + 1, n1 + i))
        faces.append((c_bot, i, i + 1))
    return [mesh('congyoubing', verts, faces, ['pancake', 'crust'], uvs, [0] * len(faces))]


# ---------- registry -------------------------------------------------------

def R(id_, zh, cls, size, mass, budget, build, grip, grip2=None, collision=(),
      extra_nodes=None, closed=False, tangents=False, note=''):
    return dict(id=id_, zh=zh, cls=cls, size=size, mass=mass, budget=budget, build=build,
                grip=grip, grip2=grip2, collision=list(collision), extra_nodes=extra_nodes or {},
                closed=closed, tangents=tangents, note=note)


def REG():
    reg = {}

    def add(id_, zh, cls, size, mass, budget, build, grip, **kw):
        reg[id_] = R(id_, zh, cls, size, mass, budget, build, grip, **kw)

    add('xiaolongbao', '小籠饅頭', 'pinch', [.045, .038, .045], .025, 'pinch',
        lambda lod: pleated_bun('bun', (0, 0, 0), bun_rings(.0355, .0225, n=(9 if lod == 0 else 5 if lod == 1 else 3)),
                                18 if lod < 2 else 0, .06 if lod < 2 else 0, .25, 'dough',
                                54 if lod == 0 else 20 if lod == 1 else 8,
                                knot=(0, .0345, 0) if lod == 0 else None),
        grip=((.0225, .019, 0), RT, FRONT),
        collision=[cap((0, .01, 0), (0, .032, 0), .021)], closed=True)

    def guantangbao(lod):
        rings = [(0, .052), (.012, .050, .05), (.028, .053, .05), (.046, .047, .05),
                 (.058, .034, .05), (.064, .015, .06)]
        return pleated_bun('bun', (0, 0, 0), rings, 22 if lod < 2 else 0, .05 if lod < 2 else 0, .25, 'dough',
                           66 if lod == 0 else 22 if lod == 1 else 8,
                           knot=(0, .0635, 0) if lod == 0 else None)
    add('guantangbao', '灌湯包', 'pinch', [.11, .066, .11], .12, 'pinch', guantangbao,
        grip=((.055, .033, 0), RT, FRONT),
        collision=[cap((0, .012, 0), (0, .056, 0), .05)],
        extra_nodes={'straw': lambda lod=0: [cyl('straw', (.012, .058, .012), (.040, .104, .040), .004, 'porcelain', 6)]})

    def shengjian(lod):
        sides = 54 if lod == 0 else (14 if lod == 1 else 8)
        objs = [lathe('sj-crust', (0, 0, 0), [(0, .02, 0), (.013, .0266, 0)],
                      'crust', sides, cap_bottom=True, cap_top=False, uv_top_planar=.05),
                lathe('sj-body', (0, .013, 0),
                      [(.0, .0266, 0), (.008, .0275, .045), (.02, .0262, .045), (.028, .017, .045), (.030, .002, .07)],
                      ['dough', 'sesame-scallion'], 54 if lod == 0 else (14 if lod == 1 else 8),
                      pleats=12 if lod < 2 else 0, twist=.25,
                      cap_bottom=False, cap_top=True, mat_by_y=(.0215, 0, 1), uv_top_planar=.052)]
        if lod == 0:
            objs.append(lathe('sj-knot', (0, .0405, 0),
                              [(0, .002, 0), (.0035, .0035, 0), (.0045, .0015, 0), (.005, 0, 0)], 'dough', 10, cap_top=True, cap_bottom=False))
        return objs
    add('shengjian', '生煎饅頭', 'pinch', [.055, .042, .055], .045, 'pinch', shengjian,
        grip=((.0275, .021, 0), RT, FRONT), collision=[cap((0, .008, 0), (0, .034, 0), .026)])

    add('tangyuan', '黑洋酥湯糰', 'pinch', [.035, .033, .035], .02, 'pinch',
        lambda lod: [sphere('tangyuan', (0, 0, 0), .0175, 'dough',
                            24 if lod == 0 else 16 if lod == 1 else 8,
                            10 if lod == 0 else 8 if lod == 1 else 4, squash=.94)],
        grip=((.0175, .0165, 0), RT, FRONT),
        collision=[cap((0, .01, 0), (0, .024, 0), .0165)], closed=True)

    add('tangyuan-meat', '鮮肉湯糰', 'pinch', [.034, .036, .034], .022, 'pinch',
        lambda lod: [lathe('tangyuan-meat', (0, 0, 0),
                           [(0, .013, 0), (.008, .017, 0), (.017, .0165, 0), (.024, .012, 0),
                            (.028, .006, 0), (.033, 0, 0)],
                           'dough', 20 if lod == 0 else 14 if lod == 1 else 8, cap_top=False)],
        grip=((.017, .018, 0), RT, FRONT),
        collision=[cap((0, .01, 0), (0, .026, 0), .016)], closed=True)

    def youtiao(lod):
        rings = [(0, .005, 0), (.03, .011, 0), (.13, .0135, 0), (.22, .013, 0), (.25, .007, 0), (.26, 0, 0)]
        sides = 14 if lod == 0 else (10 if lod == 1 else 6)
        return [lathe('lobe-%d' % k, (xx, .0135, 0), rings, 'crust', sides, axis='z',
                      bumps=(3, .12) if lod < 2 else (0, 0), twist=2.4 + k)
                for k, xx in enumerate((-.004, .004))]
    add('youtiao', '油條', 'grip', [.035, .03, .26], .05, 'grip', youtiao,
        grip=((0, .015, .13), RT, FRONT), collision=[cap((0, .0135, .01), (0, .0135, .25), .0135)])

    def xiekehuang(lod):
        sides = 24 if lod == 0 else (16 if lod == 1 else 8)
        rings = 8 if lod == 0 else (6 if lod == 1 else 3)
        objs = [sphere('xiekehuang', (0, 0, 0), .031, 'sesame', sides, rings,
                       squash=.36, scale_x=1.29, uv_top_planar=.085),
                lathe('xiekehuang-rim', (0, 0, 0),
                      [(0, .020, 0), (.004, .027, 0), (.008, .032, 0), (.011, .0333, 0)],
                      'crust', sides, cap_bottom=True, cap_top=False, scale_x=1.29)]
        if lod == 0:
            objs.append(lathe('xiekehuang-rim2', (0, .009, 0),
                              [(0, .031, 0), (.0015, .0325, 0), (.0025, .033, 0)], 'crust', sides,
                              cap_bottom=False, cap_top=False, scale_x=1.29))
        return objs
    add('xiekehuang', '蟹殼黃', 'pinch', [.08, .022, .062], .04, 'pinch', xiekehuang,
        grip=((.04, .011, 0), RT, FRONT), collision=[bx((0, .011, 0), (.08, .022, .062))])

    def dabing(lod):
        sides = 28 if lod == 0 else (18 if lod == 1 else 8)
        rings = 5 if lod == 0 else (4 if lod == 1 else 3)
        objs = [sphere('dabing', (0, 0, 0), .075, 'sesame', sides, rings, squash=.073, uv_top_planar=.155)]
        if lod == 0:
            objs.append(box('dabing-fold', (0, .0105, 0), (.148, .0018, .004), 'crust', .0008))
        return objs
    add('dabing', '大餅', 'grip', [.15, .011, .15], .09, 'grip', dabing,
        grip=((.075, .006, 0), RT, FRONT), collision=[bx((0, .006, 0), (.15, .012, .15))])

    add('congyoubing', '蔥油餅', 'grip', [.12, .012, .12], .08, 'grip', congyoubing_build,
        grip=((.052, .009, .03), RT, FRONT), collision=[bx((.06, .0085, .03), (.12, .017, .06))],
        note='folded-in-half semicircle; actual bounds ~[.12,.021,.062], recorded in PROGRESS.assumptions')

    add('cifangao', '粢飯糕', 'grip', [.028, .015, .075], .045, 'grip',
        lambda lod: [box('cifangao', (0, .0075, 0), (.028, .015, .075), 'crust', .003)],
        grip=((.014, .008, .037), RT, FRONT), collision=[bx((0, .0075, 0), (.028, .015, .075))])

    def youdunzi(lod):
        sides = 18 if lod == 0 else (12 if lod == 1 else 8)
        objs = [lathe('youdunzi', (0, 0, 0),
                      [(0, .03, 0), (.008, .034, 0), (.022, .035, 0), (.03, .03, 0), (.033, .018, 0), (.034, 0, 0)],
                      'crust', sides, cap_top=False, bumps=(7, .04) if lod < 2 else (0, 0))]
        if lod == 0:
            for i in range(18):
                a = i * 2.399
                rr = .004 + .016 * ((i * 2654435761) % 97) / 97
                h2 = .035 + .0025 * ((i * 40503) % 7) / 7
                objs.append(rod('shred-%d' % i,
                                (rr * math.cos(a), .033, rr * math.sin(a)),
                                (rr * 1.35 * math.cos(a), h2, rr * 1.35 * math.sin(a)),
                                .0016, 'greens' if i % 4 == 0 else 'dough'))
        elif lod == 1:
            objs.append(sphere('shreds', (0, .0335, 0), .016, 'greens', 10, 3, squash=.18))
        return objs
    add('youdunzi', '油墩子', 'pinch', [.07, .036, .07], .06, 'pinch', youdunzi,
        grip=((.035, .018, 0), RT, FRONT), collision=[cap((0, .01, 0), (0, .03, 0), .033)])

    def chunjuan(lod):
        sides = 12 if lod == 0 else (8 if lod == 1 else 6)
        rings = [(0, .002, 0), (.006, .0105, 0), (.016, .0118, 0), (.084, .0118, 0),
                 (.094, .0105, 0), (.1, .002, 0)]
        return [lathe('chunjuan', (0, .012, 0), rings, 'crust', sides, axis='z',
                      cap_bottom=True, cap_top=True, twist=.3 if lod < 2 else 0)]
    add('chunjuan', '春卷', 'grip', [.024, .024, .1], .035, 'grip', chunjuan,
        grip=((0, .012, .05), RT, FRONT), collision=[cap((0, .012, .008), (0, .012, .092), .012)], closed=True)

    add('ligaotang-piece', '梨膏糖', 'pinch', [.032, .012, .026], .012, 'pinch',
        lambda lod: [box('ligaotang', (0, .006, 0), (.032, .012, .026), 'amber', .003)],
        grip=((.016, .006, 0), RT, FRONT), collision=[bx((0, .006, 0), (.032, .012, .026))])

    add('ligaotang-box-open', '梨膏糖盒', 'carry', [.124, .03, .14], .09, 'carry', ligaotang_box_build,
        grip=((.062, .008, .02), RT, FRONT), grip2=((0, .024, .05), RT, FRONT),
        collision=[bx((0, .015, -.01), (.124, .03, .1)), bx((0, .015, -.083), (.124, .028, .006))])

    add('wuxiangdou-packet', '奶油五香豆紙包', 'grip', [.09, .13, .032], .15, 'grip', packet_closed_build,
        grip=((.045, .065, 0), RT, FRONT), collision=[bx((0, .065, 0), (.092, .132, .034))])

    add('teacup-filled', '茶盞', 'grip', [.064, .04, .064], .09, 'grip', teacup_build,
        grip=((.032, .02, 0), RT, FRONT), collision=[cap((0, .012, 0), (0, .03, 0), .03)])

    def chopsticks(lod):
        sides = 6 if lod < 2 else 4
        return [lathe('stick-%d' % k, (xx, .0041, 0),
                      [(0, .0023, 0), (.02, .0030, 0), (.06, .0037, 0), (.24, .0041, 0)],
                      'wood', sides, axis='z', cap_top=True)
                for k, xx in enumerate((-.0024, .0024))]
    add('chopsticks-pair', '筷子', 'grip', [.012, .008, .24], .01, 'grip', chopsticks,
        grip=((0, .004, .16), RT, FRONT),
        collision=[cap((-.0024, .0041, .002), (-.0024, .0041, .238), .0042), cap((.0024, .0041, .002), (.0024, .0041, .238), .0042)])

    add('vinegar-dish', '醋碟', 'carry', [.076, .015, .076], .05, 'carry', vinegar_dish_build,
        grip=((.028, .005, 0), RT, FRONT), grip2=((0, .013, .034), RT, FRONT),
        collision=[cap((0, .006, 0), (0, .011, 0), .035)])

    add('bowl-tangyuan', '湯糰碗', 'carry', [.132, .06, .132], .35, 'carry', tangyuan_bowl_build,
        grip=((.05, .005, 0), RT, FRONT), grip2=((0, .056, .062), RT, FRONT),
        collision=[cap((0, .012, 0), (0, .05, 0), .06)])

    add('bowl-jiuniang', '酒釀圓子碗', 'carry', [.132, .06, .132], .35, 'carry', jiuniang_bowl_build,
        grip=((.05, .005, 0), RT, FRONT), grip2=((0, .056, .062), RT, FRONT),
        collision=[cap((0, .012, 0), (0, .05, 0), .06)])

    add('bowl-soymilk', '豆漿碗', 'carry', [.14, .065, .14], .4, 'carry', soymilk_bowl_build,
        grip=((.056, .006, 0), RT, FRONT), grip2=((0, .06, .066), RT, FRONT),
        collision=[cap((0, .012, 0), (0, .054, 0), .064)])

    add('plate-paigu-niangao', '排骨年糕盤', 'carry', [.24, .045, .24], .5, 'carry', paigu_niangao_build,
        grip=((.096, .006, 0), RT, FRONT), grip2=((0, .022, .114), RT, FRONT),
        collision=[bx((0, .012, 0), (.24, .024, .24))])

    add('steamer-xiaolongbao-8', '小籠一籠', 'carry', [.20, .09, .20], .45, 'carry_steamer_with_buns', steamer_build,
        grip=((.09, .03, 0), RT, FRONT), grip2=((-.09, .03, 0), LT, BK),
        extra_nodes={'lid': steamer_lid_build},
        collision=[cap((0, .022, 0), (0, .05, 0), .096), cap((0, .075, 0), (0, .095, 0), .08)])

    # beans: geometry supplied by build_bean (registered with build=None here)
    add('bean-single', '五香豆', 'pinch', [.022, .009, .015], .002, 'bean', None,
        grip=((.011, .0045, 0), RT, FRONT), collision=[cap((0, .004, 0), (0, .005, 0), .009)],
        closed=True, tangents=True)
    add('bean-dish', '五香豆碟', 'carry', [.09, .03, .09], .15, 'carry', None,
        grip=((.036, .005, 0), RT, FRONT), grip2=((0, .024, .038), RT, FRONT),
        collision=[cap((0, .005, 0), (0, .02, 0), .04)], tangents=True)
    add('bean-packet-open', '撕開的五香豆紙包', 'grip', [.14, .13, .14], .12, 'grip', None,
        grip=((.045, .065, 0), RT, FRONT),
        collision=[bx((.028, .065, .015), (.146, .13, .122))], tangents=True)
    add('bean-jar', '五香豆玻璃罐', 'carry', [.156, .227, .156], 1.2, 'hero_bean_jar', None,
        grip=((.07, .02, 0), RT, FRONT), grip2=((0, .19, .07), RT, FRONT),
        collision=[cap((0, .012, 0), (0, .2, 0), .074)], tangents=True)
    return reg


ITEM_ORDER = ['xiaolongbao', 'guantangbao', 'shengjian', 'tangyuan', 'tangyuan-meat', 'youtiao',
              'xiekehuang', 'dabing', 'congyoubing', 'cifangao', 'youdunzi', 'chunjuan',
              'ligaotang-piece', 'ligaotang-box-open', 'wuxiangdou-packet', 'teacup-filled',
              'chopsticks-pair', 'vinegar-dish', 'bowl-tangyuan', 'bowl-jiuniang', 'bowl-soymilk',
              'plate-paigu-niangao', 'steamer-xiaolongbao-8',
              'bean-single', 'bean-dish', 'bean-packet-open', 'bean-jar']

BEAN_IDS = {'bean-single', 'bean-dish', 'bean-packet-open', 'bean-jar'}
