# 程序化烘焙铺装贴图（wave1-paving P2）：1024² 无缝平铺 JPEG，纯 numpy 生成——无外部素材、无采集，
# 固定随机种子（20260923）保证可复现。生成即终版，不做旧、不加脏。
# 材质矩阵（分区 × 类型 → 槽）见 src/build-scene.mjs 的 PAVING_SLOTS；导出时绑定见 scripts/export-zones.py。
# 世界比例：UV 1 单位 = 1 m，即每张贴图平铺周期 1 m；砖/石尺寸按像素换算写在各生成函数里。
# 用法：blender -b -P scripts/bake-paving-textures.py   （输出 resources/textures/paving/<slot>.jpg）
import bpy, os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, 'resources', 'textures', 'paving')
SIZE = 1024
SEED = 20260923

def resize_periodic(grid, size):
    """低频随机格双线性上采样到 size²，横向纵向都 wrap（无缝）。"""
    f = grid.shape[0]
    pos = np.arange(size) * (f / size)
    i0 = np.floor(pos).astype(np.int64) % f
    t = (pos - np.floor(pos))[:, None]
    i1 = (i0 + 1) % f
    rows = grid[i0] * (1 - t) + grid[i1] * t
    pos = np.arange(size) * (f / size)
    j0 = np.floor(pos).astype(np.int64) % f
    t2 = (pos - np.floor(pos))[None, :]
    j1 = (j0 + 1) % f
    return rows[:, j0] * (1 - t2) + rows[:, j1] * t2

def value_noise(freq, octaves=4, seed=SEED):
    """周期 value noise，各倍频 wrap 叠加，返回 [0,1] (SIZE,SIZE) float32。"""
    rng = np.random.default_rng(seed)
    acc = np.zeros((SIZE, SIZE), np.float32)
    amp, total = 1.0, 0.0
    f = freq
    for _ in range(octaves):
        acc += amp * resize_periodic(rng.random((f, f)).astype(np.float32), SIZE)
        total += amp
        amp *= 0.5
        f *= 2
    return acc / total

# 不做 sRGB→linear 预换算：save_render（Standard）直接把 pixels 写进 JPEG，
# 各生成函数给出的就是目标 sRGB 值（量测依据见 save_jpg 注释）。

def save_jpg(name, rgb01):
    """rgb01: (SIZE,SIZE,3) 目标 sRGB 值域 [0,1] → resources/textures/paving/<name>.jpg
    注意：Standard 视图变换下 save_render 把 pixels 缓冲原样写进 JPEG（不再过 sRGB OETF），
    所以这里直接写 sRGB 值、不做 linear 预换算——预换算会把整图压暗 ~2.3 倍（已实测）。"""
    os.makedirs(OUTDIR, exist_ok=True)
    vals = np.clip(rgb01, 0.0, 1.0).astype(np.float32)
    rgba = np.ones((SIZE, SIZE, 4), np.float32)
    rgba[:, :, :3] = vals
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False)
    img.pixels.foreach_set(rgba.ravel())
    sc = bpy.context.scene
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    p = os.path.join(OUTDIR, name + '.jpg')
    img.save_render(p)
    bpy.data.images.remove(img)
    print('baked', p, os.path.getsize(p), 'bytes')

# ---------- 1. 弹格路小方石 paving-fine-cobble（商城街面/广场） ----------
# 小方石 ~83 mm 见方（12×12 每米），错缝半砖排布，花岗岩灰、缝深色；无缝：格网下标取模。
def bake_cobble():
    n = 12
    cell = SIZE // n
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    row = (yy // cell).astype(np.int64)
    off = np.where(row % 2 == 1, cell // 2, 0)
    xx2 = xx + off
    col = (xx2 // cell).astype(np.int64)
    rng = np.random.default_rng(SEED + 1)
    tone = rng.random((n * 2, n), dtype=np.float32)          # (col×2 行错缝) × row
    warm = rng.random((n * 2, n), dtype=np.float32)
    t = tone[(col % (n * 2), row % n)]
    w = warm[(col % (n * 2), row % n)]
    g = 0.60 + (t - 0.5) * 0.16
    r, gg, b = g + w * 0.02, g, g - w * 0.02
    # 缝：到格边距离 < 缝宽（带噪声抖动）；石面近缝略暗（倒角）
    fu = (xx2 % cell) / cell
    fv = (yy % cell) / cell
    d = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    joint_n = value_noise(48, 3, SEED + 2) - 0.5
    joint = d * cell < (2.2 + joint_n * 1.6)
    bevel = (d * cell < 7) & ~joint
    wear = value_noise(16, 4, SEED + 3)
    for a in (r, gg, b):
        a *= 0.82 + wear * 0.30
        a[joint] = 0.24 + wear[joint] * 0.06
        a[bevel] *= 0.88
    save_jpg('paving-fine-cobble', np.stack([r, gg, b], -1))

# ---------- 2. 青砖 paving-grey-brick（园路主径） ----------
# 砖 256×128 mm（4×8 每米），一顺一丁错缝；青灰蓝调、灰缝、微磨损。
def bake_brick():
    bw, bh = SIZE // 4, SIZE // 8
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    row = (yy // bh).astype(np.int64)
    off = np.where(row % 2 == 1, bw // 2, 0)
    xx2 = xx + off
    col = (xx2 // bw).astype(np.int64)
    rng = np.random.default_rng(SEED + 11)
    tone = rng.random((32, 8), dtype=np.float32)
    t = tone[(col % 32, row % 8)]
    base = 0.52 + (t - 0.5) * 0.14
    r, gg, b = base * 0.96, base, base * 1.06
    fu = (xx2 % bw) / bw
    fv = (yy % bh) / bh
    d = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    joint = d * bw < 4.5
    wear = value_noise(24, 4, SEED + 12)
    edge = value_noise(8, 3, SEED + 13)
    for a in (r, gg, b):
        a *= 0.92 + wear * 0.16
        a -= (edge > 0.66) * 0.015         # 大面淡斑（很淡）
        a[joint] = 0.55 + wear[joint] * 0.07
    save_jpg('paving-grey-brick', np.stack([r, gg, b], -1))

# ---------- 3. 卵石 paving-pebble（园路支径/池畔径） ----------
# 抖动格心 + 环面距离 → 光滑卵石，缝隙深；粒径 ~60-85 mm。
def bake_pebble():
    m = 12
    step = SIZE / m
    rng = np.random.default_rng(SEED + 21)
    jx = (rng.random((m, m)).astype(np.float32) - 0.5) * step * 0.55
    jy = (rng.random((m, m)).astype(np.float32) - 0.5) * step * 0.55
    rad = (0.42 + rng.random((m, m)).astype(np.float32) * 0.16) * step
    tone = rng.random((m, m), dtype=np.float32)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    cr = (yy // step).astype(np.int64)
    cc = (xx // step).astype(np.int64)
    d2 = np.full((SIZE, SIZE), 1e9, np.float32)
    tid = np.zeros((SIZE, SIZE), np.int32)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            rr = (cr + dr) % m
            q = (cc + dc) % m
            cx = ((cc + dc) * step + jx[rr, q])
            cy = ((cr + dr) * step + jy[rr, q])
            dx = np.abs(xx - cx)
            dy = np.abs(yy - cy)
            dx = np.minimum(dx, SIZE - dx)   # 环面距离 → 无缝
            dy = np.minimum(dy, SIZE - dy)
            e = dx * dx + dy * dy
            hit = e < d2
            d2[hit] = e[hit]
            tid[hit] = (rr * m + q)[hit]
    d = np.sqrt(d2)
    trow, tcol = tid // m, tid % m
    t = tone[trow, tcol]
    g = 0.62 + (t - 0.5) * 0.16
    r, gg, b = g * 0.97, g, g * 1.05
    wet = value_noise(20, 3, SEED + 22)
    for a in (r, gg, b):
        a *= 0.88 + wet * 0.22
        a[d > rad[trow, tcol]] = 0.44 + wet[d > rad[trow, tcol]] * 0.07
    save_jpg('paving-pebble', np.stack([r, gg, b], -1))

# ---------- 4. 青石板 paving-blue-stone（台阶/庙前石面） ----------
# 大板 512 mm 方（2×2 每米），板缝 4-6 mm 深色波浪，板面青灰蓝、低频色斑与磨光微高光感。
def bake_bluestone():
    half = SIZE // 2
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    wav1 = (value_noise(4, 3, SEED + 31) - 0.5) * 26
    wav2 = (value_noise(4, 3, SEED + 32) - 0.5) * 26
    fx = (xx + wav1) % half
    fy = (yy + wav2) % half
    dj = np.minimum(np.minimum(fx, half - fx), np.minimum(fy, half - fy))
    sid = ((xx + wav1) // half).astype(np.int64) % 2 * 2 + ((yy + wav2) // half).astype(np.int64) % 2
    rng = np.random.default_rng(SEED + 33)
    tone = rng.random(4).astype(np.float32)
    base = 0.52 + (tone[sid] - 0.5) * 0.11
    r, gg, b = base * 0.95, base, base * 1.08
    cloud = value_noise(10, 4, SEED + 34)
    for a in (r, gg, b):
        a *= 0.93 + cloud * 0.15
        a[dj < 3.0] = 0.30
        a[(dj >= 3.0) & (dj < 9.0)] *= 0.94   # 缝边倒角
    save_jpg('paving-blue-stone', np.stack([r, gg, b], -1))

# ---------- 5. 沥青灰 paving-asphalt（外围道路） ----------
# 深灰基面 + 细骨料斑点 + 低频补丁；极低对比避免远距平铺重复感。
def bake_asphalt():
    base = np.full((SIZE, SIZE), 0.37, np.float32)
    patch = (value_noise(6, 3, SEED + 41) - 0.5) * 0.05
    fine = (value_noise(96, 2, SEED + 42) - 0.5) * 0.055
    g = base + patch + fine
    rng = np.random.default_rng(SEED + 43)
    dots = (rng.random((SIZE // 2, SIZE // 2)) > 0.986).repeat(2, 0).repeat(2, 1)
    r, gg, b = g * 1.02, g, g * 1.0
    for a in (r, gg, b):
        a[dots] += 0.10
    save_jpg('paving-asphalt', np.stack([r, gg, b], -1))

if __name__ == '__main__':
    bake_cobble()
    bake_brick()
    bake_pebble()
    bake_bluestone()
    bake_asphalt()
    print('BAKE PAVING DONE ->', OUTDIR)
