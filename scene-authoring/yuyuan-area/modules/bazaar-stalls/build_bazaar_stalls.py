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

BUDGET = {'stallMax': 1500, 'benchMax': 300, 'awningPerMetreMax': 120}

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
    "cylinder in GLB frame; axis 'y' = vertical (GLB up), 'x' = along lateral"
    ob = None
    if axis == 'y':
        # Blender Z-cyl == GLB vertical
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=bl(*center))
    elif axis == 'x':
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=bl(*center),
                                            rotation=(0, math.radians(90), 0))
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
    # smoke hood plane + chimney
    obs.append(box_glb(f'{tag}_hood', (gx, 1.70, -0.02), (0.70, 0.02, 0.48), m['iron'], rot_x_deg=8))
    obs.append(box_glb(f'{tag}_chimney', (gx, 1.98, -0.16), (0.11, 0.55, 0.11), m['iron']))  # base meets hood top
    obs += build_tray(m, tag, TRAY_X, TRAY_Y, 0)
    # skewer rack on counter right
    for sz in (-0.24, 0.24):
        obs.append(cyl_glb(f'{tag}_rackPost', (0.58, 1.20, sz), 0.018, 0.60, m['iron'], verts=6))
    for k, hy in enumerate((1.16, 1.32, 1.48)):
        obs.append(cyl_glb(f'{tag}_rackBar', (0.58, hy, 0), 0.012, 0.50, m['steel'], verts=6, axis='x'))
    for k in range(3):
        obs.append(cyl_glb(f'{tag}_skewer', (0.58, 1.30 + 0.02 * k, -0.16 + 0.16 * k), 0.006, 0.34, m['steel'], verts=5, axis='x'))
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
    obs.append(box_glb(f'{tag}_cabBack', (-0.35, 1.105, czb + 0.015), (0.9, 0.37, 0.03), m['pale']))
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

# ---------------------------------------------------------------- awning strip
# per bazaarBlock front edge; wall-attach edge 2.72, street front edge 2.40, slope 15deg,
# projection 1.2, scalloped valance, iron brackets spacing 1.5m (2 per 3m)
def build_awning_strip(m, tag, length, canvas_idx=0):
    L = length
    proj, front_y = 1.2, 2.4
    wall_y = front_y + proj * math.tan(math.radians(15))
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
        drop = 0.24
        if i % 2 == 1:
            drop = 0.34
        bot.append((x, front_y - drop, proj + 0.004))
    obs.append(cloth_glb(f'{tag}_valance', [top, bot], m[canvas]))
    # iron brackets, spacing 1.5 m, ends included
    nb = max(2, int(round(L / 1.5)) + 1)
    ang = math.degrees(math.atan2(wall_y - front_y, proj))  # ~15deg: arm axis mostly along +Z
    for k in range(nb):
        x = -L / 2 + L * k / (nb - 1)
        obs.append(box_glb(f'{tag}_bracketPlate', (x, 2.54, 0.03), (0.05, 0.48, 0.06), m['iron']))
        arm = math.hypot(proj, wall_y - front_y)
        obs.append(box_glb(f'{tag}_bracketArm', (x, (wall_y + front_y) / 2, proj / 2), (0.04, 0.04, arm), m['iron'], rot_x_deg=ang))
    return obs

# ---------------------------------------------------------------- main
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def build_all():
    site = json.load(open(SITE, encoding='utf-8'))
    manifest = {'packageId': site['packageId'], 'generatedBy': 'build_bazaar_stalls.py', 'files': {}}
    mods = {}

    def do(name, fn, budget, extra=None):
        reset()
        m = make_mats(['timber', 'timberDark', 'canvasCream', 'canvasWine', 'canvasIndigo', 'iron', 'steel', 'pale', 'glass'])
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

    # 16 awning strips
    awn = []
    for i, e in enumerate(site['awningEdges']):
        name = f"awning-{e['blockId']}-{e['edgeIndex']}.glb"
        reset()
        m = make_mats(['canvasWine', 'canvasIndigo', 'canvasCream', 'iron'])
        obs = build_awning_strip(m, 'awning', e['lenM'], i)
        tris = sum(tris_of(o) for o in obs)
        per_m = tris / e['lenM']
        ok = per_m <= BUDGET['awningPerMetreMax']
        path = os.path.join(OUT, 'awnings', name)
        size = export_glb(path, obs)
        dx, dz = e['dir']
        ox, oz = e['outward']
        rotY = math.atan2(-dz, dx) if (abs(ox - (-dz)) < 1e-4 and abs(oz - dx) < 1e-4) else math.atan2(dz, -dx)
        awn.append({'blockId': e['blockId'], 'edgeIndex': e['edgeIndex'], 'street': e['street'],
                    'edge': e['edge'], 'dir': e['dir'], 'lenM': e['lenM'],
                    'midpoint': e['midpoint'], 'outward': e['outward'],
                    'rotY': rotY, 'module': f'awnings/{name}',
                    'geometry': {'builtLengthM': e['lenM'], 'projectionM': 1.2,
                                 'frontHeightM': 2.4, 'wallHeightM': 2.7215, 'slopeDeg': 15.0,
                                 'scallopWidthM': 0.5, 'bracketSpacingM': 1.5},
                    'tris': tris, 'trisPerMetre': round(per_m, 2), 'bytes': size,
                    'budgetOk': ok, 'sha256': sha256(path)})
        print(f"[awning] {name}: L={e['lenM']} tris={tris} per_m={per_m:.1f} ok={ok}")
        if not ok:
            sys.exit(f'BUDGET FAIL {name}')

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
                'position': b['position'], 'rotY': b['rotY'], 'height': b['height'],
                'cluster': b['cluster'],
                'collision': {'size': [1.6, 0.45], 'height': 0.5}} for b in site['benches']]
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
        'stalls': stalls, 'benches': benches,
    }
    with open(os.path.join(OUT, 'placements.json'), 'w', encoding='utf-8') as f:
        json.dump(placements, f, ensure_ascii=False, indent=1)
    awp = {'packageId': site['packageId'], 'generatedBy': 'build_bazaar_stalls.py',
           'module': 'awning strip (parametric, one GLB per edge)',
           'design': {'projectionM': 1.2, 'frontHeightM': 2.4, 'wallHeightM': 2.7215,
                      'slopeDeg': 15.0, 'scallopWidthM': 0.5, 'brackets': '2 per 3m (spacing 1.5m, ends included)',
                      'canvasAlternation': 'wine/indigo/cream round-robin by edge order',
                      'collision': 'unreachable (low edge 2.4m) — no collision box'},
           'counts': {'edges': len(awn), 'skipped': [e for e in [] ]},
           'edges': awn}
    with open(os.path.join(OUT, 'awning-placements.json'), 'w', encoding='utf-8') as f:
        json.dump(awp, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('[kit] placements.json + awning-placements.json + manifest.json written')

build_all()
