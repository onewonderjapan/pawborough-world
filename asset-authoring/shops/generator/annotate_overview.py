"""Draw asset ID + variant name under each unit of the overview sheet."""
import json, sys
from PIL import Image, ImageDraw, ImageFont

png, layout_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
L = json.load(open(layout_path))
im = Image.open(png).convert('RGB')
d = ImageDraw.Draw(im)
f1 = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 30)
f2 = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 26)
names = {u['id']: u['name'] for u in json.load(open(sys.argv[4]))}
fpx = (L['resX'] / 2) / (18.0 / L['lens'])
scale = fpx / L['dist']
W, H = im.size
base = H - 96
d.line([(0, base - 52), (W, base - 52)], fill=(70, 70, 70), width=2)
for cx, uid in zip(L['unitCenterX'], [u['id'] for u in json.load(open(sys.argv[4]))]):
    px = W / 2 + cx * scale
    d.text((px, base - 40), uid, font=f1, fill=(25, 25, 25), anchor='ma')
    d.text((px, base + 2), names[uid], font=f2, fill=(60, 60, 60), anchor='ma')
im.save(out)
print('ANNOTATED', out)
