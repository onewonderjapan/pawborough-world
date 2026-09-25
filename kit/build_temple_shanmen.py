"""Chenghuangmiao shanmen (mountain gate) + short forecourt pilot builder.

One process builds the whole standalone sample set from the strict config:
  temple.glb   gatehouse + wings + plaque (body & ornament groups separated)
  ground.glb   forecourt + central passage paving (visible ground == physics ground)
  lions.glb    two limited-mesh stone lion candidates
  ornaments.glb ridge-end fish-dragon candidates (coarse silhouettes)

Geometry order follows TASK.md: central opening / columns / plaque first, then
curved roofs + shoulders, then wings + forecourt. All collision boxes come from
the same geometry parameters; the clear corridor (x +/-1.45, y 0.25-2.85,
z -3.55..-0.05) is asserted EMPTY of colliders before export.

Run:
  blender -b --factory-startup -t 4 -P kit/build_temple_shanmen.py -- \
      --config kit/temple-shanmen.config.json --out kit/out/temple-shanmen
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
# D1 (2026-09-19 corridor batch) strict opt-in keys: DEFAULT v1 must rerun
# geometrically equivalent to the delivered world/temple-shanmen GLBs.
p.add_argument('--lionsVersion', type=str, default='v1', choices=['v1', 'v2'])
p.add_argument('--windowsVersion', type=str, default='v1', choices=['v1', 'v2'])
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
T0 = time.time()

# ---------------------------------------------------------------------------
# strict schema: unknown keys are hard errors (same rule as the east-shop kit)

SCHEMA = {
    'sampleId': None, 'family': None, 'units': None, 'axis': None, 'basedOn': None,
    'reference': {'imageId': None, 'referenceEra': None, 'historicalAccuracyVerified': None,
                  'dimensionsAreDesign': None},
    'frame': {'depthM': None, 'clearOpeningM': None, 'stoneColumnX': None, 'stoneColumnSize': None,
              'stoneColumnZ': None, 'plinthSize': None, 'plinthOffsetOutM': None,
              'timberColumnX': None, 'timberColumnRadius': None, 'timberColumnTop': None,
              'timberColumnZ': None, 'rearFrameZ': None, 'rearColumnZ': None,
              'bodyHalfWidthX': None, 'sideWallThicknessM': None, 'lintelBandY': None,
              'topPlateBeamY': None, 'revealWallX': None, 'revealWallTopY': None},
    'opening': {'clearWidthM': None, 'clearHeightM': None, 'throughZ': None,
                'doorLeaves': {'state': None, 'leafWidthM': None, 'leafHeightM': None,
                               'leafThicknessM': None, 'standoffZ': None, 'solidCollision': None,
                               'note': None}},
    'plaque': {'widthM': None, 'bottomY': None, 'topY': None, 'centerX': None,
               'construction': None,
               'steps': None, 'faceTexture': None, 'literalLeftToRight': None,
               'readingRightToLeft': None,
               'sideFloralBoards': {'widthM': None, 'heightM': None, 'centersX': None, 'centerY': None}},
    'bracketBand': {'yRange': None, 'backingWallThicknessM': None, 'groups': None,
                    'groupX': None, 'goldAccents': None},
    'roof': {
        'center': {'widthM': None, 'ridgeY': None, 'ridgeLengthM': None, 'ridgeZ': None,
                   'frontEaveZ': None, 'frontEaveY': None, 'rearEaveZ': None, 'rearEaveY': None,
                   'halfSlopeProfileTY': None, 'cornerLiftM': None, 'cornerLiftStartX': None,
                   'hipEndTopY': None, 'shellThicknessM': None, 'resampleSegments': None,
                   'hipBeyondRidgeEnd': None},
        'shoulders': {'xSpans': None, 'frontOutlineAbsXY': None, 'ridgeY': None, 'ridgeZ': None,
                      'frontEaveZ': None, 'rearEaveZ': None, 'rearEaveDropFromFront': None,
                      'eaveBaselineY': None,
                      'shellThicknessM': None, 'resampleSegments': None, 'innerSeamOverlapM': None,
                      'tileRibs': {'method': None, 'spacingM': None, 'spacingChosenM': None,
                                   'radiusM': None, 'radiusChosenM': None, 'stripSections': None,
                                   'budgetExtraTrisMax': None},
                      'notes': None},
        'sideBayCanopies': {'xSpans': None, 'baseY': None, 'maxLiftY': None, 'frontZ': None},
        'ornaments': {'centerPair': {'maxHeightM': None, 'x': None, 'baseY': None, 'z': None},
                      'shoulderPair': {'maxHeightM': None, 'x': None, 'baseY': None, 'z': None},
                      'minThinFeatureM': None, 'status': None},
    },
    'wings': {'leftStart': None, 'leftEnd': None, 'rightStart': None, 'rightEnd': None,
              'heightM': None, 'thicknessM': None, 'tileCapMaxY': None, 'panelWH': None,
              'panelCenterAlongWallFrac': None, 'reliefDepthM': None, 'panelMotif': None,
              'reliefNormalTexture': None, 'stoneFrameBands': None},
    'forecourt': {'widthM': None, 'depthM': None, 'zRange': None, 'y': None, 'passageWidthM': None,
                  'passageZRange': None, 'slabThicknessM': None, 'stoneBorderWidthM': None,
                  'noInvisibleWorldPlane': None},
    'lions': {'optionalSeparateCandidate': None, 'centers': None, 'boundsM': None,
              'trisEachMax': None, 'noAnimation': None, 'faceTowards': None},
    'budgets': {'buildingAndWallsTrisMax': None, 'fullSetTrisMax': None, 'mainGlbBytesMax': None,
                'groundGlbBytesMax': None, 'newImagesMax': None, 'newImageEdgePxMax': None},
    'runtime': {'devPort': None, 'previewPort': None, 'isStandalonePilot': None,
                'mustNotModifyMainWorld': None},
    'review': {'ownerAdopted': None, 'visualReviewer': None},
    'uncertaintyPolicy': None,
}


def check_keys(obj, spec, path):
    problems = []
    if not isinstance(obj, dict):
        return [f'{path}: expected object']
    extra = sorted(set(obj) - set(spec))
    missing = sorted(set(spec) - set(obj))
    if extra:
        problems.append(f'{path}: unknown keys {extra} (no silent ignoring)')
    if missing:
        problems.append(f'{path}: missing keys {missing}')
    for k, sub in spec.items():
        if sub and k in obj:
            problems += check_keys(obj[k], sub, f'{path}.{k}')
    return problems


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(26)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise ValueError(f'{path}: not a PNG with a leading IHDR')
    w, h = struct.unpack('>II', head[16:24])
    return int(w), int(h)


def validate(c):
    pr = check_keys(c, SCHEMA, 'config')
    fr, op, rc, rs, w = c['frame'], c['opening'], c['roof']['center'], c['roof']['shoulders'], c['wings']
    pl = c['plaque']

    if c['units'] != 'meters':
        pr.append('units must be meters')
    if 'Y-up' not in c['axis'] or '+Z' not in c['axis']:
        pr.append('axis must state GLB Y-up and facade +Z')

    # TASK: 开口净宽3m、净高3.1m —— cross-checked from THREE independent fields
    if fr['clearOpeningM'] != [3.0, 3.1]:
        pr.append(f"frame.clearOpeningM must be [3.0, 3.1], got {fr['clearOpeningM']}")
    col_clear = fr['stoneColumnX'][1] - fr['stoneColumnX'][0] - fr['stoneColumnSize'][0]
    if abs(col_clear - op['clearWidthM']) > 1e-6 or abs(col_clear - 3.0) > 1e-6:
        pr.append(f'stone columns must leave exactly 3.0m clear, got {col_clear}')
    if abs(fr['lintelBandY'][0] - op['clearHeightM']) > 1e-6 or abs(op['clearHeightM'] - 3.1) > 1e-6:
        pr.append(f"clear height must be 3.1 with the lintel band starting there, got {fr['lintelBandY'][0]}")
    if op['throughZ'] != [0.0, -c['frame']['depthM']]:
        pr.append('opening must run through the full frame depth z=0..-depthM')

    # plinths must stay OUT of the clear width at floor level
    pin = min(abs(x) for x in fr['stoneColumnX']) - fr.get('plinthOffsetOutM', 0) + fr['plinthSize'][0] / 2
    if pin < op['clearWidthM'] / 2 + 0.02:
        pr.append(f'plinths intrude into the clear opening (inner edge {pin:.3f})')

    # 屋脊与两翼高度：center ridge > shoulder ridge > wing cap, all above eaves
    if not (rc['ridgeY'] > rs['ridgeY'] > w['tileCapMaxY'] > w['heightM']):
        pr.append('height stack center-ridge > shoulder-ridge > wing-cap > wing-wall violated')
    if not (rc['ridgeY'] > rs['frontOutlineAbsXY'][-1][1]):
        pr.append('shoulder outer sweep tip must stay below the center ridge')
    if not (min(y for _, y in rs['frontOutlineAbsXY']) < rs['ridgeY']):
        pr.append('shoulder outline must dip below its ridge between the tips')
    if not (rc['ridgeLengthM'] < rc['widthM']):
        pr.append('center ridge must be shorter than the roof width (short-ridge reading)')
    if abs(rc['halfSlopeProfileTY'][0][1] - rc['ridgeY']) > 1e-6:
        pr.append('profile t=0 must sit at the ridge height')
    if abs(rc['halfSlopeProfileTY'][-1][1] - rc['frontEaveY']) > 1e-6:
        pr.append('profile t=1 must land at the front eave height')
    ys = [y for _, y in rc['halfSlopeProfileTY']]
    if any(y > rc['ridgeY'] + 1e-6 or y < rc['frontEaveY'] - 0.05 for y in ys):
        pr.append('profile heights escape the ridge..eave band')
    if not (4 <= len(rc['halfSlopeProfileTY']) <= 24):
        pr.append('profile needs 4..24 section samples')
    if not (10 <= rc['resampleSegments'] <= 16) or not (10 <= rs['resampleSegments'] <= 16):
        pr.append('DESIGN.md requires 10-16 resample segments per half slope')

    # shoulder outline must cover the spans (given in ABS x); center shell overlaps the seam
    abs_edges = sorted({abs(v) for span in rs['xSpans'] for v in span})
    if abs(rs['frontOutlineAbsXY'][0][0] - abs_edges[0]) > 1e-6 or \
            abs(rs['frontOutlineAbsXY'][-1][0] - abs_edges[-1]) > 1e-6:
        pr.append('shoulder outline x range must match the span edges')
    overlap = rc['widthM'] / 2 - abs(rs['xSpans'][1][0])
    if not (0.10 <= overlap <= 0.30):
        pr.append(f'central/shoulder shell overlap {overlap:.3f} outside 0.10-0.30 design band')

    # wings: the flared screen walls, panel must fit, cap above wall
    if w['leftEnd'][2] <= w['leftStart'][2] or abs(w['leftEnd'][0]) <= abs(w['leftStart'][0]):
        pr.append('wing walls must flare outward AND forward')
    wing_len = math.hypot(w['rightEnd'][0] - w['rightStart'][0],
                          w['rightEnd'][2] - w['rightStart'][2])
    if w['panelWH'][0] > 0.5 * wing_len or w['panelWH'][1] > w['heightM'] - 0.8:
        pr.append('wing relief panel does not fit the wall field')

    # forecourt: flush passage, no step
    fc = c['forecourt']
    if fc['passageZRange'] != [op['throughZ'][1], op['throughZ'][0]]:
        pr.append('passage z-range must mirror the opening through-range')
    if abs(fc['passageWidthM'] - op['clearWidthM']) > 1e-6 or fc['y'] != 0:
        pr.append('passage must be the clear width at y=0 (no step into the gate)')
    if fc['noInvisibleWorldPlane'] is not True:
        pr.append('forecourt must assert noInvisibleWorldPlane')

    # lions must not sit inside the corridor approach or on the passage
    for cx, _, cz in c['lions']['centers']:
        if abs(cx) < op['clearWidthM'] / 2 + 0.4 and cz < 0.5:
            pr.append(f'lion at ({cx},{cz}) blocks the approach line')

    # plaque: right-to-left reading contract + geometry inside the lintel band
    if pl['literalLeftToRight'] != '隅海障保' or pl['readingRightToLeft'] != '保障海隅':
        pr.append('plaque glyph layout must read 保障海隅 right-to-left (literal 隅海障保)')
    if not (fr['lintelBandY'][1] <= pl['bottomY'] and pl['topY'] < c['bracketBand']['yRange'][0]):
        pr.append('plaque must sit between lintel top and bracket band')
    # T1 repair contract: backing plate + stepped four-side frame rings + recessed
    # text face. No full-face occluder may sit in front of the text plane, so
    # every step in front of the last must inset enough to be a border ring.
    if pl['construction'] != 'backing-plate + stepped four-side frame rings + recessed text face':
        pr.append('plaque.construction must record the T1 repair construction')
    steps = pl['steps']
    if [s['zFront'] for s in steps] != sorted((s['zFront'] for s in steps), reverse=True):
        pr.append('plaque steps must step BACK in z (front to back descending zFront)')
    # only steps[0] may sit on the plaque outline; every later step insets far
    # enough to be a border ring, so an opening always remains over the text
    for s in steps[1:]:
        if s['insetX'] < .05 or s['insetY'] < .04:
            pr.append(f"plaque step zFront={s['zFront']} leaves no text opening (insets {s['insetX']},{s['insetY']})")
    if steps[-1]['insetX'] <= steps[-2]['insetX'] or steps[-1]['insetY'] <= steps[-2]['insetY']:
        pr.append('the text plane (last step) must be the most recessed plaque step')

    # T3 repair contract: the revision equation parameters
    tr = rs['tileRibs']
    if abs(rs['eaveBaselineY'] - min(y for _, y in rs['frontOutlineAbsXY'])) > 1e-6:
        pr.append('shoulders.eaveBaselineY must equal the lowest front-outline point (5.95)')
    if not (rs['ridgeY'] > rs['eaveBaselineY']):
        pr.append('shoulder ridge must sit above the eave baseline')
    if not (tr['spacingM'][0] <= tr['spacingChosenM'] <= tr['spacingM'][1]):
        pr.append(f"tile rib spacing {tr['spacingChosenM']} outside design band {tr['spacingM']}")
    if not (tr['radiusM'][0] <= tr['radiusChosenM'] <= tr['radiusM'][1]):
        pr.append(f"tile rib radius {tr['radiusChosenM']} outside design band {tr['radiusM']}")
    if tr['stripSections'] != 8:
        pr.append('tile ribs must use exactly 8 strip sections (DESIGN_REVISION)')
    if tr['budgetExtraTrisMax'] > 8000:
        pr.append('tile rib budget must stay within the 8000-tri DESIGN_REVISION allowance')

    # new texture budget: exactly the referenced files, <=2048px
    refs = [pl['faceTexture'], w['reliefNormalTexture']]
    for r in refs:
        path = HERE / 'textures' / Path(r).name
        if not path.exists():
            pr.append(f'referenced texture missing: {r}')
            continue
        ww, hh = png_size(path)
        if max(ww, hh) > c['budgets']['newImageEdgePxMax']:
            pr.append(f'{r} exceeds the {c["budgets"]["newImageEdgePxMax"]}px edge budget ({ww}x{hh})')
    if len(set(refs)) > c['budgets']['newImagesMax']:
        pr.append('more new images than the budget allows')

    # runtime ports must be the pilot ports, never the main world's
    if (c['runtime']['devPort'], c['runtime']['previewPort']) != (5290, 5291):
        pr.append('pilot must use ports 5290/5291 (main world 5284/5285 stays untouched)')
    if c['runtime']['mustNotModifyMainWorld'] is not True:
        pr.append('mustNotModifyMainWorld must be asserted')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# materials: the frozen street palette + exactly two new temple images

L.reset_scene()
L.build_materials()
L.M['plaque'] = L.mat('temple-plaque-lacquer', '141416', .38, base='temple-plaque.png', extend=True)
L.M['relief'] = L.mat('temple-relief-stone', '9a9a8c', .92,
                      normal='temple-relief-normal.png', tile=(1.8, 2.15))
L.META['temple-plaque-lacquer']['source'] = 'locally authored (kit/make_temple_textures.py; Noto Serif CJK Bold glyphs)'
L.META['temple-relief-stone']['source'] = 'locally authored normal map (kit/make_temple_textures.py)'

fr, op = cfg['frame'], cfg['opening']
rc, rs = cfg['roof']['center'], cfg['roof']['shoulders']
profile = rc['halfSlopeProfileTY']
BUD = cfg['budgets']

# ---------------------------------------------------------------------------
# S1. central opening, columns, lintel, reveals, open lattice door leaves

L.GROUP = 'shanmen-body'
C.door_frame(L, fr, op)
print(f'STAGE door_frame ok ({time.time() - T0:.1f}s)')

# timber columns + stone feet
for sx in fr['timberColumnX']:
    L.cyl('timber-column', (sx, 0, fr['timberColumnZ']), (sx, fr['timberColumnTop'], fr['timberColumnZ']),
          fr['timberColumnRadius'], 'wood', 12)
    L.cyl('timber-column-foot', (sx, .13, fr['timberColumnZ']), (sx, .30, fr['timberColumnZ']),
          fr['timberColumnRadius'] + .045, 'stone', 12)
    L.cyl('timber-column-foot', (sx, .315, fr['timberColumnZ']), (sx, .36, fr['timberColumnZ']),
          fr['timberColumnRadius'] + .02, 'wood', 12)
    L.COLL.append({'name': 'timber-column', 'group': 'shanmen-body', 'type': 'box',
                   'center': [sx, fr['timberColumnTop'] / 2, fr['timberColumnZ']],
                   'size': [fr['timberColumnRadius'] * 2, fr['timberColumnTop'], fr['timberColumnRadius'] * 2]})
# top plate beams over both column rows
for zc in (fr['stoneColumnZ'], fr['rearColumnZ']):
    L.box('top-plate-beam', (0, (fr['topPlateBeamY'][0] + fr['topPlateBeamY'][1]) / 2, zc),
          (2 * fr['bodyHalfWidthX'] - .1, fr['topPlateBeamY'][1] - fr['topPlateBeamY'][0], .3), 'wood', .01)

# side bay grilles between stone and timber columns (closed, solid collision)
for sgn in (-1, 1):
    x_in = sgn * (abs(fr['stoneColumnX'][0]) + fr['stoneColumnSize'][0] / 2)
    x_out = sgn * (abs(fr['timberColumnX'][0]) - fr['timberColumnRadius'] - .02)
    xc = (x_in + x_out) / 2
    wbay = abs(x_out - x_in)
    L.box('grille-backing', (xc, 2.45, -0.16), (wbay, 4.9, .12), 'dark', 0, True)
    L.box('grille-lower-panel', (xc, .78, -0.085), (wbay - .05, 1.56, .09), 'wood', .006)
    for k in range(7):
        L.box('grille-bar', (x_in + sgn * wbay * (k + .5) / 7, 3.25, -0.075),
              (.045, 3.25, .05), 'wood', 0)
    for k, yy in enumerate((1.62, 2.32, 3.02, 3.72, 4.42)):
        L.box('grille-rail', (xc, yy, -0.07), (wbay - .04, .055, .045), 'wood', 0)
    for xx in (x_in + sgn * .035, x_out - sgn * .035):
        L.box('grille-stile', (xx, 2.45, -0.075), (.07, 4.9, .08), 'wood', .005)
    L.box('grille-top-rail', (xc, 4.78, -0.075), (wbay, .09, .08), 'wood', .005)
print(f'STAGE columns_grilles ok ({time.time() - T0:.1f}s)')

# gatehouse side walls: lower plain box + upper strip tucked under shoulder shells
# N1 entry-batch revision: the upper strips' quad hints were swapped (the OUTER
# plane exported backfacing, so the 3/4 view saw a recessed inner plane and the
# dark eave cavity behind it), and the strips spanned y=0..yhi coplanar with the
# lower box (z-fighting). Now: hints face outward/inward correctly, strips start
# 0.02 INSIDE the box (hidden seam, no coplanar overlap), the front/rear edges
# of the strip band get closing quads, and the shoulder overhang band is closed
# by C.gable_closures (front dark end panels, rear plaster panels, outer gable
# wall with a timber frame) so no black cavity is visible from any 3/4 view.
sw_in = fr['bodyHalfWidthX'] - .16            # inner face plane
sw_out = sw_in + fr['sideWallThicknessM']     # outer face plane
sw_low_top = 5.5
for sgn in (-1, 1):
    L.box('side-wall-lower', (sgn * (sw_in + sw_out) / 2, sw_low_top / 2, -fr['depthM'] / 2),
          (fr['sideWallThicknessM'], sw_low_top, fr['depthM']), 'plaster', 0, True)
    # fixed strip count (a while-loop with a max() clamp can stall at the boundary)
    # wave5-templeqa: strip tops follow the shoulder soffit EXACTLY at both strip ends (sloped top quad),
    # sampled at the lower of the inner / outer wall faces. The old strips were flat-topped at the higher
    # end and their trapezoids always put the high end at z2, so every step stood up to 0.16 m out of the
    # shoulder tiles — the row of white blocks on both shoulder roofs.
    x_in, x_out = sgn * sw_in, sgn * sw_out

    def soffit_at(z):
        return min(C.shoulder_surface_y(rs, profile, sw_in, z), C.shoulder_surface_y(rs, profile, sw_out, z)) \
            - rs['shellThicknessM'] - .03
    strips = []
    for k in range(math.ceil(fr['depthM'] / 0.3 - 1e-9)):
        z1 = -0.3 * k
        z2 = max(-fr['depthM'], z1 - 0.3)
        strips.append((z1, z2, soffit_at(z1), soffit_at(z2)))
    for z1, z2, ya, yb in strips:
        # start 0.02 inside the lower box: the seam is hidden geometry, the
        # visible surfaces are never coplanar with the box faces
        y0 = min(sw_low_top - .02, ya, yb)
        # inner face (normal toward the passage center), outer face (normal
        # away from it) — the hint sign is the FACE's own outward direction
        C.quad_out(L, 'side-wall-upper-inner', [(x_in, y0, z1), (x_in, y0, z2), (x_in, yb, z2), (x_in, ya, z1)],
                   'plaster', [(z1 / 2.5, y0 / 2.5), (z2 / 2.5, y0 / 2.5),
                               (z2 / 2.5, yb / 2.5), (z1 / 2.5, ya / 2.5)], (-sgn, 0, 0))
        C.quad_out(L, 'side-wall-upper-outer', [(x_out, y0, z1), (x_out, y0, z2), (x_out, yb, z2), (x_out, ya, z1)],
                   'plaster', [(z1 / 2.5, y0 / 2.5), (z2 / 2.5, y0 / 2.5),
                               (z2 / 2.5, yb / 2.5), (z1 / 2.5, ya / 2.5)], (sgn, 0, 0))
        C.quad_out(L, 'side-wall-upper-top', [(x_in, ya, z1), (x_in, yb, z2), (x_out, yb, z2), (x_out, ya, z1)],
                   'plaster', [(z1 / 2.5, 0), (z2 / 2.5, 0), (z2 / 2.5, .13), (z1 / 2.5, .13)], (0, 1, 0))
    # band end closures at the facade and rear planes (the staircase used to be
    # open at z=0 and z=-depth, leaving a see-through slot at each corner)
    for zend, hint in ((0.0, (0, 0, 1)), (-fr['depthM'], (0, 0, -1))):
        yt = soffit_at(zend)          # wave5-templeqa: the band end closes at its own soffit height
        yb0 = min(sw_low_top - .02, min(min(s[2], s[3]) for s in strips))
        C.quad_out(L, 'side-wall-upper-end', [(x_in, yb0, zend), (x_out, yb0, zend),
                                              (x_out, yt, zend), (x_in, yt, zend)],
                   'plaster', [(x_in / 2.5, yb0 / 2.5), (x_out / 2.5, yb0 / 2.5),
                               (x_out / 2.5, yt / 2.5), (x_in / 2.5, yt / 2.5)], hint)
    L.box('side-corner-post', (sgn * (fr['bodyHalfWidthX'] - .1), 2.45, -0.1),
          (.22, 4.9, .22), 'dark', .008)
    L.box('side-brick-base', (sgn * (sw_in + sw_out) / 2, .4, -fr['depthM'] / 2),
          (fr['sideWallThicknessM'] + .06, .8, fr['depthM'] - .1), 'brick', 0)

# rear wall: plain closed frame + gray wall, real opening kept clear
rear_z = -fr['depthM'] + .14
rear_half_in = op['clearWidthM'] / 2 + .12
rear_half_out = sw_out
for sgn in (-1, 1):
    # wave5-templeqa: from |x| 2.05 (shoulder xSpans inner edge) outward the rear wall sits under the shoulder
    # shell, whose rear slope at the wall faces is below 5.9 + shell; the wall corners stood 0.11 m out of the
    # shoulder tiles. The side piece now stops under the lowest shoulder soffit over its shoulder part
    # (same sampling as the side-wall strips); the header under the centre roof keeps 5.9.
    _xs0 = abs(rs['xSpans'][1][0])
    _rt = min(5.9, *(C.shoulder_surface_y(rs, profile, _xs0 + (rear_half_out - _xs0) * k / 12, zz)
                     - rs['shellThicknessM'] - .03 for k in range(13) for zz in (rear_z + .14, rear_z - .14)))
    L.box('rear-wall-side', (sgn * (rear_half_in + rear_half_out) / 2, _rt / 2, rear_z),
          (rear_half_out - rear_half_in, _rt, .28), 'plaster', 0, True)
L.box('rear-wall-header', (0, (3.1 + 5.9) / 2, rear_z), (2 * rear_half_in, 5.9 - 3.1, .28),
      'plaster', 0, True)
L.box('rear-beam', (0, 4.98, rear_z + .05), (2 * sw_out - .3, .2, .34), 'wood', .01)
for sx in (-1.72, 1.72, -3.05, 3.05):
    L.box('rear-frame-post', (sx, 2.45, rear_z + .1), (.2, 4.9, .2), 'dark', .008)
print(f'STAGE walls ok ({time.time() - T0:.1f}s)', flush=True)

# ---------------------------------------------------------------------------
# S2. curved roofs: center hip shell + two shoulder shells + under-eave soffits
# T3: shoulder shells follow the DESIGN_REVISION equation; rib tubes are added
# on the visible front slopes and their triangles are budgeted separately.

C.center_roof(L, rc, profile)
_center_srf = C.center_surface_fn(rc, profile)
C.shoulder_roof(L, rs, 1, profile, _center_srf)
C.shoulder_roof(L, rs, -1, profile, _center_srf)
_rib_objs = C.add_roof_ribs(L, cfg['roof'], profile)
_rib_tris = 0
for _o in _rib_objs:
    _o.data.calc_loop_triangles()
    _rib_tris += len(_o.data.loop_triangles)
if _rib_tris > rs['tileRibs']['budgetExtraTrisMax']:
    print('RIB_BUDGET_FAIL', _rib_tris, '>', rs['tileRibs']['budgetExtraTrisMax'])
    sys.exit(7)
print(f'STAGE roofs ok (tile ribs {_rib_tris} tris <= {rs["tileRibs"]["budgetExtraTrisMax"]})')

# T3 equation self-check against the revision constraints (analytic, no mesh):
# ridge constant, front silhouette == outline at the knots, no lift before
# the eave half, rear eave keeps the 0.18m drop.
_sh_srf = C.shoulder_surface_fn(rs, profile)
for kx, ky in rs['frontOutlineAbsXY']:
    if abs(_sh_srf(kx, rs['frontEaveZ']) - ky) > 1e-9:
        pr = (f'T3 silhouette: y({kx}, front eave)={_sh_srf(kx, rs["frontEaveZ"]):.6f} != outline {ky}')
        print('T3_EQUATION_FAIL', pr)
        sys.exit(8)
for kx, _ in rs['frontOutlineAbsXY']:
    if abs(_sh_srf(kx, rs['ridgeZ']) - rs['ridgeY']) > 1e-9:
        print('T3_EQUATION_FAIL ridge not constant at', kx)
        sys.exit(8)
_tq_z = rs['ridgeZ'] + 0.25 * (rs['frontEaveZ'] - rs['ridgeZ'])
_flat = [_sh_srf(kx, _tq_z) for kx, _ in rs['frontOutlineAbsXY']]
if max(_flat) - min(_flat) > 1e-9:
    print('T3_EQUATION_FAIL outline lift leaked to quarter depth (vertical curtain)')
    sys.exit(8)
for kx, ky in rs['frontOutlineAbsXY']:
    _rear = _sh_srf(kx, rs['rearEaveZ'])
    if abs(_rear - (ky - rs['rearEaveDropFromFront'])) > 1e-9:
        print('T3_EQUATION_FAIL rear eave drop changed at', kx)
        sys.exit(8)
print('T3 equation checks ok (ridge const / silhouette / no mid-depth lift / rear drop)')
L.box('front-eave-soffit', (0, 6.36, .32), (2 * fr['bodyHalfWidthX'], .09, .72), 'dark', 0)
L.box('rear-eave-soffit', (0, 6.30, -3.9), (2 * fr['bodyHalfWidthX'], .09, .5), 'dark', 0)
# N1: close the shoulder overhang bands (front dark end panels + rear plaster
# panels + outer gable walls with timber frames) and dress the center/shoulder
# seam with a sloped flashing; the shells and T1-T3 constraints are untouched
for sgn in (-1, 1):
    C.gable_closures(L, rs, sgn, profile, sw_out, cfg['wings']['tileCapMaxY'])
    C.seam_trim(L, rs, rc, sgn, profile)
print(f'STAGE gable_closures+seam_trim ok ({time.time() - T0:.1f}s)')
print(f'STAGE roofs ok ({time.time() - T0:.1f}s)')

# side-bay tile canopies (small curved shells under the bracket band)
sbc = cfg['roof']['sideBayCanopies']
for sgn in (-1, 1):
    x0, x1 = sbc['xSpans'][1 if sgn > 0 else 0]
    nu, nseg = 6, 4
    grid_t, grid_b, uvs = [], [], []
    for j in range(nseg + 1):
        t = j / nseg
        for i in range(nu + 1):
            u = i / nu
            x = x0 + (x1 - x0) * u
            edge = abs(x - (x0 + x1) / 2) / ((x1 - x0) / 2)
            y = sbc['maxLiftY'] - (sbc['maxLiftY'] - sbc['baseY']) * t ** 1.6 \
                + .05 * edge ** 3 * (1 - t)
            z = -0.05 + (sbc['frontZ'] + .05) * t
            grid_t.append((x, y, z))
            grid_b.append((x, y - .06, z))
            uvs.append((x / 1.44, t * (sbc['frontZ'] + .05) / 1.36))
    n = len(grid_t)
    faces = []
    for j in range(nseg):
        for i in range(nu):
            aa = j * (nu + 1) + i
            b2, c2, d2 = aa + 1, aa + nu + 2, aa + nu + 1
            faces.append((aa, d2, c2, b2))
            faces.append((n + aa, n + b2, n + c2, n + d2))
    L.mesh('side-bay-canopy-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
    for i in range(nu):
        aa = nseg * (nu + 1) + i
        C.quad_out(L, 'side-bay-canopy-fascia',
                   [grid_t[aa], grid_t[aa + 1], grid_b[aa + 1], grid_b[aa]], 'dark',
                   [(grid_t[aa][0] / 1.44, 0), (grid_t[aa + 1][0] / 1.44, 0),
                    (grid_t[aa + 1][0] / 1.44, .07), (grid_t[aa][0] / 1.44, .07)], (0, 0, 1))
    for xx in (x0 + .25, x1 - .25):
        L.box('canopy-bracket', (xx, sbc['baseY'] - .28, .18), (.1, .12, .55), 'wood', .006)
print(f'STAGE canopies ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S3. bracket band (dark timber + restrained gold) and the plaque

bb = cfg['bracketBand']
L.GROUP = 'shanmen-body'
L.box('bracket-backing-wall', (0, (bb['yRange'][0] + bb['yRange'][1]) / 2, -.13),
      (2 * fr['bodyHalfWidthX'], bb['yRange'][1] - bb['yRange'][0], bb['backingWallThicknessM']),
      'dark', 0, True)
L.box('bracket-lower-beam', (0, bb['yRange'][0] + .12, .05), (2 * fr['bodyHalfWidthX'] - .1, .24, .3), 'wood', .01)
L.box('bracket-upper-beam', (0, bb['yRange'][1] - .12, .03), (2 * fr['bodyHalfWidthX'] - .1, .2, .26), 'wood', .01)
dense = set((-0.85, 0.85, 0.0))
for gx in bb['groupX']:
    layered = abs(gx) in dense or gx == 0.0
    L.box('corbel-haunch', (gx, bb['yRange'][0] + .21, .12), (.34, .3, .3), 'wood', .01)
    L.box('corbel-mid-block', (gx, bb['yRange'][0] + .48, .2), (.26, .24, .24), 'wood', .008)
    L.box('corbel-arm', (gx, bb['yRange'][0] + .68, .33), (.3, .13, .56), 'wood', .008)
    L.box('corbel-gold-strip', (gx, bb['yRange'][0] + .59, .32), (.315, .045, .52), 'gold', 0)
    L.box('corbel-top-cap', (gx, bb['yRange'][0] + .82, .22), (.36, .11, .42), 'wood', .008)
    if layered:
        L.box('corbel-upper-arm', (gx, bb['yRange'][0] + .99, .3), (.24, .12, .5), 'wood', .006)
        L.box('corbel-upper-gold', (gx, bb['yRange'][0] + 1.06, .3), (.25, .04, .46), 'gold', 0)
print(f'STAGE brackets ok ({time.time() - T0:.1f}s)')

L.GROUP = 'shanmen-plaque'
pl = cfg['plaque']
pcy = (pl['bottomY'] + pl['topY']) / 2
phh = pl['topY'] - pl['bottomY']
hw, hh = pl['widthM'] / 2, phh / 2


def frame_ring(name, ix_o, iy_o, ix_i, iy_i, z_front, mat):
    """One stepped reveal level: a four-side BORDER RING between the outer
    (ix_o, iy_o) and inner (ix_i, iy_i) inset boundaries. The opening equals
    the next level's face, so no ring ever covers the text center."""
    hx_o, hy_o = hw - ix_o, hh - iy_o
    hx_i, hy_i = hw - ix_i, hh - iy_i
    zc = z_front - .025
    for nm, c, s in [
        (name + '-left', (pl['centerX'] - (hx_o + hx_i) / 2, pcy, zc), (hx_o - hx_i, 2 * hy_o, .05)),
        (name + '-right', (pl['centerX'] + (hx_o + hx_i) / 2, pcy, zc), (hx_o - hx_i, 2 * hy_o, .05)),
        (name + '-bottom', (pl['centerX'], pcy - (hy_o + hy_i) / 2, zc), (2 * hx_i, hy_o - hy_i, .05)),
        (name + '-top', (pl['centerX'], pcy + (hy_o + hy_i) / 2, zc), (2 * hx_i, hy_o - hy_i, .05)),
    ]:
        L.box(nm, c, s, mat, .012)


# T1 repair: one backing plate + stepped four-side frame rings + recessed text
# face. Nothing full-face exists in front of the text plane any more; the old
# three solid step boards and the full gold fillet plate are gone.
L.box('plaque-backing-plate', (pl['centerX'], pcy, .030), (pl['widthM'], phh, .050), 'dark', .012)
frame_ring('plaque-outer-rim', pl['steps'][0]['insetX'], pl['steps'][0]['insetY'],
           pl['steps'][1]['insetX'], pl['steps'][1]['insetY'], pl['steps'][0]['zFront'], 'dark')
frame_ring('plaque-mid-rim', pl['steps'][1]['insetX'], pl['steps'][1]['insetY'],
           pl['steps'][2]['insetX'], pl['steps'][2]['insetY'], pl['steps'][1]['zFront'], 'wood')
# gold fillet repaired: four thin edge strips riding the outer rim face — a
# gold BORDER LINE, not a full plate across the glyphs.
for c, s in [
    ((pl['centerX'] - hw + .035, pcy, .1585), (.04, phh - .06, .012)),
    ((pl['centerX'] + hw - .035, pcy, .1585), (.04, phh - .06, .012)),
    ((pl['centerX'], pcy + hh - .0275, .1585), (pl['widthM'] - .12, .04, .012)),
    ((pl['centerX'], pcy - hh + .0275, .1585), (pl['widthM'] - .12, .04, .012)),
]:
    L.box('plaque-gold-edge', c, s, 'gold', 0)
fw = pl['widthM'] - 2 * pl['steps'][2]['insetX']
fh = phh - 2 * pl['steps'][2]['insetY']
zf = pl['steps'][2]['zFront']
C.quad_out(L, 'plaque-face',
           [(pl['centerX'] - fw / 2, pcy - fh / 2, zf), (pl['centerX'] + fw / 2, pcy - fh / 2, zf),
            (pl['centerX'] + fw / 2, pcy + fh / 2, zf), (pl['centerX'] - fw / 2, pcy + fh / 2, zf)],
           'plaque', [(0, 0), (1, 0), (1, 1), (0, 1)], (0, 0, 1))
sb = pl['sideFloralBoards']
for sx in sb['centersX']:
    L.box('plaque-side-board', (sx, sb['centerY'], .05), (sb['widthM'], sb['heightM'], .045), 'relief', .006)
    L.box('plaque-side-gold-edge', (sx, sb['centerY'] + sb['heightM'] / 2 + .015, .05),
          (sb['widthM'] + .04, .03, .05), 'gold', 0)
    L.box('plaque-side-gold-edge', (sx, sb['centerY'] - sb['heightM'] / 2 - .015, .05),
          (sb['widthM'] + .04, .03, .05), 'gold', 0)
print(f'STAGE plaque ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S4. two flared wing walls with relief panels, then the forecourt ground

L.GROUP = 'shanmen-body'
C.wing_wall(L, cfg['wings'], 'right')
C.wing_wall(L, cfg['wings'], 'left')
print(f'STAGE wings ok ({time.time() - T0:.1f}s)')

L.GROUP = 'temple-ground'
fc = cfg['forecourt']
half = fc['widthM'] / 2
L.box('court-slab', (0, -fc['slabThicknessM'] / 2, (fc['zRange'][0] + fc['zRange'][1]) / 2),
      (fc['widthM'], fc['slabThicknessM'], fc['depthM'] - .01), 'paving', 0)
L.box('passage-slab', (0, -fc['slabThicknessM'] / 2, (fc['passageZRange'][0] + fc['passageZRange'][1]) / 2),
      (fc['passageWidthM'] + .02, fc['slabThicknessM'],
       fc['passageZRange'][1] - fc['passageZRange'][0] + .01), 'paving', 0)
bw = fc['stoneBorderWidthM']
L.box('court-border-front', (0, -fc['slabThicknessM'] / 2 + .004, fc['zRange'][1] - bw / 2),
      (fc['widthM'], fc['slabThicknessM'] + .008, bw), 'stone', .006)
for sgn in (-1, 1):
    L.box('court-border-side', (sgn * (half - bw / 2), -fc['slabThicknessM'] / 2 + .004,
          (fc['zRange'][0] + fc['zRange'][1]) / 2),
          (bw, fc['slabThicknessM'] + .008, fc['depthM']), 'stone', .006)
L.box('threshold-band', (0, -fc['slabThicknessM'] / 2 + .004, -.3),
      (fc['passageWidthM'] + .5, fc['slabThicknessM'] + .008, .6), 'stone', .006)
print(f'STAGE ground ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S5. lion candidates (limited mesh, no animation)
# R1 review revision (owner saw the standing silhouettes read as HORSES): the
# guardian-lion reading now comes from the silhouette itself — SEATED posture
# (haunches down, chest up), a broad mane DISC wider than the head, curled
# tail over the haunch, and the classic pairing under the front paw (right =
# embroidered ball, left = reclining cub). All stone, plinth unchanged,
# candidate status unchanged — the lead still decides by looking.

L.GROUP = 'shanmen-lion'
lio = cfg['lions']


def seated_lion(cx, cz, male):
    sgn = 1 if cx > 0 else -1
    # plinth (unchanged position/size)
    L.box('lion-plinth', (cx, .13, cz), (.5, .26, .62), 'stone', .012, True)
    L.box('lion-plinth-cap', (cx, .29, cz), (.42, .06, .52), 'stone', .008)
    base = .32                                  # sit on the plinth cap
    # seated mass: rear haunches + tall chest leaning forward
    L.box('lion-haunch', (cx, base + .24, cz - .10), (.46, .48, .50), 'stone', .014)
    L.box('lion-chest', (cx, base + .58, cz + .10), (.40, .76, .42), 'stone', .012)
    # broad mane disc (axis Z) with a rolled rim ring — the key lion cue
    L.cyl('lion-mane', (cx, base + .92, cz - .075), (cx, base + .92, cz + .075), .285, 'stone', 14)
    L.cyl('lion-mane-rim', (cx, base + .92, cz - .095), (cx, base + .92, cz + .095), .315, 'stone', 8)
    # head sitting in the disc: skull + muzzle + jaw + brow + ears
    L.box('lion-head', (cx, base + .97, cz + .10), (.27, .24, .22), 'stone', .01)
    L.box('lion-muzzle', (cx, base + .90, cz + .24), (.13, .10, .11), 'stone', .006)
    L.box('lion-jaw', (cx, base + .84, cz + .22), (.11, .05, .10), 'stone', .004)
    L.box('lion-brow', (cx, base + 1.01, cz + .20), (.19, .035, .06), 'stone', .004)
    for dx in (-.09, .09):
        L.box('lion-ear', (cx + dx, base + 1.10, cz + .05), (.06, .07, .045), 'stone', .004)
    # forelegs straight down the chest front, paws forward
    for dx in (-.12, .12):
        L.box('lion-foreleg', (cx + dx, base + .24, cz + .24), (.11, .48, .12), 'stone', .006)
        L.box('lion-paw', (cx + dx, base + .04, cz + .30), (.13, .09, .17), 'stone', .004)
    # pairing object under the inner paw
    if male:  # embroidered ball
        L.cyl('lion-ball', (cx - sgn * .12, base + .05, cz + .38),
              (cx - sgn * .12, base + .05, cz + .38), .085, 'stone', 10)
    else:     # reclining cub
        L.box('lion-cub', (cx - sgn * .14, base + .06, cz + .36), (.17, .12, .26), 'stone', .006)
        L.box('lion-cub-head', (cx - sgn * .14, base + .12, cz + .48), (.10, .09, .09), 'stone', .004)
    # curled tail arcing over the haunch
    L.rod('lion-tail', (cx + sgn * .18, base + .30, cz - .26),
          (cx + sgn * .21, base + .52, cz - .30), .045, 'stone')
    L.rod('lion-tail', (cx + sgn * .21, base + .52, cz - .30),
          (cx + sgn * .16, base + .66, cz - .22), .04, 'stone')
    L.rod('lion-tail-tip', (cx + sgn * .16, base + .66, cz - .22),
          (cx + sgn * .08, base + .62, cz - .12), .034, 'stone')


LIONS_V2 = a.lionsVersion == 'v2'
for cx, _, cz in lio['centers']:
    if not LIONS_V2:
        seated_lion(cx, cz, male=cx > 0)   # right lion: ball; left lion: cub
print(f'STAGE lions ok ({time.time() - T0:.1f}s)')

# D1 lions v2 (strict opt-in --lionsVersion v2; default path above untouched).
# DESIGN_SPEC packageD.lionsV2: seated lion, faceted-sphere head, 8-10 mane
# curls, foreleg/paw blocks, ball (LEFT) / cub (RIGHT), xumi plinth
# 0.62 x 0.3 x 0.75, overall bounds <= 0.55 x 1.35 x 0.7, <= 3500 tris each.
# Reference PBR-SH-0003-003/004 posture+proportion only (no pattern copying).
if LIONS_V2:
    L.GROUP = 'shanmen-lion'
    _lion2_tris = {}


    def _faceted_sphere(name, center, r, meridians=8, rings=5, m='stone'):
        """Low-poly UV sphere authored in GLB coords via L.mesh."""
        cx0, cy0, cz0 = center
        verts = [(cx0, cy0 + r, cz0), (cx0, cy0 - r, cz0)]
        for j in range(1, rings):
            phi = math.pi * j / rings
            y = cy0 + r * math.cos(phi)
            rr = r * math.sin(phi)
            for i in range(meridians):
                th = 2 * math.pi * i / meridians
                verts.append((cx0 + rr * math.cos(th), y, cz0 + rr * math.sin(th)))
        faces = []
        last_ring_start = 2 + (rings - 2) * meridians
        for i in range(meridians):
            faces.append((0, 2 + i, 2 + (i + 1) % meridians))
            faces.append((1, last_ring_start + (i + 1) % meridians, last_ring_start + i))
        for j in range(rings - 2):
            lo = 2 + j * meridians
            hi = lo + meridians
            for i in range(meridians):
                a2, b2 = lo + i, lo + (i + 1) % meridians
                c2, d2 = hi + i, hi + (i + 1) % meridians
                faces.append((a2, d2, c2))
                faces.append((a2, b2, d2))
        return L.mesh(name, verts, faces, m)


    def seated_lion_v2(cx, cz, male):
        sgn = 1 if cx > 0 else -1
        side = 'w' if cx < 0 else 'e'
        # xumi plinth: two tiers totalling 0.62 x 0.3 x 0.75
        L.box(f'lion2-{side}-plinth-tier1', (cx, .07, cz), (.62, .14, .75), 'stone', .012)
        L.box(f'lion2-{side}-plinth-tier2', (cx, .22, cz), (.54, .16, .66), 'stone', .01)
        base = .30
        # seated mass: haunches + forward-leaning chest
        L.box(f'lion2-{side}-haunch', (cx, base + .25, cz - .10), (.46, .50, .50), 'stone', .014)
        L.box(f'lion2-{side}-chest', (cx, base + .47, cz + .10), (.40, .66, .42), 'stone', .012)
        # broad mane disc + rolled rim (the lion cue), kept under y=1.35
        L.cyl(f'lion2-{side}-mane', (cx, 1.06, cz - .06), (cx, 1.06, cz + .08), .24, 'stone', 14)
        L.cyl(f'lion2-{side}-mane-rim', (cx, 1.06, cz - .08), (cx, 1.06, cz + .06), .26, 'stone', 8)
        # faceted-sphere head in the disc + muzzle/jaw/brow/ears
        _faceted_sphere(f'lion2-{side}-head', (cx, 1.09, cz + .10), .145)
        L.box(f'lion2-{side}-muzzle', (cx, 1.03, cz + .23), (.13, .10, .10), 'stone', .006)
        L.box(f'lion2-{side}-jaw', (cx, .98, cz + .21), (.11, .05, .09), 'stone', .004)
        L.box(f'lion2-{side}-brow', (cx, 1.14, cz + .20), (.19, .035, .05), 'stone', .004)
        for dx in (-.09, .09):
            L.box(f'lion2-{side}-ear', (cx + dx, 1.22, cz + .05), (.06, .07, .045), 'stone', .004)
        # mane: 9 curl discs arched brow -> cheek -> chest (8-10 segments)
        for k in range(9):
            t = k / 8.0
            ang = math.pi * (0.15 + 0.7 * t)          # from brow over cheek to chest
            r_curl = .052 - .012 * abs(t - .45)
            L.cyl(f'lion2-{side}-mane-curl', (cx, 1.06 + .26 * math.cos(ang) - .02,
                                              cz + .10 + .24 * math.sin(ang) - .02),
                  (cx, 1.06 + .26 * math.cos(ang) - .02,
                   cz + .10 + .24 * math.sin(ang) + .02), r_curl, 'stone', 6)
        # forelegs straight down the chest front + toe-notched paws
        for dx in (-.12, .12):
            L.box(f'lion2-{side}-foreleg', (cx + dx, base + .24, cz + .24), (.11, .48, .12), 'stone', .006)
            L.box(f'lion2-{side}-paw', (cx + dx, base + .04, cz + .30), (.13, .08, .16), 'stone', .004)
            for tdx in (-.04, 0, .04):
                L.box(f'lion2-{side}-toe', (cx + dx + tdx, base + .035, cz + .375), (.032, .07, .03), 'stone', 0)
        # pairing object: embroidered ball LEFT / reclining cub RIGHT (spec)
        if male:
            L.cyl(f'lion2-{side}-ball', (cx - sgn * .12, base + .05, cz + .38),
                  (cx - sgn * .12, base + .05, cz + .38), .085, 'stone', 10)
            for k in range(4):
                th = math.pi * k / 4
                L.rod(f'lion2-{side}-ball-band', (cx - sgn * .12 + .083 * math.cos(th), base + .05,
                                                  cz + .38 + .083 * math.sin(th)),
                      (cx - sgn * .12 - .083 * math.cos(th), base + .05,
                       cz + .38 - .083 * math.sin(th)), .008, 'stone')
        else:
            L.box(f'lion2-{side}-cub', (cx - sgn * .14, base + .06, cz + .36), (.17, .12, .26), 'stone', .006)
            L.box(f'lion2-{side}-cub-head', (cx - sgn * .14, base + .12, cz + .48), (.10, .09, .09), 'stone', .004)
            L.box(f'lion2-{side}-cub-ear', (cx - sgn * .14 - .03, base + .17, cz + .45), (.04, .04, .03), 'stone', 0)
        # curled tail arcing over the haunch
        L.rod(f'lion2-{side}-tail', (cx + sgn * .18, base + .30, cz - .26),
              (cx + sgn * .21, base + .52, cz - .30), .045, 'stone')
        L.rod(f'lion2-{side}-tail', (cx + sgn * .21, base + .52, cz - .30),
              (cx + sgn * .16, base + .64, cz - .22), .04, 'stone')
        L.rod(f'lion2-{side}-tail-tip', (cx + sgn * .16, base + .64, cz - .22),
              (cx + sgn * .08, base + .60, cz - .12), .034, 'stone')
        # spec collision: one box 0.62 x 1.35 x 0.75 per lion (records only,
        # no mesh; supersedes the v1 plinth-only record in the v3 dataset)
        L.COLL.append({'name': f'lion2-{side}-guard', 'group': 'shanmen-lion', 'type': 'box',
                       'center': [cx, .675, cz], 'size': [.62, 1.35, .75], 'axis': 'glTF Y-up'})


    for cx, _, cz in lio['centers']:
        seated_lion_v2(cx, cz, male=cx < 0)   # spec: ball LEFT / cub RIGHT
    for _side in ('w', 'e'):
        _t = 0
        for _o in bpy.context.scene.objects:
            if _o.type == 'MESH' and _o.get('part', '') == 'shanmen-lion' and f'-{_side}-' in _o.name:
                _o.data.calc_loop_triangles()
                _t += len(_o.data.loop_triangles)
        _lion2_tris[_side] = _t
        if _t > 3500:
            print('LION_V2_BUDGET_FAIL', _side, _t, '> 3500')
            sys.exit(7)
    print(f"STAGE lions v2 ok (w={_lion2_tris['w']} e={_lion2_tris['e']} tris, <=3500 each)")

# ---------------------------------------------------------------------------
# S6. ridge-end ornament candidates (coarse fish-dragon silhouettes)

L.GROUP = 'shanmen-ornament'
orn = cfg['roof']['ornaments']
thin = orn['minThinFeatureM']


def ridge_ornament(sx, base_y, scale):
    inward = -1 if sx > 0 else 1
    L.box('orn-body', (sx, base_y + .18 * scale, orn['centerPair']['z']), (.62 * scale, .36 * scale, .3 * scale), 'roof', .012)
    L.box('orn-head', (sx + inward * .28 * scale, base_y + .34 * scale, orn['centerPair']['z']),
          (.26 * scale, .26 * scale, .26 * scale), 'roof', .01)
    L.box('orn-jaw', (sx + inward * .40 * scale, base_y + .27 * scale, orn['centerPair']['z']),
          (.14 * scale, .1 * scale, .2 * scale), 'roof', .008)
    L.box('orn-tail-fin', (sx - inward * .22 * scale, base_y + .5 * scale, orn['centerPair']['z']),
          (max(thin, .05 * scale), .34 * scale, .4 * scale), 'roof', .006)
    L.box('orn-tail-tip', (sx - inward * .30 * scale, base_y + .72 * scale, orn['centerPair']['z']),
          (max(thin, .05 * scale), .12 * scale, .2 * scale), 'roof', .006)
    for dz in (-.1 * scale, .1 * scale):
        L.box('orn-eye', (sx + inward * .24 * scale, base_y + .4 * scale, orn['centerPair']['z'] + dz),
              (.05, .05, .05), 'gold', 0)
    L.box('orn-crest', (sx + inward * .04 * scale, base_y + .39 * scale, orn['centerPair']['z']),
          (.3 * scale, .04 * scale, .12 * scale), 'roof', 0)


WINDOWS_V2 = a.windowsVersion == 'v2'
if not WINDOWS_V2:
    for sx in orn['centerPair']['x']:
        ridge_ornament(sx, orn['centerPair']['baseY'], 1.0)
    for sx in orn['shoulderPair']['x']:
        ridge_ornament(sx, orn['shoulderPair']['baseY'], 0.66)
    print(f'STAGE ornaments ok ({time.time() - T0:.1f}s)')
else:
    # D1 wing windows v2 (strict opt-in --windowsVersion v2). DESIGN_SPEC
    # packageD.wingWindowsV2: square openwork lattice 1.1 x 1.1 (stone frame
    # 0.12, simplified ice-crack 5-7 straight bars, thickness 0.06) at the SAME
    # center as the v1 wing relief panel; label design_inference (owner may
    # veto back to v1). The frozen temple.glb relief panel is covered by a
    # stone backing plate so the old diamond pattern does not peek around.
    _wing = cfg['wings']
    for side in ('left', 'right'):
        start = _wing[f'{side}Start']
        end = _wing[f'{side}End']
        length, lx, lz, front = C.make_oriented(start, end)
        pw, ph = _wing['panelWH']
        pcx = _wing['panelCenterAlongWallFrac'] * length
        pcy = .5 + ph / 2
        t = _wing['thicknessM']
        front_off = front  # sign taking local u/v offsets out toward the viewer
        base = front_off * (t / 2)         # offsets are measured from the wall
        nf = (lz[0] * front_off, 0.0, lz[2] * front_off)  # CENTER plane on

        # backing plate covering the v1 relief panel (1.8x2.15) + proud strips
        _pl = [(pcx - .95, pcy - 1.125), (pcx + .95, pcy - 1.125),
               (pcx + .95, pcy + 1.125), (pcx - .95, pcy + 1.125)]
        _pts = [C.local_to_world(start, lx, lz, (u, v, base + front_off * .062)) for u, v in _pl]
        C.quad_out(L, 'wing2-window-plate', _pts, 'stone',
                   [(0, 0), (1.9 / 1.44, 0), (1.9 / 1.44, 2.25 / 1.44), (0, 2.25 / 1.44)], nf)

        # square frame ring via oriented boxes: outer 1.34, bar 0.12, depth
        # band +0.04..+0.10 from the wall front (thickness 0.06)
        _o, _b = 1.34 / 2, .12
        for (cu, cv, sw, sh) in [
            (pcx - _o + _b / 2, pcy, _b, 2 * _o),
            (pcx + _o - _b / 2, pcy, _b, 2 * _o),
            (pcx, pcy - _o + _b / 2, 2 * _o - 2 * _b, _b),
            (pcx, pcy + _o - _b / 2, 2 * _o - 2 * _b, _b),
        ]:
            C.obox(L, 'wing2-window-frame', start, lx, lz,
                   (cu, cv, base + front_off * .092), (sw, sh, .06), 'stone', bevel=0.004)

        # ice-crack simplified: 7 straight bars at irregular angles AND
        # irregular offsets (not all through the center), clipped to the 1.1
        # square, recessed at +0.077 (behind the frame front +0.122)
        _inner = 1.1 / 2
        _bars = [(-8, -.28, -.05), (17, .18, -.22), (36, -.10, .25), (69, .30, .08),
                 (104, -.30, .12), (133, .05, -.30), (157, -.18, .30)]
        for k, (_deg, _ou, _ov) in enumerate(_bars):
            _th = math.radians(_deg)
            _du, _dv = math.cos(_th), math.sin(_th)
            _cu, _cv = pcx + _ou, pcy + _ov
            _lim = _inner / abs(math.cos(_th)) if abs(math.cos(_th)) >= abs(math.sin(_th)) \
                else _inner / abs(math.sin(_th))
            _half = min(_lim, _inner + .06)
            _a0 = C.local_to_world(start, lx, lz,
                                   (_cu - _du * _half, _cv - _dv * _half, base + front_off * .077))
            _a1 = C.local_to_world(start, lx, lz,
                                   (_cu + _du * _half, _cv + _dv * _half, base + front_off * .077))
            L.rod(f'wing2-window-bar-{side}-{k}', _a0, _a1, .022, 'stone')
        print(f'STAGE wing windows v2 ({side}) ok ({time.time() - T0:.1f}s)')
    _w2t = 0
    for _o in bpy.context.scene.objects:
        if _o.type == 'MESH' and _o.get('part', '') == 'shanmen-ornament':
            _o.data.calc_loop_triangles()
            _w2t += len(_o.data.loop_triangles)
    if _w2t > 2400:
        print('WINDOWS_V2_BUDGET_FAIL', _w2t, '> 2400')
        sys.exit(7)
    print(f'STAGE ornaments v2 (square lattice windows) ok ({_w2t} tris <= 2400)')

# ---------------------------------------------------------------------------
# collision normalization + clear-corridor assertion BEFORE any export

adapter_coll = []
for rec in L.COLL:
    if 'obb' in rec:
        adapter_coll.append(rec)
    else:
        cx, cy, cz = rec['center']
        sx, sy, sz = rec['size']
        adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'shanmen-body'),
                             'type': 'box',
                             'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                             'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                             'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                     'center': [cx, cy, cz], 'size': [sx, sy, sz]}})

CORRIDOR = {'x': 1.45, 'y0': 0.25, 'y1': 2.85, 'z0': -3.55, 'z1': -0.05}
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
# multi-target finalize: join by (group, material), export per target, reimport

TARGETS = [
    ('temple.glb', ('shanmen-body', 'shanmen-plaque')),
    ('ground.glb', ('temple-ground',)),
    ('lions-v2.glb' if a.lionsVersion == 'v2' else 'lions.glb', ('shanmen-lion',)),
    ('ornaments-v2.glb' if a.windowsVersion == 'v2' else 'ornaments.glb', ('shanmen-ornament',)),
]

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

# budget assertions (hard fail — the pilot must not ship over budget)
main_t = measure['targets']['temple.glb']
full_t = sum(t['triangles'] for t in measure['targets'].values())
if main_t['triangles'] > BUD['buildingAndWallsTrisMax']:
    print('BUDGET_FAIL buildingAndWalls', main_t['triangles'])
    sys.exit(5)
if full_t > BUD['fullSetTrisMax']:
    print('BUDGET_FAIL fullSet', full_t)
    sys.exit(5)
if main_t['fileBytes'] > BUD['mainGlbBytesMax']:
    print('BUDGET_FAIL mainGlbBytes', main_t['fileBytes'])
    sys.exit(5)
if measure['targets']['ground.glb']['fileBytes'] > BUD['groundGlbBytesMax']:
    print('BUDGET_FAIL groundGlbBytes', measure['targets']['ground.glb']['fileBytes'])
    sys.exit(5)

# reimport every exported GLB into a scratch scene; verify materials/images survived
original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
reimport = {}
for fname, _ in TARGETS:
    bpy.ops.import_scene.gltf(filepath=str(out / fname))
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
    reimport[fname] = {'imported': True, 'meshes': meshes, 'boundsBlender': bounds,
                       'materials': observed}
    for ob in list(check.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
bpy.context.window.scene = original
(out / 'reimport-check.json').write_text(json.dumps(reimport, ensure_ascii=False, indent=2) + '\n',
                                          encoding='utf-8')

# plaque/relief connections must actually be on the exported GLB, not just in Blender
plq_ok = any(m['name'].startswith('temple-plaque') and m['imageNodes']
             and max(m['imageNodes'][0]['size']) >= 512
             for m in reimport['temple.glb']['materials'])
rlf_ok = any('relief' in m['name'] and any(n['colorSpace'] == 'Non-Color' for n in m['imageNodes'])
             for m in reimport['temple.glb']['materials'])
if not (plq_ok and rlf_ok):
    print('TEXTURE_CONNECTION_FAIL', plq_ok, rlf_ok)
    sys.exit(6)

# sidecars
(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; world-space records (temple at origin, no instance transform)',
    'adapterFormat': 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
    'clearCorridor': CORRIDOR,
    'corridorVerifiedEmpty': True,
    'colliders': adapter_coll,
    'groups': {fname: list(groups) for fname, groups in TARGETS},
    'notIntegratedOrWalkingTested': False,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
measure['budgets'] = {
    'buildingAndWallsTris': {'actual': main_t['triangles'], 'limit': BUD['buildingAndWallsTrisMax'], 'pass': True},
    'fullSetTris': {'actual': full_t, 'limit': BUD['fullSetTrisMax'], 'pass': True},
    'mainGlbBytes': {'actual': main_t['fileBytes'], 'limit': BUD['mainGlbBytesMax'], 'pass': True},
    'groundGlbBytes': {'actual': measure['targets']['ground.glb']['fileBytes'],
                       'limit': BUD['groundGlbBytesMax'], 'pass': True},
    'newImages': {'actual': 2, 'limit': BUD['newImagesMax'], 'pass': True},
    'tileRibsTris': {'actual': _rib_tris, 'limit': rs['tileRibs']['budgetExtraTrisMax'], 'pass': True,
                     'note': 'DESIGN_REVISION tileRibs allowance on top of the shells'},
}
measure['design'] = {
    'family': cfg['family'],
    'variants': {'lionsVersion': a.lionsVersion, 'windowsVersion': a.windowsVersion},
    'reference': cfg['reference'],
    'clearOpeningM': [op['clearWidthM'], op['clearHeightM']],
    'ridgeHeightsM': {'center': rc['ridgeY'], 'shoulders': rs['ridgeY'], 'wingCap': cfg['wings']['tileCapMaxY']},
    'plaque': {'literalLeftToRight': pl['literalLeftToRight'], 'readingRightToLeft': pl['readingRightToLeft']},
    'roofMethod': ('continuous profile-lofted thin shells (normal-offset soffits), T3 revision '
                   'equation on the shoulders, closed seam skirts, finite half-round tile ribs '
                   'on the front slopes; no box stacks'),
    'wings': 'built per side with own oriented frames (no mirrored normals)',
    'rearAndDepth': 'design inference (no rear reference) — uncertaintyPolicy in config',
    'lionsOrnaments': 'coarse candidates, replaceable; lead reviews silhouettes',
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# T3 verification input: the shoulder equation sampled on the exact shell grid
# (independent of mesh code paths downstream). The dataset test matches these
# against vertices parsed from the exported GLB bytes.
_sh_grid = {'source': 'kit/temple_components.py shoulder_surface_fn (T3 revision equation)',
            'equation': ('baseY(t)=ridgeY-(ridgeY-eaveBaselineY)*drop(t); '
                         'y=baseY+(frontOutline(|x|)-eaveBaselineY)*smoothstep(0.5,1,t)^2; rear eave keeps '
                         'rearEaveDropFromFront; ridge never elevated'),
            'ridgeY': rs['ridgeY'], 'eaveBaselineY': rs['eaveBaselineY'],
            'gridX': [], 'front': [], 'rear': []}
_nu, _seg = 10, rs['resampleSegments']
_x0, _x1 = rs['xSpans'][1]
_sh_grid['gridX'] = [_x0 + (_x1 - _x0) * i / _nu for i in range(_nu + 1)]
for _j in range(_seg + 1):
    _t = _j / _seg
    _zf = rs['ridgeZ'] + (rs['frontEaveZ'] - rs['ridgeZ']) * _t
    _zr2 = rs['ridgeZ'] - (rs['ridgeZ'] - rs['rearEaveZ']) * _t
    _sh_grid['front'].append({'t': _t, 'z': _zf,
                              'y': [round(_sh_srf(_x, _zf), 6) for _x in _sh_grid['gridX']]})
    _sh_grid['rear'].append({'t': _t, 'z': _zr2,
                             'y': [round(_sh_srf(_x, _zr2), 6) for _x in _sh_grid['gridX']]})
(out / 'roof-surface-samples.json').write_text(json.dumps(_sh_grid, ensure_ascii=False, indent=2) + '\n',
                                               encoding='utf-8')

print(f"TEMPLE_READY tris(body+plaque)={main_t['triangles']} fullSet={full_t} "
      f"bytes={main_t['fileBytes']} total={time.time() - T0:.1f}s")
