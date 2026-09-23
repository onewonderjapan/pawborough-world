#!/usr/bin/env python3
"""R1 before/after sheet: previous-delivery renders vs this build, same cameras.

Usage: python3 r1_before_after_sheet.py <out-tree-kit dir> <before renders dir>
Writes renders/before-after-sheet.png and review/before-after.jpg (<400 KB).
Before = renders shipped in pawborough-w1-tree-kit-20260922/artifacts/tree-kit;
After  = this build's renders (cameras pinned to the previous bounds, so the
two columns are directly comparable).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.abspath(os.path.join(MODULE, os.pardir, os.pardir, "out-tree-kit"))
BEFORE = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else "/home/baibai/outbox/pawborough-w1-tree-kit-20260922/artifacts/tree-kit/renders"
RDIR = os.path.join(OUT, "renders")

VARIANTS = ["willow-small", "willow-large", "osmanthus-small", "osmanthus-large", "camphor-small", "camphor-large"]
VIEWS = ["front", "threeq"]


def main():
    cell_w, cell_h, label_h, head_h = 280, 350, 34, 40
    sheet = Image.new("RGB", (2 * cell_w, head_h + len(VARIANTS) * (cell_h + label_h)), (245, 245, 242))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", 20)
    small = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", 16)
    d.text((cell_w // 2 - 40, 8), "before 上一版", fill=(60, 40, 40), font=font)
    d.text((cell_w + cell_w // 2 - 40, 8), "after 本版（R1）", fill=(30, 70, 30), font=font)
    for r, tag in enumerate(VARIANTS):
        y0 = head_h + r * (cell_h + label_h)
        for c, src in ((0, BEFORE), (1, RDIR)):
            views = [Image.open(os.path.join(src, f"{tag}-{v}.png")).convert("RGB").resize((cell_w // 2, cell_h)) for v in VIEWS]
            sheet.paste(views[0], (c * cell_w, y0))
            sheet.paste(views[1], (c * cell_w + cell_w // 2, y0))
        d.rectangle([0, y0 + cell_h, 2 * cell_w, y0 + cell_h + label_h], fill=(28, 30, 26))
        d.text((12, y0 + cell_h + 7), tag, fill=(240, 240, 230), font=small)
    out_full = os.path.join(RDIR, "before-after-sheet.png")
    sheet.save(out_full)
    os.makedirs(os.path.join(MODULE, "review"), exist_ok=True)
    out_small = os.path.join(MODULE, "review", "before-after.jpg")
    sheet.resize((sheet.width // 2, sheet.height // 2)).save(out_small, quality=86)
    print(out_full, os.path.getsize(out_full), "bytes")
    print(out_small, os.path.getsize(out_small), "bytes")


main()
