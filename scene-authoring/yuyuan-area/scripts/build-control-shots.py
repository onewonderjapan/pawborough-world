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
                 "targetId": <layout id>, "targetName": ...,   # R1：镜头声明的取景目标（可见性断言的对象）
                 "eye": [[x,y,z] x frames], "target": [[x,y,z] x frames] } ]
  }
  （"target" 是逐帧注视点；取景目标对象是 "targetId"。）

镜头：
  ① fangbang-westbound   方浜中路沿街西行到城隍庙山门（fangbang-route mainStreet，山门锚 = layout instance temple-shanmen）
  ② habao-plaza-pan      商城华宝楼前中心广场沿弧线环视（R1：绕楼包围盒中心 R=40 m、30° 弧、18 mm 逐帧整楼入画；
                         BAZAAR_TOWERS=1 时目标高取华宝楼套件参数 24.3 m，注视点随之上移；弧线机位两变体相同）
  ③ jiuqu-to-huxinting   九曲桥上走向湖心亭（R1：layout jiuqu-bridge 中线滑动平均切角、机位高 4.0 m、35 mm、
                         注视锁定 huxin-ting 形心，停步离亭形心 22 m）
  每个镜头带 targetId（取景目标）与可选 lensMm（焦距，缺省 50 mm）；可见性断言见 tests/control-shots-test.mjs R1-2。

用法：python3 scripts/build-control-shots.py [--out-zone out-zone] [--frames 24]
      BAZAAR_TOWERS=1 python3 scripts/build-control-shots.py --out-zone out-zone-towers   # 华宝楼塔楼变体
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
# 镜头② R1：沿弧线环视（取值依据见 main() 镜头②注释；可见性由 tests/control-shots-test.mjs R1-2 断言）
HB_LENS_MM = 18.0         # 焦距（36 mm 横幅传感器）：水平 fov 90°
HB_ARC_R = 40.0           # 弧半径（圆心 = 华宝楼 footprint 包围盒中心）
HB_ARC_A0 = 6.0           # 起始方位角（度；0 = 正南 -z，正 = 东）
HB_ARC_A1 = -24.0         # 终止方位角（西南，30° 弧）
# 镜头③ R1：升高机位 + 切角横移
JQ_CAM_Y = 4.0            # 机位绝对高（桥面 0.55 + 3.45 m）
JQ_LENS_MM = 35.0
JQ_END_DIST = 22.0        # 停步点离湖心亭形心（GOAL 15–25 m）
JQ_AIM_Y = 3.5            # 注视湖心亭形心高度
JQ_SMOOTH_M = 2.5         # 中线滑动平均半窗（弧长，m）
JQ_MAX_OFF = 0.8          # 离中线上限（桥栏内侧 0.89 m）


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


def poly_centroid(poly):
    """面积形心（与 src/lib.mjs centroid 同式；闭合重复点先去掉）。"""
    if poly[0] == poly[-1]:
        poly = poly[:-1]
    a = cx = cz = 0.0
    for i in range(len(poly)):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % len(poly)]
        f = x1 * z2 - x2 * z1
        a += f
        cx += (x1 + x2) * f
        cz += (z1 + z2) * f
    a *= 0.5
    return [cx / (6 * a), cz / (6 * a)]


def nearest_on_polyline(p, pts):
    best, bd = None, 1e18
    for a, b in zip(pts, pts[1:]):
        abx, abz = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz + 1e-12)))
        q = [a[0] + abx * t, a[1] + abz * t]
        d = math.dist(p, q)
        if d < bd:
            best, bd = q, d
    return best, bd


def frame_aim(eye, pts, dist):
    """注视点 = 目标角点的方位角中点 + 仰角中点方向上、距离 dist 处（让整组角点居中入画）。"""
    az = [math.atan2(q[0] - eye[0], q[2] - eye[2]) for q in pts]
    az0 = az[0]
    az = [az0 + math.atan2(math.sin(v - az0), math.cos(v - az0)) for v in az]   # 以首点为基准展开，防 ±π 跳变
    el = [math.atan2(q[1] - eye[1], math.hypot(q[0] - eye[0], q[2] - eye[2])) for q in pts]
    ya = (min(az) + max(az)) / 2
    ea = (min(el) + max(el)) / 2
    return [eye[0] + math.sin(ya) * dist, eye[1] + math.tan(ea) * dist, eye[2] + math.cos(ya) * dist]


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
    shanmen_id = 'temple-shanmen'
    shanmen = insts[shanmen_id]['position']                  # layout 重算：山门锚 [x, z]
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

    # ---------- 镜头② 华宝楼前广场弧线环视（R1） ----------
    # 中心广场是围合院落：楼前进深只有 ~25 m，而华宝楼临广场立面 44 m 宽（塔楼变体角亭宝顶 24.3 m）。
    # 眼高 1.6 m 在广场内要「整座楼入画」只能用超广角：实测 24 mm 只有 R=43 m、16° 的弧能整楼（塔楼变体 0 帧），
    # 18 mm 在 R=40 m、30° 弧上两个变体逐帧整楼入画且离碰撞盒 ≥2.3 m。机位沿以楼包围盒中心为圆心的弧线
    # 从东南（方位 +6°）移到西南（-24°），逐帧注视点 = 楼 footprint 棱柱角点的角度中点（整楼居中）。
    habao = next(o for o in layout['objects'] if o.get('name') == '华宝楼' and o['kind'] == 'bazaarBlock')
    hb_fp = habao['geometry']['footprint']
    if hb_fp[0] == hb_fp[-1]:
        hb_fp = hb_fp[:-1]
    plaza = objs['plaza-428199199']['geometry']['footprint']   # 中心广场（贴华宝楼南立面）
    hb_h = habao['height']
    hb_variant = 'procedural bazaarBlock (layout height)'
    if os.environ.get('BAZAAR_TOWERS') == '1':
        tp = load_json(os.path.join(ROOT, 'modules', 'bazaar-tower-kit', 'params', 'huabao-%s.json' % habao['id']))
        hb_h = max(tp['roof']['ridgeHeightM'], tp['pavilion']['finial']['topM'])
        hb_variant = 'BAZAAR_TOWERS=1 bazaar-tower-kit（max(roof.ridgeHeightM, pavilion.finial.topM)）'
    xs = [q[0] for q in hb_fp]
    zs = [q[1] for q in hb_fp]
    pivot = [(min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2]   # 与可见性测试的目标包围盒中心同
    prism = [[q[0], y, q[1]] for q in hb_fp for y in (0.0, hb_h)]
    hb_eye, hb_tgt = [], []
    for k in range(N):
        a = math.radians(HB_ARC_A0 + (HB_ARC_A1 - HB_ARC_A0) * k / (N - 1))
        p = [pivot[0] + HB_ARC_R * math.sin(a), pivot[1] - HB_ARC_R * math.cos(a)]
        if not point_in_poly(p, plaza):
            errors.append('镜头②第 %d 帧机位 (%.1f, %.1f) 出了中心广场' % (k, p[0], p[1]))
        eye = [p[0], EYE, p[1]]
        hb_eye.append(eye)
        hb_tgt.append(frame_aim(eye, prism, math.dist(p, pivot)))

    # ---------- 镜头③ 九曲桥走向湖心亭（R1） ----------
    # 升高机位 + 切角横移：机位高 4.0 m（桥面 0.55 + 3.45，升降杆/云台高举），桥栏柱头尖顶 1.78 m
    # 落在视线下方、不再占住画面下 1/3；路径 = 桥中线按弧长 ±2.5 m 滑动平均（折角处自然切到内侧，
    # 离中线 ≤0.8 m，桥栏内侧 0.89 m），从桥头走到离湖心亭形心 22 m 处停（GOAL 15–25 m）；
    # 注视点全程锁定湖心亭形心、高 3.5 m（亭身中部），35 mm。
    jp = objs['jiuqu-bridge']['geometry']['polyline']
    hx = objs['huxin-ting']['geometry']['footprint']
    hxc = poly_centroid(hx)
    jacc = polyline_arc(jp)
    step = 0.1
    dense_s = [i * step for i in range(int(jacc[-1] / step) + 1)]
    dense = [point_at(jp, jacc, t) for t in dense_s]
    win = int(JQ_SMOOTH_M / step)
    smooth = []
    for i in range(len(dense)):
        lo, hi = max(0, i - win), min(len(dense), i + win + 1)
        q = [sum(d[0] for d in dense[lo:hi]) / (hi - lo), sum(d[1] for d in dense[lo:hi]) / (hi - lo)]
        # 夹回桥面：离中线 > JQ_MAX_OFF 时沿最近点方向拉回
        near, nd = nearest_on_polyline(q, jp)
        if nd > JQ_MAX_OFF:
            q = [near[0] + (q[0] - near[0]) * JQ_MAX_OFF / nd, near[1] + (q[1] - near[1]) * JQ_MAX_OFF / nd]
        smooth.append(q)
    end_i = next((i for i, q in enumerate(smooth) if math.dist(q, hxc) <= JQ_END_DIST), None)
    if end_i is None:
        errors.append('镜头③桥上找不到离湖心亭形心 %.0f m 的停步点' % JQ_END_DIST)
        end_i = len(smooth) - 1
    walk = smooth[:end_i + 1]
    wacc = polyline_arc(walk)
    jw = resample(walk, N, 0.0, wacc[-1])
    jq_eye = [[p[0], JQ_CAM_Y, p[1]] for p in jw]
    jq_tgt = [[hxc[0], JQ_AIM_Y, hxc[1]] for _ in jw]
    d_end = math.dist(jw[-1], hxc)
    if not 15.0 <= d_end <= 25.0:
        errors.append('镜头③终点离湖心亭形心 %.1f m 不在 15–25' % d_end)

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
            'jiuquEndCentrelineArcM': round(dense_s[end_i], 2),
            'habaoTargetHeight': hb_variant,
        },
        'shots': [
            {'id': 'fangbang-westbound',
             'description': '方浜中路沿街西行过庙前转角 8 m（与山门齐平），末 6 帧注视点转向城隍庙山门（路线 mainStreet 重采样 %.0f m，眼高 1.6 m，注视点前视 %.0f m）' % (FANGBANG_WALK_M, LOOK_AHEAD_M),
             'targetId': shanmen_id, 'targetName': '城隍庙山门',
             'frames': N, 'eye': fb_eye, 'target': fb_tgt},
            {'id': 'habao-plaza-pan',
             'description': '商城华宝楼前中心广场沿弧线环视：机位绕楼包围盒中心 R=%.0f m、方位 %+.0f°→%+.0f°（东南→西南，%.0f° 弧），眼高 1.6 m，%.0f mm 超广角逐帧整楼居中（目标高 %.1f m：%s）' % (HB_ARC_R, HB_ARC_A0, HB_ARC_A1, abs(HB_ARC_A1 - HB_ARC_A0), HB_LENS_MM, hb_h, hb_variant),
             'targetId': habao['id'], 'targetName': '华宝楼', 'targetHeightM': hb_h,
             'lensMm': HB_LENS_MM,
             'frames': N, 'eye': hb_eye, 'target': hb_tgt},
            {'id': 'jiuqu-to-huxinting',
             'description': '九曲桥上走向湖心亭：桥中线 ±%.1f m 滑动平均切角（离中线 ≤%.1f m），机位高 %.1f m（桥面 0.55 + %.2f），注视锁定湖心亭形心 %.1f m 高，%.0f mm，停步离亭形心 %.1f m' % (JQ_SMOOTH_M, JQ_MAX_OFF, JQ_CAM_Y, JQ_CAM_Y - DECK, JQ_AIM_Y, JQ_LENS_MM, d_end),
             'targetId': 'huxin-ting', 'targetName': '湖心亭',
             'lensMm': JQ_LENS_MM,
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
    print('  habao arc R %.1f m az %+.0f..%+.0f deg lens %.0f mm, target height %.1f m (%s), eye0 (%0.2f, %0.2f) eye23 (%0.2f, %0.2f)'
          % (HB_ARC_R, HB_ARC_A0, HB_ARC_A1, HB_LENS_MM, hb_h, hb_variant, hb_eye[0][0], hb_eye[0][2], hb_eye[-1][0], hb_eye[-1][2]))
    print('  jiuqu walk %.1f m (centreline arc %.1f m) cam y %.2f lens %.0f mm -> end %.1f m from huxin (%0.2f, %0.2f)'
          % (wacc[-1], dense_s[end_i], JQ_CAM_Y, JQ_LENS_MM, d_end, hxc[0], hxc[1]))


if __name__ == '__main__':
    main()
