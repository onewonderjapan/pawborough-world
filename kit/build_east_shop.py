"""Config-driven east-edge background shop builder (shop-128/129 candidates).

Extends the frozen kit with the shared capabilities required by
CONSTRUCTION_HANDOFF.md — planar two-slope roof, gable walls with real
openings, generated door frames, segmented foundation, generic-atlas signage —
without touching build_sample.py (样板A) or any frozen default. One building
per process, same output contract as build_sample.py via mb_lib.finalize.

Strict config schema: unknown keys are rejected (no silent field ignoring);
new fields are defined here first, then used. Run:

  blender -b --factory-startup -t 4 -P kit/build_east_shop.py -- \
      --config kit/east-shop-128.config.json --out kit/out/east-shop-128
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

# strict schema: key -> None (leaf) or nested dict. Anything extra or missing
# is a hard error — final configs may never carry silently-ignored fields.
SCHEMA = {
    'sampleId': None, 'basedOn': None, 'units': None,
    'bay': {'widthM': None, 'depthM': None},
    'floors': None,
    'heights': {'eaveM': None, 'ridgeM': None, 'upperFloorY': None, 'sillWallCenterY': None,
                'sillWallHeightM': None, 'headerFromY': None, 'windowY': None, 'pierHeightM': None},
    'roof': {'type': None, 'overhangFrontBackM': None, 'overhangGableM': None,
             'slabThicknessM': None, 'ridgeRollRadiusM': None, 'maxAttachmentAboveRidgeM': None},
    'upperWindows': {'type': None, 'count': None, 'widthM': None, 'heightM': None},
    'front': {'wallThicknessM': None,
              'door': {'uRatio': None, 'widthM': None, 'heightM': None, 'recessM': None},
              'display': {'uRatio': None, 'widthRatio': None, 'bottomY': None, 'topY': None, 'recessM': None}},
    'gable': {'wallThicknessM': None, 'westOnLocalX': None, 'openings': None, 'downpipe': None},
    'foundation': {'bottomY': None, 'topY': None, 'thicknessM': None, 'protrusionM': None,
                   'thresholdHeightM': None},
    'streetPosts': {'count': None, 'postHeightM': None},
    'beams': {'lowerY': None},
    'canopy': None,
    'signage': {'main': None},
    'materialSet': None,
    'specAdjustments': None,
}

GABLE_KINDS = ('window', 'door')

# street-completion batch 20260915: optional keys. Allowed but never demanded,
# so the frozen 128/129 configs keep validating unchanged.
SCHEMA_OPTIONAL = {
    'displayProps': {'kind': None, 'count': None, 'rollLengthM': None, 'rollRadiusM': None,
                     'shelf': None, 'panelWidthM': None, 'panelHeightM': None},
}
FULL_SPEC = dict(SCHEMA)
for _k, _sub in SCHEMA_OPTIONAL.items():
    FULL_SPEC[_k] = {**(FULL_SPEC.get(_k) or {}), **_sub}
FULL_SPEC['front'] = {**SCHEMA['front'],
                      'boarding': {'topY': None, 'plankWidthM': None, 'gapM': None,
                                   'thicknessM': None, 'edgeMarginM': None}}
# required subset per level: a level listed here demands exactly its own keys;
# optional levels are simply absent from REQ_SPEC (allowed, never demanded), so
# a fabricRolls block never carries the framedPanels knobs and the frozen
# 128/129 configs keep validating unchanged.
REQ_SPEC = dict(SCHEMA)
REQ_SPEC['front'] = SCHEMA['front']


def check_keys(obj, spec, path, required=None):
    """spec = allowed keys (nested dict or None leaf); required = the subset
    that must be present (defaults to all of spec)."""
    problems = []
    if not isinstance(obj, dict):
        return [f'{path}: expected object']
    req = spec if required is None else required
    extra = sorted(set(obj) - set(spec))
    missing = sorted(set(req) - set(obj))
    if extra:
        problems.append(f'{path}: unknown keys {extra} (no silent ignoring)')
    if missing:
        problems.append(f'{path}: missing keys {missing}')
    for k, sub in spec.items():
        if sub and k in obj:
            # levels absent from `required` are optional: allowed, never demanded
            sub_req = req.get(k, {}) if isinstance(req, dict) else None
            problems += check_keys(obj[k], sub, f'{path}.{k}', sub_req)
    return problems


def validate(c, atlas_rows):
    pr = check_keys(c, FULL_SPEC, 'config', REQ_SPEC)
    W = c['bay']['widthM']
    D = c['bay']['depthM']
    h = c['heights']
    r = c['roof']
    sf = c['front']
    g = c['gable']
    f0 = c['foundation']
    if c['floors'] != 2:
        pr.append('east-edge background shops are 2-floor types')
    if c['units'] != 'meters':
        pr.append('units must be meters')
    if not (h['ridgeM'] > h['eaveM'] > h['headerFromY'] > h['windowY'] > h['sillWallCenterY'] > h['upperFloorY'] > 3.0):
        pr.append('height stack is not strictly ordered')
    if r['type'] != 'planar':
        pr.append(f"this builder only implements the planar roof (got {r['type']!r}); straight/ornate stay with build_sample.py")
    if not (0 < r['overhangFrontBackM'] <= 0.6 and 0 < r['overhangGableM'] <= 0.6):
        pr.append('roof overhangs out of range')
    if not (0.05 <= r['slabThicknessM'] <= 0.2):
        pr.append('roof slab thickness out of range')
    if r['ridgeRollRadiusM'] + 0.07 > r['maxAttachmentAboveRidgeM']:
        pr.append('ridge roll exceeds the +0.20 m attachment budget')
    win = c['upperWindows']
    pad = win['widthM'] / 2 + .05
    if pad > W / (2 * win['count']):
        pr.append('upper window openings would overlap')
    if win['type'] not in ('shutter', 'ornate'):
        pr.append(f"unknown window type {win['type']}")
    sill_bottom = h['sillWallCenterY'] - h['sillWallHeightM'] / 2
    win_top = h['windowY'] + win['heightM'] / 2
    if win_top > h['headerFromY']:
        pr.append('upper window band crosses the header')
    dy_door = sf['door']
    if not (-0.45 < dy_door['uRatio'] < 0.45):
        pr.append('front door ratio outside the facade')
    if dy_door['heightM'] >= sill_bottom:
        pr.append('front door higher than the lower wall band')
    disp = sf['display']
    if abs(disp['bottomY'] - f0['topY']) > 1e-3:
        pr.append('display window bottom must sit on the foundation top (no sliver band)')
    if not (disp['topY'] > disp['bottomY'] + 0.5 and disp['topY'] + 0.1 < sf['door']['heightM'] + f0['topY'] + 3.0):
        pr.append('display window opening malformed')
    if disp['topY'] > sill_bottom - 0.5:
        pr.append('display window leaves no wall above for the sign band')
    dw = disp['widthRatio'] * W
    door_u = W * dy_door['uRatio']
    disp_u = W * disp['uRatio']
    if abs(door_u - disp_u) < (dy_door['widthM'] + dw) / 2 + 0.1:
        pr.append('front door and display window overlap')
    if g['westOnLocalX'] not in (-1, 1):
        pr.append('westOnLocalX must be -1 (gable at -x) or +1 (gable at +x)')
    for o in g['openings']:
        if o.get('kind') not in GABLE_KINDS:
            pr.append(f"unknown gable opening kind {o.get('kind')!r}")
        if not (-D + 0.5 < o['zM'] < -0.5):
            pr.append(f"gable opening z {o['zM']} outside the wall")
        if o['kind'] == 'window' and not (f0['topY'] - 0.01 < o['yM'] - o['heightM'] / 2):
            pr.append('gable window sinks into the foundation band')
        if o['kind'] == 'window' and not (o['yM'] + o['heightM'] / 2 < h['eaveM'] - 0.4):
            pr.append('gable window too close to the eave')
    pairs = sorted(g['openings'], key=lambda q: q['zM'])
    for o1, o2 in zip(pairs, pairs[1:]):
        if o2['zM'] - o1['zM'] < (o1['widthM'] + o2['widthM']) / 2 + 0.3:
            pr.append('gable openings overlap or have no pier between')
    if g['downpipe']['zM'] > -0.15:
        pr.append('downpipe sits on the front corner')
    if not (f0['bottomY'] < -0.1 and 0.4 < f0['topY'] < 0.8):
        pr.append('foundation band must reach under grade (~-0.20) and top out around 0.6')
    sp = c['streetPosts']
    if sp['count'] != 2:
        pr.append('frozen facade pattern carries exactly 2 street posts')
    if not (h['eaveM'] < sp['postHeightM'] < h['eaveM'] + 0.3):
        pr.append('street posts must cap just above the eave')
    if c['canopy'] is not None:
        cp = c['canopy']
        if not (0.1 < cp['projectionM'] <= 0.5 and cp['slabY'] > dy_door['heightM'] + 0.3):
            pr.append('canopy projection/height malformed')
        sign_y = c['signage']['main']['yM']
        if sign_y - c['signage']['main']['heightM'] / 2 - 0.09 < cp['slabY']:
            pr.append('sign board would intersect the canopy slab')
    sg = c['signage']['main']
    row_text = atlas_rows.get(str(sg['row']))
    if row_text != sg['text']:
        pr.append(f"sign row {sg['row']} maps to {row_text!r} in the generic atlas, config says {sg['text']!r}")
    dp = c.get('displayProps')
    if dp is not None and dp.get('kind') not in (None, 'none', 'fabricRolls', 'framedPanels'):
        pr.append(f"unknown displayProps kind {dp.get('kind')!r}")
    if dp is not None and dp.get('kind') in ('fabricRolls', 'framedPanels'):
        if not (1 <= dp.get('count', 0) <= 8):
            pr.append('displayProps count out of range')
    bd = sf.get('boarding')
    if bd is not None:
        if bd['topY'] > sg['yM'] - sg['heightM'] / 2 - 0.18:
            pr.append('front boarding would cover the sign backing')
        if not (0.01 < bd['thicknessM'] <= 0.05):
            pr.append('boarding thickness out of range')
        if not (f0['topY'] + 0.3 < bd['topY'] < sill_bottom):
            pr.append('boarding band out of the lower wall')
        if abs(bd['topY'] - disp['topY']) < 0.1:
            pr.append('boarding top too close to the display window top')
    beam_top = c['beams']['lowerY'] + 0.09
    if c['canopy'] is None:
        if sg['yM'] + sg['heightM'] / 2 + 0.09 > beam_top - 0.01:
            pr.append('sign board would intersect the lower front beam')
    else:
        if sg['yM'] + sg['heightM'] / 2 + 0.09 > sill_bottom + 0.001:
            pr.append('sign board would intersect the upper sill wall')
    return pr


atlas_meta = json.loads((HERE / 'textures' / 'sign-atlas-generic.json').read_text(encoding='utf-8'))
problems = validate(cfg, atlas_meta.get('text', {}))
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)

W = cfg['bay']['widthM']
D = cfg['bay']['depthM']
h = cfg['heights']
EAVE, RIDGE = h['eaveM'], h['ridgeM']
r = cfg['roof']
sf = cfg['front']
win = cfg['upperWindows']
g = cfg['gable']
f0 = cfg['foundation']
x, z = 0.0, 0.0
FT = sf['wallThicknessM']
GT = g['wallThicknessM']

L.reset_scene()
L.build_materials()
L.GROUP = cfg['sampleId']

# --- gable walls with real openings (both ends; the design west gable carries
# the openings, the far gable stays plain) ---
wx = g['westOnLocalX'] * W / 2          # outer face of the design west gable
w_in = -1 if g['westOnLocalX'] > 0 else 1   # inward = toward building centre
gable_openings = [{'u': o['zM'], 'y': o['yM'], 'w': o['widthM'], 'h': o['heightM'],
                   'kind': o['kind'], 'recess': o.get('recessM', 0.12)} for o in g['openings']]
for side in (-1, 1):
    is_west = side == g['westOnLocalX']
    plane = side * W / 2
    inward = -side
    ops = gable_openings if is_west else []
    K.wall_with_openings(L, 'x', plane, inward, z - D, z, 0.6, EAVE, GT,
                         'plaster', ops, name=f'gable-wall-{"west" if is_west else "east"}')
    for o in ops:
        if o['kind'] == 'window':
            K.window_on_wall(L, 'x', plane, inward, o['u'], o['y'], o['w'], o['h'],
                             o['recess'], GT, name=f'gable-window-z{o["u"]}')
        elif o['kind'] == 'door':
            K.closed_door_on_wall(L, 'x', plane, inward, o['u'], o['y'], o['w'], o['h'],
                                  o['recess'], name=f'gable-door-z{o["u"]}')
    K.wall_with_openings(L, 'x', plane - inward * f0['protrusionM'], inward, z - D, z,
                         f0['bottomY'], f0['topY'], f0['thicknessM'], 'brick',
                         [{'u': o['u'], 'y': o['y'], 'w': o['w'] + 0.18, 'h': o['h'], 'kind': 'hole'}
                          for o in gable_openings if o['kind'] == 'door'],
                         name=f'foundation-gable-{"west" if is_west else "east"}')

# --- closed front: lower wall band with door + display window, then the
# shared upper window band on top of it ---
door_u = W * sf['door']['uRatio']
disp = sf['display']
disp_u, disp_w = W * disp['uRatio'], W * disp['widthRatio']
front_openings = [
    {'u': door_u, 'y': sf['door']['heightM'] / 2, 'w': sf['door']['widthM'], 'h': sf['door']['heightM'],
     'kind': 'door', 'recess': sf['door']['recessM']},
    {'u': disp_u, 'y': (disp['bottomY'] + disp['topY']) / 2, 'w': disp_w,
     'h': disp['topY'] - disp['bottomY'], 'kind': 'display', 'recess': disp['recessM']},
]
K.wall_with_openings(L, 'z', 0.0, -1, x - W / 2, x + W / 2, f0['topY'],
                     h['sillWallCenterY'] - h['sillWallHeightM'] / 2, FT, 'plaster',
                     front_openings, name='front-wall')
K.closed_door_on_wall(L, 'z', 0.0, -1, door_u, sf['door']['heightM'] / 2, sf['door']['widthM'],
                      sf['door']['heightM'], sf['door']['recessM'], name='front-door')
L.box('front-threshold', (door_u, f0['thresholdHeightM'] / 2, -0.01),
      (sf['door']['widthM'] + 0.3, f0['thresholdHeightM'], 0.22), 'stone', .008)
_niche = (cfg.get('displayProps') or {}).get('kind') not in (None, 'none') or sf.get('boarding') is not None
if _niche:
    K.display_niche_on_wall(L, 'z', 0.0, -1, disp_u, (disp['bottomY'] + disp['topY']) / 2,
                            disp_w, disp['topY'] - disp['bottomY'], disp['recessM'])
else:
    K.display_window_on_wall(L, 'z', 0.0, -1, disp_u, (disp['bottomY'] + disp['topY']) / 2,
                             disp_w, disp['topY'] - disp['bottomY'], disp['recessM'])
# street-completion display props: shallow props behind the display glass
# (counter top = display bottom + counter 0.42 + stone top 0.07)
dp = cfg.get('displayProps') or {}
if dp.get('kind') not in (None, 'none'):
    _counter_y = disp['bottomY'] + 0.42 + 0.07
    if dp['kind'] == 'fabricRolls':
        K.fabric_rolls(L, disp_u, disp_w, _counter_y, count=dp.get('count', 6),
                       roll_len=dp.get('rollLengthM', 0.44),
                       roll_rx=dp.get('rollRadiusM', 0.065), shelf=bool(dp.get('shelf')))
    elif dp['kind'] == 'framedPanels':
        K.framed_panels(L, disp_u, disp_w, _counter_y, count=dp.get('count', 3),
                        panel_w=dp.get('panelWidthM', 0.52), panel_h=dp.get('panelHeightM', 0.72))
bd = sf.get('boarding')
if bd is not None:
    _margin = bd.get('edgeMarginM', 0.20)
    _segs, _cursor = [], x - W / 2 + 0.05
    for _o in sorted(({'u': door_u, 'w': sf['door']['widthM']}, {'u': disp_u, 'w': disp_w}), key=lambda q: q['u']):
        _lo, _hi = _o['u'] - _o['w'] / 2 - _margin, _o['u'] + _o['w'] / 2 + _margin
        if _lo > _cursor:
            _segs.append((_cursor, _lo))
        _cursor = max(_cursor, _hi)
    if x + W / 2 - 0.05 > _cursor:
        _segs.append((_cursor, x + W / 2 - 0.05))
    K.front_boarding(L, _segs, f0['topY'], bd['topY'],
                     plank_w=bd.get('plankWidthM', 0.58), gap=bd.get('gapM', 0.015),
                     thickness=bd.get('thicknessM', 0.03))
K.wall_with_openings(L, 'z', f0['protrusionM'], -1, x - W / 2, x + W / 2,
                     f0['bottomY'], f0['topY'], f0['thicknessM'], 'brick',
                     [{'u': door_u, 'y': sf['door']['heightM'] / 2, 'w': sf['door']['widthM'] + 0.18,
                       'h': sf['door']['heightM'], 'kind': 'hole'}], name='foundation-front')

# --- back wall (frozen dims: overlaps the gables by 5mm, never gaps) ---
L.box('back-wall', (x, EAVE / 2, z - D + .14), (W - .55, EAVE, .28), 'plaster', 0, True)

# --- upper facade band via the shared component ---
K.upper_window_band(L, x, z, W, EAVE,
                    sill_wall=(h['sillWallCenterY'], h['sillWallHeightM']),
                    header_from=h['headerFromY'],
                    window_type=win['type'],
                    window_y=h['windowY'], window_w=win['widthM'], window_h=win['heightM'],
                    pier_y=h['windowY'], pier_h=h['pierHeightM'],
                    count=win['count'])

# --- street posts + long beams (frozen facade pattern) ---
for xx in (x - W / 2 + .2, x + W / 2 - .2):
    K.street_post(L, x=xx, post_height=cfg['streetPosts']['postHeightM'])
for yy in (cfg['beams']['lowerY'], EAVE - .2):
    L.box('front-long-beam', (x, yy, z + .09), (W, .18, .28), 'wood', .01)

# --- signage on the shared generic atlas (no real shop names) ---
sg = cfg['signage']['main']
L.sign(x, sg['yM'], z + .02, sg['widthM'], sg['heightM'], sg['row'], lettering='signGeneric')

# --- planar roof + eave trim + west downpipe ---
L.planar_roof(x, W, D, EAVE, RIDGE, z,
              overhang_fb=r['overhangFrontBackM'], overhang_g=r['overhangGableM'],
              thickness=r['slabThicknessM'], ridge_roll_r=r['ridgeRollRadiusM'])
L.box('upper-eave-timber', (x, EAVE - .4, z + .06), (W, .12, .24), 'wood', .004)
dp = g['downpipe']
L.side_downpipe(wx, w_in, 0.0, EAVE, dp['zM'], r=dp['radiusM'], clamps=dp['clamps'])

if cfg['canopy'] is not None:
    cp = cfg['canopy']
    K.straight_canopy(L, W * cp['centerURatio'], cp['slabY'], z, cp['widthM'], cp['projectionM'])

design = {
    'family': 'east-edge-background-shop',
    'sampleId': cfg['sampleId'],
    'basedOn': cfg['basedOn'],
    'frontageM': W, 'depthM': D, 'eaveM': EAVE, 'ridgeM': RIDGE,
    'floors': cfg['floors'],
    'roofType': 'planar',
    'roofOverhangFB_M': r['overhangFrontBackM'], 'roofOverhangGable_M': r['overhangGableM'],
    'maxFinishedRoofY': RIDGE + .07 + r['ridgeRollRadiusM'],
    'upperWindowCount': win['count'],
    'gableOpenings': g['openings'],
    'interiorBuilt': False,
    'doors': 'all doors closed with real panels (front + any gable door); no interior, building not enterable',
    'signage': f"generic-atlas row {sg['row']} ({sg['text']}, historicalBrand=false)",
    'specAdjustments': cfg.get('specAdjustments', {}),
    'materialSet': cfg['materialSet'],
    'configDriven': True,
    'surveyed': False,
}
a.out.mkdir(parents=True, exist_ok=True)
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(a.out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
tris, bytes_ = L.finalize(cfg['sampleId'], a.out, design)
print(f'EAST_SHOP_READY {cfg["sampleId"]} tris={tris} bytes={bytes_}')
