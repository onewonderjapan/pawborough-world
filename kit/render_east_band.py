"""J6 east-band Blender evidence (adoption batch 20260919).

Assembles the east band with REAL materials — street-completion tail surface,
east-extension surface, end wall, courtyard strips, and the nine upgraded
modules at their block positions (from world/fangbang-temple-v4/blocks.json
block-east-shops) — applies the F0 unified light rig and renders the three
east contract cameras + aerial-overview through Cycles + OIDN with the
blank-frame guard.

Run:
  blender -b --factory-startup -P kit/render_east_band.py -- \
      --out artifacts/east-band/stills-blender
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
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
a = p.parse_args(argv)
ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / 'world/fangbang-temple-v4'

CAMS = ['east-junction', 'east-road-mid', 'east-end-wall', 'aerial-overview']

T0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_at(path, pos=(0, 0, 0), yaw=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in set(bpy.data.objects) - before]
    for r in [o for o in new if o.parent is None or o.parent not in new]:
        r.location = (pos[0], -pos[2], pos[1])
        r.rotation_mode = 'XYZ'
        r.rotation_euler.z = yaw


import_at(ROOT / 'world/street-completion/surface.glb')
import_at(DS / 'east-extension' / 'surface.glb')
import_at(DS / 'east-extension' / 'seal-wall.glb')
strips = DS / 'eastshops-strips.glb'
if strips.exists():
    import_at(strips)

blocks = json.loads((DS / 'blocks.json').read_text())
east_block = next(b for b in blocks['blocks'] if b['id'] == 'block-east-shops')
for asset in east_block['assets']:
    if asset['id'] == 'eastshops-strips':
        continue
    pos = asset['positionGlb']
    import_at(ROOT / asset['glb'].lstrip('./'), (pos[0], pos[1], pos[2]), asset['rotationYRad'])

light_rig.apply(scene)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = a.samples
scene.render.resolution_x = a.width
scene.render.resolution_y = a.height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'

cam_data = bpy.data.cameras.new('eastband-cam')
cam = bpy.data.objects.new('eastband-cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36.0

contract = json.loads((DS / 'cameras.json').read_text())
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
    filepath = a.out / f'eastband-{cid}.png'
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

print(f"EAST_BAND_STILLS_DONE n={len(CAMS)} blank={failures} total={time.time() - T0:.1f}s")
sys.exit(1 if failures else 0)
