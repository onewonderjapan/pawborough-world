#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-pvbatch P2：PV 批量调度器（scripts/render-pv-batch.py）测试 — 假渲染器，不启动 Blender。

调度器经 PV_BATCH_BLENDER 指向一个写占位 PNG 的 stub（本测试生成到 tmp，接收与 Blender 相同的 argv：
取第一个 -- 之后的参数，读 --out/--shots/--frames），帧数从正本 scripts/pv-shots.json 的 durationS×fps 推导，
与调度器同一口径。验证：

  1. 调度器存在（缺脚本即红 — 红绿对照：6a2bf26c 上本测试因找不到 scripts/render-pv-batch.py 失败）；
  2. dry-run 命令与 pv-docs 独立调用生成的 19 条（3 组 + 16 逐镜）逐字节一致，帧数 1872（day 1512 / dusk 216 / night 144）；
  3. 全新跑（--group dusk）：组命令整组渲 + 逐镜阶段全跳过 → stub 恰被调用 1 次；pv14 120 帧 / pv15 96 帧
     四通道 + cameras 齐全；RESULT.json ok；sheets 生成；
  4. 断点续跑：删 pv15 后重跑 → 只补 pv15（stub 新增 1 次调用且 --shots 只含 pv15），pv14 记 complete-preexisting；
  5. 空白帧守卫：stub 写全黑 beauty → pv14 标 failed-guard、批次停下（pv15 保持 pending，stub 总调用数仍 1）、
     调度器退出码非 0、RESULT status=failed；
  6. 进度文件字段完整（全局 startedAt/updatedAt/etaSeconds/stoppedReason + 每镜 status/framesExpected/framesDone/
     secondsTotal/secondsPerFrame/guard/command）。

用法：python3 -X utf8 tests/pv-batch-test.py（npm test 已挂；无需 out-zone 重建，不碰仓库文件）
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULER = os.path.join(AREA, 'scripts', 'render-pv-batch.py')
PV_SHOTS = os.path.join(AREA, 'scripts', 'pv-shots.json')
PV_DOCS = os.path.join(AREA, 'scripts', 'pv-docs.py')
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')
FAILS = []
TMPS = []

STUB_SRC = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wave12-pvbatch 测试 stub：Blender 替身。接收 Blender 同款 argv（第一个 -- 之后是渲染器参数），
# 按 --out/--shots/--frames 写占位 PNG（四通道）+ cameras json。PV_BATCH_STUB_MODE=ok|black|white。
import json
import os
import sys

AREA = __AREA__
log = os.environ.get('PV_BATCH_STUB_LOG')
if log:
    with open(log, 'a', encoding='utf-8') as f:
        f.write(' '.join(sys.argv) + '\\n')

argv = sys.argv[1:]
args = argv[argv.index('--') + 1:] if '--' in argv else []


def opt(name):
    return args[args.index(name) + 1] if name in args else ''


out = opt('--out')
want = opt('--shots')
frames = opt('--frames')
mode = os.environ.get('PV_BATCH_STUB_MODE', 'ok')
pv = json.load(open(os.path.join(AREA, 'scripts', 'pv-shots.json'), encoding='utf-8'))
fps = pv.get('fps', 24)
by_id = {s['id']: s for s in pv['shots']}

from PIL import Image

for sid in [i for i in want.split(',') if i]:
    n = int(round(float(by_id[sid]['durationS']) * fps))
    if frames:
        idx = []
        for tok in frames.split(','):
            k = n - 1 if tok == 'last' else int(tok)
            idx.append(k + n if k < 0 else k)
        idx = [k for k in idx if 0 <= k < n]
    else:
        idx = list(range(n))
    for ch in ('beauty', 'depth', 'normal', 'segmentation'):
        d = os.path.join(out, sid, ch)
        os.makedirs(d, exist_ok=True)
        for k in idx:
            if mode == 'black':
                im = Image.new('RGB', (160, 90), (0, 0, 0))
            elif mode == 'white':
                im = Image.new('RGB', (160, 90), (255, 255, 255))
            else:
                g = Image.linear_gradient('L').resize((160, 90)).rotate((k * 7) % 90, fillcolor=8)
                im = Image.merge('RGB', (g, g, g))
            im.save(os.path.join(d, 'frame-%03d.png' % k))
    d = os.path.join(out, sid, 'cameras')
    os.makedirs(d, exist_ok=True)
    for k in idx:
        with open(os.path.join(d, 'frame-%03d.json' % k), 'w', encoding='utf-8') as f:
            json.dump({'stub': True, 'k': k, 'K': []}, f)
print('stub mode=%s shots=%s out=%s' % (mode, want, out))
'''


def check(name, ok, detail=''):
    print('%s %s%s' % ('PASS' if ok else 'FAIL', name, ('：' + detail) if detail else ''))
    if not ok:
        FAILS.append(name)
    return ok


def load_pv_docs():
    spec = importlib.util.spec_from_file_location('pv_docs_for_test', PV_DOCS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_sched(out_root, group, env_extra=None, more=()):
    env = dict(os.environ)
    env.update(env_extra or {})
    cmd = [sys.executable, '-X', 'utf8', SCHEDULER, '--out-root', out_root, '--group', group] + list(more)
    return subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=AREA)


def invocations(log_path):
    if not os.path.isfile(log_path):
        return []
    return [l for l in open(log_path, encoding='utf-8').read().splitlines() if l.strip()]


def main():
    # 0) 调度器存在性（6a2bf26c 红检点）
    if not check('调度器存在 scripts/render-pv-batch.py', os.path.isfile(SCHEDULER)):
        raise SystemExit('E: 先交付 P1 调度器（红检：6a2bf26c 上本测试找不到脚本）')

    tmp = tempfile.mkdtemp(prefix='pv-batch-test-')
    TMPS.append(tmp)
    stub = os.path.join(tmp, 'stub-renderer.py')
    with open(stub, 'w', encoding='utf-8') as f:
        f.write(STUB_SRC.replace('__AREA__', repr(AREA)))
    os.chmod(stub, 0o755)
    invlog = os.path.join(tmp, 'invocations.log')

    # 1) dry-run：19 条命令与 pv-docs 独立生成逐字节一致；帧数注记正确
    pv_docs = load_pv_docs()
    shots = json.load(open(PV_SHOTS, encoding='utf-8'))['shots']
    by_id = {s['id']: s for s in shots}
    out_root = os.path.join(tmp, 'dryrun-out')
    exp = []
    for light, ids in pv_docs.light_groups(shots):
        exp.append(' '.join(pv_docs.export_command(ids, light, out_root).replace(' \\\n', ' ').split()))
    for s in shots:
        exp.append(' '.join(pv_docs.export_command([s['id']], s['light'], out_root).replace(' \\\n', ' ').split()))
    r = run_sched(out_root, 'all', more=('--dry-run',))
    got = [l for l in r.stdout.splitlines() if l.startswith('~/.local/bin/blender')]
    check('dry-run 退出码 0', r.returncode == 0, r.stderr.strip()[:200])
    check('dry-run 19 条命令 = pv-docs 独立生成', exp == got, 'expected %d got %d' % (len(exp), len(got)))
    if exp != got:
        for i, (e, g) in enumerate(zip(exp, got)):
            if e != g:
                print('  首个差异 #%d\n   exp: %s\n   got: %s' % (i, e, g))
                break
    n_by_light = {}
    for s in shots:
        n_by_light[s['light']] = n_by_light.get(s['light'], 0) + int(round(float(s['durationS']) * 24))
    group_lines = [l for l in r.stdout.splitlines() if l.startswith('[group ')]
    ok_g = group_lines == ['[group group:%s] shots=%d frames=%d' % (li, ni, n_by_light[li])
                           for li, ni in [(x[0], len(x[1])) for x in pv_docs.light_groups(shots)]]
    check('dry-run 组命令帧数注记 day1512/dusk216/night144', ok_g, ' | '.join(group_lines))
    check('dry-run 总帧数 1872', any('# commands=19  selected-frames=1872' in l for l in r.stdout.splitlines()))
    check('dry-run 不写文件', not os.path.exists(out_root))

    # 2) 全新跑 --group dusk：组命令整组渲、逐镜全跳过（stub 恰 1 次调用）
    out1 = os.path.join(tmp, 'run-dusk')
    r = run_sched(out1, 'dusk', {'PV_BATCH_BLENDER': stub, 'PV_BATCH_STUB_LOG': invlog})
    check('dusk 全新跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-400:])
    inv1 = invocations(invlog)
    check('dusk 全新跑 stub 恰 1 次调用（组命令整组渲+逐镜跳过）', len(inv1) == 1, 'n=%d' % len(inv1))
    check('dusk 组命令 --shots 含 pv14,pv15 且 --preset dusk',
          len(inv1) == 1 and '--shots pv14-bazaar-dusk,pv15-huxin-dusk' in inv1[0] and '--preset dusk' in inv1[0])
    base1 = os.path.join(out1, 'control-24fps-dusk')
    for sid, n in (('pv14-bazaar-dusk', 120), ('pv15-huxin-dusk', 96)):
        cnt = {ch: len(os.listdir(os.path.join(base1, sid, ch))) if os.path.isdir(os.path.join(base1, sid, ch)) else -1
               for ch in CHANNELS + ('cameras',)}
        check('%s 四通道+cameras 各 %d 帧' % (sid, n), all(v == n for v in cnt.values()), str(cnt))
    res1 = json.load(open(os.path.join(out1, 'RESULT.json'), encoding='utf-8'))
    check('RESULT status=ok', res1.get('status') == 'ok')
    st1 = {x['id']: x['status'] for x in res1['shots']}
    check('RESULT 两镜 rendered-group', st1 == {'pv14-bazaar-dusk': 'rendered-group', 'pv15-huxin-dusk': 'rendered-group'}, str(st1))
    check('sheets 生成', all(os.path.getsize(os.path.join(out1, 'sheets', '%s.png' % s)) > 0
                             for s in ('pv14-bazaar-dusk', 'pv15-huxin-dusk')))

    # 3) 进度文件字段完整
    prog = json.load(open(os.path.join(out1, 'pv-batch-progress.json'), encoding='utf-8'))
    ok_fields = all(k in prog for k in ('startedAt', 'updatedAt', 'etaSeconds', 'stoppedReason', 'shots', 'group', 'fps'))
    check('progress 全局字段完整', ok_fields, str(sorted(prog.keys())))
    for sid, n in (('pv14-bazaar-dusk', 120), ('pv15-huxin-dusk', 96)):
        p = prog['shots'].get(sid, {})
        need = ('status', 'framesExpected', 'framesDone', 'secondsTotal', 'secondsPerFrame', 'guard', 'command')
        ok_p = (all(k in p for k in need) and p.get('framesExpected') == n and p.get('framesDone') == n
                and p.get('status') == 'rendered-group' and p.get('guard') == 'pass'
                and p.get('secondsPerFrame') is not None and p.get('secondsPerFrame', -1) >= 0
                and p.get('command') and '--beauty cycles --preset dusk' in p['command'])
        check('progress %s 字段完整' % sid, ok_p, str(p))

    # 4) 断点续跑：删 pv15 后重跑只补 pv15
    shutil.rmtree(os.path.join(base1, 'pv15-huxin-dusk'))
    r = run_sched(out1, 'dusk', {'PV_BATCH_BLENDER': stub, 'PV_BATCH_STUB_LOG': invlog})
    check('续跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-400:])
    inv2 = invocations(invlog)
    check('续跑只新增 1 次调用', len(inv2) == 2, 'n=%d' % len(inv2))
    check('续跑调用 --shots 只含 pv15', len(inv2) == 2 and '--shots pv15-huxin-dusk' in inv2[1] and 'pv14' not in inv2[1], inv2[1][:160] if len(inv2) > 1 else '')
    res2 = json.load(open(os.path.join(out1, 'RESULT.json'), encoding='utf-8'))
    st2 = {x['id']: x['status'] for x in res2['shots']}
    check('续跑 RESULT：pv14 已齐跳过、pv15 逐镜补渲',
          st2 == {'pv14-bazaar-dusk': 'complete-preexisting', 'pv15-huxin-dusk': 'rendered-shot'}, str(st2))
    check('续跑后 pv15 帧齐全', all(len(os.listdir(os.path.join(base1, 'pv15-huxin-dusk', ch))) == 96
                                   for ch in CHANNELS + ('cameras',)))

    # 5) 空白帧守卫：全黑 beauty → pv14 失败停批，pv15 不再渲
    out3 = os.path.join(tmp, 'run-black')
    invlog3 = os.path.join(tmp, 'invocations-black.log')
    r = run_sched(out3, 'dusk', {'PV_BATCH_BLENDER': stub, 'PV_BATCH_STUB_LOG': invlog3, 'PV_BATCH_STUB_MODE': 'black'})
    check('全黑输出时调度器退出码非 0', r.returncode != 0, 'rc=%d' % r.returncode)
    inv3 = invocations(invlog3)
    check('全黑时批次停下（只组命令 1 次调用，逐镜阶段未跑）', len(inv3) == 1, 'n=%d' % len(inv3))
    res3 = json.load(open(os.path.join(out3, 'RESULT.json'), encoding='utf-8'))
    st3 = {x['id']: x['status'] for x in res3['shots']}
    check('全黑时 pv14 failed-guard、pv15 pending 未浪费时间',
          st3 == {'pv14-bazaar-dusk': 'failed-guard', 'pv15-huxin-dusk': 'pending'}, str(st3))
    check('RESULT status=failed 且 stoppedReason 指明守卫',
          res3['status'] == 'failed' and 'pv14' in res3.get('stoppedReason', '') and '守卫' in res3.get('stoppedReason', ''),
          res3.get('stoppedReason', ''))
    prog3 = json.load(open(os.path.join(out3, 'pv-batch-progress.json'), encoding='utf-8'))
    g = prog3['shots']['pv14-bazaar-dusk']
    check('progress 记录守卫细节（抽样帧 blank=true）',
          g['guard'] == 'fail' and g.get('guardDetail') and all(f.get('blank') for f in g['guardDetail']['frames']),
          str(g.get('guardDetail')))

    # 6) 冒烟语义 --frames：调度器把前 N 帧传给渲染器并按 N 判齐全
    out4 = os.path.join(tmp, 'run-frames2')
    invlog4 = os.path.join(tmp, 'invocations-f2.log')
    r = run_sched(out4, 'night', {'PV_BATCH_BLENDER': stub, 'PV_BATCH_STUB_LOG': invlog4}, more=('--frames', '2', '--shots', 'pv16'))
    check('--frames 2 冒烟跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    check('--frames 2 传给渲染器', any('--frames 0,1' in l for l in invocations(invlog4)), (invocations(invlog4) or ['<无>'])[0][:200])
    base4 = os.path.join(out4, 'control-24fps-night', 'pv16-night-finale')
    check('--frames 2 每通道恰 2 帧', all(len(os.listdir(os.path.join(base4, ch))) == 2 for ch in CHANNELS + ('cameras',)))

    if FAILS:
        print('pv-batch-test：%d 项 FAIL（tmp 保留：%s）' % (len(FAILS), tmp))
        raise SystemExit(1)
    print('pv-batch-test：all green（%s）' % '、'.join(
        '%s=%d' % (sid, int(round(float(by_id[sid]['durationS']) * 24))) for sid in ('pv14-bazaar-dusk', 'pv15-huxin-dusk')))
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
