"""Config-driven plain shop-house sample (N3).

Builds ONE ordinary shop-house from a config JSON, using the frozen mb_lib
material/part pipeline plus the two extracted shared components
(street_post, upper_window_band). The form is the frozen plain-v1 pattern —
this assembles configured dimensions, it does not design new landmarks.

Run:
  blender -b --factory-startup -t 4 -P kit/build_sample.py -- \
      --config kit/plain-shop-a.config.json --out kit/out/plain-shop-a

Outputs (via mb_lib.finalize, same conventions as the 13 frozen modules):
  model.blend, model.glb, collision.json, materials.json, measurements.json,
  reimport-check.json, plus config-used.json echoing the config + SHA.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import mb_lib as L  # noqa: E402
import components as K  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--config', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))


def validate(c):
    """kit_config-style sanity: reject parameter combos that cannot build."""
    problems = []
    W = c['bay']['widthM']
    h = c['heights']
    if c['floors'] != 2:
        problems.append('this frozen plain pattern is a 2-floor type')
    if not (h['ridgeM'] > h['eaveM'] > h['headerFromY'] > h['windowY'] > h['sillWallCenterY'] > h['upperFloorY'] > 3.0):
        problems.append('height stack is not strictly ordered')
    sf = c['shopfront']
    if sf['doorHeightM'] >= h['sillWallCenterY']:
        problems.append('door higher than the sill band')
    win = c['upperWindows']
    pad = win['widthM'] / 2 + .05
    if pad > W / (2 * win['count']):
        problems.append('upper window openings would overlap (pad > W/2n)')
    win_top = h['windowY'] + win['heightM'] / 2
    win_bottom = h['windowY'] - win['heightM'] / 2
    sill_top = h['sillWallCenterY'] + h['sillWallHeightM'] / 2
    if win_top > h['headerFromY'] or win_bottom < sill_top:
        problems.append('window band does not sit between sill wall top and header bottom')
    if win['type'] not in ('shutter', 'ornate'):
        problems.append(f"unknown window type {win['type']}")
    if c['roof']['type'] not in ('straight', 'ornate'):
        problems.append(f"unknown roof type {c['roof']['type']}")
    n = c['streetPosts']['count']
    if n != 2:
        problems.append('frozen plain pattern carries exactly 2 street posts')
    return problems


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)

W = cfg['bay']['widthM']
D = cfg['bay']['depthM']
h = cfg['heights']
EAVE, RIDGE = h['eaveM'], h['ridgeM']
x, z = 0.0, 0.0
sf = cfg['shopfront']
win = cfg['upperWindows']

L.reset_scene()
L.build_materials()
L.GROUP = cfg['sampleId']

# --- shell (frozen plain-v1 pattern; collision side walls / back / floors) ---
L.box('left-side', (x - W / 2 + .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
L.box('right-side', (x + W / 2 - .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
L.box('back-wall', (x, EAVE / 2, z - D + .14), (W - .55, EAVE, .28), 'plaster', 0, True)
L.box('shop-floor', (x, .07, z - D / 2), (W, .14, D), 'stone', .005, True)
L.box('upper-floor', (x, h['upperFloorY'], z - D / 2), (W - .56, .22, D - .55), 'wood', 0, True)
L.box('rear-interior', (x, 1.62, z - 3.5), (W - .5, 3.1, .20), 'inner', 0, True)
for xx in (x - W / 2 - .01, x + W / 2 + .01):
    L.box('brick-base', (xx, .52, z - D / 2), (.31, 1.04, D), 'brick', 0)
if sf['frontBrickPlinth']:
    L.box('front-brick-plinth', (x, .30, z + .01), (W - .3, sf['plinthHeightM'], .24), 'brick', 0, True)

# --- upper facade band via the shared component ---
K.upper_window_band(L, x, z, W, EAVE,
                    sill_wall=(h['sillWallCenterY'], h['sillWallHeightM']),
                    header_from=h['headerFromY'],
                    window_type=win['type'],
                    window_y=h['windowY'], window_w=win['widthM'], window_h=win['heightM'],
                    pier_y=h['windowY'], pier_h=h['pierHeightM'],
                    count=win['count'])

# --- ground front: recessed door + display counter window ---
dx = x + W * sf['doorCenterRatio']
L.box('shop-door', (dx, 1.05, z - .05), (sf['doorWidthM'], sf['doorHeightM'], .09), 'dark', .008, True)
L.box('door-frame', (dx - .62, 1.05, z - .04), (.1, 2.2, .12), 'wood', .005)
L.box('door-frame', (dx + .62, 1.05, z - .04), (.1, 2.2, .12), 'wood', .005)
wx = x + W * sf['counterCenterRatio']
ww = W * sf['counterWidthRatio']
L.box('counter-window-recess', (wx, 1.25, z - .14), (ww, 1.7, .13), 'dark', 0)
L.box('counter-window-glass', (wx, 1.25, z - .06), (ww - .2, 1.5, .02), 'glass', 0)
L.box('counter-sill', (wx, .95, z - .02), (ww + .1, .5, .22), 'wood', .008, True)
L.box('counter-top', (wx, 1.22, z + .02), (ww + .1, .08, .3), 'stone', .008)

# --- street posts via the shared component + long beams ---
for xx in (x - W / 2 + .2, x + W / 2 - .2):
    K.street_post(L, x=xx, post_height=cfg['streetPosts']['postHeightM'],
                  foot=cfg['streetPosts'].get('stoneFoot', False))
for yy in (3.4, EAVE - .2):
    L.box('front-long-beam', (x, yy, z + .09), (W, .18, .28), 'wood', .01)

# --- signage ---
if cfg['signage']:
    L.sign(x, cfg['signage']['main']['y'], z + .26, W * cfg['signage']['main']['widthRatio'],
           cfg['signage']['main']['heightM'], cfg['signage']['main']['textRow'])
    L.sign(wx, cfg['signage']['sub']['y'], z - .2, ww * cfg['signage']['sub']['widthRatio'],
           cfg['signage']['sub']['heightM'], cfg['signage']['sub']['textRow'])

# --- roof + eave trim + downpipe ---
L.roof(x, W, D, EAVE, RIDGE, z, ornate=(cfg['roof']['type'] == 'ornate'))
L.box('upper-eave-timber', (x, EAVE - .4, z + .06), (W, .12, .24), 'wood', .004)
L.downpipe(x + W / 2, EAVE, z)

design = {
    'family': 'plain-config-sample',
    'sampleId': cfg['sampleId'],
    'basedOn': cfg['basedOn'],
    'frontageM': W, 'depthM': D, 'eaveM': EAVE, 'ridgeM': RIDGE,
    'floors': cfg['floors'],
    'windowType': win['type'], 'upperWindowCount': win['count'],
    'roofType': cfg['roof']['type'],
    'materialSet': cfg['materialSet'],
    'signage': 'none' if not cfg['signage'] else 'main + sub typeset board',
    'configDriven': True,
}
a.out.mkdir(parents=True, exist_ok=True)
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(a.out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
tris, bytes_ = L.finalize(cfg['sampleId'], a.out, design)
print(f'SAMPLE_READY {cfg["sampleId"]} tris={tris} bytes={bytes_}')
