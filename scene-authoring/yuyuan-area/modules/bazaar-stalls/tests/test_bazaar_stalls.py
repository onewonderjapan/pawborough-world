#!/usr/bin/env python3
# bazaar-stalls kit exit-gate tests (standalone, system python3)
# Verifies the delivered kit against the frozen baseline layout and DESIGN_SPEC:
#   1. 43 stall placements, type from foodUse, extras.slots == layout slots exactly
#   2. 8 benches
#   3. 16 awning strips, built length == lenM +/- 0.05
#   4. budgets (stall 1500 / bench 300 / awning 120 per metre)
#   5. Khronos validator 0 errors
# plus reimport report (sockets/bounds/no-textures), sha256 manifest, render
# blank-frame guard and mock-row socket world checks.
import hashlib, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(AREA, 'out-bazaar-stalls')
SITE = '/home/baibai/outbox/pawborough-w1-bazaar-stalls-20260922/artifacts/bazaar-stalls/site-inputs.json'
LAYOUT = '/home/baibai/work/onewonderjapan/pawborough-world/scene-authoring/yuyuan-area/baseline/layout.json'

failures = []
def check(cond, label):
    print(('PASS ' if cond else 'FAIL ') + label)
    if not cond:
        failures.append(label)

TYPE = {'蒸煮': 'steam', '点心': 'steam', '烤制': 'grill', '饮品': 'drink'}

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for c in iter(lambda: f.read(1 << 16), b''):
            h.update(c)
    return h.hexdigest()

site = json.load(open(SITE, encoding='utf-8'))
pl = json.load(open(os.path.join(OUT, 'placements.json'), encoding='utf-8'))
awp = json.load(open(os.path.join(OUT, 'awning-placements.json'), encoding='utf-8'))
lay = json.load(open(LAYOUT, encoding='utf-8'))
lobj = {o['id']: o for o in lay['objects']}

# 1. stalls
check(len(pl['stalls']) == 43, f"43 stall placements (got {len(pl['stalls'])})")
by_id = {s['id']: s for s in pl['stalls']}
slots_ok, pos_ok, type_ok = True, True, True
for s in site['stalls']:
    p = by_id.get(s['id'])
    if p is None:
        slots_ok = pos_ok = type_ok = False
        continue
    if p['type'] != TYPE.get(s['foodUse'], 'steam'):
        type_ok = False
    lo = lobj[s['id']]
    if p['extras']['slots'] != lo['geometry']['slots']:
        slots_ok = False
    if p['position'] != lo['geometry']['position'] or p['rotY'] != lo['geometry']['rotY']:
        pos_ok = False
check(type_ok, 'stall type driven by foodUse (蒸煮/点心=steam, 烤制=grill, 饮品=drink)')
check(slots_ok, 'extras.slots reproduce frozen layout slots exactly')
check(pos_ok, 'positions/rotY match frozen layout exactly')

# socket empties in module GLBs at the exact layout local offsets
reimp = json.load(open(os.path.join(OUT, 'reimport-report.json'), encoding='utf-8'))
rep_by = {r['file']: r for r in reimp['results']}
want = {'stall-steam.glb': {'socket_tray': [0.55, 1.01, 0.0], 'socket_steamer': [-0.45, 1.31, 0.0]},
        'stall-grill.glb': {'socket_tray': [0.55, 1.01, 0.0], 'socket_grill': [-0.45, 1.13, 0.0]},
        'stall-drink.glb': {'socket_tray': [0.0, 1.01, 0.1], 'socket_cup': [-0.5, 1.31, -0.25]}}
sock_ok = reimp.get('allOk', False)
for f, socks in want.items():
    r = rep_by.get(f, {})
    for nm, v in socks.items():
        got = r.get('sockets', {}).get(nm)
        if got is None or any(abs(a - b) > 1e-4 for a, b in zip(got, v)):
            sock_ok = False
            print(f'  socket mismatch {f}:{nm} want={v} got={got}')
check(sock_ok and reimp.get('allOk'), 'reimport allOk + socket_tray/socket_steamer empties at exact layout offsets')

# 2. benches
check(len(pl['benches']) == 8, f"8 benches (got {len(pl['benches'])})")

# 3. awning strips
edges = awp['edges']
check(len(edges) == 16, f"16 awning strips (got {len(edges)})")
len_ok = all(abs(e['geometry']['builtLengthM'] - e['lenM']) <= 0.05 for e in edges)
check(len_ok, 'awning built length == lenM +/- 0.05')
# skipped edges would be recorded; every selected edge >= 1.5 m per fallback rule
check(all(e['lenM'] >= 1.5 for e in edges), 'no edge below 1.5 m fallback threshold')
check(len(awp.get('counts', {}).get('skipped', [])) == 0, 'no skipped edges (all blocks qualified)')

# 4. budgets
man = json.load(open(os.path.join(OUT, 'manifest.json'), encoding='utf-8'))
check(all(v['tris'] <= v['budget'] and v['budgetOk'] for k, v in man['files'].items()),
      'stall/bench tri budgets')
check(all(e['budgetOk'] and e['trisPerMetre'] <= 120 for e in edges), 'awning <= 120 tris/metre')

# 5. validator
vr = json.load(open(os.path.join(OUT, 'validator-report.json'), encoding='utf-8'))
check(len(vr['results']) == 20 and all(r['errors'] == 0 and r['warnings'] == 0 for r in vr['results']),
      f"Khronos validator 0 errors 0 warnings on 20 GLBs (got {len(vr['results'])} files)")

# manifest sha256 + reimport/bound sanity
sha_ok = all(sha256(os.path.join(OUT, k)) == v['sha256'] for k, v in man['files'].items())
sha_ok = sha_ok and all(sha256(os.path.join(OUT, e['module'])) == e['sha256'] for e in edges)
check(sha_ok, 'manifest.json sha256 matches every GLB on disk')
check(all(r['noTextures'] and r['materialsOk'] and r['boundsOk'] and r['trisMatch'] and r['shaMatch']
          for r in reimp['results']), 'reimport: no image nodes, materials ok, bounds ok, tris/sha match')

# 6. renders + mock row
rr = json.load(open(os.path.join(OUT, 'renders', 'render-report.json'), encoding='utf-8'))
check(all(not g['blank'] for g in rr['guard'].values()), 'blank-frame guard: no blank renders')
check(rr['socketsOk'] and len(rr['socketChecks']) == 4 and all(c['ok'] for c in rr['socketChecks']),
      'mock-row yaw instances: socket world positions match layout math (err < 1cm)')
check(len(rr['mockRowStalls']) == 6 and len(rr['mockRowBench']) >= 1, 'mock row: 6 stalls of cluster 1 + bench')

print()
print('checker failures:', len(failures))
for f in failures:
    print(' -', f)
sys.exit(1 if failures else 0)
