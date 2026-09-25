"""bazaar-tower-kit 导出后重导入核对（Skill：导出 GLB 重新导入一次，逐项核对）。

新开 Blender 空场导入 model.glb，核对：锚 empty 位姿、网格节点齐全、材质槽与贴图
实际连接（图片已内嵌/可解包）、alphaMode（格心 MASK / 玻璃 BLEND）、包围盒与高度、
三角数，写 reimport.json。任何一项不符 exit 1。

运行：blender -b --python-exit-code 1 -P modules/bazaar-tower-kit/check_reimport.py -- \
      [--dir out-bazaar-towers/bld-428202599]
"""
import bpy, json, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DIR = os.path.join(ROOT, arg('--dir', os.path.join('out-bazaar-towers', 'bld-428202599')))
GLB = os.path.join(DIR, 'model.glb')
P = json.load(open(os.path.join(DIR, 'measurements.json'), encoding='utf-8'))

ID = os.path.basename(DIR)
LAYOUT = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
obj = next(o for o in LAYOUT['objects'] if o['id'] == ID)
FP = [q for q in obj['geometry']['footprint'] if True]
if FP[0] == FP[-1]:
    FP = FP[:-1]
a = cx = cz = 0.0
for i in range(len(FP)):
    x0, z0 = FP[i]
    x1, z1 = FP[(i + 1) % len(FP)]
    cr = x0 * z1 - x1 * z0
    a += cr
    cx += (x0 + x1) * cr
    cz += (z0 + z1) * cr
ACX, ACZ = cx / (6 * a * 0.5), cz / (6 * a * 0.5)

bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=GLB)
imported = [o for o in bpy.data.objects if o not in before]
report = {'file': GLB, 'importedObjects': len(imported), 'checks': [], 'ok': True}
def check(name, cond, detail=''):
    report['checks'].append({'name': name, 'ok': bool(cond), 'detail': detail})
    if not cond:
        report['ok'] = False
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + detail if detail else ''))

anchor = next((o for o in imported if o.name == ID and o.type == 'EMPTY'), None)
check('锚 empty 存在', anchor is not None)
if anchor:
    # glTF 导入后锚位于 Blender (ACX, -ACZ, 0)
    d = math.hypot(anchor.location.x - ACX, anchor.location.y - (-ACZ))
    check('锚位于面积形心（偏差 %.4f ≤ 0.1）' % d, d <= 0.1,
          'loc=(%.3f, %.3f, %.3f)' % (anchor.location.x, anchor.location.y, anchor.location.z))

meshes = [o for o in imported if o.type == 'MESH']
check('网格节点数 %d ≥ 30' % len(meshes), len(meshes) >= 30)
tris = 0
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
    mw = o.matrix_world
    for c in o.bound_box:
        w = mw @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
check('重导入三角 %d 与 measurements %s 一致（±1）' % (tris, P['triangles']), abs(tris - P['triangles']) <= 1)
check('重导入高度 %.2f == %.2f' % (mx.z, P['maxY']), abs(mx.z - P['maxY']) < 0.02)
_fx = [q[0] for q in FP]; _fz = [q[1] for q in FP]
check('重导入平面范围落在该楼 footprint 包围盒 ±3 m 内（x %.1f..%.1f, y %.1f..%.1f）' % (mn.x, mx.x, mn.y, mx.y),
      min(_fx) - 3 < mn.x and mx.x < max(_fx) + 3 and -max(_fz) - 3 < mn.y and mx.y < -min(_fz) + 3)

# 材质槽与贴图连接
bad_mat, imgs, alpha = [], [], {}
for o in meshes:
    if not o.data.materials or o.data.materials[0] is None:
        bad_mat.append(o.name)
        continue
    m = o.data.materials[0]
    if not m.use_nodes:
        bad_mat.append(o.name + ':no-nodes')
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bad_mat.append(o.name + ':no-bsdf')
    base = bsdf.inputs['Base Color'] if bsdf else None
    linked = base.is_linked if base else False
    if not linked:
        # 允许解析色材质（gild/glass/dark），其余须有贴图
        if not any(k in m.name for k in ('gild', 'glass', 'dark', 'shopback', 'lacquer', 'signred', 'lantern')):
            bad_mat.append(o.name + ':base-color-not-textured')
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            imgs.append((m.name, n.image.name, n.image.size[:], n.image.packed_file is not None))
    try:
        alpha[m.name] = (m.blend_method,
                         'linked' if (bsdf and bsdf.inputs['Alpha'].is_linked) else (bsdf.inputs['Alpha'].default_value if bsdf else 1.0))
    except Exception:
        pass
check('全部网格有可用材质槽且贴图/解析色连接完整', len(bad_mat) == 0, str(bad_mat[:5]))
img_names = sorted(set(i[1] for i in imgs))
check('贴图实际连接 ≥ 5 张（roof/timber/plaster/stone/lattice）', len(img_names) >= 5, str(img_names))
check('贴图已内嵌（packed）', all(i[3] for i in imgs))
lat = [k for k in alpha if 'lattice' in k]
gls = [k for k in alpha if 'glass' in k]
# Blender 4.5 将 glTF MASK 导入为 HASHED；判断标准=Alpha 输入已连接到贴图 + 混合模式为遮罩类
check('格心材质 Alpha 已连接、混合模式为遮罩类', bool(lat) and alpha[lat[0]][0] in ('CLIP', 'MASK', 'HASHED')
      and alpha[lat[0]][1] == 'linked', str(alpha.get(lat[0]) if lat else None))
_PP = json.load(open(os.path.join(HERE, P['params']), encoding='utf-8'))
_GA = _PP['materials']['glassAlpha']
check('玻璃材质为 BLEND 且 alpha≈%.2f（params）' % _GA, bool(gls) and alpha[gls[0]][0] == 'BLEND' and abs(alpha[gls[0]][1] - _GA) < 0.02,
      str(alpha.get(gls[0]) if gls else None))
report['materials'] = {k: str(v) for k, v in alpha.items()}
report['images'] = [{'material': i[0], 'image': i[1], 'size': i[2]} for i in sorted(set(imgs))]

json.dump(report, open(os.path.join(DIR, 'reimport.json'), 'w'), ensure_ascii=False, indent=1)
print('REIMPORT_OK' if report['ok'] else 'REIMPORT_FAIL')
sys.exit(0 if report['ok'] else 1)
