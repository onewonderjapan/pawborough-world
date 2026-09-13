"""Geometry-level checks on the reimported reviewed GLB that the glTF validator
cannot do: (1) the horizontal main-road ribbons really face up (+Y), (2) every
mesh material slot is filled and every image node is a real connected image,
(3) the unique image set matches the manifest's sceneImages count.

Run: blender -b --factory-startup -t 4 -P check_world_geometry.py -- --glb world/street-reviewed.glb
"""
import argparse
import json
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--glb', type=Path, required=True)
A = p.parse_args(argv)
WS = Path(__file__).resolve().parents[1]
manifest = json.loads((WS / 'world/review-manifest.json').read_text(encoding='utf-8'))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(A.glb.resolve()))
bpy.context.view_layer.update()

bad_road = []
road_faces = 0
empty_slots = []
for o in bpy.context.scene.objects:
    if o.type != 'MESH':
        continue
    is_road = 'street-kit__' in o.name and 'asphalt' in o.name.lower()
    me = o.data
    me.calc_loop_triangles()
    if is_road:
        me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
    for t in me.loop_triangles:
        n = t.normal  # blender-space triangle normal (imported GLB is Z-up here)
        if is_road:
            road_faces += 1
            if n.z < .99:  # GLB +Y up == blender +Z; the road must face the sky
                bad_road.append({'mesh': o.name, 'normal': [round(c, 4) for c in n]})
    for i, slot in enumerate(me.materials):
        if slot is None:
            empty_slots.append({'mesh': o.name, 'slot': i})

images = {}
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            im = n.image
            images[im.name] = {'size': list(im.size), 'hasData': bool(im.has_data or im.packed_file)}

report = {
    'glb': str(A.glb.resolve()),
    'roadUpFaces': road_faces,
    'roadDownOrSidewaysFaces': len(bad_road),
    'roadSamples': bad_road[:8],
    'emptyMaterialSlots': empty_slots[:8],
    'emptyMaterialSlotCount': len(empty_slots),
    'uniqueImages': len(images),
    'manifestSceneImages': manifest.get('sceneImages', {}).get('count'),
    'imagesWithNoData': sorted(k for k, v in images.items() if v['size'] == [0, 0]),
    'allImagesConnected': bool(images) and all(v['size'] != [0, 0] for v in images.values()),
    'imageCountMatchesManifest': len(images) == manifest.get('sceneImages', {}).get('count', -1),
}
ok = (road_faces > 0 and not bad_road and not empty_slots
      and report['allImagesConnected'] and report['imageCountMatchesManifest'])
report['verdict'] = 'PASS' if ok else 'FAIL'
out = WS.parent / 'artifacts/r2/geometry-check.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('WORLD_GEOMETRY', json.dumps({k: report[k] for k in
      ('verdict', 'roadUpFaces', 'roadDownOrSidewaysFaces', 'uniqueImages', 'imageCountMatchesManifest', 'allImagesConnected')}))
sys.exit(0 if ok else 1)
