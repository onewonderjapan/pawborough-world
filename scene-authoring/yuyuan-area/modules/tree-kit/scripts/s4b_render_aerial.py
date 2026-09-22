# Runs inside Blender:  blender -b -t 4 -P s4b_render_aerial.py -- <module dir> <out-tree-kit dir>
# Garden aerial mock: the 46 placements instanced on a flat plane with a ground
# grid, orthographic camera, Cycles CPU, blank-frame guard.
import bpy
import json
import math
import os
import sys

from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODULE = os.path.abspath(ARGS[0])
OUT = os.path.abspath(ARGS[1])
GDIR = os.path.join(OUT, "glb")
RDIR = os.path.join(OUT, "renders")
os.makedirs(RDIR, exist_ok=True)

VARIANT_FILE = {
    ("camphor", "small"): "tk-camphor-small.glb",
    ("camphor", "large"): "tk-camphor-large.glb",
    ("willow", "small"): "tk-willow-small.glb",
    ("willow", "large"): "tk-willow-large.glb",
    ("osmanthus", "small"): "tk-osmanthus-small.glb",
    ("osmanthus", "large"): "tk-osmanthus-large.glb",
}


def blank_guard(path):
    import numpy as np
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, img.channels)[:, :3]
    lum = px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    std = float(lum.std()) * 255
    q = (px * 255).astype(np.uint32)
    colors, counts = np.unique(q, axis=0, return_counts=True)
    dominant = float(counts.max()) / len(q)
    bpy.data.images.remove(img)
    return std >= 2.0 and dominant < 0.95, round(std, 2), round(dominant, 4)


def main():
    pl = json.load(open(os.path.join(MODULE, "tree-placements.json")))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 40
    sc.render.resolution_x = 1500
    sc.render.resolution_y = 2000
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.87, 0.9, 1)
    sc.world = w

    # ground plane + 10 m grid over the garden extents
    xs = [p["position"][0] for p in pl["placements"]]
    ys = [p["position"][1] for p in pl["placements"]]
    x0, x1 = min(xs) - 12, max(xs) + 12
    y0, y1 = min(ys) - 12, max(ys) + 12
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.65, 0.58, 1)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, -0.02))
    ground = bpy.context.object
    ground.scale = ((x1 - x0) / 2 + 20, (y1 - y0) / 2 + 20, 1)
    ground.data.materials.append(gm)

    line_m = bpy.data.materials.new("grid")
    line_m.use_nodes = True
    line_m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.48, 0.42, 1)

    def strip(ax, ay, bx, by, wid):
        mid = Vector(((ax + bx) / 2, (ay + by) / 2, 0))
        import mathutils
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        mesh = bpy.data.meshes.new("g")
        import bmesh
        bm = bmesh.new()
        v1 = bm.verts.new((-ln / 2, -wid / 2, 0))
        v2 = bm.verts.new((ln / 2, -wid / 2, 0))
        v3 = bm.verts.new((ln / 2, wid / 2, 0))
        v4 = bm.verts.new((-ln / 2, wid / 2, 0))
        bm.faces.new((v1, v2, v3, v4))
        bm.to_mesh(mesh)
        bm.free()
        ob = bpy.data.objects.new("grid", mesh)
        ob.location = (mid.x, mid.y, 0.0)
        ob.rotation_euler = (0, 0, math.atan2(dy, dx))
        ob.data.materials.append(line_m)
        bpy.context.collection.objects.link(ob)

    x = math.ceil(x0 / 10) * 10
    while x <= x1:
        strip(x, y0, x, y1, 0.06)
        x += 10
    y = math.ceil(y0 / 10) * 10
    while y <= y1:
        strip(x0, y, x1, y, 0.06)
        y += 10

    # import the 6 variants once, then instance
    templates = {}
    for key, fn in VARIANT_FILE.items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(GDIR, fn))
        ob = [o for o in set(bpy.data.objects) - before if o.type == "MESH"][0]
        ob.name = f"src-{fn[:-4]}"
        templates[key] = ob

    for p in pl["placements"]:
        key = (p["species"], p["variant"])
        inst = templates[key].copy()  # linked mesh duplicate
        inst.name = f"tree-{p['id']}"
        # layout position (x, z) -> blender (x, y): layout z south = blender y
        inst.location = (p["position"][0], p["position"][1], 0)
        inst.rotation_euler = (0, 0, p["rotY"])
        inst.scale = (p["scale"], p["scale"], p["scale"])
        bpy.context.collection.objects.link(inst)

    # sun + ortho camera
    sd = bpy.data.lights.new("sun", "SUN")
    sd.energy = 3.2
    sd.angle = 0.35
    so = bpy.data.objects.new("sun", sd)
    so.rotation_euler = (math.radians(35), math.radians(12), 0)
    bpy.context.collection.objects.link(so)

    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    span = max(x1 - x0, (y1 - y0) * 1500 / 2000)
    cd.ortho_scale = span
    co = bpy.data.objects.new("cam", cd)
    co.location = (cx, cy, 80)
    co.rotation_euler = (0, 0, 0)  # straight down, +y up in frame
    bpy.context.collection.objects.link(co)
    sc.camera = co

    path = os.path.join(RDIR, "garden-aerial-mock.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    ok, std, dom = blank_guard(path)
    guard = {"file": "garden-aerial-mock.png", "blankGuard": ok, "lumStd255": std, "dominant": dom}
    with open(os.path.join(RDIR, "blank-guards-aerial.json"), "w", encoding="utf-8") as f:
        json.dump(guard, f, ensure_ascii=False, indent=1)
    if not ok:
        print(f"[aerial] BLANK FRAME std={std} dominant={dom}")
        sys.exit(1)
    print(f"[aerial] ok (std={std} dom={dom}) span={span:.1f}m")


main()
