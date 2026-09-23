#!/usr/bin/env python3
"""Build props/manifest.json: per-GLB sha256/bytes/textureBytes/tris + totals."""
import json
import sys
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WS / 'tools'))
import glbtools  # noqa: E402

SPEC = json.loads((WS.parent / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
items = {}
tot_tex = 0
tot_bytes = 0
for it in SPEC['items']:
    id_ = it['id']
    p = glbtools.parse(WS / 'props' / (id_ + '.glb'))
    g = p['json']
    imgs = glbtools.images_info(g)
    tex = sum(i['bytes'] for i in imgs)
    flat = glbtools.flat_nodes(g)
    tri = {}
    for lod in range(3):
        nm = '%s_LOD%d' % (id_, lod)
        n = next((q for q in flat if q['name'] == nm), None)
        tri['LOD%d' % lod] = glbtools.mesh_tris(g, n['node']['mesh']) if n and 'mesh' in n['node'] else None
    if id_ == 'bean-single':
        tri = {'LOD0': 0, 'LOD1': 0, 'LOD2': 0}
        for rn in range(1, 7):
            for lod in range(3):
                n = next((q for q in flat if q['name'] == 'wuxiangdou-bean-v%d_LOD%d' % (rn, lod)), None)
                if n:
                    tri['LOD%d' % lod] = (tri['LOD%d' % lod] or 0) + glbtools.mesh_tris(g, n['node']['mesh'])
    items[id_] = {'file': 'props/%s.glb' % id_, 'sha256': p['sha256'], 'bytes': p['bytes'],
                  'textureBytes': tex, 'triangles': tri,
                  'images': [i['name'] for i in imgs]}
    tot_tex += tex
    tot_bytes += p['bytes']

manifest = {'package': SPEC['packageId'], 'generated': '2026-09-21',
            'coordinateContract': SPEC['coordinateContract']['glb'],
            'totalEncodedTextureBytes': tot_tex,
            'totalEncodedTextureBytesMax': SPEC['budgets']['totalEncodedTextureBytesMax'],
            'totalGlbBytes': tot_bytes, 'items': items}
out = WS / 'props' / 'manifest.json'
out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('MANIFEST_OK texture bytes %d / cap %d, glb bytes %d'
      % (tot_tex, SPEC['budgets']['totalEncodedTextureBytesMax'], tot_bytes))
