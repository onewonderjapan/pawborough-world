"""T1 plaque close-up evidence renders (BLENDER CPU, same conventions as
build_temple_scene.py: AgX, one sun, 1280x960). Three azimuths — 0deg and
+/-20deg, matching the repair-test raycast directions — each in PBR and clay,
from the repaired dataset temple.glb. The text face must read as carrying the
glyph texture; the frame rings step back around it.

Run:
  blender -b --factory-startup -t 4 -P kit/render_plaque_detail.py -- \
      --out kit/out/temple-shanmen-repair/renders
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1280)
p.add_argument('--samples', type=int, default=24)
args = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / 'world' / 'temple-shanmen'
cfg = json.loads((ROOT / 'kit' / 'temple-shanmen.config.json').read_text(encoding='utf-8'))
pl = cfg['plaque']
cy = (pl['bottomY'] + pl['topY']) / 2

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(DS / 'temple.glb'))
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1

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
cam.data.sensor_fit = 'VERTICAL'
cam.data.sensor_width = 36

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.62, 0.60, 0.57, 1)
clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 3 / 4)
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

meshes = [o for o in scene.objects if o.type == 'MESH']


def look_at(loc, target):
    cam.location = loc
    d = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
    rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, target))))
    rot_z = math.atan2(d[1], d[0]) - math.pi / 2
    cam.rotation_euler = (rot_x, 0.0, rot_z)


args.out.mkdir(parents=True, exist_ok=True)
sidecar = {'source': 'kit/render_plaque_detail.py', 'engine': 'cycles-cpu', 'samples': args.samples,
           'views': [], 'note': 'T1 plaque close-ups at the raycast azimuths; BLENDER evidence'}
PLAN = [(0, 'plaque-front'), (20, 'plaque-left20'), (-20, 'plaque-right20')]
for deg, name in PLAN:
    a = math.radians(deg)
    fov_deg = 30.0
    dist = 4.4
    loc = (dist * math.sin(a), cy + 0.22, dist * math.cos(a))
    target = (0.0, cy, 0.08)
    look_at(loc, target)
    # lens via measured effective half-sensor (VERTICAL fit resolves against
    # Blender's own sensor height; measure, correct once, then assert)
    cam.data.lens = 36.0 / (2.0 * math.tan(math.radians(fov_deg) / 2.0))
    got = math.degrees(cam.data.angle)
    if abs(got - fov_deg) > 1e-4:
        half = cam.data.lens * math.tan(math.radians(got) / 2.0)
        cam.data.lens = half / math.tan(math.radians(fov_deg) / 2.0)
        got = math.degrees(cam.data.angle)
    if abs(got - fov_deg) > 1e-3:
        sys.exit(f'{name}: fov {got:.4f} != {fov_deg} (radians conversion bug?)')
    for tag in ('pbr', 'clay'):
        if tag == 'clay':
            saved = [(o, [s.material for s in o.material_slots]) for o in meshes]
            for o in meshes:
                for s in o.material_slots:
                    s.material = clay
        scene.render.filepath = str(args.out / f'{name}-{tag}.png')
        bpy.ops.render.render(write_still=True)
        if tag == 'clay':
            for o, mats in saved:
                for s, m in zip(o.material_slots, mats):
                    s.material = m
        sidecar['views'].append({'view': name, 'tag': tag, 'azimuthDeg': deg,
                                 'posBlender': list(loc), 'targetBlender': list(target),
                                 'fovDegVerified': round(got, 4),
                                 'file': f'{name}-{tag}.png'})
    print(f'RENDERED {name} fov={got:.3f}deg')

(args.out / 'plaque-cameras.json').write_text(json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
print(f'PLAQUE_DETAIL_READY views={len(PLAN) * 2} out={args.out}')
