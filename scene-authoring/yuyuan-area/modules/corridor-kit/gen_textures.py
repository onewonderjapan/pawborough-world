#!/usr/bin/env python3
"""corridor-kit 解析贴图生成（系统 python3 + PIL，非 Blender）。
1) 漏窗 alpha 格栅（分析图，非照片）
2) 由 source-kit 1K 贴图派生 512px 集（色彩 JPEG q85 / 数据图优化 PNG），
   控制四只 GLB 总字节 <= 2.5MB（Blender 导出会把 Non-Color 图重编码为 PNG）
运行：python3 gen_textures.py [OUT_DIR]
"""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'out-corridor-kit')
os.makedirs(OUT, exist_ok=True)

TEX_DIRS = [
    os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', 'asset-authoring', 'yuyuan-entry', 'source-kit', 'textures')),
    '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures',
]
TEX_DIR = next((d for d in TEX_DIRS if os.path.isdir(d)), None)
if not TEX_DIR:
    raise SystemExit('source-kit textures not found')

WOOD = (58, 42, 28, 255)

def lattice(path):
    """漏窗格栅 1.1x0.9 m -> 286x234 px（约 260 px/m）。十字格 + 中心海棠角。"""
    W, H = 286, 234
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bar = 9           # 0.035 m 格条
    frame = 12        # 边框条
    d.rectangle([0, 0, W - 1, H - 1], outline=WOOD, width=frame)
    ix0, iy0, ix1, iy1 = frame, frame, W - frame, H - frame
    cols, rows = 6, 4
    for c in range(1, cols):
        x = ix0 + (ix1 - ix0) * c // cols
        d.rectangle([x - bar // 2, iy0, x + bar // 2, iy1], fill=WOOD)
    for r in range(1, rows):
        y = iy0 + (iy1 - iy0) * r // rows
        d.rectangle([ix0, y - bar // 2, ix1, y + bar // 2], fill=WOOD)
    cx, cy, r = W // 2, H // 2, 26
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], outline=WOOD, width=bar)
    img.save(path)
    return os.path.getsize(path)

# 派生集：输出名 -> (源名, 模式, 尺寸)
DERIVE = {
    'roof-color.jpg': ('roof-color.jpg', 'jpg', 512),
    'roof-normal.png': ('roof-normal.png', 'png', 512),
    'wood-stain-color.jpg': ('wood-stain-color.jpg', 'jpg', 512),
    'Wood092_2K-JPG_NormalGL_1K.png': ('Wood092_2K-JPG_NormalGL_1K.jpg', 'png', 512),
    'PaintedPlaster017_2K-JPG_Color_1K.jpg': ('PaintedPlaster017_2K-JPG_Color_1K.jpg', 'jpg', 512),
    'PaintedPlaster017_2K-JPG_NormalGL_1K.png': ('PaintedPlaster017_2K-JPG_NormalGL_1K.jpg', 'png', 256),
}

def derive(outdir):
    d2 = os.path.join(outdir, 'textures-512')
    os.makedirs(d2, exist_ok=True)
    sizes = {}
    for out_name, (src, mode, dim) in DERIVE.items():
        im = Image.open(os.path.join(TEX_DIR, src))
        if im.mode != 'RGB':
            im = im.convert('RGB')
        im = im.resize((dim, dim), Image.LANCZOS)
        p = os.path.join(d2, out_name)
        if mode == 'jpg':
            im.save(p, 'JPEG', quality=85, optimize=True)
        else:
            im.save(p, 'PNG', optimize=True)
        sizes[out_name] = os.path.getsize(p)
    return sizes

if __name__ == '__main__':
    p = os.path.join(OUT, 'lattice-alpha.png')
    n = lattice(p)
    print('lattice-alpha.png', n, 'bytes')
    for k, v in derive(OUT).items():
        print('textures-512/' + k, v, 'bytes')

