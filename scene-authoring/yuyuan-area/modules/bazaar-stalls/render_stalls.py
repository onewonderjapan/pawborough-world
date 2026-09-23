# Render kit review shots: 3 stall types + bench + one awning strip + a mock row
# of cluster 1 (6 stalls at their real layout positions/rotY on a flat plane).
# Cycles CPU only. Blank-frame guard: luminance std < 2/255 or dominant colour
# > 95% = blank = fail (non-zero exit).
# Run: blender -b -t 4 -P render_stalls.py
import bpy, json, math, os, sys, time
import mathutils
from mathutils import Vector

def P(*a):
    print(*a)
    sys.stdout.flush()

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(AREA, 'out-bazaar-stalls')
RDIR = os.path.join(OUT, 'renders')
os.makedirs(RDIR, exist_ok=True)
SITE = '/home/baibai/outbox/pawborough-w1-bazaar-stalls-20260922/artifacts/bazaar-stalls/site-inputs.json'

T0 = time.time()

def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return new

def setup_world(sun_energy=3.0, sun_angle=(math.radians(50), math.radians(35))):
    w = bpy.data.worlds.new('W')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.75, 0.78, 0.82, 1.0)
    bg.inputs[1].default_value = 0.55
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = sun_energy
    sun.angle = math.radians(2)
    so = bpy.data.objects.new('Sun', sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = (sun_angle[0], 0, sun_angle[1])
    g = bpy.data.lights.new('Fill', 'AREA')
    g.energy = 300
    g.size = 6
    go = bpy.data.objects.new('Fill', g)
    bpy.context.collection.objects.link(go)
    go.location = (-3, -4, 4)
    go.rotation_euler = (math.radians(55), 0, math.radians(-40))

def ground(size=40):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    g = bpy.context.active_object
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.62, 0.60, 0.56, 1)
    b.inputs['Roughness'].default_value = 0.95
    g.data.materials.append(m)
    return g

def camera(target, dist, azim_deg, elev_deg, lens=50):
    cd = bpy.data.cameras.new('Cam')
    cd.lens = lens
    cam = bpy.data.objects.new('Cam', cd)
    bpy.context.collection.objects.link(cam)
    a, e = math.radians(azim_deg), math.radians(elev_deg)
    off = Vector((dist * math.cos(e) * math.cos(a), dist * math.cos(e) * math.sin(a), dist * math.sin(e)))
    cam.location = Vector(target) + off
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam

def render(path, res=(960, 720), samples=48):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    return path

def blank_guard(path):
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    n = w * h
    px = np.empty(n * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape(n, 4)
    lum = 0.2126 * arr[:, 0] + 0.7152 * arr[:, 1] + 0.0722 * arr[:, 2]
    std = float(lum.std())
    q = (arr[:, :3] * 31).astype(np.int32)
    key = (q[:, 0] << 10) | (q[:, 1] << 5) | q[:, 2]
    _, counts = np.unique(key, return_counts=True)
    dom = float(counts.max()) / n
    bpy.data.images.remove(img)
    blank = std < (2.0 / 255.0) or dom > 0.95
    P(f"[guard] {os.path.basename(path)}: lumStd={std:.5f} domShare={dom:.3f} blank={blank}")
    return {'file': os.path.basename(path), 'lumStd': round(std, 5), 'domShare': round(dom, 3), 'blank': bool(blank)}

def frame_bounds(objs):
    pts = []
    deps = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ mathutils.Vector(c))
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))

def shot(name, glb, azim, elev, target_z=0.9, dist=None, res=(960, 720)):
    clear()
    setup_world()
    ground()
    objs = import_glb(glb)
    x0, x1, y0, y1, z0, z1 = frame_bounds(objs)
    ctr = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2 + target_z * 0)
    size = max(x1 - x0, y1 - y0, z1 - z0)
    d = dist or (size * 1.9 + 1.2)
    camera(ctr, d, azim, elev)
    p = render(os.path.join(RDIR, name), res)
    return blank_guard(p)

# ------------------------------------------------ singles
guard = {}
guard['steam'] = shot('stall-steam.png', os.path.join(OUT, 'stall-steam.glb'), -70, 15)
guard['grill'] = shot('stall-grill.png', os.path.join(OUT, 'stall-grill.glb'), -70, 15)
guard['drink'] = shot('stall-drink.png', os.path.join(OUT, 'stall-drink.glb'), -70, 15)
guard['bench'] = shot('bench.png', os.path.join(OUT, 'bench.glb'), -60, 20, dist=4.2)
# representative awning strip: 24.5 m (bld-389702030-1)
guard['awning'] = shot('awning-strip.png', os.path.join(OUT, 'awnings', 'awning-bld-389702030-1.glb'),
                       -60, 20, target_z=2.5, dist=30, res=(1280, 540))

# ------------------------------------------------ mock row: cluster 1
site = json.load(open(SITE, encoding='utf-8'))
pl = json.load(open(os.path.join(OUT, 'placements.json'), encoding='utf-8'))
cl = [s for s in site['stalls'] if s['cluster'] == 1]
bench1 = [b for b in site['benches'] if b['cluster'] == 1]
cx = sum(s['position'][0] for s in cl) / len(cl)
cz = sum(s['position'][1] for s in cl) / len(cl)

clear()
setup_world()
ground(size=30)
socket_checks = []
for s in cl:
    mdl = os.path.join(OUT, f"stall-{s['type']}.glb")
    objs = import_glb(mdl)
    roots = [o for o in objs if o.parent is None]
    anchor = bpy.data.objects.new(f"anchor_{s['id']}", None)
    bpy.context.collection.objects.link(anchor)
    anchor.rotation_mode = 'XYZ'   # glTF importer defaults to QUATERNION; euler writes would be ignored
    anchor.rotation_euler = (0, 0, s['rotY'])
    anchor.location = (s['position'][0] - cx, -(s['position'][1] - cz), 0)
    for r in roots:
        r.parent = anchor
    # socket world-position verification (>=2 keypoints per yaw!=0 instance, obbToWorld semantics)
    if s['id'] in ('stall-1', 'stall-2'):
        bpy.context.view_layer.update()
        for nm, want in (('socket_tray', (0.55, 1.01, 0.0)),
                         ('socket_steamer', (-0.45, 1.31, 0.0)) if s['type'] == 'steam' else ('socket_grill', (-0.45, 1.13, 0.0))):
            e = next((o for o in objs if o.name == nm or o.name.split('.')[0] == nm), None)
            th = s['rotY']
            gx = s['position'][0] + want[0] * math.cos(th) + want[2] * math.sin(th)
            gz = s['position'][1] - want[0] * math.sin(th) + want[2] * math.cos(th)
            gy = want[1]
            w = e.matrix_world.translation
            got = (w.x + cx, w.z, -w.y + cz)  # blender -> GLB world (map_x, h, map_z), undo row offset
            err = max(abs(got[0] - gx), abs(got[1] - gy), abs(got[2] - gz))
            socket_checks.append({'stall': s['id'], 'socket': nm, 'want': [round(gx, 4), round(gy, 4), round(gz, 4)],
                                  'got': [round(got[0], 4), round(got[1], 4), round(got[2], 4)], 'errM': round(err, 5), 'ok': err < 0.01})
for b in bench1:
    objs = import_glb(os.path.join(OUT, 'bench.glb'))
    roots = [o for o in objs if o.parent is None]
    anchor = bpy.data.objects.new(f"anchor_{b['id']}", None)
    bpy.context.collection.objects.link(anchor)
    anchor.rotation_mode = 'XYZ'
    anchor.rotation_euler = (0, 0, b['rotY'])
    anchor.location = (b['position'][0] - cx, -(b['position'][1] - cz), 0)
    for r in roots:
        r.parent = anchor

xs = [s['position'][0] - cx for s in cl]; zs = [s['position'][1] - cz for s in cl]
mid = (sum(xs) / len(xs), -sum(zs) / len(zs))
span = max(max(xs) - min(xs), max(zs) - min(zs))
camera((mid[0], mid[1], 1.4), span * 1.05 + 6, 160, 32, lens=40)
mock = render(os.path.join(RDIR, 'mock-row-cluster1.png'), res=(1600, 640), samples=48)
guard['mockrow'] = blank_guard(mock)

P(f"MOCKROW_SOCKET_CHECK {json.dumps(socket_checks)}")
ok_socks = all(c['ok'] for c in socket_checks) and len(socket_checks) == 4
report = {'guard': guard, 'socketChecks': socket_checks, 'socketsOk': ok_socks,
          'mockRowStalls': [s['id'] for s in cl], 'mockRowBench': [b['id'] for b in bench1],
          'elapsedS': round(time.time() - T0, 1)}
json.dump(report, open(os.path.join(RDIR, 'render-report.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
P(f"RENDER_DONE blank={sum(1 for g in guard.values() if g['blank'])} socketsOk={ok_socks} elapsed={report['elapsedS']}s")
if any(g['blank'] for g in guard.values()) or not ok_socks:
    raise SystemExit(3)
