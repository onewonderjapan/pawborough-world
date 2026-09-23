# Runs inside Blender:  blender -b -t 4 -P s1s2_build_trees.py -- <out-tree-kit dir>
# Builds 6 tree variant GLBs (camphor/willow/osmanthus x small/large), Y-up,
# origin at trunk base centre, crown top exactly at the variant's base height B.
# Blender is Z-up; export_yup=True maps Blender z -> glTF y.
# R1 rework (2026-09-23, sheet pawborough-w1-tree-kit-r1-20260923):
#   #1 osmanthus trunk reaches >=0.30 m into the crown (no floating crown);
#   #2 willow crown = 4 umbrella clusters (small head over wider skirt, no solid
#      core block) + strips hanging uniformly from the skirt rim down to 0.8 m,
#      solid volume <= 50 % of the crown envelope (asserted here).
import bmesh
import bpy
import json
import math
import os
import random
import sys

from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.abspath(os.path.join(MODULE, os.pardir, os.pardir, "out-tree-kit"))
TEXDIR = os.path.join(OUT, "textures")
GDIR = os.path.join(OUT, "glb")
BDIR = os.path.join(OUT, "blends")

TRI_BUDGET = 2600

IMG = {}


def load_img(fname):
    if fname not in IMG:
        im = bpy.data.images.load(os.path.join(TEXDIR, fname), check_existing=True)
        im.colorspace_settings.name = "sRGB"
        IMG[fname] = im
    return IMG[fname]


def mat_solid(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


def mat_bark(name, fname):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = load_img(fname)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m


def mat_card(name, fname):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = load_img(fname)
    tex.interpolation = "Closest"  # keep MASK edges crisp
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # alpha MASK: the exporter detects Alpha -> Math(ROUND) -> Alpha as clip, cutoff 0.5
    rnd_node = nt.nodes.new("ShaderNodeMath")
    rnd_node.operation = "ROUND"
    nt.links.new(tex.outputs["Alpha"], rnd_node.inputs[0])
    nt.links.new(rnd_node.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.9
    m.use_backface_culling = False
    return m


def make_materials():
    return {
        "bark-oxblood": mat_bark("tk-bark-oxblood", "bark-oxblood.png"),
        "bark-neutral": mat_bark("tk-bark-neutral", "bark-neutral.png"),
        "foliage-camphor-a": mat_solid("tk-foliage-camphor-a", (0.055, 0.096, 0.038)),
        "foliage-camphor-b": mat_solid("tk-foliage-camphor-b", (0.086, 0.131, 0.047)),
        "foliage-willow-tuft": mat_solid("tk-foliage-willow-tuft", (0.16, 0.24, 0.09)),
        "card-willow": mat_card("tk-card-willow", "willow_strip.png"),
        "foliage-osmanthus-a": mat_solid("tk-foliage-osmanthus-a", (0.075, 0.118, 0.045)),
        "foliage-osmanthus-b": mat_solid("tk-foliage-osmanthus-b", (0.105, 0.152, 0.058)),
        "card-broadleaf": mat_card("tk-card-broadleaf", "broadleaf_cluster.png"),
    }


def build_mesh(name, verts, faces, uv_per_vertex, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    uv = me.uv_layers.new(name="UVMap")
    for i, p in enumerate(uv_per_vertex):
        uv.data[i].uv = p
    me.materials.append(mat)
    idx = len(me.materials) - 1
    me.polygons.foreach_set("material_index", [idx] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def tube(name, pts, r0, r1, sides, mat, seed):
    """Tapered tube along a 2-3 point polyline; cylindrical UV (v tiles ~2.2 m)."""
    rnd = random.Random(seed)
    axis = [Vector(p) for p in pts]
    z = (axis[-1] - axis[0]).normalized()
    up = Vector((0, 0, 1)) if abs(z.z) < 0.9 else Vector((1, 0, 0))
    x = z.cross(up).normalized()
    y = z.cross(x).normalized()
    rings = []
    for i in range(len(axis)):
        t = i / (len(axis) - 1)
        rings.append((r0 + (r1 - r0) * t) * rnd.uniform(0.96, 1.04))
    verts, uvv = [], []
    for i, (p, r) in enumerate(zip(axis, rings)):
        vlen = sum((axis[k + 1] - axis[k]).length for k in range(i))
        for s in range(sides):
            a = 2 * math.pi * s / sides
            v = p + x * (math.cos(a) * r) + y * (math.sin(a) * r)
            if i == 0:
                v.z = p.z  # flat base ring: tree seats exactly on the ground plane
            verts.append(v)
            uvv.append((s / sides, vlen / 2.2))
    faces = []
    for i in range(len(axis) - 1):
        for s in range(sides):
            a = i * sides + s
            b = i * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    tip = len(verts)
    verts.append(axis[-1] + z * 0.012 * rings[-1] * sides / sides)  # slight boss
    uvv.append((0.5, 1.0))
    for s in range(sides):
        a = (len(axis) - 1) * sides + s
        b = (len(axis) - 1) * sides + (s + 1) % sides
        faces.append((a, b, tip))
    uv_per_vertex = [uvv[vi] for f in faces for vi in f]
    ob = build_mesh(name, verts, faces, uv_per_vertex, mat)
    ob["tk_kind"] = "tube"
    ob["tk_axis"] = [list(p) for p in axis]
    return ob


def blob(name, center, radii, subdiv, mat, seed, noise=0.12):
    """Noisy icosphere, outward normals."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        v.co *= rnd.uniform(1 - noise, 1 + noise)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.transform(Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*radii, 1.0)))
    me["tk_center"] = list(center)
    me["tk_kind"] = "blob"
    me.materials.append(mat)
    me.uv_layers.new(name="UVMap")
    ob = bpy.data.objects.new(name, me)
    ob["tk_kind"] = "blob"
    ob["tk_center"] = list(center)
    bpy.context.collection.objects.link(ob)
    return ob


def card(name, top_center, width, height, outward_az, mat, seed, bow=0.3, segs=3, uv_window=(0, 0, 1, 1)):
    """Hanging vertical card; top edge at top_center, drifts outward by `bow`, then hangs straight."""
    rnd = random.Random(seed)
    w2 = width / 2
    dirx, diry = math.cos(outward_az), math.sin(outward_az)
    side = Vector((-diry, dirx, 0))
    u0, v0, u1, v1 = uv_window
    verts, uvv = [], []
    for i in range(segs + 1):
        t = i / segs
        z = -height * t
        out = bow * min(1.0, t / 0.35) + (0.02 * math.sin(t * 9 + seed) if t > 0.35 else 0.0)
        c = Vector(top_center) + Vector((dirx * out, diry * out, z))
        jit = rnd.uniform(-0.02, 0.02)
        verts.append(c + side * w2 + Vector((0, 0, jit)))
        verts.append(c - side * w2 - Vector((0, 0, jit)))
        v = v0 + (v1 - v0) * (1 - t)
        uvv.append((u1, v))
        uvv.append((u0, v))
    faces = []
    for i in range(segs):
        a = 2 * i
        faces.append((a, a + 1, a + 3, a + 2))
    uv_per_vertex = [uvv[vi] for f in faces for vi in f]
    ob = build_mesh(name, verts, faces, uv_per_vertex, mat)
    ob["tk_kind"] = "card"
    return ob


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def mesh_volume(ob):
    """Signed volume of a closed mesh (outward normals -> positive)."""
    me = ob.data
    me.calc_loop_triangles()
    vs = me.vertices
    v = 0.0
    for t in me.loop_triangles:
        a, b, c = (vs[i].co for i in t.vertices)
        v += a.dot(b.cross(c))
    return v / 6.0


def crown_group(objs, top_target):
    """Uniformly rescale crown objects about z=0 so their max z == top_target exactly."""
    maxz = max(v.co.z for o in objs for v in o.data.vertices)
    s = top_target / maxz
    for o in objs:
        o.data.transform(Matrix.Scale(s, 4))
    return s


def clump_window(rnd):
    gx, gy = rnd.randrange(3), rnd.randrange(3)
    return (gx / 3 + 0.02, gy / 3 + 0.02, gx / 3 + 1 / 3 - 0.02, gy / 3 + 1 / 3 - 0.02)



def assert_outward(part, tag):
    """Every face normal must point away from the part's own axis (tubes) or centre (blobs)."""
    me = part.data
    me.calc_loop_triangles()
    if part.get("tk_kind") == "card":
        return  # open single-sided card, material is doubleSided
    if part.get("tk_kind") == "blob":
        # closed volume: normals are correct iff recalc_face_normals flips nothing
        bm = bmesh.new()
        bm.from_mesh(me)
        before = [f.normal.copy() for f in bm.faces]
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        flips = sum(1 for f, n0 in zip(bm.faces, before) if f.normal.dot(n0) < 0.9)
        bm.free()
        if flips:
            raise AssertionError(f"{tag}/{part.name}: {flips} faces not outward-consistent")
        return
    axis = [Vector(p) for p in part["tk_axis"]]
    bad = 0
    for tri in me.loop_triangles:
        c = tri.center
        ref = nearest_on_segment(c, axis[0], axis[-1])
        if tri.normal.dot(c - ref) < -1e-3:
            bad += 1
    if bad:
        raise AssertionError(f"{tag}/{part.name}: {bad} inward faces")


def nearest_on_segment(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return a + ab * t


# ---------------------------------------------------------------- species builders
def build_camphor(tag, B, M, seed, large):
    rnd = random.Random(seed)
    parts = []
    trunk_h = 3.05 if large else 2.45
    top = Vector((0.07, 0.03, trunk_h))
    mid = Vector((0.03, 0.01, trunk_h * 0.6))
    # r 0.26 flare at base, ~0.225 at 1.3 m (spec Ø0.45), 0.15 at top
    parts.append(tube(f"{tag}__trunk", [(0, 0, 0), mid, top], 0.26, 0.15, 10, M["bark-oxblood"], seed + 1))
    n_br = 4 if large else 3
    for i in range(n_br):
        az = rnd.uniform(0, 2 * math.pi)
        r_ax = rnd.uniform(1.3, 1.7)
        zend = rnd.uniform(4.3, 4.8) if large else rnd.uniform(3.4, 3.8)
        p0 = mid.lerp(top, rnd.uniform(0.5, 0.9))
        p1 = Vector((math.cos(az) * r_ax, math.sin(az) * r_ax, zend))
        parts.append(tube(f"{tag}__branch-{i}", [p0, p0.lerp(p1, 0.5), p1], 0.10, 0.05, 8, M["bark-oxblood"], seed + 10 + i))
    crown = []
    cz = 5.5 if large else 4.35
    crown.append(blob(f"{tag}__crown-0", (0.05, 0, cz), (2.15, 2.05, 1.05), 3, M["foliage-camphor-a"], seed + 30))
    n_per = 5 if large else 4
    for i in range(n_per):
        az = 2 * math.pi * i / n_per + rnd.uniform(-0.25, 0.25)
        r_ax = rnd.uniform(1.8, 2.05)
        crown.append(blob(f"{tag}__crown-{i + 1}",
                          (math.cos(az) * r_ax, math.sin(az) * r_ax, cz - rnd.uniform(0.15, 0.4)),
                          (rnd.uniform(1.25, 1.45), rnd.uniform(1.15, 1.35), 0.72),
                          2, M["foliage-camphor-b"] if i % 2 else M["foliage-camphor-a"], seed + 40 + i))
    card_r = 2.9 if large else 2.6
    n_cards = 12 if large else 10
    for i in range(n_cards):
        az = 2 * math.pi * i / n_cards + rnd.uniform(-0.15, 0.15)
        crown.append(card(f"{tag}__card-{i}",
                          (math.cos(az) * card_r, math.sin(az) * card_r, cz - 0.05),
                          1.3, 1.2, az, M["card-broadleaf"], seed + 60 + i,
                          bow=0.12, segs=1, uv_window=clump_window(rnd)))
    s = crown_group(crown, B)
    parts += crown
    return parts, {"crownScale": round(s, 4)}


def build_willow(tag, B, M, seed, large):
    rnd = random.Random(seed)
    parts = []
    trunk_h = 2.8 if large else 2.2
    lean_deg = rnd.uniform(4.0, 6.0)
    lean_az = rnd.uniform(0, 2 * math.pi)
    lt = math.sin(math.radians(lean_deg)) * trunk_h
    top = Vector((math.cos(lean_az) * lt, math.sin(lean_az) * lt, trunk_h))
    parts.append(tube(f"{tag}__trunk", [(0, 0, 0), top * 0.55, top], 0.21, 0.12, 8, M["bark-neutral"], seed + 1))

    # R1 fix #2: crown = 4 umbrella clusters (small head over a wider skirt,
    # no solid core block); strips hang from the skirt rim down to 0.8 m.
    tx, ty = top.x * 0.85, top.y * 0.85
    top_cz = trunk_h + (1.7 if large else 1.5)
    skirt_cz = trunk_h + (0.8 if large else 0.7)
    skirt_r = 1.35 if large else 1.25
    r_head_top = (0.95, 0.95, 0.60) if large else (0.85, 0.85, 0.55)
    r_base_top = (1.30, 1.30, 0.62) if large else (1.25, 1.25, 0.62)
    r_head_skirt = (0.95, 0.95, 0.50) if large else (0.90, 0.90, 0.48)
    r_base_skirt = (1.25, 1.25, 0.55) if large else (1.15, 1.15, 0.50)
    clusters = [
        blob(f"{tag}__uc-top-head", (tx, ty, top_cz + 0.30), r_head_top, 2, M["foliage-willow-tuft"], seed + 30),
        blob(f"{tag}__uc-top-base", (tx, ty, top_cz - 0.05), r_base_top, 3, M["foliage-willow-tuft"], seed + 31),
    ]
    for k in range(3):
        az = 2 * math.pi * k / 3 + math.pi / 6 + rnd.uniform(-0.12, 0.12)
        cx, cy = math.cos(az) * skirt_r, math.sin(az) * skirt_r
        clusters.append(blob(f"{tag}__uc-skirt-{k}-head", (cx, cy, skirt_cz + 0.28), r_head_skirt, 2,
                             M["foliage-willow-tuft"], seed + 40 + 2 * k))
        clusters.append(blob(f"{tag}__uc-skirt-{k}-base", (cx, cy, skirt_cz - 0.02), r_base_skirt, 3,
                             M["foliage-willow-tuft"], seed + 41 + 2 * k))
    s = crown_group(clusters, B)
    skirt_objs = clusters[2:]
    rim_r = max(math.hypot(v.co.x, v.co.y) for o in skirt_objs for v in o.data.vertices)
    rim_z = min(v.co.z for o in skirt_objs for v in o.data.vertices)
    strip_bottom = 0.8  # R1: strips hang down to 0.8 m above ground
    n_strips = 14 if large else 12  # spec: 10-14 hanging strips
    strips = []
    for i in range(n_strips):
        az = 2 * math.pi * i / n_strips + rnd.uniform(-0.1, 0.1)
        attach_z = rim_z + 0.15
        strips.append(card(f"{tag}__strip-{i}",
                           (math.cos(az) * rim_r * 0.93, math.sin(az) * rim_r * 0.93, attach_z),
                           rnd.uniform(0.55, 0.68), attach_z - strip_bottom, az, M["card-willow"], seed + 70 + i,
                           bow=rnd.uniform(0.20, 0.30), segs=4))
    # solid tufts must stay <= 50 % of the crown envelope (bbox ellipsoid of foliage + strips)
    solid_vol = sum(mesh_volume(o) for o in clusters)
    crown_objs = clusters + strips
    xs = [v.co.x for o in crown_objs for v in o.data.vertices]
    ys = [v.co.y for o in crown_objs for v in o.data.vertices]
    zs = [v.co.z for o in crown_objs for v in o.data.vertices]
    env = math.pi / 6 * (max(xs) - min(xs)) * (max(ys) - min(ys)) * (max(zs) - min(zs))
    ratio = solid_vol / env
    if ratio > 0.50:
        raise AssertionError(f"{tag}: solid/envelope volume ratio {ratio:.3f} > 0.50")
    real_bottom = min(v.co.z for o in strips for v in o.data.vertices)
    if abs(real_bottom - strip_bottom) > 0.03:
        raise AssertionError(f"{tag}: strip bottom {real_bottom:.3f} != {strip_bottom}")
    parts += clusters + strips
    return parts, {"leanDeg": round(lean_deg, 2), "crownScale": round(s, 4), "strips": n_strips,
                   "clusters": 4, "solidVolumeM3": round(solid_vol, 2), "crownEnvelopeM3": round(env, 2),
                   "solidEnvelopeRatio": round(ratio, 3), "stripBottomZ": round(real_bottom, 3),
                   "rimRadius": round(rim_r, 3), "rimZ": round(rim_z, 3)}


def build_osmanthus(tag, B, M, seed, large):
    rnd = random.Random(seed)
    parts = []
    # crown first: the trunk is sized to reach into it (R1 fix #1, no floating crown)
    crown = []
    cz = 5.0 if large else 3.75
    big_r = (1.75, 1.7, 1.55) if large else (1.75, 1.65, 1.45)
    crown.append(blob(f"{tag}__crown-0", (0, 0, cz), big_r, 3, M["foliage-osmanthus-a"], seed + 30))
    for i in range(2):
        az = math.pi / 2 + math.pi * i + rnd.uniform(-0.2, 0.2)
        r_ax = 0.8 if large else 0.9
        sr = (0.95, 0.9, 0.9) if large else (1.0, 0.95, 0.9)
        crown.append(blob(f"{tag}__crown-{i + 1}",
                          (math.cos(az) * r_ax, math.sin(az) * r_ax, cz - (0.9 if large else 0.75)),
                          sr, 3, M["foliage-osmanthus-b"] if i else M["foliage-osmanthus-a"], seed + 40 + i))
    n_cards = 8 if large else 6
    for i in range(n_cards):
        az = 2 * math.pi * i / n_cards + rnd.uniform(-0.3, 0.3)
        r_ax = rnd.uniform(1.6, 1.9) if large else rnd.uniform(1.45, 1.7)
        z = cz + rnd.uniform(-1.0, 0.35)
        crown.append(card(f"{tag}__card-{i}",
                          (math.cos(az) * r_ax, math.sin(az) * r_ax, z + 0.5),
                          1.0, 1.0, az, M["card-broadleaf"], seed + 60 + i,
                          bow=0.1, segs=1, uv_window=clump_window(rnd)))
    s = crown_group(crown, B)
    crown_min = min(v.co.z for o in crown for v in o.data.vertices)
    # trunk top >= crown lowest point + 0.30 m (R1 fix #1); 0.35 m penetration
    trunk_top = crown_min + 0.35
    top = Vector((0.02, 0.0, trunk_top))
    parts.append(tube(f"{tag}__trunk", [(0, 0, 0), top * 0.6, top], 0.19, 0.11, 8, M["bark-neutral"], seed + 1))
    for i in range(2):
        az = rnd.uniform(0, 2 * math.pi)
        p0 = Vector((top.x + rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), trunk_top * 0.78))
        p1 = Vector((top.x + math.cos(az) * 0.5, math.sin(az) * 0.5, crown_min + 0.85))
        parts.append(tube(f"{tag}__fork-{i}", [p0, p1], 0.085, 0.05, 6, M["bark-neutral"], seed + 10 + i))
    if trunk_top - crown_min < 0.30 - 1e-9:
        raise AssertionError(f"{tag}: trunk top {trunk_top:.3f} reaches only {trunk_top - crown_min:.3f} into crown (min 0.30)")
    parts += crown
    return parts, {"trunkTop": round(trunk_top, 3), "crownBottomMin": round(crown_min, 3),
                   "trunkPenetration": round(trunk_top - crown_min, 3), "crownScale": round(s, 4)}


# ---------------------------------------------------------------- main
def main():
    for c in (GDIR, BDIR):
        os.makedirs(c, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = make_materials()

    variants = [
        ("camphor-small", "camphor", 5.2, 101, False),
        ("camphor-large", "camphor", 6.6, 102, True),
        ("willow-small", "willow", 5.2, 103, False),
        ("willow-large", "willow", 6.6, 104, True),
        ("osmanthus-small", "osmanthus", 5.2, 105, False),
        ("osmanthus-large", "osmanthus", 6.6, 106, True),
    ]
    builders = {"camphor": build_camphor, "willow": build_willow, "osmanthus": build_osmanthus}
    report = []
    for tag, species, B, seed, large in variants:
        parts, info = builders[species](tag, B, M, seed, large)
        for o in parts:
            assert_outward(o, tag)
        tris = sum(tri_count(o) for o in parts)
        if tris > TRI_BUDGET:
            raise AssertionError(f"{tag}: {tris} tris over budget {TRI_BUDGET}")
        xs = [v.co.x for o in parts for v in o.data.vertices]
        ys = [v.co.y for o in parts for v in o.data.vertices]
        zs = [v.co.z for o in parts for v in o.data.vertices]
        maxz, minz = max(zs), min(zs)
        width = max(max(xs) - min(xs), max(ys) - min(ys))
        if abs(maxz - B) > 0.01:
            raise AssertionError(f"{tag}: crown top {maxz:.3f} != {B}")
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = f"tk-{tag}"
        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(GDIR, f"tk-{tag}.glb"),
            export_format="GLB", export_yup=True, export_apply=False,
        )
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BDIR, f"tk-{tag}.blend"))
        report.append({
            "variant": tag, "file": f"tk-{tag}.glb", "species": species,
            "baseCrownTop": B, "tris": tris, "crownWidthBlend": round(width, 3),
            "boundsBlend": {"min": [round(min(xs), 3), round(min(ys), 3), round(minz, 3)],
                            "max": [round(max(xs), 3), round(max(ys), 3), round(maxz, 3)]},
            "info": info,
        })
        print(f"[tree-kit] {tag}: {tris} tris, width {width:.2f}, top {maxz:.2f}")
        bpy.data.objects.remove(joined, do_unlink=True)
    with open(os.path.join(OUT, "build-report.json"), "w", encoding="utf-8") as f:
        json.dump({"triBudget": TRI_BUDGET, "variants": report}, f, ensure_ascii=False, indent=1)
    print("[tree-kit] build-report.json written")


main()
