"""B1 — courtyard strip walls for west-band gaps > 1.5 m: one box per strip
(plaster + 瓦帽 cap, design_inference), exported as ONE GLB in world coords.

Vertices are authored directly in WORLD coordinates (identity object
transforms): the previous version placed Blender objects at (wx, h/2, wz) and
relied on exporter axis conventions, which exported the strips floating at
world y=|wz| with z=-1.45 — and its collider filter ('westshops:') matched
none of the actual 'westshops-strips:*' records, so the GLB shipped empty.

Run: blender -b --factory-startup -t 4 -P kit/build_weststrips.py -- \
      --strip-glb kit/out/westshops/westshops-strips.glb
"""
import bpy, json, math, sys
from pathlib import Path

argv = sys.argv[sys.argv.index('--') + 1:]
out_glb = Path(argv[argv.index('--strip-glb') + 1])
ROOT = Path('/home/baibai/outbox/pawborough-v1-candidate-night-20260918/workspace')
coll = json.loads((ROOT / 'world/fangbang-temple-v3/collision-world.json').read_text())

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
    return m


M_plaster = mat('strip-plaster', (0.72, 0.70, 0.66, 1))
M_roof = mat('strip-cap', (0.42, 0.44, 0.45, 1))

# world-space box: center (wx, wy, wz), size (l, h, t), rotated by yaw about +Y
# (same rotation convention as the collision records: wx += c*lx + s*lz,
#  wz += -s*lx + c*lz)
FACES = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


def box_world(name, center, size, yaw, material):
    """Vertices authored in the PAGE'S Blender frame: glTF(x,y,z) imports as
    (x, -z, y), and this exporter maps Blender (x,y,z) back to glTF (x, z,
    -y) — so writing (wx, -wz, height) survives the round trip exactly."""
    wx, wy, wz = center
    l, h, t = size
    c, s = math.cos(yaw), math.sin(yaw)
    verts = []
    for sy in (-1, 1):
        for sz in (-1, 1):
            for sx in (-1, 1):
                lx, ly, lz = sx * l / 2, sy * h / 2, sz * t / 2
                ux = wx + c * lx + s * lz
                uz = wz - s * lx + c * lz
                verts.append((ux, -uz, wy + ly))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], FACES)
    me.validate()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.data.materials.append(material)
    return o


n_strips = 0
for c in coll['colliders']:
    if not c['name'].startswith('westshops-strips:'):
        continue
    o = c['obb']
    yaw = o['theta']
    wx, wy, wz = o['pos']
    size = o['size']  # (t, h, gap) — thickness, height, length along the road
    sid = c['name'].split(':')[1]
    box_world(f'strip__{sid}__plaster', (wx, wy, wz), (size[0], size[1], size[2]), yaw, M_plaster)
    box_world(f'strip__{sid}__cap', (wx, wy + size[1] / 2 + 0.05, wz),
              (size[0] + 0.12, 0.1, size[2] + 0.12), yaw, M_roof)
    n_strips += 1

import bmesh  # noqa: E402  (outward normals — recalc per R1-06)
for _o in scene.objects:
    if _o.type != 'MESH':
        continue
    _b = bmesh.new()
    _b.from_mesh(_o.data)
    bmesh.ops.recalc_face_normals(_b, faces=_b.faces)
    _b.to_mesh(_o.data)
    _b.free()
    _o.data.update()

for image in bpy.data.images:
    if image.filepath:
        image.pack()
out_glb.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format='GLB', export_yup=True,
                          export_animations=False, export_tangents=False,
                          export_cameras=False, export_lights=False)
print(f'WESTSTRIPS_READY file={out_glb} strips={n_strips}')
