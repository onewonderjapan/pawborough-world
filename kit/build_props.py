"""E0 street props builder — 5 unique low-poly 1990s objects, monochrome
materials, ZERO images. One GLB per item, centered at origin, facade-facing
+Z contract (same as buildings), so the planner can yaw them to the facade.

Run:
  blender -b --factory-startup -t 4 -P kit/build_props.py -- \
      --config kit/props.config.json --out kit/out/props
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

L.reset_scene()
L.build_materials()
L.M['bamboo'] = L.mat('bamboo', 'b8a468', .85)
L.META['bamboo']['source'] = 'design value (no photo); monochrome aged bamboo tone'
L.M['awning-cloth'] = L.mat('awning-cloth', '7a6a58', .95)
L.META['awning-cloth']['source'] = 'design value (no photo); monochrome plain cotton'

out = a.out
out.mkdir(parents=True, exist_ok=True)

ITEMS = {i['id']: i for i in cfg['items']}


def finalize(fname, group, tris_max):
    bpy.ops.object.select_all(action='DESELECT')
    parts = {}
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            parts.setdefault((o.get('part', 'misc'), o.data.materials[0].name), []).append(o)
    for (group_g, material), items in parts.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in items:
            o.select_set(True)
        bpy.context.view_layer.objects.active = items[0]
        if len(items) > 1:
            bpy.ops.object.join()
        o = bpy.context.object
        o.name = group_g + '__' + material
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for poly in o.data.polygons:
            poly.use_smooth = False
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(o.data)
        bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    sel = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') in (group,):
            o.select_set(True)
            sel += 1
    bpy.ops.export_scene.gltf(filepath=str(out / fname), export_format='GLB', export_yup=True,
                              export_apply=True, export_animations=False, export_tangents=False,
                              export_image_format='JPEG', export_jpeg_quality=92,
                              export_cameras=False, export_lights=False, use_selection=True)
    data = (out / fname).read_bytes()
    total = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') in (group,):
            o.data.calc_loop_triangles()
            total += len(o.data.loop_triangles)
    if total > tris_max:
        print('BUDGET_FAIL', fname, total, '>', tris_max)
        sys.exit(5)
    print(f'EXPORTED {fname} tris={total} bytes={len(data)}')
    return {'file': fname, 'triangles': total, 'fileBytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()}


results = {}

# --- bicycle-28 ---------------------------------------------------------------
if True:
    L.GROUP = 'prop-bicycle'
    W, R = 0.5, 0.34                       # wheelbase half, wheel radius
    for wx in (-W, W):
        # wheel: two concentric rings (12-sided cyls, axis x)
        L.cyl('bike-rim', (wx, R, 0), (wx, R, 0.02), R, 'iron', 12)
        L.cyl('bike-hub', (wx, R, -0.015), (wx, R, 0.035), 0.03, 'iron', 6)
        for k in range(4):                  # 4 spokes as thin rods
            ang = math.pi * k / 4
            L.rod('bike-spoke', (wx, R - (R - 0.03) * math.cos(ang), (R - 0.03) * math.sin(ang) - 0.015),
                  (wx, R + (R - 0.03) * math.cos(ang), -(R - 0.03) * math.sin(ang) - 0.015), 0.006, 'iron')
    # frame: seat tube + down tube + top tube + chain stays + fork
    L.rod('bike-seat-tube', (0.05, 0.28, -0.12), (0.28, 0.92, 0.0), 0.018, 'iron')
    L.rod('bike-down-tube', (-0.32, 0.42, 0.0), (0.26, 0.88, 0.0), 0.018, 'iron')
    L.rod('bike-top-tube', (-0.26, 0.95, 0.0), (0.27, 0.95, 0.0), 0.016, 'iron')
    L.rod('bike-chain-stay', (-W, R, 0.0), (0.1, 0.35, 0.0), 0.012, 'iron')
    L.rod('bike-seat-stay', (-W, R, 0.0), (0.28, 0.9, 0.0), 0.012, 'iron')
    L.rod('bike-fork', (W, R, 0.0), (W + 0.06, 0.8, 0.0), 0.014, 'iron')
    L.rod('bike-head-tube', (W + 0.02, 0.72, 0.0), (W + 0.08, 0.98, 0.0), 0.02, 'iron')
    L.rod('bike-handlebar', (W - 0.04, 1.02, 0.0), (W + 0.2, 1.02, 0.0), 0.014, 'iron')
    L.box('bike-saddle', (0.26, 0.98, 0.0), (0.24, 0.06, 0.08), 'dark', .01)
    L.box('bike-rack', (-W - 0.02, 0.34, 0.0), (0.3, 0.05, 0.16), 'iron', .006)
    L.rod('bike-kickstand', (0.0, 0.18, -0.14), (0.05, 0.02, -0.05), 0.01, 'iron')
    results['bicycle-28'] = finalize(ITEMS['bicycle-28']['glb'], 'prop-bicycle', ITEMS['bicycle-28']['trisMax'])

# --- wood-crate (bevel-0 primitives: the 120-tri budget is tight) ---------------
L.GROUP = 'prop-crate'
L.box('crate-body', (0, .225, 0), (.56, .45, .41), 'wood', 0)
L.box('crate-board-front', (0, .24, .208), (.52, .3, .012), 'wood', 0)
L.box('crate-board-back', (0, .24, -.208), (.52, .3, .012), 'wood', 0)
for xx in (-.26, .26):
    L.box('crate-post', (xx, .24, 0), (.045, .45, .43), 'wood', 0)
results['wood-crate'] = finalize(ITEMS['wood-crate']['glb'], 'prop-crate', ITEMS['wood-crate']['trisMax'])

# --- bamboo-basket ---------------------------------------------------------------
L.GROUP = 'prop-basket'
L.cyl('basket-body', (0, 0, 0), (0, .3, 0), .2, 'bamboo', 8)
L.cyl('basket-rim', (0, .3, 0), (0, .34, 0), .23, 'bamboo', 8)
for k in range(8):
    ang = 2 * math.pi * k / 8
    lx, lz = .17 * math.cos(ang), .17 * math.sin(ang)
    L.rod('basket-strip', (lx, .02, lz), (lx * 1.25, .33, lz * 1.25), .016, 'bamboo')
results['bamboo-basket'] = finalize(ITEMS['bamboo-basket']['glb'], 'prop-basket', ITEMS['bamboo-basket']['trisMax'])

# --- bamboo-chair ------------------------------------------------------------------
L.GROUP = 'prop-chair'
for sx in (-.18, .18):
    for sz in (-.16, .16):
        L.rod('chair-leg', (sx, 0, sz), (sx, .4, sz), .018, 'bamboo')
L.box('chair-seat', (0, .42, 0), (.44, .035, .4), 'bamboo', 0)
for sx in (-.18, .18):
    L.rod('chair-back-post', (sx, .42, -.17), (sx, .82, -.17), .016, 'bamboo')
for yy in (.56, .78):
    L.box('chair-back-rail', (0, yy, -.17), (.4, .03, .028), 'bamboo', 0)
L.rod('chair-side-rail-l', (-.18, .24, -.16), (-.18, .24, .16), .014, 'bamboo')
L.rod('chair-side-rail-r', (.18, .24, -.16), (.18, .24, .16), .014, 'bamboo')
results['bamboo-chair'] = finalize(ITEMS['bamboo-chair']['glb'], 'prop-chair', ITEMS['bamboo-chair']['trisMax'])

# --- cloth-awning --------------------------------------------------------------------
L.GROUP = 'prop-awning'
# cloth: bent single-sided plane (2 segments), double-sided material
verts, faces, uvs = [], [], []
w2, drop, depth = 1.5, .18, 1.05
pts = []
for i in range(5):
    t = i / 4
    z = -depth / 2 + depth * t
    y = 0 - drop * math.sin(math.pi * t * .5)
    pts.append((y, z))
for (y1, z1), (y2, z2) in zip(pts, pts[1:]):
    base = len(verts)
    verts += [(-w2, y1, z1), (w2, y1, z1), (w2, y2, z2), (-w2, y2, z2)]
    faces.append((base, base + 1, base + 2, base + 3))
L.mesh('awning-cloth', verts, faces, 'awning-cloth')
# two slanted support rods from the lintel line to the cloth front edge
for sx in (-w2 + .1, w2 - .1):
    L.rod('awning-arm', (sx, -.06, -.45), (sx, -.3, .5), .014, 'iron')
mat = L.M['awning-cloth']
mat.use_backface_culling = False
results['cloth-awning'] = finalize(ITEMS['cloth-awning']['glb'], 'prop-awning', ITEMS['cloth-awning']['trisMax'])

# --- collision sidecars (module-local records, facade-facing +Z) --------------------
def box_rec(name, center, size):
    return {'name': name, 'group': 'prop', 'type': 'box',
            'min': [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
            'max': [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
            'obb': {'pos': [0, 0, 0], 'theta': 0.0, 'center': center, 'size': size}}


collision = {
    'bicycle-28': [box_rec('bicycle-block', [0, .5, 0], [.45, 1.0, 1.8])],
    'wood-crate': [box_rec('crate-block', [0, .225, 0], [.6, .45, .45])],
    'bamboo-basket': [box_rec('basket-block', [0, .17, 0], [.5, .34, .5])],
    'bamboo-chair': [box_rec('chair-block', [0, .41, 0], [.45, .82, .45])],
    'cloth-awning': [],                     # above head height: no collision per spec
}
measure = {
    'moduleId': 'street-props',
    'axis': 'GLB Y-up; origin at footprint center; facade-facing +Z (yaw to facade normal at plan time)',
    'era': cfg['era'],
    'items': results,
    'collision': collision,
    'budgets': {'uniqueTrisMax': cfg['budgets']['uniqueTrisMax'], 'newImages': 0,
                'actualMaxUniqueTris': max(r['triangles'] for r in results.values())},
    'timings': {'totalSeconds': round(time.time() - T0, 1)},
}
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
(out / 'collision.json').write_text(json.dumps(collision, ensure_ascii=False, indent=2) + '\n',
                                    encoding='utf-8')
print(f"PROPS_READY items={len(results)} maxUniqueTris={measure['budgets']['actualMaxUniqueTris']} "
      f"total={time.time() - T0:.1f}s")
