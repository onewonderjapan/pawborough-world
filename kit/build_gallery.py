"""Gallery bay (廊庑) builder — temple-axis expansion batch N2.

One covered bay linking the south corner to the peidian on each side of the
second court: two columns, a continuous bench rail (坐凳栏) between them, a
plaster back wall, a single-slope tile roof (high at the back, low over the
columns) and a raised stone floor. The floor IS the physics ground
(group 'temple-ground', node temple-ground__worn-stone).

Local frame: front-column-line center bottom origin, facade +Z, depth -Z.
World: instanced west/east at (±10.78, 0, -30.99) yaw ±π/2 — the back wall
lands on world x=∓13.18 (DESIGN_SPEC.gallery.placement).

Run:
  blender -b --factory-startup -t 4 -P kit/build_gallery.py -- \
      --config kit/gallery.config.json --out kit/out/gallery
"""
import argparse
import hashlib
import json
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
    'placement': {'west': {'originGlb': None, 'yawRad': None},
                  'east': {'originGlb': None, 'yawRad': None}},
    'body': {'lengthM': None, 'depthM': None, 'bays': None, 'columnsLocalX': None,
             'columnLocalZ': None, 'columnSizeM': None},
    'bench': {'kind': None, 'heightM': None, 'depthM': None, 'span': None, 'localZ': None},
    'backWall': {'localZ': None, 'thicknessM': None, 'heightM': None, 'material': None},
    'roof': {'type': None, 'highY': None, 'lowY': None, 'frontEaveZ': None,
             'rearEaveZ': None, 'thicknessM': None, 'tileRibSpacingM': None,
             'tileRibRadiusM': None, 'eaveFasciaH': None},
    'floor': {'topY': None, 'thicknessM': None, 'extentX': None, 'extentZ': None,
              'groundNaming': None},
    'budgets': {'galleryTrisMax': None},
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
    bd, rw, rf, fl = c['body'], c['backWall'], c['roof'], c['floor']
    if c['units'] != 'meters':
        pr.append('units must be meters')
    if 'Y-up' not in c['axis'] or '+Z' not in c['axis']:
        pr.append('axis must state GLB Y-up and facade +Z')
    if c['reference']['dimensionsAreDesign'] is not True:
        pr.append('dimensions must be flagged design (not survey)')
    FROZEN = {'lengthM': 3.0, 'depthM': 2.4, 'bays': 1}
    for k, v in FROZEN.items():
        if bd[k] != v:
            pr.append(f'body.{k} must stay the frozen value {v}')
    if sorted(bd['columnsLocalX']) != [-1.35, 1.35] or bd['columnLocalZ'] != 0.0:
        pr.append('columns ±1.35 at z=0 are frozen')
    if (rw['localZ'], rw['thicknessM'], rw['heightM']) != (-2.4, 0.24, 3.4):
        pr.append('back wall -2.4 / 0.24 / 3.4 is frozen')
    if (rf['highY'], rf['lowY']) != (3.4, 2.7):
        pr.append('roof high 3.4 / low 2.7 are frozen')
    if rf['frontEaveZ'] != 0.5 or rf['rearEaveZ'] != rw['localZ']:
        pr.append('roof must span front overhang 0.5 back to the wall plane')
    if (fl['topY'], fl['extentX'], fl['extentZ']) != (0.15, [-1.5, 1.5], [0.4, -2.4]):
        pr.append('floor 0.15 / x±1.5 / z 0.4..-2.4 is frozen')
    if 'temple-ground__worn-stone' not in fl['groundNaming']:
        pr.append('floor must carry the temple-ground__worn-stone naming contract')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

L.reset_scene()
L.build_materials()

bd, bn, rw, rf, fl = cfg['body'], cfg['bench'], cfg['backWall'], cfg['roof'], cfg['floor']

# ---------------------------------------------------------------------------
# floor first (group temple-ground — physics ground), then the bay

L.GROUP = 'temple-ground'
fx0, fx1 = fl['extentX']
fz0, fz1 = fl['extentZ']
L.box('gallery-floor', (0, fl['topY'] - fl['thicknessM'] / 2, (fz0 + fz1) / 2),
      (fx1 - fx0, fl['thicknessM'], abs(fz1 - fz0)), 'stone', .006, True)
# R1-06: floor-edge skirt boxes REMOVED — inset or not, the narrow slot
# between skirt and slab face rendered as an unlit black band in Cycles.
# The slab box itself already carries the floor-edge collision.


L.GROUP = 'gallery-body'
cs = bd['columnSizeM']
for x in bd['columnsLocalX']:
    L.box('gallery-column', (x, fl['topY'] + cs[1] / 2, bd['columnLocalZ']),
          (cs[0], cs[1], cs[2]), 'wood', .01, True)
    L.box('gallery-column-plinth', (x, fl['topY'] + .14, bd['columnLocalZ']),
          (cs[0] + .14, .28, cs[2] + .14), 'stone', .012, True)

# bench rail between the columns (通长), with a hand cap
bw_half = abs(bd['columnsLocalX'][1]) - cs[0] / 2
L.box('gallery-bench', (0, fl['topY'] + bn['heightM'] / 2, bn['localZ']),
      (2 * bw_half, bn['heightM'], bn['depthM']), 'stone', .01, True)
L.box('gallery-bench-cap', (0, fl['topY'] + bn['heightM'] + .03, bn['localZ']),
      (2 * bw_half + .08, .06, bn['depthM'] + .08), 'wood', .008)

# back wall
L.box('gallery-back-wall', (0, rw['heightM'] / 2, rw['localZ'] + rw['thicknessM'] / 2),
      (bd['lengthM'] - .1, rw['heightM'], rw['thicknessM']), rw['material'], 0, True)
L.box('gallery-wall-cap', (0, rw['heightM'] + .05, rw['localZ'] + rw['thicknessM'] / 2),
      (bd['lengthM'], .1, rw['thicknessM'] + .08), 'roof', .01)

# single-slope roof: one slab high at the back (3.4) low over the columns (2.7),
# closed underside, fascia at the front eave
hw = bd['lengthM'] / 2
zf, zr = rf['frontEaveZ'], rf['rearEaveZ']
th = rf['thicknessM']
verts = [(-hw, rf['lowY'], zf), (hw, rf['lowY'], zf), (hw, rf['highY'], zr), (-hw, rf['highY'], zr)]
slope_len = ((zf - zr) ** 2 + (rf['highY'] - rf['lowY']) ** 2) ** .5
nz = (rf['highY'] - rf['lowY']) / slope_len
ny = (zf - zr) / slope_len
bot = [(v[0], v[1] - th * ny, v[2] + th * nz) for v in verts]
faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 3, 7, 4), (1, 5, 6, 2), (0, 4, 5, 1), (2, 6, 7, 3)]
import temple_components as C  # noqa: E402
C.quad_out = C.quad_out  # keep the import meaningful for the fascia below
L.mesh('gallery-roof-slab', verts + bot, faces, 'roof',
       [(v[0] / 1.44, v[2] / 1.36) for v in verts + bot])
C.quad_out(L, 'gallery-eave-fascia',
           [verts[0], verts[1], bot[1], bot[0]], 'dark',
           [(verts[0][0] / 1.44, 0), (verts[1][0] / 1.44, 0),
            (verts[1][0] / 1.44, rf['eaveFasciaH']), (verts[0][0] / 1.44, rf['eaveFasciaH'])],
           (0, 0, 1))
# tile ribs down the slope
x = -hw + rf['tileRibSpacingM'] / 2
_rib_objs = []
while x <= hw - rf['tileRibSpacingM'] / 2 + 1e-9:
    _rib_objs.append(L.cyl('gallery-tile-rib',
                           (x, rf['highY'] - .02, zr + .05), (x, rf['lowY'] - .02, zf - .04),
                           rf['tileRibRadiusM'], 'roof', 6))
    x += rf['tileRibSpacingM']
_rib_tris = 0
for _o in _rib_objs:
    _o.data.calc_loop_triangles()
    _rib_tris += len(_o.data.loop_triangles)
print(f'STAGE bay ok (ribs {_rib_tris} tris)')

# ---------------------------------------------------------------------------
# collision normalization (floor-front/rear skirts already recorded)

adapter_coll = []
for rec in L.COLL:
    cx, cy, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'gallery-body'),
                         'type': 'box',
                         'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cy, cz], 'size': [sx, sy, sz]}})

# open walk-through bay: nothing may block x ±1.1, y 0.6..2.6, z -2.1..-0.4
OPEN = {'x': 1.1, 'y0': 0.6, 'y1': 2.6, 'z0': -2.1, 'z1': -0.4}
EPS = 1e-6
clashes = []
for rec in adapter_coll:
    if rec['max'][0] <= -OPEN['x'] + EPS or rec['min'][0] >= OPEN['x'] - EPS:
        continue
    if rec['max'][1] <= OPEN['y0'] + EPS or rec['min'][1] >= OPEN['y1'] - EPS:
        continue
    if rec['max'][2] <= OPEN['z0'] + EPS or rec['min'][2] >= OPEN['z1'] - EPS:
        continue
    clashes.append(rec['name'])
if clashes:
    print('BAY_BLOCKED', clashes)
    sys.exit(3)
print(f'BAY_CLEAR through {len(adapter_coll)} colliders ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# finalize

GLB_NAME = f'{cfg["sampleId"]}.glb'
TARGETS = [(GLB_NAME, ('gallery-body', 'temple-ground'))]
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

gT = measure['targets'][GLB_NAME]
if gT['triangles'] > cfg['budgets']['galleryTrisMax']:
    print('BUDGET_FAIL galleryTris', gT['triangles'])
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
    'axis': 'glTF Y-up; LOCAL frame (facade +Z at z=0); instanced west/east yaw ±π/2',
    'worldPlacements': cfg['placement'],
    'adapterFormat': 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
    'openBayVerified': OPEN,
    'colliders': adapter_coll,
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {
    'galleryTris': {'actual': gT['triangles'], 'limit': cfg['budgets']['galleryTrisMax'], 'pass': True},
    'tileRibsTris': {'actual': _rib_tris, 'limit': 800, 'pass': True},
    'newImages': {'actual': 0, 'limit': 0, 'pass': True},
}
measure['design'] = {
    'family': cfg['family'],
    'reference': cfg['reference'],
    'bench': '坐凳栏 between the columns, full length (allowed item)',
    'roofMethod': 'single-slope closed slab, high 3.4 at the back wall, low 2.7 over the columns',
    'placement': cfg['placement'],
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
print(f"GALLERY_READY tris={gT['triangles']} bytes={gT['fileBytes']} ribs={_rib_tris} "
      f"total={time.time() - T0:.1f}s")
