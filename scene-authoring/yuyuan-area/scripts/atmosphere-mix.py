#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality Q18：beauty 大气透视的显示域混合（独立脚本，渲染器以系统 python3 子进程调用）。

设计动机（取证见 scripts/render-control-passes.py 的 wave14-pvquality 段）：Blender 4.5.1 的
Mist pass 恒输出 1.0 不可用；compositor 内混 beauty 行为异常；且 Blender 内置 python 无 PIL。
故 depth 由渲染器复用生产链路（Cycles Z pass → FileOutput BW16 PNG）渲出后，本脚本在
**系统 python3**（PIL + numpy）里做显示域混合并覆写 beauty PNG：

  fac = clip((z - startM) / depthM, 0, 1)，被 far 裁掉的背景（z 精确 = far 的天空像素，
  16-bit 量化下 z ≥ far-tol，tol 取 0.01 m——0.5 m 会误杀 z∈[299.5,300] 的真实远景地面，
  正是地平线带）不吃雾；
  雾色 = beauty 帧顶部 2% 行的中位色（本帧天空实际显示色）——远景雾化带与紧邻背景像素同色，
  交界无缝（天空含太阳 glow 时雾随 glow）；
  out = beauty × (1 - fac) + fog × fac（在 sRGB 编码值域混合，混合系数与色彩空间无关，
  编码值域线性混合与真实大气透视的显示效果差异可忽略且随 fac→1 收敛到天空精确色）。

CLI：python3 -X utf8 scripts/atmosphere-mix.py --beauty <png> --depth <png> --near M --far M
                   --start-m M --depth-m M [--background-tol M]
"""
import argparse
import os
import sys


def mix(beauty_png, depth_png, near, far, start_m, depth_m, background_tol=0.5):
    """显示域混合并覆写 beauty_png。返回统计 dict。"""
    import numpy as np
    from PIL import Image
    z = np.asarray(Image.open(depth_png), dtype=np.float64) / 65535.0 * (far - near) + near
    img = np.asarray(Image.open(beauty_png).convert('RGB'), dtype=np.float64)
    if z.shape[:2] != img.shape[:2]:
        raise SystemExit('E: atmosphere depth %s 与 beauty %s 尺寸不一致'
                         % (z.shape[:2], img.shape[:2]))
    fac = np.clip((z - start_m) / depth_m, 0.0, 1.0)
    fac[z >= far - background_tol] = 0.0
    top = img[:max(1, int(img.shape[0] * 0.02)), :, :].reshape(-1, 3)
    fog = np.median(top, axis=0)
    out = img * (1.0 - fac[..., None]) + fog[None, None, :] * fac[..., None]
    Image.fromarray(np.clip(out.round(), 0, 255).astype('uint8'), 'RGB').save(beauty_png)
    return {'startM': start_m, 'depthM': depth_m,
            'fogSampledRGB': [round(float(c), 1) for c in fog],
            'foggedFraction': round(float((fac > 0).mean()), 4)}


def main():
    ap = argparse.ArgumentParser(description='beauty 大气透视显示域混合（Q18）')
    ap.add_argument('--beauty', required=True)
    ap.add_argument('--depth', required=True)
    ap.add_argument('--near', type=float, required=True)
    ap.add_argument('--far', type=float, required=True)
    ap.add_argument('--start-m', type=float, required=True)
    ap.add_argument('--depth-m', type=float, required=True)
    ap.add_argument('--background-tol', type=float, default=0.01)   # 16-bit depth 量化 ~4.6mm/级：只放行 z==far 的被裁天空像素
    a = ap.parse_args()
    st = mix(a.beauty, a.depth, a.near, a.far, a.start_m, a.depth_m, a.background_tol)
    import json as _json
    print('[atmosphere-mix] ' + _json.dumps(st), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
