"""Minimal visible paving at measured route interfaces; shares real GLB physics.
Source gap local z -3.3..-0.1; adjacent y=0 rear and y=0.01 front.
The existing gate, walls, anchors and source modules are unchanged.
"""
import bpy, json, math, os, sys, hashlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID, NAME = 'shanmen-passage-floor', 'temple-ground__paving-frontage-passage'

def add_passage(layout):
    if bpy.data.objects.get(NAME):
        raise RuntimeError('shanmen passage already present')
    gate = next(o for o in layout['objects'] if o['id'] == 'temple-shanmen')
    x, z = gate['geometry']['position']; yaw = gate['geometry']['rotY']
    if abs(x + 74.317) > 1e-9 or abs(z - 9.657) > 1e-9 or abs(yaw - 0.16703) > 1e-9:
        raise RuntimeError('frozen gate anchor changed; passage requires remeasurement')
    donor = next((o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('temple-ground__paving-frontage') and o.data.materials), None)
    if donor is None:
        raise RuntimeError('adjacent temple paving material unavailable')
    ct, st = math.cos(yaw), math.sin(yaw)
    local = [(-1.5, -3.5), (1.5, -3.5), (1.5, 0.1), (-1.5, 0.1)]
    verts = [(x + ct*a + st*b, -(z - st*a + ct*b), 0 if b < 0 else 0.01) for a,b in local]
    mesh = bpy.data.meshes.new(NAME); mesh.from_pydata(verts, [], [(0,3,2,1)]); mesh.update()
    obj = bpy.data.objects.new(NAME, mesh)
    collection = bpy.data.collections.get('SITE-temple')
    if collection is None:
        collection = bpy.data.collections.new('SITE-temple'); bpy.context.scene.collection.children.link(collection)
    collection.objects.link(obj); mesh.materials.append(donor.data.materials[0])
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        uv.data[loop.index].uv = local[loop.vertex_index]
    obj['id'], obj['zone'], obj['kind'], obj['lod'] = ID, 'temple', 'paving', 'L1'
    obj['module'] = 'shanmen-passage'
    obj['inference'] = 'lead-approved measured existing gate-floor gap; no historical survey claim'
    return obj

def add_east_apron(layout):
    name = 'pond|east-landing-access-apron|paving|L1'
    if bpy.data.objects.get(name):
        raise RuntimeError('east access apron already present')
    g = next(o for o in layout['objects'] if o['id'] == 'jiuqu-bridge-step-e')['geometry']
    x, z = g['position']; yaw = g['rotY']
    if abs(x + 134.1703623677984) > 1e-9 or abs(z + 165.27875968109072) > 1e-9 or abs(yaw - 0.1888350771455904) > 1e-9:
        raise RuntimeError('frozen east stair anchor changed; apron requires remeasurement')
    donor = next((o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('pond|jiuqu-bridge-step-e|steps|L1') and o.data.materials), None)
    if donor is None:
        raise RuntimeError('adjacent east stair stone material unavailable')
    ct, st = math.cos(yaw), math.sin(yaw)
    local = [(-2.0,-1.30),(-.9,-1.30),(-.9,-.65),(-2.0,-.65)]
    verts = [(x + st*d + ct*a, -(z + ct*d - st*a), .02) for a,d in local]
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], [(0,3,2,1)]); mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection = bpy.data.collections.get('SITE-pond')
    if collection is None:
        collection = bpy.data.collections.new('SITE-pond'); bpy.context.scene.collection.children.link(collection)
    collection.objects.link(obj); mesh.materials.append(donor.data.materials[0])
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        v = verts[loop.vertex_index]; uv.data[loop.index].uv = (v[0], -v[1])
    obj['id'], obj['zone'], obj['kind'], obj['lod'] = 'east-landing-access-apron', 'pond', 'paving', 'L1'
    obj['module'] = 'east-landing-access-apron'
    obj['slot'] = 'paving-blue-stone'  # canonical export rebinds the same adjacent stair material
    obj['inference'] = 'lead-approved .715m2 visible dry road-to-lowest-tread interface; existing bridge and stairs unchanged'
    # wave10-pondqa（主控 2026-09-27）：接驳垫面片离外围地面 -0.40 悬空 0.42 m。上面这块步行面片（顶面、名字、材质）原样保留，
    # 另加一件实心基座：四周立面 + 底面，从面片四边落到 -0.40（同桥端台阶的做法）。基座 kind = apronBase，不是地面节点。
    if os.environ.get('POND_QA', '1') != '0':
        bname = 'pond|east-landing-access-apron|apronBase|L1'
        GROUND_Y = -0.4
        top = [tuple(v) for v in verts]                       # Blender 系 (x, -z_map, y)
        bot = [(v[0], v[1], GROUND_Y) for v in verts]
        bverts = top + bot
        # 顶面环 top 的绕序与面片同（面 (0,3,2,1) 朝上）；侧面沿 0→3→2→1 走外侧
        order = [0, 3, 2, 1]
        faces = []
        for k in range(4):
            a, b = order[k], order[(k + 1) % 4]
            faces.append((a, 4 + a, 4 + b, b))
        faces.append((4 + 1, 4 + 2, 4 + 3, 4 + 0))           # 底面朝下
        bm = bpy.data.meshes.new(bname); bm.from_pydata(bverts, [], faces); bm.update()
        # 侧面朝外校正：面法线与「面中心 - 形心」同向
        from mathutils import Vector
        c = sum((Vector(v) for v in bverts), Vector()) / len(bverts)
        for poly in bm.polygons:
            if abs(poly.normal.z) < 0.5 and poly.normal.dot(poly.center - c) < 0:
                poly.flip()
        bm.update()
        bobj = bpy.data.objects.new(bname, bm)
        collection.objects.link(bobj); bm.materials.append(donor.data.materials[0])
        buv = bm.uv_layers.new(name='UVMap')
        for poly in bm.polygons:
            for li in poly.loop_indices:
                v = bverts[bm.loops[li].vertex_index]
                buv.data[li].uv = (v[0] + v[1], v[2]) if abs(poly.normal.z) < 0.5 else (v[0], -v[1])
        bobj['id'], bobj['zone'], bobj['kind'], bobj['lod'] = 'east-landing-access-apron', 'pond', 'apronBase', 'L1'
        bobj['module'] = 'east-landing-access-apron'
        bobj['inference'] = 'wave10-pondqa: solid base under the G2 apron down to ground -0.40; walk surface unchanged'
    return obj

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if len(args)!=2 or args[0] not in ('--standalone','--east-apron'):
        raise SystemExit('usage: blender -b -t 4 -P scripts/route-interface-paving.py -- --standalone|--east-apron OUTPUT_DIR')
    out = os.path.abspath(args[1]); bpy.ops.wm.read_factory_settings(use_empty=True)
    east = args[0] == '--east-apron'
    bpy.ops.import_scene.gltf(filepath=os.path.join(out, 'zone-pond.glb' if east else 'zone-temple-1.glb'))
    layout = json.load(open(os.path.join(out,'layout.json'),encoding='utf-8'))
    obj = add_east_apron(layout) if east else add_passage(layout)
    for other in bpy.context.view_layer.objects: other.select_set(False)
    obj.select_set(True); file = 'zone-pond-2.glb' if east else 'zone-temple-4.glb'
    bpy.ops.export_scene.gltf(filepath=os.path.join(out,file),export_format='GLB',export_extras=True,export_yup=True,use_selection=True)
    raw = open(os.path.join(out,file),'rb').read(); points = [list(v.co) for v in obj.data.vertices]
    bounds = [[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]
    gltf_bounds = [[bounds[0][0],bounds[0][2],-bounds[1][1]],[bounds[1][0],bounds[1][2],-bounds[0][1]]]
    mp = os.path.join(out,'zones-manifest.json'); manifest = json.load(open(mp,encoding='utf-8'))
    zone, part = ('pond',2) if east else ('temple',4)
    if any(e['id']==zone and e.get('part')==part for e in manifest['zones']): raise RuntimeError('repair part already present; use fresh copy')
    manifest['zones'].append({'id':zone,'part':part,'file':file,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'collections':['SITE-'+zone],'objects':1,'bounds':gltf_bounds,'withinCap':len(raw)<=manifest['capPerZoneBytes'],'role':'east-landing-access-apron' if east else 'shanmen-passage','note':'visible existing route interface paving; production GLB ground'})
    manifest['totalBytes'] = sum(e.get('bytes',0) for e in manifest['zones'])
    with open(mp,'w',encoding='utf-8') as f: json.dump(manifest,f,ensure_ascii=False,indent=1); f.write('\n')
    print('passage only',len(raw),'bytes',gltf_bounds)
