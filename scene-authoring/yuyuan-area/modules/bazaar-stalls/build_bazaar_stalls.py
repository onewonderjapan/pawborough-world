# bazaar-stalls kit builder — GLM-Flash wave-1 batch 20260922
# Builds 3 stall modules + bench + 16 awning strips as GLBs, and writes
# placements.json / awning-placements.json from the frozen baseline layout.
#
# Contract (verified against build-scene.mjs buildStall + out/food-sockets.json):
#   GLB Y-up world = (map_x, height, map_z); instances: position(map x,z) + R_y(rotY)
#   stall local frame: origin center on ground, +X lateral, +Z toward foot traffic
#   slot (lx,ly,lz) = mount FACE height where the food prop sits (stall owns furniture)
#
# Run: blender -b -t 4 -P build_bazaar_stalls.py
import bpy, bmesh, json, math, os, sys, hashlib
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(AREA, 'out-bazaar-stalls')
SITE = '/home/baibai/outbox/pawborough-w1-bazaar-stalls-20260922/artifacts/bazaar-stalls/site-inputs.json'
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, 'awnings'), exist_ok=True)

BUDGET = {'stallMax': 1500, 'benchMax': 300, 'awningPerMetreMax': 120, 'lampMax': 400}

# palette (DESIGN_SPEC.materials) — constant colors only, no textures
PAL = {
    'timber':     ('timber',     0x6a4a32, 0.85, 0.0),
    'timberDark': ('timberDark', 0x553a27, 0.85, 0.0),
    'canvasCream':('canvasCream',0xc9b893, 0.90, 0.0),
    'canvasWine': ('canvasWine', 0x8b4346, 0.90, 0.0),
    'canvasIndigo':('canvasIndigo',0x536b7d,0.90, 0.0),
    'iron':       ('dark-iron',  0x44453d, 0.60, 0.9),
    'steel':      ('steel',      0x9da0a3, 0.40, 1.0),
    'pale':       ('palewood',   0xd8cdb4, 0.85, 0.0),
    'glass':      ('glass',      0xdfe8ea, 0.10, 0.0),  # alpha 0.25
    # 老街檐灯（wave14-stalllight B）：红纸灯笼罩 + 黄铜箍。olds-lantern 是 lighting/presets.json
    # oldsouth-lamp 发光组 / oldsouth-lamp 点光源保护集材质名，hex 唯一（防 gltfpack 内容合并吞名，另有 -km 兜底）。
    'oldsLantern':('olds-lantern', 0xc8452e, 0.60, 0.0),
    'oldsBrass':  ('olds-brass',  0xb08d3f, 0.35, 0.8),
}

def hexcol(h):
    return (float((h >> 16) & 255) / 255.0, float((h >> 8) & 255) / 255.0,
            float(h & 255) / 255.0, 1.0)

def make_mats(names):
    mats = {}
    for key in names:
        name, hexv, rough, metal = PAL[key]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = hexcol(hexv)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if key == 'glass':
            bsdf.inputs['Alpha'].default_value = 0.25
            m.blend_method = 'BLEND'
        m['kitColor'] = '#%06x' % hexv
        mats[key] = m
    return mats

def bl(gx, gy, gz):
    "GLB (x,y,z) -> Blender internal (x,-z,y)"
    return (gx, -gz, gy)

def mesh_from_tris(name, verts_glb, tris, mat, smooth=False):
    "verts_glb: [(x,y,z)] in GLB frame; tris: [(a,b,c)]"
    me = bpy.data.meshes.new(name)
    me.from_pydata([bl(*v) for v in verts_glb], [], [tuple(t) for t in tris])
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob

def box_glb(name, center, size, mat, rot_x_deg=0.0):
    "axis-aligned box in GLB frame, optional rotation about GLB X (deg) applied in GLB frame"
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    v = [(x, y, z) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
    v = [(cx + a, cy + b, cz + c) for (a, b, c) in v]
    if rot_x_deg:
        a = math.radians(rot_x_deg)
        ca, sa = math.cos(a), math.sin(a)
        v = [(px, cy + (py - cy) * ca - (pz - cz) * sa, cz + (py - cy) * sa + (pz - cz) * ca)
             for (px, py, pz) in v]
    # faces (CCW outward)
    quads = [
        (0, 2, 3, 1),   # -x  (y-,z-)(y-,z+)(y+,z+)(y+,z-)  fixed below
        (4, 5, 7, 6),   # +x
        (0, 1, 5, 4),   # -y
        (2, 6, 7, 3),   # +y
        (0, 4, 6, 2),   # -z
        (1, 3, 7, 5),   # +z
    ]
    tris = []
    for q in quads:
        tris.append((q[0], q[1], q[2]))
        tris.append((q[0], q[2], q[3]))
    return mesh_from_tris(name, v, tris, mat)

def cyl_glb(name, center, radius, depth, mat, verts=10, axis='y'):
    "cylinder in GLB frame; axis 'y' = vertical (GLB up), 'x' = along lateral, 'z' = toward foot traffic"
    ob = None
    if axis == 'y':
        # Blender Z-cyl == GLB vertical
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=bl(*center))
    elif axis == 'x':
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=bl(*center),
                                            rotation=(0, math.radians(90), 0))
    elif axis == 'z':
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=bl(*center),
                                            rotation=(math.radians(90), 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return ob

def cloth_glb(name, rows, mat):
    "rows: list of rows, each row = list of GLB verts; builds quad grid between consecutive rows"
    tris = []
    n = len(rows[0])
    for r in range(len(rows) - 1):
        for i in range(n - 1):
            a = r * n + i
            b = r * n + i + 1
            c = (r + 1) * n + i + 1
            d = (r + 1) * n + i
            tris.append((a, b, c))
            tris.append((a, c, d))
    verts = [v for row in rows for v in row]
    return mesh_from_tris(name, verts, tris, mat, smooth=True)

def empty_glb(name, pos_glb):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.08
    e.location = bl(*pos_glb)
    bpy.context.collection.objects.link(e)
    return e

def tris_of(ob):
    if ob.type != 'MESH':
        return 0
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True,
                                  use_selection=True, export_extras=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True,
                                  use_selection=True)
    return os.path.getsize(path)

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()

# ---------------------------------------------------------------- stall kit
# shared proportions
CTR_W, CTR_D, CTR_H = 1.6, 0.7, 0.9      # spec counter 1.6 x 0.7 x 0.9
TRAY_X, TRAY_Y = 0.55, 1.01               # canonical tray face (exact)

def build_counter(m, tag, depth=CTR_D, width=CTR_W):
    "counter body + top slab, top surface exactly CTR_H"
    obs = []
    obs.append(box_glb(f'{tag}_body', (0, CTR_H / 2 - 0.02, 0), (width - 0.04, CTR_H - 0.04, depth - 0.04), m['timber']))
    obs.append(box_glb(f'{tag}_top', (0, CTR_H - 0.02, 0), (width, 0.04, depth), m['timberDark']))
    return obs

def build_tray(m, tag, lx, ly, lz, w=0.52, d=0.40):
    "tray plinth whose top surface = ly (mount face)"
    obs = []
    pl_h = ly - CTR_H - 0.04
    obs.append(box_glb(f'{tag}_trayplinth', (lx, CTR_H + pl_h / 2, lz), (w - 0.04, pl_h, d - 0.04), m['timber']))
    obs.append(box_glb(f'{tag}_tray', (lx, ly - 0.02, lz), (w, 0.04, d), m['pale']))
    return obs

def build_shelf(m, tag, obs):
    "rear shelf resting on cleats fixed to the two poles (pole line z=-0.6)"
    _shelf = []
    _shelf.append(box_glb(f'{tag}_shelf', (0, 1.50, -0.60), (1.94, 0.03, 0.26), m['timber']))
    for sx in (-0.95, 0.95):
        _shelf.append(box_glb(f'{tag}_shelfcleat', (sx, 1.445, -0.60), (0.05, 0.07, 0.12), m['timberDark']))
    obs.extend(_shelf)
    return obs

def build_awning(m, tag, canvas, w=2.0, d=1.4, front_y=2.2, rear_y=2.5, z_front=0.7, z_rear=-0.7):
    "canvas on two rear poles; front edge 2.2 (spec), sloping up to rear; scalloped valance"
    obs = []
    for sx in (-0.95, 0.95):
        obs.append(cyl_glb(f'{tag}_pole', (sx, 1.25, z_rear + 0.1), 0.035, 2.5, m['timberDark'], verts=8))
    rows = []
    nseg = 4
    for k in range(nseg + 1):
        t = k / nseg
        z = z_rear + (z_front - z_rear) * t
        y = rear_y + (front_y - rear_y) * t
        rows.append([(-w / 2 + w * i / 6, y, z) for i in range(7)])
    obs.append(cloth_glb(f'{tag}_awning', rows, m[canvas]))
    # scalloped valance hanging from front edge (5 scallops)
    n_sc, step = 5, 0.2
    xs = [-1.0 + step * i for i in range(2 * n_sc + 1)]
    vr = [[(x, front_y - 0.005, z_front + 0.002) for x in xs],
          [(x, front_y - (0.32 if i % 2 == 1 else 0.22), z_front + 0.006)
           for i, x in enumerate(xs)]]
    obs.append(cloth_glb(f'{tag}_valance', vr, m[canvas]))
    return obs

def build_steam(m):
    tag = 'stallSteam'
    obs = build_counter(m, tag)
    # display-case unit at lx -0.45: shelf face 1.16 (点心 case slot), cap top 1.31 (蒸煮 steamer face)
    lx = -0.45
    obs.append(box_glb(f'{tag}_casePlinth', (lx, 0.94, 0), (0.55, 0.08, 0.44), m['timberDark']))  # 0.90..0.98 support
    obs.append(box_glb(f'{tag}_caseBase', (lx, 1.00, 0), (0.55, 0.04, 0.44), m['timberDark']))
    obs.append(box_glb(f'{tag}_caseShelf', (lx, 1.145, 0), (0.55, 0.03, 0.42), m['pale']))
    obs.append(box_glb(f'{tag}_caseBack', (lx, 1.155, -0.20), (0.55, 0.30, 0.03), m['pale']))
    for sx in (-0.26, 0.26):
        obs.append(box_glb(f'{tag}_caseSide', (lx + sx, 1.155, 0), (0.03, 0.28, 0.44), m['pale']))
    obs.append(box_glb(f'{tag}_caseCap', (lx, 1.29, 0), (0.58, 0.04, 0.46), m['timberDark']))  # top = 1.31 steamer face
    obs += build_tray(m, tag, TRAY_X, TRAY_Y, 0)
    build_shelf(m, tag, obs)
    # spare steamer baskets on the rear shelf (spec: spare steamer stack slot)
    for k in range(2):
        obs.append(cyl_glb(f'{tag}_spareSteamer', (-0.55, 1.515 + 0.055 + k * 0.115, -0.60), 0.17, 0.11, m['pale'], verts=10))
    obs += build_awning(m, tag, 'canvasCream')
    obs.append(empty_glb('socket_tray', (TRAY_X, TRAY_Y, 0)))
    obs.append(empty_glb('socket_steamer', (-0.45, 1.31, 0)))
    obs.append(empty_glb('socket_case', (-0.45, 1.16, 0)))
    return obs

def build_grill(m):
    tag = 'stallGrill'
    obs = build_counter(m, tag)
    gx = -0.45
    # charcoal grill box, grate top exactly 1.13 (layout grill face)
    obs.append(box_glb(f'{tag}_grillBox', (gx, 1.005, 0), (0.50, 0.21, 0.36), m['steel']))
    obs.append(box_glb(f'{tag}_grillBed', (gx, 1.105, 0), (0.42, 0.03, 0.30), m['iron']))
    obs.append(box_glb(f'{tag}_grillGrate', (gx, 1.12, 0), (0.46, 0.02, 0.32), m['iron']))  # top = 1.13
    # smoke hood plane + chimney。wave14-stalllight 修复（巡检 #19）：罩+烟囱原是悬空板
    # （罩底 1.67–1.74，下方烤炉 grate 1.13，无任何支撑物，视觉上靠细撑杆「漂浮」）。
    # 支撑选择 = 落地立柱：台面后缘外立两根铁柱（z=-0.36，柜台 z∈[-0.33,0.33] 之外不穿柜体），
    # 柱顶托臂伸向罩后缘（z -0.37→-0.23）托住罩板。不选贴墙挂架（模块不知道放置处有无墙，rotY 不保证背面贴墙）、
    # 不选檐口吊挂（布棚是布，吊挂荷载不可信）。guard: tests/stall-hood-support-test.mjs（落地/到位/托住三判据）。
    obs.append(box_glb(f'{tag}_hood', (gx, 1.70, -0.02), (0.70, 0.02, 0.48), m['iron'], rot_x_deg=8))
    obs.append(box_glb(f'{tag}_chimney', (gx, 1.98, -0.16), (0.11, 0.55, 0.11), m['iron']))  # base meets hood top
    for px in (gx - 0.27, gx + 0.27):   # -0.72 / -0.18：罩 x 范围 [-0.8,-0.1] 内、避开烤炉 [-0.7,-0.2] 之外侧
        obs.append(cyl_glb(f'{tag}_hoodPost', (px, 0.89, -0.36), 0.020, 1.78, m['iron'], verts=8))
        # 托臂：柱（z-0.36）→ 罩后缘（罩顶面后缘 y≈1.743），臂 y 1.725–1.755 与罩搭接
        obs.append(box_glb(f'{tag}_hoodArm', (px, 1.74, -0.30), (0.05, 0.03, 0.14), m['iron']))
    obs += build_tray(m, tag, TRAY_X, TRAY_Y, 0)
    # skewer rack on counter right
    for sz in (-0.24, 0.24):
        obs.append(cyl_glb(f'{tag}_rackPost', (0.58, 1.20, sz), 0.018, 0.60, m['iron'], verts=6))
    # smallqa 发现7修复：横杆原来躺在 z=0 平面，与 z=±0.24 的立柱错位 0.22–0.26 m 整根悬空。
    # 横杆改为跨在两立柱之间（沿 +Z，长度仍 0.50，端头包住柱心 ±0.25），三根高度不变；
    # 串扦仍沿 +X，落在中杆（y1.32）顶面上（杆顶 1.332，扦心 1.337 → 相切搭接），z 三档不变。
    for hy in (1.16, 1.32, 1.48):
        obs.append(cyl_glb(f'{tag}_rackBar', (0.58, hy, 0), 0.012, 0.50, m['steel'], verts=6, axis='z'))
    for k in range(3):
        obs.append(cyl_glb(f'{tag}_skewer', (0.58, 1.337, -0.16 + 0.16 * k), 0.006, 0.34, m['steel'], verts=5, axis='x'))
    build_shelf(m, tag, obs)
    obs += build_awning(m, tag, 'canvasWine')
    obs.append(empty_glb('socket_tray', (TRAY_X, TRAY_Y, 0)))
    obs.append(empty_glb('socket_grill', (-0.45, 1.13, 0)))
    return obs

def build_drink(m):
    tag = 'stallDrink'
    D = 0.8  # drink counter slightly deeper so the cup cabinet clears the front tray
    obs = build_counter(m, tag, depth=D)
    # glass-front cabinet 0.9 wide, rear-left; cup shelf face exactly 1.31 at (-0.5,1.31,-0.25)
    cbl, cbr = -0.8, 0.1          # lx range (0.9 wide)
    czf, czb = -0.125, -0.425     # front/back z (0.3 deep), cup face lz -0.25 inside
    obs.append(box_glb(f'{tag}_cabBase', (-0.35, 0.92, (czf + czb) / 2), (0.9, 0.04, 0.30), m['timberDark']))
    obs.append(box_glb(f'{tag}_cabTop', (-0.35, 1.29, (czf + czb) / 2), (0.9, 0.04, 0.30), m['timberDark']))  # top = 1.31
    # smallqa 发现8修复：背板顶边原到 1.29，高出柜顶板底（棚面 1.27）0.02 m 露黑边；
    # 降到顶 1.26 = 棚面下 0.01 m 净距，底 0.92 仍插在 cabBase（0.90–0.94）内。
    obs.append(box_glb(f'{tag}_cabBack', (-0.35, 1.09, czb + 0.015), (0.9, 0.34, 0.03), m['pale']))
    for sx in (cbl + 0.015, cbr - 0.015):
        obs.append(box_glb(f'{tag}_cabSide', (sx, 1.105, (czf + czb) / 2), (0.03, 0.37, 0.30), m['pale']))
    obs.append(box_glb(f'{tag}_cabShelf', (-0.35, 1.155, (czf + czb) / 2 - 0.02), (0.84, 0.02, 0.26), m['pale']))
    obs.append(box_glb(f'{tag}_cabGlass', (-0.35, 1.105, czf), (0.86, 0.35, 0.012), m['glass']))
    obs += build_tray(m, tag, 0, TRAY_Y, 0.1, w=0.55, d=0.40)
    # kettle stack on counter right rear
    for k in range(2):
        ky = 0.92 + 0.15 * k
        obs.append(cyl_glb(f'{tag}_kettle', (0.58, ky + 0.08, -0.18), 0.105, 0.16, m['steel'], verts=10))
        obs.append(cyl_glb(f'{tag}_kettleLid', (0.58, ky + 0.175, -0.18), 0.055, 0.03, m['iron'], verts=8))
        obs.append(cyl_glb(f'{tag}_kettleSpout', (0.46, ky + 0.10, -0.18), 0.018, 0.14, m['steel'], verts=6, axis='x'))
    build_shelf(m, tag, obs)
    obs += build_awning(m, tag, 'canvasIndigo')
    obs.append(empty_glb('socket_tray', (0, TRAY_Y, 0.1)))
    obs.append(empty_glb('socket_cup', (-0.5, 1.31, -0.25)))
    return obs

def build_bench(m):
    tag = 'bench'
    obs = []
    obs.append(box_glb(f'{tag}_top', (0, 0.47, 0), (1.6, 0.06, 0.45), m['timber']))       # seat top 0.50
    obs.append(box_glb(f'{tag}_apron', (0, 0.40, 0), (1.5, 0.08, 0.35), m['timberDark']))
    for sx in (-0.72, 0.72):
        for sz in (-0.165, 0.165):
            obs.append(box_glb(f'{tag}_leg', (sx, 0.18, sz), (0.06, 0.36, 0.06), m['timberDark']))
    return obs

# ---------------------------------------------------------------- old-south 檐灯（wave14-stalllight B）
# 老城隍庙南侧过街楼街廊（anchor-old-south，tourfix 移交照明欠项：night 主体 ~2.1/255）夜间补光：
# 在既有建筑墙面加贴墙支架灯（不新增建筑）。位置规则与 tests/oldsouth-lamps-test.mjs 同一定义、两端独立实现：
#   走廊 = pinned 冻结路线 old-south->old-north 第一段 p0→p1；
#   灯墙 = 走廊两侧「建筑类 footprint 边」（kinds 与 scripts/tour-visibility.mjs FACADE_KINDS 一致）中
#          覆盖走廊投影 ≥8 m、横向距走廊 0.3–8 m 的边；
#   每侧在走廊投影 t = 5/15/25 m 各一盏：位置 = 墙边在 t 处的插值点，沿墙边法线（朝走廊一侧）回退 0.22 m；
#   rotY = 灯面朝走廊（模型 +Z）。灯具挂高 2.19–2.75 m（罩中心 2.35），2.2 m 人体带之上，无碰撞盒。
OLDSOUTH_ROUTE = ('old-south', 0, 1)
OLDSOUTH_TS = (5.0, 15.0, 25.0)
OLDSOUTH_SETBACK_M = 0.22
OLDSOUTH_FACADE_KINDS = {'outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'corridor',
                         'waterside', 'stage', 'watersideGallery', 'facadeBay', 'shopAnchor', 'templeAnchor',
                         'wall', 'wallHead', 'moonGateWall', 'gateAnchor'}
OLDSOUTH_LAMP_MOUNT_Y = 2.35   # 罩中心；点光候选 = 节点原点(地面) + presets 源 offsetY=2.05（罩底缘下方，灯在罩外避免 Cycles 被罩体遮死）

def compute_oldsouth_lamps():
    pin = json.load(open(os.path.join(AREA, 'baseline', 'commercial-route.pinned.json'), encoding='utf-8'))
    r = next(x for x in pin['routes'] if x['from'] == OLDSOUTH_ROUTE[0])
    p0, p1 = r['points'][OLDSOUTH_ROUTE[1]], r['points'][OLDSOUTH_ROUTE[2]]
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    d = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L]
    lay = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))

    def cross(pt):
        vx, vy = pt[0] - p0[0], pt[1] - p0[1]
        return vx * (-d[1]) + vy * d[0]

    def tproj(pt):
        vx, vy = pt[0] - p0[0], pt[1] - p0[1]
        return vx * d[0] + vy * d[1]

    edges = []
    for o in lay['objects']:
        if o.get('kind') not in OLDSOUTH_FACADE_KINDS:
            continue
        fp = o.get('geometry', {}).get('footprint')
        if not fp:
            continue
        pts = fp[:-1] if fp[0] == fp[-1] else fp
        for a, b in zip(pts, pts[1:] + pts[:1]):
            smp = [(a[0] + (b[0] - a[0]) * k / 20, a[1] + (b[1] - a[1]) * k / 20) for k in range(21)]
            cs = [cross(q) for q in smp]
            sides = set(1 if c > 0 else -1 for c in cs)
            if len(sides) != 1:
                continue
            lats = [abs(c) for c in cs]
            ts = [tproj(q) for q in smp]
            cover = min(max(ts), L) - max(min(ts), 0)
            if cover < 8 or max(lats) > 8 or min(lats) < 0.3:
                continue
            edges.append({'side': sides.pop(), 'a': a, 'b': b, 'id': o['id']})

    def wallpoint(e, t):
        ta, tb = tproj(e['a']), tproj(e['b'])
        if tb == ta:
            return None
        u = (t - ta) / (tb - ta)
        if not (0 <= u <= 1):
            return None
        x = e['a'][0] + (e['b'][0] - e['a'][0]) * u
        z = e['a'][1] + (e['b'][1] - e['a'][1]) * u
        return x, z, abs(cross((x, z)))

    lamps = []
    for t in OLDSOUTH_TS:
        for side in (1, -1):
            cand = []
            for e in edges:
                if e['side'] != side:
                    continue
                wp = wallpoint(e, t)
                if wp:
                    cand.append((wp[2], e, wp))
            if not cand:
                print(f"[oldsouth-lamp] t={t} side={side}: no qualifying wall, skipped")
                continue
            cand.sort(key=lambda c: c[0])
            lat, e, wp = cand[0]
            bx, bz = e['b'][0] - e['a'][0], e['b'][1] - e['a'][1]
            bl = math.hypot(bx, bz)
            bx, bz = bx / bl, bz / bl
            nx, nz = bz, -bx   # 墙边法线（两选一，下按朝走廊定向）
            gx, gz = p0[0] + d[0] * t - wp[0], p0[1] + d[1] * t - wp[1]
            gl = math.hypot(gx, gz)
            gx, gz = gx / gl, gz / gl
            if nx * gx + nz * gz < 0:
                nx, nz = -nx, -nz
            lamps.append({'id': 'oldsouth-lamp-%d' % (len(lamps) + 1), 't': t, 'side': side, 'wall': e['id'],
                          'position': [round(wp[0] + nx * OLDSOUTH_SETBACK_M, 3), round(wp[1] + nz * OLDSOUTH_SETBACK_M, 3)],
                          'rotY': round(math.atan2(nx, nz), 6), 'wallLat': round(lat, 3),
                          'module': 'oldsouth-lamp.glb', 'zone': 'bazaar', 'height': 2.75})
    return lamps

def build_oldsouth_lamp(m):
    """贴墙支架灯（wall bracket lamp）：原点 = 地面投影点，-Z 贴墙、+Z 朝街。挂高 2.19–2.75 m。"""
    tag = 'oldsouthLamp'
    obs = []
    # 贴墙背板（放置离墙皮 0.22 → 背板 z∈[-0.22,-0.19] 正贴墙面）
    obs.append(box_glb(f'{tag}_backplate', (0, 2.45, -0.205), (0.16, 0.50, 0.03), m['iron']))
    # 水平托臂（墙 z-0.22 → 街端 z+0.02，y 2.62）
    obs.append(cyl_glb(f'{tag}_arm', (0, 2.62, -0.10), 0.015, 0.24, m['iron'], verts=8, axis='z'))
    # 斜撑：墙端 (2.28,-0.20) → 臂端 (2.63,-0.03)，绕 X 转 +25.9°（+y 端朝街）
    obs.append(box_glb(f'{tag}_brace', (0, 2.455, -0.115), (0.018, 0.39, 0.018), m['iron'], rot_x_deg=25.9))
    # 吊杆连臂与罩顶
    obs.append(cyl_glb(f'{tag}_stem', (0, 2.58, 0), 0.012, 0.12, m['iron'], verts=6))
    # 六角红纸灯罩（中心 2.35）+ 黄铜顶盖/底缘
    obs.append(cyl_glb(f'{tag}_shade', (0, 2.35, 0), 0.15, 0.30, m['oldsLantern'], verts=6))
    obs.append(cyl_glb(f'{tag}_cap', (0, 2.515, 0), 0.17, 0.035, m['oldsBrass'], verts=6))
    obs.append(cyl_glb(f'{tag}_rim', (0, 2.19, 0), 0.17, 0.025, m['oldsBrass'], verts=6))
    return obs


# ---------------------------------------------------------------- awning strip
# per bazaarBlock front edge; wall-attach edge 2.85, street front edge 2.78, slope ~3.3deg,
# projection 1.2, scalloped valance, iron brackets spacing 1.5m (2 per 3m)
# smallqa 发现1/9修复（2026-09-26）：安装带原 3.1015 m（front 2.78 + proj*tan15°），与街面立面
# 披檐构件带 y 2.915–3.08（出墙皮）全长度互穿（16/16 条，合计交线 1895.6 m）。上安装带降为
# 2.85 m（线脚带下方 0.065 m），前沿 2.78 与出挑 1.2 不变 → 坡度 15°→3.34°，坡面连续；
# 挂帘下沿 2.54 m 仍在 2.5 m 人体带之上。交叉实测（out-fixbase procedural 块实体 × 旧布面）：
# 邻块/outer 交线全部集中在 y 2.83–3.05，降带后自然消除；仅端部角落还需端部裁剪（见下表）。
AWNING_WALL_Y = 2.85
# 剔除表（wave8-smallqa Q2 已定规则：布面×塔楼/邻块构件交线 >5 m 或吞没率 >10% → 剔除该 edge）。
# 2026-09-26 复测补充 3 条贴面共边 edge：与邻块 footprint 零间距（共享墙线），邻块侧是步行通道口
# （road-428199190/760475727 穿 553893884、road-760475693 穿 outer 553893872，净高 3.5 m）——布面
# 降到 2.78 平铺仍切进通道侧壁/墙皮（修后实测 27.1 / 18.0 / 16.6 m，修前 50.3 / 43.8 / 17.6 m，
# 高度带 0.06–3.5），任何 ≤2.85 安装带都无解 → 按规则剔除。16 → 12 条。
AWNING_EXCLUDED = {
    'bld-389701812-5': '布面×塔楼灯笼串/牌匾 308 交线/35.65 m（wave8-smallqa Q2②）',
    'bld-389702030-1': '贴面共边×bld-553893884 步行通道口：修后 2.78 平铺仍 29 交线/27.1 m（0.06–3.5 m），≤2.85 无解 → 剔除',
    'bld-428202604-0': '贴面共边×bld-553893884 步行通道口：修后 2.78 平铺仍 18 交线/18.0 m → 剔除',
    'bld-428202606-10': '贴面共边×outer bld-553893872 步行通道口（road-760475693）：修后 2.78 平铺仍 35 交线/16.6 m → 剔除',
}
# 端部裁剪表（blockId, edgeIndex）-> (起点裁剪 m, 终点裁剪 m)。s 从 edge[0] 沿 edge[1] 方向量。
# 依据：baseline/layout.json footprint 采样（出挑带 0.02–1.18 m、步长 0.1）+ 旧产物实测交叉，
# 裁掉与邻块贴角段的布面，留 0.4–0.5 m 余量；中段与前沿净高不受影响。
AWNING_END_TRIM_M = {
    ('bld-165791764', 6): (0.5, 0.0),   # s=0 端贴 bld-428202599 角（实测 0.5 m 交叉带）
    ('bld-428202607', 1): (0.5, 0.0),   # s=0 端贴 bld-553893884 角（2.6 m）
    ('bld-553893867', 2): (0.5, 0.0),   # s=0 端贴 bld-553893868 角（3.5 m）
    ('bld-553893868', 0): (0.5, 0.0),   # s=0 端贴 bld-553893867 角（0.5 m）
}

def build_awning_strip(m, tag, length, canvas_idx=0):
    L = length
    proj, front_y = 1.2, 2.78   # lead 2026-09-23: valance bottom (front_y-0.24) must clear the 2.5 m walking-body band (was 2.4 → narrowed 3 commercial routes)
    wall_y = AWNING_WALL_Y      # 2026-09-26: ≤2.85 clears the 2.915–3.08 facade trim band (smallqa finding 1/9)
    canvas = ('canvasWine', 'canvasIndigo', 'canvasCream')[canvas_idx % 3]
    obs = []
    nseg = max(2, int(round(L / 1.0)))
    rows = []
    for k in range(3):  # 2 quads across depth
        t = k / 2.0
        z = proj * t                      # +Z = outward toward street
        y = wall_y + (front_y - wall_y) * t
        rows.append([(-L / 2 + L * i / nseg, y, z) for i in range(nseg + 1)])
    obs.append(cloth_glb(f'{tag}_cloth', rows, m[canvas]))
    # scalloped valance on street edge
    ns = max(2, int(round(L / 0.5)))
    top = [(-L / 2 + L * i / ns, front_y - 0.005, proj) for i in range(ns + 1)]
    bot = []
    for i in range(ns + 1):
        x = -L / 2 + L * i / ns
        drop = 0.16
        if i % 2 == 1:
            drop = 0.24
        bot.append((x, front_y - drop, proj + 0.004))
    obs.append(cloth_glb(f'{tag}_valance', [top, bot], m[canvas]))
    # iron brackets, spacing 1.5 m, ends included
    nb = max(2, int(round(L / 1.5)) + 1)
    ang = math.degrees(math.atan2(wall_y - front_y, proj))  # ~15deg: arm axis mostly along +Z
    for k in range(nb):
        x = -L / 2 + L * k / (nb - 1)
        obs.append(box_glb(f'{tag}_bracketPlate', (x, wall_y - 0.24, 0.03), (0.05, 0.48, 0.06), m['iron']))
        arm = math.hypot(proj, wall_y - front_y)
        obs.append(box_glb(f'{tag}_bracketArm', (x, (wall_y + front_y) / 2, proj / 2), (0.04, 0.04, arm), m['iron'], rot_x_deg=ang))
    return obs

# ---------------------------------------------------------------- main
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

BENCH_LEN, BENCH_GAP = 1.6, 0.10   # wave8-smallqa Q2① 规则：同排凳距 = 模块长 + 0.10 m 缝

def repair_bench_rows(benches):
    """同 (cluster, rotY) 且 |横向偏差|≤0.3 m 的成排长凳，相邻沿轴间距 < 凳长+0.05 的连续段
    按 1.70 m 等距重排（首凳为锚）。修 wave8 发现3：stall-49/50/51 同排半叠 0.80 m。
    外部 site-inputs 是冻结输入，规则在此重放，避免重生成 placements 时回退。"""
    rows = {}
    for b in benches:
        rows.setdefault((b['cluster'], round(b['rotY'], 3)), []).append(b)
    moved = {}
    for (cluster, rot), row in rows.items():
        if len(row) < 2:
            continue
        ax, az = math.cos(rot), -math.sin(rot)   # local X → map（同 tests/smallqa-test 口径）
        for b in row:
            b['_along'] = b['position'][0] * ax + b['position'][1] * az
        row.sort(key=lambda x: x['_along'])
        # 同 smallqa-test：成对判横向偏差（相邻两凳连线垂直分量 ≤0.3 m 才算同排）
        lat = lambda p, q: abs(-(q['position'][0] - p['position'][0]) * math.sin(rot)
                               + (q['position'][1] - p['position'][1]) * math.cos(rot))
        run = [row[0]]
        runs = []
        for prev, cur in zip(row, row[1:]):
            if lat(prev, cur) <= 0.3 and cur['_along'] - prev['_along'] < BENCH_LEN + 0.05:
                run.append(cur)
            else:
                if len(run) >= 2:
                    runs.append(run)
                run = [cur]
        if len(run) >= 2:
            runs.append(run)
        for r in runs:
            anchor = r[0]
            for k, b in enumerate(r):
                moved[b['id']] = [anchor['position'][0] + k * (BENCH_LEN + BENCH_GAP) * ax,
                                  anchor['position'][1] + k * (BENCH_LEN + BENCH_GAP) * az]
    for b in benches:
        b.pop('_along', None)
        b.pop('_lat', None)
        if b['id'] in moved:
            b['position'] = moved[b['id']]
    return sorted(moved)

def build_all():
    site = json.load(open(SITE, encoding='utf-8'))
    manifest = {'packageId': site['packageId'], 'generatedBy': 'build_bazaar_stalls.py', 'files': {}}
    mods = {}

    def do(name, fn, budget, extra=None):
        reset()
        m = make_mats(['timber', 'timberDark', 'canvasCream', 'canvasWine', 'canvasIndigo', 'iron', 'steel', 'pale', 'glass',
                       'oldsLantern', 'oldsBrass'])
        obs = fn(m)
        tris = sum(tris_of(o) for o in obs)
        ok = tris <= budget
        path = os.path.join(OUT, name)
        size = export_glb(path, obs)
        manifest['files'][name] = {'tris': tris, 'bytes': size, 'budget': budget,
                                   'budgetOk': ok, 'sha256': sha256(path)}
        if extra:
            manifest['files'][name].update(extra)
        print(f'[kit] {name}: tris={tris} budget={budget} ok={ok} bytes={size}')
        if not ok:
            sys.exit(f'BUDGET FAIL {name}')

    do('stall-steam.glb', build_steam, BUDGET['stallMax'])
    do('stall-grill.glb', build_grill, BUDGET['stallMax'])
    do('stall-drink.glb', build_drink, BUDGET['stallMax'])
    do('bench.glb', build_bench, BUDGET['benchMax'])
    do('oldsouth-lamp.glb', build_oldsouth_lamp, BUDGET['lampMax'],
       extra={'note': 'old-south 街廊贴墙支架灯（挂高 2.19–2.75 m，无碰撞）；放置见 records/lamps.json'})

    # 12 active awning strips (16 site edges − 4 excluded: 1 tower clash + 3 passage-mouth flush edges)
    awn = []
    repairs = [{
        'date': '2026-09-26',
        'id': 'awning-bld-389701812-5',
        'finding': '布面×塔楼构件交线 308 条/35.65 m（灯笼串 274/20.37 m、牌匾 34/15.3 m，吞没率 1%）——2026-09-26 BAZAAR_TOWERS 默认开启后，塔楼灯笼/牌匾挂带（y 2.9–3.1 m）与檐棚安装带同高',
        'fix': '剔除该 edge（16→15 条）',
        'rule': '檐棚布面 × 塔楼/邻块构件 交线 >5 m 或布面吞没率 >10% → 剔除',
        'guard': 'tests/smallqa-test.mjs awning-tower-clearance',
        'by': 'wave8-smallqa Q2② (1af8aa28)',
    }, {
        'date': '2026-09-26',
        'id': 'ALL (发现1/9)',
        'finding': '布面安装带 3.1015 m 与立面披檐构件带 y 2.915–3.08 全长度互穿；邻块/outer 交叉实测全部集中在 y 2.83–3.05（out-fixbase procedural 实体 × 旧布面，6.4 s 复算）',
        'fix': '上安装带 3.1015→2.85 m（前沿 2.78、出挑 1.2 不变，坡度 15°→3.34°）；端部裁剪 4 条（每条 0.5 m）',
        'rule': '安装带 ≤2.85 m 避开线脚带；端部按 baseline/layout 邻块贴角段裁剪，留 0.4–0.5 m 余量；不靠删檐棚',
        'guard': 'tests/smallfix-test.mjs awning-facade-band + awning-neighbor-clearance',
        'by': 'night-smallfix-20260926 B2#1/#9',
    }, {
        'date': '2026-09-26',
        'id': ['bld-389702030-1', 'bld-428202604-0', 'bld-428202606-10'], 'kind': 'exclude',
        'finding': '贴面共边 3 条（×bld-553893884 / ×outer bld-553893872，footprint 零间距）：邻块侧为步行通道口（净高 3.5 m）。2.85 安装带切邻块线脚带 y2.81–2.90（54.7/48.7/19.6 m）；降 2.78 平铺仍切通道侧壁（27.1/18.0/16.6 m），≤2.85 无解',
        'fix': '按 wave8 既定规则剔除（16→12 条）；其余 12 条 2.85 安装带 + 4 条端部 0.5 m 裁剪',
        'rule': '布面×邻块构件交线 >5 m（裁剪/降带后仍超）→ 剔除；不靠删掉全部檐棚',
        'guard': 'tests/smallfix-test.mjs awning-neighbor-clearance',
        'by': 'night-smallfix-20260926 B2#9',
    }]
    trims_applied = {}
    for i, e in enumerate(site['awningEdges']):
        key = f"{e['blockId']}-{e['edgeIndex']}"
        if key in AWNING_EXCLUDED:
            print(f"[awning] {key}: EXCLUDED — {AWNING_EXCLUDED[key]}")
            continue
        name = f"awning-{key}.glb"
        (ax, az), (bx, bz) = e['edge']
        elen = math.hypot(bx - ax, bz - az)
        ux, uz = (bx - ax) / elen, (bz - az) / elen
        t0, t1 = AWNING_END_TRIM_M.get((e['blockId'], e['edgeIndex']), (0.0, 0.0))
        built_len = elen - t0 - t1
        if built_len <= 0:
            sys.exit(f'AWNING TRIM FAIL {key}: built_len {built_len}')
        if t0 or t1:
            trims_applied[key] = {'trimStartM': t0, 'trimEndM': t1, 'sourceLenM': round(elen, 2), 'builtLenM': round(built_len, 2)}
        reset()
        m = make_mats(['canvasWine', 'canvasIndigo', 'canvasCream', 'iron'])
        obs = build_awning_strip(m, 'awning', built_len, i)
        tris = sum(tris_of(o) for o in obs)
        per_m = tris / built_len
        ok = per_m <= BUDGET['awningPerMetreMax']
        path = os.path.join(OUT, 'awnings', name)
        size = export_glb(path, obs)
        dx, dz = e['dir']
        ox, oz = e['outward']
        rotY = math.atan2(-dz, dx) if (abs(ox - (-dz)) < 1e-4 and abs(oz - dx) < 1e-4) else math.atan2(dz, -dx)
        slope = math.degrees(math.atan2(AWNING_WALL_Y - 2.78, 1.2))
        # 裁剪后的真实墙边（assemble/测试按此中点与朝向放置）；sourceEdge 保留原始冻结边备查
        edge_trimmed = [[round(ax + ux * t0, 3), round(az + uz * t0, 3)],
                        [round(bx - ux * t1, 3), round(bz - uz * t1, 3)]]
        awn.append({'blockId': e['blockId'], 'edgeIndex': e['edgeIndex'], 'street': e['street'],
                    'edge': edge_trimmed, 'sourceEdge': e['edge'], 'dir': e['dir'], 'lenM': round(built_len, 2),
                    'midpoint': [(edge_trimmed[0][0] + edge_trimmed[1][0]) / 2, (edge_trimmed[0][1] + edge_trimmed[1][1]) / 2],
                    'outward': e['outward'],
                    'rotY': rotY, 'module': f'awnings/{name}',
                    'geometry': {'builtLengthM': round(built_len, 2), 'projectionM': 1.2,
                                 'frontHeightM': 2.78, 'wallHeightM': AWNING_WALL_Y, 'slopeDeg': round(slope, 2),
                                 'scallopWidthM': 0.5, 'bracketSpacingM': 1.5},
                    'tris': tris, 'trisPerMetre': round(per_m, 2), 'bytes': size,
                    'budgetOk': ok, 'sha256': sha256(path)})
        print(f"[awning] {name}: L={built_len:.1f} (trim {t0}+{t1}) tris={tris} per_m={per_m:.1f} ok={ok}")
        if not ok:
            sys.exit(f'BUDGET FAIL {name}')
    if trims_applied:
        repairs.append({'date': '2026-09-26', 'id': sorted(trims_applied), 'kind': 'end-trim',
                        'detail': trims_applied,
                        'rule': '端部 0.5 m 裁剪：edge 端点落在邻块贴角段（baseline/layout footprint 采样 + 旧产物交叉实测），中段摆位/通路不动',
                        'by': 'night-smallfix-20260926 B2#9'})

    # placements.json
    mod_files = {k: v for k, v in manifest['files'].items() if k != 'bench.glb'}
    stalls = []
    for s in site['stalls']:
        mdl = f"stall-{s['type']}.glb"
        coll = {'size': [2.0, 0.7], 'height': 2.2, 'note': 'stall box: counter + poles + awning front drop; awnings unreachable above 2.2'}
        stalls.append({'id': s['id'], 'kind': 'stall', 'type': s['type'], 'module': mdl,
                       'position': s['position'], 'rotY': s['rotY'], 'height': s['height'],
                       'cluster': s['cluster'], 'foodUse': s['foodUse'],
                       'extras': {'slots': s['slots']},
                       'collision': coll})
    benches = [{'id': b['id'], 'kind': 'bench', 'module': 'bench.glb',
                'position': list(b['position']), 'rotY': b['rotY'], 'height': b['height'],
                'cluster': b['cluster'],
                'collision': {'size': [1.6, 0.45], 'height': 0.5}} for b in site['benches']]
    # wave8-smallqa Q2①：同排半叠长凳 1.70 m 等距重排（规则在生成器重放，见 repair_bench_rows）
    bench_moved = repair_bench_rows([b for b in benches])
    bench_repairs = []
    if bench_moved:
        bench_repairs.append({'date': '2026-09-26', 'id': 'bench-cluster-1', 'moved': bench_moved,
                              'finding': 'stall-49/50/51 同排长凳间距 0.80 m < 凳长 1.60 m，两两半叠（互穿 46 交线/5.06 m 每对）',
                              'fix': '保持首凳基准与 rotY，后续沿凳轴 1.70 m 等距（凳长 1.60 + 0.10 缝）',
                              'rule': '同排长凳沿轴间距 = 模块长 + 0.10 m 缝；tests/smallqa-test.mjs bench-row-spacing 守恒',
                              'by': 'wave8-smallqa Q2① (1d7a3eac)；生成器重放 night-smallfix-20260926'})
    placements = {
        'packageId': site['packageId'], 'generatedBy': 'build_bazaar_stalls.py',
        'sourceLayout': site['source'],
        'contract': {
            'worldFrame': 'GLB Y-up world = (map_x, height, map_z); placement = position(map) + R_y(rotY)',
            'stallLocalFrame': 'origin center on ground, +X lateral, +Z toward foot traffic',
            'slotSemantics': 'extras.slots reproduced from frozen layout; mount faces owned by module furniture; empties socket_* carry the exact local offsets',
            'collision': 'stall box + bench box; awnings unreachable',
        },
        'modules': manifest['files'],
        'counts': {'stalls': len(stalls), 'benches': len(benches)},
        'repairs': bench_repairs,
        'stalls': stalls, 'benches': benches,
    }
    with open(os.path.join(OUT, 'placements.json'), 'w', encoding='utf-8') as f:
        json.dump(placements, f, ensure_ascii=False, indent=1)
    # 老街檐灯放置记录（records/ 是跟踪文件；assemble.py OLDSOUTH_LAMPS 段按此放置）
    lamps = compute_oldsouth_lamps()
    lamp_rec = {'packageId': site['packageId'], 'generatedBy': 'build_bazaar_stalls.py',
                'source': 'computed from baseline/commercial-route.pinned.json (old-south 第一段) + baseline/layout.json 建筑边；规则见 OLDSOUTH_* 常量与 tests/oldsouth-lamps-test.mjs（独立重算对账）',
                'design': {'corridorRoute': OLDSOUTH_ROUTE, 'tAlongM': list(OLDSOUTH_TS),
                           'setbackM': OLDSOUTH_SETBACK_M, 'shadeCenterY': OLDSOUTH_LAMP_MOUNT_Y,
                           'mountRangeY': [2.19, 2.75], 'collision': 'none (挂高 2.2 m 人体带之上，同檐棚 unreachable 契约)',
                           'nightLighting': 'presets.json oldsouth-lamp emissiveGroup + oldsouth-lamp node-anchor 点光源（offsetY 2.05，罩底缘下方）'},
                'counts': {'lamps': len(lamps)},
                'lamps': lamps}
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'records', 'lamps.json'), 'w', encoding='utf-8') as f:
        json.dump(lamp_rec, f, ensure_ascii=False, indent=1)
    print(f'[kit] lamps.json written ({len(lamps)} lamps)')
    awp = {'packageId': site['packageId'], 'generatedBy': 'build_bazaar_stalls.py',
           'module': 'awning strip (parametric, one GLB per edge)',
           'design': {'projectionM': 1.2, 'frontHeightM': 2.78, 'wallHeightM': AWNING_WALL_Y,
                      'slopeDeg': round(math.degrees(math.atan2(AWNING_WALL_Y - 2.78, 1.2)), 2),
                      'scallopWidthM': 0.5, 'brackets': '2 per 3m (spacing 1.5m, ends included)',
                      'canvasAlternation': 'wine/indigo/cream round-robin by edge order',
                      'collision': 'unreachable (valance bottom 2.54m, above 2.5m body band) — no collision box'},
           'counts': {'edges': len(awn), 'skipped': sorted(AWNING_EXCLUDED)},
           'repairs': repairs,
           'edges': awn}
    with open(os.path.join(OUT, 'awning-placements.json'), 'w', encoding='utf-8') as f:
        json.dump(awp, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('[kit] placements.json + awning-placements.json + manifest.json written')

build_all()
