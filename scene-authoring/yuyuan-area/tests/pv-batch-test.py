#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-pvbatch R1：PV 批量调度器（scripts/render-pv-batch.py）测试 — 假渲染器，不启动 Blender。

R1 按 REVIEW-astra 8 必修 + 2 可选返修。红绿对照：R0 交付（24533371）上本测试的必修负例
全部 FAIL（artifacts/r1/logs/pv-batch-test-R1-RED.log），返修后全绿。

调度器经 PV_BATCH_BLENDER 指向一个写占位 PNG 的 stub（接收与 Blender 相同的 argv），
帧数从正本 scripts/pv-shots.json 的 durationS×fps 推导，与调度器同一口径。
齐全性判定期望尺寸用 PV_BATCH_FRAME_SIZE=160x90（stub 同读该 env 写同尺寸帧与 cameras json）。
GPU 锁用 PV_BATCH_GPU_LOCK 指到 tmp（不碰真机 /tmp/pawborough-gpu.lock）。

覆盖（对应审查编号）：
  必修1 配置指纹：.done.json 字段（argv/渲染器 sha/场景/相机/presets sha/帧数/mode/守卫）；
     指纹不一致默认报错停下且不渲任何帧、说明字段（argv）；--rerender-mismatch 整镜移 _discard
     （不删文件）后重渲；帧齐全但无 .done.json → 报错停下。
  必修2 齐全判定：缺 cameras json、截断 JSON、cameras shot 字段错、中间帧尺寸错、
     不可解码 PNG（截断 IDAT：verify 过、load 挂）、depth 非 16-bit → 都判不齐全并补渲。
  必修3 守卫不可洗白：黑帧失败后同命令重跑仍 failed-guard、零渲染调用（重新守卫）。
  必修4 守卫时机：默认逐镜调用（dusk=2 次单镜命令）；黑帧失败后下一镜无产物、零额外调用；
     --fast-group 才组渲且 RESULT 标注 fastGroup + 守卫滞后。
  必修5 锁：跨 out-root 的全机 GPU 锁互斥；同 out-root 双开被拒；父进程被 SIGKILL 后
     锁仍被孤儿渲染进程持有（pass_fds）；SIGTERM 终止渲染进程组并回收、退出码 143、写 RESULT；
     空闲后两个并发启动恰一个成功。
  必修6 --extra：完整名/缩写/= 形式的自管参数被拒；带空格路径 argv 不被拆；
     渲染器暂不认识的未来参数（--beauty-denoise on）透传。
  必修7 冒烟隔离：--frames N 产物全在 <out-root>/_smoke/，done 标 mode=smoke；
     正式模式拒绝把 smoke 记录当完成。
  必修8 参数契约：docstring 无裸 --beauty-denoise（必须带 on|off 值）。
  可选2 dry-run 另列实际执行 argv（含 --frames、nice、替换后的可执行文件）。
  回归：dry-run 19 条 = pv-docs 独立生成（折叠空白后单行一致）、1872 帧；续跑只补缺失镜；
     进度/RESULT 字段完整；--frames 2 传给渲染器。

用法：python3 -X utf8 tests/pv-batch-test.py（npm test 已挂；无需 out-zone 重建，不碰仓库文件）
"""
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULER = os.path.join(AREA, 'scripts', 'render-pv-batch.py')
PV_SHOTS = os.path.join(AREA, 'scripts', 'pv-shots.json')
PV_DOCS = os.path.join(AREA, 'scripts', 'pv-docs.py')
RENDERER = os.path.join(AREA, 'scripts', 'render-control-passes.py')
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')
FAILS = []
TMPS = []
ORPHANS = []  # 锁测试起的 stub pid，finally 兜底清理

STUB_SRC = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wave12-pvbatch R1 测试 stub：Blender 替身。接收 Blender 同款 argv（第一个 -- 之后是渲染器参数），
# 按 --out/--shots/--frames 写占位 PNG（四通道，depth 16-bit）+ 契约完整的 cameras json。
# PV_BATCH_STUB_MODE=ok|black|white|nocam；PV_BATCH_STUB_SLEEP=N 先睡 N 秒（锁/信号测试）；
# PV_BATCH_STUB_PIDFILE 追加写自身 pid（父进程被杀测试用）；PV_BATCH_STUB_LOG 追加写
# 'ARGV <json数组>'（--extra 空格保真断言用）与旧行为一行空格拼接。
import json
import os
import sys
import time

AREA = __AREA__
log = os.environ.get('PV_BATCH_STUB_LOG')
argv = sys.argv[1:]
if log:
    with open(log, 'a', encoding='utf-8') as f:
        f.write('ARGV ' + json.dumps(argv) + '\\n')
        f.write(' '.join(argv) + '\\n')
pidfile = os.environ.get('PV_BATCH_STUB_PIDFILE')
if pidfile:
    with open(pidfile, 'a', encoding='utf-8') as f:
        f.write('%d\\n' % os.getpid())
sleep_s = float(os.environ.get('PV_BATCH_STUB_SLEEP', '0') or 0)
if sleep_s:
    time.sleep(sleep_s)

args = argv[argv.index('--') + 1:] if '--' in argv else []


def opt(name):
    if name in args and args.index(name) + 1 < len(args):
        return args[args.index(name) + 1]
    return ''


out = opt('--out')
want = opt('--shots')
frames = opt('--frames')
mode = os.environ.get('PV_BATCH_STUB_MODE', 'ok')
W, H = (int(x) for x in os.environ.get('PV_BATCH_FRAME_SIZE', '160x90').lower().split('x'))
pv = json.load(open(os.path.join(AREA, 'scripts', 'pv-shots.json'), encoding='utf-8'))
fps = pv.get('fps', 24)
by_id = {s['id']: s for s in pv['shots']}

from PIL import Image

I4 = [[1.0] * 4 for _ in range(4)]
K3 = [[800.0, 0, W / 2], [0, 800.0, H / 2], [0, 0, 1]]

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
            p = os.path.join(d, 'frame-%03d.png' % k)
            if mode in ('black', 'white'):
                v = 0 if mode == 'black' else 255
                if ch == 'depth':
                    im = Image.new('I', (W, H), v * 257)
                else:
                    im = Image.new('RGB', (W, H), (v, v, v))
            elif ch == 'depth':
                g = Image.linear_gradient('L').resize((W, H)).rotate((k * 7) % 90, fillcolor=8)
                im = g.convert('I').point(lambda v: v * 257)
            else:
                g = Image.linear_gradient('L').resize((W, H)).rotate((k * 7) % 90, fillcolor=8)
                im = Image.merge('RGB', (g, g, g))
            im.save(p)
    if mode != 'nocam':
        d = os.path.join(out, sid, 'cameras')
        os.makedirs(d, exist_ok=True)
        for k in idx:
            with open(os.path.join(d, 'frame-%03d.json' % k), 'w', encoding='utf-8') as f:
                json.dump({'shot': sid, 'frame': k, 'width': W, 'height': H,
                           'K': K3, 'worldToCameraOpenGL': I4, 'worldToCameraOpenCV': I4}, f)
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


def base_env(stub, invlog, mode='ok', gpu_lock=None, sleep=None, pidfile=None):
    env = dict(os.environ)
    env.update({'PV_BATCH_BLENDER': stub, 'PV_BATCH_STUB_LOG': invlog,
                'PV_BATCH_STUB_MODE': mode, 'PV_BATCH_FRAME_SIZE': '160x90',
                'PV_BATCH_GPU_LOCK': gpu_lock or os.path.join(os.path.dirname(invlog), 'gpu.lock')})
    if sleep is not None:
        env['PV_BATCH_STUB_SLEEP'] = str(sleep)
    if pidfile:
        env['PV_BATCH_STUB_PIDFILE'] = pidfile
    return env


def run_sched(out_root, group, env=None, more=()):
    cmd = [sys.executable, '-X', 'utf8', SCHEDULER, '--out-root', out_root, '--group', group] + list(more)
    return subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=AREA)


def popen_sched(out_root, group, env, more=()):
    cmd = [sys.executable, '-X', 'utf8', SCHEDULER, '--out-root', out_root, '--group', group] + list(more)
    return subprocess.Popen(cmd, env=env, cwd=AREA, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def invocations(log_path):
    if not os.path.isfile(log_path):
        return []
    return [l for l in open(log_path, encoding='utf-8').read().splitlines() if l.strip() and not l.startswith('ARGV ')]


def argv_invocations(log_path):
    out = []
    if not os.path.isfile(log_path):
        return out
    for l in open(log_path, encoding='utf-8').read().splitlines():
        if l.startswith('ARGV '):
            try:
                out.append(json.loads(l[5:]))
            except Exception:
                pass
    return out


def jload(path):
    try:
        return json.load(open(path, encoding='utf-8'))
    except Exception:
        return None


def shot_dir(root, light, sid):
    return os.path.join(root, 'control-24fps-%s' % light, sid)


def sha256_file(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def wait_gone(pid, timeout=8.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if not alive(pid):
            return True
        time.sleep(0.1)
    return not alive(pid)


def wait_pidfile(path, timeout=15.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return [int(x) for x in open(path, encoding='utf-8').read().split() if x.strip().isdigit()]
        time.sleep(0.05)
    return []


def make_undecodable_png(path, w=16, h=16):
    """块结构完整（CRC 对）但 IDAT 的 zlib 流被截断：PIL verify() 过、load() 挂 —— 旧齐全判定的漏网负例。"""
    import struct
    import zlib
    raw = b''.join(b'\x00' + bytes([(i * 3) % 256] * w) for i in range(h))
    good = zlib.compress(raw, 9)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
           + chunk(b'IDAT', good[:len(good) // 2]) + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


def main():
    # 0) 调度器存在性（红检锚点：脚本不存在时本测试直接红）
    if not check('调度器存在 scripts/render-pv-batch.py', os.path.isfile(SCHEDULER)):
        raise SystemExit('E: 先交付调度器脚本')

    tmp = tempfile.mkdtemp(prefix='pv-batch-r1-test-')
    TMPS.append(tmp)
    stub = os.path.join(tmp, 'stub-renderer.py')
    with open(stub, 'w', encoding='utf-8') as f:
        f.write(STUB_SRC.replace('__AREA__', repr(AREA)))
    os.chmod(stub, 0o755)
    invlog = os.path.join(tmp, 'inv.log')
    gpu_lock = os.path.join(tmp, 'gpu.lock')

    # ---------------- 必修8：参数契约（docstring 无裸 --beauty-denoise）----------------
    src = open(SCHEDULER, encoding='utf-8').read()
    doc = src.split('"""')[1] if src.count('"""') >= 2 else ''
    check('必修8 docstring 降噪示例带值（--beauty-denoise on|off）',
          '--beauty-denoise on' in doc or '--beauty-denoise off' in doc)
    check('必修8 docstring 无裸 --beauty-denoise',
          re.search(r'--beauty-denoise(?!\s*(on|off)\b)(?!=)', doc) is None,
          '发现裸 --beauty-denoise（渲染器契约要求 on|off 值）')

    # ---------------- dry-run：19 条命令 = pv-docs 独立生成（折叠空白后单行一致）----------------
    pv_docs = load_pv_docs()
    shots = json.load(open(PV_SHOTS, encoding='utf-8'))['shots']
    by_id = {s['id']: s for s in shots}
    out_root = os.path.join(tmp, 'dryrun-out')
    exp = []
    for light, ids in pv_docs.light_groups(shots):
        exp.append(' '.join(pv_docs.export_command(ids, light, out_root).replace(' \\\n', ' ').split()))
    for s in shots:
        exp.append(' '.join(pv_docs.export_command([s['id']], s['light'], out_root).replace(' \\\n', ' ').split()))
    r = run_sched(out_root, 'all', base_env(stub, invlog) | {'PV_BATCH_BLENDER': stub}, more=('--dry-run', '--nice', '5'))
    got = [l for l in r.stdout.splitlines() if l.startswith('~/.local/bin/blender')]
    check('dry-run 退出码 0', r.returncode == 0, r.stderr.strip()[:200])
    check('dry-run 19 条命令 = pv-docs 独立生成（折叠空白后单行一致）', exp == got, 'expected %d got %d' % (len(exp), len(got)))
    if exp != got:
        for i, (e, g) in enumerate(zip(exp, got)):
            if e != g:
                print('  首个差异 #%d\n   exp: %s\n   got: %s' % (i, e, g))
                break
    # 可选2：dry-run 另列实际执行 argv（含替换后的可执行文件与 nice）
    exec_lines = [l for l in r.stdout.splitlines() if l.startswith('  exec-argv: ')]
    check('可选2 dry-run 逐条列实际执行 argv（19 条）', len(exec_lines) == 19, 'n=%d' % len(exec_lines))
    check('可选2 实际 argv 含替换后可执行文件与 nice',
          len(exec_lines) == 19 and all(stub in l and 'nice -n 5' in l for l in exec_lines),
          exec_lines[0][:160] if exec_lines else '<无>')
    check('dry-run 总帧数 1872', any('# commands=19  selected-frames=1872' in l for l in r.stdout.splitlines()))
    check('dry-run 不写文件', not os.path.exists(out_root))

    # ---------------- 必修4：默认逐镜调用（dusk 全新跑 = 2 次单镜命令）+ 必修1 done.json ----------------
    out1 = os.path.join(tmp, 'run-dusk')
    inv1 = os.path.join(tmp, 'inv-dusk.log')
    r = run_sched(out1, 'dusk', base_env(stub, inv1))
    check('必修4 dusk 全新跑退出码 0（默认逐镜）', r.returncode == 0, (r.stdout + r.stderr).strip()[-400:])
    calls1 = invocations(inv1)
    check('必修4 默认逐镜：stub 恰 2 次调用、每次只含一镜', len(calls1) == 2 and '--shots pv14-bazaar-dusk' in calls1[0]
          and '--shots pv15-huxin-dusk' in calls1[1], 'n=%d' % len(calls1))
    base1 = os.path.join(out1, 'control-24fps-dusk')
    for sid, n in (('pv14-bazaar-dusk', 120), ('pv15-huxin-dusk', 96)):
        cnt = {ch: len(os.listdir(os.path.join(base1, sid, ch))) if os.path.isdir(os.path.join(base1, sid, ch)) else -1
               for ch in CHANNELS + ('cameras',)}
        check('%s 四通道+cameras 各 %d 帧' % (sid, n), all(v == n for v in cnt.values()), str(cnt))
    res1 = jload(os.path.join(out1, 'RESULT.json'))
    check('RESULT status=ok 且 mode=formal', res1 and res1.get('status') == 'ok' and res1.get('mode') == 'formal')
    st1 = {x['id']: x['status'] for x in res1['shots']} if res1 else {}
    check('RESULT 两镜 rendered-shot（默认逐镜）',
          st1 == {'pv14-bazaar-dusk': 'rendered-shot', 'pv15-huxin-dusk': 'rendered-shot'}, str(st1))
    check('sheets 生成', all(os.path.getsize(os.path.join(out1, 'sheets', '%s.png' % s)) > 0
                             for s in ('pv14-bazaar-dusk', 'pv15-huxin-dusk')))
    # 必修1：.done.json 字段与指纹
    d14 = jload(os.path.join(base1, 'pv14-bazaar-dusk', '.done.json'))
    fp14 = (d14 or {}).get('fingerprint') or {}
    need_fp = ('argv', 'rendererSha256', 'presetsSha256', 'sceneSha256', 'camerasSha256', 'framesCount', 'mode')
    ok_fp = (d14 is not None and d14.get('guard') == 'pass' and all(k in fp14 for k in need_fp)
             and fp14.get('framesCount') == 120 and fp14.get('mode') == 'formal'
             and fp14.get('rendererSha256') == sha256_file(RENDERER)
             and fp14.get('sceneSha256') == sha256_file(os.path.join(AREA, 'out-zone', 'scene-areas.glb'))
             and fp14.get('camerasSha256') == sha256_file(os.path.join(AREA, 'out-zone', 'pv-cameras.json'))
             and fp14.get('presetsSha256') == sha256_file(os.path.join(AREA, 'lighting', 'presets.json'))
             and isinstance(fp14.get('argv'), list) and '--shots' in fp14['argv']
             and fp14['argv'][fp14['argv'].index('--shots') + 1] == 'pv14-bazaar-dusk')
    check('必修1 pv14 .done.json 指纹字段齐且与实际文件 sha 一致', ok_fp, str(fp14)[:300])

    # 进度/RESULT 字段完整（回归）
    prog = jload(os.path.join(out1, 'pv-batch-progress.json'))
    check('progress 全局字段完整（含 mode/fastGroup）',
          prog and all(k in prog for k in ('startedAt', 'updatedAt', 'etaSeconds', 'stoppedReason', 'shots', 'group', 'fps', 'mode', 'fastGroup')))
    for sid, n in (('pv14-bazaar-dusk', 120), ('pv15-huxin-dusk', 96)):
        p = (prog or {}).get('shots', {}).get(sid, {})
        need = ('status', 'framesExpected', 'framesDone', 'secondsTotal', 'secondsPerFrame', 'guard', 'command')
        ok_p = (all(k in p for k in need) and p.get('framesExpected') == n and p.get('framesDone') == n
                and p.get('status') == 'rendered-shot' and p.get('guard') == 'pass'
                and p.get('secondsPerFrame') is not None and p.get('secondsPerFrame', -1) >= 0
                and p.get('command') and '--beauty cycles --preset dusk' in p['command'])
        check('progress %s 字段完整' % sid, ok_p, str(p)[:220])

    # ---------------- 回归：断点续跑只补缺失镜 ----------------
    shutil.rmtree(os.path.join(base1, 'pv15-huxin-dusk'))
    r = run_sched(out1, 'dusk', base_env(stub, inv1))
    check('续跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-400:])
    calls2 = invocations(inv1)
    check('续跑只新增 1 次调用且只含 pv15', len(calls2) == 3 and '--shots pv15-huxin-dusk' in calls2[2] and 'pv14' not in calls2[2],
          'n=%d' % len(calls2))
    res2 = jload(os.path.join(out1, 'RESULT.json'))
    st2 = {x['id']: x['status'] for x in res2['shots']} if res2 else {}
    check('续跑 RESULT：pv14 指纹一致跳过、pv15 逐镜补渲',
          st2 == {'pv14-bazaar-dusk': 'complete-preexisting', 'pv15-huxin-dusk': 'rendered-shot'}, str(st2))

    # ---------------- 必修1：指纹不一致默认报错停下（不渲任何帧、说明字段）----------------
    r = run_sched(out1, 'dusk', base_env(stub, inv1), more=('--extra', '--beauty-samples 999'))
    out_txt = r.stdout + r.stderr
    check('必修1 指纹不一致默认报错停下（退出码非 0）', r.returncode != 0, 'rc=%d' % r.returncode)
    check('必修1 报错说明是哪个字段（argv）且提到指纹', '指纹' in out_txt and 'argv' in out_txt, out_txt.strip()[-300:])
    check('必修1 报错时不渲染任何帧', len(invocations(inv1)) == 3, 'n=%d' % len(invocations(inv1)))
    prog = jload(os.path.join(out1, 'pv-batch-progress.json'))
    check('必修1 progress 记 blocked 状态', prog and all(p.get('status') == 'blocked-fingerprint' for p in prog['shots'].values()))

    # ---------------- 必修1：--rerender-mismatch 整镜移 _discard 后重渲（不删文件）----------------
    r = run_sched(out1, 'dusk', base_env(stub, inv1), more=('--extra', '--beauty-samples 999', '--rerender-mismatch'))
    check('必修1 --rerender-mismatch 重渲退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-400:])
    disc = os.path.join(out1, '_discard')
    disc_dirs = sorted(os.listdir(disc)) if os.path.isdir(disc) else []
    check('必修1 _discard 收到两镜旧产物（不删文件）',
          len(disc_dirs) == 2 and any('pv14' in d for d in disc_dirs) and any('pv15' in d for d in disc_dirs), str(disc_dirs))
    check('必修1 _discard 旧帧仍在（pv14 beauty 120 帧）',
          any(os.path.isdir(os.path.join(disc, d, 'beauty')) and len(os.listdir(os.path.join(disc, d, 'beauty'))) == 120
              for d in disc_dirs if 'pv14' in d))
    calls3 = invocations(inv1)
    check('必修1 mismatch 重渲补齐两镜（新增 2 次单镜调用）', len(calls3) == 5, 'n=%d' % len(calls3))
    d14 = jload(os.path.join(base1, 'pv14-bazaar-dusk', '.done.json'))
    check('必修1 重渲后 .done.json 记录新 argv（--beauty-samples 999）',
          d14 and '--beauty-samples' in d14['fingerprint']['argv'] and '999' in d14['fingerprint']['argv'])
    res3 = jload(os.path.join(out1, 'RESULT.json'))
    check('必修1 RESULT 记录 discarded 两条', res3 and len(res3.get('discarded', [])) == 2, str(res3.get('discarded'))[:200])

    # ---------------- 必修1：帧齐全但无 .done.json → 报错停下 ----------------
    out_nb = os.path.join(tmp, 'run-nodone')
    inv_nb = os.path.join(tmp, 'inv-nodone.log')
    r = run_sched(out_nb, 'dusk', base_env(stub, inv_nb))
    done_nb = os.path.join(out_nb, 'control-24fps-dusk', 'pv14-bazaar-dusk', '.done.json')
    if os.path.exists(done_nb):
        os.remove(done_nb)  # 旧树上无 .done.json 时天然就是"无记录"状态，同一路径
    r = run_sched(out_nb, 'dusk', base_env(stub, inv_nb))
    check('必修1 无 .done.json：帧齐全也报错停下', r.returncode != 0 and '完成记录' in (r.stdout + r.stderr),
          (r.stdout + r.stderr).strip()[-300:])
    check('必修1 无 .done.json：不渲染任何帧', len(invocations(inv_nb)) == 2, 'n=%d' % len(invocations(inv_nb)))

    # ---------------- 必修4 + 必修3：黑帧 → 立即停，下一镜无产物；重跑重新守卫仍停 ----------------
    out3 = os.path.join(tmp, 'run-black')
    inv3 = os.path.join(tmp, 'inv-black.log')
    r = run_sched(out3, 'dusk', base_env(stub, inv3, mode='black'))
    check('全黑输出时调度器退出码非 0', r.returncode != 0, 'rc=%d' % r.returncode)
    calls_b = invocations(inv3)
    check('必修4 黑帧后下一镜没有开始（恰 1 次调用且只含 pv14）',
          len(calls_b) == 1 and '--shots pv14-bazaar-dusk' in calls_b[0], 'n=%d' % len(calls_b))
    check('必修4 黑帧后下一镜无任何产物',
          not os.path.exists(shot_dir(out3, 'dusk', 'pv15-huxin-dusk')))
    res3 = jload(os.path.join(out3, 'RESULT.json'))
    st3 = {x['id']: x['status'] for x in res3['shots']} if res3 else {}
    check('黑帧时 pv14 failed-guard、pv15 pending',
          st3 == {'pv14-bazaar-dusk': 'failed-guard', 'pv15-huxin-dusk': 'pending'}, str(st3))
    check('RESULT status=failed 且 stoppedReason 指明守卫',
          bool(res3) and res3.get('status') == 'failed' and 'pv14' in (res3.get('stoppedReason') or '')
          and '守卫' in (res3.get('stoppedReason') or ''),
          (res3 or {}).get('stoppedReason', ''))
    d14 = jload(os.path.join(out3, 'control-24fps-dusk', 'pv14-bazaar-dusk', '.done.json'))
    check('必修3 黑帧后 .done.json 记 guard=fail', d14 is not None and d14.get('guard') == 'fail')
    # 必修3：同命令重跑 → 重新守卫（零渲染调用），仍失败仍停
    r = run_sched(out3, 'dusk', base_env(stub, inv3, mode='black'))
    check('必修3 守卫失败不被续跑洗白（重跑仍非 0）', r.returncode != 0, 'rc=%d' % r.returncode)
    check('必修3 重跑零渲染调用（重新守卫即可）', len(invocations(inv3)) == 1, 'n=%d' % len(invocations(inv3)))
    res3b = jload(os.path.join(out3, 'RESULT.json'))
    st3b = {x['id']: x['status'] for x in res3b['shots']} if res3b else {}
    check('必修3 重跑 pv14 仍 failed-guard（非 complete/ok）',
          st3b.get('pv14-bazaar-dusk') == 'failed-guard' and bool(res3b) and res3b.get('status') == 'failed', str(st3b))

    # ---------------- 必修4：--fast-group 组渲 + 守卫滞后标注 ----------------
    out_fg = os.path.join(tmp, 'run-fastgroup')
    inv_fg = os.path.join(tmp, 'inv-fg.log')
    r = run_sched(out_fg, 'dusk', base_env(stub, inv_fg), more=('--fast-group',))
    check('必修4 --fast-group 退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    calls_fg = invocations(inv_fg)
    check('必修4 --fast-group 恰 1 次组命令（含两镜）',
          len(calls_fg) == 1 and '--shots pv14-bazaar-dusk,pv15-huxin-dusk' in calls_fg[0], 'n=%d' % len(calls_fg))
    res_fg = jload(os.path.join(out_fg, 'RESULT.json'))
    check('必修4 RESULT 标注 fastGroup=true 与守卫滞后',
          res_fg and res_fg.get('fastGroup') is True and '滞后' in json.dumps(res_fg.get('shots', []), ensure_ascii=False))
    d14 = jload(os.path.join(out_fg, 'control-24fps-dusk', 'pv14-bazaar-dusk', '.done.json'))
    check('必修4 组渲出的镜头 .done.json 仍记逐镜规范 argv',
          d14 and d14['fingerprint']['argv'][d14['fingerprint']['argv'].index('--shots') + 1] == 'pv14-bazaar-dusk')

    # ---------------- 必修2：齐全判定负例（每例：破坏 → 续跑必须补渲该镜）----------------
    out5 = os.path.join(tmp, 'run-complete')
    inv5 = os.path.join(tmp, 'inv-complete.log')
    run_sched(out5, 'dusk', base_env(stub, inv5))
    n0 = len(invocations(inv5))

    def corrupt_then_rerun(label, corrupt):
        corrupt()
        before = len(invocations(inv5))
        rr = run_sched(out5, 'dusk', base_env(stub, inv5))
        after = invocations(inv5)
        ok = rr.returncode == 0 and len(after) == before + 1 and '--shots pv14-bazaar-dusk' in after[-1]
        check('必修2 %s → 判不齐全并补渲' % label, ok,
              'rc=%d n=%d last=%s' % (rr.returncode, len(after), after[-1][:120] if after else '<无>'))
        return ok

    cam14 = os.path.join(out5, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'cameras')
    beauty14 = os.path.join(out5, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'beauty')
    depth14 = os.path.join(out5, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'depth')
    corrupt_then_rerun('缺 1 个 cameras json', lambda: os.remove(os.path.join(cam14, 'frame-010.json')))
    corrupt_then_rerun('截断的 cameras JSON',
                       lambda: open(os.path.join(cam14, 'frame-011.json'), 'w', encoding='utf-8').write('{"shot": "pv14'))
    def _wrong_shot():
        p = os.path.join(cam14, 'frame-012.json')
        d = jload(p) or {}
        d['shot'] = 'pv15-huxin-dusk'
        json.dump(d, open(p, 'w', encoding='utf-8'))
    corrupt_then_rerun('cameras shot 字段错', _wrong_shot)

    def _wrong_size():
        from PIL import Image
        Image.new('RGB', (8, 8), (9, 9, 9)).save(os.path.join(beauty14, 'frame-060.png'))
    corrupt_then_rerun('中间帧尺寸错（8×8）', _wrong_size)
    corrupt_then_rerun('不可解码 PNG（截断 IDAT：verify 过 load 挂）',
                       lambda: make_undecodable_png(os.path.join(beauty14, 'frame-061.png')))

    def _depth_8bit():
        from PIL import Image
        Image.new('RGB', (160, 90), (5, 5, 5)).save(os.path.join(depth14, 'frame-062.png'))
    corrupt_then_rerun('depth 非 16-bit（RGB 8-bit）', _depth_8bit)

    # ---------------- 必修6：--extra 自管参数拒绝（完整名/缩写/= 形式）----------------
    for label, extra in (('--sho 缩写覆盖镜头', '--sho pv15-huxin-dusk'),
                         ('--frames=5 覆盖帧范围', '--frames=5'),
                         ('--fra 缩写覆盖帧范围', '--fra 5'),
                         ('--out= 形式覆盖输出', '--out=/tmp/evil'),
                         ('--passes 破坏通道契约', '--passes beauty'),
                         ('--sc 缩写覆盖场景', '--sc /tmp/x.glb'),
                         ('裸 -- 终止渲染器选项解析', '--')):
        r = run_sched(os.path.join(tmp, 'run-extra-reject'), 'dusk', base_env(stub, invlog),
                      more=('--extra=' + extra,))
        out_txt = r.stdout + r.stderr
        check('必修6 拒绝 %s' % label, r.returncode != 0 and '自管' in out_txt, 'rc=%d %s' % (r.returncode, out_txt.strip()[-160:]))
    check('必修6 拒绝时未起任何渲染', len(invocations(invlog)) == 0, 'n=%d' % len(invocations(invlog)))

    # ---------------- 必修6：带空格参数 argv 保真 + 未来参数透传 ----------------
    out6 = os.path.join(tmp, 'run-extra-space')
    inv6 = os.path.join(tmp, 'inv-space.log')
    spaced = '/tmp/pv batch test/presets-x.json'
    os.makedirs(os.path.dirname(spaced), exist_ok=True)
    shutil.copyfile(os.path.join(AREA, 'lighting', 'presets.json'), spaced)  # 真实存在：调度器对指纹输入做存在性预检
    r = run_sched(out6, 'night', base_env(stub, inv6), more=('--shots', 'pv16', '--extra', '--presets "%s" --beauty-denoise on' % spaced))
    check('必修6 带空格 --presets + 未来参数 --beauty-denoise on 可跑', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    av = argv_invocations(inv6)
    check('必修6 带空格路径在 argv 中是单个参数（不被拆）',
          len(av) == 1 and spaced in av[0], json.dumps(av)[:300] if av else '<无>')
    check('必修6 --beauty-denoise on 原样透传（两个 token）',
          len(av) == 1 and '--beauty-denoise' in av[0] and av[0][av[0].index('--beauty-denoise') + 1] == 'on')

    # ---------------- 必修7：冒烟隔离 _smoke ----------------
    out7 = os.path.join(tmp, 'run-smoke')
    inv7 = os.path.join(tmp, 'inv-smoke.log')
    r = run_sched(out7, 'night', base_env(stub, inv7), more=('--shots', 'pv16', '--frames', '2'))
    check('必修7 冒烟退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    check('必修7 冒烟产物在 _smoke 子目录', os.path.isdir(os.path.join(out7, '_smoke', 'control-24fps-night', 'pv16-night-finale')))
    base7 = os.path.join(out7, '_smoke', 'control-24fps-night', 'pv16-night-finale')
    check('必修7 冒烟每通道恰 2 帧',
          all(os.path.isdir(os.path.join(base7, ch)) and len(os.listdir(os.path.join(base7, ch))) == 2
              for ch in CHANNELS + ('cameras',)))
    d16 = jload(os.path.join(base7, '.done.json'))
    check('必修7 冒烟 .done.json 标 mode=smoke 且指纹含 --frames',
          d16 and d16.get('mode') == 'smoke' and '--frames' in d16['fingerprint']['argv'])
    res7 = jload(os.path.join(out7, '_smoke', 'RESULT.json'))
    check('必修7 冒烟 RESULT 写在 _smoke 且 mode=smoke', res7 and res7.get('mode') == 'smoke')
    check('必修7 正式目录无冒烟产物/RESULT', not os.path.exists(os.path.join(out7, 'RESULT.json'))
          and not os.path.exists(os.path.join(out7, 'control-24fps-night')))
    check('冒烟 --frames 0,1 传给渲染器', any('--frames 0,1' in l for l in invocations(inv7)))
    r = run_sched(os.path.join(out7, '_smoke'), 'night', base_env(stub, inv7), more=('--shots', 'pv16',))
    check('必修7 正式模式拒绝把 smoke 记录当完成', r.returncode != 0 and 'smoke' in (r.stdout + r.stderr),
          (r.stdout + r.stderr).strip()[-300:])

    # ---------------- 必修5：锁（flock + GPU 全机锁 + 进程组/信号）----------------
    # a) 跨 out-root 的 GPU 锁互斥
    pidf = os.path.join(tmp, 'stub-pids.txt')
    slow = base_env(stub, os.path.join(tmp, 'inv-lock.log'), sleep=8, pidfile=pidf, gpu_lock=gpu_lock)
    pa = popen_sched(os.path.join(tmp, 'lock-a'), 'dusk', slow, more=('--shots', 'pv14'))
    ORPHANS.extend(wait_pidfile(pidf))
    rb = run_sched(os.path.join(tmp, 'lock-b'), 'dusk', slow)
    check('必修5 全机 GPU 锁跨 out-root 互斥', rb.returncode != 0 and 'GPU' in (rb.stdout + rb.stderr),
          'rc=%d %s' % (rb.returncode, (rb.stdout + rb.stderr).strip()[-200:]))
    # b) 同 out-root 双开被拒
    rb2 = run_sched(os.path.join(tmp, 'lock-a'), 'dusk', slow)
    check('必修5 同 out-root 双开被拒', rb2.returncode != 0 and ('锁' in (rb2.stdout + rb2.stderr) or '占用' in (rb2.stdout + rb2.stderr)),
          'rc=%d' % rb2.returncode)
    pa.wait(timeout=90)

    # c) 父进程被 SIGKILL：孤儿渲染进程仍持有 GPU 锁
    pidf2 = os.path.join(tmp, 'stub-pids2.txt')
    slow2 = base_env(stub, os.path.join(tmp, 'inv-lock2.log'), sleep=8, pidfile=pidf2, gpu_lock=gpu_lock)
    pa = popen_sched(os.path.join(tmp, 'lock-c'), 'dusk', slow2, more=('--shots', 'pv14'))
    pids = wait_pidfile(pidf2)
    ORPHANS.extend(pids)
    pa.kill()
    pa.wait()
    orphan = pids[-1] if pids else 0
    check('必修5 父进程被杀后孤儿渲染进程仍存活（占着 GPU）', orphan and alive(orphan), 'pid=%s' % orphan)
    fast_env = base_env(stub, os.path.join(tmp, 'inv-lock2.log'), gpu_lock=gpu_lock)
    rc_ = run_sched(os.path.join(tmp, 'lock-d'), 'dusk', fast_env, more=('--shots', 'pv14'))
    check('必修5 父进程消失≠资源空闲：GPU 锁仍被持有', rc_.returncode != 0 and 'GPU' in (rc_.stdout + rc_.stderr),
          'rc=%d' % rc_.returncode)
    if orphan:
        os.kill(orphan, signal.SIGKILL)
        check('必修5 孤儿回收后 GPU 锁释放可再跑', wait_gone(orphan)
              and run_sched(os.path.join(tmp, 'lock-d2'), 'dusk', fast_env, more=('--shots', 'pv14')).returncode == 0)

    # d) SIGTERM：终止渲染进程组并回收、退出码 143、写 RESULT
    pidf3 = os.path.join(tmp, 'stub-pids3.txt')
    slow3 = base_env(stub, os.path.join(tmp, 'inv-lock3.log'), sleep=8, pidfile=pidf3, gpu_lock=gpu_lock)
    pa = popen_sched(os.path.join(tmp, 'lock-e'), 'dusk', slow3, more=('--shots', 'pv14'))
    pids = wait_pidfile(pidf3)
    ORPHANS.extend(pids)
    pa.send_signal(signal.SIGTERM)
    rc_sig = pa.wait(timeout=30)
    child = pids[-1] if pids else 0
    check('必修5 SIGTERM 退出码 143（128+15）', rc_sig == 143, 'rc=%s' % rc_sig)
    check('必修5 SIGTERM 后渲染子进程（进程组）已终止回收', not child or wait_gone(child), 'pid=%s' % child)
    res_sig = jload(os.path.join(tmp, 'lock-e', 'RESULT.json'))
    check('必修5 信号停批也写 RESULT 且说明原因',
          res_sig and res_sig.get('status') == 'failed' and '信号' in (res_sig.get('stoppedReason') or ''),
          str(res_sig.get('stoppedReason')) if res_sig else '<无 RESULT>')

    # e) 空闲后并发启动恰一个成功（flock 内核互斥，无检查后覆盖窗口）
    #    全新目录 + 慢 stub：胜者持锁渲染、败者立即被拒——完全确定性。
    out_cc = os.path.join(tmp, 'lock-race')
    race_pidf = os.path.join(tmp, 'stub-pids-race.txt')
    race_env = base_env(stub, os.path.join(tmp, 'inv-cc1.log'), gpu_lock=gpu_lock, sleep=6, pidfile=race_pidf)
    pb1 = popen_sched(out_cc, 'dusk', race_env)
    pb2 = popen_sched(out_cc, 'dusk', race_env)
    rc1, rc2 = pb1.wait(timeout=90), pb2.wait(timeout=90)
    check('必修5 并发启动恰一个成功（另一个被锁拒绝）', (rc1 == 0) != (rc2 == 0), 'rc1=%s rc2=%s' % (rc1, rc2))
    for pid in wait_pidfile(race_pidf, 1.0):
        ORPHANS.append(pid)

    if FAILS:
        print('pv-batch-test：%d 项 FAIL（tmp 保留：%s）' % (len(FAILS), tmp))
        raise SystemExit(1)
    print('pv-batch-test：all green（%s）' % '、'.join(
        '%s=%d' % (sid, int(round(float(by_id[sid]['durationS']) * 24))) for sid in ('pv14-bazaar-dusk', 'pv15-huxin-dusk')))
    shutil.rmtree(tmp, ignore_errors=True)


def cleanup_orphans():
    for pid in list(ORPHANS):
        if alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass


if __name__ == '__main__':
    try:
        main()
    finally:
        cleanup_orphans()
