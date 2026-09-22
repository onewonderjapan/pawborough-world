# G5 食品只读接入：把 inputs/FOOD_INPUT 来源的手持 LOD 道具与桌面合集资件
# 按 food-placement.json 放进稳定 food_socket（out-goal-03/04 预留位）。
# 源 GLB 只读导入 + 链接复制；每实例只保留单档 LOD 节点 + 必要子件（lid/straw）。
# 在 scene.blend 总装基础上增量叠加，重导出 scene-areas.glb / bazaar.glb。
# 用法：OUT_DIR=out-goal-05 blender -b -P scripts/assemble-food.py [-- 仅样例]
#   ONLY_STALLS=stall-1（环境变量，逗号分隔）只接入样例摊位自检；缺省全部 86 socket。
import bpy, json, math, os
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, os.environ.get('OUT_DIR', 'out'))
ONLY = [s for s in os.environ.get('ONLY_STALLS', '').split(',') if s]

plan = json.load(open(os.path.join(OUT, 'food-placement.json'), encoding='utf-8'))
placements = [p for p in plan['placements'] if not ONLY or p['stall'] in ONLY]
print('food placements to assemble:', len(placements), 'only:', ONLY or 'ALL')

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'scene.blend'))
scene = bpy.context.scene

def coll(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
    return c

food_coll = coll('FOOD-bazaar')

def import_glb(path, collname):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path if os.path.isabs(path) else os.path.join(ROOT,path))
    new = [o for o in bpy.data.objects if o not in before]
    tgt = coll(collname)
    for o in new:
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        tgt.objects.link(o)
    return new

# ---------- 食品库：每个来源文件只导入一次（隐藏库本体，链接复制出实例） ----------
food_lib = {}
def lib_objs(source):
    if source not in food_lib:
        objs = import_glb(source, 'MODLIB-FOOD')
        for o in objs:
            o.hide_render = True
            o.hide_viewport = True
        food_lib[source] = objs
    return food_lib[source]

def by_name(objs, name, source):
    hits = [o for o in objs if o.name == name or o.name.split('.')[0] == name]
    if not hits:
        raise KeyError(f'{name} not found in {source} ({[o.name for o in objs]})')
    return hits[0]

# ---------- 逐 socket 放置 ----------
def loc_of(o):
    m = o.matrix_basis
    return (m.to_translation(), m.to_quaternion(), m.to_scale())

placed = 0
for p in placements:
    anchor = bpy.data.objects.new(p['sceneNode'], None)  # 名=socketId，稳定 ID 贯穿
    x, h, z = p['worldPosition']
    anchor.location = (x, -z, h)          # GLB Y-up 世界系 -> Blender Z-up
    anchor.rotation_euler = (0, 0, p['worldRotY'])
    anchor.empty_display_size = 0.3
    anchor['id'] = p['socketId']
    anchor['stall'] = p['stall']
    anchor['module'] = 'food'
    anchor['zone'] = p['zone']
    anchor['foodItem'] = p['item']
    anchor['lod'] = p['lod'] if p['lod'] is not None else 'single'
    anchor['sourcePath'] = p['source']
    anchor['foodUse'] = p['foodUse']
    food_coll.objects.link(anchor)

    src = lib_objs(p['source'])
    # 保留节点：手持件=选中 LOD 节点+lid/straw 子件；合集件=prop__ 节点
    keep = [p['node']] + list(p['extras']) if p['sourceKind'] == 'handheld_lod' else [p['node']]
    for nm in keep:
        o = by_name(src, nm, p['source'])
        dup = o.copy()  # 链接复制：共享 mesh/材质/贴图
        dup.hide_render = False
        dup.hide_viewport = False
        food_coll.objects.link(dup)
        dup.parent = anchor
        if p['sourceKind'] == 'tabletop_collection':
            # 合集文件把各件摆在接触表网格上：剥掉网格平移，保留朝向/缩放（含 Y-up->Z-up 换轴）
            t, q, s = loc_of(dup)
            dup.matrix_basis = mathutils.Matrix.Translation((0, 0, 0)) @ q.to_matrix().to_4x4() @ mathutils.Matrix.Diagonal((*s, 1))
    placed += 1
print('food instances placed:', placed)

# ---------- 导出 ----------
def select_only(collnames):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for cn in collnames:
        c = bpy.data.collections.get(cn)
        if not c:
            continue
        for o in c.objects:
            for ch in o.children_recursive:
                ch.select_set(True)
            o.select_set(True)

def export_glb(path, collnames):
    select_only(collnames)
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_extras=True, export_yup=True, use_selection=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True)
    print('exported', path, os.path.getsize(path), 'bytes')

# blend 回存（总装含食品实例，可重开）
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'scene.blend'))
print('saved scene.blend (with food)')

allc = ['ZONE-garden', 'ZONE-temple', 'ZONE-bazaar', 'ZONE-pond', 'ZONE-outer',
        'INST-garden', 'INST-temple', 'INST-bazaar', 'INST-outer', 'FOOD-bazaar']
export_glb(os.path.join(OUT, 'scene-areas.glb'), allc)
export_glb(os.path.join(OUT, 'bazaar.glb'), ['ZONE-bazaar', 'INST-bazaar', 'FOOD-bazaar'])

# assemble-stats.json 增量刷新（viewer HUD 数据源）：对象数按本次导出集合实数
scene_objects = sum(len(bpy.data.collections[c].objects) for c in allc if c in bpy.data.collections)
stats_path = os.path.join(OUT, 'assemble-stats.json')
stats = json.load(open(stats_path, encoding='utf-8')) if os.path.exists(stats_path) else {}
stats.update({
    'sceneObjects': scene_objects,
    'food': {'instances': placed, 'sources': sorted(food_lib.keys()),
             'note': 'G5 只读食品接入（scripts/assemble-food.py）；分配见 food-placement.json，核验见 food-check.json'},
})
json.dump(stats, open(stats_path, 'w'), indent=1)
print('FOOD ASSEMBLE DONE', placed, 'instances, sceneObjects', scene_objects)
