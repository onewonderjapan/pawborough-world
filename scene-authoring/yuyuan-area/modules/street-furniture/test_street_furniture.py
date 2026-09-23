"""Street furniture delivery tests (system python3, no Blender needed).

Independent verification of the 10 GLBs in the out dir — the builder's own
self-checks are NOT trusted here; everything is re-parsed from the binary GLBs
and the sidecar JSONs:

  1. 10 GLBs exist, one per config item
  2. bounds (from POSITION accessor min/max) within sizeM ±10% per axis
  3. origin at ground footprint centre: min.y ~ 0, x/z centre within 3 cm
  4. tris <= per-item budget (indices counted from the GLB, not the builder)
  5. zero images / textures (monochrome constant materials only)
  6. sha256 + byte size match props.catalog.json
  7. collision.json: one box per item, size == sizeM, resting on y=0
  8. reimport-check.json: every item reimported, imageCount == 0
  9. Khronos validator: 0 errors per GLB (node scripts/validate_all.cjs)

Run:
  python3 -X utf8 test_street_furniture.py \
      --out ../../out-street-furniture \
      --config ../../../kit/props2.config.json \
      --validator-report ../../out-street-furniture/validation-report.json
(exit 0 = all gates pass; any failure exits 1 with FAILED lines)
"""
import argparse
import hashlib
import json
import struct
import subprocess
import sys
from pathlib import Path

VALIDATOR = Path('/home/baibai/work/onewonderjapan/pawborough-world/scripts/validate_all.cjs')

p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--config', type=Path, required=True)
p.add_argument('--validator-report', type=Path, default=None)
p.add_argument('--skip-validator', action='store_true',
               help='skip the node validator run (report must already exist)')
a = p.parse_args()

cfg = json.loads(a.config.read_text(encoding='utf-8'))
failures = []
checks = 0


def check(cond, ok_msg, fail_msg):
    global checks
    checks += 1
    if cond:
        print(f'  ok  {ok_msg}')
    else:
        print(f'FAIL  {fail_msg}')
        failures.append(fail_msg)


def glb_json_and_tris(path):
    """Parse a binary GLB: return (parsed JSON chunk, total triangle count,
    bounds min/max from POSITION accessors, mesh count)."""
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, f'{path.name}: not a GLB v2'
    chunk_len, chunk_type = struct.unpack_from('<II', data, 12)
    assert chunk_type == 0x4E4F534A, f'{path.name}: first chunk is not JSON'
    gltf = json.loads(data[20:20 + chunk_len].decode('utf-8'))
    tris, mn, mx, meshes = 0, None, None, 0
    for mesh in gltf.get('meshes', []):
        meshes += 1
        for prim in mesh['primitives']:
            acc = gltf['accessors']
            pos = acc[prim['attributes']['POSITION']]
            lo, hi = pos['min'], pos['max']
            mn = lo if mn is None else [min(a, b) for a, b in zip(mn, lo)]
            mx = hi if mx is None else [max(a, b) for a, b in zip(mx, hi)]
            if 'indices' in prim:
                tris += acc[prim['indices']]['count'] // 3
            else:
                tris += pos['count'] // 3
    return gltf, tris, mn, mx, meshes


print(f'== street furniture delivery tests ==\n   out={a.out}')
items = cfg['items']
ids = [i['id'] for i in items]
check(len(ids) == 10, f'{len(ids)} items in config', f'config has {len(ids)} items, expected 10')

catalog_path = a.out / 'props.catalog.json'
collision_path = a.out / 'collision.json'
reimport_path = a.out / 'reimport-check.json'
catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
collision = json.loads(collision_path.read_text(encoding='utf-8'))
reimport = json.loads(reimport_path.read_text(encoding='utf-8'))

glb_data = {}
for item in items:
    item_id = item['id']
    print(f'-- {item_id}')
    glb_path = a.out / item['glb']
    if not glb_path.exists():
        check(False, '', f'{item_id}: missing {item["glb"]}')
        continue
    gltf, tris, mn, mx, meshes = glb_json_and_tris(glb_path)
    glb_data[item_id] = tris
    size_act = [round(mx[k] - mn[k], 4) for k in range(3)]
    spec = item['sizeM']
    for k, axis in enumerate('xyz'):
        lo, hi = spec[k] * 0.9 - 1e-6, spec[k] * 1.1 + 1e-6
        check(lo <= size_act[k] <= hi,
              f'bounds {axis}: {size_act[k]} in [{lo:.3f},{hi:.3f}]',
              f'{item_id}: bounds {axis} {size_act[k]} outside [{lo:.3f},{hi:.3f}]')
    check(abs(mn[1]) <= 0.005, f'ground y_min={mn[1]:.4f}', f'{item_id}: min.y {mn[1]} not at ground')
    for k, axis in ((0, 'x'), (2, 'z')):
        centre = (mn[k] + mx[k]) / 2
        check(abs(centre) <= 0.03, f'{axis}-centre {centre:+.4f}',
              f'{item_id}: {axis}-centre {centre} off origin')
    check(tris <= item['trisMax'], f'tris {tris} <= {item["trisMax"]}',
          f'{item_id}: tris {tris} > budget {item["trisMax"]}')
    check(not gltf.get('images') and not gltf.get('textures'),
          'zero images/textures', f'{item_id}: GLB carries images/textures')
    check(len(gltf.get('materials', [])) >= 1, f'{len(gltf.get("materials", []))} materials',
          f'{item_id}: no materials in GLB')
    # catalog cross-check
    rec = catalog['items'].get(item_id)
    if rec is None:
        check(False, '', f'{item_id}: missing from props.catalog.json')
        continue
    raw = glb_path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    check(rec['sha256'] == sha and rec['fileBytes'] == len(raw),
          f'catalog sha256/bytes match ({len(raw)} B)',
          f'{item_id}: catalog sha256/bytes mismatch')
    check(rec['triangles'] == tris, f'catalog tris match ({tris})',
          f'{item_id}: catalog tris {rec["triangles"]} != GLB {tris}')
    # collision cross-check
    boxes = collision.get(item_id)
    if not boxes or len(boxes) != 1 or boxes[0].get('type') != 'box':
        check(False, '', f'{item_id}: collision.json must hold exactly one box')
    else:
        b = boxes[0]
        check([round(b['max'][k] - b['min'][k], 6) for k in range(3)] == [round(v, 6) for v in spec]
              and abs(b['min'][1]) < 1e-6,
              'collision box == sizeM on y=0',
              f'{item_id}: collision box {b["min"]}/{b["max"]} != spec {spec}')
    # reimport cross-check
    rc = reimport.get(item_id)
    check(bool(rc) and rc.get('imported') and rc.get('imageCount') == 0
          and rc.get('meshes', 0) >= 1,
          'reimport check passed, 0 images',
          f'{item_id}: reimport check missing/failed: {rc}')

print('-- totals')
total_tris = sum(glb_data.values())
check(catalog['totals']['uniqueTris'] == total_tris,
      f'catalog totals uniqueTris={total_tris}',
      f'catalog totals {catalog["totals"]["uniqueTris"]} != GLB sum {total_tris}')
check(catalog['totals']['items'] == 10, 'catalog holds 10 items',
      f'catalog holds {catalog["totals"]["items"]} items')
check(catalog['totals']['uniqueTris'] <= cfg['budgets']['uniqueTrisMax'],
      f'module uniqueTris {total_tris} <= {cfg["budgets"]["uniqueTrisMax"]}',
      f'module uniqueTris {total_tris} > {cfg["budgets"]["uniqueTrisMax"]}')

print('-- khronos validator')
report_path = a.validator_report or (a.out / 'validation-report.json')
if a.skip_validator and not report_path.exists():
    check(False, '', f'validator report missing: {report_path}')
elif not a.skip_validator:
    files = ','.join(item['glb'] for item in items)
    cmd = ['node', str(VALIDATOR), '--files', files, '--root', str(a.out),
           '--report', str(report_path)]
    print('   $', ' '.join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stdout[-2000:], proc.stderr[-2000:])
    check(proc.returncode == 0, f'validate_all.cjs exit 0',
          f'validator exit {proc.returncode} (see {report_path})')
if report_path.exists():
    report = json.loads(report_path.read_text(encoding='utf-8'))
    for res in report.get('results', []):
        errors = res.get('errorCount', res.get('errors', 0))
        warnings = res.get('warningCount', res.get('warnings', 0))
        check(errors == 0, f'{res["file"]}: validator 0 errors ({warnings} warnings)',
              f'{res["file"]}: validator {errors} errors')

print(f'\n== {checks} checks, {len(failures)} failures ==')
for f in failures:
    print('FAILED:', f)
sys.exit(1 if failures else 0)
