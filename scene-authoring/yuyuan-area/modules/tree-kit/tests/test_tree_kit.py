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
