# Runs inside Blender:  blender -b -t 4 -P s4a_render_variants.py -- <out-tree-kit dir>
# Cycles CPU renders of the 6 variant GLBs: front + three-quarter views each.
# Blank-frame guard: luminance std < 2/255 or dominant colour > 95% -> hard fail.
import bpy
import json
import math
import os
import sys

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0])
GDIR = os.path.join(OUT, "glb")
RDIR = os.path.join(OUT, "renders")
os.makedirs(RDIR, exist_ok=True)


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.render.resolution_x = 560
    sc.render.resolution_y = 700
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.84, 0.86, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = w
    # ground
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    g = bpy.context.object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.55, 0.58, 0.52, 1)
    g.data.materials.append(gm)
    # sun
    sd = bpy.data.lights.new("sun", "SUN")
    sd.energy = 3.0
    sd.angle = 0.2
    so = bpy.data.objects.new("sun", sd)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(so)
    # camera
    cd = bpy.data.cameras.new("cam")
    co = bpy.data.objects.new("cam", cd)
    bpy.context.collection.objects.link(co)
    sc.camera = co
    return sc, co


def look_at(obj, target):
    from mathutils import Vector
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


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
    ok = std >= 2.0 and dominant < 0.95
    return ok, round(std, 2), round(dominant, 4)


def main():
    build = json.load(open(os.path.join(OUT, "build-report.json")))
    guards = []
    for v in build["variants"]:
        tag = v["variant"]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc, cam = setup_scene()
        bpy.ops.import_scene.gltf(filepath=os.path.join(GDIR, f"tk-{tag}.glb"))
        from mathutils import Vector
        ob = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.name.startswith("tk-"))
        pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
        zs = [p.z for p in pts]
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        h = max(zs)
        width = max(max(xs) - min(xs), max(ys) - min(ys))
        d = max(width * 1.5, h * 2.4)
        mid = (0, 0, h * 0.55)
        views = {"front": (0, -d, h * 0.5), "threeq": (d * 0.62, -d * 0.82, h * 0.62)}
        for name, pos in views.items():
            cam.location = pos
            look_at(cam, mid)
            cam.data.lens = 50
            path = os.path.join(RDIR, f"{tag}-{name}.png")
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            ok, std, dom = blank_guard(path)
            guards.append({"file": os.path.basename(path), "blankGuard": ok, "lumStd255": std, "dominant": dom})
            if not ok:
                print(f"[render] BLANK FRAME {path} std={std} dominant={dom}")
                sys.exit(1)
            print(f"[render] {tag}-{name} ok (std={std} dom={dom})")
    with open(os.path.join(RDIR, "blank-guards.json"), "w", encoding="utf-8") as f:
        json.dump(guards, f, ensure_ascii=False, indent=1)
    print("[render] variants done")


main()
