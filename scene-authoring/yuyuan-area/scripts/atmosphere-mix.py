#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality Q18/R1：beauty 大气透视的显示域混合（独立脚本，渲染器以系统 python3 子进程调用）。

设计动机（取证见 scripts/render-control-passes.py 的 wave14-pvquality 段）：Blender 4.5.1 的
Mist pass 恒输出 1.0 不可用；compositor 内混 beauty 行为异常；且 Blender 内置 python 无 PIL。
故 depth 由渲染器复用生产链路（Cycles Z pass → FileOutput BW16 PNG）渲出后，本脚本在
**系统 python3**（PIL + numpy）里做显示域混合并覆写 beauty PNG：

  fac = clip((z - startM) / depthM, 0, 1)；
  天空/背景判定（R1必修1 重做）：不再用「z ≥ far-tol」的深度阈值——BW16 编码 lsb=(far-near)/65535
  ≈ 4.6 mm，round 量化把 z∈[far-2.3mm, far) 的掠射远景表面与被裁天空编成同一批码（65533–65535），
  任何 tol 都只是移动雾/不雾条带的位置（pv01 末帧 y=62 x=600–949 亮线的根因），不能消除；
  改用同 pose 1 spp 无过滤的 **alpha 覆盖掩码**（渲染器 config_atmosphere_depth 的 RLayers.Alpha
  → 8-bit 灰度 PNG）：表面 α=1、被裁天空 α=0，判定与几何精确一致且不依赖深度码；
  有效雾化系数 = fac × α —— beauty 的 AA 边缘覆盖部分按覆盖率参与雾化，天空像素一字节不动；
  雾色 = beauty 帧顶部 2% 行的中位色（本帧天空实际显示色）——远景雾化带与紧邻背景像素同色，
  交界无缝（天空含太阳 glow 时雾随 glow）；
  out = beauty × (1 - fac·α) + fog × fac·α（在 sRGB 编码值域混合，混合系数与色彩空间无关）。
  雾色防护（R1 可选3）：顶部 2% 行被建筑遮挡时中位色会跳变——统计逐像素中位绝对偏差（MAD），
  任一通道 MAD > 24 记 fogSpreadWarn=true（只记录不改变行为；扩镜到顶部非天空构图前先换
  镜头级固定雾色，见 docs）。

mask_png 缺省时回退旧的深度阈值路径（fac[z ≥ far-background_tol]=0，tol 与 CLI 默认统一为
0.01 m）——仅为兼容直接调 mix() 的旧测试；正式渲染链路（run_atmosphere_mix）必传掩码。

CLI：python3 -X utf8 scripts/atmosphere-mix.py --beauty <png> --depth <png> --near M --far M
                   --start-m M --depth-m M [--mask <png>] [--background-tol M]
"""
import argparse
import os
import sys

FOG_SPREAD_WARN_MAD = 24.0   # 顶部样本 MAD 超过此值 → fogSpreadWarn（顶部被非天空占据/混色的防护阈值）


def mix(beauty_png, depth_png, near, far, start_m, depth_m, mask_png=None, background_tol=0.01):
    """显示域混合并覆写 beauty_png。返回统计 dict。"""
    import numpy as np
    from PIL import Image
    z = np.asarray(Image.open(depth_png), dtype=np.float64) / 65535.0 * (far - near) + near
    img = np.asarray(Image.open(beauty_png).convert('RGB'), dtype=np.float64)
    if z.shape[:2] != img.shape[:2]:
        raise SystemExit('E: atmosphere depth %s 与 beauty %s 尺寸不一致'
                         % (z.shape[:2], img.shape[:2]))
    fac = np.clip((z - start_m) / depth_m, 0.0, 1.0)
    st_extra = {}
    if mask_png is not None:
        alpha = np.asarray(Image.open(mask_png), dtype=np.float64) / 255.0
        if alpha.shape[:2] != img.shape[:2]:
            raise SystemExit('E: atmosphere mask %s 与 beauty %s 尺寸不一致'
                             % (alpha.shape[:2], img.shape[:2]))
        # R1必修1：alpha 精确区分被裁天空（α=0 不吃雾）与掠射远景表面（α=1 正常吃雾）。
        # 深度阈值路径的 16-bit 量化歧义区（raw 65533–65535 且 α=1 的真实表面）在这里被纠正。
        st_extra['farClipSaltPixels'] = int(((z >= far - background_tol) & (alpha > 0.5)).sum())
        eff = fac * alpha
        st_extra['skyFraction'] = round(float((alpha <= 0.5).mean()), 4)
    else:
        eff = fac
        eff[z >= far - background_tol] = 0.0
    top = img[:max(1, int(img.shape[0] * 0.02)), :, :].reshape(-1, 3)
    fog = np.median(top, axis=0)
    mad = float(np.median(np.abs(top - fog[None, None, :]), axis=0).max())
    out = img * (1.0 - eff[..., None]) + fog[None, None, :] * eff[..., None]
    Image.fromarray(np.clip(out.round(), 0, 255).astype('uint8'), 'RGB').save(beauty_png)
    st = {'startM': start_m, 'depthM': depth_m,
          'fogSampledRGB': [round(float(c), 1) for c in fog],
          'foggedFraction': round(float((eff > 0).mean()), 4),
          'topSpreadMAD': round(mad, 1),
          'fogSpreadWarn': bool(mad > FOG_SPREAD_WARN_MAD)}
    st.update(st_extra)
    return st


def main():
    ap = argparse.ArgumentParser(description='beauty 大气透视显示域混合（Q18/R1）')
    ap.add_argument('--beauty', required=True)
    ap.add_argument('--depth', required=True)
    ap.add_argument('--mask', default='')      # R1必修1：alpha 覆盖掩码（正式链路必传；缺省回退深度阈值）
    ap.add_argument('--near', type=float, required=True)
    ap.add_argument('--far', type=float, required=True)
    ap.add_argument('--start-m', type=float, required=True)
    ap.add_argument('--depth-m', type=float, required=True)
    ap.add_argument('--background-tol', type=float, default=0.01)   # 16-bit depth 量化 ~4.6mm/级
    a = ap.parse_args()
    st = mix(a.beauty, a.depth, a.near, a.far, a.start_m, a.depth_m,
             mask_png=(a.mask or None), background_tol=a.background_tol)
    import json as _json
    print('[atmosphere-mix] ' + _json.dumps(st), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
