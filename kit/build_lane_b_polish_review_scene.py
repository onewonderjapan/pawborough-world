"""Reopenable local review scene for the lane-b-polish candidate — small CPU
source project + four stills.

Contents: the two NEW GLBs (world/lane-b-polish/{lane-b,interfaces}) placed
exactly as the page places them (lane-b holder T=[57.418,0.09,14.2485] yaw
-0.4818; interfaces identity), plus the S04/S05/S07/street-kit context meshes
imported from the delivered v6 assembly and trimmed to the lane window so the
file stays small. Cameras = the four comparison poses (same world coordinates
as tools/lane_b_polish_capture.mjs). Rotating objects use explicit
rotation_mode before Euler/quaternion writes; textures are packed; the saved
file is REOPENED and re-verified at the end.

Run: blender -b --factory-startup -t 4 -P kit/build_lane_b_polish_review_scene.py \
        -- --out world/lane-b-polish/review --stills artifacts/lane-b-polish/blender
"""
import argparse
import math
import sys
from pathlib import Path

import bpy  # noqa: E402
import mathutils  # noqa: E402

WS = Path(__file__).resolve().parents[1]
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=WS / 'world/lane-b-polish/review')
p.add_argument('--stills', type=Path, default=WS / 'artifacts/lane-b-polish/blender')
a = p.parse_args(argv)

# default factory layout (keeps a 3D viewport for material-preview/camera
# view on reopen); the default cube/light are removed right away
bpy.ops.wm.read_factory_settings()
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
sc.unit_settings.scale_length = 1
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# ---- import the new candidate assets (page placement) -------------------------
bpy.ops.import_scene.gltf(filepath=str(WS / 'world/lane-b-polish/interfaces/model.glb'))
mid = set(o.name for o in bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(WS / 'world/lane-b-polish/lane-b/model.glb'))
lane_objs = [o for o in bpy.context.scene.objects if o.name not in mid and o.type == 'MESH']
YAW, T = -0.4818, [57.418, 0.09, 14.2485]
holder = bpy.data.objects.new('lane-b-holder', None)
holder.empty_display_size = 0.5
holder.rotation_mode = 'QUATERNION'
holder.rotation_quaternion = mathutils.Quaternion((0, 0, 1), YAW)
holder.location = (T[0], -T[2], T[1])              # glb Y-up -> blender Z-up
bpy.context.scene.collection.objects.link(holder)
for o in lane_objs:
    o.parent = holder

# ---- context: S04/S05/S07/street-kit meshes from the delivered v6 assembly ----
before = set(o.name for o in bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(WS / 'world/fangbang-temple-v6/street-reviewed-lanes.glb'))
ctx_objs = [o for o in bpy.context.scene.objects if o.name not in before]
ctx_names = [o.name for o in ctx_objs]             # capture BEFORE any removal
keep_prefix = ('S04-restaurant-b', 'S05-plain-v3', 'S07-plain-v2', 'street-kit__')
# lane window in BLENDER coords: world x (47, 68), world z (3, 22) ->
# blender y = -world z lies in (-22, -3)
LANE = dict(x=(47.0, 68.0), y=(-22.0, -3.0))
for o in ctx_objs:
    if o.type != 'MESH' or not o.name.startswith(keep_prefix):
        bpy.data.objects.remove(o, do_unlink=True)
for name in ctx_names:
    o = bpy.context.scene.objects.get(name)
    if o is None or o.type != 'MESH':
        continue
    ws = [o.matrix_world @ mathutils.Vector(c[:]) for c in o.bound_box]
    xs = [v.x for v in ws]
    ys = [v.y for v in ws]
    if max(xs) < LANE['x'][0] or min(xs) > LANE['x'][1] or max(ys) < LANE['y'][0] or min(ys) > LANE['y'][1]:
        bpy.data.objects.remove(o, do_unlink=True)

# context sanity: the mouth needs the real S05/S07 walls
s05 = sum(1 for o in bpy.context.scene.objects if o.name.startswith('S05-plain-v3'))
s07 = sum(1 for o in bpy.context.scene.objects if o.name.startswith('S07-plain-v2'))
assert s05 >= 8 and s07 >= 8, f'context lost: S05={s05} S07={s07} (trim window wrong)'

# ---- lighting: one sun + soft sky, matching the page's clean look -------------
bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
sun = bpy.context.object
sun.rotation_mode = 'XYZ'
sun.rotation_euler = (math.radians(62), 0, math.radians(-140))
sun.data.energy = 3.0
sc.world = bpy.data.worlds.new('review_world')
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.86, 0.88, 0.86, 1.0)
bg.inputs[1].default_value = 1.0

# ---- cameras: the four comparison poses (glb Y-up -> blender) ------------------
C, S = math.cos(YAW), math.sin(YAW)


def lw(lx, y, ls):
    return (T[0] + C * lx + S * ls, y, T[2] - S * lx + C * ls)


POSES = [
    ('street-mouth', lw(-0.55, 1.62, -2.90), (57.44, 1.15, 14.19)),
    ('threshold-foot', lw(0.15, 0.45, -1.15), (57.43, 0.12, 14.15)),
    ('window-door', lw(0.10, 1.90, 4.10), lw(1.74, 2.30, 4.70)),
    ('pocket-lookback', lw(-0.30, 1.60, 8.60), (57.6, 1.20, 13.2)),
]
g2b = lambda p: (p[0], -p[2], p[1])
cams = {}
for name, pos, tgt in POSES:
    cam = bpy.data.cameras.new(name)
    cam.lens = 32          # ~45 deg vertical fov at 36mm sensor default
    co = bpy.data.objects.new(name, cam)
    co.location = g2b(pos)
    d = mathutils.Vector(tuple(b - aa for aa, b in zip(g2b(pos), g2b(tgt))))
    co.rotation_mode = 'QUATERNION'          # explicit before the write
    co.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    sc.collection.objects.link(co)
    cams[name] = co

# ---- render setup: CPU cycles, small sample count, 1280x720 -------------------
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.render.resolution_x = 1280
sc.render.resolution_y = 720
sc.render.film_transparent = False

# pack every image so the .blend reopens self-contained
for image in bpy.data.images:
    if image.filepath:
        image.pack()

a.out.mkdir(parents=True, exist_ok=True)
a.stills.mkdir(parents=True, exist_ok=True)
# reopen convenience: default camera + material-preview camera view
sc.camera = cams['street-mouth']
assert sc.camera is not None
for area in (bpy.context.window.screen.areas if bpy.context.window else []):
    if area.type == 'VIEW_3D':
        for space in area.spaces:
            if space.type == 'VIEW_3D':
                space.shading.type = 'MATERIAL'
                space.region_3d.view_perspective = 'CAMERA'
blend_path = a.out / 'scene.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
for name, co in cams.items():
    sc.camera = co
    sc.render.filepath = str(a.stills / f'{name}.png')
    bpy.ops.render.render(write_still=True)

# ---- reopen the saved file once and re-verify (交付前自检) ----------------------
bpy.ops.wm.open_mainfile(filepath=str(blend_path))
sc2 = bpy.context.scene
n_mesh = len([o for o in sc2.objects if o.type == 'MESH'])
n_cam = len([o for o in sc2.objects if o.type == 'CAMERA'])
assert sc2.camera is not None and sc2.camera.name == 'street-mouth', 'default camera lost on reopen'
assert n_mesh > 40 and n_cam == 4, f'reopen verification: meshes={n_mesh} cams={n_cam}'
assert any(o.name == 'lane-b-holder' for o in sc2.objects), 'lane-b holder lost on reopen'
print(f'REVIEW_SCENE_READY meshes={n_mesh} cams={n_cam} stills=4 reopened_ok')
