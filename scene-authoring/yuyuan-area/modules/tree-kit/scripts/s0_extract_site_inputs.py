#!/usr/bin/env python3
"""S0: extract tree/water/building site inputs from the frozen G5 layout.

Reads baseline/layout.json (READ-ONLY) and writes site-inputs.json beside this
script's module dir. Coordinates are layout-native metres (x east, z south).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))))
LAYOUT = os.path.join(ROOT, "scene-authoring", "yuyuan-area", "baseline", "layout.json")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site-inputs.json")

BUILDING_KINDS = ("hall", "xuan")  # spec assignment rule: "hall/xuan footprint"
WATER_KINDS = ("water",)


def main():
    with open(LAYOUT, encoding="utf-8") as f:
        layout = json.load(f)
    objs = layout["objects"]

    trees = []
    water = []
    buildings = []
    skipped_water_zone = 0
    skipped_building_kind = []
    for o in objs:
        zone = o.get("zone")
        kind = o.get("kind")
        geo = o.get("geometry") or {}
        if kind == "tree" and zone == "garden":
            x, z = geo["position"]
            trees.append({
                "id": o["id"],
                "x": round(float(x), 4),
                "z": round(float(z), 4),
                "height": round(float(o["height"]), 4),
            })
        elif kind in WATER_KINDS and zone in ("garden", "pond"):
            fp = geo.get("footprint")
            if fp:
                water.append({
                    "id": o["id"], "kind": kind, "zone": zone,
                    "name": o.get("name"),
                    "footprint": [[round(float(px), 3), round(float(pz), 3)] for px, pz in fp],
                })
            else:
                skipped_water_zone += 1
        elif kind in BUILDING_KINDS and zone in ("garden", "pond"):
            fp = geo.get("footprint")
            if fp:
                buildings.append({
                    "id": o["id"], "kind": kind, "zone": zone,
                    "name": o.get("name"),
                    "footprint": [[round(float(px), 3), round(float(pz), 3)] for px, pz in fp],
                })
            else:
                skipped_building_kind.append(o["id"])

    trees.sort(key=lambda t: t["id"])
    site = {
        "packageId": "pawborough-w1-tree-kit-20260922",
        "source": "scene-authoring/yuyuan-area/baseline/layout.json @ 33a3bd72b633983d4649979f545e96a410934ace (frozen G5)",
        "coordSystem": "layout-native metres; +x east, +z south; tree geometry.position = [x,z]",
        "trees": trees,
        "waterPolygons": water,
        "buildingFootprints": buildings,
        "counts": {"trees": len(trees), "waterPolygons": len(water), "buildingFootprints": len(buildings)},
        "notes": [
            "assignment rules use kinds hall+xuan for 'hall/xuan footprint' (literal spec reading); pavilion/corridor/stage not counted — recorded as design_inference",
            f"water objects without footprint skipped: {skipped_water_zone}; building objects without footprint skipped: {skipped_building_kind}",
        ],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(site, f, ensure_ascii=False, indent=1)
    print(f"trees={len(trees)} water={len(water)} buildings={len(buildings)} -> {OUT}")
    hs = sorted(t["height"] for t in trees)
    print(f"height range {hs[0]:.2f}..{hs[-1]:.2f}")


if __name__ == "__main__":
    main()
