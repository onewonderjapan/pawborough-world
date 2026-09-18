"""B1 — courtyard strip walls for west-band gaps > 1.5 m: one box per strip
(plaster + 瓦帽 cap, design_inference), exported as ONE GLB in world coords.

Run: blender -b --factory-startup -t 4 -P kit/build_weststrips.py -- \
      --strip-glb kit/out/westshops/westshops-strips.glb
"""
import bpy, bmesh, json, math, sys
from pathlib import Path

argv = sys.argv[sys.argv.index('--') + 1:]
out_glb = Path(argv[argv.index('--strip-glb') + 1])
ROOT = Path('/home/baibai/outbox/pawborough-v1-candidate-night-20260918/workspace')
coll = json.loads((ROOT / 'world/fangbang-temple-v3/collision-world.json').read_text())

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# minimal palette: plaster + roof cap
def mat(name, color):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
    return m
M_plaster = mat('strip-plaster', (0.72, 0.70, 0.66, 1))
M_roof = mat('strip-cap', (0.42, 0.44, 0.45, 1))

def box(name, center, size, material):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object; o.name = name
    o.scale = (size[0]/2, size[1]/2, size[2]/2)
    o.location = center
    o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o

sys.path.insert(0, str(ROOT / 'kit'))
for c in coll['colliders']:
    if not c['name'].startswith('westshops:'):
        continue
    o = c['obb']
    yaw = o['theta']
    cx, cy, cz = o['pos'][0], 1.45, o['pos'][2]
    # blender: (x, -z, y); strip runs along its local length axis
    co, si = math.cos(yaw), math.sin(yaw)
    l_half = o['size'][2] / 2 if o['size'][2] >= o['size'][0] else o['size'][0] / 2
    t_half = (o['size'][0] if o['size'][2] >= o['size'][0] else o['size'][2]) / 2
    h = o['size'][1]
    # body
    bx = box(f'strip__{c["name"].split(":")[1]}__plaster',
             (cx, h / 2, cz), (l_half * 2, h, t_half * 2), M_plaster)
    bx.rotation_euler = (0, 0, -yaw)
    bx2 = box(f'strip__{c["name"].split(":")[1]}__cap',
              (cx, h + 0.05, cz), (l_half * 2 + 0.12, 0.1, t_half * 2 + 0.12), M_roof)
    bx2.rotation_euler = (0, 0, -yaw)

for image in bpy.data.images:
    if image.filepath: image.pack()
out_glb.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format='GLB', export_yup=True,
                          export_apply=True, export_animations=False, export_tangents=False,
                          export_cameras=False, export_lights=False)
print(f'WESTSTRIPS_READY file={out_glb}')
