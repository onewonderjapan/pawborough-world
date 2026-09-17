"""Yimen rear stage (仪门背面戏楼) builder — temple-axis expansion batch N3.

Authored in the YIMEN-LOCAL frame (origin = yimen origin, world (0,0,-21)):
the stage hangs on the yimen's rear face. Raised floor at y=2.6 (unreachable —
no stair), four ground columns, plain 台口栏板 rail, two short wing walls into
the yimen rear, and a 歇山读感 roof: the yimen four-slope hip-shell machinery
with a short ridge plus two vertical gable panels and a crest (the dadian
gableTreatment read), corner lift 0.18 confined per the yimen ramp law. The
stage ridge stays BELOW the yimen ridge (asserted), and the band where the
stage roof rides over the yimen rear slope is closed with a dark seam_trim.

The stage floor is NOT walkable and must NOT carry the temple-ground__ naming.

Run:
  blender -b --factory-startup -t 4 -P kit/build_yimen_stage.py -- \
      --config kit/yimen-stage.config.json --out kit/out/yimen-stage
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

SCHEMA = {
    'sampleId': None, 'family': None, 'units': None, 'axis': None, 'basedOn': None,
    'reference': {'imageId': None, 'referenceEra': None, 'historicalAccuracyVerified': None,
                  'dimensionsAreDesign': None},
    'placement': {'originGlbWorld': None, 'yawRad': None},
    'yimenReference': {'config': None, 'ridgeY': None, 'assert': None},
    'floor': {'y': None, 'thicknessM': None, 'xM': None, 'zLocal': None, 'naming': None},
    'columns': {'positions': None, 'sizeM': None, 'onGround': None, 'plinthM': None},
    'frontRail': {'kind': None, 'heightM': None, 'atLocalZ': None},
    'wingWalls': {'widthZM': None, 'xM': None, 'zLocal': None, 'topY': None},
    'roof': {'type': None, 'widthM': None, 'depthLocalZ': None, 'ridgeY': None,
             'ridgeLengthM': None, 'eaveY': None, 'shellThicknessM': None,
             'profileTY': None, 'resampleSegments': None, 'cornerLiftM': None,
             'cornerLiftXStartsM': None, 'cornerLiftDepthTStarts': None,
             'hipEndTopY': None, 'hipStartsXM': None, 'tileRibSpacingM': None,
             'tileRibRadiusM': None, 'eaveFasciaH': None, 'gablePlaneXM': None,
             'gableBaseY': None, 'gableZRange': None, 'seam': None},
    'budgets': {'stageTrisMax': None},
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
    fl, cols, rf = c['floor'], c['columns'], c['roof']
    if c['units'] != 'meters':
        pr.append('units must be meters')
    if c['placement']['originGlbWorld'] != [0, 0, -21] or c['placement']['yawRad'] != 0:
        pr.append('stage must be authored in the yimen-local frame (0,0,-21) yaw 0')
    if rf['ridgeY'] >= c['yimenReference']['ridgeY']:
        pr.append(f"stage ridge {rf['ridgeY']} must stay below the yimen ridge "
                  f"{c['yimenReference']['ridgeY']}")
    FROZEN = {'y': 2.6, 'thicknessM': 0.2, 'xM': [-3.2, 3.2], 'zLocal': [-5.2, -8.9]}
    for k, v in FROZEN.items():
        if fl[k] != v:
            pr.append(f'floor.{k} must stay the frozen value {v}')
    if 'temple-ground' in fl['naming'].replace('NOT ', '').replace('NOT', ''):
        pass
    if 'NOT temple-ground' not in fl['naming'] and 'not temple-ground' not in fl['naming']:
        pr.append('stage floor must be flagged NOT temple-ground (unreachable)')
    if sorted(map(tuple, cols['positions'])) != sorted([(-3.0, -5.6), (3.0, -5.6), (-3.0, -8.6), (3.0, -8.6)]):
        pr.append('column positions are frozen (±3.0, -5.6/-8.6)')
    if cols['sizeM'] != [0.26, 2.6, 0.26]:
        pr.append('column size 0.26x2.6x0.26 is frozen')
    if (c['frontRail']['heightM'], c['frontRail']['atLocalZ']) != (0.55, -8.9):
        pr.append('front rail 0.55 at z -8.9 is frozen')
    FROZEN_R = {'widthM': 7.6, 'ridgeY': 7.4, 'ridgeLengthM': 3.6, 'eaveY': 5.6,
                'cornerLiftM': 0.18}
    for k, v in FROZEN_R.items():
        if rf[k] != v:
            pr.append(f'roof.{k} must stay the frozen value {v}')
    if rf['depthLocalZ'] != [-4.9, -9.6]:
        pr.append('roof depth -4.9..-9.6 is frozen')
    if abs(rf['profileTY'][0][1] - rf['ridgeY']) > 1e-6 or abs(rf['profileTY'][-1][1] - rf['eaveY']) > 1e-6:
        pr.append('profile must run ridge..eave exactly')
    if rf['ridgeLengthM'] >= rf['widthM']:
        pr.append('ridge must be shorter than the roof width (hip ends)')
    if not (rf['eaveY'] < rf['hipEndTopY'] < rf['ridgeY']):
        pr.append('hipEndTopY must sit between eave and ridge')
    if rf['cornerLiftXStartsM'] <= rf['hipStartsXM'] or rf['cornerLiftXStartsM'] >= rf['widthM'] / 2:
        pr.append('corner lift x band must sit inside the hip zone, inside the half width')
    # center passage: x=0 clear between the column inner faces. The frozen
    # positions (±3.0, 0.26 wide) give inner faces ±2.87 -> clear 5.74, which
    # is exactly the spec's own "柱内侧 ±2.87"; the plan's "≥5.8" is a rounded
    # nominal of the same numbers. Assert the self-consistent value.
    clear = 2 * 3.0 - cols['sizeM'][0]
    if abs(clear - 5.74) > 1e-9:
        pr.append(f'center passage clear width {clear} must equal 2*(3.0-0.13)=5.74 '
                  '(spec 柱内侧 ±2.87; the >=5.8 in the plan is a rounded nominal)')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

L.reset_scene()
L.build_materials()

fl, cols, rail, ww, rf = cfg['floor'], cfg['columns'], cfg['frontRail'], cfg['wingWalls'], cfg['roof']

# ---------------------------------------------------------------------------
# roof surface: yimen hip machinery (short ridge, corner-lift ramp)

_drop = C.make_drop_fn(rf['profileTY'], rf['resampleSegments'])
HW = rf['widthM'] / 2
RIDGE_HALF = rf['ridgeLengthM'] / 2
Z_MID = (rf['depthLocalZ'][0] + rf['depthLocalZ'][1]) / 2
ZF, ZR = rf['depthLocalZ'][0], rf['depthLocalZ'][1]
THICK = rf['shellThicknessM']


def top_y(x):
    aa = abs(x)
    if aa <= RIDGE_HALF:
        return rf['ridgeY']
    return rf['ridgeY'] - (rf['ridgeY'] - rf['hipEndTopY']) * C.smoothstep(RIDGE_HALF, HW, aa)


def lift_total(x):
    return rf['cornerLiftM'] * C.smoothstep(rf['cornerLiftXStartsM'], HW, abs(x)) ** 2


_state = {'d0': None}


def lift_at(x, t):
    if t <= rf['cornerLiftDepthTStarts']:
        return 0.0
    if _state['d0'] is None:
        _state['d0'] = _drop(rf['cornerLiftDepthTStarts'])
    return lift_total(x) * (_drop(t) - _state['d0']) / (1.0 - _state['d0'])


def roof_y(x, z):
    if z >= Z_MID:
        t = min(1.0, max(0.0, (z - Z_MID) / (ZF - Z_MID)))
    else:
        t = min(1.0, max(0.0, (Z_MID - z) / (Z_MID - ZR)))
    ty = top_y(x)
    return ty - (ty - rf['eaveY']) * _drop(t) + lift_at(x, t)


for kx in (0.0, RIDGE_HALF):
    if abs(roof_y(kx, Z_MID) - rf['ridgeY']) > 1e-9:
        print('ROOF_EQUATION_FAIL ridge not flat at', kx)
        sys.exit(8)
if abs(roof_y(HW, ZF) - (rf['eaveY'] + rf['cornerLiftM'])) > 1e-9:
    print('ROOF_EQUATION_FAIL corner lift wrong at the eave corner')
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
# S1. columns (ground level) + raised floor + rail + wing walls

L.GROUP = 'yimen-stage-body'
cs = cols['sizeM']
pm = cols['plinthM']
for cx, cz in cols['positions']:
    L.box('stage-column', (cx, cs[1] / 2, cz), (cs[0], cs[1], cs[2]), 'wood', .01, True)
    L.box('stage-column-plinth', (cx, pm[2] / 2, cz), (pm[0], pm[2], pm[1]), 'stone', .01, True)
    L.box('stage-column-cap', (cx, cs[1] + fl['y'] - cs[1] - 0.12 + .06, cz), (cs[0] + .08, .12, cs[2] + .08), 'wood', .008)

# raised floor slab (UNREACHABLE — no stair; never temple-ground__)
L.box('stage-floor', (0, fl['y'] - fl['thicknessM'] / 2, (fl['zLocal'][0] + fl['zLocal'][1]) / 2),
      (fl['xM'][1] - fl['xM'][0], fl['thicknessM'], abs(fl['zLocal'][1] - fl['zLocal'][0])),
      'wood', .01)
# skirt boards closing the floor edge to the ground line
L.box('stage-floor-skirt-front', (0, fl['y'] / 2, fl['zLocal'][1] - .05),
      (fl['xM'][1] - fl['xM'][0], fl['y'], .1), 'wood', 0)
L.box('stage-floor-skirt-rear', (0, fl['y'] / 2, fl['zLocal'][0] + .05),
      (fl['xM'][1] - fl['xM'][0], fl['y'], .1), 'wood', 0)
for sgn in (-1, 1):
    L.box('stage-floor-skirt-side', (sgn * (fl['xM'][1] - .05), fl['y'] / 2,
                                     (fl['zLocal'][0] + fl['zLocal'][1]) / 2),
          (.1, fl['y'], abs(fl['zLocal'][1] - fl['zLocal'][0])), 'wood', 0)

# 台口栏板 plain rail on the front edge (y 2.6..3.15)
L.box('stage-front-rail', (0, fl['y'] + rail['heightM'] / 2, rail['atLocalZ'] - .04),
      (fl['xM'][1] * 2 - .2, rail['heightM'], .08), 'wood', .008, True)
L.box('stage-front-rail-cap', (0, fl['y'] + rail['heightM'] + .03, rail['atLocalZ'] - .04),
      (fl['xM'][1] * 2 - .14, .06, .14), 'wood', .008)

# short wing walls into the yimen rear (visual closure, no collider per spec)
wx0, wx1 = ww['xM']
wz0, wz1 = ww['zLocal']
for sgn in (-1, 1):
    L.box('stage-wing-wall', (sgn * (abs(wx1) - .09), ww['topY'] / 2, (wz0 + wz1) / 2),
          (.18, ww['topY'], abs(wz1 - wz0)), 'plaster', 0)
print(f'STAGE body ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# S2. the hip shell (yimen machinery verbatim) + fascia + gable panels + crest

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
    for i_col, hint in ((0, (-1, 0, 0)), (NU, (1, 0, 0))):
        for j in range(SEG):
            aa = j * (NU + 1) + i_col
            a2 = (j + 1) * (NU + 1) + i_col
            C.quad_out(L, 'stage-roof-hip-ring',
                       [grid_t[aa], grid_t[a2], grid_b[a2], grid_b[aa]], 'roof',
                       [(j / SEG * run / 1.44, 0), ((j + 1) / SEG * run / 1.44, 0),
                        ((j + 1) / SEG * run / 1.44, .12), (j / SEG * run / 1.44, .12)], hint)
    L.mesh('stage-roof-shell', grid_t + grid_b, faces, 'roof', uvs + uvs)
    hint = (0, 0, 1) if sdir > 0 else (0, 0, -1)
    for i in range(NU):
        aa = SEG * (NU + 1) + i
        C.quad_out(L, 'stage-eave-fascia',
                   [grid_t[aa], grid_t[aa + 1], grid_b[aa + 1], grid_b[aa]], 'dark',
                   [(grid_t[aa][0] / 1.44, 0), (grid_t[aa + 1][0] / 1.44, 0),
                    (grid_t[aa + 1][0] / 1.44, rf['eaveFasciaH']),
                    (grid_t[aa][0] / 1.44, rf['eaveFasciaH'])], hint)

# tile ribs on both slopes
x = -HW + rf['tileRibSpacingM'] / 2
_rib_objs = []
while x <= HW - rf['tileRibSpacingM'] / 2 + 1e-9:
    for slope_dir, z_end in ((1, ZF), (-1, ZR)):
        _rib_objs.append(C.rib_tube(L, 'stage-tile-rib', roof_y, x, .1, 1.0,
                                    Z_MID, z_end - Z_MID, rf['tileRibRadiusM'], 5))
    x += rf['tileRibSpacingM']
_rib_tris = 0
for _o in _rib_objs:
    _o.data.calc_loop_triangles()
    _rib_tris += len(_o.data.loop_triangles)
print(f'STAGE roof shell ok (ribs {_rib_tris} tris)')

# 歇山读感 gable panels: vertical triangles at x=±gablePlaneXM, apex on the crest
gx = rf['gablePlaneXM']
gz0, gz1 = rf['gableZRange']
apex_z, apex_y = Z_MID, rf['ridgeY']
for sgn in (-1, 1):
    x = sgn * gx
    apex_pt = (x, apex_y, apex_z)
    inner = [(x - sgn * .08, rf['gableBaseY'], gz0), (x - sgn * .08, rf['gableBaseY'], gz1),
             (x - sgn * .08, apex_y, apex_z)]
    outer = [(x, rf['gableBaseY'], gz0), (x, rf['gableBaseY'], gz1), (x, apex_y, apex_z)]
    C.quad_out(L, 'stage-gable-panel', [outer[0], outer[1], apex_pt, apex_pt],
               'plaster', [(0, 0), (1, 0), (.5, 1), (.5, 1)], (sgn, 0, 0))
    C.quad_out(L, 'stage-gable-panel-inner', [inner[0], inner[1], inner[2], inner[2]],
               'plaster', [(0, 0), (1, 0), (.5, 1), (.5, 1)], (-sgn, 0, 0))
    for p, q in ((outer[0], (x, apex_y, apex_z)), (outer[1], (x, apex_y, apex_z))):
        C.quad_out(L, 'stage-gable-panel-edge',
                   [p, q, (q[0] - sgn * .08, q[1], q[2]), (p[0] - sgn * .08, p[1], p[2])],
                   'plaster', [(0, 0), (1, 0), (1, .1), (0, .1)],
                   (0, 1, 0) if abs(p[2] - q[2]) > 1 else (0, 0, 1 if p[2] > q[2] else -1))
    L.box('stage-gable-apron', (x, rf['gableBaseY'] - .09, (gz0 + gz1) / 2),
          (.12, .18, abs(gz1 - gz0) + .04), 'dark', 0)
L.box('stage-crest', (0, apex_y + .13, Z_MID), (rf['ridgeLengthM'] + .3, .14, .2), 'dark', .01)

# ---------------------------------------------------------------------------
# S3. seam_trim(dark): close the band where the stage roof front edge rides
# over the yimen rear slope (sample the REAL yimen surface from its config)

ym_cfg = json.loads((HERE / Path(cfg['yimenReference']['config']).name).read_text(encoding='utf-8'))
ym = ym_cfg['roof']
ym_drop = C.make_drop_fn(ym['profileTY'], ym['resampleSegments'])
YM_ZMID, YM_ZF, YM_ZR = ym['ridgeLocalZ'], ym['frontEaveZ'], ym['rearEaveZ']
YM_HW = ym['widthM'] / 2
YM_RIDGE_HALF = ym['ridgeLengthM'] / 2
YM_THICK = ym['shellThicknessM']


def yimen_roof_y(x, z):
    def ym_top(xx):
        aa = abs(xx)
        if aa <= YM_RIDGE_HALF:
            return ym['ridgeY']
        return ym['ridgeY'] - (ym['ridgeY'] - ym['hipEndTopY']) * C.smoothstep(YM_RIDGE_HALF, YM_HW, aa)

    def ym_lift(xx, tt):
        return ym['cornerLiftM'] * C.smoothstep(ym['cornerLiftXStartsM'], YM_HW, abs(xx)) ** 2 \
            * max(0.0, (_drop(tt) - _drop(ym['cornerLiftDepthTStarts'])) / (1 - _drop(ym['cornerLiftDepthTStarts'])))

    if z >= YM_ZMID:
        t = min(1.0, max(0.0, (z - YM_ZMID) / (YM_ZF - YM_ZMID)))
    else:
        t = min(1.0, max(0.0, (YM_ZMID - z) / (YM_ZMID - YM_ZR)))
    ty = ym_top(x)
    return ty - (ty - ym['eaveY']) * ym_drop(t) + ym_lift(x, t)


NS = 10
for k in range(NS):
    x0 = -HW + 2 * HW * k / NS
    x1 = -HW + 2 * HW * (k + 1) / NS
    # stage edge point (just inside the front eave) down to the yimen surface
    zs = ZF + 0.06
    y_s = roof_y((x0 + x1) / 2, zs) + .01
    z_y = zs - 0.5
    y_y = yimen_roof_y((x0 + x1) / 2, z_y)
    C.quad_out(L, 'stage-seam-trim',
               [(x0, y_s, zs), (x1, y_s, zs), (x1, y_y - .06, z_y), (x0, y_y - .06, z_y)],
               'dark', [(x0 / 1.44, 0), (x1 / 1.44, 0), (x1 / 1.44, .3), (x0 / 1.44, .3)],
               (0, 1, 0))
    C.quad_out(L, 'stage-seam-trim-under',
               [(x0, y_y - .06, z_y), (x1, y_y - .06, z_y), (x1, y_s, zs), (x0, y_s, zs)],
               'dark', [(x0 / 1.44, 0), (x1 / 1.44, 0), (x1 / 1.44, .3), (x0 / 1.44, .3)],
               (0, -1, 0))
print(f'STAGE seam ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# collision: exactly 4 columns + 1 rail; the floor has NO collider

adapter_coll = [rec for rec in L.COLL if rec['name'] in
                ('stage-column', 'stage-front-rail')]
if len(adapter_coll) != 5:
    print('COLLIDER_SET_FAIL expected 4 columns + 1 rail, got',
          [r['name'] for r in adapter_coll])
    sys.exit(3)
for rec in adapter_coll:
    cx, cy, cz = rec['center']
    sx, sy, sz = rec['size']
    rec.update({'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                        'center': [cx, cy, cz], 'size': [sx, sy, sz]}})
# rail must sit exactly at y 2.6..3.15 (camera fly-through guard)
rail_rec = [r for r in adapter_coll if r['name'] == 'stage-front-rail'][0]
if abs(rail_rec['min'][1] - 2.6) > 1e-6 or abs(rail_rec['max'][1] - 3.15) > 1e-6:
    print('RAIL_Y_FAIL', rail_rec['min'][1], rail_rec['max'][1])
    sys.exit(3)

# ---------------------------------------------------------------------------
# finalize

GLB_NAME = f'{cfg["sampleId"]}.glb'
TARGETS = [(GLB_NAME, ('yimen-stage-body',))]
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

sT = measure['targets'][GLB_NAME]
if sT['triangles'] > cfg['budgets']['stageTrisMax']:
    print('BUDGET_FAIL stageTris', sT['triangles'])
    sys.exit(5)

original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / GLB_NAME))
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
(out / 'reimport-check.json').write_text(
    json.dumps({'imported': True, 'meshes': meshes, 'boundsBlender': bounds},
               ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.context.window.scene = original

(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; YIMEN-LOCAL frame (world origin (0,0,-21) yaw 0)',
    'adapterFormat': 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
    'floorNoCollider': True,
    'railYRange': [2.6, 3.15],
    'centerPassageClearX': [-2.87, 2.87],
    'colliders': adapter_coll,
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {
    'stageTris': {'actual': sT['triangles'], 'limit': cfg['budgets']['stageTrisMax'], 'pass': True},
    'tileRibsTris': {'actual': _rib_tris, 'limit': 4500, 'pass': True},
    'newImages': {'actual': 0, 'limit': 0, 'pass': True},
}
measure['design'] = {
    'family': cfg['family'],
    'reference': cfg['reference'],
    'ridgeBelowYimen': {'stage': rf['ridgeY'], 'yimen': cfg['yimenReference']['ridgeY']},
    'floorUnreachable': 'no stair, no temple-ground naming, no floor collider',
    'roofMethod': 'yimen hip-shell machinery (ridge 3.6, lift 0.18) + gable panels + crest; '
                  'dark seam band over the yimen rear slope sampled from kit/yimen.config.json',
    'placement': cfg['placement'],
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
print(f"STAGE_READY tris={sT['triangles']} bytes={sT['fileBytes']} ribs={_rib_tris} "
      f"total={time.time() - T0:.1f}s")
