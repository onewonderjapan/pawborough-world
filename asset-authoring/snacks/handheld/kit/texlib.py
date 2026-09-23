"""Analytic textures for the handheld snack batch (system python3, PIL+numpy).
No photo tracing; labels typeset with system font. Outputs to kit/textures/.
1024^2 only for the bean atlas + bean wrinkle normal; 512^2 for bread/paper maps
(keeps total encoded texture bytes across all 27 GLBs under the 6 MB cap)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np, json

OUT = Path(__file__).resolve().parent / 'textures'
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(2077)


def noise(N, scale, amp):
    small = rng.normal(0, 1, (scale, scale))
    return np.kron(small, np.ones((N // scale, N // scale))) * amp


def save(name, img, q=90):
    Image.fromarray(np.uint8(np.clip(img, 0, 255))).save(OUT / name, quality=q)
    print('wrote', name)


def flecks(img, xx, yy, count, rx, ry, color, margin=.1):
    for _ in range(count):
        cx, cy = rng.uniform(margin, 1 - margin, 2)
        a = rng.uniform(0, np.pi)
        m = ((((xx - cx) * np.cos(a) + (yy - cy) * np.sin(a)) / rx) ** 2 +
             (((yy - cy) * np.cos(a) - (xx - cx) * np.sin(a)) / ry) ** 2) < 1
        img[m] = color


# ---- bread maps 512 ------------------------------------------------------
N = 512
yy, xx = np.mgrid[0:N, 0:N] / N
base = np.stack([205, 140, 60], 0)[:, None, None] * (1 + noise(N, 16, .08) + noise(N, 64, .05))[None]
save('fried-crust.jpg', base.transpose(1, 2, 0))

img = np.stack([214, 158, 84], 0)[:, None, None] * (1 + noise(N, 32, .06))[None]
img = img.transpose(1, 2, 0).copy()
rr = np.hypot(xx - .5, yy - .5)
img[rr > .47] = [196, 140, 70]
flecks(img, xx, yy, 150, .03, .017, [242, 232, 205], .12)
save('sesame-top.jpg', img)

img = np.stack([222, 178, 104], 0)[:, None, None] * (1 + noise(N, 32, .07))[None]
img = img.transpose(1, 2, 0).copy()
for _ in range(12):
    cx, cy = rng.uniform(.15, .85, 2)
    m = np.hypot(xx - cx, yy - cy) < rng.uniform(.04, .08)
    img[m] = img[m] * .72
flecks(img, xx, yy, 55, .02, .011, [92, 138, 58], .1)
save('scallion-pancake.jpg', img)

# shengjian top: golden crust + sesame ovals + green scallion flecks
img = np.stack([214, 150, 74], 0)[:, None, None] * (1 + noise(N, 32, .07))[None]
img = img.transpose(1, 2, 0).copy()
flecks(img, xx, yy, 90, .028, .016, [242, 232, 205], .12)
flecks(img, xx, yy, 45, .018, .01, [92, 138, 58], .12)
save('sesame-scallion.jpg', img)

# osmanthus soup + bean mass (reused for LOD1 jar bean-mass lathe)
img = np.stack([232, 205, 150], 0)[:, None, None] * (1 + noise(N, 64, .03))[None]
img = img.transpose(1, 2, 0).copy()
flecks(img, xx, yy, 80, .009, .006, [230, 150, 50], .05)
save('osmanthus-soup.jpg', img)

img = np.stack([92, 60, 36], 0)[:, None, None] * (1 + noise(N, 16, .10) + noise(N, 64, .12))[None]
img = img.transpose(1, 2, 0).copy()
for _ in range(450):
    cx, cy = rng.uniform(0, 1, 2)
    m = np.hypot(xx - cx, yy - cy) < .025
    img[m] = img[m] * rng.uniform(.8, 1.25)
save('bean-mass.jpg', img)

# ---- label atlas (same 4 rows as baseline for continuity) ----------------
font = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'
atlas = Image.new('RGB', (512, 512), (238, 226, 196))
d = ImageDraw.Draw(atlas)
rows = [('奶油五香豆', (170, 30, 30), (238, 226, 196)), ('梨膏糖', (40, 60, 110), (240, 230, 200)),
        ('城隍廟 特產', (120, 30, 30), (236, 220, 180)), ('老城隍廟', (200, 160, 60), (120, 26, 26))]
for i, (t, fg, bg) in enumerate(rows):
    y = i * 128
    d.rectangle((0, y, 512, y + 128), fill=bg)
    d.rectangle((8, y + 8, 503, y + 119), outline=fg, width=4)
    f = ImageFont.truetype(font, 86 if len(t) <= 4 else 72, index=2)
    bb = d.textbbox((0, 0), t, font=f)
    d.text(((512 - (bb[2] - bb[0])) / 2 - bb[0], y + (128 - (bb[3] - bb[1])) / 2 - bb[1]), t, font=f, fill=fg)
atlas.save(OUT / 'labels-atlas.png')
print('wrote labels-atlas.png')

# ---- bean colour atlas 1024: 2 cols x 3 rows, one cell per variant -------
# cell content: skin base + mottling, frost patches (coverage 30..70%), dark hilum band
# hilum at u=0.25 (variants 0,2,4) or u=0.75 (variants 1,3,5) within the cell.
SN = 1024
cell = SN // 2
aye, axx = np.mgrid[0:SN, 0:SN] / SN
cu = (axx * 2) % 1.0            # u within cell (cell width = 0.5 in atlas u)
cv = (aye * 3) % 1.0            # v within cell
atlas_b = np.zeros((SN, SN, 3), np.float32)
skin = np.array([122, 90, 60], np.float32)
frost = np.array([233, 226, 211], np.float32)
hilum = np.array([42, 28, 20], np.float32)
coverages = [0.30, 0.38, 0.46, 0.54, 0.62, 0.70]
for row in range(3):
    for col in range(2):
        k = row * 2 + col
        u0, v0 = col * .5, row / 3
        sel_u = (aye >= v0) & (aye < v0 + 1 / 3) & (axx >= u0) & (axx < u0 + .5)
        uu = (axx[sel_u] - u0) * 2
        vv = (aye[sel_u] - v0) * 3
        patch = np.tile(skin, (uu.size, 1))
        patch *= (1 + rng.normal(0, .05, (uu.size, 1)))
        # fine mottle: smooth interpolated noise (no blocky kron)
        w1 = rng.normal(0, 1, (10, 10))
        wi = Image.fromarray(np.uint8((w1 - w1.min()) / (np.ptp(w1) + 1e-9) * 255)).resize((cell, cell), Image.BICUBIC)
        mott = (np.asarray(wi, np.float32) / 255 - .5)
        patch *= (1 + mott.ravel()[:uu.size][:, None] * .16)
        # frost: blotchy coverage mask via smoothed noise threshold
        g = rng.normal(0, 1, (14, 14))
        gi = Image.fromarray(np.uint8((g - g.min()) / (np.ptp(g) + 1e-9) * 255)).resize((cell, cell), Image.BICUBIC)
        g = np.asarray(gi, np.float32) / 255
        g = g.ravel()[:uu.size]
        thr = np.quantile(g, 1 - coverages[k])
        fm = g >= thr
        # frost stronger toward the flattened faces (v away from equator 0.5)
        edge_w = np.abs(vv - .5) * 2
        fm &= (rng.random(uu.size) < .25 + .75 * edge_w)
        patch[fm] = patch[fm] * .35 + frost * .65
        # hilum: dark band at fixed u, spanning v 0.28..0.72
        hu = 0.25 if k % 2 == 0 else 0.75
        hm = (np.abs(uu - hu) < .048) & (vv > .28) & (vv < .72)
        patch[hm] = patch[hm] * .25 + hilum * .75
        atlas_b[sel_u] = patch
save('bean-colour-atlas.jpg', atlas_b, q=92)

# ---- bean wrinkle normal map 1024 (full bean UV, shared by all variants) --
# broad-bean skin: fine net of elongated wrinkles along the long axis.
u = axx * 2 * np.pi          # azimuth 0..2pi
v = aye * np.pi              # latitude 0..pi
h = np.zeros((SN, SN), np.float32)
for f, amp, ph in ((90, .5, 0), (137, .3, 1.7), (61, .25, .6)):
    h += amp * np.sin(u * f * .5 + ph + 2.2 * np.sin(v * 3)) * np.cos(v * f * .33 + ph)
h += rng.normal(0, 1, (SN // 8, SN // 8)).repeat(8, 0).repeat(8, 1)[:SN, :SN] * .35
# gentle blur
for _ in range(1):
    h = (np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1) + 4 * h) / 8
gy, gx = np.gradient(h)      # gx ~ d/du, gy ~ d/dv
strength = 1.6
nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([(nx / ln * .5 + .5), (ny / ln * .5 + .5), (nz / ln * .5 + .5)], -1)
save('bean-wrinkle-normal.jpg', normal * 255, q=95)

(OUT.parent / 'texture-authoring.json').write_text(json.dumps({
    'textures': 'analytic numpy/PIL food + paper surfaces; labels typeset Noto Serif CJK; bean atlas 2x3 cells (one per variant, frost 30-70%, per-variant hilum side); wrinkle normal analytic (fallback-2 route, recorded); no photo tracing',
    'beanFrostCoverage': coverages}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('TEXLIB_DONE')
