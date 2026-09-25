#!/usr/bin/env python3
"""湖心亭交付对照联系表：4 张实机渲染（本模块）× 0010 推理图（主控复验 pass）。
推理图只作参照（lead QC：瓦色按灰瓦做，推理图偏蓝不照抄；生成图非史料）。
用法：python3 make-contact-sheet.py <rendersDir> <outJpg> [--before <beforeDir>] [--title <text>] [--row-names R1,R2]
  给 --before 时出三行：before（同机位）/ after / 0010 推理图。
每张渲染先过空白帧守卫（亮度 std < 2/255 或主色占比 > 95% 判空白，退出码 2），结果写 <outJpg>.guard.json。
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageStat

REF = Path('/home/baibai/outbox/pawborough-shanghai-reference-library-20260913/generated')
RENDERS = ['front', 'side', 'oblique', 'from-bridge']
REFS = ['PBR-SH-0010-G01.jpg', 'PBR-SH-0010-G02.jpg', 'PBR-SH-0010-G03.jpg', 'PBR-SH-0010-G05.jpg']
LABELS_R = {'front': 'front (bridge-side facade)', 'side': 'side (from west)',
            'oblique': 'oblique (aerial 3q)', 'from-bridge': 'from-bridge (eye level)'}

args = sys.argv[1:]
renders_dir = Path(args[0])
out = Path(args[1])
before_dir = Path(args[args.index('--before') + 1]) if '--before' in args else None
title = args[args.index('--title') + 1] if '--title' in args else \
    'huxin-ting (WP9) renders x 0010 inference refs  [grey tile per lead QC 0010 - blue in refs not copied; inference images are not historical evidence]'


def guard(path):
    img = Image.open(path).convert('RGB')
    std = ImageStat.Stat(img.convert('L')).stddev[0]
    small = img.resize((200, 125))
    cols = small.getcolors(200 * 125) or []
    dom = max(c for c, _ in cols) / (200 * 125) if cols else 1.0
    return dict(file=str(path), lumaStd255=round(std, 2), dominantShare=round(dom, 4), blank=bool(std < 2 or dom > 0.95))


# --row-names A,B：两行对照时的行名（缺省 before,after；R2 用 R1,R2）
row_names = args[args.index('--row-names') + 1].split(',') if '--row-names' in args else ['before', 'after']
rows = ([(row_names[0], before_dir)] if before_dir else []) + [(row_names[1] if before_dir else 'render', renders_dir)]
guards = [guard(d / f'{r}.jpg') for _, d in rows for r in RENDERS]
json.dump(guards, open(str(out) + '.guard.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if any(g['blank'] for g in guards):
    print('BLANK_FRAME', [g['file'] for g in guards if g['blank']])
    sys.exit(2)

CELL_W, CELL_H, LABEL_H, PAD = 800, 500, 34, 12
cols, nrows = 4, len(rows) + 1
W = cols * CELL_W + (cols + 1) * PAD
H = nrows * (CELL_H + LABEL_H) + (nrows + 1) * PAD + 56
sheet = Image.new('RGB', (W, H), (24, 24, 26))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
    title_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception:
    font = title_font = ImageFont.load_default()
draw.text((PAD, PAD), title, fill=(235, 235, 235), font=title_font)


def paste_fit(path, col, row, label):
    img = Image.open(path).convert('RGB')
    ratio = min(CELL_W / img.width, CELL_H / img.height)
    img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
    x = PAD + col * (CELL_W + PAD) + (CELL_W - img.width) // 2
    y = 56 + PAD + row * (CELL_H + LABEL_H + PAD) + (CELL_H - img.height) // 2
    sheet.paste(img, (x, y))
    ly = 56 + PAD + row * (CELL_H + LABEL_H + PAD) + CELL_H + 6
    draw.text((PAD + col * (CELL_W + PAD), ly), label, fill=(200, 200, 200), font=font)


for ri, (tag, d) in enumerate(rows):
    for i, r in enumerate(RENDERS):
        paste_fit(d / f'{r}.jpg', i, ri, f'{tag} / {LABELS_R[r]}')
for i, r in enumerate(REFS):
    paste_fit(REF / r, i, len(rows), f'ref / {r[:-4]} (inference, not evidence)')

out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, quality=90)
print('CONTACT_SHEET', out, sheet.size, 'guards ok', len(guards))
