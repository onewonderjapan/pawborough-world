"""Reopenable local review scene for the lane-a-polish candidate — small CPU
source project + four stills.

Contents: the two NEW GLBs (world/lane-a-polish/{lane-a,interfaces}) placed
exactly as the page places them (lane-a holder T=[43.545,0.09,-16.375] yaw
3.1165; interfaces identity), plus the N05/N06/street-kit context meshes
imported from the delivered v5 assembly and trimmed to the lane window so the
file stays small. Cameras = the four comparison poses (same world coordinates
as tools/lane_a_polish_capture.mjs).

Run: blender -b --factory-startup -t 4 -P kit/build_lane_a_polish_review_scene.py \
        -- --out world/lane-a-polish/review --stills artifacts/lane-a-polish/blender
"""
import argparse
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WS = HERE.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=WS / 'world/lane-a-polish/review')
p.add_argument('--stills', type=Path, default=WS / 'artifacts/lane-a-polish/blender')
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
bpy.ops.import_scene.gltf(filepath=str(WS / 'world/lane-a-polish/interfaces/model.glb'))
mid = set(o.name for o in bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(WS / 'world/lane-a-polish/lane-a/model.glb'))
lane_objs = [o for o in bpy.context.scene.objects if o.name not in mid and o.type == 'MESH']
YAW, T = 3.1165, [43.545, 0.09, -16.375]
holder = bpy.data.objects.new('lane-a-holder', None)
holder.empty_display_size = 0.5
holder.rotation_euler = (0, 0, YAW)
holder.location = (T[0], -T[2], T[1])              # glb Y-up -> blender Z-up
bpy.context.scene.collection.objects.link(holder)
for o in lane_objs:
    o.parent = holder

# ---- context: N05/N06/street-kit meshes from the delivered v5 assembly --------
before = set(o.name for o in bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(WS / 'world/fangbang-temple-v5/street-reviewed-lanes.glb'))
ctx_objs = [o for o in bpy.context.scene.objects if o.name not in before]
ctx_names = [o.name for o in ctx_objs]            # capture BEFORE any removal
keep_prefix = ('N05-restaurant-a', 'N06-curio-a', 'street-kit__')
# lane window in BLENDER coords: glb z (-26.5,-7.5) -> blender y = -glb z
# (7.5, 26.5); the earlier negative window deleted every N05/N06 mesh
LANE = dict(x=(39.5, 48.5), y=(7.5, 26.5))
for o in ctx_objs:
    if o.type != 'MESH' or not o.name.startswith(keep_prefix):
        bpy.data.objects.remove(o, do_unlink=True)
# trim kept context to the lane window (world x / blender y = -glb z)
for name in ctx_names:
    o = bpy.context.scene.objects.get(name)
    if o is None or o.type != 'MESH':
        continue
    import mathutils
    ws = [o.matrix_world @ mathutils.Vector(c[:]) for c in o.bound_box]
    xs = [v.x for v in ws]
    ys = [v.y for v in ws]
    if max(xs) < LANE['x'][0] or min(xs) > LANE['x'][1] or max(ys) < LANE['y'][0] or min(ys) > LANE['y'][1]:
        bpy.data.objects.remove(o, do_unlink=True)

# context sanity: the mouth needs the real N05/N06 walls (lead check 2026-09-20)
n05 = sum(1 for o in bpy.context.scene.objects if o.name.startswith('N05-restaurant-a'))
n06 = sum(1 for o in bpy.context.scene.objects if o.name.startswith('N06-curio-a'))
assert n05 >= 8 and n06 >= 8, f'context lost: N05={n05} N06={n06} (trim window wrong)'

# ---- lighting: one sun + soft sky, matching the page's clean look -------------
bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
sun = bpy.context.object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(62), 0, math.radians(-140))
sc.world = bpy.data.worlds.new('review_world')
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.86, 0.88, 0.86, 1.0)
bg.inputs[1].default_value = 1.0

# ---- cameras: the four comparison poses (glb Y-up -> blender) ------------------
POSES = [
    ('street-mouth', (43.42, 1.55, -9.55), (43.62, 1.15, -14.8)),
    ('threshold-foot', (43.15, 0.42, -11.3), (43.3, 0.25, -10.15)),
    ('window-door', (43.85, 1.65, -20.1), (42.55, 1.75, -21.3)),
    ('end-niche', (43.72, 1.55, -21.7), (43.78, 1.65, -24.4)),
]
g2b = lambda p: (p[0], -p[2], p[1])
cams = {}
for name, pos, tgt in POSES:
    cam = bpy.data.cameras.new(name)
    cam.lens = 32          # ~45 deg vertical fov at 36mm sensor default
    co = bpy.data.objects.new(name, cam)
    co.location = g2b(pos)
    direction = tuple(b - a for a, b in zip(g2b(pos), g2b(tgt)))
    co.rotation_mode = 'QUATERNION'
    import mathutils
    d = mathutils.Vector(direction)
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

a.out.mkdir(parents=True, exist_ok=True)
a.stills.mkdir(parents=True, exist_ok=True)
# reopen convenience: default camera + material-preview camera view
sc.camera = cams['street-mouth']
for area in (bpy.context.window.screen.areas if bpy.context.window else []):
    if area.type == 'VIEW_3D':
        for space in area.spaces:
            if space.type == 'VIEW_3D':
                space.shading.type = 'MATERIAL'
                space.region_3d.view_perspective = 'CAMERA'
assert sc.camera is not None and sc.camera.name == 'street-mouth'
bpy.ops.wm.save_as_mainfile(filepath=str(a.out / 'scene.blend'))
for name, co in cams.items():
    sc.camera = co
    sc.render.filepath = str(a.stills / f'{name}.png')
    bpy.ops.render.render(write_still=True)
print(f'REVIEW_SCENE_READY objects={len([o for o in bpy.context.scene.objects if o.type == "MESH"])} stills=4')
