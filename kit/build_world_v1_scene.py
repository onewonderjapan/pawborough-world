"""C3 — v1.0 candidate VIDEO SOURCE project: kit/build_world_v1_scene.py
assembles the FULL fangbang-temple-v3 world (street + surfaces + 15
temple-axis-V2 assets + 17 westshop modules + strips + remaining grays) PLUS
the street-sidefaces skins (M-batch world-baked at identity, A-batch shared
centered skins instanced per visible face), carries ALL 26 contract cameras
(street 8 + bridge 8 + temple 10, dataset-prefixed ids), packs textures, and
saves kit/out/scene-v1/scene-v1.blend.

Reopen check (spec): blender -b scene-v1.blend -P kit/check_scene_v1.py
must report missing_images=0 and cameras=26.

Run:
  blender -b --factory-startup -t 4 -P kit/build_world_v1_scene.py -- \
      --out kit/out/scene-v1 [--samples 24] [--render aerial,shanmen-from-road,court2-pair] [--device CPU|GPU]
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=Path('kit/out/scene-v1'))
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
p.add_argument('--render', type=str, default='aerial,shanmen-from-road,court2-pair')
p.add_argument('--device', type=str, default='CPU', choices=['CPU', 'GPU'])
args = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent
DS_DIR = ROOT / 'world' / 'fangbang-temple-v3'
T = [-127.817, 0.0, 27.057]
YAW = 0.16703
_v1m = json.loads((ROOT / 'world' / 'fangbang-temple' / 'review-manifest.json').read_text(encoding='utf-8'))
assert _v1m['templeAxis']['translationGlb'][0] == T[0] and abs(_v1m['templeAxis']['yawRad'] - YAW) < 1e-9
blocks = json.loads((DS_DIR / 'blocks.json').read_text(encoding='utf-8'))
_v3m = json.loads((DS_DIR / 'review-manifest.json').read_text(encoding='utf-8'))
W, H = args.width, args.height

# --- 26 contract cameras, dataset-prefixed --------------------------------
def cams_of(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))['cameras']

# street cameras carry lensMm (+36mm sensor, VERTICAL fit); convert to the
# same verticalFovDegrees contract the bridge/temple sets use
def normalize(c):
    c = dict(c)
    if 'verticalFovDegrees' not in c:
        c['verticalFovDegrees'] = round(math.degrees(2 * math.atan(18.0 / c['lensMm'])), 4)
    return c

CAMERAS = []
for c in cams_of('world/cameras.json')[:8]:                     # street 8 (main-street set)
    CAMERAS.append({**normalize(c), 'id': f'street:{c["id"]}'})
for c in cams_of('world/fangbang-temple-v2/cameras.json'):      # bridge 8
    CAMERAS.append({**c, 'id': f'bridge:{c["id"]}'})
for c in cams_of('world/temple-axis-v2/cameras.json'):          # temple 10
    CAMERAS.append({**c, 'id': f'temple:{c["id"]}'})
assert len(CAMERAS) == 26, f'expected 26 cameras, got {len(CAMERAS)}'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def import_glb(path, loc_bl=None, rot_z=0.0):
    """GLB(x,y,z) -> Blender(x,-z,y); GLB yaw +Y -> Blender Z -yaw (assembly
    convention; temple keeps +yaw like the physics page, see v2 scene)."""
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    for o in new:
        if o.parent is None or o.parent in before:
            o.rotation_mode = 'XYZ'  # R1-03
            if loc_bl:
                o.location.x += loc_bl[0]
                o.location.y += loc_bl[1]
                o.location.z += loc_bl[2]
            if rot_z:
                o.rotation_euler.z += rot_z
    return new


# --- world assembly (identical to kit/build_westshops_v3_scene.py) ---------
import_glb(ROOT / 'world/street-reviewed.glb')
import_glb(DS_DIR / 'west-extension/surface.glb')
import_glb(DS_DIR / 'west-extension/seal-wall.glb')
import_glb(DS_DIR / 'west-extension/forecourt-bounds.glb')
import_glb(ROOT / 'world/street-completion/surface.glb')
for a in _v3m['templeAxis']['assets']:
    import_glb(ROOT / a['glb'].lstrip('./'),
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])
wsb = next(x for x in blocks['blocks'] if x['id'] == 'block-west-shops')
n_ws = 0
for a in wsb['assets']:
    import_glb(ROOT / a['glb'].lstrip('./'),
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])
    n_ws += 1
import_glb(DS_DIR / 'westshops-strips.glb')

# --- skins (page ?skins=1 semantics, replicated) ----------------------------
sk_dir = ROOT / 'world' / 'street-sidefaces'
sk_manifest = json.loads((sk_dir / 'review-manifest.json').read_text(encoding='utf-8'))
sk_instances = json.loads((sk_dir / 'instances.json').read_text(encoding='utf-8'))
skin_by_id = {s['id']: s for s in sk_manifest['skins']}
n_m = n_a = 0
for i in sk_instances['instances']:
    k = skin_by_id[i['skin']]
    if i['batch'] == 'A':
        # centered shared skin, instanced at the face's world transform
        import_glb(ROOT / k['glb'].lstrip('./'),
                   loc_bl=(i['positionGlb'][0], -i['positionGlb'][2], i['positionGlb'][1]),
                   rot_z=+i['rotationYRad'])
        n_a += 1
    else:
        # M-batch skins are baked in world coordinates — identity placement
        import_glb(ROOT / k['glb'].lstrip('./'))
        n_m += 1

# --- normals, placeholder grays --------------------------------------------
import bmesh as _bm
for _o in scene.objects:
    if _o.type != 'MESH':
        continue
    _b = _bm.new()
    _b.from_mesh(_o.data)
    _bm.ops.recalc_face_normals(_b, faces=_b.faces)
    _b.to_mesh(_o.data)
    _b.free()
    _o.data.update()

gray = bpy.data.materials.new('placeholder-gray')
gray.use_nodes = True
gb = gray.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.60, 0.63, 0.60, 1)
gb.inputs['Roughness'].default_value = 0.95
n_boxes = 0
for ph in blocks['placeholders']:
    if ph['replacedBy']:
        continue
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = f'placeholder__{ph["id"]}'
    o.scale = (ph['widthM'], ph['depthM'], ph['heightM'])
    o.location = (ph['glbPoint'][0], -ph['glbPoint'][1], ph['heightM'] / 2)
    o.rotation_euler.z = -ph['angleRad']
    o.data.materials.append(gray)
    n_boxes += 1

# --- lights + world ----------------------------------------------------------
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 2.8
sun.rotation_euler = (math.radians(55), 0.0, math.radians(-35))
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
scene.collection.objects.link(fill)
fill.data.energy = 0.9
fill.data.color = (0.92, 0.94, 1.0)
fill.rotation_euler = (math.radians(35), 0.0, math.radians(145))
bl_world = bpy.data.worlds.new('world')
scene.world = bl_world
bl_world.use_nodes = True
bl_world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.82, 0.88, 1)
bl_world.node_tree.nodes['Background'].inputs[1].default_value = 0.6

# --- 26 cameras into a dedicated collection ----------------------------------
cam_col = bpy.data.collections.new('v1_cameras')
scene.collection.children.link(cam_col)
cam_data = bpy.data.cameras.new('cam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_width = 36
cam_data.clip_end = 1200


def look_at(obj, loc, target):
    obj.location = loc
    d = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
    rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, target))))
    rot_z = math.atan2(d[1], d[0]) - math.pi / 2
    obj.rotation_euler = (rot_x, 0.0, rot_z)


cam_objects = {}
for c in CAMERAS:
    cd = cam_data.copy()
    cd.angle = math.radians(c['verticalFovDegrees'])
    o = bpy.data.objects.new(f'cam__{c["id"]}', cd)
    cam_col.objects.link(o)
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    look_at(o, loc, tar)
    o['targetGlb'] = json.dumps(c['targetGlb'])
    o['verticalFovDegrees'] = c['verticalFovDegrees']
    cam_objects[c['id']] = o

# --- render settings ----------------------------------------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
if args.device == 'GPU':
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'

# --- pack textures + save ------------------------------------------------------
bpy.ops.file.pack_all()
args.out.mkdir(parents=True, exist_ok=True)
blend_path = args.out / 'scene-v1.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

n_missing = sum(1 for img in bpy.data.images if img.source == 'FILE' and not img.packed_file)
sidecar = {
    'source': 'kit/build_world_v1_scene.py', 'blend': str(blend_path),
    'device': args.device, 'samples': args.samples, 'resolution': [W, H],
    'assembly': (f'street + surfaces + 15 temple-axis-V2 + {n_ws} westshop modules + strips '
                 f'+ skins (M {n_m} baked + A {n_a} instanced) + {n_boxes} remaining grays'),
    'cameras': [c['id'] for c in CAMERAS],
    'missingImagesAtSave': n_missing,
    'renders': [],
}
if n_missing:
    print(f'MISSING_IMAGES {n_missing}'); sys.exit(10)

RENDER_TARGETS = {
    'aerial': 'bridge:aerial-overview',
    'shanmen-from-road': 'bridge:shanmen-from-road',
    'court2-pair': 'temple:court2-pair',
}
for name in [x.strip() for x in args.render.split(',') if x.strip()]:
    cid = RENDER_TARGETS[name]
    scene.camera = cam_objects[cid]
    t0 = time.time()
    scene.render.filepath = str(args.out / f'scene-v1-{name}-{args.device.lower()}.png')
    bpy.ops.render.render(write_still=True)
    dt = round(time.time() - t0, 1)
    sidecar['renders'].append({'view': name, 'camera': cid, 'device': args.device, 'seconds': dt,
                               'file': scene.render.filepath.split('/')[-1]})
    print(f'RENDERED scene-v1-{name} device={args.device} {dt}s')

(args.out / 'scene-v1-report.json').write_text(json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
print(f'SCENE_V1_READY cameras={len(CAMERAS)} missingImages={n_missing} renders={len(sidecar["renders"])} out={args.out}')
