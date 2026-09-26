# wave7-outerkit 联系表拼图：contact-shots.mjs 各 TAG 的同机位截图 → 航拍表 / 街道眼高表（行 = 样板，列 = TAG）。
# 输出只写到工单包 artifacts/（仓库公开，不收图片）。
# 用法：python3 -X utf8 modules/outer-kit/contact-sheet.py <shotdir> <outdir> before,tex[,geo,proc]
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
shotdir, outdir, tags = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
REG = json.load(open(os.path.join(ROOT, 'modules', 'outer-kit', 'ids.json'), encoding='utf-8'))
# IDS=review12 → wave8 全铺开复查代表点（ids.json review12，行标签带选取理由）；缺省 = wave7 样板 ids
ids = [r['id'] for r in REG['review12']] if os.environ.get('IDS') == 'review12' else REG['ids']
WHY = {r['id']: r['why'] for r in REG.get('review12', [])} if os.environ.get('IDS') == 'review12' else {}
W, H, LBL = 480, 300, 22
TITLES = {'before': 'before: beige box (OUTER_KIT off)', 'tex': 'tex: geometry + shared atlas', 'after': 'after: 301-building kit rollout (default)', 'geo': 'geo: pure geometry', 'proc': 'proc: runtime shader'}
try:
    font = ImageFont.load_default(size=16)
except TypeError:
    font = ImageFont.load_default()

def sheet(kind, rows, name):
    img = Image.new('RGB', (W * len(tags), LBL + (H + LBL) * len(rows)), (245, 243, 238))
    d = ImageDraw.Draw(img)
    for j, t in enumerate(tags):
        d.text((j * W + 6, 3), TITLES.get(t, t), fill=(20, 20, 20), font=font)
    for i, (rid, stem) in enumerate(rows):
        y = LBL + i * (H + LBL)
        d.text((6, y + 3), rid, fill=(20, 20, 20), font=font)
        for j, t in enumerate(tags):
            p = os.path.join(shotdir, f'{t}-{stem}.png')
            if os.path.exists(p):
                img.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (j * W, y + LBL))
            else:
                d.text((j * W + 10, y + LBL + 10), 'no shot (no clear eye-level camera)', fill=(160, 40, 40), font=font)
    out = os.path.join(outdir, name)
    img.save(out, 'JPEG', quality=85)
    print(out, img.size)

os.makedirs(outdir, exist_ok=True)
suffix = '' if tags in (['before', 'tex'], ['before', 'after']) else '-' + '-'.join(tags)
lab = lambda i: (i + '  ' + WHY[i]) if i in WHY else i
sheet('aerial', [(lab(i) + '  aerial', f'{i}-aerial') for i in ids] + [('overview A', 'overview-a'), ('overview B', 'overview-b')], f'contact-aerial{suffix}.jpg')
sheet('street', [(lab(i) + '  street eye 1.6 m', f'{i}-street') for i in ids], f'contact-street{suffix}.jpg')
