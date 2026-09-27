#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard P2：PV 动态样片（animatic）。

输入：render-pv-preview.py 按 `build-pv-shots.py --sample stride:2` 出的 12 fps Workbench 预览帧
      （<frames>/<shot>/frame-###.png）+ 同一份取样相机 json（镜号 / 意图 / 时长 / 灯光 / 转场）。
输出：<out>.mp4（H.264，yuv420p，12 fps，默认 640×360，无音轨）+ <out>.json（逐镜头起止时间码与所用帧）。

- 每镜头严格用 durationS × 12 帧（取样列表的前 N 帧；stride 末尾补的收尾帧不用），总长 = 各镜时长之和；
- 每镜底部叠一行说明字幕：镜号 · 意图（中文短标题）· 时长 · 灯光标签 · 新 / 复用；右上角叠总时间码；
- 转场按 pv-shots.json 的 transitionIn / transitionOut 表现：fade-from-black / fade-to-black 做黑场渐变；
  dissolve 做「定帧叠化」（切点前后各 3 帧与对方首 / 末帧交叉叠化），不改总时长；cut 直接切；
- 灯光标签只写在字幕里（预览是 Workbench 统一日光，dusk / night 的真实灯光由 wave11-lighting 预设提供）；
- 无音乐、无旁白（占位见 AI-HANDOFF.md）。

用法：python3 scripts/build-animatic.py --frames <dir> --cameras <cameras-12fps.json> --out <包>/artifacts/pv/animatic
"""
import argparse
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FPS = 12
DISSOLVE_HALF = 3   # 12f@24fps = 6 帧@12fps，切点两侧各 3 帧


def tc(frames):
    s = frames / FPS
    return '%02d:%05.2f' % (int(s // 60), s % 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True)
    ap.add_argument('--cameras', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=640)
    ap.add_argument('--height', type=int, default=360)
    a = ap.parse_args()
    doc = json.load(open(a.cameras, encoding='utf-8'))
    W, H = a.width, a.height
    f_cap = ImageFont.truetype(FONT, 15)
    f_tc = ImageFont.truetype(FONT, 12)

    shots = []
    for s in doc['shots']:
        n = int(round(s['durationS'] * FPS))
        files = [os.path.join(a.frames, s['id'], 'frame-%03d.png' % k) for k in range(n)]
        missing = [f for f in files if not os.path.exists(f)]
        if missing:
            raise SystemExit('缺预览帧：%s 等 %d 张' % (missing[0], len(missing)))
        shots.append((s, files))

    def load(f):
        return Image.open(f).convert('RGB').resize((W, H), Image.LANCZOS)

    black = Image.new('RGB', (W, H), (0, 0, 0))
    seq, log, t = [], [], 0
    for i, (s, files) in enumerate(shots):
        imgs = [load(f) for f in files]
        n = len(imgs)
        tin, tout = s.get('transitionIn', 'cut'), s.get('transitionOut', 'cut')
        if tin.startswith('fade-from-black'):
            m = min(n, 12)
            for k in range(m):
                imgs[k] = Image.blend(black, imgs[k], (k + 1) / (m + 1))
        if tout.startswith('fade-to-black'):
            m = min(n, 24)
            for k in range(m):
                imgs[n - m + k] = Image.blend(imgs[n - m + k], black, (k + 1) / m)
        if tout.startswith('dissolve') and i + 1 < len(shots):
            nxt = load(shots[i + 1][1][0])
            for k in range(DISSOLVE_HALF):
                alpha = (k + 1) / (2 * DISSOLVE_HALF + 1)
                imgs[n - DISSOLVE_HALF + k] = Image.blend(imgs[n - DISSOLVE_HALF + k], nxt, alpha)
        if tin.startswith('dissolve') and i > 0:
            prv = load(shots[i - 1][1][-1])
            for k in range(DISSOLVE_HALF):
                alpha = (DISSOLVE_HALF + 1 + k) / (2 * DISSOLVE_HALF + 1)
                imgs[k] = Image.blend(prv, imgs[k], alpha)
        cap = '%02d  %s  ·  %.1f s  ·  %s  ·  %s' % (s['no'], s.get('title', s['id']), s['durationS'], s.get('light', '?'),
                                                    '新镜头' if s.get('status') == 'new' else '复用')
        for k, im in enumerate(imgs):
            d = ImageDraw.Draw(im, 'RGBA')
            d.rectangle([0, H - 26, W, H], fill=(0, 0, 0, 170))
            d.text((8, H - 23), cap, fill=(255, 255, 255, 255), font=f_cap)
            d.rectangle([W - 118, 0, W, 18], fill=(0, 0, 0, 150))
            d.text((W - 114, 2), '%s  %s' % (tc(t + k), s['id'][:4]), fill=(255, 230, 120, 255), font=f_tc)
            seq.append(im)
        log.append({'no': s['no'], 'id': s['id'], 'title': s.get('title'), 'light': s.get('light'), 'status': s.get('status'),
                    'durationS': s['durationS'], 'start': tc(t), 'end': tc(t + n), 'frames12fps': n,
                    'sourceFrames24fps': (s.get('sourceFrames') or [])[:n], 'transitionIn': tin, 'transitionOut': tout})
        t += n
    out_mp4 = a.out + '.mp4'
    with tempfile.TemporaryDirectory() as td:
        for k, im in enumerate(seq):
            im.save(os.path.join(td, 'f%05d.png' % k))
        subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(td, 'f%05d.png'),
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-r', str(FPS), '-an', '-movflags', '+faststart', out_mp4],
                       check=True)
    meta = {'mp4': out_mp4, 'fps': FPS, 'width': W, 'height': H, 'frames': len(seq), 'durationS': len(seq) / FPS,
            'audio': 'none（音乐 / 旁白只留占位，见 AI-HANDOFF.md）', 'cameras': a.cameras, 'shots': log}
    with open(a.out + '.json', 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('animatic -> %s  %d frames  %.2f s  %dx%d @%d fps' % (out_mp4, len(seq), len(seq) / FPS, W, H, FPS))


if __name__ == '__main__':
    main()
