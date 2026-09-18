"""Third-court builder (N4) — temple-axis expansion batch.

World coordinates (authored in place, same convention as build_dadian_court):
  side passages   x +/-[10.78..16.4], z -39.1..-58.2, y 0 (walkable worn stone;
                  the 月台 platform skirt at x=+-12 stays visible on its west/east)
  dead pockets    x +/-[10.78..16.4], z -29.48..-39.1 — unreachable band behind
                  the galleries/peidian, paved anyway (fall-through guard)
  court3 floor    x +-16.4, z -58.2..-72.2 (path half 1.95 at y 0, fields -0.004)
  drains          (+-15, -60) and (+-15, -70)
  boundary walls  inner face x +-16.4, thickness 0.28, z -26.2..-84.0, h 2.9,
                  cap 3.12, wood posts every 3.5 m (dadian-court wall language)
  north closure   z -84.0, x +-16.4, h 3.4, cap 3.62 (sample terminal, NOT history)

All walkable meshes live in group 'temple-ground' (temple-ground__worn-stone).
No invisible planes. No burner in this court (DESIGN_SPEC: 无证据，不加).

Run:
  blender -b --factory-startup -t 4 -P kit/build_court3.py -- \
      --config kit/court3.config.json --out kit/out/court3
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

argv = sys.argv[sys.argv.index('--') + 1:]
sys.stdout.reconfigure(line_buffering=True)
p = argparse.ArgumentParser()
p.add_argument('--config', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
T0 = time.time()

SCHEMA = {
    'sampleId': None, 'units': None, 'axis': None, 'basedOn': None,
    'sidePassages': {'xM': None, 'zM': None, 'y': None},
    'deadPockets': {'xM': None, 'zM': None, 'y': None},
    'passageMouths': {'xHalfFrom': None, 'xTo': None, 'zM': None, 'y': None, 'note': None},
    'northStrip': {'xM': None, 'zM': None, 'y': None, 'note': None},
    'court3Floor': {'xM': None, 'zM': None, 'pathHalfWidthM': None, 'pathY': None,
                    'fieldY': None, 'slabThicknessM': None},
    'drains': None,
    'boundaryWall': {'innerX': None, 'thicknessM': None, 'heightM': None, 'capTopY': None,
                     'zM': None, 'postSpacingM': None, 'postSizeM': None},
    'northClosure': {'z': None, 'xM': None, 'heightM': None, 'capTopY': None,
                     'thicknessM': None},
    'budgets': {'court3TrisMax': None},
    'contextNotSurvey': None,
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
    bw, nc = c['boundaryWall'], c['northClosure']
    if c['units'] != 'meters':
        pr.append('units must be meters')
    if 'Y-up' not in c['axis']:
        pr.append('axis must state GLB Y-up')
    FROZEN = {
        ('sidePassages', 'zM'): [-39.1, -58.2],
        ('court3Floor', 'xM'): [-16.4, 16.4],
        ('court3Floor', 'zM'): [-58.2, -72.2],
        ('court3Floor', 'pathHalfWidthM'): 1.95,
        ('boundaryWall', 'innerX'): 16.4,
        ('boundaryWall', 'thicknessM'): 0.28,
        ('boundaryWall', 'heightM'): 2.9,
        ('boundaryWall', 'capTopY'): 3.12,
        ('boundaryWall', 'zM'): [-26.2, -84.0],
        ('northClosure', 'z'): -84.0,
        ('northClosure', 'heightM'): 3.4,
        ('northClosure', 'capTopY'): 3.62,
    }
    for (sec, k), v in FROZEN.items():
        if c[sec][k] != v:
            pr.append(f'{sec}.{k} must stay the frozen value {v}')
    if c['drains'] != [[-15.0, -60.0], [15.0, -60.0], [-15.0, -70.0], [15.0, -70.0]]:
        pr.append('drains are frozen at (±15, -60/-70)')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

L.reset_scene()
L.build_materials()

sp, dp, cf, bw, nc = cfg['sidePassages'], cfg['deadPockets'], cfg['court3Floor'], \
    cfg['boundaryWall'], cfg['northClosure']
slab = cf['slabThicknessM']

# ---------------------------------------------------------------------------
# ground (group temple-ground — these meshes ARE the physics ground)

L.GROUP = 'temple-ground'


def slab_box(name, x0, x1, z0, z1, y, th):
    L.box(name, ((x0 + x1) / 2, y - th / 2, (z0 + z1) / 2),
          (abs(x1 - x0), th, abs(z1 - z0)), 'paving', 0)


# side passages (walkable, y=0 — flush with the second-court ground)
[pxw0, pxw1], [pxe0, pxe1] = sp['xM']
pz0, pz1 = sp['zM']
slab_box('passage-w', min(pxw0, pxw1), max(pxw0, pxw1), pz0, pz1, sp['y'], slab)
slab_box('passage-e', min(pxe0, pxe1), max(pxe0, pxe1), pz0, pz1, sp['y'], slab)
# dead pockets behind the galleries/peidian (unreachable, paved as a guard)
dxw = dp['xM']
dz0, dz1 = dp['zM']
for sgn in (-1, 1):
    slab_box('dead-pocket', sgn * abs(dxw[0]), sgn * abs(dxw[1]), dz0, dz1, dp['y'], slab)
# passage mouths: the opening band floored from the stair edge to the court
# edge (required by the frozen route leg; design_inference fill)
for sgn in (-1, 1):
    xa, xb = sorted((sgn * cfg['passageMouths']['xHalfFrom'], sgn * cfg['passageMouths']['xTo']))
    slab_box('passage-mouth', xa, xb, cfg['passageMouths']['zM'][0], cfg['passageMouths']['zM'][1],
             cfg['passageMouths']['y'], slab)
# north strip behind the houdian (fall guard, like the dead pockets)
slab_box('north-strip', cfg['northStrip']['xM'][0], cfg['northStrip']['xM'][1],
         cfg['northStrip']['zM'][0], cfg['northStrip']['zM'][1], cfg['northStrip']['y'], slab)
# court3 floor: axial path + 4mm-low fields
half = cf['pathHalfWidthM'] + 0.05
fx0, fx1 = cf['xM']
fz0, fz1 = cf['zM']
L.box('court3-path-slab', (0, -slab / 2 + cf['pathY'], (fz0 + fz1) / 2),
      (2 * half, slab, abs(fz1 - fz0)), 'paving', 0)
for sgn in (-1, 1):
    L.box('court3-field-slab', (sgn * (half + fx1) / 2, -slab / 2 + cf['fieldY'], (fz0 + fz1) / 2),
          (fx1 - half, slab, abs(fz1 - fz0)), 'paving', 0)
# stone borders along the court edges
bwd = .24
for sgn in (-1, 1):
    L.box('court3-side-border', (sgn * (fx1 - bwd / 2), -slab / 2 + .008, (fz0 + fz1) / 2),
          (bwd, slab + .016, abs(fz1 - fz0)), 'stone', .006)
print(f'STAGE floors ok ({time.time() - T0:.1f}s)')

# drains (same language as the second court)
for dx, dz in cfg['drains']:
    L.box('drain-frame', (dx, -slab / 2 + .004, dz), (.62, slab + .008, .44), 'stone', .008)
    L.box('drain-pit', (dx, -slab / 2 - .018, dz), (.48, .07, .3), 'dark', 0)
    for k in range(5):
        L.cyl('drain-bar', (dx - .21 + .105 * k, .004, dz - .13),
              (dx - .21 + .105 * k, .004, dz + .13), .022, 'iron', 6)
print(f'STAGE drains ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# boundary walls + north closure (group court3-boundary; colliders on)

L.GROUP = 'court3-boundary'
wall_h = bw['heightM']
cap_y = bw['capTopY']
th = bw['thicknessM']
bz0, bz1 = bw['zM']


def boundary_wall(name, x0, x1, z0, z1, h=None, cap=None):
    x0, x1 = min(x0, x1), max(x0, x1)
    z0, z1 = min(z0, z1), max(z0, z1)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    hh = h or wall_h
    cc = cap or cap_y
    L.box(name, (cx, hh / 2, cz), (x1 - x0, hh, z1 - z0), 'stone', .01, True)
    L.box(name + '-cap', (cx, (hh + cc) / 2, cz), (x1 - x0 + .1, cc - hh + .06, z1 - z0 + .1), 'roof', .012)
    # wood posts every postSpacingM along the INNER face (courtyard side)
    length = z1 - z0
    n = int(round(length / bw['postSpacingM']))
    ps = bw['postSizeM']
    for k in range(1, n):
        pz = z0 + length * k / n
        post_x = (x0 + th + .06) if cx > 0 else (x1 - th - .06)
        L.box(name + '-post', (post_x, hh * .45, pz), (ps[0], hh * .9, ps[2]), 'wood', .006)


for sgn in (-1, 1):
    boundary_wall('boundary-wall', sgn * bw['innerX'], sgn * (bw['innerX'] + th), bz0, bz1)
boundary_wall('north-closure', nc['xM'][0], nc['xM'][1], nc['z'] - nc['thicknessM'] / 2,
              nc['z'] + nc['thicknessM'] / 2, nc['heightM'], nc['capTopY'])
print(f'STAGE walls ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# export

GLB_NAME = f'{cfg["sampleId"]}.glb'
TARGETS = [(GLB_NAME, ('temple-ground', 'court3-boundary'))]
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
           'axis': 'world GLB Y-up (court3 authored in place, no instance transform)',
           'bakedGlobalIllumination': False, 'referencePhotoTexturesUsed': False,
           'targets': {}, 'timings': {}}
for fname, groups in TARGETS:
    bpy.ops.object.select_all(action='DESELECT')
    sel = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') in groups:
            o.select_set(True)
            sel += 1
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

cT = measure['targets'][GLB_NAME]
if cT['triangles'] > cfg['budgets']['court3TrisMax']:
    print('BUDGET_FAIL court3Tris', cT['triangles'])
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

adapter_coll = []
for rec in L.COLL:
    cx, cyv, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'court3-boundary'),
                         'type': 'box',
                         'min': [cx - sx / 2, cyv - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cyv + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cyv, cz], 'size': [sx, sy, sz]}})
(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; WORLD records (court3 authored in place)',
    'colliders': adapter_coll,
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {'court3Tris': {'actual': cT['triangles'],
                                     'limit': cfg['budgets']['court3TrisMax'], 'pass': True}}
measure['design'] = {
    'contextNotSurvey': cfg['contextNotSurvey'],
    'sidePassages': sp, 'deadPockets': dp,
    'court3': {'x': cf['xM'], 'z': cf['zM'], 'pathHalf': cf['pathHalfWidthM']},
    'boundaryWall': 'inner x ±16.4, wood posts every 3.5m; NOT historical (sample terminal language)',
    'northClosure': 'z -84.0 sample terminal (非历史), replaces the removed -59.8 wall',
    'noBurner': 'DESIGN_SPEC: 无证据，不加',
    'groundSeams': 'passages y=0 flush with the second court; fields 4mm low',
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
print(f"COURT3_READY tris={cT['triangles']} bytes={cT['fileBytes']} total={time.time() - T0:.1f}s")
