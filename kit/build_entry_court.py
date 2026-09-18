"""Temple entry-group courtyard builder (N4): the 16m x 17.4m walled court
between the shanmen and the yimen, the yimen hall floor, the rear landing and
the sample-terminal cutoff wall.

World coordinates (the court is NOT instanced — it is authored in place):
  court interior  x +/-8, z -3.6 .. -21, surface y ~0
  central path    x +/-1.85, z -3.6 .. -29.2 (through the yimen to the landing)
  side walls      inner faces x +/-8, y 0..2.8 + coping to 3.02
  south returns   z -3.6 line, x +/-3.3 .. +/-8.28 (tie to the shanmen rear)
  north returns   z -21 line, x +/-7.2 .. +/-8.28 (tie to the yimen front)
  landing         x +/-8, z -26.2 .. -29.2
  cutoff wall     center (0,1.4,-29.2), 16 x 2.8 x 0.28 — sample terminal,
                  explicitly NOT a historical hall
  drains          (-6.8, -8) and (6.8, -17), off the 3.6m axial path

Ground seams are flush adjoining (zero horizontal overlap between top faces;
the path sits 4mm proud of the side fields — below the 0.04m threshold rule).
Only visible meshes are built — no invisible world plane anywhere.

Run:
  blender -b --factory-startup -t 4 -P kit/build_entry_court.py -- \
      --config kit/entry-court.config.json --out kit/out/entry-court
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
# D2 (2026-09-19 corridor batch) strict opt-in keys: DEFAULT false must rerun
# geometrically equivalent to the delivered court GLBs (fallback #6 caliber).
p.add_argument('--addIncenseRoad', action='store_true')
p.add_argument('--addBurner', action='store_true')
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
T0 = time.time()

L.reset_scene()
L.build_materials()

cy = cfg['courtyard']
path_w = cfg['centralPathWidthM']
slab = cy['slabThicknessM']
sw = cy['sideWalls']

# ---------------------------------------------------------------------------
# ground (group temple-ground — these meshes ARE the physics ground)

L.GROUP = 'temple-ground'
half_in = cy['interiorX'][1]            # 8
z_s, z_n = cy['interiorZ'][1], cy['interiorZ'][0]   # -3.6, -21
path_half = path_w / 2 + 0.05           # 1.85

# central axial path: shanmen exit -> court -> yimen door -> hall -> landing
# (rearLanding.z is [min, max] = [-29.2, -26.2]; the path runs to the min)
_z_land_far = min(cy['rearLanding']['z'])
L.box('entry-path-slab', (0, -slab / 2, (z_s + _z_land_far) / 2),
      (2 * path_half, slab, abs(_z_land_far - z_s)), 'paving', 0)
# court side fields (4mm below the path; flush edges, no coplanar overlap)
for sgn in (-1, 1):
    L.box('court-field-slab',
          (sgn * (path_half + half_in) / 2, -slab / 2 - .004, (z_s + z_n) / 2),
          (half_in - path_half, slab, abs(z_n - z_s)), 'paving', 0)
# yimen hall floor (stone), flush at z=-21, under the whole gate footprint
L.box('yimen-hall-floor', (0, -slab / 2 - .004, (-21 + -26.2) / 2),
      (2 * 7.4, slab, 5.16), 'stone', 0)
# rear landing side fields beside the path
for sgn in (-1, 1):
    L.box('landing-field-slab',
          (sgn * (path_half + half_in) / 2, -slab / 2 - .004,
           (cy['rearLanding']['z'][0] + cy['rearLanding']['z'][1]) / 2),
          (half_in - path_half, slab,
           abs(cy["rearLanding"]["z"][1] - cy["rearLanding"]["z"][0])), 'paving', 0)
# threshold at the yimen door line (12mm, inside the <=40mm rule)
L.box('yimen-threshold-band', (0, -slab / 2 + .012, -21.0),
      (4.1, slab + .024, .5), 'stone', .006)
# stone borders along the side walls and the court north/south edges
bw = .24
for sgn in (-1, 1):
    L.box('court-side-border', (sgn * (half_in - bw / 2), -slab / 2 + .008, (z_s + z_n) / 2),
          (bw, slab + .016, abs(z_n - z_s)), 'stone', .006)
L.box('court-south-border', (0, -slab / 2 + .008, z_s + bw / 2),
      (2 * half_in, slab + .016, bw), 'stone', .006)
L.box('court-north-border', (0, -slab / 2 + .008, z_n - bw / 2),
      (2 * half_in, slab + .016, bw), 'stone', .006)
print(f'STAGE ground ok ({time.time() - T0:.1f}s)')

# drains: stone frame + iron bars sunk 3cm, both off the axial path
for dx, _dy, dz in cy["drains"]:
    L.box('drain-frame', (dx, -slab / 2 + .004, dz), (.62, slab + .008, .44), 'stone', .008)
    L.box('drain-pit', (dx, -slab / 2 - .018, dz), (.48, .07, .3), 'dark', 0)
    for k in range(5):
        L.cyl('drain-bar', (dx - .21 + .105 * k, .004, dz - .13),
              (dx - .21 + .105 * k, .004, dz + .13), .022, 'iron', 6)
print(f'STAGE drains ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# boundary walls (group entry-court)

L.GROUP = 'entry-court'
cap_y = sw['capTopY']
wall_h = sw['heightM']
th = sw['thicknessM']


def boundary_wall(name, x0, x1, z0, z1):
    x0, x1 = min(x0, x1), max(x0, x1)
    z0, z1 = min(z0, z1), max(z0, z1)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    L.box(name, (cx, wall_h / 2, cz), (x1 - x0, wall_h, z1 - z0), 'stone', .01, True)
    L.box(name + '-cap', (cx, (wall_h + cap_y) / 2, cz),
          (x1 - x0 + .1, cap_y - wall_h + .06, z1 - z0 + .1), 'roof', .012)


# side walls: inner faces at x = +/-8, body outward
for sgn in (-1, 1):
    boundary_wall('court-side-wall', sgn * half_in, sgn * (half_in + th), z_s, z_n)
# south returns on the z=-3.6 line (behind the shanmen rear corners)
for seg in cy['southReturns']['xSegments']:
    boundary_wall('court-south-return', seg[0], seg[1], z_s, z_s + th)
# north returns on the z=-21 line (beside the yimen front, into its corners)
for seg in cy['northReturns']['xSegments']:
    boundary_wall('court-north-return', seg[0], seg[1], z_n - th, z_n)
# sample-terminal cutoff wall (NOT a historical hall). Optional since the
# dadian-night batch (20260915): the second court continues through this
# line, so the dadian world assembly consumes a court-open variant built
# with buildCutoffWall=false. Default true — delivered datasets unchanged.
cw = cy['cutoffBackWall']
if cfg.get('buildCutoffWall', True):
    boundary_wall('cutoff-back-wall', -8, 8, cw['center'][2] - .14, cw['center'][2] + .14)
else:
    print('STAGE cutoff wall SKIPPED (buildCutoffWall=false — court-open variant)')
print(f'STAGE walls ok ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# D2 v3 additions (strict opt-in; default build above is untouched)

if a.addIncenseRoad:
    # DESIGN_SPEC packageD.forecourtIncenseRoad: bluestone incense road on the
    # axis in FRONT of the shanmen (temple-local z 0..+7, x +/-1.5), slabs
    # 1.5 x 0.75 with 0.02 joints, surface +0.01 (flush, no step); one whole
    # stone 3.0 x 0.6 x 0.03 at the threshold z 0..0.6. Faces are named
    # temple-ground__worn-stone to keep the walkable-surface contract
    # (/^temple-ground__/ on object names, src/templeViewShared.js).
    L.GROUP = 'temple-ground'
    # the shared 'stone' material is Blender-named 'worn-stone' (mb_lib), so
    # these faces join into 'temple-ground__worn-stone' — the walkable-surface
    # contract name — with ZERO new materials/images
    slab_t = .03
    top = .01
    # whole stone at the threshold (z 0..0.6)
    L.box('incense-roadslab-threshold', (0, top - slab_t / 2, .3), (3.0, slab_t, .6),
          'stone', .006)
    # slab rows from z 0.62 to 7.0: two 1.5 x 0.75 slabs per row, 0.02 joints
    z = .62
    row = 0
    while z + .75 <= 7.0 + 1e-9:
        zc = z + .375
        for sgn in (-1, 1):
            L.box(f'incense-road-slab-r{row}', (sgn * .755, top - slab_t / 2, zc),
                  (1.49, slab_t, .75), 'stone', .005)
        z += .77
        row += 1
    print(f'STAGE incense road ok ({row} rows, top +0.01) ({time.time() - T0:.1f}s)')

if a.addBurner:
    # DESIGN_SPEC packageD.entryCourtBurner: bronze tripod ding on the court
    # axis at (0, 0, -12), dadian burner construction x0.85, stone plinth
    # tiers 1.4x0.22 + 1.05x0.18 (spec values override the scaled dadian
    # tiers). Collision: ONE vessel box 1.1 x 1.3 x 1.1.
    L.GROUP = 'entry-court'
    L.M['bronze'] = L.mat('bronze', '6b4c30', .45, metal=.75)   # same as dadian burner
    bn = {'vesselR': .55 * .85, 'vesselH': .75 * .85, 'legR': .09 * .85,
          'legH': .35 * .85, 'pawBlockM': [.16 * .85, .08 * .85, .2 * .85],
          'handleTorusR': .12 * .85, 'handleTubeR': .03 * .85,
          'lidDiscsM': [[.5 * .85, .06 * .85], [.34 * .85, .05 * .85]],
          'finialR': .09 * .85}
    bx, bz, y = 0.0, -12.0, 0.0
    for w, h in ((1.4, .22), (1.05, .18)):
        L.box('burner-plinth', (bx, y + h / 2, bz), (w, h, w), 'stone', .01, True)
        y += h
    L.cyl('burner-vessel', (bx, y + .02, bz), (bx, y + .02 + bn['vesselH'], bz),
          bn['vesselR'], 'bronze', 14)
    leg_top = y + .02
    for k in range(3):
        ang = math.pi / 2 + 2 * math.pi * k / 3
        lx, lz = bx + bn['vesselR'] * .62 * math.cos(ang), bz + bn['vesselR'] * .62 * math.sin(ang)
        L.cyl('burner-leg', (lx, leg_top - bn['legH'], lz), (lx, leg_top, lz), bn['legR'], 'bronze', 8)
        L.box('burner-paw', (lx, leg_top - bn['legH'] + bn['pawBlockM'][2] / 2, lz - .04),
              (bn['pawBlockM'][0], bn['pawBlockM'][1], bn['pawBlockM'][2]), 'bronze', .008)
    rim_y = leg_top + bn['vesselH']
    for sgn in (-1, 1):
        L.cyl('burner-handle', (bx + sgn * bn['vesselR'] * .92, rim_y - .05, bz),
              (bx + sgn * bn['vesselR'] * .92, rim_y + bn['handleTorusR'] * 1.5, bz),
              bn['handleTubeR'], 'bronze', 8)
    ly = rim_y + .04
    for r, h in bn['lidDiscsM']:
        L.cyl('burner-lid-disc', (bx, ly, bz), (bx, ly + h, bz), r, 'bronze', 14)
        ly += h + .015
    L.cyl('burner-finial', (bx, ly, bz), (bx, ly + bn['finialR'] * 1.6, bz), bn['finialR'], 'bronze', 10)
    # spec collision: one box 1.1 x 1.3 x 1.1 for the vessel body
    L.COLL.append({'name': 'burner-vessel-block', 'group': 'entry-court', 'type': 'box',
                   'center': [bx, .65, bz], 'size': [1.1, 1.3, 1.1], 'axis': 'glTF Y-up'})
    _bt = 0
    for _o in bpy.context.scene.objects:
        if _o.type == 'MESH' and _o.name.startswith('burner'):
            _o.data.calc_loop_triangles()
            _bt += len(_o.data.loop_triangles)
    if _bt > 900:
        print('BURNER_BUDGET_FAIL', _bt, '> 900')
        sys.exit(7)
    print(f'STAGE burner ok ({_bt} tris <= 900) ({time.time() - T0:.1f}s)')

# ---------------------------------------------------------------------------
# export: join by (group, material), one GLB, reimport check, sidecars

TARGETS = [('entry-court-v3.glb' if (a.addIncenseRoad or a.addBurner) else 'court.glb',
            ('temple-ground', 'entry-court'))]
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

cT = measure['targets'][TARGETS[0][0]]
if cT['triangles'] > cfg['budgets']['courtAndContextTrisMax']:
    print('BUDGET_FAIL courtTris', cT['triangles'])
    sys.exit(5)

# reimport check
original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / TARGETS[0][0]))
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
        {'name': n.image.name, 'size': list(n.image.size)}
        for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]})
(out / 'reimport-check.json').write_text(
    json.dumps({'imported': True, 'meshes': meshes, 'boundsBlender': bounds,
                'materials': observed}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.context.window.scene = original

# collision sidecar — world-space records (court authored in place)
adapter_coll = []
for rec in L.COLL:
    cx, cyv, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'entry-court'),
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
                                    'limit': cfg['budgets']['courtAndContextTrisMax'], 'pass': True}}
measure['design'] = {
    'contextNotSurvey': cy['contextNotSurvey'],
    'interior': {'x': cy['interiorX'], 'z': cy['interiorZ']},
    'walls': 'inner faces at x +/-8 and the z=-3.6/-21 lines; heights 2.8 + coping 3.02',
    'drains': cy['drains'],
    'cutoff': 'sample terminal wall (非历史殿宇), center (0,1.4,-29.2) 16x2.8x0.28',
    'groundSeams': 'flush adjoining; path 4mm proud; threshold 12mm at the yimen door',
}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
used = dict(cfg)
used['configSha256'] = hashlib.sha256(a.config.read_bytes()).hexdigest()
(out / 'config-used.json').write_text(json.dumps(used, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
print(f"COURT_READY tris={cT['triangles']} bytes={cT['fileBytes']} total={time.time() - T0:.1f}s")
