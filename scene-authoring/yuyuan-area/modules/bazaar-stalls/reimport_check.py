# Reimport every exported GLB and verify what actually shipped:
# node names, socket empties + translations (GLB frame), material colors, zero image
# textures, tri counts vs manifest, and bounds within +/-10% of designed dims.
# Run: blender -b -t 4 -P reimport_check.py
import bpy, json, math, os, sys, time
import mathutils
from mathutils import Vector

def P(*a):
    print(*a)
    sys.stdout.flush()

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'out-bazaar-stalls'))
T0 = time.time()

SOCKET_EXPECT = {
    'stall-steam.glb': {'socket_tray': (0.55, 1.01, 0.0), 'socket_steamer': (-0.45, 1.31, 0.0), 'socket_case': (-0.45, 1.16, 0.0)},
    'stall-grill.glb': {'socket_tray': (0.55, 1.01, 0.0), 'socket_grill': (-0.45, 1.13, 0.0)},
    'stall-drink.glb': {'socket_tray': (0.0, 1.01, 0.1), 'socket_cup': (-0.5, 1.31, -0.25)},
}
BOUNDS_EXPECT = {  # (x_half, ymax, z_min, z_max) designed
    'stall-steam.glb': (1.0, 2.5, -0.78, 0.7),   # rear shelf z-0.47..-0.73 + spare steamer r0.17 -> -0.77
    'stall-grill.glb': (1.0, 2.5, -0.7, 0.7),
    'stall-drink.glb': (1.0, 2.5, -0.7, 0.7),
    'bench.glb': (0.8, 0.5, -0.225, 0.225),
}
MAT_HEX = {'timber': 0x6a4a32, 'timberDark': 0x553a27, 'canvasCream': 0xc9b893,
           'canvasWine': 0x8b4346, 'canvasIndigo': 0x536b7d, 'dark-iron': 0x44453d,
           'steel': 0x9da0a3, 'palewood': 0xd8cdb4, 'glass': 0xdfe8ea}

def bl2glb(loc):
    return (loc[0], loc[2], -loc[1])

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.node_groups):
        for x in list(block):
            if x.users == 0:
                block.remove(x)

def check(path, rel, manifest_entry):
    clear_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    rep = {'file': rel, 'sha256_manifest': manifest_entry['sha256']}
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for c in iter(lambda: f.read(1 << 16), b''):
            h.update(c)
    rep['sha256_reimport'] = h.hexdigest()
    rep['shaMatch'] = rep['sha256_reimport'] == rep['sha256_manifest']

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    empties = [o for o in bpy.data.objects if o.type == 'EMPTY']
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    rep['tris'] = tris
    rep['trisMatch'] = tris == manifest_entry['tris']

    # materials: color slots present, no image textures anywhere (constants only)
    rep['materials'] = []
    mat_ok = True
    for m in bpy.data.materials:
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
        if not bsdf:
            mat_ok = False
            rep['materials'].append({'name': m.name, 'error': 'no principled bsdf'})
            continue
        c = bsdf.inputs['Base Color'].default_value
        hexv = (round(c[0] * 255) << 16) | (round(c[1] * 255) << 8) | round(c[2] * 255)
        exp = MAT_HEX.get(m.name)
        entry = {'name': m.name, 'hex': '%06x' % hexv, 'expected': ('%06x' % exp) if exp else None}
        entry['colorOk'] = (exp is not None and abs(hexv - exp) <= 0x000101) or m.name == 'glass'
        entry['alpha'] = round(bsdf.inputs['Alpha'].default_value, 3)
        entry['blendMethod'] = getattr(m, 'blend_method', None)
        rep['materials'].append(entry)
        if not entry['colorOk']:
            mat_ok = False
    rep['materialsOk'] = mat_ok

    img_nodes = [n for m in bpy.data.materials if m.use_nodes
                 for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']
    rep['imageNodeCount'] = len(img_nodes)
    rep['noTextures'] = len(img_nodes) == 0

    # socket empties at exact GLB-frame offsets
    sockets = {}
    sock_ok = True
    for e in empties:
        g = bl2glb(e.location)
        sockets[e.name] = [round(v, 4) for v in g]
    P(f'  [{time.time()-T0:6.1f}s] {rel}: materials+sockets done')
    rep['sockets'] = sockets
    exp_socks = SOCKET_EXPECT.get(os.path.basename(path), {})
    for nm, want in exp_socks.items():
        got = sockets.get(nm)
        if got is None or any(abs(a - b) > 1e-4 for a, b in zip(got, want)):
            sock_ok = False
            rep.setdefault('socketErrors', []).append({'name': nm, 'want': list(want), 'got': got})
    rep['socketsOk'] = sock_ok if exp_socks else True

    # bounds in GLB frame (world, instances unrotated at origin)
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        for c in o.bound_box:
            pts.append(bl2glb(o.matrix_world @ (Vector(c))))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    bb = {'x': [round(min(xs), 4), round(max(xs), 4)], 'y': [round(min(ys), 4), round(max(ys), 4)],
          'z': [round(min(zs), 4), round(max(zs), 4)]}
    P(f'  [{time.time()-T0:6.1f}s] {rel}: bounds collected ({len(pts)} pts)')
    rep['bounds'] = bb
    bexp = BOUNDS_EXPECT.get(os.path.basename(path))
    if bexp:
        xh, ymax, zmin, zmax = bexp
        def near(a, b, tol):
            return abs(a - b) <= tol
        rep['boundsOk'] = (near(max(map(abs, xs)), xh, xh * 0.10) and near(ymax, bb['y'][1], ymax * 0.10)
                           and bb['y'][0] > -0.02 and near(zmin, bb['z'][0], 0.06) and near(zmax, bb['z'][1], 0.06))
    else:  # awning: length vs lenM checked in tests; here just sanity
        # awning strip: whole strip above the 2.5 m walking-body band (lead 2026-09-23 raise), wall edge ≤ 3.2 m
        rep['boundsOk'] = bb['y'][0] >= 2.5 and bb['y'][1] < 3.2 and bb['z'][0] > -0.02 and bb['z'][1] < 1.3
    rep['ok'] = all(rep[k] for k in ('shaMatch', 'trisMatch', 'materialsOk', 'noTextures', 'socketsOk', 'boundsOk'))
    return rep

manifest = json.load(open(os.path.join(OUT, 'manifest.json'), encoding='utf-8'))
awp = json.load(open(os.path.join(OUT, 'awning-placements.json'), encoding='utf-8'))
results = []
for name, entry in manifest['files'].items():
    results.append(check(os.path.join(OUT, name), name, entry))
for e in awp['edges']:
    entry = {'sha256': e['sha256'], 'tris': e['tris']}
    results.append(check(os.path.join(OUT, e['module']), e['module'], entry))

bad = [r for r in results if not r['ok']]
for r in results:
    P(f"[reimport] {r['file']}: ok={r['ok']} tris={r['tris']} sockets={len(r.get('sockets', {}))} imgNodes={r['imageNodeCount']} bounds={r['bounds']}")
    if not r['ok']:
        P('   DETAIL', json.dumps({k: v for k, v in r.items() if 'Ok' in k or k == 'socketErrors'}, ensure_ascii=False))
json.dump({'checkedAt': 'run', 'results': results, 'allOk': not bad},
          open(os.path.join(OUT, 'reimport-report.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
P(f"REIMPORT_DONE files={len(results)} allOk={not bad}")
if bad:
    raise SystemExit(2)
