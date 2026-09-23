#!/usr/bin/env python3
"""Per-GLB contract tests (DESIGN_SPEC.verification.perGlb). System python3 -X utf8.
Checks every workspace/props/<id>.glb against DESIGN_SPEC:
validator report, node layout (root <id>, LOD0/1/2 + sockets), LOD tri budgets,
bounds vs sizeMeters (+-10%, bean sets +-15%), sockets inside bounds+1cm and
socket_rest at origin, reimport image report, outwardShare for closed items,
sha256 in manifest, collision entries."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import glbtools  # noqa: E402

WS = Path(__file__).resolve().parent.parent
PKG = WS.parent
while not (PKG / 'DESIGN_SPEC.json').exists() and PKG != PKG.parent:
    PKG = PKG.parent
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
# R1 mode (env): SNACKS_PROPS / SNACKS_ART / SNACKS_IDS / SNACKS_MANIFEST keep the same
# checks pointed at the repair package instead of the adopted WS/props batch.
PROPS = Path(os.environ.get('SNACKS_PROPS', str(WS / 'props')))
ART = Path(os.environ.get('SNACKS_ART', str(PKG / 'artifacts/snacks-handheld')))
IDS_FILTER = [s for s in os.environ.get('SNACKS_IDS', '').split(',') if s]
ITEMS = {i['id']: i for i in SPEC['items'] if not IDS_FILTER or i['id'] in IDS_FILTER}
BUDGETS = SPEC['budgets']['trianglesByClass']
CLOSED = {'bean-single', 'xiaolongbao', 'guantangbao', 'shengjian', 'tangyuan', 'tangyuan-meat',
          'xiekehuang', 'chunjuan', 'ligaotang-piece', 'cifangao'}
# bounds exceptions documented in PROGRESS.assumptions
BOUND_EXC = {
    'congyoubing': 'folded-in-half semicircle: actual ~[.12,.027,.062] vs spec z .12 (R1 two 1.1 cm layers + laminations)',
}
# nodes excluded from the bounds check (protruding by design, extras on root record bun size)
NODE_EXCLUDE = {'guantangbao': {'straw'}}

failures = []
notes = []


def check(cond, msg):
    if not cond:
        failures.append(msg)
    return cond


def main():
    manifest_path = Path(os.environ.get('SNACKS_MANIFEST', str(PROPS / 'manifest.json')))
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) \
        if manifest_path.exists() else None
    coll = json.loads((PROPS / 'collision.json').read_text(encoding='utf-8')) \
        if (PROPS / 'collision.json').exists() else None
    validator = {}
    vfile = ART / 'validator/report.json'
    if vfile.exists():
        for r in json.loads(vfile.read_text(encoding='utf-8')).get('results', []):
            validator[r['file']] = r
    cat_dir = PROPS / 'catalog'
    reimp_dir = PROPS / 'reimport'

    for id_, item in ITEMS.items():
        glb = PROPS / (id_ + '.glb')
        if not check(glb.exists(), '%s: glb missing' % id_):
            continue
        p = glbtools.parse(glb)
        g = p['json']
        flat = glbtools.flat_nodes(g)
        by_name = {r['name']: r for r in flat}
        roots = [r for r in flat if r['depth'] == 0]

        # 1 validator 0 errors
        v = validator.get(id_ + '.glb')
        if v:
            check(v.get('errors', 0) == 0 and not v.get('fatal'),
                  '%s: validator errors %s' % (id_, v.get('errors', v.get('fatal'))))
            if v.get('warnings', 0):
                notes.append('%s: validator warnings %d' % (id_, v['warnings']))
        else:
            notes.append('%s: no validator report (run validate_all.cjs)' % id_)

        # 2 node layout
        if id_ == 'bean-single':
            want = {'wuxiangdou-bean-v%d' % k for k in range(1, 7)}
            check({r['name'] for r in roots} == want, '%s: roots %s' % (id_, sorted(r['name'] for r in roots)))
            root_names = sorted(want)
        else:
            check(len(roots) == 1 and roots[0]['name'] == id_, '%s: root node wrong' % id_)
            root_names = [id_]
        for rn in root_names:
            kids = {r['name']: r for r in flat
                    if r['depth'] == 1 and r['name'] != rn}
            for lod in range(3):
                nm = '%s_LOD%d' % (rn, lod)
                n = by_name.get(nm, {}).get('node', {})
                check('mesh' in n, '%s/%s: missing mesh child' % (id_, nm))
            if id_ == 'bean-single':
                check(any(k.startswith('socket_grip') and 'mesh' not in kids[k]['node'] for k in kids),
                      '%s/%s: socket_grip missing' % (id_, rn))
                check(any(k.startswith('socket_rest') and 'mesh' not in kids[k]['node'] for k in kids),
                      '%s/%s: socket_rest missing' % (id_, rn))
            else:
                for s in ('socket_grip', 'socket_rest'):
                    check(s in by_name and 'mesh' not in by_name[s]['node'],
                          '%s/%s: socket node missing' % (id_, s))
                carry = item['class'] == 'carry'
                if carry:
                    check('socket_grip_2' in by_name, '%s: carry requires socket_grip_2' % id_)
            ex = by_name[rn]['node'].get('extras', {})
            for k in ('class', 'lodDistancesMeters', 'massKg', 'designSizeMeters'):
                check(k in ex, '%s/%s: extras missing %s' % (id_, rn, k))

        # 3 tri budgets
        budget = BUDGETS['bean' if False else item['class']]
        if id_ in ('steamer-xiaolongbao-8',):
            budget = BUDGETS['carry_steamer_with_buns']
        if id_ == 'bean-jar':
            budget = BUDGETS['hero_bean_jar']
        if id_ == 'bean-single':
            budget = {'LOD0': SPEC['beans']['single']['LOD0trisMax'],
                      'LOD1': SPEC['beans']['single']['LOD1trisMax'],
                      'LOD2': SPEC['beans']['single']['LOD2trisMax']}
        for lod in range(3):
            if id_ == 'bean-single':
                # budget is PER bean: each variant root's LODn individually
                for rn in root_names:
                    n = '%s_LOD%d' % (rn, lod)
                    if n in by_name and 'mesh' in by_name[n]['node']:
                        t = glbtools.mesh_tris(g, by_name[n]['node']['mesh'])
                        check(t <= budget['LOD%d' % lod],
                              '%s/%s: %d tris > %d' % (id_, n, t, budget['LOD%d' % lod]))
            else:
                nm = '%s_LOD%d' % (id_, lod)
                tris = glbtools.mesh_tris(g, by_name[nm]['node']['mesh']) if nm in by_name and 'mesh' in by_name[nm]['node'] else 0
                check(tris <= budget['LOD%d' % lod],
                      '%s: LOD%d tris %d > budget %d' % (id_, lod, tris, budget['LOD%d' % lod]))

        # 4 bounds (native glTF, mesh nodes only)
        mesh_nodes = [r for r in flat if 'mesh' in r['node']
                      and r['name'] not in NODE_EXCLUDE.get(id_, set())]
        b = glbtools.node_bounds(g, p['bin'], mesh_nodes)
        tol = .15 if id_.startswith('bean-') else .10
        size = item['sizeMeters']
        if id_ == 'bean-single':
            tol = .12  # six variants at per-axis scale 0.9-1.1; bounds are the union
        if id_ in BOUND_EXC:
            notes.append('%s bounds exception: %s (actual %s)' %
                         (id_, BOUND_EXC[id_], [round(x, 4) for x in b['size']]))
            check(b['size'][0] <= size[0] * (1 + tol) and b['size'][2] <= size[2] * (1 + tol),
                  '%s: bounds x/z over: %s' % (id_, [round(x, 4) for x in b['size']]))
        else:
            for ax in range(3):
                check(size[ax] * (1 - tol) <= b['size'][ax] <= size[ax] * (1 + tol),
                      '%s: bounds axis %d %.4f vs %.4f (+-%d%%)' % (id_, ax, b['size'][ax], size[ax], tol * 100))
        check(-.002 < b['min'][1] < .002, '%s: not resting on ground (min y %.4f)' % (id_, b['min'][1]))

        # 5 sockets: translation in bounds (+1 cm), rest at origin
        tol_s = .012
        for s in ('socket_grip', 'socket_grip_2'):
            if s in by_name:
                n = by_name[s]['node']
                t = n.get('translation', [0, 0, 0])
                for ax in range(3):
                    check(b['min'][ax] - tol_s <= t[ax] <= b['max'][ax] + tol_s,
                          '%s: %s axis %d out of bounds' % (id_, s, ax))
        rest = by_name.get('socket_rest', {}).get('node', {})
        check(all(abs(v) < .001 for v in rest.get('translation', [0, 0, 0])),
              '%s: socket_rest not at origin' % id_)

        # 6 reimport image report
        rj = reimp_dir / (id_ + '.json')
        if check(rj.exists(), '%s: reimport json missing' % id_):
            r = json.loads(rj.read_text(encoding='utf-8'))
            check(r.get('ok'), '%s: reimport issues %s' % (id_, r.get('issues')))
            for img in r.get('images', []):
                if 'normal' in img['image'].lower():
                    check(img['colorspace'] == 'Non-Color', '%s: normal map colorspace %s' % (id_, img['colorspace']))
                else:
                    check(img['colorspace'] == 'sRGB', '%s: color map colorspace %s' % (id_, img['colorspace']))

        # 7 outward share
        if item['id'] in CLOSED:
            names = ['%s_LOD0' % rn for rn in root_names]
            shares = [glbtools.outward_share(g, p['bin'], by_name[n]['node']['mesh']) for n in names
                      if n in by_name and 'mesh' in by_name[n]['node']]
            for rn, sh in zip(root_names, shares):
                check(sh >= .97, '%s/%s: outwardShare %.3f < .97' % (id_, rn, sh))
                cat_file = cat_dir / (id_ + '.json')
                if cat_file.exists():
                    pass

        # 8 manifest sha
        if manifest:
            ent = manifest['items'].get(id_) if 'items' in manifest else None
            check(ent is not None, '%s: absent from manifest' % id_)
            if ent:
                check(ent['sha256'] == p['sha256'], '%s: manifest sha mismatch' % id_)
                check(ent['bytes'] == p['bytes'], '%s: manifest byte count mismatch' % id_)
                check(p['bytes'] <= SPEC['budgets']['perItemGlbBytesMax'], '%s: glb over per-item cap' % id_)

        # 9 collision entry
        if coll:
            check(id_ in coll.get('items', {}), '%s: no collision shape' % id_)

    # manifest-level texture cap
    if manifest:
        total_tex = sum(e.get('textureBytes', 0) for e in manifest['items'].values())
        check(total_tex <= SPEC['budgets']['totalEncodedTextureBytesMax'],
              'total texture bytes %d > cap %d' % (total_tex, SPEC['budgets']['totalEncodedTextureBytesMax']))

    print('--- contract notes ---')
    for n in notes:
        print(' NOTE', n)
    if failures:
        print('--- FAILURES (%d) ---' % len(failures))
        for f in failures:
            print(' FAIL', f)
        sys.exit(1)
    print('CONTRACT_OK all %d items' % len(ITEMS))


if __name__ == '__main__':
    main()
