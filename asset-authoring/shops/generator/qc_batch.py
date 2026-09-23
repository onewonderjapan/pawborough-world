"""Central QC for the 6-shop batch: GLB readability, spec bounds/axis, tris,
textures surviving export, sidecars and views present. Pure python, run once.

Usage: python3 generator/qc_batch.py out/ qc-report.json
"""
import json, struct, sys, hashlib
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'out')
REPORT = Path(sys.argv[2] if len(sys.argv) > 2 else 'qc-report.json')
SPEC = json.loads((OUT.parent.parent / 'control' / 'DESIGN_SPEC.json').read_text()) if (OUT.parent.parent / 'control' / 'DESIGN_SPEC.json').exists() else None
IDS = ['shop-01-narrow', 'shop-02-double', 'shop-03-threebay', 'shop-04-recess', 'shop-05-corner', 'shop-06-endcap']
VIEWS = ['front', 'side', 'rear', 'threeq']


def glb_info(path):
    data = path.read_bytes()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a GLB'
    clen, ctype = struct.unpack_from('<II', data, 12)
    j = json.loads(data[20:20 + clen])
    bin_chunk = data[20 + clen:]
    # position accessor min/max per mesh, mapped through the node tree
    acc_minmax = []
    for m in j.get('meshes', []):
        for prim in m['primitives']:
            a = j['accessors'][prim['attributes']['POSITION']]
            acc_minmax.append((a.get('min'), a.get('max'), prim.get('indices'), a['count']))
    tris = 0
    for m in j.get('meshes', []):
        for prim in m['primitives']:
            if 'indices' in prim:
                tris += j['accessors'][prim['indices']]['count'] // 3
            else:
                tris += acc_minmax[-1][3] // 3
    mn = [min(a[0][k] for a in acc_minmax) for k in range(3)]
    mx = [max(a[1][k] for a in acc_minmax) for k in range(3)]
    images = [i.get('mimeType', '?') for i in j.get('images', [])]
    materials = [m.get('name') for m in j.get('materials', [])]
    return {'boundsMin': mn, 'boundsMax': mx, 'tris': tris, 'images': images,
            'materials': materials, 'meshes': len(j.get('meshes', [])),
            'bytes': length, 'sha256': hashlib.sha256(data).hexdigest()}


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(26)
    assert head[:8] == b'\x89PNG\r\n\x1a\n', 'not png'
    w, h = struct.unpack('>II', head[16:24])
    return w, h


report = {'units': {}, 'pass': True}
spec_by_id = {v['id']: v for v in SPEC['variants']} if SPEC else {}
for uid in IDS:
    d = OUT / uid
    row = {'dir': str(d), 'checks': {}, 'fail': []}
    req = ['model.glb', 'model.blend', 'collision.json', 'materials.json', 'measurements.json', 'reimport-check.json', 'recipe-copy.json']
    for f in req:
        ok = (d / f).exists()
        row['checks'][f] = ok
        if not ok:
            row['fail'].append(f'missing {f}')
    try:
        info = glb_info(d / 'model.glb')
        row['glb'] = info
        mn, mx = info['boundsMin'], info['boundsMax']
        meas = json.loads((d / 'measurements.json').read_text())
        design = meas['design']
        W, D = design['frontageM'], design['depthM']
        E, Rg = design['eaveM'], design['ridgeM']
        spec = spec_by_id.get(uid, {})
        def near(a, b, tol=0.011):
            return abs(a - b) <= tol
        c = row['checks']
        c['axis-Yup-front+Z'] = (mn[2] < 0.36 and mx[2] < 0.36 and mn[1] > -0.02 and mn[0] > -(W / 2 + 0.35))
        c['width-matches-spec'] = near(mx[0] - mn[0], W + 2 * design['eaveOverhangSideM'], 0.03) if not spec or near(W, spec['width']) else False
        c['dims-match-design'] = near(mx[0] - mn[0], W + 2 * design['eaveOverhangSideM'], 0.03) and near(-mn[2], D + design['eaveOverhangFrontM'], 0.03)
        c['ridge-height'] = abs(mx[1] - (Rg + 0.30)) < 0.02
        c['sits-on-ground'] = abs(mn[1]) < 0.011
        c['tris-within-target'] = info['tris'] <= design['trisTarget']
        c['has-pbr-textures'] = 'image/jpeg' in info['images'] and len(info['materials']) >= 7
        reimp = json.loads((d / 'reimport-check.json').read_text())
        c['reimport-materials-textured'] = all(
            len(m['imageNodes']) > 0 for m in reimp['materials'] if any(k in m['name'] for k in ('plaster', 'brick', 'tile', 'timber')))
        failed_asserts = [a for a in meas.get('assertions', []) if not a['ok']]
        c['build-assertions'] = not failed_asserts
        if failed_asserts:
            row['fail'].append(f"assertions: {failed_asserts}")
        for k, v in c.items():
            if not v:
                row['fail'].append(k)
    except Exception as e:
        row['fail'].append(f'glb parse: {e}')
    vrow = {}
    for v in VIEWS:
        vp = d / 'views' / f'{v}.png'
        if vp.exists() and vp.stat().st_size > 30000:
            w, h = png_size(vp)
            vrow[v] = f'{w}x{h}'
            if min(w, h) < 700:
                row['fail'].append(f'view {v} too small {w}x{h}')
        else:
            vrow[v] = None
            row['fail'].append(f'missing view {v}')
    row['views'] = vrow
    if row['fail']:
        report['pass'] = False
    report['units'][uid] = row

report['summary'] = {
    'units': len(IDS),
    'totalTris': sum(r.get('glb', {}).get('tris', 0) for r in report['units'].values()),
    'totalGlbBytes': sum(r.get('glb', {}).get('bytes', 0) for r in report['units'].values()),
    'allPass': report['pass'],
}
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for uid, r in report['units'].items():
    print(('PASS' if not r['fail'] else 'FAIL'), uid, r.get('glb', {}).get('tris'), 'tris', r['fail'] or '')
print('SUMMARY', json.dumps(report['summary']))
