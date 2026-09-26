# 外围老城厢套件立面图集（wave7-outerkit，OUTER_KIT_MODE=tex）：512×1024 JPEG，纯 numpy 程序化绘制——不取任何照片像素，
# 参照图库只用来定形制比例与配色（PBR-SH-0001-004/005/010/020、PBR-SH-0002-006，见 src/outer-kit.mjs DESIGN_INFERENCE）。
# 固定种子，逐字节可复现（同 numpy / Pillow 版本）。布局与 src/outer-kit.mjs 的 ATLAS 常量一一对应（glTF UV：v=0 在图顶）：
#   行   0–255  瓦面：U 周期 3.2 m（512 px），V = 斜距 6.4 m（行 3 = 屋脊，行 252 = 6.4 m 处）；瓦垄 16 道 / 周期，瓦行 25 行 / 带（上下接缝连续）
#   行 256–383  店面底层（两开间 × 3.6 m）：顶部 20 行整条暗色招牌带（封檐板 / 檐底 / 屋脊压顶都取这里的颜色）
#   行 384–511  民居底层：青砖勒脚 + 黑漆门 + 木窗
#   行 512–639  楼层：白灰墙 + 木格窗
#   行 640–767  多层公房一层：灰白墙 + 钢窗 + 楼板线
#   行 768–895  山墙侧：素墙 + 小窗（每 6.4 m 一扇）
#   行 896–1023 素墙：山尖 / 共墙 / 女儿墙
# 每条 128 行，上下各留 3 行同色边，防 mip 串色。一条层带 = 该层地面（行 124）到上层地面（行 3）。
# 用法：python3 -X utf8 modules/outer-kit/bake_atlas.py  → resources/textures/outer-kit/outerkit-atlas.jpg
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'resources', 'textures', 'outer-kit', 'outerkit-atlas.jpg')
W, H = 512, 1024
SEED = 20260926
QUALITY = int(os.environ.get('ATLAS_Q', '80'))
rng = np.random.default_rng(SEED)
img = np.zeros((H, W, 3), np.float32)

def hexc(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], np.float32)

def periodic_noise(h, w, fy, fx, octaves=3):
    acc = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0
    for _ in range(octaves):
        g = rng.random((fy, fx)).astype(np.float32)
        yi = np.arange(h) * fy / h; xi = np.arange(w) * fx / w
        y0 = np.floor(yi).astype(int) % fy; x0 = np.floor(xi).astype(int) % fx
        ty = (yi - np.floor(yi))[:, None]; tx = (xi - np.floor(xi))[None, :]
        y1 = (y0 + 1) % fy; x1 = (x0 + 1) % fx
        a = g[y0][:, x0] * (1 - tx) + g[y0][:, x1] * tx
        b = g[y1][:, x0] * (1 - tx) + g[y1][:, x1] * tx
        acc += amp * (a * (1 - ty) + b * ty); tot += amp; amp *= 0.5; fy *= 2; fx *= 2
    return acc / tot

# ---------- 瓦面 ----------
def roof():
    r = np.zeros((256, W, 3), np.float32)
    x = np.arange(W)
    ph = (x % 32) / 32.0                                   # 瓦垄周期 32 px ≈ 0.2 m
    ridge = np.clip(1 - np.abs(ph - 0.25) / 0.18, 0, 1)   # 盖瓦（凸）亮
    trough = np.clip(1 - np.abs(ph - 0.75) / 0.2, 0, 1)   # 底瓦（凹）暗
    base = hexc(0x55575b)
    shade = 1 + 0.18 * ridge[None, :] - 0.22 * trough[None, :]
    y = np.arange(256)
    course = ((y - 3) % 10) / 10.0                         # 瓦行 10 px，250 px = 25 行（带间接缝连续）
    lip = np.where(course > 0.8, 0.78, 1.0)[:, None]       # 每行下沿阴影
    n = periodic_noise(256, W, 4, 8)
    for c in range(3):
        r[:, :, c] = base[c] * shade * lip * (0.9 + 0.2 * n)
    # 零星青苔 / 换瓦色差（按瓦垄成段）
    patch = periodic_noise(256, W, 3, 6) > 0.66
    r[patch] *= np.array([0.95, 0.98, 0.94], np.float32)
    return r

# ---------- 层带公用 ----------
PXM_X = 512 / 7.2          # 71.1 px / m（两开间）
FLOOR_ROW, CEIL_ROW = 124, 3
def ypx(m, fh=2.8):        # 距该层地面 m 米 → 行
    return FLOOR_ROW - m * (FLOOR_ROW - CEIL_ROW) / fh

def plaster(color, stain=0.12, fx=6):
    s = np.zeros((128, W, 3), np.float32)
    n = periodic_noise(128, W, 4, fx)
    streak = periodic_noise(128, W, 1, 24, octaves=2)      # 竖向水渍
    v = (0.94 + 0.1 * n - stain * np.clip(streak - 0.55, 0, 1) * 2.5)
    for c in range(3):
        s[:, :, c] = hexc(color)[c] * v
    return s

def rect(s, x0m, x1m, y0m, y1m, color, fh=2.8, mul=None):
    x0 = int(round(x0m * PXM_X)); x1 = int(round(x1m * PXM_X))
    ya = int(round(ypx(y1m, fh))); yb = int(round(ypx(y0m, fh)))
    if x1 - x0 >= W:
        xs = [(0, W)]
    else:
        a0, b0 = x0 % W, x0 % W + (x1 - x0)
        xs = [(a0, b0)] if b0 <= W else [(a0, W), (0, b0 - W)]
    for a, b in xs:
        if mul is not None:
            s[max(0, ya):min(128, yb), a:b] *= mul
        else:
            s[max(0, ya):min(128, yb), a:b] = hexc(color)
    return s

def window(s, cx, sill, w, h, frame=0x5c3a26, glass=0x2b2724, panes=3, fh=2.8):
    rect(s, cx - w / 2 - 0.06, cx + w / 2 + 0.06, sill - 0.08, sill, 0xb9b2a4, fh)       # 窗台
    rect(s, cx - w / 2, cx + w / 2, sill, sill + h, frame, fh)
    fw = 0.07
    rect(s, cx - w / 2 + fw, cx + w / 2 - fw, sill + fw, sill + h - fw, glass, fh)
    for k in range(1, panes):                                                              # 竖梃
        x = cx - w / 2 + k * w / panes
        rect(s, x - 0.03, x + 0.03, sill, sill + h, frame, fh)
    rect(s, cx - w / 2 + fw, cx + w / 2 - fw, sill + h * 0.62, sill + h * 0.62 + 0.05, frame, fh)  # 横档
    rect(s, cx - w / 2 + 0.12, cx - w / 2 + 0.35, sill + h * 0.66, sill + h - 0.12, 0, fh, mul=np.array([1.5, 1.5, 1.6], np.float32))  # 反光

def eave_shadow(s, rows=14, k=0.55):
    for i in range(rows):
        s[CEIL_ROW - 3 + i] *= k + (1 - k) * i / rows

def pad(s):
    s[0:3] = s[3]; s[125:128] = s[124]
    return s

def shop():
    s = plaster(0xd9d2c4)
    for b in range(2):
        x0 = b * 3.6
        rect(s, x0 + 0.12, x0 + 3.48, 0.0, 0.15, 0x8d8a84)                   # 石阶
        rect(s, x0 + 0.2, x0 + 3.4, 0.15, 2.35, 0x6e4a30)                    # 排门板底色
        for k in range(22):                                                  # 门板缝
            x = x0 + 0.2 + k * 0.145
            rect(s, x, x + 0.025, 0.15, 2.35, 0x3f2a1c)
        rect(s, x0 + 0.2, x0 + 3.4, 1.1, 1.16, 0x4a3122)                     # 腰带
        if b == 1:
            rect(s, x0 + 1.5, x0 + 3.4, 0.15, 2.3, 0x241d19)                 # 半开铺面（暗）
            rect(s, x0 + 1.6, x0 + 3.3, 0.9, 1.0, 0x7a6a55)                  # 柜台
        rect(s, x0, x0 + 0.2, 0.0, 2.8, 0x4a3122); rect(s, x0 + 3.4, x0 + 3.6, 0.0, 2.8, 0x4a3122)   # 门柱
        rect(s, x0 + 0.2, x0 + 3.4, 2.35, 2.42, 0x2c211a)
    s[CEIL_ROW:CEIL_ROW + 20] = hexc(0x3a2a1f)                                # 招牌暗带（整条，封檐等取色区）
    s[CEIL_ROW + 20:CEIL_ROW + 23] = hexc(0x2a1f18)
    return pad(s)

def res():
    s = plaster(0xe2ddd1)
    rect(s, 0, 7.2, 0.0, 0.6, 0x76726c)                                      # 青砖勒脚
    for k in range(0, 7):
        rect(s, 0, 7.2, 0.1 + k * 0.075, 0.1 + k * 0.075 + 0.012, 0x5d5a55)
    # 开间 1：石库门式黑漆门（石框）
    rect(s, 0.95, 2.65, 0.0, 2.55, 0xb7b1a6)
    rect(s, 1.1, 2.5, 0.0, 2.35, 0x1f1c1b)
    rect(s, 1.78, 1.82, 0.0, 2.35, 0x3a3533)
    rect(s, 1.6, 1.66, 1.1, 1.2, 0x9c8a5a); rect(s, 1.94, 2.0, 1.1, 1.2, 0x9c8a5a)   # 门环
    # 开间 2：木窗 + 小门
    window(s, 3.6 + 1.2, 1.0, 1.2, 1.2)
    rect(s, 3.6 + 2.3, 3.6 + 3.2, 0.0, 2.1, 0x5a3b28); rect(s, 3.6 + 2.36, 3.6 + 3.14, 0.06, 2.04, 0x6d4a33)
    eave_shadow(s, 8, 0.8)
    return pad(s)

def upper():
    s = plaster(0xe6e1d6)
    window(s, 1.8, 0.85, 1.5, 1.45, panes=4)
    window(s, 3.6 + 1.8, 0.85, 1.5, 1.45, panes=3)
    rect(s, 3.6 + 1.0, 3.6 + 1.05, 0.85, 2.3, 0x4a3122)                       # 开间 2 外开百叶一扇
    rect(s, 0, 7.2, 0.0, 0.1, 0xc9c2b4)                                      # 楼层线
    eave_shadow(s)
    return pad(s)

def apt():
    s = plaster(0xcfcbc2, stain=0.18)
    rect(s, 0, 7.2, 0.0, 0.18, 0xb2ada4)                                     # 楼板线
    for b in range(2):
        cx = b * 3.6 + 1.8
        window(s, cx, 0.9, 1.7, 1.4, frame=0xd6d4ce, glass=0x3a3d40, panes=3)
        rect(s, cx - 0.95, cx + 0.95, 0.72, 0.82, 0x9d9990)                  # 窗台板
    rect(s, 3.55, 3.65, 0.0, 2.8, 0x0, mul=np.array([0.93, 0.93, 0.93], np.float32))   # 雨水管
    return pad(s)

def sidewin():
    s = plaster(0xdcd6ca, stain=0.2)
    for b in range(2):
        window(s, b * 3.6 + 1.8, 1.2, 0.7, 0.9, panes=2)
    return pad(s)

def plain():
    return pad(plaster(0xdcd6ca, stain=0.14))

img[0:256] = roof()
for row, fn in [(256, shop), (384, res), (512, upper), (640, apt), (768, sidewin), (896, plain)]:
    img[row:row + 128] = fn()
img = np.clip(img, 0, 255).astype(np.uint8)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray(img, 'RGB').save(OUT, 'JPEG', quality=QUALITY, optimize=True, subsampling=2)
print('atlas', OUT, os.path.getsize(OUT), 'bytes', f'q{QUALITY}')
