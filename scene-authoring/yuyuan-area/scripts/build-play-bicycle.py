"""派生实时自行车（小吃工单 20261001「自行车」）。

复用 kit/build_props.py 的 bicycle-28 原语段（原件与原脚本都不改）：同款
轮圈/辐条/车架杆件造型语言与单色材质（dark-iron #44453d、deep-door-lacquer
#252320、oxblood 木 #542c25），按约 0.964m 灰猫骑手重新定尺寸（小轮/低座），
并拆出实时动画需要的分件节点。

坐标契约（GOAL.md）：统一 Y-up / -Z 前向。本脚本在 Blender Z-up 空间按
「+Y 前进、+Z 上、X 左右轴」建模，export_yup 转换后即 GLB 的 -Z 前向。

分件名（Three 端 rig 依赖，web/play/bike-view.js）：
  play-bicycle (root)
  ├─ frame / saddle / basket / rear-rack
  ├─ steering ─ fork / handlebar / front-wheel ─ front-wheel__*
  ├─ rear-wheel ─ rear-wheel__*
  ├─ crank ─ crank-arm-f / pedal-f / crank-arm-b / pedal-b
  └─ seat-anchor / anchor-mount / anchor-dismount (empties)

Run:
  blender -b --factory-startup -t 4 -P scripts/build-play-bicycle.py -- \
    --out /abs/path/to/artifacts/vehicle --workspace /abs/path/to/workspace
输出：play-bicycle.glb + measurements.json（GLB/blend 不进 Git；
sha256/bytes/分件清单由调用方写回 inputs/play-vehicle.json 等入库元数据）。
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--workspace', type=Path, default=None)
a = p.parse_args(argv)
sys.stdout.reconfigure(line_buffering=True)
T0 = time.time()

# --- 场景与材质（复刻 build_props 的单色无图材质语言） ---
bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(c):
    return tuple(((v / 255) ** 2.2) for v in (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)))


def mat(name, color, rough, metal=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    pr = m.node_tree.nodes.get('Principled BSDF')
    pr.inputs['Base Color'].default_value = (*lin(color), 1)
    pr.inputs['Roughness'].default_value = rough
    pr.inputs['Metallic'].default_value = metal
    return m


M = {
    'iron': mat('dark-iron', '44453d', .64, .48),      # 同 build_props L.M['iron']
    'dark': mat('deep-door-lacquer', '252320', .53),   # 同 build_props L.M['dark']（轮胎/座面）
    'wood': mat('oxblood-stained-timber', '542c25', .65),  # 车篮木（同 world 货箱木色）
}

# --- 尺寸（米；灰猫 0.964m 骑手 · 小轮/低座） ---
WHEEL_R = 0.17
WB = 0.36            # 轴距半长（y 向前 +）
BB = (0.0, -0.02, 0.24)
SEAT_TOP = 0.56
HEAD = (0.0, 0.33, 0.62)   # 车把中点


def cyl(name, a, b, r, m='iron', sides=10):
    va, vb = Vector(a), Vector(b)
    d = vb - va
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length, location=(va + vb) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.data.materials.append(M[m])
    return o


def rod(name, a, b, w, m='iron'):
    return cyl(name, a, b, w, m, 6)


def box(name, c, s, m='iron', bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.object
    o.name = name
    o.scale = (s[0], s[1], s[2])
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
    o.data.materials.append(M[m])
    return o


def wheel_mesh(prefix, center, m='iron'):
    """build_props bicycle 段同款：薄圈盘 + 小毂 + 4 直径辐条（轴沿 X）。"""
    cx, cy, cz = center
    cyl(f'{prefix}__dark-tire', (cx, cy, cz - 0.01), (cx, cy, cz + 0.01), WHEEL_R, 'dark', 12)
    cyl(f'{prefix}__iron-rim', (cx, cy + 0.012, cz - 0.01), (cx, cy + 0.012, cz + 0.01), WHEEL_R - 0.015, m, 12)
    cyl(f'{prefix}__iron-hub', (cx, cy - 0.02, cz - 0.012), (cx, cy - 0.02, cz + 0.012), 0.02, m, 6)
    rr = WHEEL_R - 0.03
    sy = cy + 0.02   # 辐条面（毂另一侧）
    for k in range(4):
        ang = math.pi * k / 4
        rod(f'{prefix}__iron-spoke-{k}',
            (cx, sy, cz - rr * math.cos(ang)),
            (cx, sy, cz + rr * math.cos(ang)),
            0.005, m)
    # k=0/2 已是一根直径；再补一根正交直径（共 8 向辐条）
    rod(f'{prefix}__iron-spoke-x', (cx, sy, cz - rr), (cx, sy, cz + rr), 0.005, m)


def join_selected(name):
    # 由调用方先设选择；这里对当前选中集合 join
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o


def parent_keep(o, parent):
    o.parent = parent
    o.matrix_parent_inverse = parent.matrix_world.inverted()


# --- 车架（静态杆件，同 build_props 的杆语言） ---
SEAT = (0.0, -0.06, 0.50)
HEAD_LO = (0.0, 0.355, 0.30)
frame_parts = [
    rod('frame-down-tube', BB, HEAD_LO, 0.018),
    rod('frame-top-tube', SEAT, (HEAD[0], HEAD[1] - 0.02, HEAD[2] - 0.04), 0.016),
    rod('frame-seat-tube', BB, SEAT, 0.018),
    rod('frame-chain-stay', (0, -WB, WHEEL_R), BB, 0.012),
    rod('frame-seat-stay', (0, -WB, WHEEL_R), SEAT, 0.012),
    rod('frame-kick-foot', BB, (0, -0.02, 0.02), 0.01),
]
for o in frame_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = frame_parts[0]
join_selected('frame')

# 座位 / 车篮 / 后货架
box('saddle', (0, -0.06, SEAT_TOP - 0.005), (0.10, 0.24, 0.035), 'dark')
basket_parts = []
for (c, s) in [
    ((0, 0.42, 0.44), (0.30, 0.20, 0.014)),     # 底
    ((0, 0.33, 0.52), (0.30, 0.014, 0.16)),     # 后壁（贴把立）
    ((0, 0.51, 0.52), (0.30, 0.014, 0.16)),     # 前壁
    ((-0.148, 0.42, 0.52), (0.014, 0.20, 0.16)),
    ((0.148, 0.42, 0.52), (0.014, 0.20, 0.16)),
]:
    basket_parts.append(box('basket-wood', c, s, 'wood', 0))
for o in basket_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = basket_parts[0]
join_selected('basket')
box('rear-rack', (0, -0.40, 0.30), (0.22, 0.16, 0.016), 'iron')

# --- steering 组：叉 + 车把 + 前轮（空节点为枢轴） ---
bpy.ops.object.empty_add(location=(HEAD[0], HEAD[1], (HEAD_LO[2] + HEAD[2]) / 2))
steering = bpy.context.object
steering.name = 'steering'
steering.empty_display_size = 0.05

fork = rod('fork-iron', HEAD_LO, (0, WB, WHEEL_R), 0.014)
grips = [
    rod('handlebar-iron', (-0.22, HEAD[1], HEAD[2]), (0.22, HEAD[1], HEAD[2]), 0.014),
    box('handlebar-grip-dark', (-0.24, HEAD[1], HEAD[2]), (0.05, 0.025, 0.025), 'dark'),
    box('handlebar-grip-dark', (0.24, HEAD[1], HEAD[2]), (0.05, 0.025, 0.025), 'dark'),
]

bpy.ops.object.empty_add(location=(0, WB, WHEEL_R))
fw = bpy.context.object
fw.name = 'front-wheel'
fw.empty_display_size = 0.03
fw.parent = steering
fw.matrix_parent_inverse = steering.matrix_world.inverted()
wheel_mesh('front-wheel', (0, WB, WHEEL_R))
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o.name.startswith('front-wheel__') and not o.parent:
        parent_keep(o, fw)

# --- 后轮 ---
bpy.ops.object.empty_add(location=(0, -WB, WHEEL_R))
rw = bpy.context.object
rw.name = 'rear-wheel'
rw.empty_display_size = 0.03
wheel_mesh('rear-wheel', (0, -WB, WHEEL_R))
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o.name.startswith('rear-wheel__') and not o.parent:
        parent_keep(o, rw)

# --- crank 组：双曲柄 + 双踏板（绕 BB 的 X 轴转） ---
bpy.ops.object.empty_add(location=BB)
crank = bpy.context.object
crank.name = 'crank'
crank.empty_display_size = 0.03
CP = 0.155   # 曲柄半径
crank_parts = [
    rod('crank-arm-f', (0.055, BB[1], BB[2]), (0.055, BB[1], BB[2] + CP), 0.011),
    box('pedal-f', (0.055, BB[1] + 0.01, BB[2] + CP), (0.09, 0.06, 0.014), 'dark'),
    rod('crank-arm-b', (-0.055, BB[1], BB[2]), (-0.055, BB[1], BB[2] - CP), 0.011),
    box('pedal-b', (-0.055, BB[1] - 0.01, BB[2] - CP), (0.09, 0.06, 0.014), 'dark'),
]
for o in crank_parts:
    o.parent = crank
    o.matrix_parent_inverse = crank.matrix_world.inverted()

# --- 锚点（Three 端骑乘/下车参考） ---
def empty(name, loc):
    bpy.ops.object.empty_add(location=loc)
    e = bpy.context.object
    e.name = name
    e.empty_display_size = 0.04
    return e


seat_anchor = empty('seat-anchor', (0, -0.06, SEAT_TOP + 0.01))
empty('anchor-mount', (0.45, -0.06, 0.02))
empty('anchor-dismount', (-0.55, -0.06, 0.02))

# 根节点：把所有顶层对象收进 play-bicycle
bpy.ops.object.empty_add(location=(0, 0, 0))
root = bpy.context.object
root.name = 'play-bicycle'
root.empty_display_size = 0.1
for o in list(bpy.context.scene.objects):
    if o is root or o.parent:
        continue
    o.parent = root

# --- 三角化 + 导出 ---
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for o in root.children_recursive:
    if o.type != 'MESH':
        continue
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()

out = a.out
out.mkdir(parents=True, exist_ok=True)
glb_path = out / 'play-bicycle.glb'
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', export_yup=True,
                          export_apply=True, export_animations=False, export_tangents=False,
                          export_cameras=False, export_lights=False)
data = glb_path.read_bytes()

tris = 0
for o in root.children_recursive:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)

measure = {
    'moduleId': 'play-bicycle',
    'derivedFrom': 'kit/build_props.py bicycle-28 primitive section (original untouched)',
    'axis': 'GLB Y-up; -Z forward; origin at ground center between wheels',
    'riderHeightM': 0.964,
    'wheelRadiusM': WHEEL_R,
    'wheelbaseHalfM': WB,
    'seatTopM': SEAT_TOP,
    'colliderHalfExtentsM': [0.34, 0.68, 0.82],
    'parts': ['frame', 'saddle', 'basket', 'rear-rack', 'steering', 'front-wheel',
              'rear-wheel', 'crank', 'seat-anchor', 'anchor-mount', 'anchor-dismount'],
    'triangles': tris,
    'fileBytes': len(data),
    'sha256': hashlib.sha256(data).hexdigest(),
    'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
}
(out / 'measurements.json').write_text(json.dumps(measure, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# 工作区运行时资源（resources/ 整体 gitignore，不入 Git）
if a.workspace:
    rdir = a.workspace / 'scene-authoring' / 'yuyuan-area' / 'resources' / 'vehicles'
    rdir.mkdir(parents=True, exist_ok=True)
    (rdir / 'play-bicycle.glb').write_bytes(data)

print(f"PLAY_BICYCLE_READY tris={tris} bytes={len(data)} sha256={measure['sha256'][:12]}… total={time.time() - T0:.1f}s")
