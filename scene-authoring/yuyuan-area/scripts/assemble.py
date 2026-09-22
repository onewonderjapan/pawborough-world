# Blender 总装：程序化分区 GLB + L2 只读引用（门楼/店屋/庙区v3精修件）-> 总场景。
# 坐标契约：layout.json 的 (x, z) 地图系 -> Blender (x, -z, z-up)；导出 GLB 时转回 Y-up。
# 所有 L2 模块只读导入 + 链接复制实例，不修改源文件。
import bpy, json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, os.environ.get('OUT_DIR', 'out'))
LAYOUT = json.load(open(os.path.join(OUT, 'layout.json'), encoding='utf-8'))

SHOP_ROOT = os.path.join(ROOT, 'resources/shops')
TEMPLE_V3 = os.path.join(ROOT, 'resources/temple-v3')
GATE_FILE = os.path.join(ROOT, 'inputs', 'yuyuan-gate-v2.glb')
MODULE_FILE = {
    'temple-shanmen': 'temple.glb', 'temple-entry-court-v3': 'entry-court-v3.glb',
    'yimen-pilot': 'yimen.glb', 'yimen-stage': 'yimen-stage.glb', 'dadian-court-v2': 'dadian-court-v2.glb',
    'peidian': 'peidian.glb', 'gallery': 'gallery.glb', 'dadian': 'dadian.glb',
    'court3': 'court3.glb', 'houdian': 'houdian.glb', 'temple-tree-camphor': 'tree-camphor-v2.glb',
}

# ---------- 清场 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def coll(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
    return c

def import_glb(path, collname):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    tgt = coll(collname)
    for o in new:
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        tgt.objects.link(o)
    return new

def place(objs, inst):
    """把模块对象链接复制到实例位姿下，返回空父。"""
    x, z = inst['position']
    anchor = bpy.data.objects.new(inst['id'], None)
    anchor.empty_display_size = 2
    anchor.location = (x, -z, 0)
    anchor.rotation_euler = (0, 0, inst['rotY'])
    anchor['id'] = inst['id']
    anchor['module'] = inst['module']
    anchor['zone'] = inst['zone']
    anchor['lod'] = inst['lod']
    anchor['sha256'] = inst.get('sha256', '')
    anchor['sourcePath'] = inst.get('sourcePath', '')
    tgt = coll('INST-' + inst['zone'])
    tgt.objects.link(anchor)
    for o in objs:
        dup = o.copy()  # 链接复制：共享 mesh/材质/贴图数据
        dup.hide_render = False
        dup.hide_viewport = False
        tgt.objects.link(dup)
        dup.parent = anchor
    return anchor

# ---------- 程序化分区 ----------
proc_files = {
    'garden': 'procedural-garden.glb', 'temple': 'procedural-temple.glb',
    'bazaar': 'procedural-bazaar.glb', 'pond': 'procedural-pond.glb', 'outer': 'procedural-outer.glb',
}
for z, f in proc_files.items():
    p = os.path.join(OUT, f)
    if os.path.exists(p):
        import_glb(p, 'ZONE-' + z)
        print('imported', z)

# ---------- L2 模块库（各导入一次，之后链接复制） ----------
module_cache = {}

def module_objs(module, base_path, sub):
    key = module
    if key not in module_cache:
        path = os.path.join(base_path, sub.get(module, module + '/model.glb'))
        objs = import_glb(path, 'MODLIB')
        # 把库对象移出渲染集合（隐藏库本体，只渲染实例）
        for o in objs:
            o.hide_render = True
            o.hide_viewport = True
        module_cache[key] = objs
    return module_cache[key]

gate_objs = None
shop_objs = {}
temple_objs = {}

for inst in LAYOUT['instances']:
    if inst['module'] == 'yuyuan-gate-v2':
        if gate_objs is None:
            gate_objs = import_glb(GATE_FILE, 'MODLIB')
            for o in gate_objs:
                o.hide_render = True
                o.hide_viewport = True
        place(gate_objs, inst)
    elif inst['module'].startswith('shop-'):
        if inst['module'] not in shop_objs:
            objs = import_glb(os.path.join(SHOP_ROOT, inst['module'], 'model.glb'), 'MODLIB')
            for o in objs:
                o.hide_render = True
                o.hide_viewport = True
            shop_objs[inst['module']] = objs
        place(shop_objs[inst['module']], inst)
    elif inst['module'] in MODULE_FILE:
        if inst['module'] not in temple_objs:
            objs = import_glb(os.path.join(TEMPLE_V3, MODULE_FILE[inst['module']]), 'MODLIB')
            for o in objs:
                o.hide_render = True
                o.hide_viewport = True
            temple_objs[inst['module']] = objs
        place(temple_objs[inst['module']], inst)
    else:
        print('SKIP unknown module', inst['module'])

# MODLIB 收藏不导出
modlib = bpy.data.collections.get('MODLIB')

def select_only(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        for ch in o.children_recursive:
            ch.select_set(True)
        o.select_set(True)

def export_glb(path, objects):
    select_only(objects)
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_extras=True, export_yup=True, use_selection=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True)
    print('exported', path, os.path.getsize(path), 'bytes')

all_objs = [o for c in ('ZONE-garden', 'ZONE-temple', 'ZONE-bazaar', 'ZONE-pond', 'ZONE-outer',
                        'INST-garden', 'INST-temple', 'INST-bazaar', 'INST-outer')
            if c in bpy.data.collections for o in bpy.data.collections[c].objects]

def zone_objects(zones):
    sel = []
    for z in zones:
        for c in ('ZONE-' + z, 'INST-' + z):
            if c in bpy.data.collections:
                sel.extend(bpy.data.collections[c].objects)
    return sel

# 保存 blend（可重开总装）
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'scene.blend'))
print('saved scene.blend')

export_glb(os.path.join(OUT, 'scene-areas.glb'), all_objs)
export_glb(os.path.join(OUT, 'garden.glb'), zone_objects(['garden']))
export_glb(os.path.join(OUT, 'temple.glb'), zone_objects(['temple']))
export_glb(os.path.join(OUT, 'bazaar.glb'), zone_objects(['bazaar']))

# 实例清单回写
stats = {
    'instances': len(LAYOUT['instances']),
    'modules': {'gate': 1, 'shops': len(shop_objs), 'temple': len(temple_objs)},
    'sceneObjects': len(all_objs),
}
json.dump(stats, open(os.path.join(OUT, 'assemble-stats.json'), 'w'), indent=1)
print('ASSEMBLE DONE', json.dumps(stats))
