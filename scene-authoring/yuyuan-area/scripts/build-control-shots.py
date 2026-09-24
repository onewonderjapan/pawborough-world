#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WP11 C2：三个 AI 视频控制层镜头的相机路径推导。

从冻结源重算（不读任何渲染产物）：
  - baseline/layout.json                     : 对象 id / footprint / polyline
  - $OUT_DIR/fangbang-route.json             : 方浜中路 mainStreet（v7 平移到地图坐标）
  - $OUT_DIR/commercial-route.json           : 不直接出点，仅校验路线存在
输出 $OUT_DIR/control-shots.json（render-control-passes.py 的输入），格式：
  {
    "version": 1, "width": 1280, "height": 720,
    "nearM": 0.3, "farM": 300.0,
    "eyeHeightM": 1.6,
    "coordinateNote": "全部坐标为地图系 [x, y高度, z]（与 out-zone/tour.json 同约定）；Blender 世界 = (x, -z, y)，glTF Y-up 世界 = 本文件坐标",
    "sources": {"fangbangRoute": "...", "layout": "baseline/layout.json"},
    "shots": [ { "id": ..., "description": ..., "frames": 24,
                 "eye": [[x,y,z] x frames], "target": [[x,y,z] x frames] } ]
  }

镜头：
  ① fangbang-westbound   方浜中路沿街西行到城隍庙山门（fangbang-route mainStreet，山门锚 = layout instance temple-shanmen）
  ② habao-plaza-pan      商城华宝楼前广场（中心广场）定点 360° 环视（华宝楼 = layout 华宝楼 bazaarBlock）
  ③ jiuqu-to-huxinting   九曲桥上走向湖心亭（layout jiuqu-bridge polyline -> huxin-ting 形心，桥面 0.55 m + 眼高 1.6 m）

用法：python3 scripts/build-control-shots.py [--out-zone out-zone] [--frames 24]
"""
import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EYE = 1.6            # GOAL 规定眼高
DECK = 0.55          # 九曲桥 deckY（build-scene buildZigzagBridge 默认 0.55，site kit 同值）
FANGBANG_WALK_M = 190.0   # 镜头① 行走弧长（24 帧 x ~8 m/帧）
LOOK_AHEAD_M = 8.0        # 行走镜头注视点前视距离（九曲桥 6 m）
PAN_DIST_M = 20.0         # 环视注视点半径
PAN_TARGET_H = 5.0        # 环视注视点高度（13.6 m 四层楼的下半段）
HUXIN_LOOK_H = 5.0        # 结尾看向湖心亭的注视高度（两层楼，楼下水上各留余量）


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def polyline_arc(pts):
    """累计弧长表。"""
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + math.dist(a, b))
    return acc


def point_at(pts, acc, s):
    """弧长 s 处的插值点（点在原折线上；超过末端沿最后一段方向外推，避免注视点与机位重合）。"""
    if s >= acc[-1]:
        last = pts[-1]
        prev = pts[-2] if len(pts) > 1 else last
        seg = acc[-1] - acc[-2] if len(acc) > 1 else 0.0
        if seg <= 1e-12:
            return list(last)
        t = (s - acc[-1]) / seg
        return [last[j] + (last[j] - prev[j]) * t for j in range(len(last))]
    s = max(0.0, s)
    for i in range(len(pts) - 1):
        seg = acc[i + 1] - acc[i]
        if seg <= 1e-12:
            continue
        if s <= acc[i + 1] + 1e-9:
            t = (s - acc[i]) / seg
            return [pts[i][j] + (pts[i + 1][j] - pts[i][j]) * t for j in range(len(pts[i]))]
    return list(pts[-1])


def resample(pts, n, s0=0.0, s1=None):
    """[s0, s1] 弧长段等距取 n 个点。"""
    acc = polyline_arc(pts)
    s1 = acc[-1] if s1 is None else s1
    if n == 1:
        return [point_at(pts, acc, s0)]
    return [point_at(pts, acc, s0 + (s1 - s0) * k / (n - 1)) for k in range(n)]


def point_in_poly(pt, poly):
    """射线法（平面坐标 [x, z]）。"""
    x, z = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i][0], poly[i][1]
        xj, zj = poly[j][0], poly[j][1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def centroid(poly):
    n = len(poly)
    return [sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-zone', default=os.environ.get('OUT_DIR', 'out-zone'))
    ap.add_argument('--frames', type=int, default=24)
    args = ap.parse_args()
    oz = args.out_zone if os.path.isabs(args.out_zone) else os.path.join(ROOT, args.out_zone)

    layout = load_json(os.path.join(ROOT, 'baseline', 'layout.json'))
    fb_route = load_json(os.path.join(oz, 'fangbang-route.json'))
    commercial = load_json(os.path.join(oz, 'commercial-route.json'))
    objs = {o['id']: o for o in layout['objects']}
    insts = {i['id']: i for i in layout['instances']}
    N = args.frames
    errors = []

    # ---------- 镜头① 方浜中路西行到山门 ----------
    ms = [[p[0], p[2]] for p in fb_route['mainStreet']]     # 路线点是 [x, y(=0), z]
    shanmen = insts['temple-shanmen']['position']            # layout 重算：山门锚 [x, z]
    # mainStreet 的 E-W 段在庙前转角（idx 297 附近）折向南；山门在转角西南、被街角店块遮挡，
    # 但物理街道与山门视廊在折线终点以西仍在（实测 (-78, 22) 处山门可见）。
    # 取 E-W 段 + 沿末段方向 12 m 外推作为行走折线，停步点在转角后 8 m（与山门齐平偏西），末 6 帧转向山门。
    sj = min((i for i in range(1, len(ms)) if ms[i][0] > ms[i - 1][0] + 0.3 and i > len(ms) * 0.5),
             default=None)
    if sj is None or sj < 10:
        sj = min(range(len(ms)), key=lambda i: math.dist(ms[i], shanmen))
    # 找 E-W 段终点：最后一个 x 单调西行、且下一段急转（z 变化 >> x 变化）的折点
    corner = len(ms) - 1
    for i in range(1, len(ms)):
        dx = ms[i][0] - ms[i - 1][0]
        dz = ms[i][1] - ms[i - 1][1]
        if abs(dz) > abs(dx) and ms[i][0] < -50:   # 首次南向占优段（E-W 街在庙前折向南）
            corner = i - 1
            break
    leg = ms[:corner + 1]
    tail_dir = [(leg[-1][0] - leg[-2][0]), (leg[-1][1] - leg[-2][1])]
    tl = math.hypot(*tail_dir)
    tail_dir = [tail_dir[0] / tl, tail_dir[1] / tl]
    walk_poly = leg + [[leg[-1][0] + tail_dir[0] * 12.0, leg[-1][1] + tail_dir[1] * 12.0]]
    acc = polyline_arc(walk_poly)
    s_corner = acc[len(leg) - 1]
    s_stop = s_corner + 8.0
    s0 = max(0.0, s_stop - FANGBANG_WALK_M)
    walk = resample(walk_poly, N, s0, s_stop)
    fb_eye, fb_tgt = [], []
    for k, p in enumerate(walk):
        s = s0 + (s_stop - s0) * k / (N - 1)
        la = point_at(walk_poly, acc, min(s + LOOK_AHEAD_M, s_stop))
        w = max(0.0, (k - (N - 7)) / 6.0)                    # 末 6 帧注视点平滑转向山门
        w = w * w * (3 - 2 * w)
        tx = la[0] * (1 - w) + shanmen[0] * w
        tz = la[1] * (1 - w) + shanmen[1] * w
        th = EYE * (1 - w) + 4.0 * w
        fb_eye.append([p[0], EYE, p[1]])
        fb_tgt.append([tx, th, tz])
    if math.dist(walk[-1], shanmen) > 15:
        errors.append('镜头①末点离山门锚 %.1f m > 12' % math.dist(walk[-1], shanmen))

    # ---------- 镜头② 华宝楼前广场环视 ----------
    habao = next(o for o in layout['objects'] if o.get('name') == '华宝楼' and o['kind'] == 'bazaarBlock')
    hb_fp = habao['geometry']['footprint']
    if hb_fp[0] == hb_fp[-1]:
        hb_fp = hb_fp[:-1]
    hc = centroid(hb_fp)
    plaza = objs['plaza-428199199']['geometry']['footprint']   # 中心广场（贴华宝楼南立面）
    pc = centroid(plaza)
    # 机位 = 前街边（frontEdges 中 street=中心广场的最长边）中点沿外法线外推 D m（广场内）；
    # 注视半径 = D - 3（注视点悬在立面前 3 m），注视高度 5 m。避免"机位贴立面、注视点穿楼"。
    front = None
    for e in habao.get('frontEdges', []):
        if e.get('street') == '中心广场' and (front is None or e['lenM'] > front['lenM']):
            front = e
    if front is not None:
        (ax, az), (bx, bz) = front['edge'][0], front['edge'][1]
        mx, mz = (ax + bx) / 2, (az + bz) / 2
    else:
        mx, mz = hc[0], hc[1]
    # 机位 = 中心广场形心（围合院落中心，环视各向距离最均衡；形心落在多边形外则回退到
    # 前街边法线搜索），起始正对华宝楼前街边中点，360° 水平环视。
    pos = pc if point_in_poly(pc, plaza) else None
    if pos is None:
        nd = math.hypot(*front['dir'])
        nx, nz = front['dir'][0] / nd, front['dir'][1] / nd
        for D in range(26, 13, -1):
            p = [mx + nx * D, mz + nz * D]
            if point_in_poly(p, plaza):
                pos = p
                break
    if pos is None:
        errors.append('镜头②未能在中心广场内找到环视机位')
        pos = pc
    pan_r = PAN_DIST_M
    yaw0 = math.atan2(mx - pos[0], mz - pos[1])                # 起始正对华宝楼前街边中点
    hb_eye, hb_tgt = [], []
    for k in range(N):
        yaw = yaw0 + 2 * math.pi * k / N                        # 360° 环视
        t = [pos[0] + pan_r * math.sin(yaw), pos[1] + pan_r * math.cos(yaw)]
        hb_eye.append([pos[0], EYE, pos[1]])
        hb_tgt.append([t[0], EYE, t[1]])   # 水平注视：环视半圈是广场/街景，仰视会扫成天空

    # ---------- 镜头③ 九曲桥走向湖心亭 ----------
    jp = objs['jiuqu-bridge']['geometry']['polyline']
    hx = objs['huxin-ting']['geometry']['footprint']
    hxc = centroid(hx)
    jacc = polyline_arc(jp)

    def edge_dist(p):
        """点到 footprint 轮廓边的最近距离（走向亭子边缘，不走进亭子里）。"""
        best = 1e9
        for a, b in zip(hx, hx[1:]):
            ax, az = a[0], a[1]
            bx, bz = b[0], b[1]
            abx, abz = bx - ax, bz - az
            t = max(0.0, min(1.0, ((p[0] - ax) * abx + (p[1] - az) * abz) / (abx * abx + abz * abz + 1e-12)))
            best = min(best, math.dist(p, [ax + abx * t, az + abz * t]))
        return best

    end_i = min(range(len(jp)), key=lambda i: edge_dist(jp[i]))
    while end_i > 0 and edge_dist(jp[end_i]) < 16.0:         # 停步点离亭子轮廓 ≥16 m（15 m 宽的亭子要全亭入画）
        end_i -= 1
    s_end = jacc[end_i]
    jw = resample(jp, N, 0.0, s_end)
    jq_eye, jq_tgt = [], []
    eye_h = DECK + EYE
    for k, p in enumerate(jw):
        s = s_end * k / (N - 1)
        la = point_at(jp, jacc, s + 6.0)             # 末端沿桥向外推
        w = max(0.0, (k - (N - 7)) / 6.0)                       # 末 6 帧注视点平滑转向湖心亭
        w = w * w * (3 - 2 * w)
        tx = la[0] * (1 - w) + hxc[0] * w
        tz = la[1] * (1 - w) + hxc[1] * w
        th = eye_h * (1 - w) + HUXIN_LOOK_H * w
        jq_eye.append([p[0], eye_h, p[1]])
        jq_tgt.append([tx, th, tz])
    if math.dist(jw[-1], hxc) > 25:
        errors.append('镜头③末点离湖心亭形心 %.1f m > 25' % math.dist(jw[-1], hxc))

    if not any(r.get('pass') for r in commercial.get('routes', [])):
        errors.append('commercial-route.json 无 pass 路线（校验源数据异常）')

    doc = {
        'version': 1,
        'width': 1280, 'height': 720,
        'nearM': 0.3, 'farM': 300.0,
        'eyeHeightM': EYE,
        'coordinateNote': '坐标为地图系 [x, y高度, z]（同 out-zone/tour.json）；Blender 世界=(x,-z,y)；glTF Y-up 世界=本文件坐标',
        'sources': {
            'layout': 'baseline/layout.json',
            'fangbangRoute': os.path.relpath(os.path.join(oz, 'fangbang-route.json'), ROOT),
            'commercialRoute': os.path.relpath(os.path.join(oz, 'commercial-route.json'), ROOT),
            'shanmenJunctionIdx': sj,
            'jiuquEndIdx': end_i,
        },
        'shots': [
            {'id': 'fangbang-westbound',
             'description': '方浜中路沿街西行过庙前转角 8 m（与山门齐平），末 6 帧注视点转向城隍庙山门（路线 mainStreet 重采样 %.0f m，眼高 1.6 m，注视点前视 %.0f m）' % (FANGBANG_WALK_M, LOOK_AHEAD_M),
             'frames': N, 'eye': fb_eye, 'target': fb_tgt},
            {'id': 'habao-plaza-pan',
             'description': '商城华宝楼前中心广场定点 360° 环视（起始正对华宝楼，注视半径 %.0f m 高 %.0f m）' % (PAN_DIST_M, PAN_TARGET_H),
             'frames': N, 'eye': hb_eye, 'target': hb_tgt},
            {'id': 'jiuqu-to-huxinting',
             'description': '九曲桥上走向湖心亭（桥面 0.55 m + 眼高 1.6 m，停步亭轮廓 16 m 外全亭入画，末 6 帧注视点转向湖心亭）',
             'frames': N, 'eye': jq_eye, 'target': jq_tgt},
        ],
    }
    if errors:
        for e in errors:
            print('FAIL', e)
        sys.exit(1)
    out = os.path.join(oz, 'control-shots.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('control-shots.json:', ', '.join('%s x%d' % (s['id'], s['frames']) for s in doc['shots']))
    print('  shanmen junction idx', sj, '(%0.1f, %0.1f)' % (ms[sj][0], ms[sj][1]),
          '| E-W corner idx', corner, '| walk %.0f m' % (s_stop - s0))
    print('  habao cam (%0.2f, %0.2f) pan-r %.1f m inside-plaza %s'
          % (pos[0], pos[1], pan_r, point_in_poly(pos, plaza)))
    print('  jiuqu end idx', end_i, 'arc %.1f m -> huxin (%0.2f, %0.2f)' % (s_end, hxc[0], hxc[1]))


if __name__ == '__main__':
    main()
