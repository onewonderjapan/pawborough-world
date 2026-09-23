#!/usr/bin/env python3
"""Merge per-item props/catalog/<id>.json into props/catalog.json."""
import json
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
PKG = WS.parent
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
out = {'package': SPEC['packageId'],
       'coordinate': SPEC['coordinateContract']['glb'],
       'nodeLayout': SPEC['nodeLayout']['children'],
       'items': {}}
for it in SPEC['items']:
    f = WS / 'props/catalog' / (it['id'] + '.json')
    if f.exists():
        out['items'][it['id']] = json.loads(f.read_text(encoding='utf-8'))
    else:
        out['items'][it['id']] = {'missing': True}
(WS / 'props/catalog.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
print('CATALOG_OK', len(out['items']), 'items')
