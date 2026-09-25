"""Camphor tree module builder (D3, 2026-09-19 corridor batch).

One centered low-poly camphor tree, instanced 4x by world/temple-axis-v3:
  trunk   r0.22 h2.6, two branches into the canopy
  canopy  5 faceted ellipsoids (r 1.6-2.4), undersides kept at y >= 3.0 so
          sight-lines under the crown stay clear
  foliage 'foliage' material — NEW monochrome #4a5d3a rough .9, zero images
  collision 1 box 0.5 x 2.8 x 0.5 on the trunk (emitted in collision.json)

Run:
  blender -b --factory-startup -t 4 -P kit/build_tree.py -- \
      --out kit/out/temple-axis-v3-assets   # writes tree-camphor.glb
"""
import argparse
import hashlib
import json
import math
import random
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
p.add_argument('--out', type=Path, required=True)
p.add_argument('--version', choices=['v1', 'v2'], default='v1',
               help='v1 = 20260919 corridor batch tree; v2 = adoption batch rebuild '
                    '(multi-lobe canopy, fixed seed 20260919, 1800-2600 tris)')
a = p.parse_args(argv)
VERSION = a.version

T0 = time.time()
L.reset_scene()
L.build_materials()
L.M['foliage'] = L.mat('foliage', '4a5d3a', .9)
L.META['foliage']['source'] = 'design value (no photo); monochrome camphor canopy tone'
if VERSION == 'v2':
    # two-tone canopy: per-blob pick between #4a5d3a and #56683f (no new images)
    L.M['foliage2'] = L.mat('foliage2', '56683f', .9)
    L.META['foliage2'] = {'source': 'design value (no photo); second camphor canopy tone',
                          'tileMeters': L.META['foliage']['tileMeters']}

L.GROUP = 'temple-tree'


def ellipsoid(name, center, radii, meridians=10, rings=6, m='foliage'):
    """Faceted UV ellipsoid authored directly in GLB coords via L.mesh."""
    cx, cy, cz = center
    rx, ry, rz = radii
    verts = [(cx, cy + ry, cz), (cx, cy - ry, cz)]
    for j in range(1, rings):
        phi = math.pi * j / rings
        yy = cy + ry * math.cos(phi)
        sr = math.sin(phi)
        for i in range(meridians):
            th = 2 * math.pi * i / meridians
            verts.append((cx + rx * sr * math.cos(th), yy, cz + rz * sr * math.sin(th)))
    faces = []
    last = 2 + (rings - 2) * meridians
    for i in range(meridians):
        # wave5-templeqa: both pole fans were wound inward (normal toward the blob centre, 24 tris per blob —
        # the canopy's under-side discs showed as back faces from eye level). Wound outward like the bands now.
        faces.append((0, 2 + (i + 1) % meridians, 2 + i))
        faces.append((1, last + i, last + (i + 1) % meridians))
    for j in range(rings - 2):
        lo = 2 + j * meridians
        hi = lo + meridians
        for i in range(meridians):
            a2, b2 = lo + i, lo + (i + 1) % meridians
            c2, d2 = hi + i, hi + (i + 1) % meridians
            faces.append((a2, d2, c2))
            faces.append((a2, b2, d2))
    return L.mesh(name, verts, faces, m)


# trunk + branches (GLB Y-up, origin at trunk base center)
if VERSION == 'v2':
    # I (adoption batch): trunk r0.24 h2.8 + 3 primary branches r0.10,
    # length 1.6-2.2, elevation 35-55 deg, deterministic geometry
    L.cyl('tree-trunk', (0, 0, 0), (0, 2.8, 0), .24, 'wood', 8)
    L.rod('tree-branch-1', (0, 2.55, 0), (-.85, 4.05, -.35), .10, 'wood')   # ~46 deg
    L.rod('tree-branch-2', (0, 2.65, 0), (.80, 3.95, .55), .10, 'wood')     # ~42 deg
    L.rod('tree-branch-3', (0, 2.75, 0), (.25, 4.35, -.80), .10, 'wood')    # ~50 deg

    # canopy: 11 faceted blobs (9-12 allowed), centers scattered on a flattened
    # spherical shell (xz radius <= 2.2, y flattened x0.55) with +-0.15 jitter;
    # FIXED seed 20260919 so the build is reproducible
    rng = random.Random(20260919)
    blobs = []
    for i in range(11):
        az = rng.uniform(0, 2 * math.pi)
        rho = rng.uniform(0.55, 1.0) * 2.2
        r = rng.uniform(0.9, 1.6)
        cx = rho * math.cos(az) + rng.uniform(-.15, .15)
        cz = rho * math.sin(az) + rng.uniform(-.15, .15)
        cy = 4.9 + rho * 0.55 * 0.62 + rng.uniform(-.15, .15)
        cy = max(cy, 3.2 + r * 0.62)   # canopy bottom stays >= y 3.2
        blobs.append((i, (cx, cy, cz), (r, r * 0.62, r)))
    for i, center, radii in blobs:
        mat_name = 'foliage2' if i % 3 == 2 else 'foliage'   # two-tone mix, deterministic
        ellipsoid(f'tree-blob-{i}', center, radii, meridians=12, rings=8, m=mat_name)

    CANOPY_BOTTOM = 3.2
else:
    # trunk + two branches
    L.cyl('tree-trunk', (0, 0, 0), (0, 2.6, 0), .22, 'wood', 8)
    L.rod('tree-branch-w', (0, 2.4, 0), (-.55, 3.9, -.25), .13, 'wood')
    L.rod('tree-branch-e', (0, 2.5, 0), (.55, 4.1, .3), .12, 'wood')

    # canopy: 1 crown + 4 shoulder ellipsoids, bottoms >= 3.0
    ellipsoid('tree-crown', (0, 5.0, 0), (2.4, 1.9, 2.4))
    ellipsoid('tree-blob-n', (-1.3, 4.2, -1.0), (1.7, 1.2, 1.7))
    ellipsoid('tree-blob-s', (1.4, 4.3, 1.0), (1.6, 1.2, 1.6))
    ellipsoid('tree-blob-e', (1.2, 4.6, -1.2), (1.6, 1.25, 1.6))
    ellipsoid('tree-blob-w', (-1.2, 4.5, 1.2), (1.8, 1.3, 1.8))

    CANOPY_BOTTOM = 3.0

# canopy-bottom assertion (vertex level, not bbox trust): no foliage vertex
# below the version's floor (meshes are stored Blender-side, GLB y == Blender z)
low = 1e9
for o in bpy.context.scene.objects:
    if o.type == 'MESH' and (o.name.startswith('tree-blob') or o.name == 'tree-crown'):
        for v in o.data.vertices:
            low = min(low, v.co.z)
if low < CANOPY_BOTTOM - 1e-6:
    print('CANOPY_BOTTOM_FAIL', low)
    sys.exit(3)

# collision: single trunk box (v2 spec 0.55 x 3.0 x 0.55)
trunk_box = [.55, 3.0, .55] if VERSION == 'v2' else [.5, 2.8, .5]
L.COLL.append({'name': 'tree-trunk-block', 'group': 'temple-tree', 'type': 'box',
               'center': [0, trunk_box[1] / 2, 0], 'size': trunk_box, 'axis': 'glTF Y-up'})

# join + triangulate + export (same finalize as the court builder)
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

TARGETS = [('tree-camphor-v2.glb' if VERSION == 'v2' else 'tree-camphor.glb', ('temple-tree',))]
tris_total = 0
measure = {'moduleId': 'temple-tree-camphor', 'units': 'meters', 'surveyed': False,
           'axis': 'GLB Y-up; origin trunk base center; canopy ups',
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
                              export_apply=True, export_animations=False, export_tangents=False,
                              export_image_format='JPEG', export_jpeg_quality=92,
                              export_cameras=False, export_lights=False, use_selection=True)
    data = (out / fname).read_bytes()
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') in groups:
            o.data.calc_loop_triangles()
            tris_total += len(o.data.loop_triangles)
    measure['targets'][fname] = {'groups': list(groups), 'objects': sel,
                                 'triangles': tris_total, 'fileBytes': len(data),
                                 'sha256': hashlib.sha256(data).hexdigest()}
    print(f'EXPORTED {fname} objs={sel} tris={tris_total} bytes={len(data)}')

tris_min, tris_max = (1800, 2600) if VERSION == 'v2' else (0, 2600)
if tris_total > tris_max or tris_total < tris_min:
    print('BUDGET_FAIL treeTris', tris_total, f'outside {tris_min}-{tris_max}')
    sys.exit(5)

# reimport check
original = bpy.context.window.scene
check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
bpy.context.window.scene = check
bpy.ops.import_scene.gltf(filepath=str(out / TARGETS[0][0]))
bounds = [[1e9] * 3, [-1e9] * 3]
meshes = 0
mats = set()
for o in check.objects:
    if o.type != 'MESH':
        continue
    meshes += 1
    for m in o.data.materials:
        mats.add(m.name)
    for corner in o.bound_box:
        v = o.matrix_world @ Vector(corner)
        for k in range(3):
            bounds[0][k] = min(bounds[0][k], v[k])
            bounds[1][k] = max(bounds[1][k], v[k])
(out / 'reimport-check.json').write_text(json.dumps(
    {'imported': True, 'meshes': meshes, 'boundsBlender': bounds, 'materials': sorted(mats)},
    indent=2) + '\n', encoding='utf-8')
bpy.context.window.scene = original

adapter_coll = []
for rec in L.COLL:
    cx, cy, cz = rec['center']
    sx, sy, sz = rec['size']
    adapter_coll.append({'name': rec['name'], 'group': rec.get('group', 'temple-tree'),
                         'type': 'box',
                         'min': [cx - sx / 2, cy - sy / 2, cz - sz / 2],
                         'max': [cx + sx / 2, cy + sy / 2, cz + sz / 2],
                         'obb': {'pos': [0, 0, 0], 'theta': 0.0,
                                 'center': [cx, cy, cz], 'size': [sx, sy, sz]}})
(out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; module centered at origin',
    'colliders': adapter_coll}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'materials.json').write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
measure['budgets'] = {'treeTris': {'actual': tris_total, 'limit': tris_max, 'min': tris_min, 'pass': True},
                      'newImages': {'actual': 0, 'limit': 0, 'pass': True}}
canopy_blobs = 11 if VERSION == 'v2' else 5
trunk_collision = [.55, 3.0, .55] if VERSION == 'v2' else [.5, 2.8, .5]
measure['design'] = {'version': VERSION, 'canopyBottomY': round(low, 4),
                     'canopyBlobs': canopy_blobs, 'foliageColors': ['#4a5d3a', '#56683f'],
                     'trunkCollision': trunk_collision, 'randomSeed': 20260919 if VERSION == 'v2' else None,
                     'label': 'design_inference (species/position are design values)'}
measure['timings']['totalSeconds'] = round(time.time() - T0, 1)
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
print(f'TREE_READY tris={tris_total} canopyBottom={low:.3f} total={time.time() - T0:.1f}s')
