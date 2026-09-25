#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""控制层新旧联系表（wave5-shots2）：每镜头一张 PNG。

  上半：beauty 8 帧缩略（帧号均匀取 0..N-1），旧一行、新一行；
  下半：终帧四通道（beauty / depth / normal / segmentation），旧一行、新一行。
  depth 是 16-bit，按帧内非背景（< 65535）像素的 min–max 拉伸成 8-bit 灰度显示（背景 = 白）；其余通道原样缩放。
  旧目录缺该镜头时只画「新」两行。输出只写到 --out（工单包 artifacts/ 下），不进仓库。

用法：python3 scripts/control-contact-sheet.py --new <control目录> [--old <control目录>] --out <目录>
        [--shots id1,id2] [--old-label 草稿] [--new-label 定稿] [--prefix old-vs-new-]
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TW, TH = 240, 135          # 8 帧缩略
CW, CH = 480, 270          # 终帧四通道
PAD = 22
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')


def font(size):
    for p in ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def load(path, ch):
    img = Image.open(path)
    if ch == 'depth':
        a = np.asarray(img).astype(np.float64)
        fg = a < 65535
        out = np.full(a.shape, 255, np.uint8)
        if fg.any():
            lo, hi = a[fg].min(), a[fg].max()
            out[fg] = np.clip((a[fg] - lo) / max(hi - lo, 1) * 230, 0, 230).astype(np.uint8)
        return Image.fromarray(out).convert('RGB')
    return img.convert('RGB')


def frames_of(d, sid, ch='beauty'):
    return sorted(glob.glob(os.path.join(d, sid, ch, 'frame-*.png')))


def sheet(sid, new_dir, old_dir, out, labels, prefix):
    f_new = frames_of(new_dir, sid)
    f_old = frames_of(old_dir, sid) if old_dir else []
    if not f_new:
        return None
    rows = [(labels[1], new_dir, f_new)]
    if f_old:
        rows.insert(0, (labels[0], old_dir, f_old))
    W = 8 * TW
    H = PAD + len(rows) * (PAD + TH) + len(rows) * (PAD + CH)
    im = Image.new('RGB', (W, H), 'white')
    dr = ImageDraw.Draw(im)
    fb, fs = font(16), font(13)
    dr.text((6, 2), '%s — beauty 8 帧 + 终帧四通道（%s）' % (sid, ' / '.join(r[0] for r in rows)), fill='black', font=fb)
    y = PAD
    for label, d, fr in rows:
        n = len(fr)
        idx = sorted(set(round(k * (n - 1) / 7) for k in range(8)))
        dr.text((6, y + 3), '%s  frames %s' % (label, ' '.join('%02d' % i for i in idx)), fill='black', font=fs)
        y += PAD
        for j, i in enumerate(idx):
            im.paste(Image.open(fr[i]).convert('RGB').resize((TW, TH), Image.LANCZOS), (j * TW, y))
        y += TH
    for label, d, fr in rows:
        last = os.path.basename(fr[-1])
        dr.text((6, y + 3), '%s  %s  beauty / depth / normal / segmentation' % (label, last), fill='black', font=fs)
        y += PAD
        for j, ch in enumerate(CHANNELS):
            p = os.path.join(d, sid, ch, last)
            if os.path.exists(p):
                resample = Image.NEAREST if ch == 'segmentation' else Image.LANCZOS
                im.paste(load(p, ch).resize((CW, CH), resample), (j * CW, y))
        y += CH
    path = os.path.join(out, '%s%s.png' % (prefix, sid))
    im.save(path, optimize=True)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--new', required=True)
    ap.add_argument('--old', default='')
    ap.add_argument('--out', required=True)
    ap.add_argument('--shots', default='')
    ap.add_argument('--old-label', default='old')
    ap.add_argument('--new-label', default='new')
    ap.add_argument('--prefix', default='old-vs-new-')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    shots = a.shots.split(',') if a.shots else sorted(
        x for x in os.listdir(a.new) if os.path.isdir(os.path.join(a.new, x)))
    for sid in shots:
        p = sheet(sid, a.new, a.old, a.out, (a.old_label, a.new_label), a.prefix)
        print(p or 'skip %s (no frames)' % sid)


if __name__ == '__main__':
    main()
