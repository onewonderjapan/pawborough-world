"""I3 evidence stills (adoption batch 20260919) — temple-axis-v3 with trees v2.

Assembles the temple-axis-v3 dataset (15 GLBs at their page placements + the
four tree-camphor-v2 instances at the adopted positions) with REAL materials,
applies the F0 unified light rig, and renders the three contract cameras
through Cycles + OIDN with the blank-frame guard. Evidence for the tree v2
adoption (owner G12): court2-pair / court3-axis / axis-aerial.

Run:
  blender -b --factory-startup -P kit/render_axis_v3_trees_v2.py -- \
      --out artifacts/adoption-east/stills-blender
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import numpy as np  # noqa: E402
import sys as _sys
import pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))
import light_rig  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--ds', type=Path, default=Path('world/temple-axis-v3'))
p.add_argument('--tree-glb', type=Path, default=Path('kit/out/tree-camphor/tree-camphor-v2.glb'))
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
a = p.parse_args(argv)

TREES = {
    'tree-court2-w': (-6.7, 0, -33.2),
    'tree-court2-e': (8.6, 0, -33.2),
    'tree-court3-w': (-13.0, 0, -61.0),
    'tree-court3-e': (14.0, 0, -62.0),
}
CAMS = ['court2-pair', 'court3-axis', 'axis-aerial']
# page placements (src/templeV3Main.js contract): [file, pos(x,0,z), yaw]
ASSETS = [
    ['temple.glb', (0, 0, 0), 0.0], ['ground.glb', (0, 0, 0), 0.0],
    ['lions-v2.glb', (0, 0, 0), 0.0], ['ornaments-v2.glb', (0, 0, 0), 0.0],
    ['yimen.glb', (0, 0, -21), 0.0], ['yimen-stage.glb', (0, 0, -21), 0.0],
    ['entry-court-v3.glb', (0, 0, 0), 0.0], ['dadian-court-v2.glb', (0, 0, 0), 0.0],
    ['peidian.glb', (-11.2, 0, -35.8), math.pi / 2],
    ['peidian.glb', (11.2, 0, -35.8), -math.pi / 2],
    ['gallery.glb', (-10.78, 0, -30.99), math.pi / 2],
    ['gallery.glb', (10.78, 0, -30.99), -math.pi / 2],
    ['dadian.glb', (0, 0, -44), 0.0], ['court3.glb', (0, 0, 0), 0.0],
    ['houdian.glb', (0, 0, -74), 0.0],
]

T0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_at(path, pos, yaw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in set(bpy.data.objects) - before]
    for r in [o for o in new if o.parent is None or o.parent not in new]:
        r.location = (pos[0], -pos[2], pos[1])
        r.rotation_mode = 'XYZ'
        r.rotation_euler.z = yaw


for f, pos, yaw in ASSETS:
    import_at(a.ds / f, pos, yaw)
for tid, pos in TREES.items():
    import_at(a.tree_glb, pos, 0.0)

light_rig.apply(scene)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = a.samples
scene.render.resolution_x = a.width
scene.render.resolution_y = a.height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'

cam_data = bpy.data.cameras.new('evidence-cam')
cam = bpy.data.objects.new('evidence-cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36.0

contract = json.loads((a.ds / 'cameras.json').read_text())
cams = {c['id']: c for c in contract['cameras']}

a.out.mkdir(parents=True, exist_ok=True)
failures = 0
for cid in CAMS:
    c = cams[cid]
    px, py, pz = c['positionGlb']
    tx, ty, tz = c['targetGlb']
    cam.location = Vector((px, -pz, py))
    direction = Vector((tx, -tz, ty)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    vfov = math.radians(c['verticalFovDegrees'])
    tan_h = math.tan(vfov / 2) * (a.width / a.height)
    cam_data.lens = (cam_data.sensor_width / 2) / tan_h

    t0 = time.time()
    filepath = a.out / f'trees-v2-{cid}.png'
    scene.render.filepath = str(filepath)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(filepath))
    w, h = img.size
    buf = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    std = float(buf[..., :3].std() * 255)
    vals, counts = np.unique((buf[..., :3] * 255).astype(np.uint8).reshape(-1, 3), axis=0, return_counts=True)
    dominant = float(counts.max() / counts.sum())
    blank = std < 2 or dominant > 0.95
    print(f"STILL {cid}: {time.time() - t0:.1f}s std={std:.1f}/255 dominant={dominant:.3f} blank={blank}")
    if blank:
        failures += 1

print(f"AXIS_V3_TREES_V2_STILLS_DONE n={len(CAMS)} blank={failures} total={time.time() - T0:.1f}s")
sys.exit(1 if failures else 0)
