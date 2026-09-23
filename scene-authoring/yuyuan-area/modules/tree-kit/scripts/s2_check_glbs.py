# Runs inside Blender:  blender -b -t 4 -P s2_check_glbs.py -- <out-tree-kit dir>
# Re-imports each exported GLB and verifies: images connected with sRGB colorspace,
# card materials use MASK alpha, tri budget, Y-up bounds vs build report, outward normals.
import bpy
import json
import os
import struct
import sys

import mathutils

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else[]
OUT = os.path.abspath(ARGS[0]) if ARGS else None
GDIR = os.path.join(OUT, "glb")
TRI_BUDGET = 2600
FAIL = []


def glb_json(path):
    with open(path, "rb") as f:
        raw = f.read()
    clen, = struct.unpack("<I", raw[12:16])
    return json.loads(raw[20:20 + clen])


def check_glb_json(path, tag):
    j = glb_json(path)
    cards = [m for m in j.get("materials", []) if "card" in (m.get("name") or "") or "strip" in (m.get("name") or "")]
    for m in cards:
        if m.get("alphaMode") != "MASK":
            FAIL.append(f"{tag}: card material {m.get('name')} alphaMode={m.get('alphaMode')} != MASK")
        # glTF spec: alphaCutoff defaults to 0.5 when omitted under MASK
        cutoff = m.get("alphaCutoff", 0.5)
        if abs(cutoff - 0.5) > 1e-6:
            FAIL.append(f"{tag}: {m.get('name')} alphaCutoff={cutoff} != 0.5")
        if not m.get("doubleSided"):
            FAIL.append(f"{tag}: {m.get('name')} not doubleSided")
    imgs = j.get("images", [])
    n_tex_mats = [m for m in j.get("materials", []) if (m.get("pbrMetallicRoughness") or {}).get("baseColorTexture")]
    if len(n_tex_mats) and not imgs:
        FAIL.append(f"{tag}: textured materials but no embedded images")
    return j, len(imgs)


def main():
    report = {"checkedAt": "s2", "results": []}
    build = json.load(open(os.path.join(OUT, "build-report.json")))
    expect = {v["variant"]: v for v in build["variants"]}
    for fn in sorted(os.listdir(GDIR)):
        if not fn.endswith(".glb"):
            continue
        tag = fn[:-4]
        if tag.startswith("tk-"):
            tag = tag[3:]
        path = os.path.join(GDIR, fn)
        j, n_img = check_glb_json(path, tag)
        # clean scene, reimport
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if len(meshes) != 1:
            FAIL.append(f"{tag}: expected 1 mesh node after reimport, got {len(meshes)}")
        me = meshes[0].data
        me.calc_loop_triangles()
        tris = len(me.loop_triangles)
        exp = expect[tag]
        if tris != exp["tris"]:
            FAIL.append(f"{tag}: reimport tris {tris} != build {exp['tris']}")
        if tris > TRI_BUDGET:
            FAIL.append(f"{tag}: tris {tris} > budget")
        # bounds (Blender reimport is Z-up again: vertical = z)
        mins = [min(v.co[i] for v in me.vertices) for i in range(3)]
        maxs = [max(v.co[i] for v in me.vertices) for i in range(3)]
        top = maxs[2]
        if abs(top - exp["baseCrownTop"]) > 0.02:
            FAIL.append(f"{tag}: reimport zMax {top:.3f} != baseCrownTop {exp['baseCrownTop']}")
        if abs(mins[2]) > 0.02:
            FAIL.append(f"{tag}: reimport zMin {mins[2]:.3f} != 0")
        width = max(maxs[0] - mins[0], maxs[1] - mins[1])
        if abs(width - exp["crownWidthBlend"]) > 0.05:
            FAIL.append(f"{tag}: GLB width {width:.3f} != build {exp['crownWidthBlend']}")
        # image nodes connected + colorspace
        img_nodes = [n for m in bpy.data.materials if m.use_nodes for n in m.node_tree.nodes if n.type == "TEX_IMAGE"]
        if not img_nodes and n_img:
            FAIL.append(f"{tag}: GLB embeds {n_img} images but no image nodes after reimport")
        for n in img_nodes:
            if n.image is None:
                FAIL.append(f"{tag}: image node without image")
            elif n.image.colorspace_settings.name != "sRGB":
                FAIL.append(f"{tag}: image {n.image.name} colorspace {n.image.colorspace_settings.name} != sRGB")
            linked = any(l.to_socket.name in ("Base Color", "Alpha") for l in n.outputs["Color"].links) or \
                     any(n.outputs["Alpha"].links)
            if not linked:
                FAIL.append(f"{tag}: image node {n.name} not connected to Base Color/Alpha")
        # normals outward for bark faces (sampled against local vertical axis)
        # sanity: near-ground trunk faces (z<1.0, near-vertical part) must face outward
        bark_slots = [i for i, m in enumerate(me.materials) if "bark" in (m.name or "")]
        me.calc_loop_triangles()
        bad = 0
        sampled = 0
        for tri in me.loop_triangles:
            if tri.material_index not in bark_slots:
                continue
            c = tri.center
            if c.z > 1.0:
                continue
            radial = mathutils.Vector((c.x, c.y, 0))
            if radial.length < 1e-4:
                continue
            sampled += 1
            if tri.normal.dot(radial) < 0.0:
                bad += 1
        if sampled and bad / sampled > 0.02:
            FAIL.append(f"{tag}: {bad}/{sampled} low-trunk bark faces face inward")
        report["results"].append({
            "file": fn, "tris": tris, "images": n_img,
            "boundsReimport": {"min": [round(x, 3) for x in mins], "max": [round(x, 3) for x in maxs]},
            "width": round(width, 3), "top": round(top, 3),
            "barkFacesSampled": sampled, "barkInward": bad,
        })
        print(f"[check] {fn}: tris={tris} imgs={n_img} width={width:.2f} top={top:.2f} barkInward={bad}/{sampled}")
    report["fail"] = FAIL
    with open(os.path.join(OUT, "reimport-check.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    if FAIL:
        print("[check] FAIL:")
        for x in FAIL:
            print("   -", x)
        sys.exit(1)
    print("[check] ALL PASS")


main()
