"""Export handheld prop GLBs (LOD0/1/2 + sockets + extras) and per-item catalog/reimport JSONs.
Blender: blender --background --python kit/export_item.py -- --ids xiaolongbao,bean-jar
Each GLB: root node <id> (extras: class/lodDistancesMeters/massKg/designSizeMeters) with
children <id>_LOD0/1/2, socket_grip, socket_rest (+socket_grip_2 for carry) (+named extra
nodes such as 'straw' / 'lid'). bean-single exports 6 variant roots instead."""
import bpy
import bmesh
import sys
import math
import json
import argparse
from pathlib import Path
from mathutils import Matrix, Vector

KIT = Path(__file__).resolve().parent
WS = KIT.parent
sys.path.insert(0, str(KIT))
sys.path.insert(0, str(WS / 'tools'))

import geomlib as G          # noqa: E402
import matlib                # noqa: E402
import itemdef               # noqa: E402
import build_bean            # noqa: E402
import glbtools              # noqa: E402

TEXDIR = KIT / 'textures'
REG = itemdef.REG()
UP = (0, 1, 0)


def glb_to_bl(p):
    return Vector((p[0], -p[2], p[1]))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    G.M.clear()
    G.META.clear()
    bpy.context.scene.unit_settings.system = 'METRIC'


def join_objs(objs, name):
    objs = [o for o in objs if o and o.name]
    # per-object normal repair: closed meshes get a deterministic outward vote
    # (bmesh recalc heuristic fails on very thin boxes); open sheets keep winding
    for o in objs:
        if o.type != 'MESH':
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        boundary = [e for e in bm.edges if e.is_boundary or not e.is_manifold]
        if not boundary:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            # recalc's ray heuristic can still leave very thin boxes inward: vote-flip
            xs = [v.co.x for v in bm.verts]
            ys = [v.co.y for v in bm.verts]
            zs = [v.co.z for v in bm.verts]
            center = Vector((sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)))
            neg = [f for f in bm.faces
                   if f.normal.dot(f.calc_center_median() - center) < 0]
            if len(neg) * 2 > len(bm.faces):
                bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
            bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
    o.data.calc_loop_triangles()
    return o


def make_empty(name, pos=(0, 0, 0), xax=(1, 0, 0), zax=(0, 0, 1), size=.008):
    """Blender 4.5 exports empty ROTATIONS raw (no Y-up conversion) while translations are
    converted (x,z,-y). So: location = glb_to_bl(pos); quaternion = the desired GLB-space
    frame (columns xax, +Y, zax) written directly."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = size
    e.location = glb_to_bl(pos)
    if tuple(xax) == (1, 0, 0) and tuple(zax) == (0, 0, 1):
        e.rotation_mode = 'QUATERNION'   # identity frame
    else:
        m = Matrix(((xax[0], 0, zax[0], 0), (xax[1], 1, zax[1], 0), (xax[2], 0, zax[2], 0), (0, 0, 0, 1)))
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = m.to_quaternion()
    bpy.context.collection.objects.link(e)
    return e


def set_root_extras(root, ent):
    root['class'] = ent['cls']
    root['lodDistancesMeters'] = [0.0, 1.5, 6.0]
    root['massKg'] = ent['mass']
    root['designSizeMeters'] = ent['size']


def make_sockets(root, ent):
    socks = []
    gx, gz = ent['grip'][1], ent['grip'][2]
    socks.append(make_empty('socket_grip', ent['grip'][0], gx, gz))
    socks.append(make_empty('socket_rest', (0, 0, 0), (1, 0, 0), (0, 0, 1)))
    if ent['grip2']:
        socks.append(make_empty('socket_grip_2', ent['grip2'][0], ent['grip2'][1], ent['grip2'][2]))
    return socks


def attach(children, root):
    for c in children:
        c.parent = root
        c.matrix_parent_inverse = Matrix.Identity(4)


def build_bean_single():
    """6 variant roots, each with 3 LOD meshes + sockets."""
    roots = []
    for v in range(6):
        rid = 'wuxiangdou-bean-v%d' % (v + 1)
        objs = [join_objs([build_bean.build_bean_object('b%d-l%d' % (v, l), l, v)], '%s_LOD%d' % (rid, l))
                for l in range(3)]
        root = make_empty(rid, size=.006)
        root['class'] = 'pinch'
        root['lodDistancesMeters'] = [0.0, 1.5, 6.0]
        root['massKg'] = .002
        root['designSizeMeters'] = [.022, .009, .015]
        sfx = '' if v == 0 else '_v%d' % (v + 1)
        socks = [make_empty('socket_grip' + sfx, (.011, .0045, 0), (1, 0, 0), (0, 0, 1), .004),
                 make_empty('socket_rest' + sfx, (0, 0, 0), (1, 0, 0), (0, 0, 1), .004)]
        attach(objs + socks, root)
        roots.append(root)
    return roots


def build_bean_set(id_):
    ent = REG[id_]
    lod_objs = {0: [], 1: [], 2: []}
    info = {}
    if id_ == 'bean-dish':
        pl, n = build_bean.place_dish()
        info = {'expected': 45, 'got': n, 'placement': pl.pos}
        vessel_b = build_bean.build_dish_vessel()
        beans = [build_bean.bean_instance('db-%d' % i, (10, 6), i % 6, p, o)
                 for i, (p, o) in enumerate(zip(pl.pos, pl.orient))]
        lod_objs[0] = [vessel_b] + beans
        lod_objs[1] = [build_bean.build_dish_vessel(1)] + build_bean.bean_mass_lathe(1, for_dish=True)
        lod_objs[2] = [build_bean.build_dish_vessel(2)] + build_bean.bean_mass_lathe(2, for_dish=True)
    elif id_ == 'bean-packet-open':
        pl, n = build_bean.place_packet()
        info = {'expected': 30, 'got': n, 'placement': pl.pos}
        for lod in range(3):
            pkt = build_bean.build_packet_torn(lod)
            if lod == 0:
                beans = [build_bean.bean_instance('bp-%d' % i, (8, 5), (i + 3) % 6, p, o)
                         for i, (p, o) in enumerate(zip(pl.pos, pl.orient))]
                lod_objs[0] = pkt + beans
            else:
                lod_objs[lod] = pkt
    elif id_ == 'bean-jar':
        pl, n = build_bean.place_jar()
        info = {'expected': 260, 'got': n, 'placement': pl.pos}
        for lod in range(3):
            ves = build_bean.build_jar_vessel(lod)
            if lod == 0:
                beans = [build_bean.bean_instance('bj-%d' % i, (6, 4), (i + 1) % 6, p, o, matkey='beanskin-jar')
                         for i, (p, o) in enumerate(zip(pl.pos, pl.orient))]
                lod_objs[0] = ves + beans
            else:
                lod_objs[lod] = ves + build_bean.bean_mass_lathe(lod)
    return lod_objs, info


def export_one(id_, props_dir, cat_dir, reimp_dir):
    ent = REG[id_]
    clear_scene()
    matlib.setup(G, TEXDIR)
    glb_path = props_dir / (id_ + '.glb')

    if id_ == 'bean-single':
        roots = build_bean_single()
        bpy.ops.object.select_all(action='DESELECT')
        for r in roots:
            select_tree(r)
        bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', export_yup=True,
                                  export_apply=True, use_selection=True, export_animations=False,
                                  export_extras=True, export_tangents=True,
                                  export_image_format='AUTO', export_cameras=False, export_lights=False)
        write_catalog_and_reimport(id_, ent, glb_path, cat_dir, reimp_dir, props_dir, {})
        return

    lod_objs, bean_info = ({}, {})
    if id_ in itemdef.BEAN_IDS:
        lod_objs, bean_info = build_bean_set(id_)
    else:
        for lod in range(3):
            lod_objs[lod] = list(ent['build'](lod))

    nodes = []
    for lod in range(3):
        nodes.append(join_objs(lod_objs[lod], '%s_LOD%d' % (id_, lod)))
    for name, fn in ent['extra_nodes'].items():
        nodes.append(join_objs(fn(0), name))

    root = make_empty(id_, size=.01)
    set_root_extras(root, ent)
    socks = make_sockets(root, ent)
    attach(nodes + socks, root)

    bpy.ops.object.select_all(action='DESELECT')
    select_tree(root)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', export_yup=True,
                              export_apply=True, use_selection=True, export_animations=False,
                              export_extras=True, export_tangents=ent['tangents'],
                              export_image_format='AUTO', export_cameras=False, export_lights=False)
    write_catalog_and_reimport(id_, ent, glb_path, cat_dir, reimp_dir, props_dir, bean_info)


def select_tree(root):
    root.select_set(True)
    for c in root.children:
        select_tree(c)


def write_catalog_and_reimport(id_, ent, glb_path, cat_dir, reimp_dir, props_dir, bean_info):
    parsed = glbtools.parse(glb_path)
    g = parsed['json']
    flat = glbtools.flat_nodes(g)
    by_name = {r['name']: r for r in flat}
    tri = {}
    if id_ == 'bean-single':
        # R1 #8: 6 variant roots - count each root's LODn and sum (was 0/0/0 by name lookup)
        for lod in range(3):
            tri['lod%d' % lod] = 0
            for v in range(1, 7):
                nm = 'wuxiangdou-bean-v%d_LOD%d' % (v, lod)
                if nm in by_name and 'mesh' in by_name[nm]['node']:
                    tri['lod%d' % lod] += glbtools.mesh_tris(g, by_name[nm]['node']['mesh'])
    else:
        for lod in range(3):
            nm = '%s_LOD%d' % (id_, lod)
            tri['lod%d' % lod] = glbtools.mesh_tris(g, by_name[nm]['node']['mesh']) if nm in by_name and 'mesh' in by_name[nm]['node'] else 0
    extra_tri = {r['name']: glbtools.mesh_tris(g, r['node']['mesh']) for r in flat
                 if 'mesh' in r['node'] and r['name'] not in ('%s_LOD0' % id_, '%s_LOD1' % id_, '%s_LOD2' % id_)}
    b = glbtools.node_bounds(g, parsed['bin'], flat)
    imgs = glbtools.images_info(g)
    cat = {
        'id': id_, 'zh': ent['zh'], 'class': ent['cls'], 'massKg': ent['mass'],
        'designSizeMeters': ent['size'], 'lodDistancesMeters': [0.0, 1.5, 6.0],
        'triangles': tri, 'extraNodeTriangles': extra_tri,
        'glbBytes': parsed['bytes'], 'sha256': parsed['sha256'],
        'textureBytes': sum(i['bytes'] for i in imgs), 'images': imgs,
        'bounds': b, 'materials': sorted({r['name'] for r in flat}),
        'tangents': ent['tangents'], 'note': ent.get('note', ''),
    }
    if bean_info:
        cat['beanSet'] = {k: v for k, v in bean_info.items() if k != 'placement'}
        cat['beanSet']['positions'] = [[round(c, 5) for c in p] for p in bean_info.get('placement', [])]
    (cat_dir / (id_ + '.json')).write_text(json.dumps(cat, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # ---- reimport verification (fresh scene) --------------------------------
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    issues = []
    roots = [o for o in bpy.context.scene.objects if o.parent is None]
    if id_ == 'bean-single':
        names = {'wuxiangdou-bean-v%d' % (v + 1) for v in range(6)}
        if {r.name for r in roots} != names:
            issues.append('bean-single roots %s' % [r.name for r in roots])
        check_roots = roots
    else:
        if len(roots) != 1 or roots[0].name != id_:
            issues.append('root node is %s' % [o.name for o in roots])
        check_roots = roots
    for r in check_roots:
        kids = {c.name for c in r.children}
        if id_ == 'bean-single':
            okkids = (any(k.startswith(r.name + '_LOD') for k in kids)
                      and any(k.startswith('socket_grip') for k in kids)
                      and any(k.startswith('socket_rest') for k in kids))
            if not okkids:
                issues.append('%s missing LOD/sockets, kids %s' % (r.name, sorted(kids)))
            continue
        need = {'%s_LOD0' % r.name, '%s_LOD1' % r.name, '%s_LOD2' % r.name, 'socket_grip', 'socket_rest'}
        if ent['grip2']:
            need.add('socket_grip_2')
        for n in ent['extra_nodes']:
            need.add(n)
        missing = need - kids
        if missing:
            issues.append('%s missing children %s' % (r.name, sorted(missing)))
    # socket translations (blender coords of the glTF translation)
    def find(name):
        return bpy.context.scene.objects.get(name)
    socks_expected = {'socket_rest': (0, 0, 0), 'socket_grip': ent['grip'][0]}
    if ent['grip2']:
        socks_expected['socket_grip_2'] = ent['grip2'][0]
    if id_ == 'bean-single':
        for v in range(2, 7):
            socks_expected['socket_grip_v%d' % v] = ent['grip'][0]
            socks_expected['socket_rest_v%d' % v] = (0, 0, 0)
    for sname, pos in socks_expected.items():
        o = find(sname)
        if o is None:
            issues.append('socket %s absent' % sname)
            continue
        exp = glb_to_bl(pos)
        if (Vector(o.location) - exp).length > 1e-4:
            issues.append('socket %s at %s expect %s' % (sname, tuple(o.location), tuple(exp)))
    # materials / images
    img_report = []
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        principled = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if principled is None:
            issues.append('material %s without principled' % m.name)
            continue
        for n in nt.nodes:
            if n.type == 'TEX_IMAGE':
                if n.image is None:
                    issues.append('material %s: image node without image' % m.name)
                    continue
                linked = any(lk.from_node == n for lk in nt.links)
                img_report.append({'material': m.name, 'image': n.image.name,
                                   'colorspace': n.image.colorspace_settings.name, 'linked': linked})
                if not linked:
                    issues.append('material %s: image %s not connected' % (m.name, n.image.name))
    (reimp_dir / (id_ + '.json')).write_text(json.dumps(
        {'id': id_, 'ok': not issues, 'issues': issues, 'images': img_report},
        ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('REIMPORT_CHECK', id_, 'OK' if not issues else 'ISSUES: %s' % issues)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ids', required=True)
    ap.add_argument('--out', default=None,
                    help='output props dir (default WS/props; R1 writes to the package artifacts dir)')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    props_dir = Path(args.out) if args.out else WS / 'props'
    cat_dir = props_dir / 'catalog'
    reimp_dir = props_dir / 'reimport'
    props_dir.mkdir(parents=True, exist_ok=True)
    for d in (cat_dir, reimp_dir):
        d.mkdir(exist_ok=True)
    failed = []
    for id_ in [s.strip() for s in args.ids.split(',') if s.strip()]:
        try:
            export_one(id_, props_dir, cat_dir, reimp_dir)
            print('EXPORT_OK', id_)
        except Exception as exc:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            failed.append(id_)
            print('EXPORT_FAIL', id_, repr(exc))
    if failed:
        print('EXPORT_FAILED_ITEMS', ','.join(failed))
        sys.exit(2)
    print('ALL_EXPORTED', args.ids)


main()
