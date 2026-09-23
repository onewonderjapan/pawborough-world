"""Re-render cart-youdunzi three-quarter from the pre-fix camera.

The original out/cart-youdunzi/views/threeq.png was framed from measurements
frontageM=1.25, depthM=1.049, ridgeM=1.28 (render_views.py unit threeq).
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
unit = Path(argv[0])
out_png = Path(argv[1])

# Frozen from the pre-fix measurements. Do not recompute from the new bounds.
W, D, H = 1.25, 1.049, 1.28
dist = max(W, D + 1.0, H) * 2.2
loc = (dist * 0.72, H * 0.62, dist * 0.72)
tgt = (0, H * 0.36, -D * 0.35)
lens = 35

bpy.ops.wm.open_mainfile(filepath=str(unit / 'model.blend'))
scene = bpy.context.scene
w = bpy.data.worlds.new('World')
scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.72, 0.80, 0.92, 1.0)
bg.inputs[1].default_value = 0.65
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.2
sun.angle = math.radians(2.5)
sun.color = (1.0, 0.96, 0.90)
so = bpy.data.objects.new('Sun', sun)
bpy.context.collection.objects.link(so)
so.rotation_euler = (math.radians(48), 0, math.radians(35))
m = bpy.data.materials.new('ground')
m.use_nodes = True
p = m.node_tree.nodes['Principled BSDF']
p.inputs['Base Color'].default_value = (0.30, 0.29, 0.27, 1)
p.inputs['Roughness'].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=160, location=(0, 0, -0.001))
bpy.context.object.data.materials.append(m)

cam = bpy.data.cameras.new('Cam')
cam.lens = lens
cam.clip_end = 2000
o = bpy.data.objects.new('Cam', cam)
bpy.context.collection.objects.link(o)
bloc = (loc[0], -loc[2], loc[1])
btgt = (tgt[0], -tgt[2], tgt[1])
o.location = bloc
d = Vector(btgt) - Vector(bloc)
o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scene.camera = o
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1024
scene.render.resolution_y = 768
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.compression = 15
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Base Contrast'
scene.render.filepath = str(out_png)
bpy.ops.render.render(write_still=True)
print('FROZEN_THREEQ', out_png, 'loc', loc, 'tgt', tgt, 'lens', lens)
