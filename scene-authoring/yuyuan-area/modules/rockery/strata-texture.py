#!/usr/bin/env python3
"""strata-texture.py — 大假山黄石层理贴图烘焙（system python3 + PIL；wave13-matdetail M2）。

颜色：原 tint 贴图 × 层理乘子（条带沿贴图 v，cube-UV tileM 2.5 下竖直侧面的
v = 世界高度 / 2.5，条带即水平层带，周期 = strata_period 0.8 m；带缘随 u 波状
扰动 ±WAVE_M 米，沟核 ×GROOVE_DARK / 层顶 ×CREST_LIGHT / 带内细噪声 ±FINE_AMP）。
ORM：G = 粗糙度 / roughnessFactor（面带 0.85 / 沟带 0.95）。

用法：python3 strata-texture.py --src <tint jpg> --color <out jpg> --orm <out png>
"""
import argparse
import math
import os

from PIL import Image

STRATA_PERIOD = 0.8
TILE_M = 2.5
GROOVE_DARK = 0.70
CREST_LIGHT = 1.08
FINE_AMP = 0.03
WAVE_M = 0.06
ROUGH_FACE = 0.85
ROUGH_GROOVE = 0.95
ROUGH_FACTOR = 0.9


def hash01(*args):
    h = math.sin(sum(a * c for a, c in zip(args, (12.9898, 78.233, 37.719, 93.989)))) * 43758.5453
    return h - math.floor(h)


def vnoise(x, seed=0.0):
    ix = math.floor(x)
    fx = x - ix
    u = fx * fx * (3 - 2 * fx)
    a = hash01(ix, seed)
    b = hash01(ix + 1, seed)
    return a + (b - a) * u


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def strata_curve(band):
    # 沟 = 两个反向 smoothstep 的乘积（0.35–0.65 平台 1，两侧面带 0）；
    # m = 1 - (1-GROOVE_DARK)×groove（沟暗 / 面带 1 / 层顶 ×CREST_LIGHT）
    groove = smoothstep(0.30, 0.50, band) * smoothstep(0.70, 0.50, band)
    m = 1.0 - (1.0 - GROOVE_DARK) * groove
    m *= 1.0 + (CREST_LIGHT - 1.0) * smoothstep(0.85, 1.0, band)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--color', required=True)
    ap.add_argument('--orm', required=True)
    a = ap.parse_args()

    base = Image.open(a.src).convert('RGB')
    w, h = base.size
    bp = base.load()
    out = Image.new('RGB', (w, h))
    op = out.load()
    lm_sum = lm_sq = 0.0
    n = 0
    bands_per_tile = TILE_M / STRATA_PERIOD
    for y in range(h):
        v = y / h
        for x in range(w):
            u = x / w
            wob = (vnoise(u * 24.0, seed=1.0) - 0.5) * 2 * WAVE_M \
                + (vnoise(u * 61.0, seed=2.0) - 0.5) * WAVE_M
            band = ((v + wob / TILE_M) * bands_per_tile) % 1.0
            m = strata_curve(band)
            m *= 1.0 + FINE_AMP * (hash01(x * 0.371, y * 0.517) - 0.5) * 2
            r, g, b = bp[x, y]
            op[x, y] = (min(255, round(r * m)), min(255, round(g * m)), min(255, round(b * m)))
            lum = 0.2126 * op[x, y][0] + 0.7152 * op[x, y][1] + 0.0722 * op[x, y][2]
            lm_sum += lum
            lm_sq += lum * lum
            n += 1
    out.save(a.color, 'PNG')       # PNG：node 测试端 zlib 可直接解码（JPEG 无内置解码器）
    mean = lm_sum / n
    std = math.sqrt(max(0.0, lm_sq / n - mean * mean))

    ow, oh = 1024, 64
    orm = Image.new('RGB', (ow, oh))
    mp = orm.load()
    for y in range(oh):
        v = y / oh
        for x in range(ow):
            band = (v * bands_per_tile) % 1.0
            # groove 与颜色层理同一 seat 定义（0=面带 1=沟核），粗糙度 0.85–0.95
            groove = 1.0 - smoothstep(0.30, 0.50, band) * smoothstep(0.70, 0.50, band)
            rough = ROUGH_FACE + (ROUGH_GROOVE - ROUGH_FACE) * groove
            g = min(1.0, rough / ROUGH_FACTOR)
            mp[x, y] = (255, round(g * 255), 0)
    orm.save(a.orm, 'PNG')
    print(f'STRATA_TEX_DONE color={a.color} orm={a.orm} size={w}x{h} '
          f'lumaMean={mean:.2f} lumaStd={std:.2f}')


if __name__ == '__main__':
    main()
