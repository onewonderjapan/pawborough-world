#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard P2：PV 动态样片（animatic）。

输入：render-pv-preview.py 按 `build-pv-shots.py --sample stride:2` 出的 12 fps Workbench 预览帧
      （<frames>/<shot>/frame-###.png）+ 同一份取样相机 json（镜号 / 意图 / 时长 / 灯光 / 转场）。
输出：<out>.mp4（H.264，yuv420p，12 fps，默认 640×360，无音轨）+ <out>.json（逐镜头起止时间码与所用帧）。

- 每镜头严格用 durationS × 输出fps 帧（取样列表的前 N 帧；stride 末尾补的收尾帧不用），总长 = 各镜时长之和；
- 每镜底部叠一行说明字幕：镜号 · 意图（中文短标题）· 时长 · 灯光标签 · 新 / 复用；右上角叠总时间码；
- 转场按 pv-shots.json 的 transitionIn / transitionOut 表现，标注帧数一律是 24 fps 口径，执行时按 输出fps/24 换算
  （12 fps 样片：fade-from-black 12f → 6 帧、fade-to-black 24f → 12 帧、dissolve 12f → 6 帧，切点两侧各 3 帧）；
  fade-from-black / fade-to-black 做黑场渐变；dissolve 做「定帧叠化」（切点前后各半与对方首 / 末帧交叉叠化），不改总时长；cut 直接切；
  相邻镜头的出场 / 入场转场类型与帧数不一致直接报错（修数据，不许静默只做半段）；
- 灯光标签只写在字幕里（预览是 Workbench 统一日光，dusk / night 的真实灯光由 wave11-lighting 预设提供）；
- 无音乐、无旁白（占位见 AI-HANDOFF.md）。

用法：python3 scripts/build-animatic.py --frames <dir> --cameras <cameras-12fps.json> --out <包>/artifacts/pv/animatic [--fps 12]
"""
import argparse
import json
import os
import re
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
ANNOTATED_FPS = 24   # pv-shots.json 转场标注帧数的口径

# 相邻镜头转场一致性（R1 审查必修2）：类型与帧数必须相同，否则只执行叠化半段
def transition_parts(t):
    m = re.match(r'^(fade-from-black|fade-to-black|dissolve|cut)\s*(\d+)\s*f\s*$', str(t).strip())
    if m:
        return m.group(1), int(m.group(2))
    return str(t).strip(), None


def check_adjacent_transitions(shots):
    bad = []
    for a, b in zip(shots, shots[1:]):
        ta, fa = transition_parts(a.get('transitionOut', 'cut'))
        tb, fb = transition_parts(b.get('transitionIn', 'cut'))
        if ta != tb or fa != fb:
            bad.append('%s 出场「%s」 vs %s 入场「%s」' % (a['id'], a.get('transitionOut'), b['id'], b.get('transitionIn')))
    if bad:
        raise SystemExit('相邻镜头转场不一致（出场与下一镜入场的类型和帧数必须相同）：\n  ' + '\n  '.join(bad))


def annot_frames(t):
    _, n = transition_parts(t)
    if not n:
        raise SystemExit('转场「%s」没有标注帧数（应为如「dissolve 12f」）' % t)
    return n


def tc(frames, fps):
    s = frames / fps
    return '%02d:%05.2f' % (int(s // 60), s % 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True)
    ap.add_argument('--cameras', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=640)
    ap.add_argument('--height', type=int, default=360)
    ap.add_argument('--fps', type=int, default=12)
    a = ap.parse_args()
    FPS = a.fps
    scale = FPS / ANNOTATED_FPS   # 24 fps 标注帧数 → 输出 fps
    doc = json.load(open(a.cameras, encoding='utf-8'))
    check_adjacent_transitions(doc['shots'])
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
        if transition_parts(tin)[0] == 'fade-from-black':
            m = min(n, max(1, round(annot_frames(tin) * scale)))
            for k in range(m):
                imgs[k] = Image.blend(black, imgs[k], (k + 1) / (m + 1))
        if transition_parts(tout)[0] == 'fade-to-black':
            m = min(n, max(1, round(annot_frames(tout) * scale)))
            for k in range(m):
                imgs[n - m + k] = Image.blend(imgs[n - m + k], black, (k + 1) / m)
        if transition_parts(tout)[0] == 'dissolve' and i + 1 < len(shots):
            half = max(1, round(annot_frames(tout) * scale) // 2)
            nxt = load(shots[i + 1][1][0])
            for k in range(half):
                alpha = (k + 1) / (2 * half + 1)
                imgs[n - half + k] = Image.blend(imgs[n - half + k], nxt, alpha)
        if transition_parts(tin)[0] == 'dissolve' and i > 0:
            half = max(1, round(annot_frames(tin) * scale) // 2)
            prv = load(shots[i - 1][1][-1])
            for k in range(half):
                alpha = (half + 1 + k) / (2 * half + 1)
                imgs[k] = Image.blend(prv, imgs[k], alpha)
        cap = '%02d  %s  ·  %.1f s  ·  %s  ·  %s' % (s['no'], s.get('title', s['id']), s['durationS'], s.get('light', '?'),
                                                    '新镜头' if s.get('status') == 'new' else '复用')
        for k, im in enumerate(imgs):
            d = ImageDraw.Draw(im, 'RGBA')
            d.rectangle([0, H - 26, W, H], fill=(0, 0, 0, 170))
            d.text((8, H - 23), cap, fill=(255, 255, 255, 255), font=f_cap)
            d.rectangle([W - 118, 0, W, 18], fill=(0, 0, 0, 150))
            d.text((W - 114, 2), '%s  %s' % (tc(t + k, FPS), s['id'][:4]), fill=(255, 230, 120, 255), font=f_tc)
            seq.append(im)
        log.append({'no': s['no'], 'id': s['id'], 'title': s.get('title'), 'light': s.get('light'), 'status': s.get('status'),
                    'durationS': s['durationS'], 'start': tc(t, FPS), 'end': tc(t + n, FPS), 'framesOutFps': n,
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
