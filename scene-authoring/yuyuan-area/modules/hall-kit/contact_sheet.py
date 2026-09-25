"""hall-kit 联系表：每栋一行 = 斜俯 before / after + 园内眼高 before / after（render_hall.py --compare 的输出）。
before = HALL_KIT=0 程序化体块，after = HALL_KIT=1 套件件，同机位同光照。图只写工单包 artifacts/，不进仓库。
用法：python3 -X utf8 modules/hall-kit/contact_sheet.py --dir <compare 图目录> --ids id1,id2 --out <sheet.png> [--title 文本]
需要 Pillow（系统 python3）。
"""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument('--dir', required=True)
ap.add_argument('--ids', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--title', default='')
ap.add_argument('--cols', default='oblique-before,oblique-after,garden-eye-before,garden-eye-after')
ap.add_argument('--cell', default='560x350')
a = ap.parse_args()
CW, CH = (int(v) for v in a.cell.split('x'))
LAYOUT = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
names = {o['id']: o.get('name') or '(无名)' for o in LAYOUT['objects']}
kinds = {o['id']: o.get('kind') for o in LAYOUT['objects']}


def font(sz):
    for p in ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


F, FS = font(22), font(16)
ids = [i for i in a.ids.split(',') if i]
cols = a.cols.split(',')
LH, TH = 30, 44 if a.title else 0
sheet = Image.new('RGB', (CW * len(cols), TH + 24 + len(ids) * (CH + LH)), (245, 244, 240))
d = ImageDraw.Draw(sheet)
if a.title:
    d.text((10, 8), a.title, fill=(20, 20, 20), font=F)
for c, col in enumerate(cols):
    d.text((c * CW + 8, TH + 3), col.replace('-before', '  before（程序化体块）').replace('-after', '  after（hall-kit）'), fill=(60, 60, 60), font=FS)
missing = []
for r, hid in enumerate(ids):
    y0 = TH + 24 + r * (CH + LH)
    d.text((8, y0 + 4), '%s  %s  [%s]' % (hid, names.get(hid, ''), kinds.get(hid, '')), fill=(10, 10, 10), font=F)
    for c, col in enumerate(cols):
        p = os.path.join(a.dir, '%s-%s.png' % (hid, col))
        if not os.path.exists(p):
            missing.append(p)
            continue
        im = Image.open(p).convert('RGB')
        im.thumbnail((CW - 4, CH - 4))
        sheet.paste(im, (c * CW + 2, y0 + LH))
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
sheet.save(a.out)
print('SHEET', a.out, sheet.size, 'missing', len(missing))
for m in missing:
    print('MISSING', m)
