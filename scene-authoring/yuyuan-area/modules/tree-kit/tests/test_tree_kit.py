#!/usr/bin/env python3
"""Tests for the tree-kit wave-1 batch (pawborough-w1-tree-kit-20260922).

Run:  python3 tests/test_tree_kit.py        (or via pytest)
Needs: node + the repo's node_modules (gltf-validator) for the validator check.
Everything else is stdlib. Site inputs come from site-inputs.json (frozen
baseline layout); outputs from tree-placements.json and out-tree-kit/.
"""
import json
import hashlib
import math
import os
import struct
import subprocess
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_NODE = "/home/baibai/work/onewonderjapan/pawborough-world"
OUT = os.path.abspath(os.path.join(MODULE, os.pardir, os.pardir, "out-tree-kit"))

BASE_TOP = {"small": 5.2, "large": 6.6}
TRI_BUDGET = 2600
WATER_D = 8.0
BUILDING_D = 6.0
# R1 (pawborough-w1-tree-kit-r1-20260923) fix thresholds
OSMANTHUS_TRUNK_PENETRATION = 0.30  # trunk top must reach crown min + this
WILLOW_STRIP_BOTTOM = 0.80          # strips hang down to this height above ground
WILLOW_SOLID_RATIO_MAX = 0.50       # solid tuft volume / crown envelope volume


# ------------------------------------------------------------------ helpers
def seg_distance(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def poly_distance(px, pz, fp):
    return min(seg_distance(px, pz, fp[i][0], fp[i][1], fp[(i + 1) % len(fp)][0], fp[(i + 1) % len(fp)][1])
               for i in range(len(fp)))


def point_in_polygon(px, pz, fp):
    inside = False
    n = len(fp)
    for i in range(n):
        x1, z1 = fp[i]
        x2, z2 = fp[(i + 1) % n]
        if (z1 > pz) != (z2 > pz):
            if x1 + (pz - z1) * (x2 - x1) / (z2 - z1) > px:
                inside = not inside
    return inside


def expected_rot_y(tree_id):
    h = int(hashlib.md5(tree_id.encode()).hexdigest()[:8], 16)
    return round((h % 360) * math.pi / 180, 4)


def glb_tris_and_bounds(path):
    with open(path, "rb") as f:
        raw = f.read()
    clen, = struct.unpack("<I", raw[12:16])
    j = json.loads(raw[20:20 + clen])
    tris = 0
    top = None
    ymin = None
    for mesh in j.get("meshes", []):
        for prim in mesh.get("primitives", []):
            tris += j["accessors"][prim["indices"]]["count"] // 3
            pa = j["accessors"][prim["attributes"]["POSITION"]]
            if top is None:
                top = pa["max"][1]
                ymin = pa["min"][1]
            else:
                top = max(top, pa["max"][1])
                ymin = min(ymin, pa["min"][1])
    return tris, top, ymin


# ------------------------------------------------------------------ glb prim parsing (R1)
_COMP_FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _parse_glb(path):
    with open(path, "rb") as f:
        raw = f.read()
    clen, = struct.unpack("<I", raw[12:16])
    j = json.loads(raw[20:20 + clen])
    off = 20 + clen
    blen, = struct.unpack("<I", raw[off:off + 4])
    return j, raw[off + 8:off + 8 + blen]


def _read_accessor(j, bins, idx):
    acc = j["accessors"][idx]
    bv = j["bufferViews"][acc["bufferView"]]
    fmt = "<" + _COMP_FMT[acc["componentType"]] * _NCOMP[acc["type"]]
    esize = struct.calcsize(_COMP_FMT[acc["componentType"]]) * _NCOMP[acc["type"]]
    stride = bv.get("byteStride") or esize
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    vals = [struct.unpack_from(fmt, bins, base + i * stride) for i in range(acc["count"])]
    return vals if _NCOMP[acc["type"]] > 1 else [v[0] for v in vals]


def glb_prims(path):
    """Per-primitive: material name, decoded positions/indices, accessor min/max."""
    j, bins = _parse_glb(path)
    mats = [m.get("name") or "" for m in j.get("materials", [])]
    out = []
    for mesh in j.get("meshes", []):
        for prim in mesh.get("primitives", []):
            pa = j["accessors"][prim["attributes"]["POSITION"]]
            out.append({
                "mat": mats[prim["material"]],
                "pos": _read_accessor(j, bins, prim["attributes"]["POSITION"]),
                "idx": _read_accessor(j, bins, prim["indices"]),
                "amin": pa["min"], "amax": pa["max"],
            })
    return out


def _components(prim):
    """Connected components with vertices welded by rounded position (exporter may split verts)."""
    weld = {}
    parent = []

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def node(p):
        key = (round(p[0], 4), round(p[1], 4), round(p[2], 4))
        if key not in weld:
            weld[key] = len(parent)
            parent.append(len(parent))
        return weld[key]

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    for k in range(0, len(prim["idx"]), 3):
        a, b, c = (node(prim["pos"][i]) for i in prim["idx"][k:k + 3])
        union(a, b)
        union(a, c)
    return len({find(i) for i in range(len(parent))})


def _volume(prim):
    """Absolute signed volume of a closed primitive (disjoint outward blobs sum correctly)."""
    v = 0.0
    pos = prim["pos"]
    for k in range(0, len(prim["idx"]), 3):
        a, b, c = (pos[i] for i in prim["idx"][k:k + 3])
        v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) \
            + a[2] * (b[0] * c[1] - b[1] * c[0])
    return abs(v / 6.0)


# ------------------------------------------------------------------ fixtures
def load():
    site = json.load(open(os.path.join(MODULE, "site-inputs.json")))
    placements = json.load(open(os.path.join(MODULE, "tree-placements.json")))
    return site, placements


# ------------------------------------------------------------------ tests
def test_46_placements_ids_match_layout():
    site, pl = load()
    layout_ids = sorted(t["id"] for t in site["trees"])
    got = sorted(p["id"] for p in pl["placements"])
    assert got == layout_ids, "placement ids must match frozen layout exactly"
    assert pl["count"] == 46 and len(got) == 46


def test_species_rules_recomputed_from_layout_polygons():
    site, pl = load()
    water = [p["footprint"] for p in site["waterPolygons"]]
    builds = [p["footprint"] for p in site["buildingFootprints"]]
    for p in pl["placements"]:
        dw = min((poly_distance(*p["position"], fp) for fp in water), default=1e9)
        db = min((poly_distance(*p["position"], fp) for fp in builds), default=1e9)
        if dw <= WATER_D:
            expect = "willow"
        elif db <= BUILDING_D:
            expect = "osmanthus"
        else:
            expect = "camphor"
        assert p["species"] == expect, f"{p['id']}: {p['species']} != {expect} (dw={dw:.2f} db={db:.2f})"
        assert abs(p["distWater"] - dw) < 0.01 and abs(p["distBuilding"] - db) < 0.01


def test_canopy_top_matches_layout_height():
    site, pl = load()
    heights = {t["id"]: t["height"] for t in site["trees"]}
    for p in pl["placements"]:
        top = BASE_TOP[p["variant"]] * p["scale"]
        assert abs(top - heights[p["id"]]) <= 0.10 * heights[p["id"]], p["id"]
        assert abs(p["canopyTop"] - top) < 0.01
        assert 0.8 <= p["scale"] <= 1.25, f"{p['id']} scale {p['scale']} implausible"


def test_tri_budget_per_variant():
    for fn in sorted(os.listdir(os.path.join(OUT, "glb"))):
        if fn.endswith(".glb"):
            tris, _, _ = glb_tris_and_bounds(os.path.join(OUT, "glb", fn))
            assert tris <= TRI_BUDGET, f"{fn}: {tris} tris > {TRI_BUDGET}"


def test_validator_zero_errors():
    glbs = sorted(f"glb/{f}" for f in os.listdir(os.path.join(OUT, "glb")) if f.endswith(".glb"))
    assert len(glbs) == 6, f"expected 6 GLBs, found {len(glbs)}"
    report_path = os.path.join(OUT, "validator-report.json")
    subprocess.run(
        ["node", os.path.join(REPO_NODE, "scripts", "validate_all.cjs"),
         "--files", ",".join(glbs), "--root", OUT, "--report", report_path],
        check=True, cwd=REPO_NODE,
    )
    rep = json.load(open(report_path))
    for r in rep["results"]:
        summary = r.get("validation", {}).get("issues", {})
        assert r.get("fatal") is None and summary.get("numErrors", 0) == 0, f"{r['file']}: {r}"


def test_no_placement_inside_footprint_or_water():
    site, pl = load()
    polys = [(p["id"], p["footprint"]) for p in site["waterPolygons"] + site["buildingFootprints"]]
    for p in pl["placements"]:
        x, z = p["position"]
        for pid, fp in polys:
            assert not point_in_polygon(x, z, fp), f"{p['id']} inside {pid}"


def test_rot_y_deterministic():
    _, pl = load()
    for p in pl["placements"]:
        assert p["rotY"] == expected_rot_y(p["id"]), p["id"]
        assert 0.0 <= p["rotY"] < 2 * math.pi


def test_glb_variant_bounds_and_variant_rule():
    build = json.load(open(os.path.join(OUT, "build-report.json")))
    bases = {v["variant"]: v for v in build["variants"]}
    _, pl = load()
    for p in pl["placements"]:
        v = bases[f"{p['species']}-{p['variant']}"]
        tris, top, ymin = glb_tris_and_bounds(os.path.join(OUT, "glb", v["file"]))
        assert abs(top - v["baseCrownTop"]) < 0.05, f"{v['file']} top {top}"
        assert ymin >= -0.01, f"{v['file']} sinks under ground: {ymin}"
        # variant rule: small below the cut, large above
        expect = "small" if p["layoutHeight"] <= 6.0 else "large"
        assert p["variant"] == expect, p["id"]


def test_osmanthus_trunk_reaches_into_crown():
    # R1 fix #1: no floating crown — trunk top vertex >= crown lowest point + 0.30 m
    for tag in ("osmanthus-small", "osmanthus-large"):
        prims = glb_prims(os.path.join(OUT, "glb", f"tk-{tag}.glb"))
        woody = [p for p in prims if "bark" in p["mat"]]
        crown = [p for p in prims if "bark" not in p["mat"]]
        assert woody and crown, f"{tag}: expected bark and crown primitives"
        trunk_top = max(p["amax"][1] for p in woody)
        crown_min = min(p["amin"][1] for p in crown)
        assert trunk_top >= crown_min + OSMANTHUS_TRUNK_PENETRATION - 1e-6, \
            f"{tag}: trunk top {trunk_top:.3f} < crown min {crown_min:.3f} + {OSMANTHUS_TRUNK_PENETRATION}"


def test_willow_crown_structure():
    # R1 fix #2: clustered umbrella crown (no solid block), strips from the skirt
    # rim hanging uniformly down to 0.8 m, solid volume <= 50 % of the envelope
    for tag in ("willow-small", "willow-large"):
        prims = glb_prims(os.path.join(OUT, "glb", f"tk-{tag}.glb"))
        solid = [p for p in prims if "foliage" in p["mat"]]
        cards = [p for p in prims if "card" in p["mat"]]
        assert solid and cards, f"{tag}: expected foliage and card primitives"
        # 3-4 umbrella clusters, each a head+skirt pair -> 6-8 solid components
        n_blobs = sum(_components(p) for p in solid)
        assert 6 <= n_blobs <= 8, f"{tag}: {n_blobs} solid components (expect 6-8 = 3-4 clusters x 2)"
        # 10-14 hanging strips (spec), bottoms at 0.8 m above ground
        n_strips = sum(_components(p) for p in cards)
        assert 10 <= n_strips <= 14, f"{tag}: {n_strips} strips (expect 10-14)"
        strip_bottom = min(p["amin"][1] for p in cards)
        assert abs(strip_bottom - WILLOW_STRIP_BOTTOM) <= 0.06, \
            f"{tag}: strip bottom {strip_bottom:.3f} != {WILLOW_STRIP_BOTTOM}"
        # strips hang from the skirt rim, far below the crown apex
        apex = max(p["amax"][1] for p in solid)
        strip_top = max(p["amax"][1] for p in cards)
        assert strip_top <= apex - 0.5, f"{tag}: strips reach {strip_top:.2f}, apex {apex:.2f}"
        # solid tuft volume <= 50 % of the crown envelope (bbox ellipsoid over foliage+cards)
        vol = sum(_volume(p) for p in solid)
        crown = solid + cards
        x0 = min(p["amin"][0] for p in crown); x1 = max(p["amax"][0] for p in crown)
        y0 = min(p["amin"][1] for p in crown); y1 = max(p["amax"][1] for p in crown)
        z0 = min(p["amin"][2] for p in crown); z1 = max(p["amax"][2] for p in crown)
        env = math.pi / 6 * (x1 - x0) * (z1 - z0) * (y1 - y0)
        ratio = vol / env
        assert ratio <= WILLOW_SOLID_RATIO_MAX, \
            f"{tag}: solid/envelope volume {ratio:.3f} > {WILLOW_SOLID_RATIO_MAX}"
        print(f"     willow {tag}: blobs={n_blobs} strips={n_strips} "
              f"bottom={strip_bottom:.3f} solid/env={ratio:.3f}")


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"--- {len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
