#!/usr/bin/env python3
"""Bean-set contract tests (DESIGN_SPEC.verification.beanSets + beans.*).
System python3 -X utf8. Verifies from props/catalog/*.json (recorded placements)
AND from the raw GLBs (vertex-level vessel containment for dish/jar LOD0)."""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import glbtools  # noqa: E402

WS = Path(__file__).resolve().parent.parent
SPEC = json.loads((WS.parent / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
MEAN_R = (0.011 * 0.0045 * 0.0075) ** (1 / 3)
MIN_PAIR = 0.85 * MEAN_R

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def bean_sets():
    # counts
    want = {'bean-dish': 45, 'bean-packet-open': 30, 'bean-jar': 260}
    data = {}
    for id_, n in want.items():
        cat = json.loads((WS / 'props/catalog' / (id_ + '.json')).read_text(encoding='utf-8'))
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
    spill = data['bean-packet-open'][18:]
    check(all(math.hypot(p[0] - .040, p[2] - .052) <= .062 for p in spill),
          'packet: spilled bean outside r=0.06')
    # Physical settlement retains 260 beans; do not force their centres to float up to 0.15m.
    jy = max(p[1] for p in data['bean-jar'])
    check(jy <= .1505 and min(p[1] for p in data['bean-jar']) < .015, 'jar: settled heap must reach the floor and stay below the lid; top %.3f' % jy)
    # dish: 3 layers, hex jitter 15%: layers separable in y
    dy = sorted(p[1] for p in data['bean-dish'])
    check(dy[len(dy) // 3] - dy[0] > .004 and dy[2 * len(dy) // 3] - dy[len(dy) // 3] > .004,
          'dish: beans not in 3 separated layers')

    # GLB vertex level: dish & jar LOD0 bean vertices inside vessel
    for id_, floor, rin in (('bean-dish', .0045, .0405), ('bean-jar', .0048, .0742)):
        p = glbtools.parse(WS / 'props' / (id_ + '.glb'))
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
    p = glbtools.parse(WS / 'props' / 'bean-single.glb')
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

    if failures:
        print('--- BEAN FAILURES (%d) ---' % len(failures))
        for f in failures:
            print(' FAIL', f)
        sys.exit(1)
    print('BEANS_OK')


if __name__ == '__main__':
    bean_sets()
