"""Render one view of a world GLB through a cameras.json entry (N5 evidence).

Cycles CPU / AgX / daylight — same conventions as render_segment.py. Writes
the PNG plus a sidecar JSON with the GLB sha256 and exact camera data.

Run:
  blender -b --factory-startup -t 4 -P kit/render_lane_b.py -- \
    --input world/laneb/laneb.glb --cameras world/laneb/cameras.json \
    --view lane-b-axis --out ../artifacts/N5/after-entrance.png [--clay]
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--input', type=Path, required=True)
p.add_argument('--cameras', type=Path, required=True)
p.add_argument('--view', type=str, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--clay', action='store_true')
p.add_argument('--width', type=int, default=960)
p.add_argument('--samples', type=int, default=24)
p.add_argument('--threads', type=int, default=4)
a = p.parse_args(argv)
assert 1 <= a.threads <= 4 and a.samples <= 24  # design rendering budget

cams = {c['id']: c for c in json.loads(a.cameras.read_text())['cameras']}
v = cams[a.view]

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
scene.render.resolution_y = 540

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

if a.clay:
    clay = bpy.data.materials.new('clay')
    clay.use_nodes = True
    clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.72, .71, .68, 1)
    clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .9
    for o in scene.objects:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(clay)

# glTF is Y-up; Blender is Z-up after import. glTF (x,y,z) -> blender (x,-z,y).
px, py, pz = v['positionGlb']
tx, ty, tz = v['targetGlb']
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = v.get('lensMm', 35)
cam_data.sensor_width = v.get('sensorWidthMm', 36)
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
loc = (px, -pz, py)
tgt = (tx, -tz, ty)
cam.location = loc
direction = Vector(tgt) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

a.out.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(a.out)
bpy.ops.render.render(write_still=True)
sha = hashlib.sha256(a.input.read_bytes()).hexdigest()
a.out.with_suffix('.json').write_text(json.dumps({
    'view': a.view, 'input': str(a.input), 'glbSha256': sha, 'clay': a.clay,
    'camera': v, 'resolution': [a.width, 540], 'samples': a.samples,
    'engine': 'cycles-cpu', 'viewTransform': 'AgX - Medium High Contrast',
}, indent=2) + '\n', encoding='utf-8')
print('RENDER_DONE', a.out)
