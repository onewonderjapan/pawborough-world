import sys, json
from pathlib import Path
sys.path.insert(0, 'tools'); sys.path.insert(0, '.')
import glbtools
SPEC = json.loads(Path('DESIGN_SPEC.json').read_text()) if Path('DESIGN_SPEC.json').exists() else json.loads(Path('../DESIGN_SPEC.json').read_text())
ITEMS = {i['id']: i for i in SPEC['items']}
B = SPEC['budgets']['trianglesByClass']
for id_ in sorted(p.stem for p in Path('props').glob('*.glb')):
    p = glbtools.parse('props/%s.glb' % id_)
    g = p['json']
    flat = glbtools.flat_nodes(g)
    by = {r['name']: r for r in flat}
    it = ITEMS[id_]
    bud = B['carry_steamer_with_buns'] if id_ == 'steamer-xiaolongbao-8' else B['hero_bean_jar'] if id_ == 'bean-jar' else B[it['class']]
    mesh_nodes = [r for r in flat if 'mesh' in r['node'] and not (id_ == 'guantangbao' and r['name'] == 'straw')]
    b = glbtools.node_bounds(g, p['bin'], mesh_nodes)
    tris = []
    for lod in range(3):
        n = '%s_LOD%d' % (id_, lod)
        tris.append(glbtools.mesh_tris(g, by[n]['node']['mesh']) if n in by and 'mesh' in by[n]['node'] else -1)
    ok = all(t <= bud['LOD%d' % l] for l, t in enumerate(tris))
    print('%-24s tris %4d/%4d/%4d bud %5d/%5d/%5d %s | size %.3f %.3f %.3f vs %s' % (
        id_, tris[0], tris[1], tris[2], bud['LOD0'], bud['LOD1'], bud['LOD2'], 'OK' if ok else 'OVER',
        b['size'][0], b['size'][1], b['size'][2], it['sizeMeters']))
