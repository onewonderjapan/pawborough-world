# Blender 总装：程序化分区 GLB + L2 只读引用（门楼/店屋/庙区v3精修件）-> 总场景。
# 坐标契约：layout.json 的 (x, z) 地图系 -> Blender (x, -z, z-up)；导出 GLB 时转回 Y-up。
# 所有 L2 模块只读导入 + 链接复制实例，不修改源文件。
import bpy, json, math, os, sys
GARDEN_PAVILIONS = ['bld-428179924', 'bld-428186467', 'bld-428196085', 'bld-428196091', 'bld-428196098']
GARDEN_CORRIDORS = {'bld-553893874': 'corridor-bld-553893874.glb', 'bld-428179906': 'ring-corridor-bld-428179906.glb',
                    'bld-428179920': 'waterside-gallery-bld-428179920.glb',
                    'bld-428186469': 'double-corridor-bld-428186469.glb'}   # 复廊: lead build, modules/double-corridor

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
    if inst.get('scale'):
        anchor.scale = (inst['scale'],) * 3
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

# ---------- 站点模块（SITE_MODULES=1：garden-kit 的龙墙/庙墙/月洞门/九曲桥） ----------
# 世界坐标 GLB（原点=地图0,0），直接导入，不加实例变换。
SITE_FILES = {
    'SITE-garden': ['garden-wall.glb', 'moon-gate.glb'],
    'SITE-temple': ['temple-wall.glb'],
    'SITE-pond': ['jiuqu-bridge.glb'],
}
# 每个 GLB 挂到以 layout 对象 id 命名的锚空节点（coverage.mjs/reconcile.mjs 按节点名对账；
# garden-wall.glb 同时承担 garden-wall 与 garden-wall-dragonhead 两个 layout 对象）
SITE_ANCHORS = {
    'garden-wall.glb': ['garden-wall', 'garden-wall-dragonhead'],
    'moon-gate.glb': ['yuhuatang-moongate'],
    'temple-wall.glb': ['temple-wall'],
    'jiuqu-bridge.glb': ['jiuqu-bridge'],
}
site_imported = []
if os.environ.get('SITE_MODULES') == '1':
    # R1#4 fallback：总装超 30MB 时 SITE_DROP_TEMPLE=1 把 temple-wall 网格从总装剔除；
    # 锚空节点仍创建（reconcile/coverage 对账按节点名），temple-wall.glb 照常交付。
    drop_mesh = {'temple-wall.glb'} if os.environ.get('SITE_DROP_TEMPLE') == '1' else set()
    if drop_mesh:
        print('SITE_DROP_TEMPLE=1 (R1#4 30MB fallback): temple-wall mesh kept out of assembly; anchor kept, GLB still delivered')
    for collname, files in SITE_FILES.items():
        for f in files:
            p = os.path.join(OUT, f)
            if os.path.exists(p) and f not in drop_mesh:
                objs = import_glb(p, collname)
                parent = None
                for anchor_id in SITE_ANCHORS.get(f, [f[:-4]]):
                    empty = bpy.data.objects.new(anchor_id, None)
                    empty.empty_display_size = 2
                    empty['id'] = anchor_id
                    empty['module'] = 'garden-kit'
                    coll(collname).objects.link(empty)
                    if parent is not None:
                        empty.parent = parent
                    parent = empty
                for o in objs:
                    if o.parent is None:
                        o.parent = parent
                site_imported.append(f)
                print('imported site module', f, '->', collname, 'anchors', SITE_ANCHORS.get(f))
            else:
                if f in drop_mesh:
                    parent = None
                    for anchor_id in SITE_ANCHORS.get(f, [f[:-4]]):
                        empty = bpy.data.objects.new(anchor_id, None)
                        empty.empty_display_size = 2
                        empty['id'] = anchor_id
                        empty['module'] = 'garden-kit'
                        coll(collname).objects.link(empty)
                        if parent is not None:
                            empty.parent = parent
                        parent = empty
                    print('anchor-only site module', f, '->', collname, '(mesh dropped, 30MB fallback)')
                else:
                    print('MISSING site module', p)
    print('site modules imported:', site_imported)

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

# ---------- 豫园套件（GARDEN_KITS=1：攒尖亭 5 座、园廊 3 条 + 听涛阁水廊、树 46 棵） ----------
# 亭：实例模块；位置/朝向由主控从冻结布局重算（footprint 形心 + facade.dir），不用套件自带 placements
#（2026-09-23 复验发现其 placements.json 偏离 40–96 m）。rotY = atan2(dx, dz) 使本地 +Z 指向 facade.dir。
# 廊：世界坐标站点模块（同 garden-kit）。复廊 bld-428186469 由主控 modules/double-corridor 重建（OSM 为建筑外轮廓而非中心线）。
# 树：tree-kit 的 tree-placements.json（含比例与 9 棵避让移位记录）。
garden_kit_placed = 0
if os.environ.get('GARDEN_KITS') == '1':
    KIT = lambda sub: os.path.join(ROOT, os.environ.get('GARDEN_KIT_DIR', 'out-garden-kits'), sub)
    lay_obj = {o['id']: o for o in LAYOUT['objects']}
    lib = {}
    def lib_objs(path):
        if path not in lib:
            objs = import_glb(path, 'MODLIB')
            for o in objs:
                o.hide_render = True
                o.hide_viewport = True
            lib[path] = objs
        return lib[path]
    for pid in GARDEN_PAVILIONS:
        o = lay_obj[pid]
        fp = o['geometry']['footprint'][:-1] if o['geometry']['footprint'][0] == o['geometry']['footprint'][-1] else o['geometry']['footprint']
        cx = sum(q[0] for q in fp) / len(fp); cz = sum(q[1] for q in fp) / len(fp)
        d = o['facade']['dir']
        place(lib_objs(KIT(f'pavilion-{pid}/model.glb')), {'id': pid, 'module': 'pavilion-kit', 'zone': 'garden', 'lod': 'L2',
                                                           'position': [cx, cz], 'rotY': math.atan2(d[0], d[1])})
        garden_kit_placed += 1
    for oid, f in GARDEN_CORRIDORS.items():
        objs = import_glb(KIT(f), 'SITE-garden')
        empty = bpy.data.objects.new(oid, None); empty['id'] = oid; empty['module'] = 'corridor-kit'
        coll('SITE-garden').objects.link(empty)
        for ob in objs:
            if ob.parent is None: ob.parent = empty
        garden_kit_placed += 1
    tp = json.load(open(os.path.join(ROOT, 'modules', 'tree-kit', 'tree-placements.json'), encoding='utf-8'))
    for t in tp['placements']:
        place(lib_objs(KIT(f"tk-{t['species']}-{t['variant']}.glb")), {'id': t['id'], 'module': 'tree-kit', 'zone': 'garden', 'lod': 'L2',
                                                                        'position': t['position'], 'rotY': t['rotY'], 'scale': t['scale']})
        garden_kit_placed += 1
    print('garden kits placed', garden_kit_placed)

# ---------- 摊位套件（STALL_KIT=1：modules/bazaar-stalls 的 3 种摊位 + 长凳 + 16 条街块檐棚） ----------
# 实例模块（原点=地面中心，+Z 朝人流），按 records/placements.json 的地图位置与 rotY 放置，锚点名 = layout 对象 id（coverage 按名对账）。
stall_placed = 0
if os.environ.get('STALL_KIT') == '1':
    SK_REC = os.path.join(ROOT, 'modules', 'bazaar-stalls', 'records')
    SK_GLB = os.path.join(ROOT, os.environ.get('STALL_DIR', 'out-bazaar-stalls'))
    sp = json.load(open(os.path.join(SK_REC, 'placements.json'), encoding='utf-8'))
    ap = json.load(open(os.path.join(SK_REC, 'awning-placements.json'), encoding='utf-8'))
    stall_lib = {}
    def stall_objs(mod):
        if mod not in stall_lib:
            objs = import_glb(os.path.join(SK_GLB, mod), 'MODLIB')
            for o in objs:
                o.hide_render = True
                o.hide_viewport = True
            stall_lib[mod] = objs
        return stall_lib[mod]
    for it in sp['stalls'] + sp['benches']:
        place(stall_objs(it['module']), {'id': it['id'], 'module': 'stall-kit:' + it['module'], 'zone': 'bazaar', 'lod': 'L2',
                                         'position': it['position'], 'rotY': it['rotY']})
        stall_placed += 1
    # 檐棚：朝向从 layout footprint 重算，不用 records 里的 dir/outward/rotY——那三项比真实墙边转了 90°
    # （16 条全部如此，檐棚垂直立面横穿街道，2026-09-23 Fable 复验截图发现）。GLB 本地 X = 沿墙长度、
    # +Z = 出挑方向、原点在墙面，所以 rotY 让 +Z 对准墙边的外法线（按 footprint 绕向判定）。
    lay_by_id = {o['id']: o for o in LAYOUT['objects']}
    awning_poses = []
    for e in (ap['edges'] if os.environ.get('STALL_AWNINGS', '1') == '1' else []):
        fp = lay_by_id[e['blockId']]['geometry']['footprint']
        if fp[0] == fp[-1]:
            fp = fp[:-1]
        area2 = sum(fp[i][0] * fp[(i + 1) % len(fp)][1] - fp[(i + 1) % len(fp)][0] * fp[i][1] for i in range(len(fp)))
        (ax, az), (bx, bz) = e['edge']
        ex, ez = bx - ax, bz - az
        n = math.hypot(ex, ez)
        # x 东 z 南：area2>0 为 x→z 方向逆时针，外法线 = (ez, -ex)；反之取反
        ox, oz = (ez / n, -ex / n) if area2 > 0 else (-ez / n, ex / n)
        rot_y = math.atan2(ox, oz)
        mid = [(ax + bx) / 2, (az + bz) / 2]
        place(stall_objs(e['module']), {'id': f"awning-{e['blockId']}-{e['edgeIndex']}", 'module': 'stall-kit:awning', 'zone': 'bazaar',
                                        'lod': 'L2', 'position': mid, 'rotY': rot_y})
        awning_poses.append({'id': f"awning-{e['blockId']}-{e['edgeIndex']}", 'edge': e['edge'], 'outward': [round(ox, 6), round(oz, 6)],
                             'position': [round(mid[0], 3), round(mid[1], 3)], 'rotY': round(rot_y, 6),
                             'recordRotYDeltaDeg': round(math.degrees(math.remainder(rot_y - e['rotY'], 2 * math.pi)), 1)})
        stall_placed += 1
    json.dump({'source': 'recomputed from layout footprints (records dir/outward/rotY ignored)', 'awnings': awning_poses},
              open(os.path.join(OUT, 'awning-poses.json'), 'w'), ensure_ascii=False, indent=1)
    print('stall kit placed', stall_placed)

# ---------- 三穗堂实例模块（SANSUITANG=1：modules/sansuitang 细化件替代程序化 hall bld-428179901） ----------
# 位置 = footprint 形心（顶点均值，与 pavilion 同式），rotY = atan2(facade.dir.x, facade.dir.z)。
# 模块原点已重锚到台基外包平面中心（modules/sansuitang/README.md），故锚点即放在形心；
# collision.json（实例坐标）同步变换出世界记录写 OUT，供后续物理对账。
sst_placed = 0
if os.environ.get('SANSUITANG') == '1':
    lay_obj = {o['id']: o for o in LAYOUT['objects']}
    o = lay_obj['bld-428179901']
    fp = o['geometry']['footprint'][:-1] if o['geometry']['footprint'][0] == o['geometry']['footprint'][-1] else o['geometry']['footprint']
    cx = sum(q[0] for q in fp) / len(fp); cz = sum(q[1] for q in fp) / len(fp)
    d = o['facade']['dir']
    rot_y = math.atan2(d[0], d[1])
    SST_DIR = os.path.join(ROOT, os.environ.get('SANSUITANG_DIR', 'out-garden-kits/sansuitang-bld-428179901'))
    sst_objs = import_glb(os.path.join(SST_DIR, 'model.glb'), 'MODLIB')
    for oo in sst_objs:
        oo.hide_render = True
        oo.hide_viewport = True
    place(sst_objs, {'id': 'bld-428179901', 'module': 'sansuitang', 'zone': 'garden', 'lod': 'L2',
                     'position': [cx, cz], 'rotY': rot_y})
    sst_placed += 1
    coll_path = os.path.join(SST_DIR, 'collision.json')
    if os.path.exists(coll_path):
        cc = json.load(open(coll_path, encoding='utf-8'))
        ct, st = math.cos(rot_y), math.sin(rot_y)
        world_boxes = []
        for b in cc.get('colliders', []):
            lx, ly, lz = b['center']
            wx = cx + lx * ct + lz * st      # 地图系：local(x,z) -> world(x,z)
            wz = cz - lx * st + lz * ct
            world_boxes.append({'name': b['name'], 'center': [round(wx, 3), round(ly, 3), round(wz, 3)],
                                'size': b['size'], 'type': b.get('type', 'box'), 'rotY': round(rot_y, 6)})
        json.dump({'source': 'modules/sansuitang/collision.json (instance space)', 'instance': {'id': 'bld-428179901',
                   'position': [round(cx, 3), round(cz, 3)], 'rotY': round(rot_y, 6)}, 'colliders': world_boxes},
                  open(os.path.join(OUT, 'sansuitang-collision-world.json'), 'w'), ensure_ascii=False, indent=1)
        print('sansuitang collision world boxes:', len(world_boxes))
    print('sansuitang placed', sst_placed)

# ---------- 假山站点模块（默认开启；ROCKERY_KIT=0 退回程序化占位。世界坐标 GLB，锚点按 baseline/layout.json 重算） ----------
# 网格已在地图坐标（build-rockery：GLB x,y,z = map x,z,y）。锚 empty 放在占位盒并集的 footprint 形心，
# rotY 使本地 +Z 指向石心主轴；子网格保持世界坐标（parent 后写回 matrix_world）。
# 形心 / 主轴公式与 tests/rockery-test.mjs 一致，只读 layout 的 rocks[].{x,z,size}。
# 占位盒半宽 = 0.6*size（DESIGN_SPEC：顶点须留在 x±size*0.6, z±size*0.6 内），不是从网格反推。
def rockery_pose(rocks):
    half = 0.6
    x0 = min(r['x'] - r['size'] * half for r in rocks)
    x1 = max(r['x'] + r['size'] * half for r in rocks)
    z0 = min(r['z'] - r['size'] * half for r in rocks)
    z1 = max(r['z'] + r['size'] * half for r in rocks)
    mx = sum(r['x'] for r in rocks) / len(rocks)
    mz = sum(r['z'] for r in rocks) / len(rocks)
    cxx = sum((r['x'] - mx) ** 2 for r in rocks)
    czz = sum((r['z'] - mz) ** 2 for r in rocks)
    cxz = sum((r['x'] - mx) * (r['z'] - mz) for r in rocks)
    tr = cxx + czz
    disc = max(0.0, tr * tr / 4 - (cxx * czz - cxz * cxz))
    lam = tr / 2 + math.sqrt(disc)
    if abs(cxz) > 1e-9:
        vx, vz = -cxz, cxx - lam
    elif cxx >= czz:
        vx, vz = 1.0, 0.0
    else:
        vx, vz = 0.0, 1.0
    n = math.hypot(vx, vz) or 1.0
    vx, vz = vx / n, vz / n
    if abs(vx) >= abs(vz):
        if vx < 0:
            vx, vz = -vx, -vz
    elif vz < 0:
        vx, vz = -vx, -vz
    return (x0 + x1) / 2, (z0 + z1) / 2, math.atan2(vx, vz), vx, vz

rockery_placed = 0
if os.environ.get('ROCKERY_KIT', '1') != '0':
    lay_obj = {o['id']: o for o in LAYOUT['objects']}
    RK = os.path.join(ROOT, os.environ.get('ROCKERY_KIT_DIR', 'out-garden-kits'))
    missing = [rid for rid in ('rockery-dajiashan', 'rockery-yulinglong')
               if not os.path.exists(os.path.join(RK, rid, 'model.glb'))]
    if missing:
        raise SystemExit(f'ROCKERY_KIT (default on): missing {missing} under {RK}; '
                         'stage the reviewed rockery GLBs (modules/garden-kits-staging.json) '
                         'or set ROCKERY_KIT=0 for the procedural placeholders')
    for rid in ('rockery-dajiashan', 'rockery-yulinglong'):
        rocks = lay_obj[rid]['geometry']['rocks']
        cx, cz, rot_y, vx, vz = rockery_pose(rocks)
        objs = import_glb(os.path.join(RK, rid, 'model.glb'), 'SITE-garden')
        for ob in objs:
            if ob.name == rid or ob.name.startswith(rid):
                ob.name = 'mesh-' + ob.name
        empty = bpy.data.objects.new(rid, None)
        empty.empty_display_size = 2
        empty.rotation_mode = 'XYZ'
        empty.location = (cx, -cz, 0)
        empty.rotation_euler = (0, 0, rot_y)
        empty['id'] = rid
        empty['module'] = 'rockery-kit'
        empty['zone'] = 'garden'
        empty['lod'] = 'L2'
        coll('SITE-garden').objects.link(empty)
        bpy.context.view_layer.update()
        for ob in objs:
            if ob.parent is None:
                mw = ob.matrix_world.copy()
                ob.parent = empty
                ob.matrix_world = mw
        bpy.context.view_layer.update()
        rockery_placed += 1
        print('rockery placed', rid, 'centroid', round(cx, 3), round(cz, 3), 'rotY', round(rot_y, 4), 'axis', round(vx, 3), round(vz, 3))
    print('rockery kit placed', rockery_placed)

# MODLIB 收藏不导出
modlib = bpy.data.collections.get('MODLIB')

# ---------- 贴图去重（SITE_MODULES=1 时执行） ----------
# 站点模块/门楼/店屋/庙区 GLB 内嵌图是 packed（无 filepath），来自同一 source-kit 文件；
# 按 名称(去掉 .NNN 后缀)+尺寸 合并 image datablock，避免 GLB 导出重复嵌入（几何/材质不变，只省字节）。
if site_imported:
    import re
    def img_key(img):
        try:
            return (re.sub(r'\.\d{3}$', '', img.name), img.size[0], img.size[1])
        except Exception:
            return None
    by_key = {}
    for img in list(bpy.data.images):
        if img.source != 'FILE':
            continue
        key = img_key(img)
        if not key or img.size[0] == 0:
            continue
        if key in by_key:
            old = by_key[key]
            img.user_remap(old)
            bpy.data.images.remove(img)
        else:
            by_key[key] = img
    print('images deduped:', len(bpy.data.images), 'datablocks remain')

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

SITE_ALL = [o for c in ('SITE-garden', 'SITE-temple', 'SITE-pond')
            if c in bpy.data.collections for o in bpy.data.collections[c].objects]
all_objs = [o for c in ('ZONE-garden', 'ZONE-temple', 'ZONE-bazaar', 'ZONE-pond', 'ZONE-outer',
                        'INST-garden', 'INST-temple', 'INST-bazaar', 'INST-outer')
            if c in bpy.data.collections for o in bpy.data.collections[c].objects] + SITE_ALL

def zone_objects(zones):
    sel = []
    for z in zones:
        for c in ('ZONE-' + z, 'INST-' + z, 'SITE-' + z):
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
if site_imported:
    # SITE_MODULES 时九曲桥在 SITE-pond：补一份 pond 分区 GLB（默认路径不产出新文件）
    export_glb(os.path.join(OUT, 'pond.glb'), zone_objects(['pond']))

# 实例清单回写
stats = {
    'instances': len(LAYOUT['instances']),
    'modules': {'gate': 1, 'shops': len(shop_objs), 'temple': len(temple_objs)},
    'sceneObjects': len(all_objs),
    'siteModules': site_imported,
    'stallKitPlaced': stall_placed,
    'sansuitangPlaced': sst_placed,
    'rockeryKitPlaced': rockery_placed,
    'gardenKitPlaced': garden_kit_placed,
}
json.dump(stats, open(os.path.join(OUT, 'assemble-stats.json'), 'w'), indent=1)
print('ASSEMBLE DONE', json.dumps(stats))
