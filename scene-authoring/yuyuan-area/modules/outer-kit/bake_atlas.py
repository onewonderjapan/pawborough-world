# 外围老城厢套件立面图集（wave7-outerkit 起，OUTER_KIT_MODE=tex）：纯 numpy 程序化绘制——不取任何照片像素，
# 参照图库只用来定形制比例与配色（PBR-SH-0001-004/005/010/020、PBR-SH-0002-006，见 src/outer-kit.mjs DESIGN_INFERENCE）。
# 固定种子，逐字节可复现（同 numpy / Pillow 版本）。布局与 src/outer-kit.mjs 的 ATLAS / ATLAS_ROWS 一一对应（glTF UV：v=0 在图顶）。
#
# v2（wave9-outerpolish，2026-09-26）：512×4096 → resources/textures/outer-kit/outerkit-atlas-v2.jpg（v1 512×1024 文件保留不动）
#   行   0–255  瓦面：U 周期 3.2 m（512 px），V = 斜距 6.4 m（行 3 = 屋脊，行 252 = 6.4 m 处）；瓦垄 16 道 / 周期，瓦行 25 行 / 带
#   之后每条 128 行，按 ROWS 顺序（与 src/outer-kit.mjs ATLAS_ROWS 同序）：
#     shopA / shopB           店面底层两种门面（A = 排门板 + 半开铺面；B = 玻璃橱窗 + 卷帘门），顶部 20 行暗色招牌带（封檐 / 檐底取色在 shopA）
#     aptGreyA / aptGreyB     多层公房（灰白）两种开间排法；aptYellowA / aptYellowB 同，旧黄
#     每种墙色 4 × 6 条：<tone>:resA / resB（民居底层两种）、upA / upB（楼层两种）、sidewin（山墙侧小窗）、plain（素墙：山尖 / 共墙 / 女儿墙）
#     墙色：cream 米白、greywhite 灰白、greybrick 浅灰砖（清水砖墙，窗上加过梁）、oldyellow 旧黄
#   每条上下各留 3 行同色边，防 mip 串色。一条层带 = 该层地面（行 124）到上层地面（行 3）。一条 = 两开间 × 3.6 m。
# 用法：python3 -X utf8 modules/outer-kit/bake_atlas.py  → resources/textures/outer-kit/outerkit-atlas-v2.jpg
#      ATLAS_V=1 复现 v1（512×1024，旧布局，只为对照体积）
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V = os.environ.get('ATLAS_V', '2')
OUT = os.path.join(ROOT, 'resources', 'textures', 'outer-kit', 'outerkit-atlas.jpg' if V == '1' else 'outerkit-atlas-v2.jpg')
W, H = 512, (1024 if V == '1' else 4096)
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

# ---------- v2：墙色 × 变体 ----------
TONES = ['cream', 'greywhite', 'greybrick', 'oldyellow']          # 米白 / 灰白 / 浅灰砖 / 旧黄（顺序 = src/outer-kit.mjs TONES）
TONE_PLASTER = {
    'cream':     {'res': 0xe2ddd1, 'up': 0xe6e1d6, 'side': 0xdcd6ca},
    'greywhite': {'res': 0xd6d7d3, 'up': 0xdadbd7, 'side': 0xd0d1cd},
    'oldyellow': {'res': 0xd2c4a2, 'up': 0xd6c8a6, 'side': 0xccbe9b},   # P3 前压低饱和度（P2 联系表里偏艳）
}
BRICK = {'brick': 0x9c9b96, 'mortar': 0xc3c0b8, 'lintel': 0xcdc9bf}
# wave13-nightbalance N1（nightqa #15 外围 L0 体块夜偏亮「雪原」）：墙色统一 ×0.88（≈线性反照率 -25%），
# 老墙风化档：cream 0.76→0.54、greywhite 0.67→0.50、oldyellow 0.51→0.39、brick 0.33→0.24（线性），
# 仍都在各自材质语义的合理区间内（白抹灰 0.6–0.8 的下缘、青砖 0.15–0.35）。屋面带 / 招牌暗带不动。
# R1（astra 必修3：白天门槛不豁免）：×0.88 使外围/航拍白天全画幅约 -11%/-16%，超过 ≤8%。
# 授权旋钮内的候选折衷是逐通道 k=0.94（与 ground 0xa49f99 分开调，不宣称已经过门槛）。
# 白天各机位绝对变化以合并 main 后的标准口径重建实测为准；夜/黄昏仍沿压暗方向。
# 注意必须逐通道缩放：对打包后的 24-bit 整数整体乘系数再取整，会把 R 通道 ×0.88 的小数（×65536 倍）
# 灌进 G 通道造成串色（首版实测图集中部条带全花成品红/绿，已复现并回退验证）。
def _dim_channel(h, k=0.94):
    r, g, b = (h >> 16) & 255, (h >> 8) & 255, h & 255
    return (int(round(r * k)) << 16) | (int(round(g * k)) << 8) | int(round(b * k))
TONE_PLASTER = {t: {kk: _dim_channel(vv) for kk, vv in d.items()} for t, d in TONE_PLASTER.items()}
BRICK = {kk: _dim_channel(vv) for kk, vv in BRICK.items()}

def brick(stain=0.12):
    """清水青砖（浅灰）：顺砖错缝，一皮 4 行 ≈ 9 cm，一块 16 px ≈ 0.225 m（512 px 恰 32 块，横向无缝重复）"""
    s = np.zeros((128, W, 3), np.float32)
    n = periodic_noise(128, W, 4, 8)
    streak = periodic_noise(128, W, 1, 24, octaves=2)
    tint = rng.random((32, 33)).astype(np.float32)                   # 每皮 × 每块色差
    y = np.arange(128)[:, None]; x = np.arange(W)[None, :]
    course = y // 4
    off = (course % 2) * 8
    bi = ((x + off) // 16) % 32
    joint = (((x + off) % 16) == 0) | ((y % 4) == 3)
    base = hexc(BRICK['brick']); mort = hexc(BRICK['mortar'])
    t = tint[course % 32, bi]
    v = (0.9 + 0.08 * n - stain * np.clip(streak - 0.55, 0, 1) * 2.5)
    for c in range(3):
        s[:, :, c] = np.where(joint, mort[c] * (0.97 + 0.05 * n), base[c] * (0.88 + 0.2 * t)) * v
    return s

def surface(tone, key, stain=0.12):
    return brick(stain) if tone == 'greybrick' else plaster(TONE_PLASTER[tone][key], stain=stain)

def lintel(s, tone, cx, top, w):
    if tone == 'greybrick':
        rect(s, cx - w / 2 - 0.1, cx + w / 2 + 0.1, top, top + 0.14, BRICK['lintel'])

def win_t(s, tone, cx, sill, w, h, **kw):
    window(s, cx, sill, w, h, **kw)
    lintel(s, tone, cx, sill + h, w)

def plinth(s):
    rect(s, 0, 7.2, 0.0, 0.6, 0x76726c)                                      # 青砖勒脚
    for k in range(0, 7):
        rect(s, 0, 7.2, 0.1 + k * 0.075, 0.1 + k * 0.075 + 0.012, 0x5d5a55)

def resA(tone):
    s = surface(tone, 'res')
    plinth(s)
    rect(s, 0.95, 2.65, 0.0, 2.55, 0xb7b1a6)                                 # 开间 1：石库门式黑漆门（石框）
    rect(s, 1.1, 2.5, 0.0, 2.35, 0x1f1c1b)
    rect(s, 1.78, 1.82, 0.0, 2.35, 0x3a3533)
    rect(s, 1.6, 1.66, 1.1, 1.2, 0x9c8a5a); rect(s, 1.94, 2.0, 1.1, 1.2, 0x9c8a5a)
    win_t(s, tone, 3.6 + 1.2, 1.0, 1.2, 1.2)                                 # 开间 2：木窗 + 小门
    rect(s, 3.6 + 2.3, 3.6 + 3.2, 0.0, 2.1, 0x5a3b28); rect(s, 3.6 + 2.36, 3.6 + 3.14, 0.06, 2.04, 0x6d4a33)
    lintel(s, tone, 3.6 + 2.75, 2.1, 0.9)
    eave_shadow(s, 8, 0.8)
    return pad(s)

def resB(tone):
    s = surface(tone, 'res')
    plinth(s)
    win_t(s, tone, 1.8, 1.05, 1.5, 1.15, panes=4)                            # 开间 1：铁栅木窗
    for k in range(7):
        x = 1.8 - 0.6 + k * 0.2
        rect(s, x - 0.015, x + 0.015, 1.05, 2.2, 0x2a2624)
    rect(s, 3.6 + 0.55, 3.6 + 1.65, 0.0, 2.05, 0x5b3a26)                     # 开间 2：木板门 + 腰头窗
    for k in range(1, 6):
        x = 3.6 + 0.55 + k * 0.183
        rect(s, x - 0.012, x + 0.012, 0.0, 2.05, 0x3f2a1c)
    rect(s, 3.6 + 0.55, 3.6 + 1.65, 2.1, 2.4, 0x2b2724); rect(s, 3.6 + 0.5, 3.6 + 1.7, 2.05, 2.1, 0x4a3122)
    lintel(s, tone, 3.6 + 1.1, 2.4, 1.1)
    win_t(s, tone, 3.6 + 2.65, 1.2, 0.8, 0.9, panes=2)
    eave_shadow(s, 8, 0.8)
    return pad(s)

def upA(tone):
    s = surface(tone, 'up')
    win_t(s, tone, 1.8, 0.85, 1.5, 1.45, panes=4)
    win_t(s, tone, 3.6 + 1.8, 0.85, 1.5, 1.45, panes=3)
    rect(s, 3.6 + 1.0, 3.6 + 1.05, 0.85, 2.3, 0x4a3122)                       # 开间 2 外开百叶一扇
    rect(s, 0, 7.2, 0.0, 0.1, 0xc9c2b4 if tone != 'greybrick' else BRICK['lintel'])   # 楼层线
    eave_shadow(s)
    return pad(s)

def upB(tone):
    s = surface(tone, 'up')
    win_t(s, tone, 1.8, 0.9, 1.2, 1.4, panes=2)                              # 开间 1：双开百叶全开
    rect(s, 1.8 - 0.6 - 0.58, 1.8 - 0.62, 0.9, 2.3, 0x4a3122); rect(s, 1.8 + 0.62, 1.8 + 0.6 + 0.58, 0.9, 2.3, 0x4a3122)
    for k in range(9):
        y0 = 0.98 + k * 0.145
        rect(s, 1.8 - 1.16, 1.8 - 0.64, y0, y0 + 0.03, 0x33241a); rect(s, 1.8 + 0.64, 1.8 + 1.16, y0, y0 + 0.03, 0x33241a)
    win_t(s, tone, 3.6 + 1.15, 0.85, 0.72, 1.5, panes=2)                    # 开间 2：一对窄窗 + 晾衣铁栏
    win_t(s, tone, 3.6 + 2.45, 0.85, 0.72, 1.5, panes=2)
    rect(s, 3.6 + 0.6, 3.6 + 3.0, 0.82, 0.86, 0x2f2b28)
    for k in range(13):
        x = 3.6 + 0.6 + k * 0.2
        rect(s, x - 0.012, x + 0.012, 0.5, 0.86, 0x2f2b28)
    rect(s, 0, 7.2, 0.0, 0.1, 0xc9c2b4 if tone != 'greybrick' else BRICK['lintel'])
    eave_shadow(s)
    return pad(s)

def sidewin_t(tone):
    s = surface(tone, 'side', stain=0.2)
    for b in range(2):
        win_t(s, tone, b * 3.6 + 1.8, 1.2, 0.7, 0.9, panes=2)
    return pad(s)

def plain_t(tone):
    return pad(surface(tone, 'side', stain=0.14))

def shopB():
    s = plaster(0xd9d2c4)
    # 开间 1：玻璃橱窗 + 门
    rect(s, 0.12, 3.48, 0.0, 0.15, 0x8d8a84)
    rect(s, 0.2, 3.4, 0.15, 2.4, 0x3b3a38)
    rect(s, 0.3, 2.3, 0.6, 2.3, 0x33403f); rect(s, 0.3, 2.3, 0.15, 0.6, 0x5a4a3a)
    for k in range(1, 4):
        x = 0.3 + k * 0.5
        rect(s, x - 0.02, x + 0.02, 0.6, 2.3, 0x3b3a38)
    rect(s, 0.45, 0.9, 1.4, 2.2, 0x0, mul=np.array([1.45, 1.45, 1.5], np.float32))
    rect(s, 2.45, 3.3, 0.15, 2.3, 0x24201d)
    # 开间 2：卷帘门（半卷）
    rect(s, 3.6 + 0.12, 3.6 + 3.48, 0.0, 0.15, 0x8d8a84)
    rect(s, 3.6 + 0.2, 3.6 + 3.4, 0.15, 2.4, 0x8b8d8f)
    for k in range(27):
        y = 0.9 + k * 0.055
        rect(s, 3.6 + 0.2, 3.6 + 3.4, y, y + 0.012, 0x6d6f71)
    rect(s, 3.6 + 0.2, 3.6 + 3.4, 0.15, 0.9, 0x201b18)
    rect(s, 3.6 + 0.4, 3.6 + 3.2, 0.5, 0.62, 0x6c5c48)
    rect(s, 0, 0.2, 0.0, 2.8, 0x4a4540); rect(s, 3.4, 3.8, 0.0, 2.8, 0x4a4540); rect(s, 7.0, 7.2, 0.0, 2.8, 0x4a4540)
    s[CEIL_ROW:CEIL_ROW + 20] = hexc(0x2e3329)
    s[CEIL_ROW + 20:CEIL_ROW + 23] = hexc(0x23261f)
    return pad(s)

def aptA(color):
    s = plaster(color, stain=0.18)
    rect(s, 0, 7.2, 0.0, 0.18, 0xb2ada4)
    for b in range(2):
        cx = b * 3.6 + 1.8
        window(s, cx, 0.9, 1.7, 1.4, frame=0xd6d4ce, glass=0x3a3d40, panes=3)
        rect(s, cx - 0.95, cx + 0.95, 0.72, 0.82, 0x9d9990)
    rect(s, 3.55, 3.65, 0.0, 2.8, 0x0, mul=np.array([0.93, 0.93, 0.93], np.float32))
    return pad(s)

def aptB(color):
    s = plaster(color, stain=0.18)
    rect(s, 0, 7.2, 0.0, 0.18, 0xb2ada4)
    window(s, 1.8, 0.9, 1.9, 1.5, frame=0xd6d4ce, glass=0x3a3d40, panes=4)   # 开间 1：阳台（实心栏板）+ 落地窗
    rect(s, 0.45, 3.15, 0.18, 1.05, 0xbdb9b0); rect(s, 0.45, 3.15, 1.0, 1.08, 0x9d9990)
    rect(s, 0.45, 3.15, 0.18, 0.26, 0x0, mul=np.array([0.8, 0.8, 0.8], np.float32))
    for b in range(2):                                                        # 开间 2：楼梯间两扇小窗
        cx = 3.6 + 1.1 + b * 1.4
        window(s, cx, 1.3, 0.6, 0.9, frame=0xd6d4ce, glass=0x3a3d40, panes=2)
    rect(s, 7.1, 7.2, 0.0, 2.8, 0x0, mul=np.array([0.93, 0.93, 0.93], np.float32))
    return pad(s)

if V == '1':
    img[0:256] = roof()
    for row, fn in [(256, shop), (384, res), (512, upper), (640, apt), (768, sidewin), (896, plain)]:
        img[row:row + 128] = fn()
else:
    ROWS = [('shopA', shop), ('shopB', shopB),
            ('aptGreyA', lambda: aptA(0xcfcbc2)), ('aptGreyB', lambda: aptB(0xcfcbc2)),
            ('aptYellowA', lambda: aptA(0xd0c29f)), ('aptYellowB', lambda: aptB(0xd0c29f))]
    for t in TONES:
        ROWS += [(t + ':resA', lambda t=t: resA(t)), (t + ':resB', lambda t=t: resB(t)), (t + ':upA', lambda t=t: upA(t)),
                 (t + ':upB', lambda t=t: upB(t)), (t + ':sidewin', lambda t=t: sidewin_t(t)), (t + ':plain', lambda t=t: plain_t(t))]
    assert 256 + 128 * len(ROWS) == H, len(ROWS)
    img[0:256] = roof()
    for k, (name, fn) in enumerate(ROWS):
        img[256 + 128 * k:256 + 128 * (k + 1)] = fn()
    print('rows', ' '.join(n for n, _ in ROWS))
img = np.clip(img, 0, 255).astype(np.uint8)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray(img, 'RGB').save(OUT, 'JPEG', quality=QUALITY, optimize=True, subsampling=2)
print('atlas', OUT, os.path.getsize(OUT), 'bytes', f'q{QUALITY}', f'{W}x{H}')
