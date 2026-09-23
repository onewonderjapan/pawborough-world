"""Contact sheet assembler + blank-frame guard (system python3 + PIL).

Guard (DESIGN_SPEC.commonRules): a view is BLANK when luminance std < 2/255 or
the dominant colour exceeds 95% — any blank view fails the whole run (exit 2).

Outputs:
  <out>/renders/contact-sheet.png        1920-wide grid, zh/id/tris labels
  records/review/contact-sheet.jpg       committed review copy (<=400 KB)
  records/review/<id>.jpg                per-item front+three-quarter pair

Run:
  python3 -X utf8 make_contact_sheet.py \
      --out ../../out-street-furniture --config ../../../../kit/props2.config.json \
      --review records/review
"""
import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ZH = {
    'street-lamp-1990': '1990年代路灯',
    'post-box-green': '邮政绿邮筒',
    'phone-booth-ic': 'IC卡电话亭',
    'trash-bin-concrete': '混凝土果皮箱',
    'fire-hydrant': '消火栓',
    'utility-pole': '电线杆·变压器',
    'news-kiosk': '报刊亭',
    'bus-stop-sign': '公交站牌·空白牌面',
    'planter-box': '花坛·绿篱',
    'bike-rack': '自行车停放架',
}
FONT_PATH = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'

p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--config', type=Path, required=True)
p.add_argument('--review', type=Path, required=True)
a = p.parse_args()

cfg = json.loads(a.config.read_text(encoding='utf-8'))
catalog = json.loads((a.out / 'props.catalog.json').read_text(encoding='utf-8'))
renders = a.out / 'renders'
a.review.mkdir(parents=True, exist_ok=True)

font_label = ImageFont.truetype(FONT_PATH, 22)
font_small = ImageFont.truetype(FONT_PATH, 15)


def guard(img, name):
    """Blank-frame guard: luminance std < 2/255 or dominant colour > 95%."""
    g = img.convert('L')
    hist = g.histogram()
    n = sum(hist)
    mean = sum(i * c for i, c in enumerate(hist)) / n
    std = (sum((i - mean) ** 2 * c for i, c in enumerate(hist)) / n) ** 0.5
    dominant = max(hist) / n
    blank = std * 255 < 2.0 or dominant > 0.95
    print(f'  guard {name}: std={std * 255:.2f}/255 dominant={dominant * 100:.1f}% '
          f'-> {"BLANK" if blank else "ok"}')
    return blank


CELL, LABEL, COLS = 480, 46, 4  # 2 items per row x 2 views x 480 = 1920 wide
items = cfg['items']
rows = math.ceil(len(items) / (COLS // 2))
sheet = Image.new('RGB', (COLS * CELL, rows * (CELL + LABEL)), (24, 24, 26))
draw = ImageDraw.Draw(sheet)

blanks, tile = [], 0
for item in items:
    item_id = item['id']
    views = {}
    for view in ('front', 'three-quarter'):
        path = renders / f'{item_id}-{view}.png'
        if not path.exists():
            print(f'FAIL missing render {path}')
            sys.exit(3)
        img = Image.open(path).convert('RGB').resize((CELL, CELL), Image.LANCZOS)
        if guard(img, f'{item_id}-{view}'):
            blanks.append(f'{item_id}-{view}')
        views[view] = img
    # per-item review pair
    pair = Image.new('RGB', (CELL * 2, CELL), (24, 24, 26))
    pair.paste(views['front'], (0, 0))
    pair.paste(views['three-quarter'], (CELL, 0))
    pair.save(a.review / f'{item_id}.jpg', quality=85)
    # sheet tiles: front + three-quarter side by side per item
    cx = (tile % (COLS // 2)) * CELL * 2
    cy = (tile // (COLS // 2)) * (CELL + LABEL)
    sheet.paste(views['front'], (cx, cy))
    sheet.paste(views['three-quarter'], (cx + CELL, cy))
    tris = catalog['items'][item_id]['triangles']
    label = f"{ZH[item_id]}  {item_id}  tris={tris}"
    draw.rectangle([cx, cy + CELL, cx + CELL * 2, cy + CELL + LABEL], fill=(24, 24, 26))
    draw.text((cx + 10, cy + CELL + 6), label, font=font_label, fill=(235, 233, 228))
    tile += 1

if blanks:
    print('BLANK_FRAME_FAIL:', ', '.join(blanks))
    sys.exit(2)

sheet.save(renders / 'contact-sheet.png')
# committed review copy, kept <=400 KB
q = 88
while q >= 60:
    sheet.save(a.review / 'contact-sheet.jpg', quality=q)
    size = (a.review / 'contact-sheet.jpg').stat().st_size
    if size <= 400 * 1024:
        break
    q -= 6
print(f'CONTACT_SHEET_OK {sheet.size[0]}x{sheet.size[1]} review_jpg='
      f'{(a.review / "contact-sheet.jpg").stat().st_size}B quality={q}')
