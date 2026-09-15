"""Temple second-court builder (N4): the walled court between the yimen and
the dadian, the stone platform (月台) with its five-step stair, and the
bronze tripod burner — continuing the axis north from z=-29.2 to -59.8.

World coordinates (authored in place, NOT instanced):
  court floor    x +/-10.78, z -29.2 .. -39.4 (path half 1.95 at y=0,
                 side fields 4mm low — the entry-court seam rule)
  aprons         behind the yimen body, x 7.4..10.78, z -26.2..-29.2
  side walls     inner faces x +/-10.5, y 0..2.9 + coping to 3.12
  south returns  z -29.2 line, x 8.28..10.78 (tie into the entry landing)
  platform       x +/-12, z -41.0 .. -58.2, top y 0.85 (walkable)
  steps          5 x (0.17 riser, 0.32 tread), width 6, z -41.0..-39.4
                 (step TOPS are walkable temple-ground__worn-stone)
  north closure  z -59.8, x +/-13.4, h 3.4 — sample terminal, NOT history
  burner         bronze tripod ding on the axis at (0, 0, -34.5)
  drains         (+-9.8, -31.5) and (+-9.8, -38.5)

All walkable meshes live in group 'temple-ground' with the shared palette
materials ('stone' -> worn-stone, 'paving' -> paving-frontage) so the ground
naming contract (GROUND_NODE_RE) picks them up. No invisible planes.

Run:
  blender -b --factory-startup -t 4 -P kit/build_dadian_court.py -- \
      --config kit/dadian-court.config.json --out kit/out/dadian-court
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
    'floor': {'xM': None, 'zM': None, 'pathHalfWidthM': None, 'pathY': None, 'fieldY': None,
              'slabThicknessM': None},
    'apronsBehindYimen': {'xInnerM': None, 'zM': None, 'y': None},
    'sideWalls': {'innerX': None, 'thicknessM': None, 'heightM': None, 'capTopY': None, 'zM': None},
    'southReturns': {'z': None, 'xM': None, 'heightM': None, 'capTopY': None},
    'northClosure': {'z': None, 'thicknessM': None, 'xM': None, 'heightM': None, 'capTopY': None,
                     'returnStubDepthM': None, 'note': None},
    'platform': {'xM': None, 'zM': None, 'topY': None, 'skirtInsetM': None},
    'steps': {'count': None, 'riserM': None, 'treadM': None, 'widthM': None, 'zM': None,
              'cheekWidthM': None, 'walkabilityNote': None},
    'burner': {'centerGlb': None, 'plinthTiersM': None, 'vesselR': None, 'vesselH': None,
               'legR': None, 'legH': None, 'pawBlockM': None, 'handleTorusR': None,
               'handleTubeR': None, 'lidDiscsM': None, 'finialR': None, 'trisMax': None,
               'evidence': None, 'note': None},
    'drains': None,
    'budgets': {'courtTrisMax': None},
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
    fl, st = c['floor'], c['steps']
    if abs(st['count'] * st['riserM'] - c['platform']['topY']) > 1e-6:
        pr.append('steps count * riser must reach the platform top exactly')
    if abs(abs(st['zM'][1] - st['zM'][0]) - st['count'] * st['treadM']) > 1e-6:
        pr.append('steps z span must equal count * tread exactly')
    if not (fl['zM'][0] < fl['zM'][1] * -1 or True):
        pass
    if abs(fl['zM'][1] - st['zM'][1]) > 1e-6:
        pr.append('floor north edge must meet the first step face flush (z=-39.4)')
    if abs(c['sideWalls']['innerX'] + c['sideWalls']['thicknessM'] - fl['xM'][1]) > 1e-6:
        pr.append('side wall outer face must be flush with the floor edge')
    for dx, dz in c['drains']:
        if abs(fl['pathHalfWidthM'] - abs(dx)) < 0.5:
            pr.append(f'drain at x={dx} sits on the axial path')
    return pr


problems = validate(cfg)
if problems:
    print('CONFIG_INVALID', problems)
    sys.exit(2)
print(f'CONFIG_OK {cfg["sampleId"]} ({time.time() - T0:.1f}s)')

L.reset_scene()
L.build_materials()
L.M['bronze'] = L.mat('bronze', '6b4c30', .45, metal=.75)
L.META['bronze']['source'] = 'builder-local palette extension (DESIGN_SPEC.palette.newLocalMaterial)'

fl, sw, st, pf, bn = cfg['floor'], cfg['sideWalls'], cfg['steps'], cfg['platform'], cfg['burner']
slab = fl['slabThicknessM']
path_half = fl['pathHalfWidthM'] + 0.05
z_s, z_n = fl['zM'][0], fl['zM'][1]          # -29.2, -39.4
cap_y = sw['capTopY']
wall_h = sw['heightM']
th = sw['thicknessM']

# ---------------------------------------------------------------------------
# ground (group temple-ground — these meshes ARE the physics ground)

L.GROUP = 'temple-ground'
# central axial path: yimen rear -> through the court -> the stair foot
L.box('court2-path-slab', (0, -slab / 2, (z_s + z_n) / 2), (2 * path_half, slab, abs(z_n - z_s)), 'paving', 0)
# side fields, 4mm below the path (entry-court seam rule)
for sgn in (-1, 1):
    L.box('court2-field-slab', (sgn * (path_half + fl['xM'][1]) / 2, -slab / 2 + fl['fieldY'],
                                (z_s + z_n) / 2),
          (fl['xM'][1] - path_half, slab, abs(z_n - z_s)), 'paving', 0)
# aprons behind the yimen body (x beyond the gate footprint, z -26.2..-29.2)
for sgn in (-1, 1):
    L.box('court2-apron', (sgn * (cfg['apronsBehindYimen']['xInnerM'] + fl['xM'][1]) / 2,
                           -slab / 2 + fl['fieldY'],
                           (cfg['apronsBehindYimen']['zM'][0] + cfg['apronsBehindYimen']['zM'][1]) / 2),
          (fl['xM'][1] - cfg['apronsBehindYimen']['xInnerM'], slab,
           abs(cfg['apronsBehindYimen']['zM'][1] - cfg['apronsBehindYimen']['zM'][0])), 'paving', 0)
# stone borders along the side walls and the court south edge
bw = .24
for sgn in (-1, 1):
    L.box('court2-side-border', (sgn * (fl['xM'][1] - bw / 2), -slab / 2 + .008, (z_s + z_n) / 2),
          (bw, slab + .016, abs(z_n - z_s)), 'stone', .006)
L.box('court2-south-border', (0, -slab / 2 + .008, z_s - bw / 2), (2 * fl['xM'][1], slab + .016, bw), 'stone', .006)
print(f'STAGE floor ok ({time.time() - T0:.1f}s)')

# stair + platform (walkable: step TOPS and platform TOP are worn-stone)
n, rise, tread = st['count'], st['riserM'], st['treadM']
z_foot = st['zM'][1]                          # -39.4
for k in range(n):
    top = (k + 1) * rise
    z_c = z_foot - (k + 0.5) * tread
    L.box('stair-step', (0, top - rise / 2, z_c), (st['widthM'], rise, tread), 'stone', .006, True)
# cheek walls flanking the stair (worn-stone, simple boxes)
for sgn in (-1, 1):
    L.box('stair-cheek', (sgn * (st['widthM'] / 2 + st['cheekWidthM'] / 2), pf['topY'] / 2,
                          (st['zM'][0] + st['zM'][1]) / 2),
          (st['cheekWidthM'], pf['topY'], abs(st['zM'][1] - st['zM'][0]) + .1), 'stone', .008, True)
# platform: top slab (walkable) + skirt faces down to grade
pz0, pz1 = pf['zM'][0], pf['zM'][1]           # -58.2, -41.0
L.box('platform-top', (0, pf['topY'] - slab / 2, (pz0 + pz1) / 2),
      (pf['xM'][1] - pf['xM'][0], slab, abs(pz1 - pz0)), 'stone', 0)
for sgn in (-1, 1):
    L.box('platform-skirt-side', (sgn * (pf['xM'][1] - pf['skirtInsetM'] / 2), pf['topY'] / 2,
                                  (pz0 + pz1) / 2),
          (pf['skirtInsetM'], pf['topY'], abs(pz1 - pz0)), 'stone', 0)
L.box('platform-skirt-front', (0, pf['topY'] / 2, pz1 + pf['skirtInsetM'] / 2),
      (pf['xM'][1] * 2 - pf['skirtInsetM'] * 2, pf['topY'], pf['skirtInsetM']), 'stone', 0)
L.box('platform-skirt-rear', (0, pf['topY'] / 2, pz0 - pf['skirtInsetM'] / 2),
      (pf['xM'][1] * 2 - pf['skirtInsetM'] * 2, pf['topY'], pf['skirtInsetM']), 'stone', 0)
print(f'STAGE stair+platform ok ({time.time() - T0:.1f}s)')

# drains
for dx, dz in cfg['drains']:
    L.box('drain-frame', (dx, -slab / 2 + .004, dz), (.62, slab + .008, .44), 'stone', .008)
    L.box('drain-pit', (dx, -slab / 2 - .018, dz), (.48, .07, .3), 'dark', 0)
    for k in range(5):
        L.cyl('drain-bar', (dx - .21 + .105 * k, .004, dz - .13),
              (dx - .21 + .105 * k, .004, dz + .13), .022, 'iron', 6)
print(f'STAGE drains ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# bronze tripod burner on the axis (group dadian-court), photo-informed

L.GROUP = 'dadian-court'
bx, bz = bn['centerGlb'][0], bn['centerGlb'][2]
y = 0.0
for i, (w, h) in enumerate(bn['plinthTiersM']):
    L.box('burner-plinth', (bx, y + h / 2, bz), (w, h, w), 'stone', .01, True)
    y += h
L.cyl('burner-vessel', (bx, y + .02, bz), (bx, y + bn['vesselH'], bz), bn['vesselR'], 'bronze', 14)
leg_top = y
for k in range(3):
    ang = math.pi / 2 + 2 * math.pi * k / 3
    lx, lz = bx + bn['vesselR'] * .62 * math.cos(ang), bz + bn['vesselR'] * .62 * math.sin(ang)
    L.cyl('burner-leg', (lx, leg_top - bn['legH'], lz), (lx, leg_top, lz), bn['legR'], 'bronze', 8)
    L.box('burner-paw', (lx, leg_top - bn['legH'] + bn['pawBlockM'][2] / 2, lz - .04),
          (bn['pawBlockM'][0], bn['pawBlockM'][1], bn['pawBlockM'][2]), 'bronze', .008)
rim_y = y + bn['vesselH']
for sgn in (-1, 1):
    L.cyl('burner-handle', (bx + sgn * bn['vesselR'] * .92, rim_y - .05, bz),
          (bx + sgn * bn['vesselR'] * .92, rim_y + bn['handleTorusR'] * 1.5, bz),
          bn['handleTubeR'], 'bronze', 8)
ly = rim_y + .04
for r, h in bn['lidDiscsM']:
    L.cyl('burner-lid-disc', (bx, ly, bz), (bx, ly + h, bz), r, 'bronze', 14)
    ly += h + .015
L.cyl('burner-finial', (bx, ly, bz), (bx, ly + bn['finialR'] * 1.6, bz), bn['finialR'], 'bronze', 10)
print(f'STAGE burner ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# boundary walls (group dadian-court)

def boundary_wall(name, x0, x1, z0, z1, h=None, cap=None):
    x0, x1 = min(x0, x1), max(x0, x1)
    z0, z1 = min(z0, z1), max(z0, z1)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    hh = h or wall_h
    cc = cap or cap_y
    L.box(name, (cx, hh / 2, cz), (x1 - x0, hh, z1 - z0), 'stone', .01, True)
    L.box(name + '-cap', (cx, (hh + cc) / 2, cz), (x1 - x0 + .1, cc - hh + .06, z1 - z0 + .1), 'roof', .012)


for sgn in (-1, 1):
    boundary_wall('court2-side-wall', sgn * sw['innerX'], sgn * (sw['innerX'] + th), z_s, z_n)
for sgn in (-1, 1):
    boundary_wall('court2-south-return', sgn * cfg['southReturns']['xM'][0],
                  sgn * cfg['southReturns']['xM'][1],
                  cfg['southReturns']['z'][0], cfg['southReturns']['z'][1])
nc = cfg['northClosure']
boundary_wall('court2-north-closure', nc['xM'][0], nc['xM'][1], nc['z'] - nc['thicknessM'] / 2,
              nc['z'] + nc['thicknessM'] / 2, nc['heightM'], nc['capTopY'])
for sgn in (-1, 1):
    boundary_wall('court2-north-return', sgn * (nc['xM'][1] - nc['returnStubDepthM']),
                  sgn * nc['xM'][1], pz0 - nc['returnStubDepthM'], nc['z'],
                  nc['heightM'], nc['capTopY'])
print(f'STAGE walls ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# export

TARGETS = [('dadian-court.glb', ('temple-ground', 'dadian-court'))]
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
           'axis': 'world GLB Y-up (court authored in place, no instance transform)',
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

cT = measure['targets']['dadian-court.glb']
if cT['triangles'] > cfg['budgets']['courtTrisMax']:
    print('BUDGET_FAIL courtTris', cT['triangles'])
    sys.exit(5)

original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / 'dadian-court.glb'))
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

adapter_coll = []
for rec in L.COLL:
    cx, cyv, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'dadian-court'),
                         'type': 'box',
                         'min': [cx - sx / 2, cyv - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cyv + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cyv, cz], 'size': [sx, sy, sz]}})
(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; WORLD records (court authored in place)',
    'colliders': adapter_coll,
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {'courtTris': {'actual': cT['triangles'],
                                    'limit': cfg['budgets']['courtTrisMax'], 'pass': True}}
measure['design'] = {
    'contextNotSurvey': cfg['contextNotSurvey'],
    'floor': {'x': fl['xM'], 'z': fl['zM']},
    'platform': {'topY': pf['topY'], 'steps': st['count']},
    'burner': {'center': bn['centerGlb'], 'evidence': bn['evidence'],
               'notThePavilionBurner': bn['note']},
    'northClosure': 'sample terminal (非历史), z -59.8',
    'groundSeams': 'flush adjoining; path 4mm proud; floor north edge meets the first step face',
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
print(f"DADIAN_COURT_READY tris={cT['triangles']} bytes={cT['fileBytes']} total={time.time() - T0:.1f}s")
