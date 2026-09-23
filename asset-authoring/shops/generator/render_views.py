"""Render QC stills for one unit or the 6-unit overview. Cycles CPU only.

Usage:
  blender -b --factory-startup -t 4 -P render_views.py -- unit <model_dir>
  blender -b --factory-startup -t 4 -P render_views.py -- overview <manifest.json> <out_png>

unit mode renders views/{front,side,rear,threeq}.png (1024x768) from model.blend
with one shared camera/lighting setup. overview mode imports the 6 GLBs into a
row with ground-laid text labels and renders one perspective sheet.
"""
import sys, math, json
from pathlib import Path
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
mode = argv[0]


def setup_world_and_light():
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


def add_ground():
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (0.30, 0.29, 0.27, 1)
    p.inputs['Roughness'].default_value = 0.95
    bpy.ops.mesh.primitive_plane_add(size=160, location=(0, 0, -0.001))
    bpy.context.object.data.materials.append(m)


def add_cam(loc, target, lens):
    cam = bpy.data.cameras.new('Cam')
    cam.lens = lens
    cam.clip_end = 2000
    o = bpy.data.objects.new('Cam', cam)
    bpy.context.collection.objects.link(o)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o


def config_render(res_x, res_y):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    import os
    scene.cycles.use_denoising = not os.environ.get('NO_DENOISE')
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 15
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'


if mode == 'unit':
    unit = Path(argv[1])
    bpy.ops.wm.open_mainfile(filepath=str(unit / 'model.blend'))
    meas = json.loads((unit / 'measurements.json').read_text())['design']
    W, D = meas['frontageM'], meas['depthM']
    H = meas['ridgeM']
    setup_world_and_light()
    add_ground()
    scene = bpy.context.scene
    config_render(1024, 768)
    dist = max(W, D + 1.0, H) * 2.2
    # views defined in GLB coords (x, y-up, z-front); blender maps (x, y, z)->(x, -z, y)
    views = {
        'front': ((0, H * 0.45, dist), (0, H * 0.42, 0), 42),
        'side': ((dist, H * 0.45, -D / 2), (0, H * 0.42, -D / 2), 42),
        'rear': ((0, H * 0.45, -D - dist), (0, H * 0.42, -D), 42),
        'threeq': ((dist * 0.72, H * 0.62, dist * 0.72), (0, H * 0.36, -D * 0.35), 35),
    }
    outdir = unit / 'views'
    outdir.mkdir(exist_ok=True)
    for name, (loc, tgt, lens) in views.items():
        bloc = (loc[0], -loc[2], loc[1])
        btgt = (tgt[0], -tgt[2], tgt[1])
        scene.camera = add_cam(bloc, btgt, lens)
        scene.render.filepath = str(outdir / f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print('VIEW_DONE', name)

elif mode == 'overview':
    bpy.ops.wm.read_factory_settings(use_empty=True)  # drop the factory-default cube
    manifest = json.loads(Path(argv[1]).read_text())
    out_png = argv[2]
    setup_world_and_light()
    add_ground()
    gap = 2.4
    total = sum(u['width'] for u in manifest) + gap * (len(manifest) - 1)
    cursor = -total / 2
    hmax = 0
    centers = []
    for u in manifest:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(Path(u['dir']) / 'model.glb'))
        root = bpy.data.objects.new(f"root-{u['id']}", None)
        bpy.context.collection.objects.link(root)
        for o in set(bpy.data.objects) - before - {root}:
            if o.parent is None:
                o.parent = root
        root.location = (cursor + u['width'] / 2, 0, 0)
        centers.append(cursor + u['width'] / 2)
        cursor += u['width'] + gap
        hmax = max(hmax, u.get('ridge', 8.4))
    scene = bpy.context.scene
    config_render(2400, 560)
    dist = total * 0.9 + 16
    scene.camera = add_cam((0, -dist, 4.0), (0, 0, 4.0), 40)
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    side = out_png + '.layout.json'
    import math
    json.dump({'dist': dist, 'resX': 2400, 'lens': 40, 'sensorW': 36,
               'unitCenterX': [c for c in centers]},
              open(side, 'w'))
    print('OVERVIEW_DONE', out_png)
