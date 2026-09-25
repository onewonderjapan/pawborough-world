"""bazaar-tower-kit 联系表：同机位「程序化体块 / 套件模块」（或 before / after）两列 × 四机位，图只进工单包。

用法：python3 -X utf8 modules/bazaar-tower-kit/contact_sheet.py --left <dir> --right <dir> --out <jpg>
      [--labels 'procedural bazaarBlock,bazaar-tower-kit'] [--title '...'] [--cams front,aerial-3q,back,street-eye]
两个目录里是 render_tower.py 出的同名 JPEG（front.jpg …）。标签只用 ASCII（PIL 默认字体）。
"""
import os, sys
from PIL import Image, ImageDraw

ARGS = sys.argv[1:]
def arg(flag, default=None):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

left, right, out = arg('--left'), arg('--right'), arg('--out')
labels = arg('--labels', 'procedural bazaarBlock,bazaar-tower-kit').split(',')
cams = arg('--cams', 'front,aerial-3q,back,street-eye').split(',')
title = arg('--title', '')
W, H, PAD, TOP = 800, 500, 6, 34
sheet = Image.new('RGB', (2 * W + 3 * PAD, TOP + len(cams) * (H + PAD + 16) + PAD), (245, 244, 240))
d = ImageDraw.Draw(sheet)
d.text((PAD, 8), title, fill=(20, 20, 20))
d.text((PAD, 22), labels[0], fill=(90, 40, 30))
d.text((2 * PAD + W, 22), labels[1], fill=(90, 40, 30))
for i, c in enumerate(cams):
    y = TOP + i * (H + PAD + 16)
    d.text((PAD, y), c, fill=(60, 60, 60))
    for j, src in enumerate((left, right)):
        p = os.path.join(src, c + '.jpg')
        if os.path.exists(p):
            sheet.paste(Image.open(p).convert('RGB').resize((W, H)), (PAD + j * (W + PAD), y + 14))
        else:
            d.text((PAD + j * (W + PAD) + 20, y + 40), 'missing ' + p, fill=(200, 0, 0))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
sheet.save(out, quality=88)
print('CONTACT_SHEET', out, sheet.size)
