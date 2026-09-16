"""Chenghuangmiao dadian (principal hall) builder — the temple axis continues
north: the hall stands at world (0, 0, -44) behind the second court. Built in
its own LOCAL frame (front-wall center bottom origin, facade +Z, depth -Z).

One process exports:
  dadian.glb   body group (columns/closed doors/lattice/midband/plaque/walls)
               + dadian-plaque group, plus BOTH roof shells, the 歇山读感 gable
               overlays and the crest — single file, groups joined by material.

Design source: kit/dadian.config.json (strict schema; every dimension traces
to DESIGN_SPEC.json pawborough-temple-dadian-night-20260915 — design, not
survey). Both roof shells run the yimen single-shell machinery verbatim
(profile-lofted, normal-offset soffit, drop-following corner-lift ramp,
wing-tip rings). The upper roof carries the 歇山读感 treatment frozen in
DESIGN_SPEC: the four-slope shell is UNCHANGED; two vertical gable triangle
panels at x=+-9.0 rise proud of the hip surface to the crest line, with a
full-length crest beam between them — it reads as xieshan without new roof
topology. Photo evidence: aerial PBR-SH-0005-001 (xieshan), plaque PBR-SH-
0005-004 (城隍廟), burner/platform PBR-SH-0005-002/003 (court builder).

Run:
  blender -b --factory-startup -t 4 -P kit/build_dadian.py -- \
      --config kit/dadian.config.json --out kit/out/dadian
"""
import argparse
import hashlib
import json
import math
import struct
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import mb_lib as L  # noqa: E402
import temple_components as C  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
sys.stdout.reconfigure(line_buffering=True)
p = argparse.ArgumentParser()
p.add_argument('--config', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
T0 = time.time()

# ---------------------------------------------------------------------------
# strict schema (unknown keys are hard errors)

SCHEMA = {
    'sampleId': None, 'family': None, 'units': None, 'axis': None, 'basedOn': None,
    'reference': {'imageId': None, 'referenceEra': None, 'historicalAccuracyVerified': None,
                  'dimensionsAreDesign': None},
    'placement': {'originGlbWorld': None, 'yawRad': None},
    'body': {'widthM': None, 'depthM': None, 'sideWallX': None, 'sideWallThicknessM': None,
             'rearWallZ': None, 'rearWallThicknessM': None},
    'columns': {'frontX': None, 'frontZ': None, 'rearZ': None, 'sizeM': None, 'material': None,
                'topBeamY': None},
    'clearDoorway': {'widthM': None, 'heightM': None, 'localZRange': None, 'note': None},
    'doors': {'leafCount': None, 'leafSizeM': None, 'leafCenterZ': None, 'thresholdM': None,
              'pullRingRadiusM': None, 'pullRingY': None, 'pullRingInsetX': None,
              'closedCollider': None, 'goldSeamGapM': None},
    'latticeBays': {'baySpansX': None, 'sillY': None, 'latticeY': None, 'waistRailY': None,
                    'mullionSpacingM': None, 'transomY': None, 'transomMaterial': None,
                    'backingZ': None},
    'frontBand': {'yRange': None, 'upperGoldStripY': None},
    'midWallBand': {'y': None, 'outlineXM': None, 'thicknessM': None, 'rearZ': None,
                    'plankGrooveStepM': None, 'baseApronH': None},
    'mainPlaque': {'centerY': None, 'sizeWH': None, 'faceZ': None, 'literalLeftToRight': None,
                   'readRightToLeft': None, 'faceTexture': None, 'construction': None},
    'coupletBoards': {'onColumnsX': None, 'sizeM': None, 'centerY': None, 'boardFaceZ': None},
    'sideWalls': {'x': None, 'thicknessM': None, 'zRange': None, 'lowerTopY': None},
    'rearDesign': {'mode': None, 'designInference': None, 'note': None},
    'roofLower': 'ROOF_LOWER',
    'roofUpper': 'ROOF_UPPER',
    'budgets': {'dadianTrisMax': None, 'dadianBodyStageTrisMax': None, 'dadianGlbBytesMax': None,
                'newImagesMax': None, 'newImageEdgePxMax': None},
    'runtime': {'capsule': None},
    'review': {'ports': None},
    'uncertaintyPolicy': None,
}
ROOF_SCHEMA = {
    'widthM': None, 'frontEaveZ': None, 'rearEaveZ': None, 'ridgeY': None, 'ridgeLengthM': None,
    'ridgeLocalZ': None, 'eaveY': None, 'shellThicknessM': None, 'profileTY': None,
    'cornerLiftM': None, 'cornerLiftXStartsM': None, 'cornerLiftDepthTStarts': None,
    'hipEndTopY': None, 'hipStartsXM': None, 'surfaceEquation': None, 'resampleSegments': None,
    'tileRibs': {'spacingM': None, 'spacingChosenM': None, 'radiusM': None, 'radiusChosenM': None,
                 'stripSections': None, 'ribSections': None, 'slopes': None,
                 'budgetExtraTrisMax': None, 'note': None},
    'eaveFasciaH': None, 'soffitDepthM': None, 'note': None,
    'ridgeCapRollRadiusM': None, 'ridge': None, 'gableTreatment': None,
}
ROOF_SCHEMA_LOWER = {
    'widthM': None, 'frontEaveZ': None, 'rearEaveZ': None, 'ridgeY': None, 'ridgeLengthM': None,
    'ridgeLocalZ': None, 'eaveY': None, 'shellThicknessM': None, 'profileTY': None,
    'cornerLiftM': None, 'cornerLiftXStartsM': None, 'cornerLiftDepthTStarts': None,
    'hipEndTopY': None, 'hipStartsXM': None, 'surfaceEquation': None, 'resampleSegments': None,
    'tileRibs': {'spacingM': None, 'spacingChosenM': None, 'radiusM': None, 'radiusChosenM': None,
                 'stripSections': None, 'ribSections': None, 'slopes': None,
                 'budgetExtraTrisMax': None, 'note': None},
    'eaveFasciaH': None, 'soffitDepthM': None, 'note': None, 'ridgeCapRollRadiusM': None,
}
ROOF_SCHEMA_UPPER = {
    'widthM': None, 'frontEaveZ': None, 'rearEaveZ': None, 'ridgeY': None, 'ridgeLengthM': None,
    'ridgeLocalZ': None, 'eaveY': None, 'shellThicknessM': None, 'profileTY': None,
    'cornerLiftM': None, 'cornerLiftXStartsM': None, 'cornerLiftDepthTStarts': None,
    'hipEndTopY': None, 'hipStartsXM': None, 'surfaceEquation': None, 'resampleSegments': None,
    'tileRibs': {'spacingM': None, 'spacingChosenM': None, 'radiusM': None, 'radiusChosenM': None,
                 'stripSections': None, 'ribSections': None, 'slopes': None,
                 'budgetExtraTrisMax': None},
    'eaveFasciaH': None, 'soffitDepthM': None, 'note': None,
    'ridge': None, 'gableTreatment': None,
}


def check_keys(obj, spec, path):
    problems = []
    if not isinstance(obj, dict):
        return [f'{path}: expected object']
    if spec == 'ROOF':
        spec = ROOF_SCHEMA
    if spec == 'ROOF_LOWER':
        spec = ROOF_SCHEMA_LOWER
    if spec == 'ROOF_UPPER':
        spec = ROOF_SCHEMA_UPPER
    missing = sorted(set(spec) - set(obj))
    extra = sorted(set(obj) - set(spec))
    if extra:
        problems.append(f'{path}: unknown keys {extra}')
    if missing:
        problems.append(f'{path}: missing keys {missing}')
    for k, sub in spec.items():
        if sub and k in obj:
            problems += check_keys(obj[k], sub, f'{path}.{k}')
    return problems


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(26)
    w, h = struct.unpack('>II', head[16:24])
    return int(w), int(h)


def validate_roof(rf, pr, path):
    if abs(rf['profileTY'][0][1] - rf['ridgeY']) > 1e-6:
        pr.append(f'{path}: profile t=0 must sit at the ridge height')
    if abs(rf['profileTY'][-1][1] - rf['eaveY']) > 1e-6:
        pr.append(f'{path}: profile t=1 must land at the eave height')
    ys = [y for _, y in rf['profileTY']]
    if any(y > rf['ridgeY'] + 1e-6 or y < rf['eaveY'] - 0.05 for y in ys):
        pr.append(f'{path}: profile heights escape the ridge..eave band')
    if not (3 <= len(rf['profileTY']) <= 24):
        pr.append(f'{path}: profile needs 3..24 samples')
    if not (10 <= rf['resampleSegments'] <= 16):
        pr.append(f'{path}: resample segments must be 10-16')
    if rf['ridgeLengthM'] >= rf['widthM']:
        pr.append(f'{path}: ridge must be shorter than the roof width (hip ends)')
    if rf['cornerLiftXStartsM'] <= rf['hipStartsXM'] or rf['cornerLiftXStartsM'] >= rf['widthM'] / 2:
        pr.append(f'{path}: corner lift x band must sit inside the hip zone, inside the half width')
    if not (0.0 < rf['cornerLiftDepthTStarts'] < 1.0):
        pr.append(f'{path}: corner lift depth start must be an interior t')
    if not (rf['eaveY'] < rf['hipEndTopY'] < rf['ridgeY']):
        pr.append(f'{path}: hipEndTopY must sit between eave and ridge')
    tr = rf['tileRibs']
    if not (tr['spacingM'][0] <= tr['spacingChosenM'] <= tr['spacingM'][1]):
        pr.append(f"{path}: tile rib spacing {tr['spacingChosenM']} outside band {tr['spacingM']}")
    if not (tr['radiusM'][0] <= tr['radiusChosenM'] <= tr['radiusM'][1]):
        pr.append(f"{path}: tile rib radius {tr['radiusChosenM']} outside band {tr['radiusM']}")
    if not (5 <= tr['ribSections'] <= tr['stripSections']):
        pr.append(f'{path}: ribSections must be 5..stripSections')
    return pr


def validate(c):
    pr = check_keys(c, SCHEMA, 'config')
    bd, cols, dw = c['body'], c['columns'], c['clearDoorway']
    rf_l, rf_u = c['roofLower'], c['roofUpper']
    plq, doors = c['mainPlaque'], c['doors']

    if c['units'] != 'meters':
        pr.append('units must be meters')
    if 'Y-up' not in c['axis'] or '+Z' not in c['axis']:
        pr.append('axis must state GLB Y-up and facade +Z')
    if c['reference']['dimensionsAreDesign'] is not True:
        pr.append('dimensions must be flagged design (not survey)')
    if c['placement']['originGlbWorld'] != [0, 0, -44] or c['placement']['yawRad'] != 0:
        pr.append('world placement must be (0,0,-44) yaw 0 per DESIGN_SPEC')

    validate_roof(rf_l, pr, 'roofLower')
    validate_roof(rf_u, pr, 'roofUpper')

    # double-eave stacking: upper eave above skirt ridge everywhere; skirt
    # wider and longer than the upper shell; band spans the gap
    if not rf_u['eaveY'] - (rf_l['ridgeY'] + rf_l['cornerLiftM']) >= 0.85:
        pr.append('upper eave must clear the skirt ridge by >= 0.85m (test contract)')
    if not rf_l['widthM'] > rf_u['widthM'] + 2.0:
        pr.append('skirt must overhang the upper shell by >= 1m per side')
    if not (rf_l['eaveY'] < c['midWallBand']['y'][0] and c['midWallBand']['y'][1] <= rf_u['eaveY']):
        pr.append('midWallBand must sit between the skirt eave and the upper eave')

    # column grid: center bay hosts the door; six columns, symmetric
    fx = sorted(cols['frontX'])
    if len(fx) != 6 or any(fx[i] >= fx[i + 1] for i in range(5)):
        pr.append('frontX must be six ascending x values')
    if abs(fx[0] + fx[5]) > 1e-9 or abs(fx[1] + fx[4]) > 1e-9 or abs(fx[2] + fx[3]) > 1e-9:
        pr.append('frontX must be symmetric about x=0')
    colw = cols['sizeM'][0]
    clear = fx[3] - fx[2] - colw
    if abs(clear - dw['widthM']) > 0.05:
        pr.append(f'center bay clear opening {clear:.3f} must match doorway width (+-0.05)')
    if doors['leafCount'] != 2 or abs(2 * doors['leafSizeM'][0] - clear) > 1e-6:
        pr.append('two closed leaves must exactly fill the physical opening')

    # bays: spans run between adjacent column inner faces
    spans = c['latticeBays']['baySpansX']
    expect = [[fx[3] + colw / 2, fx[4] - colw / 2], [fx[4] + colw / 2, fx[5] - colw / 2]]
    for got, want in zip(spans, expect):
        if abs(got[0] - want[0]) > 1e-6 or abs(got[1] - want[1]) > 1e-6:
            pr.append(f'bay span {got} must run between column inner faces {want}')

    # plaque: right-to-left reading contract, texture present
    if plq['literalLeftToRight'] != '廟隍城' or plq['readRightToLeft'] != '城隍廟':
        pr.append('plaque text must read 城隍廟 (RTL), literals 廟隍城 — evidence PBR-SH-0005-004')
    if plq['literalLeftToRight'] != plq['readRightToLeft'][::-1]:
        pr.append('plaque literal must be the mirror of the reading')
    if not (c['midWallBand']['y'][0] <= plq['centerY'] - plq['sizeWH'][1] / 2
            and plq['centerY'] + plq['sizeWH'][1] / 2 <= c['midWallBand']['y'][1] + 0.05):
        pr.append('main plaque must sit inside the midWallBand y range (+0.05 top overlap)')
    tex = HERE / 'textures' / Path(plq['faceTexture']).name
    if not tex.exists():
        pr.append(f'referenced texture missing: {plq["faceTexture"]}')
    else:
        ww, hh = png_size(tex)
        if max(ww, hh) > c['budgets']['newImageEdgePxMax']:
            pr.append(f'{tex.name} exceeds the texture edge budget')

    # gable treatment must sit on the upper shell near its hip zone
    g = rf_u['gableTreatment']
    if not (rf_u['hipStartsXM'] < g['gablePlaneXM'] < rf_u['widthM'] / 2):
        pr.append('gable plane must sit inside the upper hip zone')
    if g['apex'][1] > rf_u['ridgeY'] + 1e-6 or g['apex'][1] <= rf_u['hipEndTopY']:
        pr.append('gable apex must reach the crest line (ridgeY) but stay sane')

    # crest beam spans between the gable planes
    cb = rf_u['ridge']['crestBeamM']
    if abs(cb[2] / 2 - g['gablePlaneXM']) > 1e-6:
        pr.append('crest beam half-length must equal the gable plane x')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# materials: frozen street palette + shared temple images + ONE new plaque
# atlas + ONE builder-local bronze

L.reset_scene()
L.build_materials()
L.M['plaque'] = L.mat('dadian-plaque-lacquer', '141416', .38, base='dadian-plaque.png', extend=True)
L.M['relief'] = L.mat('temple-relief-stone', '9a9a8c', .92,
                      normal='temple-relief-normal.png', tile=(1.8, 2.15))
L.M['bronze'] = L.mat('bronze', '6b4c30', .45, metal=.75)
L.META['dadian-plaque-lacquer']['source'] = (
    'locally authored (kit/make_dadian_textures.py; Noto Serif CJK Bold glyphs; '
    'text 城隍廟 evidenced by PBR-SH-0005-004 batch-005)')
L.META['temple-relief-stone']['source'] = 'shared with shanmen (kit/make_temple_textures.py)'
L.META['bronze']['source'] = 'builder-local palette extension (DESIGN_SPEC.palette.newLocalMaterial)'

bd, cols_cfg, dw = cfg['body'], cfg['columns'], cfg['clearDoorway']
doors, bays, fb = cfg['doors'], cfg['latticeBays'], cfg['frontBand']
mb, plq, cb = cfg['midWallBand'], cfg['mainPlaque'], cfg['coupletBoards']
swc, BUD = cfg['sideWalls'], cfg['budgets']

# ---------------------------------------------------------------------------
# roof surfaces: the yimen machinery, parameterized per shell


def make_surface(rf):
    drop = C.make_drop_fn(rf['profileTY'], rf['resampleSegments'])
    HW = rf['widthM'] / 2
    RIDGE_HALF = rf['ridgeLengthM'] / 2
    Z_MID = rf['ridgeLocalZ']
    ZF, ZR = rf['frontEaveZ'], rf['rearEaveZ']

    def top_y(x):
        aa = abs(x)
        if aa <= RIDGE_HALF:
            return rf['ridgeY']
        return rf['ridgeY'] - (rf['ridgeY'] - rf['hipEndTopY']) * C.smoothstep(RIDGE_HALF, HW, aa)

    def lift_total(x):
        return rf['cornerLiftM'] * C.smoothstep(rf['cornerLiftXStartsM'], HW, abs(x)) ** 2

    state = {'d0': None}

    def lift_at(x, t):
        if t <= rf['cornerLiftDepthTStarts']:
            return 0.0
        if state['d0'] is None:
            state['d0'] = drop(rf['cornerLiftDepthTStarts'])
        return lift_total(x) * (drop(t) - state['d0']) / (1.0 - state['d0'])

    def roof_y(x, z):
        if z >= Z_MID:
            t = min(1.0, max(0.0, (z - Z_MID) / (ZF - Z_MID)))
        else:
            t = min(1.0, max(0.0, (Z_MID - z) / (Z_MID - ZR)))
        ty = top_y(x)
        return ty - (ty - rf['eaveY']) * drop(t) + lift_at(x, t)

    return roof_y, HW, Z_MID, ZF, ZR


low_y, LOW_HW, LOW_ZMID, LOW_ZF, LOW_ZR = make_surface(cfg['roofLower'])
up_y, UP_HW, UP_ZMID, UP_ZF, UP_ZR = make_surface(cfg['roofUpper'])

# analytic self-checks per shell (the shanmen T3 lessons, hard fail)
for nm, surf, rf in (('lower', low_y, cfg['roofLower']), ('upper', up_y, cfg['roofUpper'])):
    HW, ZMID, ZF = rf['widthM'] / 2, rf['ridgeLocalZ'], rf['frontEaveZ']
    for kx in (0.0, rf['ridgeLengthM'] / 4, rf['ridgeLengthM'] / 2):
        if abs(surf(kx, ZMID) - rf['ridgeY']) > 1e-9:
            print(f'ROOF_EQUATION_FAIL[{nm}] ridge not flat at', kx)
            sys.exit(8)
    if abs(surf(HW, ZF) - (rf['eaveY'] + rf['cornerLiftM'])) > 1e-9:
        print(f'ROOF_EQUATION_FAIL[{nm}] corner lift wrong at the eave corner')
        sys.exit(8)
    if abs(surf(HW - 0.01, ZF) - (rf['eaveY'] + rf['cornerLiftM'])) > 1e-3:
        print(f'ROOF_EQUATION_FAIL[{nm}] corner lift not settled at the eave corner')
        sys.exit(8)
    if abs(surf(HW, ZMID) - rf['hipEndTopY']) > 1e-9:
        print(f'ROOF_EQUATION_FAIL[{nm}] hip end top wrong')
        sys.exit(8)
    for i in range(41):
        x = -HW + 2 * HW * i / 40
        prev = surf(x, ZMID)
        for j in range(1, 25):
            z = ZMID + (ZF - ZMID) * j / 24
            y = surf(x, z)
            if y > prev + 1e-9:
                print(f'ROOF_EQUATION_FAIL[{nm}] surface rises toward the eave at', x)
                sys.exit(8)
            prev = y
print(f'roof equation checks ok both shells ({time.time() - T0:.1f}s)')

# stacking clearance contract: upper eave line clears the skirt everywhere
gap_min = 1e9
for i in range(41):
    x = -UP_HW + 2 * UP_HW * i / 40
    gap_min = min(gap_min, cfg['roofUpper']['eaveY'] + cfg['roofUpper']['cornerLiftM'] *
                  C.smoothstep(cfg['roofUpper']['cornerLiftXStartsM'], UP_HW, abs(x)) ** 2
                  - (low_y(x, cfg['roofLower']['ridgeLocalZ'])))
if gap_min < 0.85:
    print('STACKING_FAIL min clearance', gap_min)
    sys.exit(8)
print(f'stacking clearance ok min={gap_min:.3f}m')

# ---------------------------------------------------------------------------
# S1. body: columns, beams, doorway with CLOSED leaves, threshold, rings

L.GROUP = 'dadian-body'
cs = cols_cfg['sizeM']


def column(x, z):
    L.box('dadian-column', (x, cs[1] / 2, z), (cs[0], cs[1], cs[2]), 'wood', .01, True)
    L.box('dadian-column-plinth', (x, .17, z), (cs[0] + .16, .34, cs[2] + .16), 'stone', .012, True)
    L.box('dadian-column-foot', (x, .38, z), (cs[0] + .02, .1, cs[2] + .02), 'wood', .006)


for x in cols_cfg['frontX']:
    column(x, cols_cfg['frontZ'])
for x in cols_cfg['frontX']:
    column(x, cols_cfg['rearZ'])
by0, by1 = cols_cfg['topBeamY']
for zc in (cols_cfg['frontZ'], cols_cfg['rearZ']):
    L.box('dadian-top-beam', (0, (by0 + by1) / 2, zc), (2 * bd['sideWallX'] - .1, by1 - by0, .3), 'wood', .01)
L.box('dadian-tie-beam', (0, (by0 + by1) / 2, (0 + bd['rearWallZ']) / 2),
      (.34, by1 - by0, bd['depthM'] - .2), 'wood', .01, True)
print(f'STAGE columns ok ({time.time() - T0:.1f}s)')

# central doorway: the +-2.3 columns are the jambs; CLOSED two-leaf doors,
# stone threshold, pull rings, thin gold center seam. No interior modeled.
clear_w = 2 * doors['leafSizeM'][0]
thr = doors['thresholdM']
L.box('door-threshold', (0, thr[1] / 2, -0.02), (thr[0], thr[1], thr[2]), 'stone', .012, True)
leaf_z = doors['leafCenterZ']
for sgn in (-1, 1):
    L.box('door-leaf', (sgn * clear_w / 4, doors['leafSizeM'][1] / 2 + thr[1], leaf_z),
          (doors['leafSizeM'][0], doors['leafSizeM'][1], doors['leafSizeM'][2]), 'dark', .008, True)
L.box('door-gold-seam', (0, doors['leafSizeM'][1] / 2 + thr[1], leaf_z + doors['leafSizeM'][2] / 2 + .004),
      (doors['goldSeamGapM'], doors['leafSizeM'][1] - .3, .012), 'gold', 0)
for sgn in (-1, 1):
    L.cyl('door-pull-ring', (sgn * (clear_w / 2 - doors['pullRingInsetX']), doors['pullRingY'], leaf_z + .05),
          (sgn * (clear_w / 2 - doors['pullRingInsetX']), doors['pullRingY'], leaf_z + .052),
          doors['pullRingRadiusM'], 'gold', 10)
    L.box('door-pull-seat', (sgn * (clear_w / 2 - doors['pullRingInsetX']), doors['pullRingY'] + doors['pullRingRadiusM'], leaf_z + .045),
          (.06, .05, .03), 'gold', .006)
# door frame trim around the opening (front side)
for sgn in (-1, 1):
    L.box('door-frame-trim', (sgn * (clear_w / 2 + .045), dw['heightM'] / 2 + thr[1], -0.06),
          (.09, dw['heightM'], .14), 'wood', .008)
L.box('door-frame-head', (0, dw['heightM'] + thr[1] + .06, -0.06), (clear_w + .18, .12, .14), 'wood', .008)
print(f'STAGE doorway ok ({time.time() - T0:.1f}s)')

# lattice side bays (four): framed dark-timber leaves, sill stone, waist rail,
# upper lattice bars, relief transom band above (3.6..4.3)
zb = bays['backingZ']
lat_y0, lat_y1 = bays['latticeY']
tr_y0, tr_y1 = bays['transomY']
for sgn in (-1, 1):
    for x0, x1 in bays['baySpansX']:
        x0, x1 = sgn * x0, sgn * x1
        if x0 > x1:
            x0, x1 = x1, x0
        xc, wb = (x0 + x1) / 2, x1 - x0
        L.box('bay-sill', (xc, bays['sillY'][1] / 2, zb), (wb, bays['sillY'][1], .18), 'stone', .008, True)
        L.box('bay-backing', (xc, (lat_y0 + lat_y1) / 2, zb), (wb, lat_y1 - lat_y0, .1), 'dark', 0, True)
        n = max(2, round(wb / bays['mullionSpacingM']))
        for k in range(n + 1):
            L.box('bay-mullion', (x0 + wb * k / n, (lat_y0 + lat_y1) / 2, zb - .05),
                  (.08, lat_y1 - lat_y0, .12), 'wood', .005)
        for yy in (lat_y0 + .06, bays['waistRailY'], lat_y1 - .06):
            L.box('bay-rail', (xc, yy + .05, zb - .045), (wb - .02, .1, .13), 'wood', .005)
        step = bays['mullionSpacingM']
        k = 0
        while True:
            x = x0 + (0.12 + step / 2) + step * k
            if x > x1 - .14:
                break
            L.box('bay-lattice-bar', (x, (bays['waistRailY'] + lat_y1) / 2, zb - .07),
                  (.035, lat_y1 - bays['waistRailY'] - .16, .05), 'wood', 0)
            k += 1
        L.box('bay-lower-panel', (xc, (lat_y0 + bays['waistRailY']) / 2, zb - .04),
              (wb - .14, bays['waistRailY'] - lat_y0 - .1, .05), 'dark', 0)
        # transom relief panel above the bay
        L.box('bay-transom-frame', (xc, (tr_y0 + tr_y1) / 2, zb), (wb, tr_y1 - tr_y0, .1), 'wood', .008)
        C.quad_out(L, 'bay-transom-face',
                   [(x0 + .06, tr_y0 + .04, zb - .06), (x1 - .06, tr_y0 + .04, zb - .06),
                    (x1 - .06, tr_y1 - .04, zb - .06), (x0 + .06, tr_y1 - .04, zb - .06)],
                   'relief', [(0, 0), (wb / 2.2, 0), (wb / 2.2, (tr_y1 - tr_y0) / 2.2), (0, (tr_y1 - tr_y0) / 2.2)],
                   (0, 0, -1))
        # plaster pier beyond the outermost bay up to the side wall
for sgn in (-1, 1):
    x_in = sgn * bays['baySpansX'][1][1]
    x_out = sgn * (bd['sideWallX'] - bd['sideWallThicknessM'])
    if x_in > x_out:
        x_in, x_out = x_out, x_in
    L.box('bay-end-pier', ((x_in + x_out) / 2, cfg['frontBand']['yRange'][0] / 2, zb),
          (abs(x_out - x_in), cfg['frontBand']['yRange'][0], .16), 'plaster', .008, True)
print(f'STAGE side_bays ok ({time.time() - T0:.1f}s)')

# S2. front band (dark timber + gold strip) y 4.3..5.2; strip above to the skirt
fbY0, fbY1 = fb['yRange']
L.box('front-band-backing', (0, (fbY0 + fbY1) / 2, -0.12), (2 * bd['sideWallX'], fbY1 - fbY0, .22), 'dark', 0, True)
L.box('front-band-lower-beam', (0, fbY0 + .09, .02), (2 * bd['sideWallX'] - .08, .18, .28), 'wood', .01)
L.box('front-band-upper-beam', (0, fbY1 - .1, .0), (2 * bd['sideWallX'] - .08, .2, .26), 'wood', .01)
L.box('front-band-gold-strip', (0, fb['upperGoldStripY'], .028), (2 * bd['sideWallX'] - .3, .05, .05), 'gold', 0)
L.box('front-wall-top-strip', (0, (fbY1 + 5.30) / 2, -0.11), (2 * bd['sideWallX'] - .1, 5.30 - fbY1, .2), 'plaster', 0)
print(f'STAGE front_band ok ({time.time() - T0:.1f}s)')

# S2b. midWallBand: the 重檐 diaphragm, four sides, red-brown planks + one
# horizontal groove line, corner posts, base apron flashing sealing the band
# bottom against the skirt surface
mbY0, mbY1 = mb['y']
mbX = mb['outlineXM']
mbT = mb['thicknessM']
L.GROUP = 'dadian-body'
band_faces = [
    ('front', (0, (mbY0 + mbY1) / 2, -mbT / 2 + 0.0), (2 * mbX, mbY1 - mbY0, mbT), (0, 0, 1), 2 * mbX),
    ('rear', (0, (mbY0 + mbY1) / 2, mb['rearZ'] + mbT / 2), (2 * mbX, mbY1 - mbY0, mbT), (0, 0, -1), 2 * mbX),
    ('left', (-mbX + mbT / 2, (mbY0 + mbY1) / 2, mb['rearZ'] / 2), (mbT, mbY1 - mbY0, bd['depthM'] - mbT), (-1, 0, 0), bd['depthM'] - mbT),
    ('right', (mbX - mbT / 2, (mbY0 + mbY1) / 2, mb['rearZ'] / 2), (mbT, mbY1 - mbY0, bd['depthM'] - mbT), (1, 0, 0), bd['depthM'] - mbT),
]
for nm, cc, ss, _hint, width in band_faces:
    L.box(f'band-{nm}', cc, ss, 'wood', .01, True)
    gy = mbY0 + mb['plankGrooveStepM']
    if gy < mbY1 - .05:
        L.box(f'band-{nm}-groove', (cc[0], gy, cc[2] + (0.0 if abs(_hint[2]) else 0)),
              (ss[0] if abs(_hint[2]) else .05, .03, ss[2] if abs(_hint[2]) else .0),
              'dark', 0) if False else None
# groove lines as thin proud strips on each face (simpler, no zero-size boxes)
for sgn_z, zc in ((1, -mbT / 2 - .012), (-1, mb['rearZ'] + mbT / 2 + .012)):
    L.box('band-groove-line', (0, mbY0 + mb['plankGrooveStepM'], zc), (2 * mbX - .1, .035, .026), 'dark', 0)
for sgn in (-1, 1):
    L.box('band-groove-line-side', (sgn * (mbX - mbT / 2 + sgn * .012 * -1), mbY0 + mb['plankGrooveStepM'], mb['rearZ'] / 2),
          (.026, .035, bd['depthM'] - mbT - .1), 'dark', 0)
    for z_end, zh in ((0.0, 1.0), (mb['rearZ'], -1.0)):
        L.box('band-corner-post', (sgn * (mbX - mbT / 2), (mbY0 + mbY1) / 2, z_end + .12 * -zh),
              (mbT + .06, mbY1 - mbY0 + .06, .24), 'dark', .008)
# base apron: dark flashing hugging the band outline at its bottom, sealing
# the sliver between band bottom and the skirt surface (N1 seam lesson)
ap = mb['baseApronH']
L.box('band-apron-front', (0, mbY0 - ap / 2 + .01, -mbT / 2), (2 * mbX + .1, ap, mbT + .1), 'dark', 0)
L.box('band-apron-rear', (0, mbY0 - ap / 2 + .01, mb['rearZ'] + mbT / 2), (2 * mbX + .1, ap, mbT + .1), 'dark', 0)
for sgn in (-1, 1):
    L.box('band-apron-side', (sgn * (mbX - mbT / 2), mbY0 - ap / 2 + .01, mb['rearZ'] / 2),
          (mbT + .1, ap, bd['depthM'] - mbT + .1), 'dark', 0)
print(f'STAGE midband ok ({time.time() - T0:.1f}s)')

# S3. main plaque on the midband front face (T1 construction, full-atlas face)
L.GROUP = 'dadian-plaque'
pw, ph = plq['sizeWH']
cx, cy = 0.0, plq['centerY']
z_face = plq['faceZ']
L.box('plaque-backing-plate', (cx, cy, z_face - .028), (pw, ph, .05), 'dark', .012)
for zc, inset, mat in ((z_face - .005, .055, 'dark'), (z_face - .03, .115, 'wood')):
    hx, hy = pw / 2 - inset, ph / 2 - inset
    hx2, hy2 = pw / 2 - inset - .05, ph / 2 - inset - .045
    for nm, cc, ss in [
        ('plaque-frame-l', (cx - (hx + hx2) / 2, cy, zc), (hx - hx2, 2 * hy, .05)),
        ('plaque-frame-r', (cx + (hx + hx2) / 2, cy, zc), (hx - hx2, 2 * hy, .05)),
        ('plaque-frame-b', (cx, cy - (hy + hy2) / 2, zc), (2 * hx2, hy - hy2, .05)),
        ('plaque-frame-t', (cx, cy + (hy + hy2) / 2, zc), (2 * hx2, hy - hy2, .05)),
    ]:
        L.box(nm, cc, ss, mat, .01)
for cc, ss in [
    ((cx - pw / 2 + .03, cy, z_face + .026), (.035, ph - .07, .012)),
    ((cx + pw / 2 - .03, cy, z_face + .026), (.035, ph - .07, .012)),
    ((cx, cy + ph / 2 - .022, z_face + .026), (pw - .14, .032, .012)),
    ((cx, cy - ph / 2 + .022, z_face + .026), (pw - .14, .032, .012)),
]:
    L.box('plaque-gold-edge', cc, ss, 'gold', 0)
fw, fh = pw - 2 * .17, ph - 2 * .1
C.quad_out(L, 'plaque-face',
           [(cx - fw / 2, cy - fh / 2, z_face), (cx + fw / 2, cy - fh / 2, z_face),
            (cx + fw / 2, cy + fh / 2, z_face), (cx - fw / 2, cy + fh / 2, z_face)],
           'plaque', [(0, 0), (1, 0), (1, 1), (0, 1)], (0, 0, 1))
print(f'STAGE plaque ok ({time.time() - T0:.1f}s)')

# S3b. couplet boards on the center columns — plain lacquer + gold frame, NO
# text (wording not evidenced)
L.GROUP = 'dadian-body'
cbw, cbh, cbt = cb['sizeM']
col_face_z = cols_cfg['frontZ'] + cs[2] / 2
for sgn in (-1, 1):
    ccx = sgn * abs(cb['onColumnsX'][0])
    zc = col_face_z + cbt / 2 + cb['boardFaceZ'] + cbt / 2
    L.box('couplet-board', (ccx, cb['centerY'], col_face_z + cbt / 2), (cbw, cbh, cbt), 'dark', .008)
    for cc, ss in [
        ((ccx, cb['centerY'] - cbh / 2 + .04, col_face_z + cbt + .006), (cbw - .06, .05, .012)),
        ((ccx, cb['centerY'] + cbh / 2 - .04, col_face_z + cbt + .006), (cbw - .06, .05, .012)),
        ((ccx - cbw / 2 + .03, cb['centerY'], col_face_z + cbt + .006), (.05, cbh - .1, .012)),
        ((ccx + cbw / 2 - .03, cb['centerY'], col_face_z + cbt + .006), (.05, cbh - .1, .012)),
    ]:
        L.box('couplet-gold-edge', cc, ss, 'gold', 0)
print(f'STAGE couplets ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S4. side walls (strips to the SKIRT soffit, N1-correct hints) + rear wall

sw_x = swc['x'] - swc['thicknessM'] / 2
sw_out_x = swc['x']
low = cfg['roofLower']
lowT = low['shellThicknessM']
for sgn in (-1, 1):
    x_in, x_out = sgn * (sw_x - swc['thicknessM']), sgn * sw_x
    low_top = swc['lowerTopY']
    L.box('side-wall-lower', (sgn * (sw_x - swc['thicknessM'] / 2), low_top / 2, -bd['depthM'] / 2),
          (swc['thicknessM'], low_top, bd['depthM']), 'plaster', 0, True)
    strips = []
    for k in range(math.ceil(bd['depthM'] / 0.35 - 1e-9)):
        z1 = -0.35 * k
        z2 = max(-bd['depthM'], z1 - 0.35)
        ya = low_y(sw_x - swc['thicknessM'] / 2, z1) - lowT - .02
        yb = low_y(sw_x - swc['thicknessM'] / 2, z2) - lowT - .02
        strips.append((z1, z2, min(ya, yb), max(ya, yb)))
    for z1, z2, ylo, yhi in strips:
        y0 = min(low_top - .02, ylo)
        C.quad_out(L, 'side-wall-upper-inner', [(x_in, y0, z1), (x_in, y0, z2), (x_in, yhi, z2), (x_in, ylo, z1)],
                   'plaster', [(z1 / 2.5, y0 / 2.5), (z2 / 2.5, y0 / 2.5),
                               (z2 / 2.5, yhi / 2.5), (z1 / 2.5, yhi / 2.5)], (-sgn, 0, 0))
        C.quad_out(L, 'side-wall-upper-outer', [(x_out, y0, z1), (x_out, y0, z2), (x_out, yhi, z2), (x_out, ylo, z1)],
                   'plaster', [(z1 / 2.5, y0 / 2.5), (z2 / 2.5, y0 / 2.5),
                               (z2 / 2.5, yhi / 2.5), (z1 / 2.5, yhi / 2.5)], (sgn, 0, 0))
        C.quad_out(L, 'side-wall-upper-top', [(x_in, yhi, z1), (x_in, yhi, z2), (x_out, yhi, z2), (x_out, yhi, z1)],
                   'plaster', [(z1 / 2.5, 0), (z2 / 2.5, 0), (z2 / 2.5, .13), (z1 / 2.5, .13)], (0, 1, 0))
    for zend, hint in ((0.0, (0, 0, 1)), (bd['rearWallZ'], (0, 0, -1))):
        yt = max(s[3] for s in strips)
        yb0 = min(low_top - .02, min(s[2] for s in strips))
        C.quad_out(L, 'side-wall-upper-end', [(x_in, yb0, zend), (x_out, yb0, zend),
                                              (x_out, yt, zend), (x_in, yt, zend)],
                   'plaster', [(x_in / 2.5, yb0 / 2.5), (x_out / 2.5, yb0 / 2.5),
                               (x_out / 2.5, yt / 2.5), (x_in / 2.5, yt / 2.5)], hint)
    L.box('side-wall-brick-base', (sgn * (sw_x - swc['thicknessM'] / 2), .4, -bd['depthM'] / 2),
          (swc['thicknessM'] + .06, .8, bd['depthM'] - .1), 'brick', 0)

# rear wall: plain plaster, wood frame posts, no openings (design_inference)
rz = bd['rearWallZ']
rh_in = bd['sideWallX'] - swc['thicknessM'] - .1
L.box('rear-wall', (0, cfg['frontBand']['yRange'][0] / 2 + .4, rz + bd['rearWallThicknessM'] / 2),
      (2 * rh_in, cfg['frontBand']['yRange'][0] + .8, bd['rearWallThicknessM']), 'plaster', 0, True)
L.box('rear-beam', (0, cfg['frontBand']['yRange'][0] + .88, rz + .05), (2 * rh_in - .2, .2, .34), 'wood', .01)
for sx in cols_cfg['frontX']:
    L.box('rear-frame-post', (sx, cfg['frontBand']['yRange'][0] / 2 + .3, rz + bd['rearWallThicknessM'] + .04),
          (.22, cfg['frontBand']['yRange'][0] + .6, .22), 'dark', .008)
print(f'STAGE walls ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S5. both roof shells (yimen machinery verbatim, parameterized)


def build_shell(tag, rf, surf):
    NU = 16
    SEG = rf['resampleSegments']
    THICK = rf['shellThicknessM']
    HW, Z_MID, ZF, ZR = rf['widthM'] / 2, rf['ridgeLocalZ'], rf['frontEaveZ'], rf['rearEaveZ']
    for sdir, z_end in ((1, ZF), (-1, ZR)):
        run = abs(z_end - Z_MID)
        grid_t, grid_b, uvs = [], [], []
        for j in range(SEG + 1):
            t = j / SEG
            for i in range(NU + 1):
                x = -HW + 2 * HW * i / NU
                z = Z_MID + sdir * run * t
                y = surf(x, z)
                n = C._surface_normal(surf, x, z)
                grid_t.append((x, y, z))
                grid_b.append((x, y - THICK * n[1], z - THICK * n[2]))
                uvs.append((x / 1.44, run * t / 1.36))
        npts = len(grid_t)
        faces = []
        for j in range(SEG):
            for i in range(NU):
                aa = j * (NU + 1) + i
                b2, c2, d2 = aa + 1, aa + NU + 2, aa + NU + 1
                faces.append((aa, d2, c2, b2) if sdir > 0 else (aa, b2, c2, d2))
                faces.append((npts + aa, npts + b2, npts + c2, npts + d2) if sdir > 0
                             else (npts + aa, npts + d2, npts + c2, npts + b2))
        for i_col, hint in ((0, (-1, 0, 0)), (NU, (1, 0, 0))):
            for j in range(SEG):
                aa = j * (NU + 1) + i_col
                a2 = (j + 1) * (NU + 1) + i_col
                C.quad_out(L, f'{tag}-wing-ring',
                           [grid_t[aa], grid_t[a2], grid_b[a2], grid_b[aa]], 'roof',
                           [(j / SEG * run / 1.44, 0), ((j + 1) / SEG * run / 1.44, 0),
                            ((j + 1) / SEG * run / 1.44, .12), (j / SEG * run / 1.44, .12)], hint)
        L.mesh(f'{tag}-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
        hint = (0, 0, 1) if sdir > 0 else (0, 0, -1)
        for i in range(NU):
            aa = SEG * (NU + 1) + i
            C.quad_out(L, f'{tag}-eave-fascia',
                       [grid_t[aa], grid_t[aa + 1], grid_b[aa + 1], grid_b[aa]], 'dark',
                       [(grid_t[aa][0] / 1.44, 0), (grid_t[aa + 1][0] / 1.44, 0),
                        (grid_t[aa + 1][0] / 1.44, rf['eaveFasciaH']), (grid_t[aa][0] / 1.44, rf['eaveFasciaH'])], hint)
    # soffit boards under front/rear overhangs
    sd = rf['soffitDepthM']
    for sdir, z_end in ((1, ZF), (-1, ZR)):
        zc = (z_end - sdir * sd / 2 + (0 if sdir > 0 else 0))
        zc = z_end - sdir * sd / 2
        L.box(f'{tag}-eave-soffit', (0, rf['eaveY'] - .1, zc), (2 * HW - .1, .09, sd - .05), 'dark', 0)


def build_ribs(tag, rf, surf):
    total = 0
    spacing = rf['tileRibs']['spacingChosenM']
    radius = rf['tileRibs']['radiusChosenM']
    secs = rf['tileRibs']['ribSections']
    HW, Z_MID = rf['widthM'] / 2, rf['ridgeLocalZ']
    for slope_dir, z_end in ((1, rf['frontEaveZ']), (-1, rf['rearEaveZ'])):
        run = z_end - Z_MID
        x = -HW + spacing / 2
        while x <= HW - spacing / 2 + 1e-9:
            C.rib_tube(L, f'{tag}-tile-rib', surf, x, .1, 1.0, Z_MID, run, radius, secs)
            x += spacing
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.name.startswith(f'{tag}-tile-rib'):
            o.data.calc_loop_triangles()
            total += len(o.data.loop_triangles)
    if total > rf['tileRibs']['budgetExtraTrisMax']:
        print('RIB_BUDGET_FAIL', tag, total)
        sys.exit(7)
    return total


low_rib_tris = build_ribs('skirt', low, low_y)
build_shell('skirt', low, low_y)
L.cyl('skirt-ridge-cap', (-low['ridgeLengthM'] / 2, low['ridgeY'] + low['ridgeCapRollRadiusM'] * .5, low['ridgeLocalZ']),
      (low['ridgeLengthM'] / 2, low['ridgeY'] + low['ridgeCapRollRadiusM'] * .5, low['ridgeLocalZ']),
      low['ridgeCapRollRadiusM'], 'roof', 10)
print(f'STAGE roof_lower ok (ribs {low_rib_tris} tris)')

build_shell('main', cfg['roofUpper'], up_y)
up_rib_tris = build_ribs('main', cfg['roofUpper'], up_y)
print(f'STAGE roof_upper shell ok (ribs {up_rib_tris} tris)')

# S5b. 歇山读感 gable overlays + full-length crest (DESIGN_SPEC.roofUpper)
ru = cfg['roofUpper']
g = ru['gableTreatment']
gx = g['gablePlaneXM']
gz0, gz1 = g['triangleZRange']
apex_z, apex_y = g['apex']
t = 0  # placeholder to keep flake quiet
# gable triangle panel: vertical quad strip (two triangles) at x=+-gx
for sgn in (-1, 1):
    x = sgn * gx
    base_pts = [(x, g['baseY'], gz0), (x, g['baseY'], gz1)]
    apex_pt = (x, apex_y, apex_z)
    # panel: two triangles (base edge to apex) with slight thickness
    for dz in (0.0, sgn * g['panelThicknessM']):
        pass
    inner = [(x - sgn * g['panelThicknessM'], g['baseY'], gz0),
             (x - sgn * g['panelThicknessM'], g['baseY'], gz1),
             (x - sgn * g['panelThicknessM'], apex_y, apex_z)]
    outer = [(x, g['baseY'], gz0), (x, g['baseY'], gz1), (x, apex_y, apex_z)]
    C.quad_out(L, 'gable-panel-a', [outer[0], outer[1], apex_pt, apex_pt], 'plaster',
               [(0, 0), (1, 0), (.5, 1), (.5, 1)], (sgn, 0, 0))
    C.quad_out(L, 'gable-panel-b', [inner[0], inner[1], inner[2], inner[2]], 'plaster',
               [(0, 0), (1, 0), (.5, 1), (.5, 1)], (-sgn, 0, 0))
    # edge walls of the panel (top raking edges get the dark trim below; the
    # bottom and verticals are buried against the shell/wall)
    for p, q in ((outer[0], outer[2]), (outer[1], outer[2])):
        C.quad_out(L, 'gable-panel-edge', [p, q, (q[0] - sgn * g['panelThicknessM'], q[1], q[2]),
                                           (p[0] - sgn * g['panelThicknessM'], p[1], p[2])],
                   'plaster', [(0, 0), (1, 0), (1, .1), (0, .1)], (0, 1, 0) if abs(p[2] - q[2]) > 1 else (0, 0, sgn * 0 + (1 if p[2] > q[2] else -1)))
    # dark raking trim on both slanted edges (outside face)
    for p, q in ((outer[0], outer[2]), (outer[1], outer[2])):
        L.box('gable-rake-trim', ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2),
              (g['edgeTrimW'], math.dist(p, q) * 0 + 0.0 + g['edgeTrimW'], math.dist(p, q)),
              'dark', 0) if False else None
        # oriented box along the rake: use a thin box rotated via two ends
        L.cyl('gable-rake-trim', p, q, g['edgeTrimW'] / 2, 'dark', 6)
    # 博脊 apron box across the panel base
    L.box('gable-apron', (x, g['baseY'] - g['apronM'][1] / 2, (gz0 + gz1) / 2),
          (g['panelThicknessM'] + .04, g['apronM'][1], abs(gz1 - gz0) + .04), 'dark', 0)
# crest beam between the gable apexes + end ornaments
cr = ru['ridge']['crestBeamM']
L.box('crest-beam', (0, apex_y + cr[1] / 2 + 0.02, ru['ridgeLocalZ']),
      (cr[2], cr[1], cr[0]), 'dark', .01)
# ornaments: simplified box-step curls at both crest ends
orn = []
for sgn in (-1, 1):
    bx = sgn * (g['gablePlaneXM'] + .12)
    orn.append(L.box('crest-ornament-a', (bx, apex_y + cr[1] / 2 + .22, ru['ridgeLocalZ'] - sgn * .08), (.4, .5, .34), 'dark', .01))
    orn.append(L.box('crest-ornament-b', (bx - sgn * .1, apex_y + cr[1] / 2 + .62, ru['ridgeLocalZ'] - sgn * .2), (.32, .44, .3), 'dark', .01))
    orn.append(L.box('crest-ornament-c', (bx - sgn * .26, apex_y + cr[1] / 2 + .92, ru['ridgeLocalZ'] - sgn * .34), (.22, .34, .42), 'dark', .01))
_orn_tris = 0
for o in orn:
    o.data.calc_loop_triangles()
    _orn_tris += len(o.data.loop_triangles)
if _orn_tris > ru['ridge']['endOrnamentTrisMax']:
    print('ORNAMENT_BUDGET_FAIL', _orn_tris)
    sys.exit(7)
print(f'STAGE gable_read ok (ornaments {_orn_tris} tris)')

# ---------------------------------------------------------------------------
# collision normalization + interior-empty assertion BEFORE any export

adapter_coll = []
for rec in L.COLL:
    cx, cy, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'dadian-body'),
                         'type': 'box',
                         'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cy, cz], 'size': [sx, sy, sz]}})

# the hall interior must be EMPTY (doors closed, interior never modeled):
# x +-1.9, y 0.25..4.0, z -11.5..-3.0
INTERIOR = {'x': 1.9, 'y0': 0.25, 'y1': 4.0, 'z0': -11.5, 'z1': -3.0}
clashes = []
for rec in adapter_coll:
    if rec['max'][0] <= -INTERIOR['x'] or rec['min'][0] >= INTERIOR['x']:
        continue
    if rec['max'][1] <= INTERIOR['y0'] or rec['min'][1] >= INTERIOR['y1']:
        continue
    if rec['max'][2] <= INTERIOR['z0'] or rec['min'][2] >= INTERIOR['z1']:
        continue
    clashes.append(rec['name'])
if clashes:
    print('INTERIOR_BLOCKED', clashes)
    sys.exit(3)
print(f'INTERIOR_CLEAR through {len(adapter_coll)} colliders ({time.time() - T0:.1f}s)')

# body-stage triangle budget checkpoint (everything so far, roofs included
# cannot exceed the total; body-only check uses the config budget)
body_stage_tris = 0
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        body_stage_tris += len(o.data.loop_triangles)
print(f'triangles so far: {body_stage_tris} (final budget {BUD["dadianTrisMax"]})')

# ---------------------------------------------------------------------------
# finalize: join by (group, material), export, reimport check, sidecars

TARGETS = [('dadian.glb', ('dadian-body', 'dadian-plaque'))]
out = a.out
out.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='DESELECT')
parts = {}
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        parts.setdefault((o.get('part', 'misc'), o.data.materials[0].name), []).append(o)
for (group, material), items in parts.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in items:
        o.select_set(True)
    bpy.context.view_layer.objects.active = items[0]
    if len(items) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = group + '__' + material
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for poly in o.data.polygons:
        poly.use_smooth = False
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
for image in bpy.data.images:
    if image.filepath:
        image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'scene.blend'))


def tris_of(groups):
    total = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') in groups:
            o.data.calc_loop_triangles()
            total += len(o.data.loop_triangles)
    return total


measure = {'moduleId': cfg['sampleId'], 'units': 'meters', 'surveyed': False,
           'axis': cfg['axis'], 'bakedGlobalIllumination': False,
           'referencePhotoTexturesUsed': False, 'targets': {}, 'timings': {}}
for fname, groups in TARGETS:
    bpy.ops.object.select_all(action='DESELECT')
    sel = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') in groups:
            o.select_set(True)
            sel += 1
    if sel == 0:
        print('EXPORT_EMPTY', fname, groups)
        sys.exit(4)
    bpy.ops.export_scene.gltf(filepath=str(out / fname), export_format='GLB', export_yup=True,
                              export_apply=True, export_animations=False, export_tangents=True,
                              export_image_format='JPEG', export_jpeg_quality=92,
                              export_cameras=False, export_lights=False, use_selection=True)
    data = (out / fname).read_bytes()
    measure['targets'][fname] = {
        'groups': list(groups), 'objects': sel, 'triangles': tris_of(groups),
        'fileBytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
    }
    print(f'EXPORTED {fname} objs={sel} tris={tris_of(groups)} bytes={len(data)}')

dT = measure['targets']['dadian.glb']
if dT['triangles'] > BUD['dadianTrisMax']:
    print('BUDGET_FAIL dadianTris', dT['triangles'])
    sys.exit(5)
if dT['fileBytes'] > BUD['dadianGlbBytesMax']:
    print('BUDGET_FAIL dadianGlbBytes', dT['fileBytes'])
    sys.exit(5)

original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / 'dadian.glb'))
observed = []
bounds = [[1e9] * 3, [-1e9] * 3]
meshes = 0
for o in check.objects:
    if o.type != 'MESH':
        continue
    meshes += 1
    for corner in o.bound_box:
        v = o.matrix_world @ Vector(corner)
        for k in range(3):
            bounds[0][k] = min(bounds[0][k], v[k])
            bounds[1][k] = max(bounds[1][k], v[k])
for m in {m for o in check.objects if o.type == 'MESH' for m in o.data.materials}:
    observed.append({'name': m.name, 'imageNodes': [
        {'name': n.image.name, 'size': list(n.image.size),
         'colorSpace': n.image.colorspace_settings.name}
        for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]})
reimport = {'imported': True, 'meshes': meshes, 'boundsBlender': bounds, 'materials': observed}
(out / 'reimport-check.json').write_text(json.dumps(reimport, ensure_ascii=False, indent=2) + '\n',
                                         encoding='utf-8')
bpy.context.window.scene = original

plq_ok = any(m['name'].startswith('dadian-plaque') and m['imageNodes']
             and max(m['imageNodes'][0]['size']) >= 512 for m in observed)
if not plq_ok:
    print('TEXTURE_CONNECTION_FAIL', observed)
    sys.exit(6)

(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; LOCAL frame (facade +Z at z=0); world placement (0,0,-44) yaw 0',
    'worldPlacement': {'originGlbWorld': cfg['placement']['originGlbWorld'],
                       'yawRad': cfg['placement']['yawRad']},
    'adapterFormat': 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
    'interiorVerifiedEmpty': INTERIOR,
    'doorsClosedCollider': True,
    'colliders': adapter_coll,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {
    'dadianTris': {'actual': dT['triangles'], 'limit': BUD['dadianTrisMax'], 'pass': True},
    'dadianGlbBytes': {'actual': dT['fileBytes'], 'limit': BUD['dadianGlbBytesMax'], 'pass': True},
    'skirtRibsTris': {'actual': low_rib_tris, 'limit': low['tileRibs']['budgetExtraTrisMax'], 'pass': True},
    'mainRibsTris': {'actual': up_rib_tris, 'limit': ru['tileRibs']['budgetExtraTrisMax'], 'pass': True},
    'ornamentsTris': {'actual': _orn_tris, 'limit': ru['ridge']['endOrnamentTrisMax'], 'pass': True},
    'newImages': {'actual': 1, 'limit': BUD['newImagesMax'], 'pass': True,
                  'note': 'dadian-plaque.png; relief normal shared with shanmen'},
}
measure['design'] = {
    'family': cfg['family'],
    'reference': cfg['reference'],
    'clearDoorwayM': [dw['widthM'], dw['heightM']],
    'plaque': {'text': plq['readRightToLeft'], 'atlas': 'dadian-plaque.png (single, full UV)'},
    'roofMethod': ('TWO yimen-style profile-lofted shells: skirt 26.4m eave 5.2 ridge 6.0, '
                   'main 22.8m eave 7.0 ridge 12.4; midWallBand 5.95-7.0 is the 重檐 diaphragm; '
                   '歇山读感 gable overlays at x=+-9.0 + 18m crest beam (pre-set 2026-09-16, '
                   'aerial PBR-SH-0005-001; NOT a true-xieshan topology)'),
    'stackingClearanceM': round(gap_min, 3),
    'rear': 'plain design inference',
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')

# verification dataset: BOTH shells sampled on their exact grids
NU = 16
grid = {'source': 'kit/build_dadian.py roof_y per shell (yimen monotone-by-construction machinery)',
        'equation': ru['surfaceEquation'],
        'shells': {}}
for nm, rf, surf in (('lower', low, low_y), ('upper', ru, up_y)):
    HW, Z_MID, ZF, ZR = rf['widthM'] / 2, rf['ridgeLocalZ'], rf['frontEaveZ'], rf['rearEaveZ']
    SEG = rf['resampleSegments']
    gx = [-HW + 2 * HW * i / NU for i in range(NU + 1)]
    shell = {'gridX': gx, 'ridgeY': rf['ridgeY'], 'eaveY': rf['eaveY'],
             'cornerLiftM': rf['cornerLiftM'], 'widthM': rf['widthM'], 'front': [], 'rear': []}
    for j in range(SEG + 1):
        t = j / SEG
        zf = Z_MID + (ZF - Z_MID) * t
        zr = Z_MID + (ZR - Z_MID) * t
        shell['front'].append({'t': t, 'z': zf, 'y': [round(surf(x, zf), 6) for x in gx]})
        shell['rear'].append({'t': t, 'z': zr, 'y': [round(surf(x, zr), 6) for x in gx]})
    grid['shells'][nm] = shell
(out / 'roof-surface-samples.json').write_text(json.dumps(grid, ensure_ascii=False, indent=2) + '\n',
                                               encoding='utf-8')

print(f"DADIAN_READY tris={dT['triangles']} bytes={dT['fileBytes']} "
      f"skirtRibs={low_rib_tris} mainRibs={up_rib_tris} total={time.time() - T0:.1f}s")
