"""Render front + three-quarter views of every street furniture GLB.

Cycles CPU only (machine shared with other batches tonight), one Blender
process, 960x960 PNG per view -> <out>/renders/<id>-{front,three-quarter}.png.
Blank-frame guard itself runs in make_contact_sheet.py over the saved PNGs.

Run:
  blender -b --factory-startup -t 4 -P \\
      scene-authoring/yuyuan-area/modules/street-furniture/render_street_furniture.py -- \\
      --out scene-authoring/yuyuan-area/out-street-furniture \\
      --config kit/props2.config.json
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--config', type=Path, required=True)
a = p.parse_args(argv)

cfg = json.loads(a.config.read_text(encoding='utf-8'))
renders = a.out / 'renders'
renders.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 960
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False

world = bpy.data.worlds.new('World')
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.82, 0.82, 0.83, 1.0)
bg.inputs[1].default_value = 1.0
scene.world = world


def add_sun(name, energy, rot_x, rot_z):
    light = bpy.data.lights.new(name, 'SUN')
    light.energy = energy
    light.angle = math.radians(4)
    o = bpy.data.objects.new(name, light)
    o.rotation_euler = (math.radians(rot_x), 0, math.radians(rot_z))
    scene.collection.objects.link(o)
    return o


add_sun('key-sun', 3.0, 50, 35)
add_sun('fill-sun', 1.1, 65, 205)

# light-gray ground just below y=0 (GLB) to catch contact shadows
ground_mesh = bpy.data.meshes.new('ground')
import bmesh  # noqa: E402
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
bm.to_mesh(ground_mesh)
bm.free()
ground = bpy.data.objects.new('ground', ground_mesh)
ground.location = (0, 0, -0.002)  # blender z; items rest at z=0
ground_mat = bpy.data.materials.new('ground-gray')
ground_mat.use_nodes = True
gp = ground_mat.node_tree.nodes['Principled BSDF']
gp.inputs['Base Color'].default_value = (0.55, 0.55, 0.55, 1)
gp.inputs['Roughness'].default_value = 0.9
ground_mesh.materials.append(ground_mat)
scene.collection.objects.link(ground)

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 50
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
target = bpy.data.objects.new('cam-target', None)
scene.collection.objects.link(target)
track = cam.constraints.new('TRACK_TO')
track.target = target
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'
scene.camera = cam

HALF_FOV = math.atan(18.0 / 50.0)  # 36mm sensor, 50mm lens
# camera offsets in Blender space; GLB +Z (facade/street side) is Blender -Y
VIEWS = {'front': (0.0, -1.0, 0.10), 'three-quarter': (0.62, -0.62, 0.42)}

for item in cfg['items']:
    for o in list(scene.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=str(a.out / item['glb']))
    bpy.context.view_layer.update()
    meshes = [o for o in scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
    mn = [min(pt[i] for pt in pts) for i in range(3)]
    mx = [max(pt[i] for pt in pts) for i in range(3)]
    centre = mathutils.Vector((mn[i] + mx[i]) / 2 for i in range(3))
    radius = max(mx[i] - mn[i] for i in range(3)) / 2
    dist = radius / math.tan(HALF_FOV) * 1.12
    for name, dirv in VIEWS.items():
        cam.location = centre + (mathutils.Vector(dirv).normalized() * dist)
        target.location = centre
        scene.render.filepath = str(renders / f"{item['id']}-{name}.png")
        bpy.ops.render.render(write_still=True)
        print('RENDERED', item['id'], name, flush=True)

print('RENDERS_DONE', len(cfg['items']) * len(VIEWS))
