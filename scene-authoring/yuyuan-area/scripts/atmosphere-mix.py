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
  远裁边界 AA 渗漏修复（R1必修1 v2，末帧亮线残余根因）：beauty 像素过滤把边界行的亮色远景
  渗入「中心射线是天空」的像素（1 spp 掩码判其为天空），留 1 行亮边。修法：α=0 且 8 邻域存在
  fac≥FAR_BAND_FAC 远裁边界带的像素 eff=1——设计上 start+depth=far 使 clip 边缘雾因子=1，
  这些像素本就该全雾；紧邻普通建筑剪影（邻域 fac 低）的天空不受影响；
  雾色 = 远裁边界行上方净天空带（SKY_SAMPLE_ROWS 行）的中位——雾化带与它实际相接，交界真正
  无缝（顶部 2% 是天顶向取样，天空有垂直渐变时与地平线本地天空有色差）；净天空样本不足
  （SKY_SAMPLE_MIN_PX）回退顶部 2% 中位，fogSource 记录来源；
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
FAR_BAND_FAC = 0.875         # 远裁边界带：fac ≥ 0.875（pv01 默认 start/depth 下 z ≥ 290 m = far−10 m）
CUT_BAND_ROWS = 3            # 裁切主线（cut_row）±该行数内的天空 AA 渗漏像素才做 eff=1 修复
SKY_SAMPLE_ROWS = 24         # 雾色采样带：裁切主线上方的净天空高度（行）
SKY_SAMPLE_MIN_PX = 16       # 净天空样本少于该像素数 → 回退顶部 2% 取色


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
    boundary = None
    if mask_png is not None:
        alpha = np.asarray(Image.open(mask_png), dtype=np.float64) / 255.0
        if alpha.shape[:2] != img.shape[:2]:
            raise SystemExit('E: atmosphere mask %s 与 beauty %s 尺寸不一致'
                             % (alpha.shape[:2], img.shape[:2]))
        # R1必修1：alpha 精确区分被裁天空（α=0 不吃雾）与掠射远景表面（α=1 正常吃雾）。
        # 深度阈值路径的 16-bit 量化歧义区（raw 65533–65535 且 α=1 的真实表面）在这里被纠正。
        st_extra['farClipSaltPixels'] = int(((z >= far - background_tol) & (alpha > 0.5)).sum())
        eff = fac * alpha
        sky_m = alpha <= 0.5
        st_extra['skyFraction'] = round(float(sky_m.mean()), 4)
        # R1必修1（v2，末帧亮线残余根因）：beauty 的像素过滤把远裁边界的亮色远景（夜档月光
        # 照亮的远地面 raw≈(60,80,127)）渗入「中心射线是天空」的 AA 行——1 spp 无过滤掩码把
        # 这类像素判成天空（α=0 不吃雾），留下 1 行亮边（pv01 night frame-143 实测：上行天空
        # (2,1,14) / 渗漏行 (15,30,62) / 下行雾化地面 (4,2,14)）。修法与 beauty 采样一致化：
        # α=0 且 8 邻域存在远裁边界带（fac≥FAR_BAND_FAC）表面的像素，本就处于设计上「全雾」
        # 的 far 边缘（start+depth=far ⇒ clip 边缘雾因子=1），eff=1 直接收敛到雾色；而紧邻
        # 普通建筑剪影的天空（邻域 fac 低）不受影响，保留正常 AA 边缘。
        # far_band 只算「远裁边界带内的表面」——被裁天空自身 z=far（fac=1），不加 α 限定会把
        # 整片天空都当成边界带（实测 frame-143 会误标 68703 个天空像素）。
        far_band = (alpha > 0.5) & (fac >= FAR_BAND_FAC)
        any_far = bool(far_band.any())
        # 裁切主线 = 远带表面像素最多的行（far clip 切过地面/道路的全宽行）；远处的塔尖等
        # 离群远带表面（行内像素少）不算——它们的 AA 边缘是正常剪影，不需要也不应该全雾。
        cut_row = int(far_band.sum(axis=1).argmax()) if any_far else -1
        nb = np.zeros_like(far_band)
        nb[1:, :] |= far_band[:-1, :]
        nb[:-1, :] |= far_band[1:, :]
        nb[:, 1:] |= far_band[:, :-1]
        nb[:, :-1] |= far_band[:, 1:]
        nb[1:, 1:] |= far_band[:-1, :-1]
        nb[1:, :-1] |= far_band[:-1, 1:]
        nb[:-1, 1:] |= far_band[1:, :-1]
        nb[:-1, :-1] |= far_band[1:, 1:]
        near_cut = np.zeros_like(far_band)
        if any_far:
            near_cut[max(0, cut_row - CUT_BAND_ROWS):cut_row + CUT_BAND_ROWS + 1, :] = True
        boundary = sky_m & nb & near_cut
        st_extra['boundaryRow'] = cut_row
        st_extra['boundarySkyPixels'] = int(boundary.sum())
    else:
        eff = fac
        eff[z >= far - background_tol] = 0.0
    # 雾色：优先取远裁边界行上方的净天空带中位——雾化带与它实际相接，交界才真正无缝。
    # 顶部 2% 是天顶向取样，天空有垂直渐变时与地平线本地天空有色差（=旧亮线的放大器）。
    # 净天空样本不足（地平线被建筑全遮挡等）回退顶部 2% 并记录 fogSource。
    bnd_row = st_extra.get('boundaryRow', -1)
    src = None
    if bnd_row > 0:
        r0 = max(0, bnd_row - SKY_SAMPLE_ROWS)
        if mask_png is not None:
            sel = sky_m[r0:bnd_row, :]
        else:
            sel = z[r0:bnd_row, :] >= far - background_tol
        if int(sel.sum()) >= SKY_SAMPLE_MIN_PX:
            src = img[r0:bnd_row, :, :][sel]
    if src is None:
        src = img[:max(1, int(img.shape[0] * 0.02)), :, :].reshape(-1, 3)
        fog_source = 'top-band'
    else:
        fog_source = 'horizon-sky'
    fog = np.median(src, axis=0)
    mad = float(np.median(np.abs(src - fog[None, :]), axis=0).max())
    if boundary is not None:
        eff[boundary] = 1.0
    out = img * (1.0 - eff[..., None]) + fog[None, None, :] * eff[..., None]
    Image.fromarray(np.clip(out.round(), 0, 255).astype('uint8'), 'RGB').save(beauty_png)
    st = {'startM': start_m, 'depthM': depth_m,
          'fogSampledRGB': [round(float(c), 1) for c in fog],
          'fogSource': fog_source,
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
