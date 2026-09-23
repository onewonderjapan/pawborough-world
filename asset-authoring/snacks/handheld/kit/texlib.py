"""Analytic textures for the handheld snack batch (system python3, PIL+numpy).
No photo tracing; labels typeset with system font. Outputs to kit/textures/.
1024^2 only for the bean atlas + bean wrinkle normal; 512^2 for bread/paper maps
(keeps total encoded texture bytes across all 27 GLBs under the 6 MB cap)."""
from pathlib import Path
from math import pi
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

# scallion-pancake top (R1 #3): 4-6 scorch spots (was 12), scallion flecks doubled to 110.
# The folded pancake's top cap samples u .0-.96 / v 0-.48 of this map, so the scorch spots
# are biased into that window to guarantee 4-6 visible on the top face.
img = np.stack([222, 178, 104], 0)[:, None, None] * (1 + noise(N, 32, .07))[None]
img = img.transpose(1, 2, 0).copy()
for _ in range(6):
    cx, cy = rng.uniform(.15, .8, 2)[0], rng.uniform(.10, .40)
    m = np.hypot(xx - cx, yy - cy) < rng.uniform(.05, .09)
    img[m] = img[m] * .68
flecks(img, xx, yy, 110, .02, .011, [92, 138, 58], .0)
save('scallion-pancake.jpg', img)

# shengjian top (R1 #1): white dough base f1e9dc + toasted sesame + scallion
img = np.stack([241, 233, 220], 0)[:, None, None] * (1 + noise(N, 32, .045))[None]
img = img.transpose(1, 2, 0).copy()
flecks(img, xx, yy, 110, .024, .014, [152, 112, 62], .12)   # toasted rim under each seed
flecks(img, xx, yy, 110, .020, .011, [216, 178, 120], .12)  # sesame bodies
flecks(img, xx, yy, 60, .016, .009, [80, 128, 52], .12)     # scallion
save('sesame-scallion.jpg', img)

# reset the shared stream: sections below keep a stable pattern independent of the
# two edits above (osmanthus/bean-mass feed re-exported carry pieces)
rng = np.random.default_rng(9021)

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

# youdunzi fried-batter (R1 #2): golden base + dark brown bubble spots with bright rims.
# Isotropic bicubic noise only - the old kron-block crust read as woodgrain direction.
img = np.stack([216, 158, 74], 0)[:, None, None] * (1 + noise(N, 64, .02))[None]
img = img.transpose(1, 2, 0).copy()
w = rng.normal(0, 1, (52, 52))
wi = np.asarray(Image.fromarray(np.uint8((w - w.min()) / (np.ptp(w) + 1e-9) * 255))
                .resize((N, N), Image.BICUBIC), np.float32) / 255 - .5
img *= (1 + wi[:, :, None] * .18)
for _ in range(170):
    cx, cy = rng.uniform(0, 1, 2)
    r = rng.uniform(.004, .014)
    rr = np.hypot(xx - cx, yy - cy) / r
    spot = rr < .78                       # dark bubble hole
    rim = (rr >= .78) & (rr < 1.0)        # bright raised edge
    img[spot] = img[spot] * .42 + np.array([64, 38, 18]) * .58
    img[rim] = img[rim] * .55 + np.array([248, 216, 152]) * .45
save('fried-batter.jpg', q=92, img=img)

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

# ---- bean colour atlas 1024 (R2 #2): 2 cols x 3 rows, one cell per variant ----
# R2 rule (lead re-review): skin base 8a6a48 dominates (>= 55% of the cell), sugar
# frost covers 30-40% in 0.8-2 mm soft patches and CONCENTRATES on the convex broad
# faces (cell v near 0/1 = the bean's flat faces), sparse on the rim/groove equator
# - R1's uniform dusting read as a pale marbled chip at macro. Cell u spans one
# azimuth revolution (~58 mm -> 8.8 px/mm), cell v spans pole-to-pole (~20 mm).
SN = 1024
cell = SN // 2
aye, axx = np.mgrid[0:SN, 0:SN] / SN
atlas_b = np.zeros((SN, SN, 3), np.float32)
skin = np.array([138, 106, 72], np.float32)      # 8a6a48
frost = np.array([233, 226, 211], np.float32)    # e9e2d3
hilum = np.array([42, 28, 20], np.float32)       # 2a1c14
coverages = [0.315, 0.318, 0.32, 0.322, 0.325, 0.328]  # R2: measured frost 30-40%/variant
_lum_w = np.array([.2126, .7152, .0722], np.float32)

def _soft_blobs(rows, cols, seed):
    """blob field in [0,1]; cell u spans ~58 mm, cell v ~20 mm, so (rows, cols) sets the
    mm scale of the blobs (cols drives the u extent, rows the v extent)."""
    g = np.random.default_rng(seed).normal(0, 1, (rows, cols))
    im = Image.fromarray(np.uint8((g - g.min()) / (np.ptp(g) + 1e-9) * 255))
    im = im.resize((cell, cell), Image.BICUBIC)
    b = np.asarray(im, np.float32) / 255
    return (b - b.min()) / (np.ptp(b) + 1e-9)

def _softstep(x, edge, width):
    t = np.clip((x - edge) / max(width, 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

def _pole_blend(field):
    """kill concentric-ring artifacts at the cell's v poles (the bean's flat faces):
    crossfade to the per-row (u-averaged) value as v approaches 0/1."""
    rows = field.reshape(cell, cell)
    t = np.abs(np.linspace(0, 1, cell) - .5) * 2          # 0 at equator, 1 at poles
    blend = np.clip((t - .84) / .16, 0, 1)[:, None]
    out = rows * (1 - blend) + rows.mean(axis=1, keepdims=True) * blend
    return out.reshape(-1)

for row in range(3):
    for col in range(2):
        k = row * 2 + col
        u0, v0 = col * .5, row / 3
        sel_u = (aye >= v0) & (aye < v0 + 1 / 3) & (axx >= u0) & (axx < u0 + .5)
        uu = ((axx[sel_u] - u0) * 2)
        vv = ((aye[sel_u] - v0) * 3)
        patch = np.tile(skin, (uu.size, 1))
        patch *= (1 + rng.normal(0, .04, (uu.size, 1)))
        # fine mottle: smooth interpolated noise, kept subtle so the base reads 8a6a48
        m1 = _pole_blend(_soft_blobs(30, 46, 400 + k))
        patch *= (1 + m1[:uu.size][:, None] * .10)
        # frost R2: EXPLICIT soft blobs (0.8-2 mm) splatted in UV with polar weighting
        # and u-wrap - a plain noise field bands into horizontal stripes at the UV
        # poles. Intensity scale is bisected against the same luminance classifier the
        # tests use, so the measured white share hits the per-variant target.
        brs = np.random.default_rng(900 + k)
        cand_v = brs.random(1600)
        cand_u = brs.random(1600)
        w_acc = 0.08 + 0.92 * _softstep(np.abs(cand_v - .5) * 2, 0.25, 0.55)
        keep = brs.random(1600) < w_acc
        bu, bv = cand_u[keep], cand_v[keep]
        phi = bv * np.pi
        rad_mm = brs.uniform(0.4, 1.0, bu.size)              # 0.8-2 mm patches
        ru = np.clip(rad_mm / (58.0 * (np.sin(phi) + .15)), .004, .06)  # u shrink at poles
        rv = rad_mm / 20.0                                   # cell v = ~20 mm
        yy_c, xx_c = np.mgrid[0:cell, 0:cell] / cell
        fm_raw = np.zeros((cell, cell), np.float32)
        for uj, vj, rij, rji in zip(bu, bv, ru, rv):
            du = np.abs(xx_c - uj)
            du = np.minimum(du, 1 - du)                      # u wraps around the bean
            dv = yy_c - vj
            fm_raw += np.exp(-((du / rij) ** 2 + (dv / rji) ** 2) * 9.0).astype(np.float32)

        def _frost_frac(s):
            fmx = np.clip(s * fm_raw, 0, 1)[
                np.clip((vv * (cell - 1)).astype(int), 0, cell - 1),
                np.clip((uu * (cell - 1)).astype(int), 0, cell - 1)]
            px = patch * (1 - fmx[:, None]) + (patch * .18 + frost * .82) * fmx[:, None]
            return float((px @ _lum_w >= 185).mean())

        lo_s, hi_s = 0.05, 6.0
        for _ in range(18):
            mid = (lo_s + hi_s) / 2
            if _frost_frac(mid) > coverages[k]:
                hi_s = mid
            else:
                lo_s = mid
        fm = np.clip(((lo_s + hi_s) / 2) * fm_raw, 0, 1)[
            np.clip((vv * (cell - 1)).astype(int), 0, cell - 1),
            np.clip((uu * (cell - 1)).astype(int), 0, cell - 1)]
        patch = patch * (1 - fm[:, None]) + (patch * .18 + frost * .82) * fm[:, None]
        # hilum (R1 #4): thin dark line hugging the rim equator (v~.5, ~1.5 mm tall),
        # ~6 mm long at the groove azimuth (u .25 / .75)
        hu = 0.25 if k % 2 == 0 else 0.75
        bw = 1.0 - _softstep(np.abs(uu - hu), .030, .014)   # 1 at the groove azimuth
        bv = _softstep(.0, np.abs(vv - .5) - .04, .02)
        hm = bw * bv
        patch = patch * (1 - hm[:, None]) + (patch * .18 + hilum * .82) * hm[:, None]
        atlas_b[sel_u] = patch
save('bean-colour-atlas.jpg', atlas_b, q=92)
atlas_img = Image.open(OUT / 'bean-colour-atlas.jpg')
Image.fromarray(np.uint8(np.clip(atlas_b, 0, 255))).resize((512, 512), Image.LANCZOS).save(
    OUT / 'bean-colour-atlas-512.jpg', quality=92)
atlas512_img = Image.open(OUT / 'bean-colour-atlas-512.jpg')
import bean_tex_stats
_bean_stats_1024 = bean_tex_stats.measure(atlas_img)
_bean_stats_512 = bean_tex_stats.measure(atlas512_img)
print('wrote bean-colour-atlas-512.jpg')
print('BEAN_ATLAS_1024', json.dumps(_bean_stats_1024))
print('BEAN_ATLAS_512', json.dumps(_bean_stats_512))

# ---- bean wrinkle normal 1024 (R1 #4): fine SHORT wrinkles >= 8/cm ------------
# full-bean UV: u 0..1 = one azimuth revolution (~58 mm), so k cycles/rev = k/5.8 per cm.
# A fast envelope breaks the sinusoids into short dashes; node strength set to 0.35 in
# matlib (this texture keeps full gradient range).
u = axx                        # 0..1 across the atlas width = one revolution
v = aye
h = np.zeros((SN, SN), np.float32)
env = .55 + .45 * np.sin((2 * pi) * (14 * u + 9 * v) + .7)
h += .50 * env * np.sin((2 * pi) * 52 * u + 3.0 * np.sin((2 * pi) * v * 2.3))       # 9.0 /cm
env2 = .60 + .40 * np.sin((2 * pi) * (17 * u - 11 * v) + 2.1)
h += .34 * env2 * np.sin((2 * pi) * 70 * u + 1.7 + 2.4 * np.sin((2 * pi) * v * 3.1))  # 12.1 /cm
h += .20 * np.sin((2 * pi) * 92 * u + .6 + 5 * v)                                   # 15.9 /cm
h += np.random.default_rng(5150).normal(0, 1, (SN // 8, SN // 8)).repeat(8, 0).repeat(8, 1)[:SN, :SN] * .22
for _ in range(1):
    h = (np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1) + 4 * h) / 8
gy, gx = np.gradient(h)      # gx ~ d/du, gy ~ d/dv
strength = 1.35
nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([(nx / ln * .5 + .5), (ny / ln * .5 + .5), (nz / ln * .5 + .5)], -1)
save('bean-wrinkle-normal.jpg', normal * 255, q=95)

(OUT.parent / 'texture-authoring.json').write_text(json.dumps({
    'textures': 'analytic numpy/PIL food + paper surfaces; labels typeset Noto Serif CJK; '
                'R2: bean atlas base 8a6a48 dominant (>= 55%), sugar frost 30-40% in '
                '0.8-2 mm soft patches concentrated on the convex broad faces '
                '(convexRatio >= 2 vs rim equator); bean wrinkle normal = fine short '
                'wrinkles 9-16/cm (node strength 0.35); no photo tracing',
    'beanFrostCoverage': coverages,
    'beanAtlasMeasured': {'atlas1024': _bean_stats_1024, 'atlas512': _bean_stats_512},
    'beanWrinkleNormalStrengthNode': 0.35,
    'beanWrinkleCyclesPerCm': [9.0, 12.1, 15.9]}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('TEXLIB_DONE')
