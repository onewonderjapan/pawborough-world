"""Assemble scene-lanes-v1.blend — the v5 candidate scene derived from GLBs
(the original world/scene.blend and all frozen assets are NOT modified).

Contents: the surgically patched v5 street assembly + the three lanes-v2
assets at their recorded placements + 4 render cameras (2 per lane). A
sidecar JSON records every asset's sha256 (asset versions).

Run: blender -b --factory-startup -t 4 -P kit/assemble_lanes_scene.py -- --out artifacts/lanes-construction/scene-lanes-v1.blend
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import mathutils
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent

ASSETS = [
    # (path, position, yaw) — placements identical to the v5 blocks.json
    ('world/fangbang-temple-v5/street-reviewed-lanes.glb', (0, 0, 0), 0.0),
    ('world/lanes-v2/lane-a/model.glb', (43.545, 0.09, -16.375), 3.1165),
    ('world/lanes-v2/lane-b-v2/model.glb', (57.418, 0.09, 14.2485), -0.4818),
    ('world/lanes-v2/interfaces/model.glb', (0, 0, 0), 0.0),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'

versions = []
for rel, pos, yaw in ASSETS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / rel))
    new = [o for o in bpy.data.objects if o not in before]
    root_objs = [o for o in new if o.parent is None or o.parent not in new]
    grp = bpy.data.objects.new(f'ASSET__{rel.split("/")[-2]}', None)
    bpy.context.scene.collection.objects.link(grp)
    for o in root_objs:
        o.parent = grp
    # glTF import already maps Y-up -> Z-up; yaw applies about world Z
    grp.location = (pos[0], -pos[2], pos[1] - 0.0)  # glTF (x,y,z) -> Blender (x,-z,y)
    grp.rotation_euler = (0, 0, yaw)
    versions.append({'path': rel, 'sha256': hashlib.sha256((ROOT / rel).read_bytes()).hexdigest(),
                     'positionGlb': list(pos), 'rotationYRad': yaw})

# daylight rig matching the page (sun from the southwest-high + sky ambient)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (0.9, 0, -2.2)
bpy.context.scene.collection.objects.link(sun)
world = bpy.data.worlds.new('daylight')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.8, 0.85, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
bpy.context.scene.world = world

import math

CAM_DEG = 55
CAMS = [
    # (name, glb position, glb target) — lane A forward / return, lane B forward / return
    ('lane-a-forward', (43.35, 1.6, -11.4), (43.6, 1.3, -23.5)),
    ('lane-a-return', (43.7, 1.6, -23.4), (43.2, 1.4, -11.0)),
    ('lane-b-forward', (57.7, 1.6, 13.6), (54.5, 1.3, 22.0)),
    ('lane-b-return', (53.6, 1.6, 22.2), (57.6, 1.4, 13.4)),
]
for name, pos, tgt in CAMS:
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.angle = 2 * math.atan(CAM_DEG / 2 * math.pi / 180)
    bpy.context.scene.collection.objects.link(cam)
    # glTF (x,y,z) -> Blender (x,-z,y); aim -Z along (target - position)
    p_b = (pos[0], -pos[2], pos[1])
    t_b = (tgt[0], -tgt[2], tgt[1])
    cam.location = p_b
    d = mathutils.Vector((t_b[0] - p_b[0], t_b[1] - p_b[1], t_b[2] - p_b[2]))
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam['targetGlb'] = list(tgt)
    cam['positionGlb'] = list(pos)

bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 24
bpy.context.scene.cycles.device = 'CPU'
bpy.context.scene.view_settings.view_transform = 'AgX'

a.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(a.out))
sidecar = a.out.with_suffix('.assets.json')
sidecar.write_text(json.dumps({
    'blend': 'artifacts/lanes-construction/scene-lanes-v1.blend',
    'derivedFrom': 'v5 GLB assembly (world/fangbang-temple-v5/street-reviewed-lanes.glb + world/lanes-v2/**); no frozen scene file modified',
    'assets': versions,
    'cameras': [{'name': n, 'positionGlb': p2, 'targetGlb': t2, 'verticalFovDegrees': CAM_DEG} for (n, p2, t2) in CAMS],
    'render': {'engine': 'cycles-cpu', 'samples': 24, 'viewTransform': 'AgX', 'threads': 4},
}, indent=2) + '\n', encoding='utf-8')
print(f'SCENE_SAVED {a.out}')
