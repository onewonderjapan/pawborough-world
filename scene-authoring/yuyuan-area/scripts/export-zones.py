# 分区运行时导出（ZONE_SPLIT）：总装 scene.blend（含食品）→ 每区一个 zone-<z>.glb + zones-manifest.json。
# scene-areas.glb 保留为离线校验/路线射线用的全量产物（不再作为浏览器单文件，也不再设 30 MB 上限）；
# 浏览器按 zones-manifest 逐区加载，每区单独限额 ZONE_CAP_BYTES（默认 12 MB）。
# 用法：OUT_DIR=out-zone blender -b --python-exit-code 1 -P scripts/export-zones.py
import bpy, json, os, re, hashlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, os.environ.get('OUT_DIR', 'out'))
CAP = int(os.environ.get('ZONE_CAP_BYTES', '12000000'))
ROCKERY_IDS = {'rockery-dajiashan', 'rockery-yulinglong'}

def is_rockery_obj(o):
    cur = o
    while cur is not None:
        if cur.name in ROCKERY_IDS or cur.get('id') in ROCKERY_IDS:
            return True
        cur = cur.parent
    return False
# (zone, part, collections, instance-module filter)。一个分区可拆成多个分件（同 zone id，查看器按 zone 切换）。
# 庙区 v3 精修件单区 >12 MB（大殿一件 6.3 MB），按轴线拆三件：
#   1 山门/前院/仪门/戏台/樟树 + 庙墙与程序化底面 | 2 大殿院/配殿/廊庑/大殿 | 3 三进院/后殿
TEMPLE_FRONT = {'temple-shanmen', 'temple-entry-court-v3', 'yimen-pilot', 'yimen-stage', 'temple-tree-camphor'}
TEMPLE_REAR = {'court3', 'houdian'}
PARTS = [
    ('garden', 1, ['ZONE-garden', 'INST-garden', 'SITE-garden'], None),
    ('pond',   1, ['ZONE-pond', 'SITE-pond'], None),
    ('temple', 1, ['ZONE-temple', 'SITE-temple', 'INST-temple'], lambda m: m in TEMPLE_FRONT or not m),   # untagged INST objects (labels/anchors) stay with part 1
    ('temple', 2, ['INST-temple'], lambda m: bool(m) and m not in TEMPLE_FRONT and m not in TEMPLE_REAR),
    ('temple', 3, ['INST-temple'], lambda m: m in TEMPLE_REAR),
    ('bazaar', 1, ['ZONE-bazaar', 'INST-bazaar', 'FOOD-bazaar'], None),
    ('outer',  1, ['ZONE-outer', 'INST-outer'], None),
]
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'scene.blend'))
# 同名同尺寸贴图合并（同 assemble.py SITE_MODULES 路径的做法；只省字节，不改材质）
seen = {}
for img in list(bpy.data.images):
    if img.source != 'FILE' or img.size[0] == 0: continue
    k = (re.sub(r'\.\d{3}$', '', img.name), img.size[0], img.size[1])
    if k in seen: img.user_remap(seen[k]); bpy.data.images.remove(img)
    else: seen[k] = img
def objs_of(colls, flt=None):
    out = []
    for c in colls:
        if c not in bpy.data.collections: continue
        for o in bpy.data.collections[c].objects:
            # place() links each instance copy into INST-* AND parents it to the instance anchor → resolve module via the anchor
            mod = o.get('module') or (o.parent.get('module', '') if o.parent else '')
            if flt and c.startswith('INST-') and not flt(mod): continue
            if flt and not c.startswith('INST-') and part_index != 1: continue
            out.append(o)
    return out
def export(path, objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs:
        o.select_set(True)
        for ch in o.children_recursive: ch.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_extras=True, export_yup=True, use_selection=True)
def bounds(objs):
    import mathutils
    mn = [1e9] * 3; mx = [-1e9] * 3
    for o in objs:
        for ob in [o] + list(o.children_recursive):
            if ob.type != 'MESH': continue
            for c in ob.bound_box:
                w = ob.matrix_world @ mathutils.Vector(c)
                g = (w.x, w.z, -w.y)  # Blender Z-up → glTF Y-up
                for i in range(3): mn[i] = min(mn[i], g[i]); mx[i] = max(mx[i], g[i])
    return [[round(v, 2) for v in mn], [round(v, 2) for v in mx]]
order = []
for z, *_ in PARTS:
    if z not in order: order.append(z)
manifest = {'schema': 2, 'capPerZoneBytes': CAP, 'order': order, 'zones': []}
for z, part_index, colls, flt in PARTS:
    objs = objs_of(colls, flt)
    rockery_part = []
    # 假山网格约 3.5 MB，并进现有 zone-garden.glb（已 9.6 MB）会超过 12 MB。
    # 假山站点模块（默认开启，ROCKERY_KIT=0 关闭）时把两个锚及其子网格拆到 zone-garden-2.glb，主文件名仍是 zone-garden.glb。
    if z == 'garden' and part_index == 1 and os.environ.get('ROCKERY_KIT', '1') != '0':
        rockery_part = [o for o in objs if is_rockery_obj(o)]
        drop = {id(o) for o in rockery_part}
        objs = [o for o in objs if id(o) not in drop]
    f = f'zone-{z}.glb' if sum(1 for p in PARTS if p[0] == z) == 1 else f'zone-{z}-{part_index}.glb'
    p = os.path.join(OUT, f)
    if not objs:
        manifest['zones'].append({'id': z, 'part': part_index, 'file': None, 'empty': True}); continue
    export(p, objs)
    b = open(p, 'rb').read()
    manifest['zones'].append({'id': z, 'part': part_index, 'file': f, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest(),
                              'collections': [c for c in colls if c in bpy.data.collections],
                              'objects': len(objs), 'bounds': bounds(objs), 'withinCap': len(b) <= CAP})
    print('zone', z, part_index, len(b), 'bytes')
    if rockery_part:
        f2 = 'zone-garden-2.glb'
        p2 = os.path.join(OUT, f2)
        export(p2, rockery_part)
        b2 = open(p2, 'rb').read()
        manifest['zones'].append({'id': 'garden', 'part': 2, 'file': f2, 'bytes': len(b2), 'sha256': hashlib.sha256(b2).hexdigest(),
                                  'collections': ['SITE-garden'], 'objects': len(rockery_part),
                                  'bounds': bounds(rockery_part), 'withinCap': len(b2) <= CAP,
                                  'note': 'ROCKERY_KIT site modules; split so zone-garden.glb stays within cap'})
        print('zone garden 2', len(b2), 'bytes')
manifest['totalBytes'] = sum(zz.get('bytes', 0) for zz in manifest['zones'])
json.dump(manifest, open(os.path.join(OUT, 'zones-manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ZONES DONE total', manifest['totalBytes'], 'cap/zone', CAP)
