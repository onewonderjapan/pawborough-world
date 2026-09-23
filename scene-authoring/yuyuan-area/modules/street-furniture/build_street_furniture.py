"""Street furniture builder — 10 unique low-poly 1990s Shanghai street
furniture props (wave-1 package pawborough-w1-street-furniture-20260922).

Same method and axis contract as kit/build_props.py: monochrome constant
materials, ZERO images, one GLB per item, GLB Y-up, origin at the ground
footprint centre, facade-facing +Z. Helpers come from kit/mb_lib.py; if that
import ever breaks, copy the needed helpers into this file (PLAN fallback).
No placement into the world happens here — the lead integrates later.

Run (inside Blender, one process per stage):
  blender -b --factory-startup -t 4 -P \\
      scene-authoring/yuyuan-area/modules/street-furniture/build_street_furniture.py -- \\
      --config kit/props2.config.json \\
      --out scene-authoring/yuyuan-area/out-street-furniture \\
      [--only street-lamp-1990,post-box-green]
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parents[3] / 'kit'  # modules/street-furniture -> yuyuan-area -> scene-authoring -> repo root
for p in (str(HERE), str(KIT)):
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    import mb_lib as L
except ImportError as exc:  # pragma: no cover - PLAN fallback hook
    print('MB_LIB_IMPORT_FAIL', exc)
    print('PLAN fallback: copy the needed helpers (box/cyl/rod/mesh/tag/mat/'
          'META/reset_scene) from kit/mb_lib.py + kit/helpers.py into this module.')
    raise

import bpy  # noqa: E402
import bmesh  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
sys.stdout.reconfigure(line_buffering=True)
p = argparse.ArgumentParser()
p.add_argument('--config', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--only', type=str, default='')
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
T0 = time.time()

L.reset_scene()

# Monochrome constant palette (all design values, zero images). 'enamel-green'
# is the spec post-box green 2f6b3a; 'concrete' and 'dark-iron' reuse the kit's
# accepted constant values so the layer reads with the existing props.
PALETTE = [
    ('cast-iron', '3f4140', .55, .35),
    ('enamel-green', '2f6b3a', .32, .04),
    ('enamel-white', 'e8e4da', .30, 0),
    ('concrete', '9a9a8c', .92, 0),
    ('hydrant-red', 'a03424', .45, 0),
    ('booth-blue', '46617a', .48, 0),
    ('glass-dark', '364347', .28, .12),
    ('dark-iron', '44453d', .64, .48),
    ('liner-dark', '3a3a38', .90, 0),
    ('porcelain', 'dfe3e6', .22, 0),
    ('hedge-green', '4e6136', .95, 0),
    ('kiosk-wood', '6b5138', .72, 0),
    ('cream', 'c9b893', .85, 0),
]
for name, col, rough, metal in PALETTE:
    L.M[name] = L.mat(name, col, rough, metal)
    L.META[name]['source'] = ('design value (no photo); monochrome constant — '
                              '1990s Shanghai street furniture palette')

out = a.out
out.mkdir(parents=True, exist_ok=True)


def cone(name, a_, b_, r1, r2, m, sides=8):
    """Tapered cylinder from GLB point a_ (radius r1) to GLB point b_ (radius r2)."""
    va, vb = L.glb_to_blender(a_), L.glb_to_blender(b_)
    d = vb - va
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r1, radius2=r2,
                                    depth=d.length, location=(va + vb) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.data.materials.append(L.M[m])
    return L.tag(o)


def _face_normals_up(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    if bm.faces[0].normal.z < 0:  # Blender z == GLB y
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def flat_ring(name, cx, y, cz, r_out, r_in, sides, m):
    """Horizontal annulus (bin rim) facing GLB +y."""
    verts, faces = [], []
    for k in range(sides):
        ang = 2 * math.pi * k / sides
        verts.append((cx + r_out * math.cos(ang), y, cz + r_out * math.sin(ang)))
    for k in range(sides):
        ang = 2 * math.pi * k / sides
        verts.append((cx + r_in * math.cos(ang), y, cz + r_in * math.sin(ang)))
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((k, k2, sides + k2, sides + k))
    o = L.mesh(name, verts, faces, m)
    _face_normals_up(o)
    return o


def open_tube(name, cx, y0, y1, cz, r, sides, m):
    """Open-topped cup (side wall + bottom cap): the bin liner keeps its mouth
    visible from above so the two-opening divider reads through the rim."""
    verts, faces = [], []
    for yy in (y0, y1):
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            verts.append((cx + r * math.cos(ang), yy, cz + r * math.sin(ang)))
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((k, k2, sides + k2, sides + k))
    faces.append(tuple(range(sides)))
    o = L.mesh(name, verts, faces, m)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def prism(name, quad_a, quad_b, m):
    """Closed slab between two 4-vertex GLB loops (arbitrary winding is fixed)."""
    verts = [tuple(v) for v in quad_a] + [tuple(v) for v in quad_b]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)]
    o = L.mesh(name, verts, faces, m)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def box_rec(name, center, size):
    """Collision record, same shape as kit/build_props.py sidecars."""
    return {'name': name, 'group': 'prop', 'type': 'box',
            'min': [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
            'max': [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
            'obb': {'pos': [0, 0, 0], 'theta': 0.0, 'center': list(center), 'size': list(size)}}


def reimport_check(glb_path):
    """Reimport the exported GLB into a scratch scene and verify the material
    graph survived the round trip (image nodes must be empty — zero images)."""
    original = bpy.context.window.scene
    check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
    bpy.context.window.scene = check
    try:
        bpy.ops.import_scene.gltf(filepath=str(glb_path))
        mats = sorted({m for o in check.objects if o.type == 'MESH'
                       for m in o.data.materials if m}, key=lambda m: m.name)
        observed = [{'name': m.name,
                     'imageNodes': [{'name': n.image.name, 'size': list(n.image.size),
                                     'colorSpace': n.image.colorspace_settings.name}
                                    for n in m.node_tree.nodes
                                    if n.type == 'TEX_IMAGE' and n.image]}
                    for m in mats]
        meshes = len([o for o in check.objects if o.type == 'MESH'])
        result = {'imported': True, 'meshes': meshes, 'materials': observed,
                  'imageCount': sum(len(m['imageNodes']) for m in observed)}
    finally:
        bpy.context.window.scene = original
        for o in list(check.objects):
            bpy.data.objects.remove(o)
        bpy.data.scenes.remove(check)
        # no orphans_purge here: it would delete palette materials that have no
        # mesh user yet (L.M holds only Python references, not Blender users)
    return result


def finalize(item, tris_max):
    """Join by (part, material), apply transforms, flat-shade, triangulate,
    export the item GLB, then budget/bounds/reimport self-checks."""
    fname, group = item['glb'], item['id']
    bpy.ops.object.select_all(action='DESELECT')
    parts = {}
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            parts.setdefault((o.get('part', 'misc'), o.data.materials[0].name), []).append(o)
    for (part, material), objs in parts.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.object
        o.name = part + '__' + material
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for poly in o.data.polygons:
            poly.use_smooth = False
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(o.data)
        bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    mn, mx = [1e9] * 3, [-1e9] * 3
    mats = set()
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') == group:
            o.select_set(True)
            mats.update(m.name for m in o.data.materials if m)  # names: safe vs dead refs
            for v in o.data.vertices:  # transforms applied: world == local
                gx, gy, gz = v.co.x, v.co.z, -v.co.y  # Blender -> GLB
                for k, val in enumerate((gx, gy, gz)):
                    mn[k] = min(mn[k], val)
                    mx[k] = max(mx[k], val)
    bpy.ops.export_scene.gltf(filepath=str(out / fname), export_format='GLB', export_yup=True,
                              export_apply=True, export_animations=False, export_tangents=False,
                              export_image_format='JPEG', export_jpeg_quality=92,
                              export_cameras=False, export_lights=False, use_selection=True)
    data = (out / fname).read_bytes()
    total = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.get('part', '') == group:
            o.data.calc_loop_triangles()
            total += len(o.data.loop_triangles)
    if total > tris_max:
        print('BUDGET_FAIL', fname, total, '>', tris_max)
        sys.exit(5)
    size_act = [round(mx[k] - mn[k], 4) for k in range(3)]
    size_spec = item['sizeM']
    bounds_ok = all(abs(size_act[k] - size_spec[k]) <= 0.10 * size_spec[k] + 1e-6 for k in range(3))
    origin_ok = abs(mn[1]) <= 0.005 and all(abs((mn[k] + mx[k]) / 2) <= 0.03 for k in (0, 2))
    if not bounds_ok:
        print('BOUNDS_FAIL', fname, 'actual', size_act, 'spec', size_spec)
        sys.exit(6)
    if not origin_ok:
        print('ORIGIN_FAIL', fname, 'min', [round(v, 4) for v in mn], 'max', [round(v, 4) for v in mx])
        sys.exit(7)
    check = reimport_check(out / fname)
    if check['imageCount'] != 0:
        print('IMAGE_LEAK_FAIL', fname, check['imageCount'])
        sys.exit(8)
    print(f'EXPORTED {fname} tris={total} bytes={len(data)} bounds={size_act}')
    return {'file': fname, 'triangles': total, 'fileBytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'bounds': {'min': [round(v, 4) for v in mn], 'max': [round(v, 4) for v in mx],
                       'size': size_act},
            'sizeSpec': list(size_spec), 'materials': sorted(mats),
            'reimport': check}


# --- street-lamp-1990 ---------------------------------------------------------
def build_street_lamp_1990():
    L.GROUP = 'street-lamp-1990'
    L.box('lamp-plinth-lower', (0, .075, 0), (.5, .15, .5), 'concrete', 0)
    L.box('lamp-plinth-cap', (0, .20, 0), (.36, .10, .36), 'cast-iron', .006)
    cone('lamp-post', (0, .25, 0), (0, 5.72, 0), .08, .05, 'cast-iron', 10)
    for yy in (1.0, 3.2, 5.1):
        L.cyl('lamp-post-collar', (0, yy, 0), (0, yy + .045, 0), .068, 'cast-iron', 10)
    cone('lamp-post-finial', (0, 5.72, 0), (0, 5.88, 0), .05, .004, 'cast-iron', 8)
    for sx in (-1, 1):
        pts = [(.015, 5.42), (.05, 5.60), (.095, 5.77), (.12, 5.88), (.14, 5.94)]
        for pa, pb in zip(pts, pts[1:]):
            L.rod('lamp-arm', (sx * pa[0], pa[1], 0), (sx * pb[0], pb[1], 0), .024, 'cast-iron')
        cone('lamp-shade', (sx * .14, 5.87, 0), (sx * .14, 6.00, 0), .12, .028, 'enamel-white', 10)
        L.cyl('lamp-shade-cap', (sx * .14, 6.0, 0), (sx * .14, 6.02, 0), .03, 'cast-iron', 6)


# --- post-box-green -----------------------------------------------------------
def build_post_box_green():
    L.GROUP = 'post-box-green'
    L.box('postbox-plinth', (0, .05, 0), (.5, .10, .5), 'concrete', 0)
    L.cyl('postbox-body', (0, .10, 0), (0, 1.02, 0), .20, 'enamel-green', 12)
    L.cyl('postbox-shoulder', (0, 1.02, 0), (0, 1.08, 0), .205, 'enamel-green', 12)
    cone('postbox-dome', (0, 1.08, 0), (0, 1.27, 0), .20, .02, 'enamel-green', 10)
    L.cyl('postbox-dome-cap', (0, 1.27, 0), (0, 1.30, 0), .021, 'enamel-green', 6)
    L.box('postbox-slot', (0, .90, .196), (.18, .035, .016), 'liner-dark', 0)
    L.box('postbox-slot-lip', (0, .85, .19), (.13, .018, .03), 'liner-dark', 0)
    L.box('postbox-door-frame', (0, .55, -.194), (.28, .58, .014), 'liner-dark', 0)


# --- phone-booth-ic -----------------------------------------------------------
def build_phone_booth_ic():
    L.GROUP = 'phone-booth-ic'
    L.box('booth-base', (0, .04, 0), (1.0, .08, 1.0), 'concrete', 0)
    L.box('booth-panel-back', (0, .66, -.455), (.95, 1.16, .05), 'booth-blue', 0)
    L.box('booth-panel-left', (-.455, .66, 0), (.05, 1.16, .91), 'booth-blue', 0)
    L.box('booth-panel-right', (.455, .66, 0), (.05, 1.16, .91), 'booth-blue', 0)
    L.box('booth-rail-back', (0, 1.265, -.455), (.99, .05, .07), 'dark-iron', 0)
    L.box('booth-rail-left', (-.455, 1.265, 0), (.07, .05, .95), 'dark-iron', 0)
    L.box('booth-rail-right', (.455, 1.265, 0), (.07, .05, .95), 'dark-iron', 0)
    for sx in (-.47, .47):
        for sz in (-.47, .47):
            L.rod('booth-post', (sx, .06, sz), (sx, 2.34, sz), .028, 'dark-iron')
    L.box('booth-hood', (0, 2.36, 0), (1.04, .08, 1.04), 'booth-blue', .008)
    L.box('booth-hood-cap', (0, 2.415, 0), (.86, .03, .86), 'dark-iron', 0)
    L.box('booth-phone-unit', (0, 1.52, -.40), (.30, .52, .14), 'liner-dark', 0)
    L.box('booth-phone-face', (0, 1.55, -.323), (.24, .38, .012), 'glass-dark', 0)
    L.rod('booth-handset', (-.10, 1.74, -.315), (.10, 1.74, -.315), .022, 'liner-dark')
    L.box('booth-shelf', (0, 1.18, -.40), (.34, .04, .18), 'dark-iron', 0)
    L.box('booth-card-reader', (.09, 1.32, -.318), (.09, .14, .014), 'porcelain', 0)


# --- trash-bin-concrete ---------------------------------------------------------
def build_trash_bin_concrete():
    L.GROUP = 'trash-bin-concrete'
    L.box('bin-base', (0, .05, 0), (.48, .10, .48), 'concrete', 0)
    L.cyl('bin-shell', (0, .10, 0), (0, .88, 0), .21, 'concrete', 8)
    flat_ring('bin-rim', 0, .88, 0, .21, .17, 8, 'concrete')
    open_tube('bin-liner', 0, .12, .84, 0, .17, 8, 'liner-dark')
    L.box('bin-divider', (0, .52, 0), (.33, .56, .022), 'liner-dark', 0)


# --- fire-hydrant ---------------------------------------------------------------
def build_fire_hydrant():
    L.GROUP = 'fire-hydrant'
    L.box('hydrant-base', (0, .04, 0), (.29, .08, .29), 'hydrant-red', 0)
    L.cyl('hydrant-flange', (0, .08, 0), (0, .16, 0), .12, 'hydrant-red', 8)
    L.cyl('hydrant-body', (0, .16, 0), (0, .72, 0), .085, 'hydrant-red', 8)
    cone('hydrant-bonnet', (0, .72, 0), (0, .82, 0), .085, .045, 'hydrant-red', 8)
    cone('hydrant-top', (0, .82, 0), (0, .90, 0), .045, .002, 'hydrant-red', 8)
    L.cyl('hydrant-nut', (0, .90, 0), (0, .93, 0), .018, 'liner-dark', 6)
    for sx in (-1, 1):
        L.cyl('hydrant-side-cap', (sx * .085, .52, 0), (sx * .15, .52, 0), .042, 'hydrant-red', 8)


# --- utility-pole ---------------------------------------------------------------
def build_utility_pole():
    L.GROUP = 'utility-pole'
    cone('pole-shaft', (0, 0, 0), (0, 8.0, 0), .11, .07, 'concrete', 10)
    L.box('pole-crossarm', (0, 7.35, 0), (.60, .07, .07), 'liner-dark', 0)
    for sx in (-1, 1):
        L.rod('pole-crossarm-brace', (sx * .04, 7.14, 0), (sx * .24, 7.31, 0), .014, 'dark-iron')
    for xx in (-.22, 0, .22):
        cone('pole-insulator', (xx, 7.385, 0), (xx, 7.465, 0), .032, .012, 'porcelain', 6)
    # transformer at 5 m: spec core 0.6x0.8x0.5; cooling ribs widen the depth to
    # 0.56 so the whole pole meets the z bounds 0.6 ±10% (recorded assumption)
    L.box('transformer-core', (0, 5.0, .02), (.60, .80, .50), 'liner-dark', 0)
    for yy in (4.70, 5.00, 5.30):
        L.box('transformer-rib', (0, yy, .02), (.62, .06, .56), 'liner-dark', 0)
    for sx in (-1, 1):
        cone('transformer-bushing', (sx * .12, 5.40, .02), (sx * .12, 5.52, .02), .028, .012, 'porcelain', 6)


# --- news-kiosk -----------------------------------------------------------------
def build_news_kiosk():
    L.GROUP = 'news-kiosk'
    L.box('kiosk-plinth', (0, .06, 0), (1.9, .12, 1.3), 'concrete', 0)
    L.box('kiosk-body', (0, 1.17, 0), (1.9, 2.10, 1.3), 'enamel-green', .012)
    for sx in (-.925, .925):
        for sz in (-.625, .625):
            L.box('kiosk-corner-trim', (sx, 1.17, sz), (.06, 2.10, .06), 'cream', 0)
    L.box('kiosk-roof', (0, 2.26, -.01), (2.02, .08, 1.32), 'enamel-green', .008)
    prism('kiosk-awning-lid',
          [(-1.02, 2.28, .58), (1.02, 2.28, .58), (1.02, 2.12, .94), (-1.02, 2.12, .94)],
          [(-1.02, 2.23, .58), (1.02, 2.23, .58), (1.02, 2.07, .94), (-1.02, 2.07, .94)],
          'enamel-green')
    L.box('kiosk-awning-fascia', (0, 2.075, .93), (2.04, .12, .05), 'enamel-green', 0)
    L.box('kiosk-counter-recess', (0, 1.34, .63), (1.3, .72, .08), 'liner-dark', 0)
    L.box('kiosk-counter', (0, 1.00, .70), (1.42, .05, .26), 'kiosk-wood', 0)
    for sx in (-.43, .43):
        L.box('kiosk-window-bar', (sx, 1.34, .665), (.025, .72, .02), 'dark-iron', 0)
    L.box('kiosk-shutter-roll', (0, 1.80, .655), (1.34, .18, .07), 'kiosk-wood', 0)
    for yy in (.95, 1.20, 1.45):
        L.box('kiosk-rack-strip', (-.965, yy, 0), (.05, .17, .78), 'kiosk-wood', 0)
    for sz in (-.42, .42):
        L.box('kiosk-rack-rail', (-.965, 1.20, sz), (.05, .78, .05), 'dark-iron', 0)
    # The awning lid overhangs the front, shifting the footprint centre to
    # z +0.1425; slide all parts back so the whole-item footprint centre sits
    # on the origin (kit contract). Blender y maps to -GLB z.
    shift_y = 0.1425
    for o in bpy.context.scene.objects:
        if o.get('part', '') == L.GROUP:
            o.location.y += shift_y


# --- bus-stop-sign --------------------------------------------------------------
def build_bus_stop_sign():
    L.GROUP = 'bus-stop-sign'
    L.box('sign-base', (0, .03, 0), (.24, .06, .10), 'concrete', 0)
    L.rod('sign-pole', (0, .05, 0), (0, 2.60, 0), .030, 'dark-iron')
    L.box('sign-board-back', (0, 2.12, -.016), (.58, .62, .014), 'dark-iron', 0)
    L.box('sign-board', (0, 2.12, .005), (.56, .60, .03), 'enamel-white', 0)
    L.box('sign-roof-cap', (0, 2.475, 0), (.64, .05, .10), 'enamel-green', 0)
    for yy in (1.78, .40):
        L.cyl('sign-clamp', (0, yy, 0), (0, yy + .04, 0), .036, 'dark-iron', 6)


# --- planter-box ----------------------------------------------------------------
def build_planter_box():
    L.GROUP = 'planter-box'
    L.box('planter-body', (0, .175, 0), (1.2, .35, .5), 'concrete', .01)
    L.box('planter-rim-front', (0, .365, .235), (1.22, .05, .05), 'concrete', 0)
    L.box('planter-rim-back', (0, .365, -.235), (1.22, .05, .05), 'concrete', 0)
    L.box('planter-rim-left', (-.585, .365, 0), (.05, .05, .42), 'concrete', 0)
    L.box('planter-rim-right', (.585, .365, 0), (.05, .05, .42), 'concrete', 0)
    L.box('planter-soil', (0, .35, 0), (1.08, .04, .38), 'liner-dark', 0)
    L.box('planter-hedge', (0, .415, 0), (1.06, .16, .36), 'hedge-green', 0)


# --- bike-rack ------------------------------------------------------------------
def build_bike_rack():
    L.GROUP = 'bike-rack'
    for i in range(6):
        x = -.9 + .36 * i
        for sz in (-.16, .16):
            L.rod('rack-hoop-leg', (x, 0, sz), (x, .575, sz), .024, 'dark-iron')
        L.rod('rack-hoop-top', (x, .575, -.16), (x, .575, .16), .024, 'dark-iron')
    for sz in (-.16, .16):
        L.rod('rack-rail', (-.9, .25, sz), (.9, .25, sz), .02, 'dark-iron')


BUILDERS = {
    'street-lamp-1990': build_street_lamp_1990,
    'post-box-green': build_post_box_green,
    'phone-booth-ic': build_phone_booth_ic,
    'trash-bin-concrete': build_trash_bin_concrete,
    'fire-hydrant': build_fire_hydrant,
    'utility-pole': build_utility_pole,
    'news-kiosk': build_news_kiosk,
    'bus-stop-sign': build_bus_stop_sign,
    'planter-box': build_planter_box,
    'bike-rack': build_bike_rack,
}


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


only = {s.strip() for s in a.only.split(',') if s.strip()}
catalog_path = out / 'props.catalog.json'
collision_path = out / 'collision.json'
measure_path = out / 'measurements.json'
materials_path = out / 'materials.json'
reimport_path = out / 'reimport-check.json'

built = {}
for item in cfg['items']:
    if only and item['id'] not in only:
        continue
    t_item = time.time()
    BUILDERS[item['id']]()
    built[item['id']] = finalize(item, item['trisMax'])
    built[item['id']]['buildSeconds'] = round(time.time() - t_item, 1)

catalog = load_json(catalog_path) if catalog_path.exists() else {}
items_rec = catalog.get('items', {})
items_rec.update(built)
catalog = {'moduleId': 'street-furniture',
           'axis': 'glTF Y-up; origin at ground footprint centre; facade-facing +Z (kit contract)',
           'era': cfg['era'],
           'items': items_rec,
           'budgets': {'uniqueTrisMaxPerItem': {i['id']: i['trisMax'] for i in cfg['items']},
                       'uniqueTrisMaxModule': cfg['budgets']['uniqueTrisMax'],
                       'newImages': 0},
           'totals': {'items': len(items_rec),
                      'uniqueTris': sum(r['triangles'] for r in items_rec.values()),
                      'bytes': sum(r['fileBytes'] for r in items_rec.values())}}
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

collision = load_json(collision_path) if collision_path.exists() else {}
for item in cfg['items']:
    if only and item['id'] not in only:
        continue
    collision[item['id']] = [box_rec(item['id'] + '-block', [0, item['sizeM'][1] / 2, 0],
                                     item['sizeM'])]
collision_path.write_text(json.dumps(collision, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

prev = load_json(measure_path) if measure_path.exists() else {}
timings = prev.get('timings', {})
timings['lastRunSeconds'] = round(time.time() - T0, 1)
timings['cumulativeSeconds'] = round(timings.get('cumulativeSeconds', 0) + (time.time() - T0), 1)
measure_path.write_text(json.dumps({
    'moduleId': 'street-furniture',
    'axis': 'glTF Y-up; origin at ground footprint centre; facade-facing +Z',
    'era': cfg['era'], 'items': items_rec, 'collision': collision,
    'budgets': catalog['budgets'], 'totals': catalog['totals'],
    'timings': timings,
    'referencePhotoTexturesUsed': False, 'bakedGlobalIllumination': False,
    'surveyed': False, 'units': 'meters',
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

materials_path.write_text(json.dumps(L.META, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

checks = load_json(reimport_path) if reimport_path.exists() else {}
for item_id, rec in built.items():
    checks[item_id] = rec['reimport']
reimport_path.write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print(f"STREET_FURNITURE_STAGE_DONE ids={sorted(built)} items={len(items_rec)}/10 "
      f"uniqueTris={catalog['totals']['uniqueTris']} run={timings['lastRunSeconds']}s")
