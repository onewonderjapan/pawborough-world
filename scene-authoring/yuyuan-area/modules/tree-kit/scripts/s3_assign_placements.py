#!/usr/bin/env python3
"""S3: per-tree species assignment + placement mapping.

Rules (DESIGN_SPEC):
  willow     if within 8 m of any garden/pond water polygon edge
  osmanthus  elif within 6 m of a hall/xuan footprint
  camphor    otherwise
  scale so canopy top == layout height (±10% tolerance; we target exact)
  rotY = deterministic hash of the layout id
Fallback: a tree inside a footprint/water polygon is moved out towards the
nearest edge; move is capped at 1.0 m unless geometry makes that impossible
(recorded in the placement and PROGRESS assumptions).
"""
import hashlib
import json
import math
import os

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BASE_TOP = {"small": 5.2, "large": 6.6}
VARIANT_CUT = 6.0  # heights <= cut get the small variant
WATER_D = 8.0
BUILDING_D = 6.0


def seg_distance(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    ex, ez = ax + t * dx, az + t * dz
    return math.hypot(px - ex, pz - ez)


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
            xin = x1 + (pz - z1) * (x2 - x1) / (z2 - z1)
            if xin > px:
                inside = not inside
    return inside


def nearest_edge_point(px, pz, fp):
    best = None
    for i in range(len(fp)):
        ax, az = fp[i]
        bx, bz = fp[(i + 1) % len(fp)]
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
        ex, ez = ax + t * dx, az + t * dz
        d = math.hypot(px - ex, pz - ez)
        if best is None or d < best[0]:
            best = (d, ex, ez)
    return best


def rot_y(tree_id):
    h = int(hashlib.md5(tree_id.encode()).hexdigest()[:8], 16)
    return round((h % 360) * math.pi / 180, 4)


def main():
    site = json.load(open(os.path.join(MODULE, "site-inputs.json")))
    polys = [(p["id"], p["footprint"], "water") for p in site["waterPolygons"]] + \
            [(p["id"], p["footprint"], "building") for p in site["buildingFootprints"]]

    placements = []
    fallback_moves = []
    for t in site["trees"]:
        x, z = t["x"], t["z"]
        moved = None
        # fallback: exit any polygon we start inside
        for _ in range(4):
            hits = [(pid, fp, kind) for pid, fp, kind in polys if point_in_polygon(x, z, fp)]
            if not hits:
                break
            pid, fp, kind = hits[0]
            d, ex, ez = nearest_edge_point(x, z, fp)
            exit_d = d + 0.05
            cap = min(exit_d, 1.0)
            nx, nz = (ex - x) / d, (ez - z) / d
            x, z = round(x + nx * cap, 4), round(z + nz * cap, 4)
            moved = {"from": [t["x"], t["z"]], "target": pid, "kind": kind,
                     "requestedExitM": round(exit_d, 3), "appliedCapM": round(cap, 3)}
            fallback_moves.append(moved | {"id": t["id"]})
            if cap < exit_d and point_in_polygon(x, z, fp):
                # 1.0 m cap cannot clear the polygon: finish the exit and record
                d2, ex2, ez2 = nearest_edge_point(x, z, fp)
                nx2, nz2 = (ex2 - x) / d2, (ez2 - z) / d2
                x, z = round(x + nx2 * (d2 + 0.05), 4), round(z + nz2 * (d2 + 0.05), 4)
                moved["exceededFallbackCap"] = True
                moved["finalMoveM"] = round(math.hypot(x - t["x"], z - t["z"]), 3)

        dw = min((poly_distance(x, z, fp) for _, fp, k in polys if k == "water"), default=1e9)
        db = min((poly_distance(x, z, fp) for _, fp, k in polys if k == "building"), default=1e9)
        if dw <= WATER_D:
            species = "willow"
        elif db <= BUILDING_D:
            species = "osmanthus"
        else:
            species = "camphor"
        variant = "small" if t["height"] <= VARIANT_CUT else "large"
        scale = round(t["height"] / BASE_TOP[variant], 4)
        placements.append({
            "id": t["id"],
            "species": species,
            "variant": variant,
            "scale": scale,
            "rotY": rot_y(t["id"]),
            "position": [x, z],
            "layoutHeight": t["height"],
            "canopyTop": round(BASE_TOP[variant] * scale, 4),
            "distWater": round(dw, 3),
            "distBuilding": round(db, 3),
            **({"fallbackMove": moved} if moved else {}),
        })

    result = {
        "packageId": "pawborough-w1-tree-kit-20260922",
        "source": "site-inputs.json (frozen baseline/layout.json @ 33a3bd72)",
        "rules": {"willowWithinWaterM": WATER_D, "osmanthusWithinBuildingM": BUILDING_D,
                  "variantCutHeightM": VARIANT_CUT, "baseCrownTop": BASE_TOP,
                  "rotY": "md5(id)[:8] int mod 360 deg, radians"},
        "count": len(placements),
        "speciesCounts": {s: sum(1 for p in placements if p["species"] == s)
                          for s in ("camphor", "willow", "osmanthus")},
        "placements": placements,
    }
    with open(os.path.join(MODULE, "tree-placements.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

    collision = {
        "packageId": "pawborough-w1-tree-kit-20260922",
        "note": "trunk box only; canopy unreachable. Square boxes are rotY-invariant; "
                "multiply halfExtent and yMax by the placement scale. Coordinates are "
                "placement-local (x east, z south), y up, origin at trunk base.",
        "species": {
            "camphor": {"halfExtentXZ": 0.35, "yMin": 0.0, "yMax": 2.6},
            "willow": {"halfExtentXZ": 0.5, "yMin": 0.0, "yMax": 3.2,
                       "note": "covers leaning trunk (lean <= 8 deg spec, built 4-6 deg)"},
            "osmanthus": {"halfExtentXZ": 0.3, "yMin": 0.0, "yMax": 1.7},
        },
    }
    with open(os.path.join(MODULE, "collision.json"), "w", encoding="utf-8") as f:
        json.dump(collision, f, ensure_ascii=False, indent=1)

    print(json.dumps(result["speciesCounts"], ensure_ascii=False))
    print(f"placements: {len(placements)}; fallback moves: {len(fallback_moves)}")
    scales = [p["scale"] for p in placements]
    print(f"scale range {min(scales):.3f}..{max(scales):.3f}")
    for m in fallback_moves:
        print("  moved:", m)


if __name__ == "__main__":
    main()
