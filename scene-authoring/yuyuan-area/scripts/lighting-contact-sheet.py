#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-lighting 联系表：行 × 列网格（同机位改前 / 各预设并排）。输出只写到 --out（工单包 artifacts/ 下），不进仓库。

用法：
  python3 scripts/lighting-contact-sheet.py --out <png> --title <标题> \\
      --rows sansuitang,huxinting --cols before,day,dusk,night \\
      --pattern '<目录>/{row}.{col}.png' [--row-labels 三穗堂,湖心亭] [--col-labels 改前,白天,黄昏,夜晚] [--cell 480x300]
  pattern 里 {row} / {col} 按行列名替换；缺图的格子画灰底「缺」。
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont


def font(size):
    for p in ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--rows', required=True)
    ap.add_argument('--cols', required=True)
    ap.add_argument('--pattern', required=True)
    ap.add_argument('--row-labels', default='')
    ap.add_argument('--col-labels', default='')
    ap.add_argument('--cell', default='480x300')
    a = ap.parse_args()
    rows, cols = a.rows.split(','), a.cols.split(',')
    rl = a.row_labels.split(',') if a.row_labels else rows
    cl = a.col_labels.split(',') if a.col_labels else cols
    cw, ch = (int(v) for v in a.cell.split('x'))
    left, top, pad = 150, 90 if a.title else 50, 8
    W = left + len(cols) * (cw + pad)
    H = top + len(rows) * (ch + pad)
    sheet = Image.new('RGB', (W, H), (245, 242, 235))
    d = ImageDraw.Draw(sheet)
    if a.title:
        d.text((12, 10), a.title, fill=(40, 36, 30), font=font(26))
    for j, c in enumerate(cl):
        d.text((left + j * (cw + pad) + 6, top - 34), c, fill=(40, 36, 30), font=font(22))
    for i, r in enumerate(rows):
        y = top + i * (ch + pad)
        d.text((10, y + ch // 2 - 14), rl[i], fill=(40, 36, 30), font=font(22))
        for j, c in enumerate(cols):
            x = left + j * (cw + pad)
            p = a.pattern.format(row=r, col=c)
            if os.path.exists(p):
                im = Image.open(p).convert('RGB')
                im.thumbnail((cw, ch))
                sheet.paste(im, (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
            else:
                d.rectangle((x, y, x + cw, y + ch), fill=(200, 200, 200))
                d.text((x + cw // 2 - 12, y + ch // 2 - 12), '缺', fill=(90, 90, 90), font=font(24))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sheet.save(a.out)
    print('contact sheet:', a.out, sheet.size)


if __name__ == '__main__':
    main()
