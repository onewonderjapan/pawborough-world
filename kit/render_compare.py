"""Render a module GLB (sample or frozen original) at three fixed, bbox-relative
cameras: front elevation, side elevation, and a three-quarter view — each in
normal and clay. Same render conventions as scripts/render_segment.py (Cycles
CPU, AgX, daylight sun, 1280px). Camera coordinates are written to a sidecar
JSON so any two renders can be proven same-camera.

Run:
  blender -b --factory-startup -t 4 -P kit/render_compare.py -- \
      --input kit/out/plain-shop-a/model.glb --output-dir kit/out/plain-shop-a/renders
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--input', type=Path, required=True)
p.add_argument('--output-dir', type=Path, required=True)
p.add_argument('--width', type=int, default=1280)
p.add_argument('--samples', type=int, default=24)
p.add_argument('--threads', type=int, default=4)
a = p.parse_args(argv)
assert 128 <= a.width <= 1920 and 1 <= a.samples <= 128 and 1 <= a.threads <= 4

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(a.input.resolve()))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = a.samples
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = a.threads
scene.render.resolution_x = a.width
scene.render.resolution_y = round(a.width * 3 / 4)

meshes = [o for o in scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
mn = Vector([min(v[i] for v in pts) for i in range(3)])
mx = Vector([max(v[i] for v in pts) for i in range(3)])
ctr = (mn + mx) / 2
# NOTE: after glTF import Blender is Z-up: height = Z, facade normal = ±Y.
W = mx.x - mn.x
D = mx.y - mn.y
H = mx.z - mn.z
span = max(W, D, H)

scene.world = bpy.data.worlds.new('Daylight')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.72, .78, .82, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .42
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
d = bpy.data.lights.new('DaylightSun', 'SUN')
d.energy = 2.8
d.angle = math.radians(10)
sun = bpy.data.objects.new('DaylightSun', d)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(26), math.radians(-22), math.radians(-35))

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.72, .71, .68, 1)
clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .9

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 50
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

target = Vector((ctr.x, ctr.y, mn.z + H * .45))


def look_at(loc):
    cam.location = loc
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


VIEWS = {
    'front': (ctr.x, ctr.y - span * 2.1, mn.z + H * .35),
    'side': (ctr.x + span * 2.4, ctr.y, mn.z + H * .35),
    'quarter': (ctr.x + span * 1.8, ctr.y - span * 1.8, mn.z + H * 1.4),
}

original_slots = [(o, list(o.data.materials)) for o in meshes]


def set_clay(on):
    for o, slots in original_slots:
        o.data.materials.clear()
        if on:
            o.data.materials.append(clay)
        else:
            for m in slots:
                o.data.materials.append(m)


a.output_dir.mkdir(parents=True, exist_ok=True)
cams = {}
for name, loc in VIEWS.items():
    look_at(loc)
    cams[name] = {'location': list(cam.location), 'lensMm': 50, 'target': list(target)}
    set_clay(False)
    scene.render.filepath = str(a.output_dir / f'{name}-normal.png')
    bpy.ops.render.render(write_still=True)
    set_clay(True)
    scene.render.filepath = str(a.output_dir / f'{name}-clay.png')
    bpy.ops.render.render(write_still=True)
set_clay(False)

(a.output_dir / 'cameras.json').write_text(json.dumps({
    'input': str(a.input), 'resolution': [a.width, round(a.width * 3 / 4)],
    'lensMm': 50, 'engine': 'cycles-cpu', 'samples': a.samples,
    'viewTransform': 'AgX - Medium High Contrast', 'cameras': cams,
}, indent=2) + '\n', encoding='utf-8')
print('RENDERS_DONE', a.output_dir)
