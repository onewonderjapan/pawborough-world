#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard：PV 分镜（scripts/pv-shots.json）→ 24 fps 逐帧相机（render-control-passes.py 同格式）。

输入（全部是冻结源或它们的确定性派生，不读任何渲染图）：
  - scripts/pv-shots.json               PV 分镜：镜号 / 意图 / 目标 / 时长 / 灯光标签 / 转场 / 提示词；
                                         新镜头的机位写法与 control-shots-spec.json 完全相同（同一个求值器
                                         scripts/control_shot_spec.py），复用镜头只写 reuse.shot + reuse.segment；
  - $OUT_DIR/control-shots.json         既有 11 镜头（24 帧口径），本脚本先调用 build-control-shots.py 从冻结源重算；
  - baseline/layout.json、$OUT_DIR/*collision*.json（经 control_shot_spec 读取）。

复用镜头的重定时：既有镜头 24 个关键帧（按原 ease 取样）→ 均匀 Catmull-Rom 插值到 u∈segment，
再按 PV 时长 durationS×24 帧重采样（机位与注视点同一参数）；可选 reuse.ease 在段内再加缓入缓出。
新镜头：build_spec_shots(n = durationS×24)，与控制层镜头同一套点写法 / ease / 注视规则。

输出：
  $OUT_DIR/pv-cameras.json           全部 PV 镜头 24 fps 逐帧（render-control-passes.py 可直接渲染，镜头带 pv 元数据）；
  --sample fml  --out <json>         每镜头首 / 中 / 末 3 帧（P1 预览，用既有 render-control-passes.py 出四通道）；
  --sample stride:N --out <json>     每 N 帧取 1 帧（N=2 → 12 fps 动态样片）。
  取样文件里每镜头带 sourceFrames（对应 24 fps 帧号），渲染出的 frame-###.png 序号 = 取样序号。

用法：
  python3 scripts/build-pv-shots.py --out-zone out-zone
  python3 scripts/build-pv-shots.py --out-zone out-zone --sample fml --out <包>/artifacts/pv/cameras-preview.json
  python3 scripts/build-pv-shots.py --out-zone out-zone --sample stride:2 --out <包>/artifacts/pv/cameras-12fps.json
"""
import argparse
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from control_shot_spec import EASE, SpecContext, build_spec_shots  # noqa: E402

FPS = 24


def load_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


class PvSpecContext(SpecContext):
    """control_shot_spec 的目标高规则只认华宝楼式参数（roof.ridgeHeightM + pavilion.finial.topM）；其他塔楼套件
    （和丰楼等）写的是 roof.ridgeAboveM（屋脊高出墙顶）。PV 镜头以这些楼为目标时按「layout 墙顶高 + ridgeAboveM」
    取目标高，不改原求值器（控制层 11 镜头输出保持逐字节不变）。"""

    def target_height(self, tid):
        try:
            return super().target_height(tid)
        except KeyError:
            import glob
            ps = glob.glob(os.path.join(self.root, 'modules', 'bazaar-tower-kit', 'params', '*-%s.json' % tid))
            tp = load_json(ps[0])
            wall = self.objs[tid]['height']
            return wall + tp['roof']['ridgeAboveM'], 'bazaar-tower-kit layout wall top + roof.ridgeAboveM'


def catmull(pts, u):
    """均匀 Catmull-Rom：pts 为关键帧（等时间间隔），u∈[0,1] 全段参数。"""
    n = len(pts)
    if n == 1:
        return list(pts[0])
    x = u * (n - 1)
    i = min(int(math.floor(x)), n - 2)
    t = x - i
    p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
    t2, t3 = t * t, t * t * t
    return [0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                   + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(3)]


def retime(src, seg, n, ease):
    u0, u1 = seg
    e = EASE[ease]
    us = [u0 + (u1 - u0) * e(k / (n - 1)) for k in range(n)]
    return ([[round(v, 4) for v in catmull(src['eye'], u)] for u in us],
            [[round(v, 4) for v in catmull(src['target'], u)] for u in us])


def path_len(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


PV_KEYS = ('no', 'status', 'act', 'title', 'intent', 'camClass', 'move', 'durationS', 'light', 'transitionIn',
           'transitionOut', 'reveal', 'minTargetFrac', 'prompt', 'negative', 'genMode', 'audio', 'channels',
           'atmosphere')


def build(pv, ctl, ctx):
    ctl_by = {s['id']: s for s in ctl['shots']}
    out, errors = [], []
    for sd in pv['shots']:
        n = int(round(sd['durationS'] * FPS))
        if 'reuse' in sd:
            src = ctl_by.get(sd['reuse']['shot'])
            if src is None:
                errors.append('%s 复用的镜头 %s 不在 control-shots.json' % (sd['id'], sd['reuse']['shot']))
                continue
            seg = sd['reuse'].get('segment', [0.0, 1.0])
            eye, tgt = retime(src, seg, n, sd['reuse'].get('ease', 'linear'))
            shot = {'id': sd['id'], 'targetId': src['targetId'], 'targetName': src.get('targetName'),
                    'lensMm': src.get('lensMm', 50.0), 'frames': n, 'eye': eye, 'target': tgt,
                    'reuse': {'shot': src['id'], 'segment': seg, 'ease': sd['reuse'].get('ease', 'linear'),
                              'sourceFrames': src['frames']}}
            if src.get('targetHeightM'):
                shot['targetHeightM'] = src['targetHeightM']
            if sd.get('targetId') and sd['targetId'] != src['targetId']:
                errors.append('%s targetId %s 与复用源 %s 的 %s 不一致' % (sd['id'], sd['targetId'], src['id'], src['targetId']))
        else:
            spec_shot = {k: sd[k] for k in ('id', 'targetId', 'lensMm', 'eye', 'look') if k in sd}
            spec_shot['frames'] = n
            res, err = build_spec_shots({'shots': [spec_shot]}, ctx, n)
            errors += err
            shot = res[0]
            shot.pop('spec', None)
            shot['spec'] = 'scripts/pv-shots.json'
        for k in PV_KEYS:
            if k in sd:
                shot[k] = sd[k]
        shot['eyePathM'] = round(path_len(shot['eye']), 2)
        shot['fps'] = FPS
        out.append(shot)
    return out, errors


def sample(doc, mode):
    res = dict(doc)
    res['shots'] = []
    for s in doc['shots']:
        n = s['frames']
        if mode == 'fml':
            idx = [0, (n - 1) // 2, n - 1]
        elif mode.startswith('stride:'):
            st = int(mode.split(':')[1])
            idx = list(range(0, n, st))
            if idx[-1] != n - 1:
                idx.append(n - 1)
        else:
            raise SystemExit('未知 --sample %s' % mode)
        t = dict(s)
        t['eye'] = [s['eye'][i] for i in idx]
        t['target'] = [s['target'][i] for i in idx]
        t['frames'] = len(idx)
        t['sourceFrames'] = idx
        res['shots'].append(t)
    res['sampling'] = mode
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-zone', default=os.environ.get('OUT_DIR', 'out-zone'))
    ap.add_argument('--pv', default=os.environ.get('PV_SHOTS', os.path.join(ROOT, 'scripts', 'pv-shots.json')))
    ap.add_argument('--sample', default='')
    ap.add_argument('--out', default='')
    ap.add_argument('--skip-control', action='store_true', help='不重算 control-shots.json（已由调用方刚算过）')
    args = ap.parse_args()
    oz = args.out_zone if os.path.isabs(args.out_zone) else os.path.join(ROOT, args.out_zone)
    if not args.skip_control:
        subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build-control-shots.py'), '--out-zone', oz],
                       check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    ctl = load_json(os.path.join(oz, 'control-shots.json'))
    pv = load_json(args.pv)
    layout = load_json(os.path.join(ROOT, 'baseline', 'layout.json'))
    shots, errors = build(pv, ctl, PvSpecContext(ROOT, oz, layout))
    if errors:
        for e in errors:
            print('FAIL', e)
        sys.exit(1)
    doc = {
        'version': 1, 'kind': 'pv-cameras',
        'width': ctl['width'], 'height': ctl['height'], 'nearM': ctl['nearM'], 'farM': ctl['farM'],
        'eyeHeightM': ctl['eyeHeightM'], 'fps': FPS,
        'coordinateNote': ctl['coordinateNote'],
        'sources': {'pv': os.path.relpath(os.path.abspath(args.pv), ROOT), 'controlShots': os.path.relpath(os.path.join(oz, 'control-shots.json'), ROOT),
                    'layout': 'baseline/layout.json'},
        'lightTags': pv.get('lightTags'),
        'totalS': round(sum(s['durationS'] for s in shots), 3),
        'shots': shots,
    }
    full = os.path.join(oz, 'pv-cameras.json')
    with open(full, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('pv-cameras.json: %d shots, %.1f s, %d frames @%d fps' % (len(shots), doc['totalS'], sum(s['frames'] for s in shots), FPS))
    for s in shots:
        print('  %02d %-28s %-6s %4.1fs %-5s %-20s eye %5.1f m  %s' % (s['no'], s['id'], s['status'], s['durationS'], s['light'],
                                                                   s['targetId'], s['eyePathM'], 'reuse ' + s['reuse']['shot'] if 'reuse' in s else 'new'))
    if args.sample:
        sd = sample(doc, args.sample)
        outp = args.out or os.path.join(oz, 'pv-cameras-%s.json' % args.sample.replace(':', ''))
        os.makedirs(os.path.dirname(os.path.abspath(outp)), exist_ok=True)
        with open(outp, 'w', encoding='utf-8') as f:
            json.dump(sd, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print('sample %s -> %s (%d frames)' % (args.sample, outp, sum(s['frames'] for s in sd['shots'])))


if __name__ == '__main__':
    main()
