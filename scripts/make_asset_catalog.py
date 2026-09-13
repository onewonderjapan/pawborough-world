"""Build asset-catalog.json from module sidecars + instances + neighbors provenance."""
import json, hashlib
from pathlib import Path

WS = Path(__file__).resolve().parents[1]
BUILD = WS / 'building'
PKG = WS.parent
NIGHT = PKG / 'inputs/night.lock' if False else None

MODULE_IDS = {
    'plain-v1': {'family': 'plain', 'variant': 'v1', 'name': '普通店宅·有招牌A', 'origin': 'new this night'},
    'plain-v2': {'family': 'plain', 'variant': 'v2', 'name': '普通店宅·有招牌B', 'origin': 'new this night'},
    'plain-v3': {'family': 'plain', 'variant': 'v3', 'name': '普通店宅·无大招牌', 'origin': 'new this night'},
    'pharmacy_shop': {'family': 'pharmacy', 'variant': 'base', 'name': '国药号（童涵春字样）', 'origin': 'derived from baseline 檐下三间'},
    'cloth_shop': {'family': 'cloth', 'variant': 'base', 'name': '布庄（協大祥字样）', 'origin': 'derived from baseline 檐下三间'},
    'curio-a': {'family': 'curio', 'variant': 'a-silver', 'name': '银楼/器物店', 'origin': 'new this night'},
    'curio-b': {'family': 'curio', 'variant': 'b-calligraphy', 'name': '字画店（小器物家族变体）', 'origin': 'new this night'},
    'restaurant-a': {'family': 'restaurant', 'variant': 'a-main-hall', 'name': '饭馆/小酒楼·主堂', 'origin': 'new this night'},
    'restaurant-b': {'family': 'restaurant', 'variant': 'b-small-eatery', 'name': '饭馆·小菜饭馆', 'origin': 'new this night'},
    'cat_corner': {'family': 'cat-corner', 'variant': 'base', 'name': '猫墙节点（2023特色）', 'origin': 'derived from baseline cat-corner'},
    'corner': {'family': 'corner', 'variant': 'branch-corner', 'name': '转角/弄口单元', 'origin': 'new this night'},
    'photo_shop': {'family': 'photo', 'variant': 'base', 'name': '照相馆（Luna修正候选）', 'origin': 'inputs/neighbors, copied unchanged'},
    'dry_goods_shop': {'family': 'dry-goods', 'variant': 'base', 'name': '南北货店（Luna修正候选）', 'origin': 'inputs/neighbors, copied unchanged'},
}

entries = []
total_tris = 0
total_bytes = 0
for mid, meta in MODULE_IDS.items():
    d = BUILD / mid
    meas = json.loads((d / 'measurements.json').read_text(encoding='utf-8'))
    col = json.loads((d / 'collision.json').read_text(encoding='utf-8'))
    glb = d / 'model.glb'
    sha = hashlib.sha256(glb.read_bytes()).hexdigest()
    n_col = len(col.get('colliders', []))
    entries.append({
        'id': mid,
        'family': meta['family'],
        'variant': meta['variant'],
        'displayName': meta['name'],
        'origin': meta['origin'],
        'glb': str(glb.relative_to(WS)),
        'blend': str((d / 'model.blend').relative_to(WS)),
        'buildScript': ('building/build_new_unit.py -- ' + mid) if (d / 'model.blend').exists() and mid.startswith(('plain', 'curio', 'restaurant', 'corner')) else ('building/build_legacy_unit.py -- ' + mid if mid in ('cloth_shop', 'pharmacy_shop') else 'building/build_catwall.py' if mid == 'cat_corner' else 'copied from inputs/neighbors (read-only source)'),
        'sha256': sha,
        'bytes': meas['fileBytes'],
        'triangles': meas['triangles'],
        'designMeters': {k: meas['design'].get(k) for k in ('frontageM', 'depthM', 'eaveM', 'ridgeM', 'eaveMarginM', 'frontProtrusionM')},
        'colliders': n_col,
        'validator': 'see runs/validation.json (final pass)',
        'status': 'candidate; not owner-adopted canon',
    })
    total_tris += meas['triangles']
    total_bytes += meas['fileBytes']

catalog = {
    'axis': 'GLB Y-up, facade +Z, depth -Z, front-wall center bottom origin',
    'palette': ['gray tile', 'deep red-brown timber', 'light wall', 'stone/brick base', 'gold lettering'],
    'era': [1990, 2000],
    'catWallException': 2023,
    'repeatPolicy': 'existing templates may repeat; plain shop-house type repeats <= 3 per variant',
    'placementUsage': {mid: sum(1 for i in json.loads((WS / 'world/instances.json').read_text(encoding='utf-8'))['instances'] if i['module'] == mid)
                       for mid in MODULE_IDS},
    'uniqueAssetTotals': {'triangles': total_tris, 'bytes': total_bytes,
                          'bytesBudget': 35_000_000, 'withinBudget': total_bytes <= 35_000_000},
    'modules': entries,
}
(WS / 'world' / 'asset-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('CATALOG modules=%d tris=%d bytes=%d (%.1f MB)' % (len(entries), total_tris, total_bytes, total_bytes / 1e6))
print('placements:', json.dumps(catalog['placementUsage'], ensure_ascii=False))
