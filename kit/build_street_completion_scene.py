"""Reusable street-completion scene assembly for Blender framing (batch S4).

Imports the frozen street assembly + the six refined buildings + the tail
surface at their dataset transforms, adds the batch cameras from the dataset
cameras.json, saves scene.blend + a cameras.json sidecar, and renders PBR/clay
pairs for the requested views. BLENDER evidence path — kept strictly separate
from the WebGL captures (different engine, same camera definitions).

Asset placement: the glTF importer already converts Y-up geometry to Blender's
Z-up; a glb yaw of θ about +Y becomes a Blender yaw of -θ about +Z (the same
math the dataset's collision sidecars use), so each asset gets a Z-rotation of
-rotationYRad at (x, -z_glb).

Run:
  blender -b --factory-startup -t 4 -P kit/build_street_completion_scene.py -- \
      --views sc-czero,sc-pair-cloth-silk --out kit/out/sctail-scene
"""
import argparse
import json
import math
from pathlib import Path

import bpy

import sys
argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--views', default='sc-czero,sc-pair-cloth-silk')
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1280)
p.add_argument('--samples', type=int, default=32)
args = p.parse_args(argv)

ROOT = Path('/home/baibai/pawborough-world')
DATASET = ROOT / 'world' / 'street-completion'
cams = json.loads((DATASET / 'cameras.json').read_text(encoding='utf-8'))['cameras']
by_id = {c['id']: c for c in cams}
manifest = json.loads((DATASET / 'review-manifest.json').read_text(encoding='utf-8'))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new_top = [o for o in set(bpy.data.objects) - before if o.parent is None or o.parent not in set(bpy.data.objects) - before]
    return new_top

import_glb(ROOT / 'world' / 'street-reviewed.glb')

for a in manifest['streetCompletion']['assets']:
    glb_path = ROOT / a['glb'].lstrip('./')
    top = import_glb(glb_path)
    pivot = bpy.data.objects.new(f"asset-root-{a['id']}", None)
    scene.collection.objects.link(pivot)
    x, _y, z = a['positionGlb']
    pivot.location = (x, -z, 0.0)
    pivot.rotation_euler = (0.0, 0.0, math.radians(-a['rotationYRad']))
    for o in top:
        o.parent = pivot

import_glb(DATASET / 'surface.glb')

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 2.8
sun.rotation_euler = (math.radians(55), 0.0, math.radians(-35))
world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.82, 0.88, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.6

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
cb = clay.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (0.62, 0.60, 0.57, 1)
cb.inputs['Roughness'].default_value = 0.9

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 3 / 4)
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

def look_at(loc, target, lens_mm):
    cam.location = loc
    cam.data.lens = lens_mm
    cam.data.sensor_width = 36
    d = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
    # point -Z (camera forward) along d: keep world Z-up
    rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, target))))
    rot_z = math.atan2(d[1], d[0]) - math.pi / 2
    cam.rotation_euler = (rot_x, 0.0, rot_z)

sidecar = {'views': [], 'source': 'kit/build_street_completion_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'note': 'BLENDER evidence; WebGL captures are separate'}
args.out.mkdir(parents=True, exist_ok=True)
for vid in [v.strip() for v in args.views.split(',') if v.strip()]:
    c = by_id[vid]
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    look_at(loc, tar, c['lensMm'])
    meshes = [o for o in scene.objects if o.type == 'MESH']
    saved = []
    for tag in ('pbr', 'clay'):
        if tag == 'clay':
            saved = [(o, [s.material for s in o.material_slots]) for o in meshes]
            for o in meshes:
                for s in o.material_slots:
                    s.material = clay
        scene.render.filepath = str(args.out / f'{vid}-{tag}.png')
        bpy.ops.render.render(write_still=True)
        if tag == 'clay':
            for o, mats in saved:
                for s, m in zip(o.material_slots, mats):
                    s.material = m
        sidecar['views'].append({'view': vid, 'tag': tag, 'posBlender': list(loc), 'targetBlender': list(tar),
                                 'lensMm': c['lensMm'], 'resolution': [args.width, round(args.width * 3 / 4)]})

(args.out / 'cameras.json').write_text(json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(args.out / 'scene.blend'))
print(f'SCENE_READY {args.out} views={args.views}')
