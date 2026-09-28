# -*- coding: utf-8 -*-
"""wave12-blenderamb：Blender 端环境光倍率标定（lighting/presets.json 的 blender.ambientMultiplier）。

为什么：查看器半球环境光不被遮挡、Cycles 的环境光被深檐遮挡，同一份预设下 Cycles 檐下立面偏暗；
本脚本按机主定标定口径为三档各找一个倍率，使 Cycles 在查看器同机位的立面带亮度 V 贴回查看器实测值。

口径（与 scripts/lighting-shots.mjs 一致，此处独立重算，不 import 它）：
  机位：三穗堂 = tour.json['sansuitang']；厅堂 = control-shots.json 镜头⑥ garden-corridor-walk 终帧。
  相机：1400×900（同查看器视口）、垂直 FOV 46°（three PerspectiveCamera fov 是垂直角）；
        Blender 36 mm 传感器 AUTO 适配 → lens = 36·(h/w)/(2·tan(23°))。
  掩膜：目标 = layout id 本体 + facadeBay.parentBuilding 指向它的立面开间（三穗堂 bld-428179901；
        厅堂 = modules/hall-kit/ids.json 全部 id），用 Workbench FLAT+OBJECT 白/黑遮挡掩膜渲染，
        读 PNG 红通道 > 127 —— 与 web/target-mask.js 的深度遮挡语义一致。
  立面带：掩膜屏幕包围盒自上 45% 处到盒底的像素（= 包围盒下 55%），测 beauty 图平均 sRGB V=max(R,G,B)。
  护栏：倍率 ∈ [1,4]；湖心亭 / 九曲桥 / 华宝楼广场机位全画面裁切占比（max 通道 ≥ 250）相比倍率 1.0 增加 ≤ 0.5 pp
        （wave12-r1 起华宝楼广场纳入；最优点破护栏时退到护栏内最大倍率，记 guardLimited）；
        夜晚最亮 0.5% 像素 R > B 占比 ≥ 0.8（湖心亭 / 九曲桥 / 华宝楼）。

做法：beauty 渲染走 render-control-passes.py 自己的 build_lighting_world / setup_beauty_lighting /
config_beauty_lit（strip 末尾 main() 后加载，同 pv-export-args-test 护栏），64 spp GPU；
两处立面各自对 m 单调二分到贴目标，再在两视野 V(log m) 折线上选 max 相对误差最小的候选并实渲确认
（两处 ≤ 10% 达标；不能同时满足取已实渲点里最大相对误差最小者，如实记录）。
三档按 day → dusk → night 顺序在同一进程跑（emissive 材质被 dusk/night 覆写、day scale=0 不改材质，
倒序会互相污染，故顺序固定；换预设必须重跑 setup_beauty_lighting）。每个 (view, m) 渲染落盘并缓存进
--out/meas-<preset>.json，重跑续用。

用法：
  blender -b -t 4 --python scripts/calibrate-blender-ambient.py -- \
      --scene out-zone/scene-areas.glb --out <工单包>/artifacts/b2 \
      --targets-day 0.290,0.281 --targets-dusk 0.172,0.192 --targets-night 0.136,0.231 \
      [--preset day,dusk,night] [--iters 5]
  （目标值 = 灯光工单 R2 实测的查看器 facadeBand V：三穗堂, 厅堂）
输出：<out>/meas-<preset>.json（每档每次迭代的原始测量）、<out>/calibration.json（汇总 + 选定倍率）、
      <out>/renders/<preset>/<view>/m<m>.png、<out>/masks/<view>.png（标定渲染本身，联系表复用；不进仓库）。
"""
import bpy
import copy
import json
import math
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1400, 900
FOV_Y_DEG = 46.0
CLIP_NEAR, CLIP_FAR = 0.5, 4000.0
MULT_MIN, MULT_MAX = 1.0, 4.0
TARGET_ERR = 0.10            # 两处立面带 V 的相对误差上限
MAX_CONFIRM = 5              # 确认轮上限（收敛条件见 calibrate_preset）
CLIP_GUARD_PP = 0.5          # 裁切占比相对倍率 1.0 允许的增加量（百分点）
WARM_GUARD = 0.8             # 夜晚最亮 0.5% 像素里 R > B 的占比下限
TOP_FRAC = 0.005
PRESET_ORDER = ('day', 'dusk', 'night')
VIEWS_BISECT = ('sansuitang', 'halls')
VIEWS_GUARD = ('huxinting', 'jiuqu', 'huabao-plaza')
VIEWS_ALL = ('sansuitang', 'halls', 'huxinting', 'jiuqu', 'huabao-plaza')
# 查看器参考值默认取灯光工单 R2 实测（GOAL 口径）；可用 --targets-<preset> 覆盖
DEFAULT_TARGETS = {
    'day': (0.290, 0.281),
    'dusk': (0.172, 0.192),
    'night': (0.136, 0.231),
}


def log(*a):
    print('[calibrate]', *a, flush=True)


def load_renderer(path):
    """加载渲染器模块但停在主流程之前（末尾无条件 main() 只在 --python 主入口该跑）。"""
    src = open(path, encoding='utf-8').read().rstrip()
    if not src.endswith('\nmain()'):
        raise SystemExit('E: %s 末尾不是裸 main()，加载护栏失效' % path)
    body = src[:src.rindex('\nmain()')]
    import types
    mod = types.ModuleType('render_control_passes_under_test')
    mod.__file__ = path
    exec(compile(body, path, 'exec'), mod.__dict__)
    return mod


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--scene', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--tour', default=os.path.join(ROOT, os.environ.get('OUT_DIR', 'out-zone'), 'tour.json'))
    ap.add_argument('--control-shots', default=os.path.join(ROOT, os.environ.get('OUT_DIR', 'out-zone'), 'control-shots.json'))
    ap.add_argument('--hall-ids', default=os.path.join(ROOT, 'modules', 'hall-kit', 'ids.json'))
    ap.add_argument('--layout', default=os.path.join(ROOT, 'baseline', 'layout.json'))
    ap.add_argument('--presets', default=os.path.join(ROOT, 'lighting', 'presets.json'))
    ap.add_argument('--preset', default=','.join(PRESET_ORDER))
    ap.add_argument('--targets-day', default='%g,%g' % DEFAULT_TARGETS['day'])
    ap.add_argument('--targets-dusk', default='%g,%g' % DEFAULT_TARGETS['dusk'])
    ap.add_argument('--targets-night', default='%g,%g' % DEFAULT_TARGETS['night'])
    ap.add_argument('--iters', type=int, default=5, help='每视野二分轮数')
    return ap.parse_args(argv)


# ---------------- 机位与目标 id（从冻结源 / 产物重算，不写死坐标） ----------------
def camera_views(args):
    tour = json.load(open(args.tour, encoding='utf-8'))
    shots = json.load(open(args.control_shots, encoding='utf-8'))['shots']

    def frame(sid, k=-1):
        s = next(x for x in shots if x['id'] == sid)
        i = len(s['eye']) + k if k < 0 else k
        return {'p': s['eye'][i], 't': s['target'][i]}

    return {
        'sansuitang': {'p': tour['sansuitang']['p'], 't': tour['sansuitang']['t']},
        'jiuqu': {'p': tour['jiuqu-bridge']['p'], 't': tour['jiuqu-bridge']['t']},
        'huabao-plaza': {'p': tour['huabaolou']['p'], 't': tour['huabaolou']['t']},
        'halls': frame('garden-corridor-walk'),
        'huxinting': frame('huxinting-across-pond'),
    }


def target_ids(args):
    L = json.load(open(args.layout, encoding='utf-8'))
    bays = {}
    for o in L['objects']:
        if o.get('parentBuilding'):
            bays.setdefault(o['parentBuilding'], []).append(o['id'])
    ids = {o['id'] for o in L['objects']} | {i['id'] for i in L.get('instances', [])}

    def with_bays(root_ids):
        return sorted({i for r in root_ids for i in ([r] + bays.get(r, []))})

    hall_ids = json.load(open(args.hall_ids, encoding='utf-8'))['ids']
    return {
        'sansuitang': with_bays(['bld-428179901']),
        'halls': with_bays(hall_ids),
    }, ids


# ---------------- 渲染与测光 ----------------
class Calibrator:
    def __init__(self, args, rcp, views, tgt_ids, id_universe):
        self.args = args
        self.rcp = rcp
        self.views = views
        self.tgt = tgt_ids
        os.makedirs(args.out, exist_ok=True)
        self.rdir = os.path.join(args.out, 'renders')
        self.mdir = os.path.join(args.out, 'masks')
        os.makedirs(self.rdir, exist_ok=True)
        os.makedirs(self.mdir, exist_ok=True)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        rcp.setup_render_base(self.scene, W, H)
        t0 = time.perf_counter()
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.scene))
        log('glb imported in %.1fs, objects=%d' % (time.perf_counter() - t0, len(bpy.data.objects)))
        # wave12-r1：与渲染器 --beauty cycles 同一套导入后材质对齐（铺装贴图 / 共面叠放 / 绕序 / 查看器 mip），
        # 否则标定的是「缺贴图、有黑块」的 Cycles 画面（R1 前的 B2 标定即如此）
        self.material_info = rcp.prepare_beauty_materials(os.path.abspath(args.scene))
        self.meshes = [ob for ob in bpy.data.objects if ob.type == 'MESH' and not ob.hide_render]
        self.ident = {ob.name: rcp.layout_id_of(ob, id_universe) for ob in self.meshes}
        cam_data = bpy.data.cameras.new('calib-cam')
        cam_data.sensor_width = 36.0
        # three PerspectiveCamera fov = 垂直角：AUTO 适配横幅传感器时 lens = 36·(h/w)/(2·tan(fov/2))
        cam_data.lens = 36.0 * H / W / (2.0 * math.tan(math.radians(FOV_Y_DEG / 2)))
        cam_data.clip_start = CLIP_NEAR
        cam_data.clip_end = CLIP_FAR
        self.cam_data = cam_data
        rcp.set_pixel_angle(self.scene, cam_data, W, H)
        self.cam_ob = bpy.data.objects.new('calib-cam', cam_data)
        self.scene.collection.objects.link(self.cam_ob)
        self.scene.camera = self.cam_ob
        self.lit_objs = None
        self.lit_preset = None

    def aim(self, view):
        p, t = self.views[view]['p'], self.views[view]['t']
        eye_b = (p[0], -p[2], p[1])
        tgt_b = (t[0], -t[2], t[1])
        from mathutils import Vector
        d = Vector(tgt_b) - Vector(eye_b)
        self.cam_ob.location = eye_b
        self.cam_ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    def _read_png(self, path):
        """PNG → 顶行在前的 numpy uint8 RGB（Blender 像素自底向上，翻转一次；Non-Color = 原字节 /255）。"""
        import numpy as np
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = 'Non-Color'
        w, h = img.size
        ch = img.channels
        buf = np.empty(w * h * ch, dtype=np.float32)
        img.pixels.foreach_get(buf)
        bpy.data.images.remove(img)
        return np.round(np.clip(buf.reshape(h, w, ch)[::-1, :, :3] * 255.0, 0, 255)).astype(np.uint8)

    def mask_path(self, view):
        return os.path.join(self.mdir, view + '.png')

    def render_mask(self, view):
        """Workbench FLAT+OBJECT 白/黑遮挡掩膜（目标白、其余黑、背景黑）。与 m / 预设无关，渲一次。"""
        p = self.mask_path(view)
        if os.path.exists(p):
            return p
        tgt = set(self.tgt[view])
        for ob in self.meshes:
            white = self.ident.get(ob.name) in tgt
            ob.color = (1, 1, 1, 1) if white else (0, 0, 0, 1)
        sc = self.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'FLAT'
        sh.color_type = 'OBJECT'
        sh.show_shadows = False
        sh.show_cavity = False
        self.rcp.set_view(sc, 'Raw')
        sc.render.filter_size = 0.0
        try:
            sc.display.render_aa = 'OFF'
        except TypeError:
            pass
        w = bpy.data.worlds.get('control-world') or bpy.data.worlds.new('control-world')
        w.color = (0, 0, 0)
        sc.display.shading.background_type = 'WORLD'
        sc.world = w
        self.aim(view)
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        log('mask %s done' % view)
        return p

    def render_beauty(self, doc, preset, view, m):
        d = os.path.join(self.rdir, preset, view)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, 'm%s.png' % m)
        if not os.path.exists(p):
            doc_m = copy.deepcopy(doc)
            doc_m.setdefault('blender', {}).setdefault('ambientMultiplier', {})[preset] = m
            if self.lit_objs is None or self.lit_preset != preset:
                # 换预设必须重跑：太阳 / 点光 / 自发光都随预设变；day scale=0 不改材质（顺序 day→dusk→night 见头注释）
                self.lit_objs, _ = self.rcp.setup_beauty_lighting(self.scene, doc_m, preset)
                self.lit_preset = preset
            for ob in self.lit_objs:
                ob.hide_render = False
            world = self.rcp.build_lighting_world(doc_m, preset)
            B = doc_m['blender']
            self.rcp.config_beauty_lit(self.scene, doc_m, preset, 'cycles', B['cycles']['samples'],
                                       B['cycles']['device'], world)
            self.aim(view)
            self.scene.render.filepath = p
            bpy.ops.render.render(write_still=True)
            for ob in self.lit_objs:
                ob.hide_render = True
            log('beauty %s %s m=%s done' % (preset, view, m))
        return p

    def metrics(self, doc, preset, view, m):
        """{facadeV?（有目标掩膜的机位）, clipShare, warmShare?（night 且护栏机位）} + 原图路径。"""
        import numpy as np
        png = self.render_beauty(doc, preset, view, m)
        img = self._read_png(png)
        out = {'view': view, 'multiplier': float(m), 'image': os.path.relpath(png, self.args.out)}
        vmax = img.max(axis=2)
        out['clipShare'] = float((vmax >= 250).mean())
        if preset == 'night' and view in VIEWS_GUARD:
            n_top = max(1, int(math.ceil(TOP_FRAC * vmax.size)))
            idx = np.argpartition(vmax.ravel(), -n_top)[-n_top:]
            rr = img[:, :, 0].ravel()[idx]
            bb = img[:, :, 2].ravel()[idx]
            out['warmShare'] = float((rr > bb).mean())
        if view in self.tgt:
            mask = self._read_png(self.render_mask(view))
            ys, _xs = (mask[:, :, 0] > 127).nonzero()
            if len(ys) == 0:
                raise SystemExit('E: %s 掩膜为空（目标不可见）' % view)
            y0, y1 = int(ys.min()), int(ys.max())
            lo = int(round(y0 + 0.45 * (y1 - y0)))   # 包围盒下 55%（lighting-shots facadeBand 同式）
            sel = (mask[lo:y1 + 1, :, 0] > 127)
            band = img[lo:y1 + 1, :, :][sel]
            out['facadeV'] = float(band.max(axis=1).mean() / 255.0)
            out['maskBandPixels'] = int(sel.sum())
        return out


# ---------------- 标定流程 ----------------
def dump(path, cache):
    rows = sorted(({'view': k[0], 'multiplier': k[1], **v} for k, v in cache.items()),
                  key=lambda r: (r['view'], r['multiplier']))
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
        f.write('\n')


def interpolate(probes, m):
    """probes: [(m, V)] 升序，V(log m) 分段线性插值；越界取端点。"""
    import bisect
    ms = [p[0] for p in probes]
    if m <= ms[0]:
        return probes[0][1]
    if m >= ms[-1]:
        return probes[-1][1]
    i = bisect.bisect_right(ms, m)
    m0, v0 = probes[i - 1]
    m1, v1 = probes[i]
    t = (math.log(m) - math.log(m0)) / (math.log(m1) - math.log(m0))
    return v0 + t * (v1 - v0)


def calibrate_preset(cal, preset, tgt_sh):
    doc = cal.doc
    meas_path = os.path.join(cal.args.out, 'meas-%s.json' % preset)
    cache = {}
    if os.path.exists(meas_path):
        for r in json.load(open(meas_path, encoding='utf-8')):
            cache[(r['view'], float(r['multiplier']))] = {k: v for k, v in r.items() if k not in ('view', 'multiplier')}

    def measure(view, m):
        key = (view, float(m))
        if key not in cache:
            cache[key] = cal.metrics(doc, preset, view, float(m))
            dump(meas_path, cache)
        return dict(cache[key], view=view, multiplier=float(m))

    def probes_of(view):
        return sorted((k[1], cache[k]['facadeV']) for k in cache if k[0] == view and 'facadeV' in cache[k])

    # 0) 倍率 1.0 基线：全部机位（护栏基线 + 联系表 before + 二分下端）
    base = {v: measure(v, 1.0) for v in VIEWS_ALL}

    # 1) 两视野各自对 m 单调二分（V 随 m 单调升；每轮两视野各在各自未定区间几何中点测一次）
    state = {}
    for v, t in zip(VIEWS_BISECT, tgt_sh):
        v1 = base[v]['facadeV']
        if v1 >= t:
            state[v] = {'lo': 1.0, 'hi': 1.0, 'done': True}          # 1.0 已达标，夹到下端
        else:
            v4 = measure(v, MULT_MAX)['facadeV']
            if v4 <= t:
                state[v] = {'lo': MULT_MAX, 'hi': MULT_MAX, 'done': True}   # 上限也够不着，夹到 4
            else:
                state[v] = {'lo': MULT_MIN, 'hi': MULT_MAX, 'done': False}
    for _ in range(cal.args.iters):
        if all(state[v]['done'] for v in VIEWS_BISECT):
            break
        for v, t in zip(VIEWS_BISECT, tgt_sh):
            st = state[v]
            if st['done']:
                continue
            mid = round(math.sqrt(st['lo'] * st['hi']), 4)
            mv = measure(v, mid)['facadeV']
            if mv < t:
                st['lo'] = mid
            else:
                st['hi'] = mid
            st['done'] = st['hi'] / st['lo'] < 1.02
    # 2) 候选：两视野 V(log m) 折线上 max 相对误差最小的 m
    def max_err(m):
        return max(abs(interpolate(probes_of(v), m) - t) / t for v, t in zip(VIEWS_BISECT, tgt_sh))

    grid = [round(math.exp(math.log(MULT_MIN) + (math.log(MULT_MAX) - math.log(MULT_MIN)) * i / 300.0), 4)
            for i in range(301)]

    # 确认轮（wave12-r2 明确收敛条件）：折线最优候选实渲 → 进折线重选，直到
    #   a) 两处都 ≤10%；或 b) 新候选与已实渲倍率相对差 < 1%（折线在已测点附近，再测无新信息）；
    #   或 c) 折线预测的最大误差比已实渲最好值改善 < 0.5 个百分点；或 d) 满 MAX_CONFIRM 轮。停因记进结果。
    best = None
    stop = 'maxRounds'
    cand = min(grid, key=max_err)
    for rnd in range(MAX_CONFIRM):
        m_c = round(cand, 4)
        got = {v: measure(v, m_c) for v in VIEWS_BISECT}
        errs = {v: abs(got[v]['facadeV'] - t) / t for v, t in zip(VIEWS_BISECT, tgt_sh)}
        cand_res = {'round': rnd, 'multiplier': m_c,
                    'facadeV': {v: got[v]['facadeV'] for v in VIEWS_BISECT},
                    'relErr': {v: round(errs[v], 4) for v in VIEWS_BISECT},
                    'maxRelErr': round(max(errs.values()), 4)}
        if best is None or cand_res['maxRelErr'] < best['maxRelErr']:
            best = cand_res
        if max(errs.values()) <= TARGET_ERR:
            stop = 'withinTarget'
            break
        cand = min(grid, key=max_err)   # 确认点已进 cache/折线，重选
        measured = sorted({k[1] for k in cache if k[0] in VIEWS_BISECT})
        if any(abs(cand - mm) / mm < 0.01 for mm in measured):
            stop = 'candidateAlreadyMeasured'
            break
        if best['maxRelErr'] - max_err(cand) < 0.005:
            stop = 'predictedGain<0.5pp'
            break

    # 3) 护栏（湖心亭 / 九曲桥 / 华宝楼广场三机位裁切增量 ≤ 0.5 pp；夜晚最亮 0.5% 暖色占比 ≥ 0.8）。
    #    wave12-r1：华宝楼广场纳入裁切护栏；最优点破护栏时，在 [1, 最优点] 上对「护栏全过」几何二分，取最大可行倍率
    #    （裁切占比随 m 单调不减），再实测该点两处立面 V 作为最终结果，如实记录 guardLimited。
    def guard_at(m):
        g = {}
        for v in VIEWS_GUARD:
            now = measure(v, m)
            b = base[v]
            entry = {'clipShare1': b['clipShare'], 'clipShare': now['clipShare'],
                     'clipDeltaPp': round((now['clipShare'] - b['clipShare']) * 100, 4)}
            if preset == 'night':
                entry['warmShare1'] = b.get('warmShare')
                entry['warmShare'] = now.get('warmShare')
            g[v] = entry
        c_ok = all(g[v]['clipDeltaPp'] <= CLIP_GUARD_PP + 1e-9 for v in VIEWS_GUARD)
        w_ok = preset != 'night' or all((g[v].get('warmShare') or 0) >= WARM_GUARD for v in VIEWS_GUARD)
        return g, c_ok, w_ok

    unconstrained = dict(best)
    m_final = best['multiplier']
    guard, clip_ok, warm_ok = guard_at(m_final)
    guard_limited = False
    if not (clip_ok and warm_ok) and m_final > MULT_MIN:
        lo, hi = MULT_MIN, m_final
        g1, c1, w1 = guard_at(lo)
        if c1 and w1:
            for _ in range(cal.args.iters):
                mid = round(math.sqrt(lo * hi), 4)
                _g, c, w = guard_at(mid)
                if c and w:
                    lo = mid
                else:
                    hi = mid
                if hi / lo < 1.02:
                    break
            m_final = lo
            guard, clip_ok, warm_ok = guard_at(m_final)
            got = {v: measure(v, m_final) for v in VIEWS_BISECT}
            errs = {v: abs(got[v]['facadeV'] - t) / t for v, t in zip(VIEWS_BISECT, tgt_sh)}
            best = {'round': best['round'], 'multiplier': m_final,
                    'facadeV': {v: got[v]['facadeV'] for v in VIEWS_BISECT},
                    'relErr': {v: round(errs[v], 4) for v in VIEWS_BISECT},
                    'maxRelErr': round(max(errs.values()), 4)}
            guard_limited = True

    iters = sorted(({'view': k[0], 'multiplier': k[1], **cache[k]} for k in cache if k[0] in VIEWS_BISECT),
                   key=lambda r: (r['multiplier'], r['view']))
    out = {'preset': preset, 'multiplier': m_final, 'targets': list(tgt_sh),
           'facadeV': best['facadeV'], 'relErr': best['relErr'], 'maxRelErr': best['maxRelErr'],
           'withinTarget': best['maxRelErr'] <= TARGET_ERR,
           'confirmRounds': rnd + 1, 'bestRound': best['round'] + 1, 'confirmStop': stop,
           'nextCandidatePredicted': {'multiplier': round(cand, 4), 'maxRelErr': round(max_err(cand), 4)}, 'guard': guard,
           'clipGuardOK': clip_ok, 'warmGuardOK': warm_ok,
           'clipGuardLimitPp': CLIP_GUARD_PP, 'warmGuardMin': WARM_GUARD,
           'clipGuardViews': list(VIEWS_GUARD), 'guardLimited': guard_limited, 'unconstrainedBest': unconstrained,
           'iterations': iters}
    dump(meas_path, cache)
    log('%s result: m=%s facadeV=%s maxRelErr=%s clipOK=%s warmOK=%s'
        % (preset, m_final, best['facadeV'], out['maxRelErr'], clip_ok, warm_ok))
    return out


def fingerprint(args):
    """缓存指纹（wave12-r2）：场景 GLB、渲染器、本脚本、presets（去掉 blender.ambientMultiplier——标定会改写它，
    测量本身按 doc 副本显式设倍率）、铺装 / 外围贴图、机位与目标来源。任一变了，旧渲染 / 旧测量都不能续用。"""
    import glob
    import hashlib

    def sha(path):
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        return h.hexdigest()
    doc = json.load(open(args.presets, encoding='utf-8'))
    doc.get('blender', {}).pop('ambientMultiplier', None)
    tex = sorted(glob.glob(os.path.join(ROOT, 'resources', 'textures', 'paving', '*.jpg'))) + \
        [os.path.join(ROOT, 'resources', 'textures', 'outer-kit', 'outerkit-atlas-v2.jpg')]
    return {
        'sceneGlb': sha(args.scene),
        'renderer': sha(os.path.join(ROOT, 'scripts', 'render-control-passes.py')),
        'calibrator': sha(os.path.abspath(__file__)),
        'presetsSansMultiplier': hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest(),
        'textures': hashlib.sha256(''.join(os.path.basename(t) + sha(t) for t in tex if os.path.exists(t)).encode()).hexdigest(),
        'tour': sha(args.tour), 'controlShots': sha(args.control_shots), 'layout': sha(args.layout), 'hallIds': sha(args.hall_ids),
    }


def check_cache(args):
    """--out 里已有指纹则必须一致；没有指纹却已有渲染 / 测量（来历不明）也拒绝续用。"""
    fp = fingerprint(args)
    fpath = os.path.join(args.out, 'fingerprint.json')
    if os.path.exists(fpath):
        old = json.load(open(fpath, encoding='utf-8'))
        diff = sorted(k for k in set(fp) | set(old) if fp.get(k) != old.get(k))
        if diff:
            raise SystemExit('E: %s 的缓存指纹不符（%s 变了），换一个 --out 目录重跑' % (args.out, ','.join(diff)))
    else:
        stale = [x for x in ('renders', 'masks') if os.path.isdir(os.path.join(args.out, x)) and os.listdir(os.path.join(args.out, x))]
        stale += [f for f in os.listdir(args.out) if f.startswith('meas-')] if os.path.isdir(args.out) else []
        if stale:
            raise SystemExit('E: %s 已有无指纹的旧缓存 %s，换一个 --out 目录重跑' % (args.out, stale))
        os.makedirs(args.out, exist_ok=True)
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(fp, f, ensure_ascii=False, indent=1)
            f.write('\n')
    return fp


def main():
    args = parse_args()
    fp = check_cache(args)
    rcp = load_renderer(os.path.join(ROOT, 'scripts', 'render-control-passes.py'))
    views = camera_views(args)
    tgt, universe = target_ids(args)
    cal = Calibrator(args, rcp, views, tgt, universe)
    cal.doc = json.load(open(args.presets, encoding='utf-8'))

    targets = {'day': args.targets_day, 'dusk': args.targets_dusk, 'night': args.targets_night}
    todo = [s.strip() for s in args.preset.split(',') if s.strip()]
    for name in todo:
        if name not in PRESET_ORDER:
            raise SystemExit('E: 未知预设 %s（顺序固定 %s，emissive 材质覆写不可倒序）' % (name, PRESET_ORDER))
    summary = {}
    for preset in todo:
        summary[preset] = calibrate_preset(cal, preset,
                                           tuple(float(x) for x in targets[preset].split(',')))
    with open(os.path.join(args.out, 'calibration.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': 1,
                   'targetsSource': 'viewer facadeBand V，灯光工单 R2 实测（GOAL 口径）；每次迭代原始测量在 meas-<preset>.json',
                   'presets': summary, 'cameras': views, 'targetIds': tgt,
                   'lensMm': cal.cam_data.lens, 'size': [W, H], 'fovYDeg': FOV_Y_DEG, 'fingerprint': fp,
                   'beautyMaterials': {k: (v if not isinstance(v, (list, dict)) else len(v)) for k, v in cal.material_info.items()},
                   'coplanarOffsets': cal.material_info.get('coplanarOffsets'),
                   'coplanarPairs': cal.material_info.get('coplanarPairs')},
                  f, ensure_ascii=False, indent=1)
        f.write('\n')
    for preset, s in summary.items():
        log('SUMMARY %s: multiplier=%s maxRelErr=%s withinTarget=%s clipGuardOK=%s warmGuardOK=%s'
            % (preset, s['multiplier'], s['maxRelErr'], s['withinTarget'], s['clipGuardOK'], s['warmGuardOK']))


main()
