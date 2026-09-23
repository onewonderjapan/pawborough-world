#!/usr/bin/env python3
"""S1: generate the three analytic texture maps (PIL, procedural, no photos).

Outputs 512x512 PNGs into out-tree-kit/textures/:
  bark.png              RGB   - neutral bark pattern, tinted per species via baseColorFactor
  broadleaf_cluster.png RGBA  - clustered leaf blob card (MASK alpha) for camphor/osmanthus crowns
  willow_strip.png      RGBA  - hanging willow strip card (MASK alpha)
Writes map-authoring.json beside this script.
"""
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXDIR = os.path.join(MODULE, os.pardir, os.pardir, "out-tree-kit", "textures")
TEXDIR = os.path.abspath(TEXDIR)

SEED = 20260923
S = 512


def bark():
    """Neutral warm-grey bark with vertical fissures; oxblood tint variant for camphor."""
    rnd = random.Random(SEED + 1)
    img = Image.new("RGB", (S, S), (128, 116, 104))
    d = ImageDraw.Draw(img)
    # vertical fibre streaks
    for _ in range(1400):
        x = rnd.randrange(S)
        y = rnd.randrange(S)
        ln = rnd.randint(14, 90)
        w = rnd.choice((1, 1, 2))
        v = rnd.randint(-46, 34)
        d.line([(x, y), (x + rnd.randint(-3, 3), y + ln)], fill=(128 + v, 116 + v, 104 + v), width=w)
    # darker vertical fissures
    for _ in range(46):
        x = rnd.randrange(S)
        y = rnd.randrange(-40, S)
        ln = rnd.randint(60, 220)
        dev = 0
        pts = []
        for seg in range(0, ln, 14):
            dev += rnd.randint(-4, 4)
            pts.append((x + dev, y + seg))
        d.line(pts, fill=(72, 62, 54), width=rnd.choice((2, 3, 4)))
    # subtle lenticel dots
    for _ in range(140):
        x, y = rnd.randrange(S), rnd.randrange(S)
        r = rnd.randint(1, 2)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(150, 138, 124))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(TEXDIR, "bark-neutral.png"))
    # oxblood-stained tint (style match: temple-v3 tree-camphor-v2 trunk)
    ox = img.point(lambda v: v)  # copy
    ox = Image.merge("RGB", (
        ox.getchannel("R").point(lambda v: int(v * 0.70)),
        ox.getchannel("G").point(lambda v: int(v * 0.40)),
        ox.getchannel("B").point(lambda v: int(v * 0.36)),
    ))
    ox.save(os.path.join(TEXDIR, "bark-oxblood.png"))


def _leaf(d, cx, cy, ang, ln, wd, col):
    """One simple almond leaf as a rotated polygon."""
    import math
    ca, sa = math.cos(ang), math.sin(ang)
    pts = []
    for t, w in ((0.0, 0.0), (0.25, wd), (0.55, wd * 1.1), (0.8, wd * 0.7), (1.0, 0.0)):
        pts.append((cx + ca * t * ln - sa * w, cy + sa * t * ln + ca * w))
        pts.append((cx + ca * t * ln + sa * w, cy + sa * t * ln - ca * w))
    d.polygon(pts, fill=col)


GREENS = [(38, 66, 30), (46, 78, 34), (56, 92, 40), (64, 102, 46), (30, 58, 26), (74, 112, 52)]


def broadleaf_cluster():
    """Dense cluster card: 3x3 clumps of chunky leaves, transparent background."""
    rnd = random.Random(SEED + 2)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for gy in range(3):
        for gx in range(3):
            cx = gx * (S / 3) + S / 6 + rnd.randint(-18, 18)
            cy = gy * (S / 3) + S / 6 + rnd.randint(-18, 18)
            for _ in range(26):
                ang = rnd.uniform(0, 6.283)
                ln = rnd.uniform(30, 62)
                wd = rnd.uniform(7, 13)
                col = rnd.choice(GREENS) + (255,)
                _leaf(d, cx + rnd.uniform(-40, 40), cy + rnd.uniform(-40, 40), ang, ln, wd, col)
    # thicken: draw a second pass slightly offset to close MASK cutoff gaps
    a = img.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    img.putalpha(a.filter(ImageFilter.GaussianBlur(0.8)).point(lambda v: 255 if v > 90 else 0))
    img.save(os.path.join(TEXDIR, "broadleaf_cluster.png"))


def willow_strip():
    """One hanging willow strip: central stem with pairs of slim drooping leaves."""
    rnd = random.Random(SEED + 3)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    WILLOW = [(92, 130, 48), (104, 142, 54), (116, 152, 60), (84, 122, 44), (126, 160, 68)]
    x0 = S / 2
    y = 6
    while y < S - 12:
        seg = rnd.randint(30, 46)
        x0 += rnd.randint(-5, 5)
        d.line([(x0, y), (x0, y + seg)], fill=(70, 96, 40, 255), width=4)
        for side in (-1, 1):
            for _ in range(rnd.randint(4, 6)):
                ly = y + rnd.uniform(-6, seg + 6)
                ln = rnd.uniform(52, 100)
                ang = rnd.uniform(0.45, 1.55)  # sweep from outward to drooping
                col = rnd.choice(WILLOW) + (255,)
                base = 1.5708 if side > 0 else -1.5708
                off = rnd.uniform(-14, 14)
                _leaf(d, x0 + off, ly, base - side * ang, ln, rnd.uniform(6, 11), col)
        y += seg
    a = img.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    img.putalpha(a.filter(ImageFilter.GaussianBlur(0.8)).point(lambda v: 255 if v > 90 else 0))
    img.save(os.path.join(TEXDIR, "willow_strip.png"))


def main():
    os.makedirs(TEXDIR, exist_ok=True)
    bark()
    broadleaf_cluster()
    willow_strip()
    authoring = {
        "packageId": "pawborough-w1-tree-kit-20260922",
        "method": "procedural PIL draw, seeded (20260923..+3); no photos, no tracing",
        "colorSpace": {"bark-neutral.png": "sRGB", "bark-oxblood.png": "sRGB",
                       "broadleaf_cluster.png": "sRGB", "willow_strip.png": "sRGB"},
        "maps": [
            {"file": "bark-neutral.png", "size": [512, 512], "channels": "RGB", "use": "willow/osmanthus trunk bark (neutral warm grey-brown)",
             "tile": "~2.2 m vertical repeat over trunk height, ~1.4 m around circumference"},
            {"file": "bark-oxblood.png", "size": [512, 512], "channels": "RGB", "use": "camphor trunk bark, oxblood-stained tint (same procedural pixels as bark-neutral, style match to temple-v3 tree-camphor-v2)",
             "tile": "~2.2 m vertical repeat over trunk height, ~1.4 m around circumference"},
            {"file": "broadleaf_cluster.png", "size": [512, 512], "channels": "RGBA", "use": "camphor/osmanthus crown edge foliage cards",
             "alphaMode": "MASK", "alphaCutoff": 0.5, "tile": "one card face ≈ 1.1 x 1.1 m (UV 0-1 per card)"},
            {"file": "willow_strip.png", "size": [512, 512], "channels": "RGBA", "use": "willow hanging strip cards",
             "alphaMode": "MASK", "alphaCutoff": 0.5, "tile": "one card face ≈ 0.38 x 2.2 m (UV 0-1 per card)"},
        ],
    }
    with open(os.path.join(MODULE, "map-authoring.json"), "w", encoding="utf-8") as f:
        json.dump(authoring, f, ensure_ascii=False, indent=1)
    for n in ("bark-neutral.png", "bark-oxblood.png", "broadleaf_cluster.png", "willow_strip.png"):
        p = os.path.join(TEXDIR, n)
        print(n, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
