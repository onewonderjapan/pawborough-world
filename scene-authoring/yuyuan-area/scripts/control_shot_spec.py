# -*- coding: utf-8 -*-
"""wave5-shots2：声明式镜头（scripts/control-shots-spec.json）→ 逐帧 eye / target。

镜头 json 集中在 control-shots-spec.json 一个文件；本模块只做通用求值（没有按镜头 id 的分支），
build-control-shots.py 把结果追加到 $OUT_DIR/control-shots.json，渲染脚本照常逐镜头渲染。

点（P）写法 —— 全部相对冻结源里的对象重算，不写绝对世界坐标：
  {"ref": <id>, "at": <锚>, "local": [右, 前], "polar": [方位°, 半径], "y": 高度}
  锚 at：
    centroid  layout 对象 footprint 面积形心（rocks = 包围盒中心，polyline = 包围盒中心）；朝向 = facade.dir，缺省 +z
    peak      rockery 最高一块石头（主峰）
    instance  实例锚：layout.instances 的 position / rotY；没有就查 $OUT_DIR/*-collision-world.json 的模块实例
              （三穗堂 / 厅堂套件：模块锚点 ≠ footprint 形心）；朝向 = (sin rotY, cos rotY)
    box       $OUT_DIR/collision-<zone>.json 里记录名前缀 = id 的碰撞盒并集 AABB 中心（锚点型对象的实际几何，
              如庙区 templeAnchor：layout 实例锚与模块实物并不重合）；朝向同 instance（有实例时）否则 +z
    polyline  layout polyline 上弧长 s 处（"s": 米，负数 = 从末端倒数）；朝向 = 该处切向
  local 在锚的局部系：右 = (-前z, 前x)（地图 x 东 z 南，右手 Y-up）；polar = 以「前」为 0°、向右为正的方位角 + 半径。
  y 缺省 = 锚对象高度的一半；"yTop": dy = 锚对象顶高 + dy。
  另有 {"ahead": 米, "y": 高} = 本帧机位沿机位路径前方若干米（注视点专用，末端沿末段外推）。

机位 eye：
  {"path": [P, ...], "ease": linear|smooth|easeOut|easeIn}   —— 3D 弧长参数化，按 ease 重采样 N 帧
  {"orbit": {"center": P, "r": 米, "az": [a0, a1], "y": 高}, "ease": ...}   —— 绕 center 的圆弧（方位同 polar）
注视点 target：
  {"path": [P, ...], "ease": ...}         —— 同一套弧长参数化（与机位同步的时间轴）
  {"keys": [[t, P], ...]}                 —— 归一化时间 t∈[0,1] 的关键点，段间 smoothstep
  {"frameTarget": true}                   —— 逐帧注视目标棱柱角点的角度中点（整体居中，同镜头②）
目标高：footprint 目标 = layout height；BAZAAR_TOWERS=1 且 modules/bazaar-tower-kit/params/*-<id>.json 存在时
        = max(roof.ridgeHeightM, pavilion.finial.topM)（与镜头②同一规则），写进镜头 targetHeightM。
"""
import glob
import json
import math
import os

EASE = {
    'linear': lambda t: t,
    'smooth': lambda t: t * t * (3 - 2 * t),
    'easeOut': lambda t: 1 - (1 - t) * (1 - t),
    'easeIn': lambda t: t * t,
}


def _load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def _poly_centroid(poly):
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


def _norm2(v):
    l = math.hypot(v[0], v[1]) or 1.0
    return [v[0] / l, v[1] / l]


def obb_to_world(rec):
    """src/world/collisionAdapter.js obbToWorld 的同式移植：返回 (center[3], half[3], yaw)。"""
    if 'obb' in rec:
        o = rec['obb']
        pos, th, c, s = o['pos'], o['theta'], o['center'], o['size']
        cs, sn = math.cos(th), math.sin(th)
        wx = pos[0] + cs * c[0] + sn * c[2]
        wz = pos[2] - sn * c[0] + cs * c[2]
        return [wx, c[1] + (pos[1] if len(pos) > 1 else 0), wz], [s[0] / 2, s[1] / 2, s[2] / 2], th
    mn, mx = rec['min'], rec['max']
    return [(mn[i] + mx[i]) / 2 for i in range(3)], [(mx[i] - mn[i]) / 2 for i in range(3)], 0.0


class SpecContext:
    def __init__(self, root, oz, layout):
        self.root, self.oz, self.layout = root, oz, layout
        self.objs = {o['id']: o for o in layout['objects']}
        self.insts = {i['id']: i for i in layout.get('instances', [])}
        self._boxes = None
        self._modinst = None

    # ---- 模块实例（*-collision-world.json） ----
    def module_instances(self):
        if self._modinst is None:
            self._modinst = {}
            for p in sorted(glob.glob(os.path.join(self.oz, '*-collision-world.json'))):
                d = _load(p)
                recs = d.get('instances') or ([d] if 'instance' in d else [])
                for r in recs:
                    ins = r.get('instance') or {}
                    if 'id' in ins:
                        self._modinst[ins['id']] = ins
        return self._modinst

    # ---- 碰撞盒并集（记录名前缀 = id） ----
    def boxes(self):
        if self._boxes is None:
            self._boxes = {}
            for p in sorted(glob.glob(os.path.join(self.oz, 'collision-*.json'))):
                d = _load(p)
                for rec in d.get('colliders', []):
                    if rec.get('module') == 'water-guard':
                        continue
                    cid = rec['name'].split(':')[0]
                    c, h, yaw = obb_to_world(rec)
                    ac, as_ = abs(math.cos(yaw)), abs(math.sin(yaw))
                    ex, ez = ac * h[0] + as_ * h[2], as_ * h[0] + ac * h[2]
                    b = self._boxes.setdefault(cid, [1e18, 1e18, 1e18, -1e18, -1e18, -1e18])
                    b[0] = min(b[0], c[0] - ex); b[1] = min(b[1], c[1] - h[1]); b[2] = min(b[2], c[2] - ez)
                    b[3] = max(b[3], c[0] + ex); b[4] = max(b[4], c[1] + h[1]); b[5] = max(b[5], c[2] + ez)
        return self._boxes

    def instance(self, ref):
        if ref in self.insts:
            i = self.insts[ref]
            return i['position'], i.get('rotY', 0.0)
        mi = self.module_instances().get(ref)
        if mi:
            return mi['position'], mi.get('rotY', 0.0)
        return None, None

    def target_height(self, tid):
        o = self.objs.get(tid)
        if os.environ.get('BAZAAR_TOWERS') == '1':
            ps = glob.glob(os.path.join(self.root, 'modules', 'bazaar-tower-kit', 'params', '*-%s.json' % tid))
            if ps:
                tp = _load(ps[0])
                return max(tp['roof']['ridgeHeightM'], tp['pavilion']['finial']['topM']), 'BAZAAR_TOWERS=1 bazaar-tower-kit'
        if o and o.get('height'):
            return o['height'], 'layout height'
        b = self.boxes().get(tid)
        if b:
            return b[4], 'collision box top'
        return None, None

    def target_prism(self, tid, height):
        """目标角点（frameTarget 用）：footprint 棱柱 / 碰撞盒并集 AABB 8 角。"""
        o = self.objs.get(tid)
        fp = o and o.get('geometry', {}).get('footprint')
        if fp:
            if fp[0] == fp[-1]:
                fp = fp[:-1]
            return [[q[0], y, q[1]] for q in fp for y in (0.0, height)]
        b = self.boxes().get(tid)
        if not b:
            raise ValueError('目标 %s 无 footprint 也无碰撞盒' % tid)
        return [[x, y, z] for x in (b[0], b[3]) for y in (b[1], b[4]) for z in (b[2], b[5])]

    # ---- 锚 ----
    def frame(self, ref, at, P):
        o = self.objs.get(ref)
        fwd, top = [0.0, 1.0], None
        if o is not None:
            top = o.get('height')
            fd = (o.get('facade') or {}).get('dir')
            if fd:
                fwd = _norm2(fd)
        pos, rot = self.instance(ref)
        if at in ('instance', 'box') and pos is not None:
            fwd = [math.sin(rot), math.cos(rot)]
        if at == 'centroid':
            g = o['geometry']
            if 'footprint' in g:
                org = _poly_centroid(g['footprint'])
            elif 'rocks' in g:
                xs = [r['x'] for r in g['rocks']]; zs = [r['z'] for r in g['rocks']]
                org = [(min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2]
                top = max(r.get('h', 0) for r in g['rocks'])
            else:
                pl = g['polyline']
                xs = [p[0] for p in pl]; zs = [p[1] for p in pl]
                org = [(min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2]
        elif at == 'peak':
            rocks = o['geometry']['rocks']
            m = max(rocks, key=lambda r: (r.get('h', 0), r['size']))
            org, top = [m['x'], m['z']], m.get('h', 0)
        elif at == 'instance':
            if pos is None:
                raise ValueError('%s 没有实例锚' % ref)
            org = list(pos)
        elif at == 'box':
            b = self.boxes().get(ref)
            if not b:
                raise ValueError('%s 没有碰撞记录' % ref)
            org, top = [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2], b[4]
        elif at == 'polyline':
            pl = o['geometry']['polyline']
            acc = [0.0]
            for a, b in zip(pl, pl[1:]):
                acc.append(acc[-1] + math.dist(a, b))
            s = P.get('s', 0.0)
            s = acc[-1] + s if s < 0 else s
            s = max(0.0, min(acc[-1], s))
            i = max(k for k in range(len(pl) - 1) if acc[k] <= s + 1e-9) if len(pl) > 1 else 0
            i = min(i, len(pl) - 2)
            seg = acc[i + 1] - acc[i] or 1e-9
            t = (s - acc[i]) / seg
            org = [pl[i][0] + (pl[i + 1][0] - pl[i][0]) * t, pl[i][1] + (pl[i + 1][1] - pl[i][1]) * t]
            fwd = _norm2([pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]])
        else:
            raise ValueError('未知锚 at=%s' % at)
        return org, fwd, (top if top is not None else 0.0)

    def point(self, P):
        org, fwd, top = self.frame(P['ref'], P.get('at', 'centroid'), P)
        right = [-fwd[1], fwd[0]]
        lr, lf = P.get('local', [0.0, 0.0])
        x = org[0] + right[0] * lr + fwd[0] * lf
        z = org[1] + right[1] * lr + fwd[1] * lf
        if 'polar' in P:
            a, r = math.radians(P['polar'][0]), P['polar'][1]
            x += r * (fwd[0] * math.cos(a) + right[0] * math.sin(a))
            z += r * (fwd[1] * math.cos(a) + right[1] * math.sin(a))
        if 'y' in P:
            y = P['y']
        elif 'yTop' in P:
            y = top + P['yTop']
        else:
            y = top / 2
        return [x, y, z]


def _arc_sample(pts, us):
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + math.dist(a, b))
    out = []
    for u in us:
        s = acc[-1] * u
        if len(pts) == 1 or acc[-1] <= 1e-12:
            out.append(list(pts[0]))
            continue
        i = 0
        while i < len(pts) - 2 and acc[i + 1] < s:
            i += 1
        seg = acc[i + 1] - acc[i] or 1e-12
        t = max(0.0, min(1.0, (s - acc[i]) / seg))
        out.append([pts[i][j] + (pts[i + 1][j] - pts[i][j]) * t for j in range(3)])
    return out, acc[-1]


def _ahead(eyes, k, m):
    """机位路径上第 k 帧前方 m 米（沿后续帧折线；越过末帧沿末段方向外推）。"""
    left = m
    p = eyes[k]
    for j in range(k + 1, len(eyes)):
        d = math.dist(p[:1] + p[2:], eyes[j][:1] + eyes[j][2:])
        if d >= left and d > 1e-9:
            t = left / d
            return [p[0] + (eyes[j][0] - p[0]) * t, p[2] + (eyes[j][2] - p[2]) * t]
        left -= d
        p = eyes[j]
    a, b = eyes[-2], eyes[-1]
    dx, dz = _norm2([b[0] - a[0], b[2] - a[2]])
    return [p[0] + dx * left, p[2] + dz * left]


def frame_aim(eye, pts, dist):
    az = [math.atan2(q[0] - eye[0], q[2] - eye[2]) for q in pts]
    az0 = az[0]
    az = [az0 + math.atan2(math.sin(v - az0), math.cos(v - az0)) for v in az]
    el = [math.atan2(q[1] - eye[1], math.hypot(q[0] - eye[0], q[2] - eye[2])) for q in pts]
    ya = (min(az) + max(az)) / 2
    ea = (min(el) + max(el)) / 2
    return [eye[0] + math.sin(ya) * dist, eye[1] + math.tan(ea) * dist, eye[2] + math.cos(ya) * dist]


def build_spec_shots(spec, ctx, n_default=24):
    out, errors = [], []
    for sd in spec['shots']:
        n = sd.get('frames', n_default)
        ease = EASE[sd['eye'].get('ease', 'linear')]
        us = [ease(k / (n - 1)) for k in range(n)]
        ev = sd['eye']
        if 'path' in ev:
            pts = [ctx.point(P) for P in ev['path']]
            eyes, eye_len = _arc_sample(pts, us)
        elif 'orbit' in ev:
            ob = ev['orbit']
            c = ctx.point(ob['center'])
            org, fwd, _ = ctx.frame(ob['center']['ref'], ob['center'].get('at', 'centroid'), ob['center'])
            right = [-fwd[1], fwd[0]]
            eyes = []
            for u in us:
                a = math.radians(ob['az'][0] + (ob['az'][1] - ob['az'][0]) * u)
                eyes.append([c[0] + ob['r'] * (fwd[0] * math.cos(a) + right[0] * math.sin(a)), ob['y'],
                             c[2] + ob['r'] * (fwd[1] * math.cos(a) + right[1] * math.sin(a))])
            eye_len = math.radians(abs(ob['az'][1] - ob['az'][0])) * ob['r']
        else:
            raise ValueError('%s eye 需要 path 或 orbit' % sd['id'])
        th, th_src = ctx.target_height(sd['targetId'])
        lk = sd['look']
        tg = []
        if lk.get('frameTarget'):
            prism = ctx.target_prism(sd['targetId'], th)
            cx = sum(q[0] for q in prism) / len(prism); cz = sum(q[2] for q in prism) / len(prism)
            for e in eyes:
                tg.append(frame_aim(e, prism, max(1.5, math.dist([e[0], e[2]], [cx, cz]))))
        elif 'path' in lk:
            lease = EASE[lk.get('ease', sd['eye'].get('ease', 'linear'))]
            lpts = [ctx.point(P) for P in lk['path']]
            tg, _ = _arc_sample(lpts, [lease(k / (n - 1)) for k in range(n)])
        elif 'keys' in lk:
            def kp(P, k):
                if 'ahead' in P:
                    xz = _ahead(eyes, k, P['ahead'])
                    return [xz[0], P.get('y', eyes[k][1]), xz[1]]
                return ctx.point(P)
            keys = lk['keys']
            for k in range(n):
                t = k / (n - 1)
                j = 0
                while j < len(keys) - 2 and keys[j + 1][0] <= t:
                    j += 1
                t0, P0 = keys[j]
                t1, P1 = keys[min(j + 1, len(keys) - 1)]
                w = 0.0 if t1 <= t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
                w = w * w * (3 - 2 * w)
                a, b = kp(P0, k), kp(P1, k)
                tg.append([a[i] + (b[i] - a[i]) * w for i in range(3)])
        else:
            raise ValueError('%s look 需要 frameTarget / path / keys' % sd['id'])
        o = ctx.objs.get(sd['targetId'])
        shot = {
            'id': sd['id'], 'no': sd.get('no'), 'title': sd.get('title'),
            'description': sd.get('description', ''),
            'targetId': sd['targetId'],
            'targetName': (o or {}).get('name') or (ctx.insts.get(sd['targetId']) or {}).get('name') or sd.get('targetName'),
            'lensMm': sd.get('lensMm', 50.0),
            'frames': n, 'eye': [[round(v, 4) for v in p] for p in eyes], 'target': [[round(v, 4) for v in p] for p in tg],
            'eyePathM': round(eye_len, 2),
            'spec': 'scripts/control-shots-spec.json',
        }
        if th is not None:
            shot['targetHeightM'] = th
            shot['targetHeightSource'] = th_src
        if sd.get('variants'):
            shot['variants'] = sd['variants']
        for k in range(n):
            if math.dist([eyes[k][0], eyes[k][2]], [tg[k][0], tg[k][2]]) < 1.0:
                errors.append('%s 第 %d 帧注视点离机位 < 1 m（退化朝向）' % (sd['id'], k))
        out.append(shot)
    return out, errors
