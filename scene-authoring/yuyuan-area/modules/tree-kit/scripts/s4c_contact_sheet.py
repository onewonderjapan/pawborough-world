#!/usr/bin/env python3
"""Contact sheet: 6 variant GLBs, front + three-quarter, with zh/id/tris labels."""
import json
import os
import sys

from PIL import Image, ImageDraw

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.abspath(os.path.join(MODULE, os.pardir, os.pardir, "out-tree-kit"))
RDIR = os.path.join(OUT, "renders")

ZH = {"camphor": "樟", "willow": "柳", "osmanthus": "桂"}


def main():
    build = json.load(open(os.path.join(OUT, "build-report.json")))
    tris = {v["variant"]: v["tris"] for v in build["variants"]}
    variants = ["camphor-small", "camphor-large", "willow-small", "willow-large", "osmanthus-small", "osmanthus-large"]
    cell_w, cell_h, label_h = 560, 700, 46
    cols = 4
    rows = (len(variants) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (245, 245, 242))
    d = ImageDraw.Draw(sheet)
    from PIL import ImageFont
    font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", 22)
    for i, tag in enumerate(variants):
        col, row = i % cols, i // cols
        x0, y0 = col * cell_w, row * (cell_h + label_h)
        species = tag.rsplit("-", 1)[0]
        views = []
        for name in ("front", "threeq"):
            p = os.path.join(RDIR, f"{tag}-{name}.png")
            views.append(Image.open(p).convert("RGB").resize((cell_w // 2, cell_h)))
        sheet.paste(views[0], (x0, y0))
        sheet.paste(views[1], (x0 + cell_w // 2, y0))
        sp, size = tag.rsplit("-", 1)
        zh = ZH[sp]
        label = f"{zh} {tag}  ·  {tris[tag]} tris"
        d.rectangle([x0, y0 + cell_h, x0 + cell_w, y0 + cell_h + label_h], fill=(28, 30, 26))
        d.text((x0 + 12, y0 + cell_h + 10), label, fill=(240, 240, 230), font=font)
    out_path = os.path.join(RDIR, "contact-sheet.png")
    sheet.save(out_path)
    review_dir = os.path.join(MODULE, "review")
    os.makedirs(review_dir, exist_ok=True)
    small_path = os.path.join(review_dir, "contact-sheet.jpg")
    sheet.resize((sheet.width // 2, sheet.height // 2)).save(small_path, quality=86)
    print(out_path, os.path.getsize(out_path), "bytes")
    print(small_path, os.path.getsize(small_path), "bytes")


if __name__ == "__main__":
    main()
