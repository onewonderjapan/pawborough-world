"""Chenghuangmiao yimen (second gate) pilot builder — the entry group's far
gate at world (0, 0, -21). Built in its own LOCAL frame (front-wall center
bottom origin, facade +Z, depth -Z); the world assembly translates it.

One process exports:
  yimen.glb     the whole gate: body group (walls/columns/lattice/roof/frieze)
                and yimen-plaque group (stepped-frame plaques) kept separate

Design source: kit/yimen.config.json (strict schema; every value traces to the
lead's DESIGN_SPEC.json 20260915 — dimensions are design, not survey). The roof
is ONE continuous wide slope in both directions with a 10.4m ridge, gentle
0.28m corner lift confined to |x|>6.2 AND the outer 35% of slope depth — the
shanmen T3 lessons are baked in: the ridge line never lifts, the corner lift
decays to zero toward the ridge, the soffit is the same continuous surface
offset along its normal, and both gable ends close under the wing-tip edges.

Run:
  blender -b --factory-startup -t 4 -P kit/build_yimen.py -- \
      --config kit/yimen.config.json --out kit/out/yimen
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
             'rearWallZ': None, 'rearWallThicknessM': None, 'wallEndXBeyondColumn': None},
    'columns': {'frontX': None, 'rearZ': None, 'sizeM': None, 'material': None, 'topBeamY': None},
    'clearDoorway': {'widthM': None, 'heightM': None, 'localZRange': None, 'jambWidthM': None,
                     'throughFrame': None},
    'sideBays': {'mode': None, 'innerEdgeX': None, 'outerEdgeX': None, 'subDoorCount': None,
                 'waistRailY': None, 'latticeBarStepM': None, 'backingMaterial': None,
                 'visibleMaterial': None},
    'frontBand': {'yRange': None, 'upperGoldStripY': None, 'mainCarvedLintelY': None,
                  'maxReliefDepthM': None, 'darkTimberBase': None, 'carvedMotif': None},
    'roof': {'widthM': None, 'frontEaveZ': None, 'rearEaveZ': None, 'ridgeY': None,
             'ridgeLengthM': None, 'ridgeLocalZ': None, 'eaveY': None, 'shellThicknessM': None,
             'profileTY': None, 'cornerLiftM': None, 'cornerLiftXStartsM': None,
             'cornerLiftDepthTStarts': None, 'hipEndTopY': None, 'hipStartsXM': None,
             'surfaceEquation': None, 'resampleSegments': None,
             'tileRibs': {'spacingM': None, 'spacingChosenM': None, 'radiusM': None,
                          'radiusChosenM': None, 'stripSections': None, 'slopes': None,
                          'budgetExtraTrisMax': None},
             'eaveFasciaH': None, 'note': None},
    'ridgeFrieze': {'heightM': None, 'panels': None, 'panelGapM': None, 'capRollRadiusM': None,
                    'endBlockM': None, 'panelMotif': None},
    'sidePlaques': {'left': {'literalLeftToRight': None, 'readRightToLeft': None},
                    'right': {'literalLeftToRight': None, 'readRightToLeft': None},
                    'centersX': None, 'sizeWH': None, 'centerY': None, 'faceTexture': None,
                    'construction': None, 'source': None},
    'rearDesign': {'mode': None, 'designInference': None, 'note': None},
    'budgets': {'yimenTrisMax': None, 'yimenGlbBytesMax': None, 'newImagesMax': None,
                'newImageEdgePxMax': None},
    'runtime': None,
    'review': None,
    'uncertaintyPolicy': None,
}


def check_keys(obj, spec, path):
    problems = []
    if not isinstance(obj, dict):
        return [f'{path}: expected object']
    extra = sorted(set(obj) - set(spec))
    missing = sorted(set(spec) - set(obj))
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


def validate(c):
    pr = check_keys(c, SCHEMA, 'config')
    rf, dr, sp = c['roof'], c['ridgeFrieze'], c['sidePlaques']
    dw = c['clearDoorway']

    if c['units'] != 'meters':
        pr.append('units must be meters')
    if 'Y-up' not in c['axis'] or '+Z' not in c['axis']:
        pr.append('axis must state GLB Y-up and facade +Z')
    if c['reference']['dimensionsAreDesign'] is not True:
        pr.append('dimensions must be flagged design (not survey)')
    if c['placement']['originGlbWorld'] != [0, 0, -21] or c['placement']['yawRad'] != 0:
        pr.append('world placement must be (0,0,-21) yaw 0 per DESIGN_SPEC')

    # doorway contract from three independent fields
    cols = sorted(c['columns']['frontX'])
    colw = c['columns']['sizeM'][0]
    span = cols[2] - cols[1] - colw
    if abs(span - (dw['widthM'] + 2 * dw['jambWidthM'])) > 1e-6:
        pr.append(f'central intercolumniation {span} must equal doorway {dw["widthM"]} + 2 jambs')
    if dw['localZRange'] != [0, -c['body']['depthM']]:
        pr.append('doorway must run through the full body depth')

    # roof: one continuous slope, ridge never lifts, lift bands per spec
    if abs(rf['profileTY'][0][1] - rf['ridgeY']) > 1e-6:
        pr.append('profile t=0 must sit at the ridge height')
    if abs(rf['profileTY'][-1][1] - rf['eaveY']) > 1e-6:
        pr.append('profile t=1 must land at the eave height')
    ys = [y for _, y in rf['profileTY']]
    if any(y > rf['ridgeY'] + 1e-6 or y < rf['eaveY'] - 0.05 for y in ys):
        pr.append('profile heights escape the ridge..eave band')
    if not (4 <= len(rf['profileTY']) <= 24):
        pr.append('profile needs 4..24 samples')
    if not (10 <= rf['resampleSegments'] <= 16):
        pr.append('resample segments must be 10-16')
    if rf['ridgeLengthM'] >= rf['widthM']:
        pr.append('ridge must be shorter than the roof width (hip ends)')
    if rf['cornerLiftXStartsM'] <= rf['hipStartsXM'] or rf['cornerLiftXStartsM'] >= rf['widthM'] / 2:
        pr.append('corner lift x band must sit inside the hip zone, inside the half width')
    if not (0.0 < rf['cornerLiftDepthTStarts'] < 1.0):
        pr.append('corner lift depth start must be an interior t')
    if not (rf['eaveY'] < rf['hipEndTopY'] < rf['ridgeY']):
        pr.append('hipEndTopY must sit between eave and ridge')
    tr = rf['tileRibs']
    if not (tr['spacingM'][0] <= tr['spacingChosenM'] <= tr['spacingM'][1]):
        pr.append(f"tile rib spacing {tr['spacingChosenM']} outside band {tr['spacingM']}")
    if not (tr['radiusM'][0] <= tr['radiusChosenM'] <= tr['radiusM'][1]):
        pr.append(f"tile rib radius {tr['radiusChosenM']} outside band {tr['radiusM']}")
    if tr['stripSections'] != 8:
        pr.append('tile ribs use 8 strip sections (shanmen accepted method)')

    # frieze panels fit the ridge
    if rf['ridgeLengthM'] / c['ridgeFrieze']['panels'] < 0.8:
        pr.append('frieze panels too narrow for the ridge length')

    # plaques: right-to-left reading contract, atlas present
    if sp['left']['literalLeftToRight'] != '亡必惡為' or sp['left']['readRightToLeft'] != '為惡必亡':
        pr.append('left plaque text must be 為惡必亡 (RTL), literals 亡必惡為')
    if sp['right']['literalLeftToRight'] != '昌必善為' or sp['right']['readRightToLeft'] != '為善必昌':
        pr.append('right plaque text must be 為善必昌 (RTL), literals 昌必善為')
    if sp['left']['literalLeftToRight'] != sp['left']['readRightToLeft'][::-1]:
        pr.append('left literal must be the mirror of the reading')
    if sp['right']['literalLeftToRight'] != sp['right']['readRightToLeft'][::-1]:
        pr.append('right literal must be the mirror of the reading')
    bays = c['sideBays']
    for cx in sp['centersX']:
        if not (bays['innerEdgeX'] + sp['sizeWH'][0] / 2 <= abs(cx) <= bays['outerEdgeX'] - sp['sizeWH'][0] / 2 + 0.35):
            pr.append(f'plaque at x={cx} does not sit over its side bay')
    if not (c['frontBand']['yRange'][0] <= sp['centerY'] - sp['sizeWH'][1] / 2
            and sp['centerY'] + sp['sizeWH'][1] / 2 <= c['frontBand']['yRange'][1]):
        pr.append('plaques must fit inside the front band y range')
    if c['frontBand']['maxReliefDepthM'] > 0.08:
        pr.append('front band relief depth must stay <= 0.08m')

    tex = HERE / 'textures' / Path(sp['faceTexture']).name
    if not tex.exists():
        pr.append(f'referenced texture missing: {sp["faceTexture"]}')
    else:
        ww, hh = png_size(tex)
        if max(ww, hh) > c['budgets']['newImageEdgePxMax']:
            pr.append(f'{tex.name} exceeds the texture edge budget')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# materials: frozen street palette + the shanmen temple images + ONE new atlas

L.reset_scene()
L.build_materials()
L.M['plaque'] = L.mat('yimen-plaque-lacquer', '141416', .38, base='yimen-plaques.png', extend=True)
L.M['relief'] = L.mat('temple-relief-stone', '9a9a8c', .92,
                      normal='temple-relief-normal.png', tile=(1.8, 2.15))
L.META['yimen-plaque-lacquer']['source'] = (
    'locally authored (kit/make_yimen_textures.py; Noto Serif CJK Bold glyphs; '
    'texts read by the lead from PBR-SH-0002-040)')
L.META['temple-relief-stone']['source'] = 'shared with shanmen (kit/make_temple_textures.py)'

rf, bd = cfg['roof'], cfg['body']
cols_cfg, dw, bays, fb = cfg['columns'], cfg['clearDoorway'], cfg['sideBays'], cfg['frontBand']
BUD = cfg['budgets']

# ---------------------------------------------------------------------------
# the continuous roof surface (single source of truth; shells, closures,
# frieze tucking, wall tops and the verification dataset all share it)

profile = rf['profileTY']
_drop = C.make_drop_fn(profile, rf['resampleSegments'])
HW = rf['widthM'] / 2                     # 7.8
RIDGE_HALF = rf['ridgeLengthM'] / 2       # 5.2
Z_MID = rf['ridgeLocalZ']                 # -2.6
ZF, ZR = rf['frontEaveZ'], rf['rearEaveZ']
THICK = rf['shellThicknessM']


def top_y(x):
    a = abs(x)
    if a <= RIDGE_HALF:
        return rf['ridgeY']
    return rf['ridgeY'] - (rf['ridgeY'] - rf['hipEndTopY']) * C.smoothstep(RIDGE_HALF, HW, a)


def lift_total(x):
    return rf['cornerLiftM'] * C.smoothstep(rf['cornerLiftXStartsM'], HW, abs(x)) ** 2


_D0 = None


def lift_at(x, t):
    """Corner lift ramping in the depth window t>0.65. The ramp follows the
    profile's own drop: w(t)=(drop(t)-drop(0.65))/(1-drop(0.65)). Then
    dy/dt = drop'*(lift_total/(1-drop(0.65)) - fall) and since
    lift_total < (1-drop(0.65))*fall for every x on this roof, the surface is
    monotone ridge->eave BY CONSTRUCTION — the shanmen upturned-board failure
    cannot occur, no post-hoc clamping needed."""
    global _D0
    if t <= rf['cornerLiftDepthTStarts']:
        return 0.0
    if _D0 is None:
        _D0 = _drop(rf['cornerLiftDepthTStarts'])
    return lift_total(x) * (_drop(t) - _D0) / (1.0 - _D0)


def roof_y(x, z):
    if z >= Z_MID:
        t = min(1.0, max(0.0, (z - Z_MID) / (ZF - Z_MID)))
    else:
        t = min(1.0, max(0.0, (Z_MID - z) / (Z_MID - ZR)))
    ty = top_y(x)
    return ty - (ty - rf['eaveY']) * _drop(t) + lift_at(x, t)


# analytic self-checks mirroring the shanmen T3 lessons (hard fail)
for kx in (0.0, RIDGE_HALF / 2, RIDGE_HALF):
    if abs(roof_y(kx, Z_MID) - rf['ridgeY']) > 1e-9:
        print('ROOF_EQUATION_FAIL ridge not flat at', kx)
        sys.exit(8)
if abs(roof_y(HW, ZF) - (rf['eaveY'] + rf['cornerLiftM'])) > 1e-9:
    print('ROOF_EQUATION_FAIL corner lift wrong at the eave corner')
    sys.exit(8)
if abs(roof_y(HW - 0.01, ZF) - (rf['eaveY'] + rf['cornerLiftM'])) > 1e-3:
    print('ROOF_EQUATION_FAIL corner lift not settled at the eave corner')
    sys.exit(8)
for kx in (0.0, 4.0, 7.0):
    if abs(lift_at(kx, rf['cornerLiftDepthTStarts'])) > 1e-12:
        print('ROOF_EQUATION_FAIL lift leaks to the depth-start boundary at', kx)
        sys.exit(8)
if abs(roof_y(HW, Z_MID) - rf['hipEndTopY']) > 1e-9:
    print('ROOF_EQUATION_FAIL hip end top wrong')
    sys.exit(8)
# monotone fall ridge->eave along the profile direction for every column
_N = 40
for i in range(_N + 1):
    x = -HW + 2 * HW * i / _N
    prev = roof_y(x, Z_MID)
    for j in range(1, 25):
        z = Z_MID + (ZF - Z_MID) * j / 24
        y = roof_y(x, z)
        if y > prev + 1e-9:
            print('ROOF_EQUATION_FAIL surface rises toward the eave at', x)
            sys.exit(8)
        prev = y
print('roof equation checks ok (ridge flat / corner lift confined / monotone)')

# ---------------------------------------------------------------------------
# S1. body: columns, doorway frame, lattice side bays, walls

L.GROUP = 'yimen-body'
cs = cols_cfg['sizeM']


def column(x, z):
    L.box('yimen-column', (x, cs[1] / 2, z), (cs[0], cs[1], cs[2]), 'wood', .01, True)
    L.box('yimen-column-plinth', (x, .17, z), (cs[0] + .16, .34, cs[2] + .16), 'stone', .012, True)
    L.box('yimen-column-foot', (x, .38, z), (cs[0] + .02, .1, cs[2] + .02), 'wood', .006)


for x in cols_cfg['frontX']:
    column(x, -cs[2] / 2 - 0.02)
    column(x, cols_cfg['rearZ'])
print(f'STAGE columns ok ({time.time() - T0:.1f}s)')

# top beams over both rows + the long tie beam
by0, by1 = cols_cfg['topBeamY']
for zc in (-cs[2] / 2 - 0.02, cols_cfg['rearZ']):
    L.box('yimen-top-beam', (0, (by0 + by1) / 2, zc), (2 * bd['sideWallX'] - .1, by1 - by0, .3), 'wood', .01)
L.box('yimen-tie-beam', (0, (by0 + by1) / 2, (0 - bd['depthM']) / 2),
      (.34, by1 - by0, bd['depthM'] - .2), 'wood', .01, True)

# central doorway: jambs + lintel, open through-passage (no leaves)
L.GROUP = 'yimen-body'
jw = dw['jambWidthM']
for sgn in (-1, 1):
    L.box('door-jamb', (sgn * (dw['widthM'] / 2 + jw / 2), fb['yRange'][1] / 2, -bd['depthM'] / 2),
          (jw, fb['yRange'][1], bd['depthM'] - .06), 'wood', .01, True)
L.box('door-lintel', (0, dw['heightM'] + .18, -bd['depthM'] / 2),
      (dw['widthM'] + 2 * jw, .36, bd['depthM'] - .1), 'wood', .01, True)
L.box('door-lintel-trim', (0, dw['heightM'] + .035, -0.06),
      (dw['widthM'] - .06, .07, .18), 'dark', .008)
print(f'STAGE doorway ok ({time.time() - T0:.1f}s)')

# lattice side bays: framed dark-timber doors with real collision. Sub-doors
# with mullions/waist rails keep the mass framed (N1 lesson: no bare slab).
for sgn in (-1, 1):
    x_in = sgn * bays['innerEdgeX']
    x_out = sgn * bays['outerEdgeX']
    xc = (x_in + x_out) / 2
    wb = abs(x_out - x_in)
    zb = -0.18
    L.box('bay-backing', (xc, dw['heightM'] / 2 + .1, zb), (wb, dw['heightM'] + .2, .1),
          bays['backingMaterial'], 0, True)
    n = bays['subDoorCount']
    for k in range(n + 1):
        L.box('bay-mullion', (x_in + sgn * wb * k / n, dw['heightM'] / 2 + .1, zb - .05),
              (.09, dw['heightM'] + .2, .12), 'wood', .005)
    for yy in (0.06, bays['waistRailY'], dw['heightM'] - .06):
        L.box('bay-rail', (xc, yy + .08, zb - .045), (wb - .02, .11, .13), 'wood', .005)
    # lattice bars in the upper field only; the lower field gets inset panels
    step = bays['latticeBarStepM']
    k = 0
    while True:
        x = x_in + sgn * (0.14 + step / 2) + sgn * step * k
        if abs(x - x_in) > wb - .16:
            break
        L.box('bay-lattice-bar', (x, (bays['waistRailY'] + dw['heightM']) / 2 + .1, zb - .07),
              (.04, dw['heightM'] - bays['waistRailY'] - .2, .05), 'wood', 0)
        k += 1
    for k2 in range(n):
        pcx = x_in + sgn * wb * (k2 + .5) / n
        L.box('bay-lower-panel', (pcx, bays['waistRailY'] / 2 + .08, zb - .04),
              (wb / n - .12, bays['waistRailY'] - .12, .05), 'dark', 0)
    # solid wall ends beyond the outer columns (plaster piers with corner post)
    x_end_in = sgn * (bays['outerEdgeX'] + .02)
    x_end_out = sgn * (bd['sideWallX'] - bd['sideWallThicknessM'] / 2)
    L.box('bay-end-pier', ((x_end_in + x_end_out) / 2, dw['heightM'] / 2 + .1, zb),
          (abs(x_end_out - x_end_in), dw['heightM'] + .2, .16), 'plaster', .008, True)
    L.box('bay-corner-post', (sgn * (bd['sideWallX'] - .25), (dw['heightM'] + .6) / 2, -.05),
          (.24, dw['heightM'] + .6, .24), 'dark', .008)
print(f'STAGE side_bays ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S2. the front band (dark timber + gold strip + carved lintel) y 3.25..4.85

fbY0, fbY1 = fb['yRange']
L.box('front-band-backing', (0, (fbY0 + fbY1) / 2, -0.12),
      (2 * bd['sideWallX'], fbY1 - fbY0, .22), 'dark', 0, True)
L.box('front-band-lower-beam', (0, fbY0 + .09, .04), (2 * bd['sideWallX'] - .08, .18, .3), 'wood', .01)
L.box('front-band-upper-beam', (0, fbY1 - .1, .02), (2 * bd['sideWallX'] - .08, .2, .26), 'wood', .01)
# thin gold strip near the top — a LINE, not a gold slab
L.box('front-band-gold-strip', (0, fb['upperGoldStripY'], .045),
      (2 * bd['sideWallX'] - .3, .05, .05), 'gold', 0)
# main carved lintel over the central doorway: shallow floral scroll relief
# (reused temple relief normal), depth inside the 0.08m band, plus short
# corbel blocks under it — restrained, no fake calligraphy
clY = fb['mainCarvedLintelY']
L.box('carved-lintel', (0, clY, .03), (dw['widthM'] + 2 * jw + 1.6, .52, .2), 'relief', .012)
for sgn in (-1, 1):
    L.box('lintel-corbel', (sgn * (dw['widthM'] / 2 + jw + .42), clY - .3, .1),
          (.3, .24, .26), 'wood', .01)
    L.box('lintel-corbel-gold', (sgn * (dw['widthM'] / 2 + jw + .42), clY - .38, .12),
          (.31, .035, .22), 'gold', 0)
print(f'STAGE front_band ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S3. the roof: ONE continuous shell, closed soffit, wing-edge closures

NU = 16
SEG = rf['resampleSegments']
roof_surface = roof_y
for sdir, z_end in ((1, ZF), (-1, ZR)):
    run = abs(z_end - Z_MID)
    grid_t, grid_b, uvs = [], [], []
    for j in range(SEG + 1):
        t = j / SEG
        for i in range(NU + 1):
            x = -HW + 2 * HW * i / NU
            z = Z_MID + sdir * run * t
            y = roof_surface(x, z)
            n = C._surface_normal(roof_surface, x, z)
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
    # wing-tip rings close both gable ends under the outer edge (两山收口)
    for i_col, hint in ((0, (-1, 0, 0)), (NU, (1, 0, 0))):
        for j in range(SEG):
            aa = j * (NU + 1) + i_col
            a2 = (j + 1) * (NU + 1) + i_col
            C.quad_out(L, 'roof-wing-ring',
                       [grid_t[aa], grid_t[a2], grid_b[a2], grid_b[aa]], 'roof',
                       [(j / SEG * run / 1.44, 0), ((j + 1) / SEG * run / 1.44, 0),
                        ((j + 1) / SEG * run / 1.44, .12), (j / SEG * run / 1.44, .12)], hint)
    L.mesh('yimen-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
    # eave fascia on the outer row
    hint = (0, 0, 1) if sdir > 0 else (0, 0, -1)
    for i in range(NU):
        aa = SEG * (NU + 1) + i
        C.quad_out(L, 'roof-eave-fascia',
                   [grid_t[aa], grid_t[aa + 1], grid_b[aa + 1], grid_b[aa]], 'dark',
                   [(grid_t[aa][0] / 1.44, 0), (grid_t[aa + 1][0] / 1.44, 0),
                    (grid_t[aa + 1][0] / 1.44, .14), (grid_t[aa][0] / 1.44, .14)], hint)
# eave soffit boards under the front/rear overhangs
L.box('front-eave-soffit', (0, rf['eaveY'] - .1, .38), (2 * HW - .1, .09, .8), 'dark', 0)
L.box('rear-eave-soffit', (0, rf['eaveY'] - .1, -5.58), (2 * HW - .1, .09, .8), 'dark', 0)
print(f'STAGE roof_shell ok ({time.time() - T0:.1f}s)')

# tile ribs on both slopes (court sees the rear too)
_rib_objs = []
spacing = rf['tileRibs']['spacingChosenM']
radius = rf['tileRibs']['radiusChosenM']
for slope_dir, z_end in ((1, ZF), (-1, ZR)):
    run = z_end - Z_MID
    x = -HW + spacing / 2
    while x <= HW - spacing / 2 + 1e-9:
        _rib_objs.append(C.rib_tube(L, 'yimen-tile-rib', roof_surface, x, .1, 1.0,
                                    Z_MID, run, radius, rf['tileRibs']['stripSections']))
        x += spacing
_rib_tris = 0
for _o in _rib_objs:
    _o.data.calc_loop_triangles()
    _rib_tris += len(_o.data.loop_triangles)
if _rib_tris > rf['tileRibs']['budgetExtraTrisMax']:
    print('RIB_BUDGET_FAIL', _rib_tris)
    sys.exit(7)
print(f'STAGE tile_ribs ok ({_rib_tris} tris)')

# ridge frieze: 0.42m decorative band, 9 framed panels, cap roll, end blocks
fz = cfg['ridgeFrieze']
f_h = fz['heightM']
L.box('frieze-base', (0, rf['ridgeY'] + .02, Z_MID), (rf['ridgeLengthM'] + .24, .12, .5), 'roof', .01)
L.GROUP = 'yimen-body'
inner_w = rf['ridgeLengthM'] - 2 * .18
pitch = inner_w / fz['panels']
panel_w = pitch - fz['panelGapM']
for k in range(fz['panels']):
    pcx = -inner_w / 2 + pitch * (k + .5)
    # framed panel front + rear faces with alternating relief motif
    for zh, hint in ((Z_MID + .19, (0, 0, 1)), (Z_MID - .19, (0, 0, -1))):
        L.box('frieze-panel-frame', (pcx, rf['ridgeY'] + f_h / 2, zh),
              (panel_w, f_h - .08, .07), 'wood', .008)
        C.quad_out(L, 'frieze-panel-face',
                   [(pcx - panel_w / 2 + .06, rf['ridgeY'] + .06, zh + .012 * (1 if hint[2] > 0 else -1)),
                    (pcx + panel_w / 2 - .06, rf['ridgeY'] + .06, zh + .012 * (1 if hint[2] > 0 else -1)),
                    (pcx + panel_w / 2 - .06, rf['ridgeY'] + f_h - .06, zh + .012 * (1 if hint[2] > 0 else -1)),
                    (pcx - panel_w / 2 + .06, rf['ridgeY'] + f_h - .06, zh + .012 * (1 if hint[2] > 0 else -1))],
                   'relief', [(0, 0), (1, 0), (1, 1), (0, 1)], hint)
        if k % 2 == 0:  # alternating motif: diamond strip on even panels
            L.box('frieze-diamond', (pcx, rf['ridgeY'] + f_h / 2, zh + .01 * (1 if hint[2] > 0 else -1)),
                  (panel_w * .34, panel_w * .34, .04), 'stone', .006, False)
L.cyl('frieze-cap-roll', (-rf['ridgeLengthM'] / 2, rf['ridgeY'] + f_h + .04, Z_MID),
      (rf['ridgeLengthM'] / 2, rf['ridgeY'] + f_h + .04, Z_MID), fz['capRollRadiusM'], 'roof', 10)
for sgn in (-1, 1):
    L.box('frieze-end-block', (sgn * (rf['ridgeLengthM'] / 2 + .1), rf['ridgeY'] + .21, Z_MID),
          tuple(fz['endBlockM']), 'roof', .012)
print(f'STAGE frieze ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S4. side walls + rear wall (simplified design inference on the rear)

sw_x = bd['sideWallX'] - bd['sideWallThicknessM'] / 2   # outer face plane 7.05
sw_out_x = bd['sideWallX']
for sgn in (-1, 1):
    x_in, x_out = sgn * (sw_x - bd['sideWallThicknessM']), sgn * sw_x
    # lower box then strips up to the shell soffit (N1-correct hints, no
    # coplanar overlap, staircase closed at both ends)
    low_top = fb['yRange'][1] + .1
    L.box('side-wall-lower', (sgn * (sw_x - bd['sideWallThicknessM'] / 2), low_top / 2,
          -bd['depthM'] / 2),
          (bd['sideWallThicknessM'], low_top, bd['depthM']), 'plaster', 0, True)
    strips = []
    for k in range(math.ceil(bd['depthM'] / 0.35 - 1e-9)):
        z1 = -0.35 * k
        z2 = max(-bd['depthM'], z1 - 0.35)
        ya = roof_y(sw_x - bd['sideWallThicknessM'] / 2, z1) - THICK - .02
        yb = roof_y(sw_x - bd['sideWallThicknessM'] / 2, z2) - THICK - .02
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
    for zend, hint in ((0.0, (0, 0, 1)), (-bd['depthM'], (0, 0, -1))):
        yt = max(s[3] for s in strips)
        yb0 = min(low_top - .02, min(s[2] for s in strips))
        C.quad_out(L, 'side-wall-upper-end', [(x_in, yb0, zend), (x_out, yb0, zend),
                                              (x_out, yt, zend), (x_in, yt, zend)],
                   'plaster', [(x_in / 2.5, yb0 / 2.5), (x_out / 2.5, yb0 / 2.5),
                               (x_out / 2.5, yt / 2.5), (x_in / 2.5, yt / 2.5)], hint)
    L.box('side-wall-brick-base', (sgn * (sw_x - bd['sideWallThicknessM'] / 2), .4, -bd['depthM'] / 2),
          (bd['sideWallThicknessM'] + .06, .8, bd['depthM'] - .1), 'brick', 0)

# rear wall: plaster with the through-opening kept clear; dark frame posts
rz = bd['rearWallZ']
rh_in = dw['widthM'] / 2 + .12
for sgn in (-1, 1):
    L.box('rear-wall-side', (sgn * (rh_in + sw_x) / 2, fb['yRange'][1] / 2 + .45, rz),
          (sw_x - rh_in, fb['yRange'][1] + .9, bd['rearWallThicknessM']), 'plaster', 0, True)
L.box('rear-wall-header', (0, (dw['heightM'] + fb['yRange'][1] + .9) / 2, rz),
      (2 * rh_in, fb['yRange'][1] + .9 - dw['heightM'], bd['rearWallThicknessM']), 'plaster', 0, True)
L.box('rear-beam', (0, fb['yRange'][1] + .98, rz), (2 * sw_x - .3, .2, .34), 'wood', .01)
for sx in cols_cfg['frontX']:
    L.box('rear-frame-post', (sx, dw['heightM'] / 2 + .3, rz - .06),
          (.22, dw['heightM'] + .6, .22), 'dark', .008)
print(f'STAGE walls ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S5. side plaques (N3): backing + stepped four-side frames + recessed face
# with the atlas UVs (top half = left plaque, bottom half = right plaque)

L.GROUP = 'yimen-plaque'
sp = cfg['sidePlaques']
pw, ph = sp['sizeWH']
z_face = 0.055
for idx, (cx, half) in enumerate(zip(sp['centersX'], ('top', 'bottom'))):
    cy = sp['centerY']
    L.box('plaque-backing-plate', (cx, cy, .028), (pw, ph, .05), 'dark', .012)
    # stepped frame rings (two levels), four sides each, opening never covers
    for zc, inset, mat in ((.078, .055, 'dark'), (.052, .115, 'wood')):
        hx, hy = pw / 2 - inset, ph / 2 - inset
        hx2, hy2 = pw / 2 - inset - .05, ph / 2 - inset - .045
        for nm, cc, ss in [
            (f'plaque-frame-l', (cx - (hx + hx2) / 2, cy, zc), (hx - hx2, 2 * hy, .05)),
            (f'plaque-frame-r', (cx + (hx + hx2) / 2, cy, zc), (hx - hx2, 2 * hy, .05)),
            (f'plaque-frame-b', (cx, cy - (hy + hy2) / 2, zc), (2 * hx2, hy - hy2, .05)),
            (f'plaque-frame-t', (cx, cy + (hy + hy2) / 2, zc), (2 * hx2, hy - hy2, .05)),
        ]:
            L.box(nm, cc, ss, mat, .01)
    # gold edge line on the outer frame
    for cc, ss in [
        ((cx - pw / 2 + .03, cy, z_face + .026), (.035, ph - .07, .012)),
        ((cx + pw / 2 - .03, cy, z_face + .026), (.035, ph - .07, .012)),
        ((cx, cy + ph / 2 - .022, z_face + .026), (pw - .14, .032, .012)),
        ((cx, cy - ph / 2 + .022, z_face + .026), (pw - .14, .032, .012)),
    ]:
        L.box('plaque-gold-edge', cc, ss, 'gold', 0)
    # recessed text face: exact 0..1 quad into its atlas half
    fw = pw - 2 * .17
    fh = ph - 2 * .1
    v0, v1 = (0.5, 1.0) if half == 'top' else (0.0, 0.5)
    C.quad_out(L, 'plaque-face',
               [(cx - fw / 2, cy - fh / 2, z_face), (cx + fw / 2, cy - fh / 2, z_face),
                (cx + fw / 2, cy + fh / 2, z_face), (cx - fw / 2, cy + fh / 2, z_face)],
               'plaque', [(0, v0), (1, v0), (1, v1), (0, v1)], (0, 0, 1))
print(f'STAGE plaques ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# collision normalization + clear-corridor assertion BEFORE any export

adapter_coll = []
for rec in L.COLL:
    cx, cy, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'yimen-body'),
                         'type': 'box',
                         'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cy, cz], 'size': [sx, sy, sz]}})

CORRIDOR = {'x': dw['widthM'] / 2 - 0.05, 'y0': 0.25, 'y1': dw['heightM'] - 0.25,
            'z0': dw['localZRange'][1] + 0.05, 'z1': -0.05}
clashes = []
for rec in adapter_coll:
    if rec['max'][0] <= -CORRIDOR['x'] or rec['min'][0] >= CORRIDOR['x']:
        continue
    if rec['max'][1] <= CORRIDOR['y0'] or rec['min'][1] >= CORRIDOR['y1']:
        continue
    if rec['max'][2] <= CORRIDOR['z0'] or rec['min'][2] >= CORRIDOR['z1']:
        continue
    clashes.append(rec['name'])
if clashes:
    print('CORRIDOR_BLOCKED', clashes)
    sys.exit(3)
print(f'CORRIDOR_CLEAR through {len(adapter_coll)} colliders ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# finalize: join by (group, material), export, reimport check, sidecars

TARGETS = [('yimen.glb', ('yimen-body', 'yimen-plaque'))]
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

yT = measure['targets']['yimen.glb']
if yT['triangles'] > BUD['yimenTrisMax']:
    print('BUDGET_FAIL yimenTris', yT['triangles'])
    sys.exit(5)
if yT['fileBytes'] > BUD['yimenGlbBytesMax']:
    print('BUDGET_FAIL yimenGlbBytes', yT['fileBytes'])
    sys.exit(5)

# reimport: materials/images/bounds must survive the round trip
original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / 'yimen.glb'))
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

plq_ok = any(m['name'].startswith('yimen-plaque') and m['imageNodes']
             and max(m['imageNodes'][0]['size']) >= 512
             for m in observed)
if not plq_ok:
    print('TEXTURE_CONNECTION_FAIL', observed)
    sys.exit(6)

# sidecars
(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; LOCAL frame (facade +Z at z=0); world placement (0,0,-21) yaw 0',
    'worldPlacement': {'originGlbWorld': cfg['placement']['originGlbWorld'],
                       'yawRad': cfg['placement']['yawRad']},
    'adapterFormat': 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
    'clearCorridor': CORRIDOR,
    'corridorVerifiedEmpty': True,
    'colliders': adapter_coll,
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {
    'yimenTris': {'actual': yT['triangles'], 'limit': BUD['yimenTrisMax'], 'pass': True},
    'yimenGlbBytes': {'actual': yT['fileBytes'], 'limit': BUD['yimenGlbBytesMax'], 'pass': True},
    'tileRibsTris': {'actual': _rib_tris, 'limit': rf['tileRibs']['budgetExtraTrisMax'], 'pass': True},
    'newImages': {'actual': 1, 'limit': BUD['newImagesMax'], 'pass': True,
                  'note': 'yimen-plaques.png; relief normal shared with shanmen'},
}
measure['design'] = {
    'family': cfg['family'],
    'reference': cfg['reference'],
    'clearDoorwayM': [dw['widthM'], dw['heightM']],
    'ridge': {'y': rf['ridgeY'], 'lengthM': rf['ridgeLengthM'], 'z': rf['ridgeLocalZ']},
    'roofMethod': ('ONE continuous profile-lofted shell both directions, ridge flat '
                   '10.4m, corner lift 0.28 confined to |x|>6.2 and outer 35% depth, '
                   'closed soffit, wing-tip rings close both gables, finite half-round '
                   'tile ribs on both slopes'),
    'plaques': {'left': sp['left']['readRightToLeft'], 'right': sp['right']['readRightToLeft'],
                'atlas': 'yimen-plaques.png (top=left, bottom=right)'},
    'rear': 'simplified design inference — no rear calligraphy',
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')

# verification dataset: the surface equation sampled on the exact shell grid
grid = {'source': 'kit/build_yimen.py roof_y (continuous single-shell equation, monotone by construction)',
        'equation': rf['surfaceEquation'],
        'ridgeY': rf['ridgeY'], 'eaveY': rf['eaveY'], 'cornerLiftM': rf['cornerLiftM'],
        'gridX': [-HW + 2 * HW * i / NU for i in range(NU + 1)],
        'front': [], 'rear': []}
for j in range(SEG + 1):
    t = j / SEG
    zf = Z_MID + (ZF - Z_MID) * t
    zr = Z_MID + (ZR - Z_MID) * t
    grid['front'].append({'t': t, 'z': zf, 'y': [round(roof_y(x, zf), 6) for x in grid['gridX']]})
    grid['rear'].append({'t': t, 'z': zr, 'y': [round(roof_y(x, zr), 6) for x in grid['gridX']]})
(out / 'roof-surface-samples.json').write_text(json.dumps(grid, ensure_ascii=False, indent=2) + '\n',
                                               encoding='utf-8')

print(f"YIMEN_READY tris={yT['triangles']} bytes={yT['fileBytes']} ribs={_rib_tris} "
      f"total={time.time() - T0:.1f}s")
