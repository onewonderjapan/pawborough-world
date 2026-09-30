"""temple-east 宝鼎（wave14-templeeast）：庙东跨院北院的三足铜鼎 + 两级石座。

形制与尺寸照搬前院宝鼎（kit/build_entry_court.py --addBurner：大殿鼎构造 ×0.85，石座 1.4×0.22 + 1.05×0.18），
这里独立出件，只是为了能在庙东跨院单独摆放（前院鼎嵌在 entry-court-v3.glb 模块里，不能拆出复用）。
无贴图（纯色 PBR：青铜 6b4c30 metal .75 rough .45；石座 9a9a8c rough .92，与 kit/mb_lib worn-stone 同色）。
材质名带 templeeast- 前缀，避免与其它模块同名材质在压缩时互相顶替。

坐标契约：GLB Y-up，原点 = 石座底面中心，模块无朝向（三足一足朝 +Z）。
输出：<out>/model.glb、collision.json（本地盒：鼎身 1.1×1.3×1.1 + 石座 1.4×0.4×1.4）、measurements.json。
运行：blender -b --python-exit-code 1 -P modules/temple-east/build_ding.py -- [--out out-garden-kits/templeeast-ding]
"""
import argparse
import hashlib
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(AREA, 'out-garden-kits', 'templeeast-ding'))
args = ap.parse_args(argv)
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(h):
    v = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v]


def mat(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*lin(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


M = {'bronze': mat('templeeast-bronze', '6b4c30', .45, .75), 'stone': mat('templeeast-stone', '9a9a8c', .92)}
PARTS = []


def box(name, c, size, m):
    # glTF 系 (x, y 上, z) → Blender (x, -z, y)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(c[0], -c[2], c[1]))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(M[m])
    PARTS.append(ob)


def cyl(name, p0, p1, r, m, seg):
    # 竖直圆柱：p0/p1 只差 y
    h = p1[1] - p0[1]
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=(p0[0], -p0[2], p0[1] + h / 2))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(M[m])
    PARTS.append(ob)


# 与 kit/build_entry_court.py addBurner 同构造（×0.85）
bn = {'vesselR': .55 * .85, 'vesselH': .75 * .85, 'legR': .09 * .85, 'legH': .35 * .85,
      'pawBlockM': [.16 * .85, .08 * .85, .2 * .85], 'handleTubeR': .03 * .85, 'handleTorusR': .12 * .85,
      'lidDiscsM': [[.5 * .85, .06 * .85], [.34 * .85, .05 * .85]], 'finialR': .09 * .85}
y = 0.0
for w, h in ((1.4, .22), (1.05, .18)):
    box('ding-plinth', (0, y + h / 2, 0), (w, h, w), 'stone')
    y += h
cyl('ding-vessel', (0, y + .02, 0), (0, y + .02 + bn['vesselH'], 0), bn['vesselR'], 'bronze', 14)
leg_top = y + .02
for k in range(3):
    ang = math.pi / 2 + 2 * math.pi * k / 3
    lx, lz = bn['vesselR'] * .62 * math.cos(ang), bn['vesselR'] * .62 * math.sin(ang)
    cyl('ding-leg', (lx, leg_top - bn['legH'], lz), (lx, leg_top, lz), bn['legR'], 'bronze', 8)
    box('ding-paw', (lx, leg_top - bn['legH'] + bn['pawBlockM'][2] / 2, lz - .04), bn['pawBlockM'], 'bronze')
rim_y = leg_top + bn['vesselH']
for sgn in (-1, 1):
    x = sgn * bn['vesselR'] * .92
    cyl('ding-handle', (x, rim_y - .05, 0), (x, rim_y + bn['handleTorusR'] * 1.5, 0), bn['handleTubeR'], 'bronze', 8)
ly = rim_y + .04
for r, h in bn['lidDiscsM']:
    cyl('ding-lid-disc', (0, ly, 0), (0, ly + h, 0), r, 'bronze', 14)
    ly += h + .015
cyl('ding-finial', (0, ly, 0), (0, ly + bn['finialR'] * 1.6, 0), bn['finialR'], 'bronze', 10)
top_y = ly + bn['finialR'] * 1.6

# 按材质合并为两件（节点少，查看器按材质合批）
GROUPS = {key: [o.name for o in PARTS if o.data.materials[0] == M[key]] for key in ('bronze', 'stone')}
for key, names in GROUPS.items():
    obs = [bpy.data.objects[n] for n in names]
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = 'templeeast-ding__' + key

tris = 0
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
if tris > 900:
    raise SystemExit(f'ding budget: {tris} tris > 900')

glb = os.path.join(OUT, 'model.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, export_apply=True)
data = open(glb, 'rb').read()
coll = {'axis': 'glTF Y-up, module local, origin plinth ground centre', 'colliders': [
    {'name': 'ding-plinth', 'type': 'box', 'center': [0, 0.2, 0], 'size': [1.4, 0.4, 1.4]},
    {'name': 'ding-vessel-block', 'type': 'box', 'center': [0, 0.4 + 0.65, 0], 'size': [1.1, 1.3, 1.1]},
]}
json.dump(coll, open(os.path.join(OUT, 'collision.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump({'id': 'templeeast-ding', 'triangles': tris, 'glbBytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
           'topY': round(top_y, 3), 'plinthM': [1.4, 0.4], 'materials': ['templeeast-bronze', 'templeeast-stone'],
           'construction': 'kit/build_entry_court.py addBurner x0.85 (same as the entry-court burner)'},
          open(os.path.join(OUT, 'measurements.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('TEMPLE-EAST DING OK', tris, 'tris', len(data), 'bytes')
