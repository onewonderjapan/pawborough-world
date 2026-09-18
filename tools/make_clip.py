#!/usr/bin/env python3
"""F5 — assemble clipA/clipB mp4 from rendered frames.

clipA gets the 2 s honesty title card (black bg, white text):
  Pawborough world v1.0 candidate - design reconstruction - not a historical record
ffmpeg: frames PNG -> libx264 crf 18 yuv420p. Partial flag when the rendered
frame count < planned.

Run: python3 tools/make_clip.py --clip a|b
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = str(Path.home() / '.local/bin/ffmpeg')

ap = argparse.ArgumentParser()
ap.add_argument('--clip', choices=['a', 'b'], required=True)
args = ap.parse_args()

if args.clip == 'a':
    frames = ROOT / 'artifacts/corridor-video/frames'
    pattern = str(frames / 'frame-%05d.png')
    out = ROOT / 'artifacts/corridor-video/clipA.mp4'
    log = ROOT / 'artifacts/corridor-video/render-log.json'
    planned = 6896
    fps = 24
    title = True
else:
    frames = ROOT / 'artifacts/corridor-video/frames-b'
    pattern = str(frames / 'frame-b-%05d.png')
    out = ROOT / 'artifacts/corridor-video/clipB.mp4'
    log = ROOT / 'artifacts/corridor-video/render-log-orbit.json'
    planned = 576
    fps = 24
    title = False

n = len(list(frames.glob('frame-*.png'))) if args.clip == 'a' else len(list(frames.glob('frame-b-*.png')))
partial = n < planned
print(f'frames={n}/{planned} partial={partial}')

if title:
    from PIL import Image, ImageDraw
    card = ROOT / 'artifacts/corridor-video/title-card.png'
    img = Image.new('RGB', (1280, 720), (0, 0, 0))
    d = ImageDraw.Draw(img)
    msg = 'Pawborough world v1.0 candidate'
    msg2 = 'design reconstruction - not a historical record'
    try:
        from PIL import ImageFont
        f1 = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 44)
        f2 = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 30)
    except Exception:
        f1 = f2 = None
    d.text((640, 330), msg, fill=(255, 255, 255), anchor='mm', font=f1)
    d.text((640, 395), msg2, fill=(200, 200, 200), anchor='mm', font=f2)
    img.save(card)
    title_in = ['-loop', '1', '-t', '2', '-i', str(card)]
    title_filter = '[0:v]fps=24,scale=1280:720[v0];'
    tail = ['-f', 'lavfi', '-t', '0.05', '-i', 'color=black:s=1280x720']
    # simpler: two inputs, concat via filter_complex
    cmd = [FFMPEG, '-y',
           *title_in,
           '-framerate', str(fps), '-i', pattern,
           '-filter_complex',
           f'{title_filter}[1:v]fps=24,scale=1280:720[v1];[v0][v1]concat=n=2:v=1:a=0,format=yuv420p[v]',
           '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
           '-movflags', '+faststart', str(out)]
else:
    cmd = [FFMPEG, '-y', '-framerate', str(fps), '-i', pattern,
           '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
           '-movflags', '+faststart', str(out)]

r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print('FFMPEG_FAIL', r.stderr[-800:])
    raise SystemExit(1)
meta = {'clip': out.name, 'framesRendered': n, 'framesPlanned': planned,
        'partial': partial, 'command': ' '.join(cmd[:6]) + ' ... (libx264 crf 18 yuv420p)'}
print(json.dumps(meta))
if log.exists():
    data = json.loads(log.read_text())
    data['mp4'] = meta
    log.write_text(json.dumps(data, indent=1))
print('CLIP_DONE', out.name)
