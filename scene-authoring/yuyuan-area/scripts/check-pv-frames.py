#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard：PV 预览帧的渲染侧取景检查（首 / 中 / 末 3 帧，render-control-passes.py 四通道输出）。

每帧从四通道真值统计（与 check-control-passes.py 同一套编码与 LUT 反查 ±2 口径）：
  targetPct   取景目标（镜头 targetId + 其 facadeBay 立面开间）在分割图上的像素占比；
  skyPct      天空（depth = far = 65535）占比；
  nearWallPct 近景墙：视轴深度 < NEAR_M 且法线不朝上（|n_y| < 0.7）的像素占比——镜头贴墙；
  flatPct     朝上的平面（法线 n_y > 0.95：地面 / 路面 / 广场 / 平屋面；水面不计）占比——空地面的上界；
  waterPct    水面（分割 id 属于 layout kind=water）占比——池面是园林镜头的主体，不算空地；
  flatNearPct 朝上平面（不含水面）且深度 < FLAT_NEAR_M（近处空地，航拍镜头的院落不计）。
判定（写进报告 flags；看图后由人决定是否删镜，删镜理由写进 STORYBOARD）：
  WALL   任一帧 nearWallPct > NEAR_WALL_MAX；
  GROUND 任一帧 flatNearPct > FLAT_NEAR_MAX（地面 / 升降镜头）或 flatPct > FLAT_MAX（任意镜头）；
  TARGET 末帧 targetPct < 镜头 minTargetFrac（缺省 5%，与 check-control-passes 终帧门槛同）；
  BLANK  beauty 亮度 std < 2/255 或主色 > 95%（COMMON 空白帧守卫）。

用法：python3 scripts/check-pv-frames.py --control <四通道目录> --cameras <fml 相机 json> --report <json>
"""
import argparse
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEAR_M = 2.5
NEAR_WALL_MAX = 0.25
FLAT_NEAR_M = 12.0
FLAT_NEAR_MAX = 0.35
FLAT_MAX = 0.55
TARGET_MIN_DEFAULT = 0.05


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', required=True)
    ap.add_argument('--cameras', required=True)
    ap.add_argument('--report', required=True)
    a = ap.parse_args()
    cams = load(a.cameras)
    lut = load(os.path.join(a.control, 'segmentation-lut.json'))
    layout = load(os.path.join(ROOT, 'baseline', 'layout.json'))
    bays = {}
    water_ids = [o['id'] for o in layout['objects'] if o['kind'] == 'water']
    for o in layout['objects']:
        if o.get('parentBuilding'):
            bays.setdefault(o['parentBuilding'], []).append(o['id'])
    near, far = cams['nearM'], cams['farM']
    res = {'control': a.control, 'thresholds': {'NEAR_M': NEAR_M, 'NEAR_WALL_MAX': NEAR_WALL_MAX, 'FLAT_NEAR_M': FLAT_NEAR_M,
                                                'FLAT_NEAR_MAX': FLAT_NEAR_MAX, 'FLAT_MAX': FLAT_MAX, 'TARGET_MIN_DEFAULT': TARGET_MIN_DEFAULT},
           'shots': {}, 'flagged': []}
    for s in cams['shots']:
        sid = s['id']
        ids = [s['targetId']] + bays.get(s['targetId'], [])
        wcols = np.array([lut['idToRgb'][i] for i in water_ids if i in lut['idToRgb']] or [[-99, -99, -99]], dtype=np.int16)
        cols = np.array([lut['idToRgb'][i] for i in ids if i in lut['idToRgb']] or [[-99, -99, -99]], dtype=np.int16)
        frames, flags = [], set()
        for k in range(s['frames']):
            base = os.path.join(a.control, sid)
            seg = np.asarray(Image.open(os.path.join(base, 'segmentation', 'frame-%03d.png' % k)).convert('RGB'), dtype=np.int16)
            dep = np.asarray(Image.open(os.path.join(base, 'depth', 'frame-%03d.png' % k)), dtype=np.float64)
            nor = np.asarray(Image.open(os.path.join(base, 'normal', 'frame-%03d.png' % k)).convert('RGB'), dtype=np.float64)
            bea = np.asarray(Image.open(os.path.join(base, 'beauty', 'frame-%03d.png' % k)).convert('L'), dtype=np.float64)
            tmask = np.zeros(seg.shape[:2], bool)
            for c in cols:
                tmask |= np.abs(seg - c).max(axis=2) <= 2
            wmask = np.zeros(seg.shape[:2], bool)
            for c in wcols:
                wmask |= np.abs(seg - c).max(axis=2) <= 2
            sky = dep >= 65535
            z = near + dep / 65535.0 * (far - near)
            valid = nor.sum(axis=2) > 0
            ny = nor[..., 1] / 255.0 * 2 - 1
            up = valid & (ny > 0.95) & ~wmask
            nearwall = (~sky) & (z < NEAR_M) & valid & (np.abs(ny) < 0.7)
            flatnear = up & (z < FLAT_NEAR_M)
            vals, counts = np.unique(bea.astype(np.uint8), return_counts=True)
            fr = {'k': k, 'sourceFrame': (s.get('sourceFrames') or [None] * s['frames'])[k],
                  'targetPct': round(100 * tmask.mean(), 2), 'skyPct': round(100 * sky.mean(), 2),
                  'nearWallPct': round(100 * nearwall.mean(), 2), 'flatPct': round(100 * up.mean(), 2), 'waterPct': round(100 * wmask.mean(), 2),
                  'flatNearPct': round(100 * flatnear.mean(), 2),
                  'beautyStd': round(float(bea.std()), 2), 'beautyDominant': round(float(counts.max() / counts.sum()), 3)}
            frames.append(fr)
            if fr['nearWallPct'] > 100 * NEAR_WALL_MAX:
                flags.add('WALL')
            if (s.get('camClass') in ('ground', 'crane', 'raised') and fr['flatNearPct'] > 100 * FLAT_NEAR_MAX) or fr['flatPct'] > 100 * FLAT_MAX:
                flags.add('GROUND')
            if fr['beautyStd'] < 2 or fr['beautyDominant'] > 0.95:
                flags.add('BLANK')
        tmin = s.get('minTargetFrac', TARGET_MIN_DEFAULT)
        if frames[-1]['targetPct'] < 100 * tmin:
            flags.add('TARGET')
        res['shots'][sid] = {'no': s.get('no'), 'status': s.get('status'), 'camClass': s.get('camClass'), 'targetId': s['targetId'],
                             'targetMinPct': round(100 * tmin, 2), 'frames': frames, 'flags': sorted(flags)}
        if flags:
            res['flagged'].append({'id': sid, 'flags': sorted(flags)})
        print('%02d %-24s %-7s end target %5.1f%% | sky %s | nearWall %s | flat %s | water %s | flatNear %s %s' % (
            s.get('no', 0), sid, s.get('camClass'), frames[-1]['targetPct'],
            '/'.join('%.0f' % f['skyPct'] for f in frames), '/'.join('%.0f' % f['nearWallPct'] for f in frames),
            '/'.join('%.0f' % f['flatPct'] for f in frames), '/'.join('%.0f' % f['waterPct'] for f in frames), '/'.join('%.0f' % f['flatNearPct'] for f in frames),
            ('FLAGS ' + ','.join(sorted(flags))) if flags else ''))
    res['status'] = 'flagged' if res['flagged'] else 'pass'
    with open(a.report, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('check-pv-frames:', res['status'], len(res['flagged']), 'flagged')


if __name__ == '__main__':
    main()
