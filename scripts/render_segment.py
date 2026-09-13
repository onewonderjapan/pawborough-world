"""Render the assembled street.glb with explicit review cameras on Cycles CPU.

Run: blender -b --factory-startup -t 4 -P render_segment.py -- --input world/street.glb \
       --output-dir ../runs/renders --views full-west,eye-west,clay-west ...
Views: full-west full-east eye-west eye-east across corner lane catwall plaza clay-* (same camera as its base)
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--input', type=Path, required=True)
p.add_argument('--output-dir', type=Path, required=True)
p.add_argument('--views', type=str, default='full-west,full-east,eye-west,eye-east,across,corner,lane,catwall,plaza')
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

meshes = [o for o in scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
mn = Vector([min(v[i] for v in pts) for i in range(3)])
mx = Vector([max(v[i] for v in pts) for i in range(3)])

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

clay = bpy.data.materials.new('InspectionClay')
clay.use_nodes = True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.42, .43, .4, 1)
clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .86

span = max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, 1)
bpy.ops.mesh.primitive_plane_add(size=span * 6, location=((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z - .03))
floor = bpy.context.object
m = bpy.data.materials.new('GroundContext')
m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.42, .43, .40, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .98
floor.data.materials.append(m)

cd = bpy.data.cameras.new('ReviewCamera')
cd.lens = 40
cam = bpy.data.objects.new('ReviewCamera', cd)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.resolution_x = a.width
scene.render.resolution_y = round(a.width * 9 / 16)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'


def look(cam_obj, pos_glb, target_glb, lens=None):
    """Camera from GLB-space coords (Y up, X east, Z south) -> Blender (x, -z, y)."""
    pb = Vector((pos_glb[0], -pos_glb[2], pos_glb[1]))
    tb = Vector((target_glb[0], -target_glb[2], target_glb[1]))
    cam_obj.location = pb
    cam_obj.rotation_euler = (tb - pb).to_track_quat('-Z', 'Y').to_euler()
    if lens:
        cam_obj.data.lens = lens


# street runs from GLB (0,0,0) to about (85,0,17); front walls at ~|5.6| from centerline
VIEWS = {
    'full-west':  {'pos': (-18, 34, 34), 'target': (28, 0, -2), 'lens': 35},
    'full-east':  {'pos': (108, 30, 40), 'target': (52, 0, 6), 'lens': 38},
    'eye-west':   {'pos': (2.5, 1.6, 0.2), 'target': (50, 1.6, 2.5), 'lens': 32},
    'eye-east':   {'pos': (80, 1.6, 13.0), 'target': (26, 1.6, -1.0), 'lens': 32},
    'across':     {'pos': (27, 2.0, 1.0), 'target': (28, 3.2, -6.0), 'lens': 35},
    'corner':     {'pos': (26.0, 3.0, 7.0), 'target': (7.0, 2.2, 0.0), 'lens': 30},
    'lane':       {'pos': (61.6, 1.9, 6.4), 'target': (59.9, 1.4, 11.6), 'lens': 30},
    'module-near': {'pos': (63.0, 2.0, -1.0), 'target': (49.0, 2.8, -5.0), 'lens': 30},
    'catwall':    {'pos': (62.5, 2.2, 6.5), 'target': (56.5, 3.4, -5.4), 'lens': 40},
    'plaza':      {'pos': (17.0, 3.4, -4.0), 'target': (27.0, 1.5, 6.5), 'lens': 30},
    'corner-close': {'pos': (18.5, 1.7, 7.6), 'target': (11.4, 1.5, 7.6), 'lens': 50},
}

a.output_dir.mkdir(parents=True, exist_ok=True)
views = [v.strip() for v in a.views.split(',') if v.strip()]
# render clay views last so material swaps never leak into PBR shots
views.sort(key=lambda v: not v.startswith('clay-'))
orig_mats = [(o, [m for m in o.data.materials]) for o in meshes]
for v in views:
    base = v
    clay_mode = False
    if v.startswith('clay-'):
        base = v[5:]
        clay_mode = True
    spec = VIEWS[base]
    if clay_mode:
        for o, _ in orig_mats:
            for i in range(len(o.data.materials)):
                o.data.materials[i] = clay
    elif v == views[0] or True:
        for o, mats in orig_mats:
            for i in range(len(o.data.materials)):
                if i < len(mats):
                    o.data.materials[i] = mats[i]
    look(cam, spec['pos'], spec['target'], spec.get('lens'))
    scene.render.filepath = str(a.output_dir / f'{v}.png')
    bpy.ops.render.render(write_still=True)
    rec = {'renderKind': 'offline_blender_cpu', 'input': str(a.input.resolve()),
           'sha256': hashlib.sha256(a.input.read_bytes()).hexdigest(),
           'view': v, 'clay': clay_mode, 'cameraGlb': spec['pos'], 'targetGlb': spec['target'],
           'samples': a.samples, 'threads': a.threads, 'browserVerified': False,
           'bounds': [list(mn), list(mx)]}
    (a.output_dir / f'{v}.json').write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('SEGMENT_RENDER_READY', v)
