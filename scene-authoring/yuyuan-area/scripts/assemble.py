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

# ---------- 方浜中路分区（默认开启，2026-09-24 机主定；FANGBANG=0 关闭。v7 world/fangbang-temple-v7 非庙轴实例并入第五分区） ----------
# 数据源：仓库根 world/fangbang-temple-v7/instances.json（77 实例）。坐标契约：地图 = v7 + (53.5, -17.4)
# （v7 blocks.json anchor；山门 v7 (-127.817,27.057) -> 地图 (-74.317,9.657) 与 baseline/layout.json
# temple-shanmen 逐位一致，只有平移，2026-09-23 F1 复验）。跳过 temple-axis-v2 组（全域庙区已有，不重复放）。
# 91m 街段地面用 v7 street-reviewed-lanes.glb 的 street-kit__* 节点（该 GLB 的店屋节点与 instances.json
# 重复，剔除，店屋按实例从模块 GLB 重放，位置可对账）。锚点名 = v7 实例 id 加前缀 fangbang-；
# 模块 GLB 来源 = v7 review-manifest.json 登记路径（仓库根相对），未跟踪文件登记 artifacts/NEW-ASSETS.json。
fangbang_placed = 0
fangbang_excluded = []
fangbang_infill = []
if os.environ.get('FANGBANG', '1') != '0':
    REPO = os.path.dirname(os.path.dirname(ROOT))   # 仓库根
    FB7 = os.path.join(REPO, 'world', 'fangbang-temple-v7')
    fb_inst = json.load(open(os.path.join(FB7, 'instances.json'), encoding='utf-8'))['instances']
    fb_man = json.load(open(os.path.join(FB7, 'review-manifest.json'), encoding='utf-8'))
    fb_path = {m['id']: os.path.join(REPO, m['path'][2:]) for m in fb_man['modules']}
    missing_fb = sorted({i['module'] for i in fb_inst if i.get('group') != 'temple-axis-v2' and i['module'] not in fb_path})
    if missing_fb:
        raise SystemExit(f'FANGBANG=1: v7 review-manifest missing modules {missing_fb}')
    # ---------- 主控放行口径（GOAL「主控复验 F1 → 放行 F2」决定 1/2，2026-09-23） ----------
    # 决定 1：westext-seal-wall 一律剔除（方浜中路向西南外围 L0 继续延伸，封墙堵路）；
    #   山门以西 3 店（168/170/171）只在与全域任何对象（layout 实体 footprint、庙轴模块碰撞盒）都
    #   不相交时才放，相交则剔除并逐件记录。庙轴记录同平移即全域庙区包围盒（山门锚逐位一致）。
    FB_EXCLUDE_ALWAYS = {'westext-seal-wall'}
    FB_CHECK_IDS = ['westshop-shop-168', 'westshop-shop-170', 'westshop-shop-171']
    SOLID_KINDS = {'outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'waterside',
                   'stage', 'wall', 'corridor', 'watersideGallery', 'moonGateWall', 'wallHead'}
    fb_col = json.load(open(os.path.join(FB7, 'collision-world.json'), encoding='utf-8'))['colliders']
    fb_by_id = {}
    for r in fb_col:
        fb_by_id.setdefault(r['name'].split(':')[0], []).append(r)
    def obb_aabb(rec):
        """obbToWorld（形式 a/b）-> 世界 AABB（v7 坐标）。"""
        o = rec.get('obb')
        if o:
            c, s = math.cos(o['theta']), math.sin(o['theta'])
            wx = o['pos'][0] + c * o['center'][0] + s * o['center'][2]
            wz = o['pos'][2] - s * o['center'][0] + c * o['center'][2]
            wy = o['center'][1] + (o['pos'][1] or 0)
            hx, hy, hz = o['size'][0] / 2, o['size'][1] / 2, o['size'][2] / 2
            ex = [abs(c) * hx + abs(s) * hz, hy, abs(s) * hx + abs(c) * hz]
            return [wx - ex[0], wy - ex[1], wz - ex[2]], [wx + ex[0], wy + ex[1], wz + ex[2]]
        return list(rec['min']), list(rec['max'])
    def inst_aabb(sid, base_only=False):
        lo, hi = [1e9] * 3, [-1e9] * 3
        for r in fb_by_id.get(sid, []):
            if base_only:   # 只取墙体/地面（量门面用），剔除檐口以上
                o = r.get('obb')
                if o and o['center'][1] - o['size'][1] / 2 > 1.0:
                    continue
            a, b = obb_aabb(r)
            for i in range(3):
                lo[i] = min(lo[i], a[i]); hi[i] = max(hi[i], b[i])
        return lo, hi
    def aabb_overlap_vol(a, b):
        return math.prod(max(0.0, min(a[1][i], b[1][i]) - max(a[0][i], b[0][i])) for i in range(3))
    def poly_overlaps_aabb(poly, lo, hi):
        """2D footprint 多边形（地图坐标）与 AABB（已转地图坐标）相交判定。"""
        xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
        if max(xs) < lo[0] or min(xs) > hi[0] or max(zs) < lo[2] or min(zs) > hi[2]:
            return None
        corners = [(lo[0], lo[2]), (hi[0], lo[2]), (hi[0], hi[2]), (lo[0], hi[2])]
        def inside(px, pz):
            cin = False
            n = len(poly)
            for i in range(n):
                x1, z1 = poly[i]; x2, z2 = poly[(i + 1) % n]
                if (z1 > pz) != (z2 > pz) and px < (x2 - x1) * (pz - z1) / (z2 - z1) + x1:
                    cin = not cin
            return cin
        for cx, cz in corners:
            if inside(cx, cz):
                return 'corner-in-poly'
        for px, pz in poly:
            if lo[0] <= px <= hi[0] and lo[2] <= pz <= hi[2]:
                return 'poly-vertex-in-box'
        n = len(poly)
        for i in range(n):
            x1, z1 = poly[i]; x2, z2 = poly[(i + 1) % n]
            for (ax, az), (bx, bz) in zip(corners, corners[1:] + corners[:1]):
                d1 = (x2 - x1) * (az - z1) - (z2 - z1) * (ax - x1)
                d2 = (x2 - x1) * (bz - z1) - (z2 - z1) * (bx - x1)
                d3 = (bx - ax) * (z1 - az) - (bz - az) * (x1 - ax)
                d4 = (bx - ax) * (z2 - az) - (bz - az) * (x2 - ax)
                if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
                    return 'edge-cross'
        return None
    fb_layout = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
    fb_solids = [(o['id'], o['geometry']['footprint']) for o in fb_layout['objects']
                 if o.get('kind') in SOLID_KINDS and (o.get('geometry') or {}).get('footprint')]
    fb_temple_ids = {i['id'] for i in fb_inst if i.get('group') == 'temple-axis-v2'}
    fb_temple_boxes = [obb_aabb(r) for r in fb_col if r['name'].split(':')[0] in fb_temple_ids]
    OFF_MAP = (53.5, -17.4)
    fb_excluded_ids = set(FB_EXCLUDE_ALWAYS)
    for eid in FB_EXCLUDE_ALWAYS:
        fangbang_excluded.append({'id': eid, 'decision': 'lead-1', 'reason': 'west seal wall removed: 方浜中路 continues west as L0 outer road; a seal wall would block it'})
    for sid in FB_CHECK_IDS:
        lo, hi = inst_aabb(sid)
        hits = []
        mlo = [lo[0] + OFF_MAP[0], lo[1], lo[2] + OFF_MAP[1]]; mhi = [hi[0] + OFF_MAP[0], hi[1], hi[2] + OFF_MAP[1]]
        for solid_id, poly in fb_solids:
            how = poly_overlaps_aabb(poly, mlo, mhi)
            if how:
                hits.append({'object': solid_id, 'how': how})
        for tlo, thi in fb_temple_boxes:
            if aabb_overlap_vol([lo, hi], [tlo, thi]) > 1e-6:
                hits.append({'object': 'v7-temple-axis', 'how': 'aabb'})
        if hits:
            fb_excluded_ids.add(sid)
            fangbang_excluded.append({'id': sid, 'decision': 'lead-1', 'reason': 'intersects global objects', 'intersecting': hits})
        else:
            fangbang_excluded.append({'id': sid, 'decision': 'lead-1', 'reason': 'kept: no intersection with layout solids or temple-axis bounds', 'kept': True})
    # ---------- 决定 2：南侧店面断带（v7 x −35…−81）补齐，复用 west-band 窄店模块（局部门面 6.2–7.5m，
    # 门脸朝路，rotY 沿 158→163 插值），北断带是安仁街（road-495101845）路口，留开口不放（逐条记录在
    # fangbang-infill.json）。新增件 id=fangbang-infill-*、designInference=true；碰撞由
    # export-collision-fangbang.mjs 按 donor 记录克隆。 ----------
    def fb_pack_infill(prefix, east_id, west_id, donors, reserve_x=None, margin=0.55, edge_margin=0.8):
        """沿 east→west 排线按 AABB 贴排 donors 循环；reserve_x=(x0,x1) 为保留带（路口），整体跳到其西侧。
        冲突即停（保守排法）；返回 [(id, cx, cz, rot, donor, lo, hi)]。"""
        e = next(i for i in fb_inst if i['id'] == east_id)
        w = next(i for i in fb_inst if i['id'] == west_id)
        ex, ez, ery = e['positionGlb'][0], e['positionGlb'][2], e['rotationYRad']
        wxp, wzp, wry = w['positionGlb'][0], w['positionGlb'][2], w['rotationYRad']
        elo, ehi = inst_aabb(east_id, base_only=True)
        wlo, whi = inst_aabb(west_id, base_only=True)
        gap_e, gap_w = elo[0], whi[0] + edge_margin   # 断带 = 东侧店的西缘 … 西侧店的东缘
        slope = (wzp - ez) / (wxp - ex)
        rot_slope = (wry - ery) / (wxp - ex)
        # 逐碰撞记录比对（一实例多散件时实例级联合 AABB 会误判，如 westshops-strips 五段条墙）；
        # 邻居店（east/west）的全部记录也在冲突候选里（背墙/檐口会外凸出联合 AABB 之外）
        others = sorted({r['name'].split(':')[0] for r in fb_col} - fb_excluded_ids - fb_temple_ids)
        other_boxes = [(r['name'].split(':')[0], *obb_aabb(r))
                       for oid in others for r in fb_by_id.get(oid, [])]
        placed, cursor, di = [], gap_e - margin, 0
        while cursor > gap_w:
            if reserve_x and cursor > reserve_x[1] + margin:
                cursor = reserve_x[0] - margin   # 跳过保留带，从其西侧继续
                continue
            donor = donors[di % len(donors)]; di += 1
            drecs = [r for r in fb_by_id.get(donor, [])
                     if not (r.get('obb') and r['obb']['center'][1] - r['obb']['size'][1] / 2 > 1.0)]
            if not drecs:
                break
            frac = (cursor - ex) / (wxp - ex)
            rot = ery + rot_slope * frac

            def box_at(cx):
                lo = [1e9] * 3; hi = [-1e9] * 3
                cz0 = ez + slope * (cx - ex)
                c, s = math.cos(rot), math.sin(rot)
                for r in drecs:
                    o = r['obb']
                    lx = c * o['center'][0] + s * o['center'][2]
                    lz = -s * o['center'][0] + c * o['center'][2]
                    hx, hy, hz = o['size'][0] / 2, o['size'][1] / 2, o['size'][2] / 2
                    cc, ss = abs(c), abs(s)
                    exx = cc * hx + ss * hz; ezz = ss * hx + cc * hz
                    lo = [min(lo[0], cx + lx - exx), min(lo[1], o['center'][1] - hy), min(lo[2], cz0 + lz - ezz)]
                    hi = [max(hi[0], cx + lx + exx), max(hi[1], o['center'][1] + hy), max(hi[2], cz0 + lz + ezz)]
                return lo, hi

            # 模块局部 AABB 的 x 偏移（世界系）：令 AABB 东缘贴 cursor 反解模块原点 x——
            # 锚摆放的是模块原点，位姿必须存原点，测试端按原位姿重算才能逐位对上
            c, s = math.cos(rot), math.sin(rot)
            offs = []
            for r in drecs:
                o = r['obb']
                hx, hz = o['size'][0] / 2, o['size'][2] / 2
                lx = c * o['center'][0] + s * o['center'][2]
                exx = abs(c) * hx + abs(s) * hz
                offs.append((lx - exx, lx + exx))
            L, H = min(a for a, _ in offs), max(b for _, b in offs)
            width = H - L
            if cursor - width < gap_w or (reserve_x and cursor - width < reserve_x[1]):
                break   # 当前空位放不下（贴到西界或压保留带）
            origin_x = cursor - H
            lo, hi = box_at(origin_x)
            clash = [pid for (pid, *_rest, plo, phi) in placed if aabb_overlap_vol([lo, hi], [plo, phi]) > 1e-6]
            clash += [oid for (oid, olo, ohi) in other_boxes if aabb_overlap_vol([lo, hi], [olo, ohi]) > 1e-6]
            for solid_id, poly in fb_solids:
                mlo = [lo[0] + OFF_MAP[0], lo[1], lo[2] + OFF_MAP[1]]
                mhi = [hi[0] + OFF_MAP[0], hi[1], hi[2] + OFF_MAP[1]]
                if poly_overlaps_aabb(poly, mlo, mhi):
                    clash.append(solid_id)
            if clash:
                break
            iid = f'fangbang-infill-{prefix}{len(placed) + 1}'
            placed.append((iid, origin_x, ez + slope * (origin_x - ex), rot, donor, lo, hi))
            cursor = lo[0] - margin
        return placed
    # 南断带（决定 2）：158(−34.1 西缘)…163(−80.1 东缘)；donor 循环 dry_goods(7.5m)/curio-b(6.2m)
    fb_infill_s = fb_pack_infill('s', 'westshop-shop-158', 'westshop-shop-163',
                                 ['westshop-shop-158', 'westshop-shop-163', 'westshop-shop-163', 'westshop-shop-158', 'westshop-shop-163'])
    # 北断带：安仁街（map road-495101845，宽 7m）正汇入（v7 x≈−84.9），路口保留带宽 ±6.5m；实测余量
    # < 窄模块 AABB 7.7m，预期 0 件 —— 路口优先，记录进 fangbang-infill.json 供复验。
    fb_infill_n = fb_pack_infill('n', 'westshop-shop-162', 'westshop-shop-164',
                                 ['westshop-shop-160', 'westshop-shop-159'], reserve_x=(-84.9 - 6.5, -84.9 + 6.5))
    print('fangbang infill north placed', len(fb_infill_n), '(安仁街 junction kept open)')
    fb_cache = {}
    def fb_objs(module):
        if module not in fb_cache:
            objs = import_glb(fb_path[module], 'MODLIB')
            for o in objs:
                o.hide_render = True
                o.hide_viewport = True
            fb_cache[module] = objs
        return fb_cache[module]
    # 街段地面：street-kit__* 世界坐标节点（v7 坐标）挂 fangbang-street-ground 锚（group=street-ground，
    # 分区拆件归街段件）；锚位姿 = 地图平移 (53.5, -17.4) -> Blender (53.5, +17.4, 0)，与实例同一坐标契约
    sg_objs = import_glb(os.path.join(FB7, 'street-reviewed-lanes.glb'), 'SITE-fangbang')
    sg_keep = [o for o in sg_objs if o.name.startswith('street-kit__')]
    sg_anchor = bpy.data.objects.new('fangbang-street-ground', None)
    sg_anchor.location = (53.5, 17.4, 0)
    sg_anchor.rotation_euler = (0, 0, 0)
    sg_anchor['id'] = 'fangbang-street-ground'
    sg_anchor['module'] = 'fangbang-street-kit'
    sg_anchor['zone'] = 'fangbang'
    sg_anchor['group'] = 'street-ground'
    coll('SITE-fangbang').objects.link(sg_anchor)
    for o in sg_keep:
        if o.parent is None:
            o.parent = sg_anchor
    for o in sg_objs:
        if o not in sg_keep:
            bpy.data.objects.remove(o, do_unlink=True)
    print('fangbang street ground nodes kept:', len(sg_keep))
    fb_skipped_temple = 0
    for inst in fb_inst:
        if inst.get('group') == 'temple-axis-v2':
            fb_skipped_temple += 1
            continue
        if inst['id'] in fb_excluded_ids:
            continue
        x, y, z = inst['positionGlb']
        anchor = bpy.data.objects.new('fangbang-' + inst['id'], None)
        anchor.empty_display_size = 2
        anchor.location = (x + 53.5, -(z - 17.4), y)      # 地图 = v7+(53.5,-17.4)；Blender (x, -z, y-up)
        anchor.rotation_euler = (0, 0, inst['rotationYRad'])
        anchor['id'] = 'fangbang-' + inst['id']
        anchor['v7id'] = inst['id']
        anchor['module'] = inst['module']
        anchor['zone'] = 'fangbang'
        anchor['lod'] = 'L2'
        anchor['group'] = inst.get('group', '')
        coll('SITE-fangbang').objects.link(anchor)
        for o in fb_objs(inst['module']):
            dup = o.copy()   # 链接复制共享网格/材质；库本体隐藏，副本恢复可见
            dup.hide_render = False
            dup.hide_viewport = False
            coll('SITE-fangbang').objects.link(dup)
            dup.parent = anchor
        fangbang_placed += 1
    print('fangbang placed', fangbang_placed, 'skipped temple-axis', fb_skipped_temple,
          'excluded', [e['id'] for e in fangbang_excluded if not e.get('kept')])
    # 补齐件锚（决定 2）：donor 模块重放，位姿 = 排线插值；碰撞记录由 export-collision-fangbang.mjs 克隆
    for iid, cx, cz, rot, donor, _lo, _hi in fb_infill_s:
        module = next(i['module'] for i in fb_inst if i['id'] == donor)
        anchor = bpy.data.objects.new(iid, None)
        anchor.empty_display_size = 2
        anchor.location = (cx + 53.5, -(cz - 17.4), 0)
        anchor.rotation_euler = (0, 0, rot)
        anchor['id'] = iid
        anchor['module'] = module
        anchor['donor'] = donor
        anchor['zone'] = 'fangbang'
        anchor['lod'] = 'L2'
        anchor['group'] = 'infill-south'
        anchor['designInference'] = True
        anchor['rotY'] = round(rot, 5)
        coll('SITE-fangbang').objects.link(anchor)
        for o in fb_objs(module):
            dup = o.copy()
            dup.hide_render = False
            dup.hide_viewport = False
            coll('SITE-fangbang').objects.link(dup)
            dup.parent = anchor
        fangbang_infill.append({'id': iid, 'module': module, 'donor': donor,
                                'positionGlb': [round(cx, 4), 0, round(cz, 4)],
                                'positionMap': [round(cx + 53.5, 4), 0, round(cz - 17.4, 4)],
                                'rotY': round(rot, 5), 'designInference': True, 'gap': 'south'})
    fb_infill_doc = {
        'axis': 'v7 glTF Y-up coords; map = v7 + (53.5, -17.4)',
        'decision': 'GOAL wave1-fangbang lead decisions 2026-09-23 #2: fill storefront gaps with west-band narrow modules (local facade 6.2-7.5m), facades to street; deterministic AABB packing, clash = stop',
        'southGap': {'between': ['westshop-shop-158', 'westshop-shop-163'],
                     'fillRule': 'AABB edge-to-edge, 0.55m gap, rotY lerped 158->163',
                     'placed': fangbang_infill},
        'northGap': {'between': ['westshop-shop-162', 'westshop-shop-164'],
                     'placed': [],
                     'reason': '安仁街 (layout road-495101845, w=7m) joins 方浜中路 inside this gap at v7 x≈-84.9; reserved mouth ±6.5m leaves <7.7m clear — narrower than the smallest module AABB (curio-a 7.7m). Placing anything would block the junction or clip shops 162/164; mouth kept open (lead constraint: infill must not intersect global objects).'},
    }
    json.dump(fb_infill_doc, open(os.path.join(OUT, 'fangbang-infill.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('fangbang infill placed', len(fangbang_infill), [i['id'] for i in fangbang_infill])

# ---------- 湖心亭站点模块（HUXINTING=1，默认关。世界坐标 GLB，同假山做法，assemble 导入 SITE-pond） ----------
# 位置全部从 baseline/layout.json 重算：锚 empty = footprint 面积形心（鞋带公式），
# rotY 使本地朝向主轴（footprint 最长边方向，+u 远离九曲桥）；子网格保持世界坐标（parent 后写回 matrix_world）。
# 公式与 modules/huxinting/build.py、tests/huxinting-test.mjs 一致。
huxinting_placed = 0
if os.environ.get('HUXINTING') == '1':
    lay_obj = {o['id']: o for o in LAYOUT['objects']}
    ht = lay_obj['huxin-ting']
    fp = ht['geometry']['footprint']
    if fp[0] == fp[-1]:
        fp = fp[:-1]
    area2 = sum(fp[i][0] * fp[(i + 1) % len(fp)][1] - fp[(i + 1) % len(fp)][0] * fp[i][1] for i in range(len(fp)))
    hx = sum((fp[i][0] + fp[(i + 1) % len(fp)][0]) * (fp[i][0] * fp[(i + 1) % len(fp)][1] - fp[(i + 1) % len(fp)][0] * fp[i][1])
             for i in range(len(fp))) / (3 * area2)
    hz = sum((fp[i][1] + fp[(i + 1) % len(fp)][1]) * (fp[i][0] * fp[(i + 1) % len(fp)][1] - fp[(i + 1) % len(fp)][0] * fp[i][1])
             for i in range(len(fp))) / (3 * area2)
    hl, ha, hb = max((math.hypot(fp[(i + 1) % len(fp)][0] - fp[i][0], fp[(i + 1) % len(fp)][1] - fp[i][1]), fp[i], fp[(i + 1) % len(fp)])
                     for i in range(len(fp)))
    ux, uz = (hb[0] - ha[0]) / hl, (hb[1] - ha[1]) / hl
    if ux < 0:
        ux, uz = -ux, -uz
    ht_glb = os.path.join(OUT, 'huxin-ting.glb')
    if not os.path.exists(ht_glb):
        raise SystemExit('HUXINTING=1: missing %s; build with blender -b -t 4 --python modules/huxinting/build.py' % ht_glb)
    objs = import_glb(ht_glb, 'SITE-pond')
    for ob in objs:
        if ob.name.startswith('huxin-ting__'):
            ob.name = 'mesh-' + ob.name
    empty = bpy.data.objects.new('huxin-ting', None)
    empty.empty_display_size = 2
    empty.rotation_mode = 'XYZ'
    empty.location = (hx, -hz, 0)
    empty.rotation_euler = (0, 0, math.atan2(ux, uz))
    empty['id'] = 'huxin-ting'
    empty['module'] = 'huxinting'
    empty['zone'] = 'pond'
    empty['lod'] = 'L2'
    coll('SITE-pond').objects.link(empty)
    bpy.context.view_layer.update()
    for ob in objs:
        if ob.parent is None:
            mw = ob.matrix_world.copy()
            ob.parent = empty
            ob.matrix_world = mw
    bpy.context.view_layer.update()
    huxinting_placed += 1
    print('huxinting placed huxin-ting centroid', round(hx, 3), round(hz, 3), 'rotY', round(math.atan2(ux, uz), 4))

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

SITE_ALL = [o for c in ('SITE-garden', 'SITE-temple', 'SITE-pond', 'SITE-fangbang')
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
    'huxintingPlaced': huxinting_placed,
    'gardenKitPlaced': garden_kit_placed,
    'fangbangPlaced': fangbang_placed,
    'fangbangExcluded': fangbang_excluded,
    'fangbangInfillIds': [i['id'] for i in fangbang_infill],
}
json.dump(stats, open(os.path.join(OUT, 'assemble-stats.json'), 'w'), indent=1)
print('ASSEMBLE DONE', json.dumps(stats))
