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
#
# bazaar 分件（wave1-paving P1，2026-09-23）：**按内容类别**拆，与对象导入/填充顺序无关——
#   part 1  zone-bazaar.glb   街面：程序化街面对象（facadeBay 面元、paving/plaza 铺装地面、water、shopAnchor、
#                             outerBuilding 占位）+ INST-bazaar 全部实例（店屋 shop-*、摊位/长凳/檐棚 stall-kit）+
#                             FOOD-bazaar 全部（食品车）；
#   part 2  zone-bazaar-2.glb 大楼：ZONE-bazaar 里 kind == 'bazaarBlock' 的 16 座大楼体块
#                             （壁柱/窗组/檐口/屋面已并进每栋单 mesh，即「及其附属」）；
#                             BAZAAR_TOWERS=1 时另含 SITE-bazaar 的华宝楼站点模块
#                             （modules/bazaar-tower-kit，世界坐标 GLB，锚=面积形心）。
# 判定只看内容：ZONE-* 对象读 kind（glTF extras 转的 custom prop，兜底解析节点名 zone|id|kind|lod）；
# 实例/食品（INST-*/FOOD-*）一律属街面件，不看 kind。
TEMPLE_FRONT = {'temple-shanmen', 'temple-entry-court-v3', 'yimen-pilot', 'yimen-stage', 'temple-tree-camphor'}
TEMPLE_REAR = {'court3', 'houdian'}

def kind_of(o):
    k = o.get('kind')
    if k: return str(k)
    p = o.name.split('|')
    return p[2] if len(p) >= 4 else None

def is_bazaar_block(o, mod, collname):
    return collname == 'SITE-bazaar' or (collname == 'ZONE-bazaar' and kind_of(o) == 'bazaarBlock')

def is_bazaar_street(o, mod, collname):
    return not is_bazaar_block(o, mod, collname)

PARTS = [
    ('garden', 1, ['ZONE-garden', 'INST-garden', 'SITE-garden'], None),
    ('pond',   1, ['ZONE-pond', 'SITE-pond'], None),
    ('temple', 1, ['ZONE-temple', 'SITE-temple', 'INST-temple'], lambda o, m, c: c != 'INST-temple' or m in TEMPLE_FRONT or not m),   # module rule on INST only: SITE anchors carry module='garden-kit', ZONE carries none — both stay in part 1
    ('temple', 2, ['INST-temple'], lambda o, m, c: c == 'INST-temple' and bool(m) and m not in TEMPLE_FRONT and m not in TEMPLE_REAR),
    ('temple', 3, ['INST-temple'], lambda o, m, c: c == 'INST-temple' and m in TEMPLE_REAR),
    ('bazaar', 1, ['ZONE-bazaar', 'INST-bazaar', 'FOOD-bazaar'], is_bazaar_street),
    ('bazaar', 2, ['ZONE-bazaar', 'SITE-bazaar'], is_bazaar_block),
    ('outer',  1, ['ZONE-outer', 'INST-outer'], None),
]
# 分件文件名：单件区 zone-<z>.glb；多件区首件沿用 zone-<z>.glb（garden、bazaar：查看器/外部引用不换名），
# 后续件 zone-<z>-<n>.glb；庙区沿用历史命名 zone-temple-1/2/3.glb。
BASE_NAME_ZONES = {'garden', 'bazaar'}
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
            if flt and not flt(o, mod, c): continue
            out.append(o)
    return out
def export(path, objs, deny=()):
    # 精确选择：objs 及其子树 − deny（同区其它分件的根）及其子树，最后把 objs 根本身加回。
    # 原因：ZONE-* 网格全挂在 ZN-<z> group 空节点下，group 属街面件但子树横跨两件——
    # 只按子树加减会互相误伤（大楼 mesh 既是 part 2 的 objs 又是 part 1 所选 group 的子孙）。
    for o in bpy.context.view_layer.objects: o.select_set(False)
    want = set()
    for o in objs:
        want.add(o)
        want.update(o.children_recursive)
    for o in deny:
        want.discard(o)
        want.difference_update(o.children_recursive)
    for o in objs:
        want.add(o)
    for o in want:
        o.select_set(True)
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
n_parts = {z: sum(1 for p in PARTS if p[0] == z) for z in order}
manifest = {'schema': 2, 'capPerZoneBytes': CAP, 'order': order, 'zones': []}
# 第一遍收集每件清单（含 garden 假山拆件），第二遍带 deny 导出
plan = []
for z, part_index, colls, flt in PARTS:
    objs = objs_of(colls, flt)
    rockery_part = []
    # 假山网格约 3.5 MB，并进现有 zone-garden.glb（已 9.6 MB）会超过 12 MB。
    # 假山站点模块（默认开启，ROCKERY_KIT=0 关闭）时把两个锚及其子网格拆到 zone-garden-2.glb，主文件名仍是 zone-garden.glb。
    if z == 'garden' and part_index == 1 and os.environ.get('ROCKERY_KIT', '1') != '0':
        rockery_part = [o for o in objs if is_rockery_obj(o)]
        drop = {id(o) for o in rockery_part}
        objs = [o for o in objs if id(o) not in drop]
    f = (f'zone-{z}.glb' if (n_parts[z] == 1 or (part_index == 1 and z in BASE_NAME_ZONES))
         else f'zone-{z}-{part_index}.glb')
    plan.append({'zone': z, 'part': part_index, 'colls': colls, 'file': f, 'objs': objs, 'rockery': rockery_part})
by_zone = {}
for it in plan:
    by_zone.setdefault(it['zone'], []).extend(it['objs'] + it['rockery'])

# ---------- P2 地面铺装材质（wave1-paving）：按 build-scene 写入的 slot custom prop 绑定程序化贴图 ----------
# 贴图 1024² JPEG（resources/textures/paving/），scripts/bake-paving-textures.py 纯 numpy 生成，
# 无外部素材；UV 已在 build-scene.mjs 按世界坐标平铺（1 单位 = 1 m）。只换材质，不改几何。
PAVING_TEX_DIR = os.path.join(ROOT, 'resources', 'textures', 'paving')
paving_mats = {}
def paving_material(slot):
    if slot in paving_mats: return paving_mats[slot]
    jpg = os.path.join(PAVING_TEX_DIR, slot + '.jpg')
    if not os.path.exists(jpg):
        raise SystemExit(f'paving texture missing: {jpg} (run: blender -b -P scripts/bake-paving-textures.py)')
    img = bpy.data.images.load(jpg, check_existing=True)
    m = bpy.data.materials.new('paving-' + slot)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.93
    bsdf.inputs['Metallic'].default_value = 0.0
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    tex.extension = 'REPEAT'
    m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    paving_mats[slot] = m
    return m

def apply_paving(objs):
    n, seen = 0, set()
    for o in objs:
        for ob in [o] + list(o.children_recursive):
            if ob.type != 'MESH' or id(ob.data) in seen: continue
            seen.add(id(ob.data))
            slot = ob.get('slot')
            if not slot: continue
            slot = str(slot)
            if not ob.data.uv_layers:
                print('WARN paving slot without UV layer, skipped', ob.name)
                continue
            mat = paving_material(slot)
            if ob.data.materials: ob.data.materials[0] = mat
            else: ob.data.materials.append(mat)
            ob.data.uv_layers[0].active = True
            ob.data.uv_layers[0].active_render = True
            # 顶点色随贴图材质一并弃用：COLOR+UV 并存的网格经 Blender glTF 导出会多写一个 COLOR_1，
            # gltfpack 量化后过不了 validator（MESH_PRIMITIVE_INDEXED_SEMANTIC_CONTINUITY）。
            for ca in list(ob.data.color_attributes):
                ob.data.color_attributes.remove(ca)
            n += 1
    return n

paving_applied = apply_paving([o for it in plan for o in it['objs'] + it['rockery']])
print('paving materials applied:', paving_applied)

for it in plan:
    z, part_index, colls, f, objs, rockery_part = it['zone'], it['part'], it['colls'], it['file'], it['objs'], it['rockery']
    own = set(id(o) for o in objs + rockery_part)
    deny = [o for o in by_zone[z] if id(o) not in own]
    p = os.path.join(OUT, f)
    if not objs:
        manifest['zones'].append({'id': z, 'part': part_index, 'file': None, 'empty': True}); continue
    export(p, objs, deny)
    b = open(p, 'rb').read()
    note = ({1: 'bazaar street level: procedural street objects + INST-bazaar (shops/stalls/awnings) + FOOD-bazaar',
             2: 'bazaar bazaarBlock tower volumes (16 blocks, mesh incl. piers/windows/cornice/roof)'
                ' + bazaar-tower-kit site module when BAZAAR_TOWERS=1'}
            if z == 'bazaar' else None)
    entry = {'id': z, 'part': part_index, 'file': f, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest(),
             'collections': [c for c in colls if c in bpy.data.collections],
             'objects': len(objs), 'bounds': bounds(objs), 'withinCap': len(b) <= CAP}
    if note: entry['note'] = note[part_index]
    manifest['zones'].append(entry)
    print('zone', z, part_index, len(b), 'bytes')
    if rockery_part:
        f2 = 'zone-garden-2.glb'
        p2 = os.path.join(OUT, f2)
        export(p2, rockery_part, [o for o in by_zone[z] if id(o) not in set(id(o) for o in rockery_part)])
        b2 = open(p2, 'rb').read()
        manifest['zones'].append({'id': 'garden', 'part': 2, 'file': f2, 'bytes': len(b2), 'sha256': hashlib.sha256(b2).hexdigest(),
                                  'collections': ['SITE-garden'], 'objects': len(rockery_part),
                                  'bounds': bounds(rockery_part), 'withinCap': len(b2) <= CAP,
                                  'note': 'ROCKERY_KIT site modules; split so zone-garden.glb stays within cap'})
        print('zone garden 2', len(b2), 'bytes')
# ---------- 方浜中路分区（FANGBANG=1）----------
# R1：同一模块的全部实例进同一件，导出时多节点引用同一 mesh（Blender 链接复制）。
# 按模块装箱，超 ZONE_CAP_BYTES 再对半拆；不再按街段把同一模块拆进多件（那会把网格再存一份）。
# 街段地面只留 street-kit__*（总装已剔除 street-reviewed-lanes 的店屋节点）。
# loadPolicy=on-demand：核心三区 / 全域含外围默认不拉这几件。
if 'SITE-fangbang' in bpy.data.collections:
    fb_coll = bpy.data.collections['SITE-fangbang']
    fb_all = [o for o in fb_coll.objects if o.type == 'EMPTY' and str(o.get('id') or '').startswith('fangbang-')]
    def fb_top(o):
        cur = o
        while cur is not None:
            if str(cur.get('id') or '').startswith('fangbang-'):
                return cur
            cur = cur.parent
        return None
    def fb_stem(nm):
        return re.sub(r'\.\d{3}$', '', nm or '')
    # 同一模块强制共享网格数据块（链接复制偶发被材质槽拆开时收回来）
    fb_by_mod = {}
    for a in fb_all:
        fb_by_mod.setdefault(str(a.get('module') or a.get('id')), []).append(a)
    for ans in fb_by_mod.values():
        canon = {}
        for ch in ans[0].children_recursive:
            if ch.type == 'MESH' and ch.data:
                canon.setdefault(fb_stem(ch.name), ch.data)
        for a in ans[1:]:
            for ch in a.children_recursive:
                src = canon.get(fb_stem(ch.name)) if ch.type == 'MESH' else None
                if src is not None and ch.data != src:
                    ch.data = src
    # 方浜贴图像素去重（只动 SITE-fangbang 引用的图，别的分区 GLB 已经写完）
    fb_imgs = set()
    for a in fb_all:
        for ob in [a] + list(a.children_recursive):
            if ob.type != 'MESH' or not ob.data:
                continue
            for mat in ob.data.materials:
                if not mat or not mat.node_tree:
                    continue
                for n in mat.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and getattr(n, 'image', None):
                        fb_imgs.add(n.image)
    fb_img_kept = {}
    for img in list(fb_imgs):
        packed = getattr(img, 'packed_file', None)
        raw = packed.data if packed else None
        if not raw:
            continue
        key = (img.size[0], img.size[1], hashlib.sha256(raw).hexdigest())
        if key in fb_img_kept:
            img.user_remap(fb_img_kept[key])
            bpy.data.images.remove(img)
        else:
            fb_img_kept[key] = img
    # 招牌图保持 1K。其余贴图长边收到 512，两件才放得进 12MB，cm 合计才 ≤ 7MB。
    scaled = 0
    for img in list(fb_img_kept.values()):
        if 'sign' in img.name.lower():
            continue
        w, h = img.size
        m = max(w, h)
        if m > 512:
            s = 512 / m
            img.scale(max(1, int(round(w * s))), max(1, int(round(h * s))))
            scaled += 1
    print('fangbang images after hash dedupe', len(fb_img_kept), 'scaledTo512', scaled)
    def fb_mod_tris(ans):
        seen, t = set(), 0
        for ch in ans[0].children_recursive:
            if ch.type == 'MESH' and ch.data and id(ch.data) not in seen:
                seen.add(id(ch.data))
                ch.data.calc_loop_triangles()
                t += len(ch.data.loop_triangles)
        return t
    fb_groups = sorted(((fb_mod_tris(ans), ans) for ans in fb_by_mod.values()), key=lambda it: -it[0])
    def fb_objs_of(ans_lists):
        want = set()
        for ans in ans_lists:
            for a in ans:
                want.add(id(a))
        out = []
        for o in fb_coll.objects:
            top = fb_top(o)
            if top is not None and id(top) in want:
                out.append(o)
        return out
    def fb_write(part_index, ans_lists):
        objs = fb_objs_of(ans_lists)
        f = f'zone-fangbang-{part_index}.glb'
        pth = os.path.join(OUT, f)
        export(pth, objs)
        b = open(pth, 'rb').read()
        entry = {'id': 'fangbang', 'part': part_index, 'file': f, 'bytes': len(b),
                 'sha256': hashlib.sha256(b).hexdigest(), 'collections': ['SITE-fangbang'],
                 'objects': len(objs), 'bounds': bounds(objs), 'withinCap': len(b) <= CAP,
                 'loadPolicy': 'on-demand',
                 'note': 'v7 non-temple-axis; one mesh per module; map = v7 + (53.5, -17.4); loadPolicy on-demand'}
        print('zone fangbang', part_index, len(b), 'bytes', 'modules', len(ans_lists), 'withinCap' if len(b) <= CAP else 'OVER CAP')
        return entry
    # 两件装箱（纹理每件一份，件数多会把 cm 顶过 7MB）。超 cap 时把三角最少的模块挪到另一件。
    left, right, sl, sr = [], [], 0, 0
    for item in fb_groups:
        if sl <= sr:
            left.append(item); sl += item[0]
        else:
            right.append(item); sr += item[0]
    if not right:
        right = [left.pop()]
    packed = None
    for _ in range(len(fb_groups)):
        e1 = fb_write(1, [ans for _, ans in left])
        e2 = fb_write(2, [ans for _, ans in right])
        if e1['bytes'] <= CAP and e2['bytes'] <= CAP:
            packed = (e1, e2)
            break
        over, under = (left, right) if e1['bytes'] > e2['bytes'] else (right, left)
        if len(over) <= 1:
            raise SystemExit(f'FANGBANG split: cannot fit under cap ({e1["bytes"]}, {e2["bytes"]})')
        over.sort(key=lambda it: it[0])
        under.append(over.pop(0))
    if not packed:
        raise SystemExit('FANGBANG split: gave up packing into 2 parts')
    manifest['zones'].extend(packed)
    claimed = set()
    for _, ans in fb_groups:
        for a in ans:
            claimed.add(a.name)
    missing = [a.name for a in fb_all if a.name not in claimed]
    if missing:
        raise SystemExit(f'FANGBANG split: {len(missing)} anchors not claimed: {missing[:8]}')
    if 'fangbang' not in manifest['order']:
        manifest['order'].append('fangbang')
manifest['totalBytes'] = sum(zz.get('bytes', 0) for zz in manifest['zones'])
json.dump(manifest, open(os.path.join(OUT, 'zones-manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ZONES DONE total', manifest['totalBytes'], 'cap/zone', CAP)
