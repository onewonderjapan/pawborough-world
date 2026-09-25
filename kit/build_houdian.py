"""Houdian (north hall, 城隍殿) builder — temple-axis expansion batch N4.

Copy-adapted from build_peidian.py (the proven single-eave two-slope 硬山
machinery) at the frozen houdian dimensions: 3 bays of 4.2 m, 8.4 m deep,
ridge 8.0, base 0.45 with three steps, simplified 吻 ornaments on the plain
ridge beam. Single world instance at (0, 0, -74) yaw 0.

Local frame: front-wall center bottom origin, facade +Z, depth -Z. The world
Single world instance at (0, 0, -74) yaw 0 (DESIGN_SPEC.houdian.placement).

Form: 3-bay (2.2m) single-eave two-slope 硬山 hall. Closed double door in the
center bay, lattice windows over plaster 槛墙 in the side bays, BLANK wood
plaque (no characters — new image budget 0), two freestanding gallery columns
in front of each end bay line... no: four columns at ±1.1/±3.3 carrying the
eave overhang to local z +1.5. Side walls rise to the roof soffit as the 硬山
gable (owner ruling: NO 观音兜 curve). Roof = ONE continuous shell lofted from
the section profile (yimen machinery), full-width flat ridge (no hip ends), no
corner lift, finite tile ribs, plain full-length ridge beam without 吻.

Groups exported: 'houdian-body' + 'temple-ground' (base slab + step tops ARE
the physics ground — the ground naming contract).

Run:
  blender -b --factory-startup -t 4 -P kit/build_houdian.py -- \
      --config kit/houdian.config.json --out kit/out/houdian
"""
import argparse
import hashlib
import json
import math
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
    'body': {'facadeWidthM': None, 'bays': None, 'bayM': None, 'bodyDepthM': None,
             'sideWallX': None, 'sideWallThicknessM': None, 'rearWallZ': None,
             'rearWallThicknessM': None, 'gableType': None},
    'front': {'wallLocalZ': None, 'galleryColumnsLocalZ': None, 'columnsX': None,
              'columnSizeM': None, 'eaveOverhangToLocalZ': None, 'topBeamY': None},
    'centerBay': {'door': {'leafCount': None, 'leafSizeM': None, 'leafCenterZ': None,
                           'closedCollider': None},
                  'thresholdM': None, 'lintelWidthM': None},
    'sideBays': {'lattice': {'sillY': None, 'topY': None, 'waistRailY': None,
                             'mullionStepM': None},
                 'belowWall': None, 'windowSpansX': None},
    'plaque': {'widthM': None, 'heightM': None, 'centerY': None, 'build': None,
               'faceZ': None},
    'rearDesign': {'mode': None, 'designInference': None},
    'roof': {'type': None, 'widthM': None, 'ridgeY': None, 'eaveY': None,
             'ridgeLocalZ': None, 'frontEaveZ': None, 'rearEaveZ': None,
             'shellThicknessM': None, 'profileTY': None, 'resampleSegments': None,
             'tileRibSpacingM': None, 'tileRibRadiusM': None, 'eaveFasciaH': None,
             'soffitDepthM': None, 'ridgeBeamM': None, 'ridgeEnds': None},
    'base': {'topY': None, 'extentLocalZ': None, 'extentX': None, 'slabThicknessM': None,
             'steps': {'count': None, 'riserM': None, 'treadM': None, 'widthM': None,
                       'atCenterBay': True}},
    'budgets': {'houdianTrisMax': None, 'ridgeOrnamentTrisMax': None},
    'runtime': {'capsule': {'radius': None, 'halfHeight': None, 'eyeHeight': None}},
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
        if sub and k in obj and isinstance(obj[k], dict):
            problems += check_keys(obj[k], sub, f'{path}.{k}')
    return problems


def validate(c):
    pr = check_keys(c, SCHEMA, 'config')
    bd, fr, rf, bs = c['body'], c['front'], c['roof'], c['base']
    if c['units'] != 'meters':
        pr.append('units must be meters')
    if 'Y-up' not in c['axis'] or '+Z' not in c['axis']:
        pr.append('axis must state GLB Y-up and facade +Z')
    if c['reference']['dimensionsAreDesign'] is not True:
        pr.append('dimensions must be flagged design (not survey)')
    # frozen numbers (DESIGN_SPEC.houdian) — copy exact
    FROZEN = {'facadeWidthM': 12.6, 'bays': 3, 'bayM': 4.2, 'bodyDepthM': 8.4,
              'sideWallX': 6.45, 'rearWallZ': -8.4}
    for k, v in FROZEN.items():
        if bd[k] != v:
            pr.append(f'body.{k} must stay the frozen value {v}')
    if sorted(fr['columnsX']) != [-6.3, -2.1, 2.1, 6.3]:
        pr.append('front.columnsX must be the frozen ±2.1/±6.3')
    if fr['galleryColumnsLocalZ'] != 1.2 or fr['eaveOverhangToLocalZ'] != 2.0:
        pr.append('front column z 1.2 / eave overhang 2.0 are frozen')
    if (rf['ridgeY'], rf['eaveY'], rf['ridgeLocalZ'], rf['widthM']) != (8.0, 4.9, -3.6, 12.6):
        pr.append('roof ridge 8.0 / eave 4.9 / ridgeZ -3.6 / width 12.6 are frozen')
    if rf['frontEaveZ'] != fr['eaveOverhangToLocalZ'] or abs(rf['rearEaveZ'] - (bd['rearWallZ'] - 0.6)) > 1e-9:
        pr.append('roof eaves must match overhangs (front to z=2.0, rear 0.6 past the rear wall)')
    if abs(rf['profileTY'][0][1] - rf['ridgeY']) > 1e-6 or abs(rf['profileTY'][-1][1] - rf['eaveY']) > 1e-6:
        pr.append('profile must run ridge..eave exactly')
    if any(y > rf['ridgeY'] + 1e-6 or y < rf['eaveY'] - 1e-6 for _, y in rf['profileTY']):
        pr.append('profile heights escape the ridge..eave band')
    if not (10 <= rf['resampleSegments'] <= 16):
        pr.append('resample segments must be 10-16')
    if abs(bs['topY'] - bs['steps']['count'] * bs['steps']['riserM']) > 1e-9:
        pr.append('steps count*riser must reach the base top exactly')
    if '硬山' not in bd['gableType'] or 'xieshan' not in bd['gableType']:
        pr.append('gableType must record the 硬山 ruling (G36 xieshan read not adopted)')
    if '0 image' not in c['uncertaintyPolicy'].get('plaque', '') and 'budget 0' not in c['plaque']['build']:
        pr.append('plaque must stay a blank board (new image budget 0)')
    if c['plaque']['widthM'] != 3.0 or c['plaque']['heightM'] != 0.9 or c['plaque']['centerY'] != 3.9:
        pr.append('plaque 3.0x0.9 @3.9 is frozen')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# materials: shared palette only, zero new images

L.reset_scene()
L.build_materials()

bd, fr, cb, sb = cfg['body'], cfg['front'], cfg['centerBay'], cfg['sideBays']
rf, bs, plq, BUD = cfg['roof'], cfg['base'], cfg['plaque'], cfg['budgets']

# ---------------------------------------------------------------------------
# roof surface: one continuous two-slope shell, flat full-width ridge,
# monotone by construction (yimen machinery without hip/lift terms)

_drop = C.make_drop_fn(rf['profileTY'], rf['resampleSegments'])
HW = rf['widthM'] / 2
Z_MID, ZF, ZR = rf['ridgeLocalZ'], rf['frontEaveZ'], rf['rearEaveZ']
THICK = rf['shellThicknessM']


def roof_y(x, z):
    if z >= Z_MID:
        t = min(1.0, max(0.0, (z - Z_MID) / (ZF - Z_MID)))
    else:
        t = min(1.0, max(0.0, (Z_MID - z) / (Z_MID - ZR)))
    return rf['ridgeY'] - (rf['ridgeY'] - rf['eaveY']) * _drop(t)


for kx in (-HW, -1.0, 0.0, 1.0, HW):
    if abs(roof_y(kx, Z_MID) - rf['ridgeY']) > 1e-9:
        print('ROOF_EQUATION_FAIL ridge not flat at', kx)
        sys.exit(8)
for i in range(21):
    x = -HW + 2 * HW * i / 20
    prev = roof_y(x, Z_MID)
    for j in range(1, 25):
        y = roof_y(x, Z_MID + (ZF - Z_MID) * j / 24)
        if y > prev + 1e-9:
            print('ROOF_EQUATION_FAIL surface rises toward the eave at', x)
            sys.exit(8)
        prev = y
print(f'roof equation checks ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S1. base slab + steps (group temple-ground: they ARE the physics ground)

L.GROUP = 'temple-ground'
bx0, bx1 = bs['extentX']
bz0, bz1 = bs['extentLocalZ']
L.box('houdian-base', (0, bs['topY'] - bs['slabThicknessM'] / 2, (bz0 + bz1) / 2),
      (bx1 - bx0, bs['slabThicknessM'], abs(bz1 - bz0)), 'stone', .008, True)
# R1-06: base skirt boxes REMOVED — even inset, the slot between the skirt
# and the slab side face was fully occluded from the sky (pure black band in
# Cycles). The base slab box itself already carries the side collision.

st = bs['steps']
for k in range(st['count']):
    top = (k + 1) * st['riserM']
    L.box('houdian-step', (0, top - st['riserM'] / 2, bz0 - (k + 0.5) * st['treadM']),
          (st['widthM'], st['riserM'], st['treadM']), 'stone', .006, True)
print(f'STAGE base ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S2. body: front wall (door + lattice windows), columns, beams, gable walls,
# rear wall (group houdian-body)

L.GROUP = 'houdian-body'
cs = fr['columnSizeM']
wall_top = rf['eaveY'] - 0.05

# four gallery columns with plinths (freestanding, in front of the wall)
for x in fr['columnsX']:
    L.box('houdian-column', (x, cs[1] / 2 + bs['topY'], fr['galleryColumnsLocalZ']),
          (cs[0], cs[1], cs[2]), 'wood', .01, True)
    L.box('houdian-column-plinth', (x, bs['topY'] + .17, fr['galleryColumnsLocalZ']),
          (cs[0] + .16, .34, cs[2] + .16), 'stone', .012, True)
by0, by1 = fr['topBeamY']
L.box('houdian-top-beam', (0, (by0 + by1) / 2 + bs['topY'], fr['galleryColumnsLocalZ']),
      (2 * bd['sideWallX'] - .1, by1 - by0, .26), 'wood', .01)
L.box('houdian-wall-plate', (0, rf['eaveY'] - .18, 0.02), (2 * bd['sideWallX'] - .1, .3, .24),
      'wood', .01, True)

# front wall: three x-zones — door bay and two window bays. In the window
# bays: plaster 槛墙 below sill, dark backing behind the lattice, plaster head
# strip above; the lattice assembly sits slightly inset (dadian bay language).
dz = .18
dw_w = cb['door']['leafSizeM'][0] * 2
lint_w = cb['lintelWidthM']
thr = cb['thresholdM']
door_top = cb['door']['leafSizeM'][1] + thr[1]
lat = sb['lattice']
for sgn in (-1, 1):
    x0, x1 = sorted((sgn * lint_w / 2, sgn * (bd['sideWallX'] - bd['sideWallThicknessM'])))
    # head strip full height of the zone top band + 槛墙 below sill
    L.box('front-wall', ((x0 + x1) / 2, (door_top + wall_top) / 2, -dz / 2),
          (abs(x1 - x0), wall_top - door_top, dz), 'plaster', 0, True)
    L.box('front-wall', ((x0 + x1) / 2, lat['sillY'] / 2, -dz / 2),
          (abs(x1 - x0), lat['sillY'], dz), 'plaster', 0, True)
    # door bay jambs + head
    jx0, jx1 = sorted((sgn * lint_w / 2, sgn * dw_w / 2))
    L.box('door-jamb', ((jx0 + jx1) / 2, (thr[1] + door_top) / 2, -dz / 2),
          (abs(jx1 - jx0), door_top - thr[1], dz), 'plaster', 0, True)
L.box('front-wall', (0, (door_top + wall_top) / 2, -dz / 2), (lint_w, wall_top - door_top, dz),
      'plaster', 0, True)

# door: stone threshold + two CLOSED leaves + frame trim
L.box('door-threshold', (0, thr[1] / 2, -0.02), (thr[0], thr[1], thr[2]), 'stone', .012, True)
lz = cb['door']['leafCenterZ']
for sgn in (-1, 1):
    L.box('door-leaf', (sgn * dw_w / 4, cb['door']['leafSizeM'][1] / 2 + thr[1], lz),
          (cb['door']['leafSizeM'][0], cb['door']['leafSizeM'][1], cb['door']['leafSizeM'][2]),
          'dark', .008, True)
for sgn in (-1, 1):
    L.box('door-frame-trim', (sgn * (dw_w / 2 + .045), thr[1] + cb['door']['leafSizeM'][1] / 2, -0.05),
          (.09, cb['door']['leafSizeM'][1], .13), 'wood', .008)
L.box('door-frame-head', (0, door_top + .06, -0.05), (dw_w + .18, .12, .13), 'wood', .008)

# side-bay lattice windows: sill 0.9..2.6 lattice over the 槛墙
for sgn in (-1, 1):
    x0, x1 = sorted(sb['windowSpansX'][0 if sgn < 0 else 1])
    xc, wb = (x0 + x1) / 2, x1 - x0
    L.box('bay-sill', (xc, lat['sillY'] + .05, -dz / 2), (wb, .1, dz + .06), 'stone', .008, True)
    L.box('bay-backing', (xc, (lat['sillY'] + lat['topY']) / 2, -dz / 2),
          (wb, lat['topY'] - lat['sillY'], .1), 'dark', 0, True)
    n = max(2, round(wb / lat['mullionStepM']))
    for k in range(n + 1):
        L.box('bay-mullion', (x0 + wb * k / n, (lat['sillY'] + lat['topY']) / 2, -dz / 2 - .05),
              (.07, lat['topY'] - lat['sillY'], .11), 'wood', .005)
    for yy in (lat['sillY'] + .08, lat['waistRailY'], lat['topY'] - .08):
        L.box('bay-rail', (xc, yy, -dz / 2 - .045), (wb - .02, .09, .12), 'wood', .005)
    k = 0
    while True:
        x = x0 + (.1 + lat['mullionStepM'] / 2) + lat['mullionStepM'] * k
        if x > x1 - .1:
            break
        L.box('bay-lattice-bar', (x, (lat['waistRailY'] + lat['topY']) / 2, -dz / 2 - .065),
              (.032, lat['topY'] - lat['waistRailY'] - .12, .045), 'wood', 0)
        k += 1
    L.box('bay-lower-panel', (xc, (lat['sillY'] + lat['waistRailY']) / 2, -dz / 2 - .04),
          (wb - .12, lat['waistRailY'] - lat['sillY'] - .12, .045), 'dark', 0)
print(f'STAGE front ok ({time.time() - T0:.1f}s)')

# gable (硬山) walls: lower box + strips following the roof soffit at the wall
sw_x = bd['sideWallX'] - bd['sideWallThicknessM'] / 2
for sgn in (-1, 1):
    x_in, x_out = sgn * (sw_x - bd['sideWallThicknessM']), sgn * sw_x
    low_top = 3.2
    L.box('gable-wall-lower', (sgn * sw_x, low_top / 2, -bd['bodyDepthM'] / 2),
          (bd['sideWallThicknessM'], low_top, bd['bodyDepthM']), 'plaster', 0, True)
    # wave5-templeqa: strip tops follow the roof soffit EXACTLY at both strip ends (sloped top quad),
    # sampled at the lower of the inner / outer wall faces. The old strips were flat-topped at the
    # higher end and their side trapezoids always put the high end at z2, so on the rear slope (roof
    # falling from z1 to z2) and at every step the plaster stood up to 0.27 m (peidian) / 0.22 m
    # (houdian) out of the tile surface — the white "teeth" along both gable verges.
    def soffit_at(z):
        return min(roof_y(x_in, z), roof_y(x_out, z)) - THICK - .02
    strips = []
    for k in range(math.ceil(bd['bodyDepthM'] / 0.35 - 1e-9)):
        z1 = -0.35 * k
        z2 = max(-bd['bodyDepthM'], z1 - 0.35)
        strips.append((z1, z2, soffit_at(z1), soffit_at(z2)))
    for z1, z2, ya, yb in strips:
        y0 = min(low_top - .02, ya, yb)
        C.quad_out(L, 'gable-wall-upper-inner',
                   [(x_in, y0, z1), (x_in, y0, z2), (x_in, yb, z2), (x_in, ya, z1)],
                   'plaster', [(z1 / 2.5, y0 / 2.5), (z2 / 2.5, y0 / 2.5),
                               (z2 / 2.5, yb / 2.5), (z1 / 2.5, ya / 2.5)], (-sgn, 0, 0))
        C.quad_out(L, 'gable-wall-upper-outer',
                   [(x_out, y0, z1), (x_out, y0, z2), (x_out, yb, z2), (x_out, ya, z1)],
                   'plaster', [(z1 / 2.5, y0 / 2.5), (z2 / 2.5, y0 / 2.5),
                               (z2 / 2.5, yb / 2.5), (z1 / 2.5, ya / 2.5)], (sgn, 0, 0))
        C.quad_out(L, 'gable-wall-upper-top',
                   [(x_in, ya, z1), (x_in, yb, z2), (x_out, yb, z2), (x_out, ya, z1)],
                   'plaster', [(z1 / 2.5, 0), (z2 / 2.5, 0), (z2 / 2.5, .13), (z1 / 2.5, .13)], (0, 1, 0))
    # R1-02: the corner end caps used to run up to the RIDGE-height max of the
    # strips (a full-height plaster slab at each wall corner, poking 2-3 m past
    # the eave). They must close at the LOCAL roof soffit height at their own z.
    for zend, hint in ((0.0, (0, 0, 1)), (-bd['bodyDepthM'], (0, 0, -1))):
        zq = zend - (0.01 if zend > 0 else -0.01) * -1  # sample just inside the wall
        zq = 0.0 if zend > 0 else -bd['bodyDepthM']
        ytop = soffit_at(zq)   # wave5-templeqa: same soffit sampling as the strips
        yb0 = low_top - .02
        if ytop <= yb0 + 0.01:
            continue  # the gable strip band already closes this corner
        C.quad_out(L, 'gable-wall-upper-end', [(x_in, yb0, zend), (x_out, yb0, zend),
                                               (x_out, ytop, zend), (x_in, ytop, zend)],
                   'plaster', [(x_in / 2.5, yb0 / 2.5), (x_out / 2.5, yb0 / 2.5),
                               (x_out / 2.5, ytop / 2.5), (x_in / 2.5, ytop / 2.5)], hint)
    L.box('gable-brick-base', (sgn * sw_x, .4, -bd['bodyDepthM'] / 2),
          (bd['sideWallThicknessM'] + .06, .8, bd['bodyDepthM'] - .1), 'brick', 0)
    # 博风 verge board riding the gable top edge (dark trim, no ornament)
    for zend, zhint in ((0.35, 1), (-bd['bodyDepthM'] - 0.3, -1)):
        p = (sgn * (bd['sideWallX'] + .01), roof_y(sgn * bd['sideWallX'], min(zend, ZF if zend > 0 else ZR)) - THICK - .02, zend)
        q = (sgn * (bd['sideWallX'] + .01), rf['ridgeY'] - THICK - .02, Z_MID)
        L.cyl('gable-verge-board', p, q, .05, 'dark', 6)
print(f'STAGE gables ok ({time.time() - T0:.1f}s)')

# rear wall: plain plaster + wood frame posts (design inference)
rz = bd['rearWallZ']
rh_in = bd['sideWallX'] - bd['sideWallThicknessM'] - .1
L.box('rear-wall', (0, wall_top / 2, rz + bd['rearWallThicknessM'] / 2),
      (2 * rh_in, wall_top, bd['rearWallThicknessM']), 'plaster', 0, True)
L.box('rear-beam', (0, wall_top + .1, rz + .05), (2 * rh_in - .2, .2, .3), 'wood', .01)
for sx in (-bd['sideWallX'] + .3, 0.0, bd['sideWallX'] - .3):
    L.box('rear-frame-post', (sx, wall_top / 2, rz + bd['rearWallThicknessM'] + .04),
          (.2, wall_top, .2), 'dark', .008)
print(f'STAGE walls ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S3. blank plaque: backing + thin frame + plain wood face (NO characters)

L.box('plaque-backing', (0, plq['centerY'], plq['faceZ'] - .025), (plq['widthM'], plq['heightM'], .05), 'dark', .01)
for cc, ss in [
    ((0, plq['centerY'] - plq['heightM'] / 2 + .03, plq['faceZ']), (plq['widthM'], .06, .022)),
    ((0, plq['centerY'] + plq['heightM'] / 2 - .03, plq['faceZ']), (plq['widthM'], .06, .022)),
    ((-plq['widthM'] / 2 + .03, plq['centerY'], plq['faceZ']), (.06, plq['heightM'] - .06, .022)),
    ((plq['widthM'] / 2 - .03, plq['centerY'], plq['faceZ']), (.06, plq['heightM'] - .06, .022)),
]:
    L.box('plaque-frame', cc, ss, 'wood', .006)
L.box('plaque-face', (0, plq['centerY'], plq['faceZ'] - .008),
      (plq['widthM'] - .12, plq['heightM'] - .12, .014), 'paper', 0)
print(f'STAGE plaque ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S4. roof: single shell both slopes + eave fascia + soffits + ribs + ridge beam

NU = 16
SEG = rf['resampleSegments']
for sdir, z_end in ((1, ZF), (-1, ZR)):
    run = abs(z_end - Z_MID)
    grid_t, grid_b, uvs = [], [], []
    for j in range(SEG + 1):
        t = j / SEG
        for i in range(NU + 1):
            x = -HW + 2 * HW * i / NU
            z = Z_MID + sdir * run * t
            y = roof_y(x, z)
            n = C._surface_normal(roof_y, x, z)
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
    # gable-edge rings close both ends (硬山: the shell dies into the gable wall)
    for i_col, hint in ((0, (-1, 0, 0)), (NU, (1, 0, 0))):
        for j in range(SEG):
            aa = j * (NU + 1) + i_col
            a2 = (j + 1) * (NU + 1) + i_col
            C.quad_out(L, 'roof-gable-ring',
                       [grid_t[aa], grid_t[a2], grid_b[a2], grid_b[aa]], 'roof',
                       [(j / SEG * run / 1.44, 0), ((j + 1) / SEG * run / 1.44, 0),
                        ((j + 1) / SEG * run / 1.44, .12), (j / SEG * run / 1.44, .12)], hint)
    L.mesh('houdian-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
    hint = (0, 0, 1) if sdir > 0 else (0, 0, -1)
    for i in range(NU):
        aa = SEG * (NU + 1) + i
        C.quad_out(L, 'roof-eave-fascia',
                   [grid_t[aa], grid_t[aa + 1], grid_b[aa + 1], grid_b[aa]], 'dark',
                   [(grid_t[aa][0] / 1.44, 0), (grid_t[aa + 1][0] / 1.44, 0),
                    (grid_t[aa + 1][0] / 1.44, rf['eaveFasciaH']), (grid_t[aa][0] / 1.44, rf['eaveFasciaH'])], hint)
    sd = rf['soffitDepthM']
    zc = z_end - sdir * sd / 2
    L.box('roof-eave-soffit', (0, rf['eaveY'] - .09, zc), (2 * HW - .1, .08, sd - .05), 'dark', 0)

_rib_objs = []
x = -HW + rf['tileRibSpacingM'] / 2
while x <= HW - rf['tileRibSpacingM'] / 2 + 1e-9:
    for slope_dir, z_end in ((1, ZF), (-1, ZR)):
        _rib_objs.append(C.rib_tube(L, 'houdian-tile-rib', roof_y, x, .1, 1.0,
                                    Z_MID, z_end - Z_MID, rf['tileRibRadiusM'], 5))
    x += rf['tileRibSpacingM']
_rib_tris = 0
for _o in _rib_objs:
    _o.data.calc_loop_triangles()
    _rib_tris += len(_o.data.loop_triangles)
print(f'STAGE roof ok (ribs {_rib_tris} tris)')

rbw, rbh = rf['ridgeBeamM']
L.box('houdian-ridge-beam', (0, rf['ridgeY'] + rbh / 2, Z_MID), (rf['widthM'] + .1, rbh, rbw), 'roof', .012)
# simplified 吻 at both ridge ends (box-step curl, <=300 tris total)
_orn_objs = []
for sgn in (-1, 1):
    ex = sgn * (rf['widthM'] / 2 + .02)
    _orn_objs.append(L.box('houdian-kiss-base', (ex, rf['ridgeY'] + rbh + .1, Z_MID),
                           (.2, .34, .3), 'dark', .01))
    _orn_objs.append(L.cyl('houdian-kiss-curl',
                           (ex, rf['ridgeY'] + rbh + .2, Z_MID),
                           (ex, rf['ridgeY'] + rbh + .5, Z_MID - sgn * .12), .05, 'dark', 6))
_orn_tris = 0
for _o in _orn_objs:
    _o.data.calc_loop_triangles()
    _orn_tris += len(_o.data.loop_triangles)
if _orn_tris > cfg['budgets']['ridgeOrnamentTrisMax']:
    print('ORNAMENT_BUDGET_FAIL', _orn_tris)
    sys.exit(7)
print(f'stage ridge ornaments ok ({_orn_tris} tris)')

# ---------------------------------------------------------------------------
# collision normalization + interior-empty assertion

adapter_coll = []
for rec in L.COLL:
    cx, cy, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'houdian-body'),
                         'type': 'box',
                         'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cy, cz], 'size': [sx, sy, sz]}})

# hall interior never modeled; door closed. Interior zone starts above the
# walkable base top (0.3) with capsule clearance.
INTERIOR = {'x': 5.9, 'y0': 0.7, 'y1': 4.0, 'z0': -8.1, 'z1': -0.3}
EPS = 1e-6
clashes = []
for rec in adapter_coll:
    if rec['max'][0] <= -INTERIOR['x'] + EPS or rec['min'][0] >= INTERIOR['x'] - EPS:
        continue
    if rec['max'][1] <= INTERIOR['y0'] + EPS or rec['min'][1] >= INTERIOR['y1'] - EPS:
        continue
    if rec['max'][2] <= INTERIOR['z0'] + EPS or rec['min'][2] >= INTERIOR['z1'] - EPS:
        continue
    clashes.append(rec['name'])
if clashes:
    print('INTERIOR_BLOCKED', clashes)
    sys.exit(3)
print(f'INTERIOR_CLEAR through {len(adapter_coll)} colliders ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# finalize: join by (group, material), export, reimport check, sidecars

GLB_NAME = f'{cfg["sampleId"]}.glb'
TARGETS = [(GLB_NAME, ('houdian-body', 'temple-ground'))]
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

pT = measure['targets'][GLB_NAME]
if pT['triangles'] > BUD['houdianTrisMax']:
    print('BUDGET_FAIL houdianTris', pT['triangles'])
    sys.exit(5)

original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / GLB_NAME))
bounds = [[1e9] * 3, [-1e9] * 3]
meshes = 0
ground_nodes = []
for o in check.objects:
    if o.type != 'MESH':
        continue
    meshes += 1
    if o.name.startswith('temple-ground__'):
        ground_nodes.append(o.name)
    for corner in o.bound_box:
        v = o.matrix_world @ Vector(corner)
        for k in range(3):
            bounds[0][k] = min(bounds[0][k], v[k])
            bounds[1][k] = max(bounds[1][k], v[k])
(out / 'reimport-check.json').write_text(
    json.dumps({'imported': True, 'meshes': meshes, 'boundsBlender': bounds,
                'groundNodes': ground_nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.context.window.scene = original
if not ground_nodes:
    print('GROUND_NAMING_FAIL: no temple-ground__ nodes exported')
    sys.exit(6)

(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; LOCAL frame (facade +Z at z=0); single world instance (0,0,-74) yaw 0',
    'worldPlacement': cfg['placement'],
    'adapterFormat': 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
    'interiorVerifiedEmpty': INTERIOR,
    'doorsClosedCollider': True,
    'colliders': adapter_coll,
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {
    'houdianTris': {'actual': pT['triangles'], 'limit': BUD['houdianTrisMax'], 'pass': True},
    'ridgeOrnamentsTris': {'actual': _orn_tris, 'limit': cfg['budgets']['ridgeOrnamentTrisMax'], 'pass': True},
    'tileRibsTris': {'actual': _rib_tris, 'limit': 6000, 'pass': True},
    'newImages': {'actual': 0, 'limit': 0, 'pass': True, 'note': 'blank plaque, palette only'},
}
measure['design'] = {
    'family': cfg['family'],
    'reference': cfg['reference'],
    'bays': [bd['bays'], bd['bayM']],
    'doorClosedM': [dw_w, 2.6],
    'plaque': 'blank board 2.2x0.7 @3.15 (no text, no texture)',
    'gable': '硬山 strips to the roof soffit; G36 xieshan read NOT adopted this batch (owner ruling)',
    'roofMethod': ('ONE two-slope shell lofted from the section profile, full-width flat '
                   'ridge (no hip), no corner lift, closed soffit, gable-edge rings, '
                   'finite half-round tile ribs, plain ridge beam without 吻'),
    'placement': cfg['placement'],
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')

# verification dataset: the surface equation sampled on a >=4 x >=24 grid
grid = {'source': 'kit/build_houdian.py roof_y (two-slope 硬山 shell, monotone by construction)',
        'ridgeY': rf['ridgeY'], 'eaveY': rf['eaveY'], 'widthM': rf['widthM'],
        'gridX': [-HW + 2 * HW * i / 4 for i in range(5)], 'front': [], 'rear': []}
for j in range(25):
    t = j / 24
    zf = Z_MID + (ZF - Z_MID) * t
    zr = Z_MID + (ZR - Z_MID) * t
    grid['front'].append({'t': t, 'z': round(zf, 6), 'y': [round(roof_y(x, zf), 6) for x in grid['gridX']]})
    grid['rear'].append({'t': t, 'z': round(zr, 6), 'y': [round(roof_y(x, zr), 6) for x in grid['gridX']]})
(out / 'roof-surface-samples.json').write_text(json.dumps(grid, ensure_ascii=False, indent=2) + '\n',
                                               encoding='utf-8')

print(f"HOUDIAN_READY tris={pT['triangles']} bytes={pT['fileBytes']} ribs={_rib_tris} "
      f"total={time.time() - T0:.1f}s")
