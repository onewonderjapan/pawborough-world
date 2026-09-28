#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard：PV 预览帧联系表（给人看图用；图只写到工单包 artifacts/，不进仓库）。

  python3 scripts/pv-contact-sheet.py --frames <预览目录> --cameras <取样相机 json> --out <png>
          [--cols 3] [--thumb 426] [--shots id1,id2] [--channel beauty]

目录结构两种都认：<dir>/<shot>/frame-###.png（render-pv-preview.py）与
<dir>/<shot>/<channel>/frame-###.png（render-control-passes.py 四通道）。
每镜头一行（帧多于 --cols 时折行），行首标镜号 / id / 灯光 / 时长 / 取样对应的 24 fps 帧号。
"""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'


def font(sz):
    try:
        return ImageFont.truetype(FONT, sz)
    except OSError:
        return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True)
    ap.add_argument('--cameras', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cols', type=int, default=3)
    ap.add_argument('--thumb', type=int, default=426)
    ap.add_argument('--shots', default='')
    ap.add_argument('--channel', default='beauty')
    ap.add_argument('--title', default='')
    a = ap.parse_args()
    doc = json.load(open(a.cameras, encoding='utf-8'))
    shots = [s for s in doc['shots'] if not a.shots or s['id'] in a.shots.split(',')]
    tw = a.thumb
    th = tw * 9 // 16
    head = 26
    rows = []
    for s in shots:
        d = os.path.join(a.frames, s['id'])
        if os.path.isdir(os.path.join(d, a.channel)):
            d = os.path.join(d, a.channel)
        files = [os.path.join(d, 'frame-%03d.png' % k) for k in range(s['frames'])]
        files = [f for f in files if os.path.exists(f)]
        for i in range(0, max(1, len(files)), a.cols):
            rows.append((s, files[i:i + a.cols], i))
    W = a.cols * (tw + 6) + 6
    H = 40 + len(rows) * (th + head + 6)
    im = Image.new('RGB', (W, H), (24, 24, 24))
    dr = ImageDraw.Draw(im)
    dr.text((8, 8), a.title or ('PV 预览联系表 — %s' % os.path.basename(a.cameras)), fill=(230, 230, 230), font=font(18))
    y = 40
    f14 = font(14)
    for s, files, i0 in rows:
        src = s.get('sourceFrames') or list(range(s['frames']))
        label = '%02d %s  [%s / %s / %.1fs]  %s' % (s.get('no', 0), s['id'], s.get('status', '?'), s.get('light', '?'),
                                                    s.get('durationS', 0), s.get('title', ''))
        if i0:
            label = '   … %s（续）' % s['id']
        dr.text((8, y + 4), label, fill=(200, 220, 255), font=f14)
        x = 6
        for j, f in enumerate(files):
            t = Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS)
            im.paste(t, (x, y + head))
            dr.text((x + 4, y + head + 2), 'f%03d' % src[i0 + j], fill=(255, 255, 0), font=f14)
            x += tw + 6
        y += th + head + 6
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    im.save(a.out)
    print('contact sheet ->', a.out, im.size)


if __name__ == '__main__':
    main()
