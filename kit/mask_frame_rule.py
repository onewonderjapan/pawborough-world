"""I1 frame-rule mask renders (adoption batch 20260919).

Assembles the temple-axis-v3 scene (the 15 dataset GLBs at their page
placements + the four tree v2 instances) in Blender, paints trees BLACK and
everything else WHITE, and renders the three frozen cameras. Canopy pixels =
dark pixels against the white world/buildings — with REAL occlusion, unlike a
trees-only stand-in. Central 60% x 60% must contain zero canopy pixels
(owner G12 frame rule). Writes frame-rule.json.

Run:
  blender -b --factory-startup -P kit/mask_frame_rule.py -- \
      --ds world/temple-axis-v3 \
      --tree-glb kit/out/tree-camphor/tree-camphor-v2.glb \
      --out artifacts/adoption-east/frame-rule.json
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--ds', type=Path, default=Path('world/temple-axis-v3'))
p.add_argument('--tree-glb', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--resolution', default='1280x720')
a = p.parse_args(argv)

# adopted v2 tree positions (temple-local glb) + shift distances from spec
TREES = {
    'tree-court2-w': (-6.7, 0, -33.2),
    'tree-court2-e': (8.6, 0, -33.2),
    'tree-court3-w': (-13.0, 0, -61.0),
    'tree-court3-e': (14.0, 0, -62.0),
}
SHIFTED_BY = {'tree-court2-w': 1.90, 'tree-court2-e': 0.0, 'tree-court3-w': 0.0, 'tree-court3-e': 1.41}
CAM_IDS = ['court2-pair', 'court3-axis', 'houdian-front']
W, H = (int(v) for v in a.resolution.split('x'))
CENTRAL = 0.6
# page placements (src/templeV3Main.js contract): [file, pos(x,0,z), yaw]
ASSETS = [
    ['temple.glb', (0, 0, 0), 0.0], ['ground.glb', (0, 0, 0), 0.0],
    ['lions-v2.glb', (0, 0, 0), 0.0], ['ornaments-v2.glb', (0, 0, 0), 0.0],
    ['yimen.glb', (0, 0, -21), 0.0], ['yimen-stage.glb', (0, 0, -21), 0.0],
    ['entry-court-v3.glb', (0, 0, 0), 0.0],
    ['dadian-court-v2.glb', (0, 0, 0), 0.0],
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

white = bpy.data.materials.new('mask-white')
white.use_nodes = True
white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
black = bpy.data.materials.new('mask-black')
black.use_nodes = True
black.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0, 0, 0, 1)


def import_at(path, pos, yaw, is_tree):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in set(bpy.data.objects) - before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    for r in roots:
        r.location = (pos[0], -pos[2], pos[1])
        r.rotation_mode = 'XYZ'
        r.rotation_euler.z = yaw
    for o in new:
        if o.type != 'MESH':
            continue
        o.data.materials.clear()
        o.data.materials.append(black if is_tree else white)


for f, pos, yaw in ASSETS:
    import_at(a.ds / f, pos, yaw, is_tree=False)
for tid, pos in TREES.items():
    import_at(a.tree_glb, pos, 0.0, is_tree=True)

world = bpy.data.worlds.new('white')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)

scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.film_transparent = False

cam_data = bpy.data.cameras.new('mask-cam')
cam = bpy.data.objects.new('mask-cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36.0

contract = json.loads((a.ds / 'cameras.json').read_text())
cams = {c['id']: c for c in contract['cameras']}

results = []
for cid in CAM_IDS:
    c = cams[cid]
    px, py, pz = c['positionGlb']
    tx, ty, tz = c['targetGlb']
    cam.location = Vector((px, -pz, py))
    direction = Vector((tx, -tz, ty)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    vfov = math.radians(c['verticalFovDegrees'])
    tan_h = math.tan(vfov / 2) * (W / H)
    cam_data.lens = (cam_data.sensor_width / 2) / tan_h

    scene.render.filepath = str(a.out.parent / f'frame-rule-{cid}.png')
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)

    img = bpy.data.images.load(scene.render.filepath)
    w, h = img.size
    buf = list(img.pixels)
    x0, x1 = int(w * (1 - CENTRAL) / 2), int(w * (1 + CENTRAL) / 2)
    y0, y1 = int(h * (1 - CENTRAL) / 2), int(h * (1 + CENTRAL) / 2)
    central_px = central_hit = full_hit = full_px = 0
    for yy in range(h):
        for xx in range(w):
            i = (yy * w + xx) * 4
            dark = (buf[i] + buf[i + 1] + buf[i + 2]) / 3 < 0.5
            if not dark:
                continue
            full_hit += 1
            full_px += 1
            if x0 <= xx < x1 and y0 <= yy < y1:
                central_hit += 1
                central_px += 1
    total = w * h
    results.append({
        'camera': cid,
        'canopyCentralRatio': round(central_hit / max(central_px, 1), 6),
        'canopyFullRatio': round(full_hit / total, 6),
        'maskBasis': 'full temple-axis-v3 scene, trees black / all else white (real occlusion)',
    })
    print(f"FRAME_RULE {cid}: central={results[-1]['canopyCentralRatio']} full={results[-1]['canopyFullRatio']}")
    bpy.data.images.remove(img)

out = {
    'generatedBy': 'kit/mask_frame_rule.py',
    'resolution': a.resolution,
    'centralRegion': CENTRAL,
    'positions': {k: list(v) for k, v in TREES.items()},
    'shiftsFromSpec': SHIFTED_BY,
    'cameras': results,
    'totalSeconds': round(time.time() - T0, 1),
}
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
worst = max(r['canopyCentralRatio'] for r in results)
print(f'FRAME_RULE_DONE worst={worst} out={a.out} total={out["totalSeconds"]}s')
sys.exit(0 if worst == 0 else 4)
