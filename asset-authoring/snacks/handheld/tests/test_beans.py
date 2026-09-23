#!/usr/bin/env python3
"""Bean-set contract tests (DESIGN_SPEC.verification.beanSets + beans.*).
System python3 -X utf8. Verifies from props/catalog/*.json (recorded placements)
AND from the raw GLBs (vertex-level vessel containment for dish/jar LOD0)."""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'kit'))
import glbtools  # noqa: E402
import bean_tex_stats  # noqa: E402

WS = Path(__file__).resolve().parent.parent
PKG = WS.parent
while not (PKG / 'DESIGN_SPEC.json').exists() and PKG != PKG.parent:
    PKG = PKG.parent
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
PROPS = Path(os.environ.get('SNACKS_PROPS', str(WS / 'props')))
IDS_FILTER = [s for s in os.environ.get('SNACKS_IDS', '').split(',') if s]
MEAN_R = (0.011 * 0.0045 * 0.0075) ** (1 / 3)
MIN_PAIR = 0.85 * MEAN_R
HALF_THICK = 0.0045      # R2 #1: bean half thickness (support geometry)
FLOOR_TOP = 0.003        # R2 #1: jar inner floor top (vessel() wall thickness)

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def bean_sets():
    # counts
    want = {'bean-dish': 45, 'bean-packet-open': 30, 'bean-jar': 260}
    data = {}
    for id_, n in want.items():
        if IDS_FILTER and id_ not in IDS_FILTER:
            continue
        cat = json.loads((PROPS / 'catalog' / (id_ + '.json')).read_text(encoding='utf-8'))
        bs = cat['beanSet']
        check(bs['got'] == n == bs['expected'], '%s: bean count %s != %d' % (id_, bs['got'], n))
        pos = bs['positions']
        check(len(pos) == n, '%s: %d positions recorded' % (id_, len(pos)))
        data[id_] = pos
        # min pair distance
        worst = 1e9
        for i in range(len(pos)):
            for j in range(i + 1, len(pos)):
                d = math.dist(pos[i], pos[j])
                worst = min(worst, d)
        check(worst >= MIN_PAIR, '%s: min pair dist %.4f < %.4f (0.85*meanR %.4f)'
              % (id_, worst, MIN_PAIR, MIN_PAIR))
        print(' %s: count %d, min pair dist %.4f mm (>= %.4f)' % (id_, len(pos), worst * 1000, MIN_PAIR * 1000))

    # packet spill: 12 within r<=0.06 of the spill centre
    if 'bean-packet-open' in data:
        spill = data['bean-packet-open'][18:]
        check(all(math.hypot(p[0] - .040, p[2] - .052) <= .062 for p in spill),
              'packet: spilled bean outside r=0.06')
    # R1 #5: jar filled to y=0.15 (spec) - top of the heap near the fill line, base on floor
    if 'bean-jar' in data:
        jy = max(p[1] for p in data['bean-jar'])
        check(jy <= .1505 and jy >= .130, 'jar: fill must reach y~0.15 (top centre %.3f)' % jy)
        check(min(p[1] for p in data['bean-jar']) < .015, 'jar: heap must start at the floor')
        print(' jar fill: top bean centre y=%.4f (fill line 0.15)' % jy)
        # R2 #1: gravity piling - every bean has support (floor or a bean top) within
        # 12 mm BELOW it; no floating administrative layers
        uns = 0
        worst_gap = 0.0
        for i, p in enumerate(data['bean-jar']):
            ok = (p[1] - HALF_THICK - FLOOR_TOP) <= .012      # floor support
            if ok:
                worst_gap = max(worst_gap, p[1] - HALF_THICK - FLOOR_TOP)
            for j, q in enumerate(data['bean-jar']):
                if j == i or q[1] >= p[1]:
                    continue
                if math.hypot(q[0] - p[0], q[2] - p[2]) <= .017:
                    gap = (p[1] - HALF_THICK) - (q[1] + HALF_THICK)
                    if gap <= .012:
                        ok = True
                        worst_gap = max(worst_gap, gap)
                        break
            if not ok:
                uns += 1
        check(uns == 0, 'jar: %d beans without support within 0.012 m below' % uns)
        print(' jar support: %d unsupported beans (worst gap %.2f mm)'
              % (uns, worst_gap * 1000))
        # R2 #1: the heap top reads as a slightly mounded surface, not a flat piston
        ys = sorted(p[1] for p in data['bean-jar'])
        core = sorted(p[1] for p in data['bean-jar'] if math.hypot(p[0], p[2]) < .030)
        rim = sorted(p[1] for p in data['bean-jar'] if math.hypot(p[0], p[2]) > .060)
        p90 = lambda v: v[min(len(v) - 1, int(.9 * len(v)))]
        rise = p90(core) - p90(rim)
        check(rise >= .008, 'jar: heap not mounded (core p90 - rim p90 = %.4f m)' % rise)
        print(' jar mound: core p90 %.4f vs rim p90 %.4f (rise %.1f mm)'
              % (p90(core), p90(rim), rise * 1000))
    # dish: 3 layers, hex jitter 15%: layers separable in y
    if 'bean-dish' in data:
        dy = sorted(p[1] for p in data['bean-dish'])
        check(dy[len(dy) // 3] - dy[0] > .004 and dy[2 * len(dy) // 3] - dy[len(dy) // 3] > .004,
              'dish: beans not in 3 separated layers')

    # GLB vertex level: dish & jar LOD0 bean vertices inside vessel
    for id_, floor, rin in (('bean-dish', .0045, .0405), ('bean-jar', .0048, .0742)):
        if IDS_FILTER and id_ not in IDS_FILTER:
            continue
        p = glbtools.parse(PROPS / (id_ + '.glb'))
        g = p['json']
        lod0 = next(r for r in glbtools.flat_nodes(g) if r['name'] == '%s_LOD0' % id_)
        groups = glbtools.read_positions(g, p['bin'], lod0['node']['mesh'])
        prims = g['meshes'][lod0['node']['mesh']]['primitives']
        # find the biggest primitive = merged beans (single material)
        biggest = max(range(len(prims)), key=lambda i: glbtools.mesh_tris(g, lod0['node']['mesh']) and i)
        sizes = []
        for i, prim in enumerate(prims):
            a = g['accessors'][prim['attributes']['POSITION']]
            sizes.append(a['count'])
        bi = sizes.index(max(sizes))
        pts = groups[bi]
        below = sum(1 for q in pts if q[1] < floor)
        outside = sum(1 for q in pts if math.hypot(q[0], q[2]) > rin)
        check(below == 0, '%s: %d bean vertices below vessel floor' % (id_, below))
        check(outside == 0, '%s: %d bean vertices outside inner radius' % (id_, outside))
        print(' %s: LOD0 bean prim %d verts, %d below floor, %d outside radius'
              % (id_, len(pts), below, outside))

    # bean-single: 6 roots, per-variant tri budgets, scale within 0.9-1.1
    if IDS_FILTER and 'bean-single' not in IDS_FILTER:
        if failures:
            print('--- BEAN FAILURES (%d) ---' % len(failures))
            for f in failures:
                print(' FAIL', f)
            sys.exit(1)
        print('BEANS_OK (subset)')
        return
    p = glbtools.parse(PROPS / 'bean-single.glb')
    g = p['json']
    roots = [r for r in glbtools.flat_nodes(g) if r['depth'] == 0]
    check(len(roots) == 6, 'bean-single: %d roots' % len(roots))
    check({r['name'] for r in roots} == {'wuxiangdou-bean-v%d' % k for k in range(1, 7)},
          'bean-single: root names')
    caps = SPEC['beans']['single']
    for r in roots:
        for lod, cap in ((0, caps['LOD0trisMax']), (1, caps['LOD1trisMax']), (2, caps['LOD2trisMax'])):
            nm = '%s_LOD%d' % (r['name'], lod)
            node = next((q for q in glbtools.flat_nodes(g) if q['name'] == nm), None)
            check(node is not None and 'mesh' in node['node'], 'bean-single/%s missing' % nm)
            if node:
                t = glbtools.mesh_tris(g, node['node']['mesh'])
                check(t <= cap, 'bean-single/%s: %d tris > %d' % (nm, t, cap))
        kids = {c['name'] for c in glbtools.flat_nodes(g)
                if any(cc == r['index'] for cc in [])}  # children resolved below
        # variant bounds within +-10% of single size (per-axis scale 0.9-1.1)
        meshnodes = [q for q in glbtools.flat_nodes(g) if q['name'].startswith(r['name'] + '_LOD')]
        b = glbtools.node_bounds(g, p['bin'], meshnodes)
        for ax in range(3):
            lo = SPEC['items'][23]['sizeMeters'][ax] * .88
            hi = SPEC['items'][23]['sizeMeters'][ax] * 1.12
            check(lo <= b['size'][ax] <= hi, 'bean-single/%s axis %d %.4f' % (r['name'], ax, b['size'][ax]))

    # R2 #2: bean atlas - base 8a6a48 dominant (>= 55% of each variant cell), sugar
    # frost 30-40% concentrated on the convex broad faces (sparse on the rim/groove
    # equator). Asserted on the generator atlas (1024 + 512) AND on the texture bytes
    # embedded in the delivered bean-single.glb.
    from PIL import Image
    import io

    def check_atlas(tag, img):
        stats = bean_tex_stats.measure(img)
        for st in stats:
            v = st['variant']
            check(st['baseFrac'] >= .55,
                  'bean-atlas %s v%d: base 8a6a48 %.3f < 0.55' % (tag, v, st['baseFrac']))
            check(.30 <= st['frostFrac'] <= .40,
                  'bean-atlas %s v%d: frost %.3f outside 30-40%%' % (tag, v, st['frostFrac']))
            check(st['frostPolar'] >= .28,
                  'bean-atlas %s v%d: convex-face frost %.3f < 0.28' % (tag, v, st['frostPolar']))
            check(st['frostEquator'] <= .06,
                  'bean-atlas %s v%d: rim frost %.3f > 0.06' % (tag, v, st['frostEquator']))
        print(' %s: base %.3f-%.3f, frost %.3f-%.3f, convex frost %.3f-%.3f vs rim %.3f-%.3f'
              % (tag,
                 min(s['baseFrac'] for s in stats), max(s['baseFrac'] for s in stats),
                 min(s['frostFrac'] for s in stats), max(s['frostFrac'] for s in stats),
                 min(s['frostPolar'] for s in stats), max(s['frostPolar'] for s in stats),
                 min(s['frostEquator'] for s in stats), max(s['frostEquator'] for s in stats)))

    kit_tex = WS / 'kit' / 'textures'
    check_atlas('atlas1024', Image.open(kit_tex / 'bean-colour-atlas.jpg'))
    check_atlas('atlas512', Image.open(kit_tex / 'bean-colour-atlas-512.jpg'))
    parsed_glbs = glbtools.parse(PROPS / 'bean-single.glb')
    gimg = parsed_glbs['json'].get('images', [])
    bv = parsed_glbs['json'].get('bufferViews', [])
    embedded = 0
    for im in gimg:
        nm = (im.get('name') or '') + (im.get('mimeType') or '')
        if 'bean-colour-atlas' not in nm:
            continue
        view = bv[im['bufferView']]
        blob = parsed_glbs['bin'][view.get('byteOffset', 0):
                                  view.get('byteOffset', 0) + view['byteLength']]
        check_atlas('embedded-glb', Image.open(io.BytesIO(blob)))
        embedded += 1
    check(embedded >= 1, 'bean-single.glb: bean colour atlas not found among embedded images')

    if failures:
        print('--- BEAN FAILURES (%d) ---' % len(failures))
        for f in failures:
            print(' FAIL', f)
        sys.exit(1)
    print('BEANS_OK')


if __name__ == '__main__':
    bean_sets()
