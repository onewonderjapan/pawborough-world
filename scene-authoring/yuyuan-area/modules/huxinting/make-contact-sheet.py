#!/usr/bin/env python3
"""湖心亭交付对照联系表：4 张实机渲染（本模块）× 0010 推理图（主控复验 pass）。
推理图只作参照（lead QC：瓦色按灰瓦做，推理图偏蓝不照抄；生成图非史料）。
用法：python3 make-contact-sheet.py <rendersDir> <outJpg>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REF = Path('/home/baibai/outbox/pawborough-shanghai-reference-library-20260913/generated')
RENDERS = ['front', 'side', 'oblique', 'from-bridge']
REFS = ['PBR-SH-0010-G01.jpg', 'PBR-SH-0010-G02.jpg', 'PBR-SH-0010-G03.jpg', 'PBR-SH-0010-G05.jpg']
LABELS_R = {'front': 'render / front (bridge-side facade)', 'side': 'render / side (from west)',
            'oblique': 'render / oblique (aerial 3q)', 'from-bridge': 'render / from-bridge (eye level)'}
LABELS_REF = {'PBR-SH-0010-G01.jpg': 'ref / 0010-G01 (inference, not evidence)',
              'PBR-SH-0010-G02.jpg': 'ref / 0010-G02 (inference, not evidence)',
              'PBR-SH-0010-G03.jpg': 'ref / 0010-G03 (inference, not evidence)',
              'PBR-SH-0010-G05.jpg': 'ref / 0010-G05 (inference, not evidence)'}

renders_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
CELL_W, CELL_H, LABEL_H, PAD = 800, 500, 34, 12
cols, rows = 4, 2
W = cols * CELL_W + (cols + 1) * PAD
H = rows * (CELL_H + LABEL_H) + (rows + 1) * PAD + 56
sheet = Image.new('RGB', (W, H), (24, 24, 26))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
    title_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception:
    font = title_font = ImageFont.load_default()

draw.text((PAD, PAD), 'huxin-ting (WP9) renders x 0010 inference refs  [grey tile per lead QC 0010 - blue in refs not copied; inference images are not historical evidence]',
          fill=(235, 235, 235), font=title_font)

def paste_fit(path, col, row, label):
    img = Image.open(path).convert('RGB')
    ratio = min(CELL_W / img.width, CELL_H / img.height)
    img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
    x = PAD + col * (CELL_W + PAD) + (CELL_W - img.width) // 2
    y = 56 + PAD + row * (CELL_H + LABEL_H + PAD) + (CELL_H - img.height) // 2
    sheet.paste(img, (x, y))
    ly = 56 + PAD + row * (CELL_H + LABEL_H + PAD) + CELL_H + 6
    draw.text((PAD + col * (CELL_W + PAD), ly), label, fill=(200, 200, 200), font=font)

for i, r in enumerate(RENDERS):
    paste_fit(renders_dir / f'{r}.jpg', i, 0, LABELS_R[r])
for i, r in enumerate(REFS):
    paste_fit(REF / r, i, 1, LABELS_REF[r])

out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, quality=90)
print('CONTACT_SHEET', out, sheet.size)
