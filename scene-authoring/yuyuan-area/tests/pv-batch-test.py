#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-pvbatch R1+R2+R3：PV 批量调度器（scripts/render-pv-batch.py）测试 — 假渲染器，不启动 Blender。

R2 按 REVIEW-astra-R1 必修 1-4 + 可选 3 项返修；R3 按 REVIEW-astra-R2 必修 1：测试自带合成
场景 GLB 与相机输入（经调度器 --scene/--cameras 注入参数），新环境没有 out-zone/pv-cameras.json
也能全绿——实际命令、指纹 sha 与齐全判定期望尺寸用同一份合成输入；保留真实 SHA 校验（注入相机
内容变化 → camerasSha256 指纹阻止复用）与缺件负例（注入文件缺失 → 「指纹输入缺失」报错零渲染），
不跳过任何指纹门禁。红绿对照见 artifacts/r3/logs/。

调度器经 PV_BATCH_BLENDER 指向一个写占位 PNG 的 stub（接收与 Blender 相同的 argv；
stub 按真实 argparse 语义解析：后值覆盖 + 缩写展开 + 未知/歧义参数拒绝），帧数从正本
scripts/pv-shots.json 的 durationS×fps 推导，与调度器同一口径。齐全性判定期望尺寸用
PV_BATCH_FRAME_SIZE=160x90（stub 同读该 env 写同尺寸帧与 cameras json）。GPU 锁用
PV_BATCH_GPU_LOCK 指到 tmp（不碰真机 /tmp/pawborough-gpu.lock）。layout 指纹负例走真实
namespace：隔离软链工作区同一路径改内容（不用 PV_BATCH_LAYOUT_OVERRIDE，该旁路已撤销）。

覆盖（对应审查编号；R1 项全保留）：
  R2必修1 重渲前作废旧标记：指纹检查先于完整性分支（缺文件+换配置 → 报错零渲染）；
     帧不齐(配置一致) → 旧目录(含 .done.json)整镜移 _discard 后干净目录重渲；
     覆盖中断（stub 写一帧后被 SIGTERM）+ 原配置续跑不得被判完成。
  R2必修2 --extra 同值自管选项出现即拒绝（--preset=day 且首镜 day、--sho 首镜 id）；
     stub 后值覆盖语义自证。
  R2必修3 layout 内容 sha 纳入指纹：同路径内容变化阻止复用；--layout 自管。
     E1 起负例走真实 namespace：隔离工作区（软链镜像 area 根，仅 baseline/layout.json 是
     可改副本）里同一路径改内容，渲染器自己的 argparse 默认 --layout（<其 ROOT>/baseline/
     layout.json）就指向该文件——不用 PV_BATCH_LAYOUT_OVERRIDE（该旁路已从调度器撤销）。
  R2必修4 启动前全量解析：裸 --beauty-denoise（缺值）与未知参数在启动 Blender 前被拒并提示。
  E1（pvbatch R2 可选1/3）：指纹拒绝提前退出写本次 blocked RESULT（覆盖旧 ok 收据）；
     stub 自身 argparse 语义——缩写唯一前缀展开、歧义/未知参数按 argparse 退出码 2 拒绝；
     --extra 各拒绝用例独立目录（同坏目录复用会被旧指纹拦住、掩盖真实拒绝原因）。
  R2可选 像素流损坏 PNG（尺寸/编码正确仅像素流坏）；out-root 锁单独互斥（GPU 锁空闲）；
     SIGTERM 孙进程一并回收；complete-preexisting 回填 guard 并注明来源；矩阵 NaN/布尔拒绝。
  必修1 配置指纹：.done.json 字段（argv/渲染器 sha/场景/相机/presets/layout sha/帧数/mode/守卫）；
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
     --presets 透传 + --beauty-denoise on 可跑。
  必修7 冒烟隔离：--frames N 产物全在 <out-root>/_smoke/，done 标 mode=smoke；
     正式模式拒绝把 smoke 记录当完成。
  必修8 参数契约：docstring 无裸 --beauty-denoise（必须带 on|off 值）。
  可选2 dry-run 另列实际执行 argv（含 --frames、nice、替换后的可执行文件）。
  回归：dry-run 19 条 = pv-docs 独立生成（折叠空白后单行一致）、1872 帧；续跑只补缺失镜；
     进度/RESULT 字段完整；--frames 2 传给渲染器。

用法：python3 -X utf8 tests/pv-batch-test.py（npm test 已挂；无需 out-zone 重建与 pv-cameras.json，
不碰仓库文件——场景/相机输入为测试自建合成件）
"""
import fcntl
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
ATMOS_MIX = os.path.join(AREA, 'scripts', 'atmosphere-mix.py')   # R1必修2：混雾脚本进指纹
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')
FAILS = []
TMPS = []
ORPHANS = []  # 锁测试起的 stub pid，finally 兜底清理
SYNTH = {}  # R3 必修1：合成输入注入（--scene/--cameras），main() 里一次性创建

STUB_SRC = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wave12-pvbatch R1/R2 + wave13-debt2 E1 测试 stub：Blender 替身。接收 Blender 同款 argv
# （第一个 -- 之后是渲染器参数），按 --out/--shots/--frames 写占位 PNG（四通道，depth 16-bit）
# + 契约完整的 cameras json。
# 后值覆盖语义：同名选项取最后一次出现（--opt value 与 --opt=value 都认），与真实 argparse 一致。
# E1（pvbatch R2 可选3）：选项名按 argparse 缩写规则解析——完整名直过、唯一前缀展开、
#     歧义前缀与未知参数按 argparse 退出码 2 拒绝（选项表 = render-control-passes.py 的
#     13 个长选项，全部带值，无 store_true）。
# PV_BATCH_STUB_MODE=ok|black|white|nocam；PV_BATCH_STUB_SLEEP=N 先睡 N 秒（锁/信号测试）；
# PV_BATCH_STUB_PIDFILE 追加写自身 pid（父进程被杀测试用）；PV_BATCH_STUB_LOG 追加写
# 'ARGV <json数组>'（--extra 空格保真断言用）与旧行为一行空格拼接。
# PV_BATCH_STUB_TOUCH=<绝对路径>：写一个契约完整的文件后立即对自身 SIGTERM（R2 必修1
#     「覆盖中断」负例：模拟渲染早期补齐某文件后进程被杀）。
# PV_BATCH_STUB_GRANDCHILD=1：额外起一个孙进程（同一进程组，60s 睡眠）并把 pid 追加进
#     pidfile（R2 可选：验证 SIGTERM 杀整个进程组连孙进程一起回收）。
import json
import os
import signal
import subprocess
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
if os.environ.get('PV_BATCH_STUB_GRANDCHILD'):
    g = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
    if pidfile:
        with open(pidfile, 'a', encoding='utf-8') as f:
            f.write('%d\\n' % g.pid)
sleep_s = float(os.environ.get('PV_BATCH_STUB_SLEEP', '0') or 0)
if sleep_s:
    time.sleep(sleep_s)

args = argv[argv.index('--') + 1:] if '--' in argv else []

# 与 render-control-passes.py argparse 一致的选项表（全部带值；--presets/--layout 有默认）
KNOWN_OPTS = ('--scene', '--cameras', '--out', '--layout', '--shots', '--beauty', '--preset',
              '--presets', '--beauty-samples', '--beauty-device', '--beauty-denoise',
              '--frames', '--passes')


def resolve_opt(tok):
    """argparse 缩写语义：完整名精确命中直过；否则唯一前缀展开；歧义/未知按 argparse 退出码 2 拒绝。"""
    if tok in KNOWN_OPTS:
        return tok
    hits = [k for k in KNOWN_OPTS if k.startswith(tok)]
    if len(hits) == 1:
        return hits[0]
    sys.stderr.write('stub: unrecognized%s argument: %s\\n'
                     % (' (ambiguous: %s)' % ' '.join(hits) if hits else '', tok))
    sys.exit(2)


vals = {}
_i = 0
while _i < len(args):
    _t = args[_i]
    if _t.startswith('--'):
        _name, _eq, _inline = _t.partition('=')
        _name = resolve_opt(_name)
        if _eq:
            vals[_name] = _inline
            _i += 1
        elif _i + 1 < len(args) and not args[_i + 1].startswith('--'):
            vals[_name] = args[_i + 1]
            _i += 2
        else:
            sys.stderr.write('stub: argument %s: expected one value\\n' % _name)
            sys.exit(2)
    elif _t.startswith('-'):
        sys.stderr.write('stub: unrecognized argument: %s\\n' % _t)
        sys.exit(2)
    else:
        _i += 1  # 渲染器段契约上没有裸位置参数；容错跳过（不出帧不受影响）

out = vals.get('--out', '')
want = vals.get('--shots', '')
frames = vals.get('--frames', '')
mode = os.environ.get('PV_BATCH_STUB_MODE', 'ok')
W, H = (int(x) for x in os.environ.get('PV_BATCH_FRAME_SIZE', '160x90').lower().split('x'))
pv = json.load(open(os.path.join(AREA, 'scripts', 'pv-shots.json'), encoding='utf-8'))
fps = pv.get('fps', 24)
by_id = {s['id']: s for s in pv['shots']}

from PIL import Image

I4 = [[1.0] * 4 for _ in range(4)]
K3 = [[800.0, 0, W / 2], [0, 800.0, H / 2], [0, 0, 1]]

touch = os.environ.get('PV_BATCH_STUB_TOUCH')
if touch:
    os.makedirs(os.path.dirname(touch), exist_ok=True)
    if touch.endswith('.json'):
        sid0 = [x for x in want.split(',') if x][0]
        with open(touch, 'w', encoding='utf-8') as f:
            json.dump({'shot': sid0, 'frame': 0, 'width': W, 'height': H,
                       'K': K3, 'worldToCameraOpenGL': I4, 'worldToCameraOpenCV': I4}, f)
    elif os.sep + 'depth' + os.sep in touch:
        Image.linear_gradient('L').resize((W, H)).convert('I').point(lambda v: v * 257).save(touch)
    else:
        g = Image.linear_gradient('L').resize((W, H))
        Image.merge('RGB', (g, g, g)).save(touch)
    print('stub touched %s then self-SIGTERM' % touch)
    sys.stdout.flush()
    os.kill(os.getpid(), signal.SIGTERM)
    time.sleep(5)  # SIGTERM 未立即生效时的兜底阻塞（保持进程存活到被杀）

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


def sched_cmd(out_root, group, more, sched=None):
    """R3 必修1：调度命令统一带合成输入注入（--scene/--cameras）；SYNTH 由 main() 先建。
    缺件/内容负例临时改 SYNTH 指向的路径即可，其余全部走同一份合成输入。
    sched（E1）=隔离软链工作区里的调度器路径（shadow 用例）：同一 argparse，注入照常生效。"""
    return ([sys.executable, '-X', 'utf8', sched or SCHEDULER, '--out-root', out_root, '--group', group]
            + ['--scene', SYNTH['scene'], '--cameras', SYNTH['cameras']] + list(more))


def run_sched(out_root, group, env=None, more=(), sched=None):
    return subprocess.run(sched_cmd(out_root, group, more, sched), capture_output=True, text=True, env=env, cwd=AREA)


def popen_sched(out_root, group, env, more=()):
    return subprocess.Popen(sched_cmd(out_root, group, more), env=env, cwd=AREA,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


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


def make_corrupt_pixel_png(path, w=160, h=90):
    """R2 可选：尺寸与编码都正确（160×90、8-bit RGB、块结构与 CRC 全对、IDAT 长度完整）、
    只有像素流（zlib 压缩数据中部一位翻转）损坏——verify() 过、load() 挂。
    与截断 IDAT 不同：删掉 load() 后尺寸/模式检查也拦不住它，独立证明完整解码机制在起作用。"""
    import struct
    import zlib
    raw = b''.join(b'\x00' + bytes(((k * 5 + x) % 256) for x in range(3 * w)) for k in range(h))
    good = zlib.compress(raw, 9)
    mid = len(good) // 2
    bad = good[:mid] + bytes([good[mid] ^ 0xFF]) + good[mid + 1:]

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', bad) + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    # 自证双保险：verify 通过、load 失败（否则本负例本身不成立）
    from PIL import Image
    with Image.open(path) as im:
        im.verify()
    try:
        with Image.open(path) as im:
            im.load()
        raise AssertionError('corrupt-pixel 负例构造失败：load() 未报错')
    except AssertionError:
        raise
    except Exception:
        pass


def make_minimal_glb(path):
    """R3 必修1：最小合法 GLB（glTF 2.0 空场景，12 字节头 + JSON chunk + 空 BIN chunk）——
    测试自带的合成 --scene 输入。调度器对场景输入做存在性与 sha 指纹（渲染由 stub 完成），
    最小件即可，不依赖 out-zone/scene-areas.glb 工作区产物。"""
    import struct
    js = json.dumps({'asset': {'version': '2.0'}, 'scenes': [{'nodes': []}], 'scene': 0},
                    separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)  # JSON chunk 4 字节对齐（空格是合法 JSON 尾随空白）
    body = struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', 0) + b'BIN\x00'
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 12 + len(body), 2) + body)


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

    # ---------------- R3 必修1：测试自带合成场景 GLB 与相机输入（不依赖 out-zone 工作区产物）----------------
    # 相机输入 width/height 与 PV_BATCH_FRAME_SIZE=160x90 同口径：齐全判定读这份输入与 stub 写帧一致。
    SYNTH['scene'] = os.path.join(tmp, 'scene-mini.glb')
    SYNTH['cameras'] = os.path.join(tmp, 'pv-cameras-mini.json')
    make_minimal_glb(SYNTH['scene'])
    with open(SYNTH['cameras'], 'w', encoding='utf-8') as f:
        json.dump({'width': 160, 'height': 90, 'fps': 24, 'shots': []}, f)

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
    check('R3必修1 dry-run exec-argv 注入合成 --scene/--cameras（19 条同源）',
          len(exec_lines) == 19 and all(SYNTH['scene'] in l and SYNTH['cameras'] in l for l in exec_lines),
          exec_lines[0][:200] if exec_lines else '<无>')
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
    need_fp = ('argv', 'rendererSha256', 'atmosphereMixSha256', 'presetsSha256', 'sceneSha256',
               'camerasSha256', 'layoutSha256', 'framesCount', 'mode')
    ok_fp = (d14 is not None and d14.get('guard') == 'pass' and all(k in fp14 for k in need_fp)
             and fp14.get('framesCount') == 120 and fp14.get('mode') == 'formal'
             and fp14.get('rendererSha256') == sha256_file(RENDERER)
             and fp14.get('atmosphereMixSha256') == sha256_file(ATMOS_MIX)
             and fp14.get('sceneSha256') == sha256_file(SYNTH['scene'])
             and fp14.get('camerasSha256') == sha256_file(SYNTH['cameras'])
             and fp14.get('presetsSha256') == sha256_file(os.path.join(AREA, 'lighting', 'presets.json'))
             and fp14.get('layoutSha256') == sha256_file(os.path.join(AREA, 'baseline', 'layout.json'))
             and isinstance(fp14.get('argv'), list) and '--shots' in fp14['argv']
             and fp14['argv'][fp14['argv'].index('--shots') + 1] == 'pv14-bazaar-dusk')
    check('必修1 pv14 .done.json 指纹字段齐且与实际文件 sha 一致', ok_fp, str(fp14)[:300])
    check('R3必修1 实际命令与指纹用同一份合成输入（argv 含注入路径）',
          ok_fp and SYNTH['scene'] in fp14['argv'] and SYNTH['cameras'] in fp14['argv']
          and 'out-zone/scene-areas.glb' not in fp14['argv'] and 'out-zone/pv-cameras.json' not in fp14['argv'],
          str(fp14.get('argv'))[:220] if fp14 else '<无>')

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
    ent14 = next((x for x in res2['shots'] if x['id'] == 'pv14-bazaar-dusk'), {}) if res2 else {}
    check('R2可选3 complete-preexisting 回填 guard=pass 并注明来源',
          ent14.get('guard') == 'pass' and ent14.get('note') and ('记录' in ent14['note'] or '.done' in ent14['note']),
          str(ent14)[:220])

    # ---------------- 必修1：指纹不一致默认报错停下（不渲任何帧、说明字段）----------------
    r = run_sched(out1, 'dusk', base_env(stub, inv1), more=('--extra', '--beauty-samples 999'))
    out_txt = r.stdout + r.stderr
    check('必修1 指纹不一致默认报错停下（退出码非 0）', r.returncode != 0, 'rc=%d' % r.returncode)
    check('必修1 报错说明是哪个字段（argv）且提到指纹', '指纹' in out_txt and 'argv' in out_txt, out_txt.strip()[-300:])
    check('必修1 报错时不渲染任何帧', len(invocations(inv1)) == 3, 'n=%d' % len(invocations(inv1)))
    prog = jload(os.path.join(out1, 'pv-batch-progress.json'))
    check('必修1 progress 记 blocked 状态', prog and all(p.get('status') == 'blocked-fingerprint' for p in prog['shots'].values()))
    # E1（pvbatch R2 可选1）：指纹拒绝的提前退出也写本次 RESULT.json（status=blocked + 原因），
    # 覆盖先前成功运行的 status=ok 收据——旧收据不再存活过拒绝点。
    res_b = jload(os.path.join(out1, 'RESULT.json'))
    check('E1 指纹拒绝写本次 blocked RESULT（覆盖旧 ok 收据）',
          res_b and res_b.get('status') == 'blocked' and '指纹' in (res_b.get('stoppedReason') or '')
          and res_b.get('totals', {}).get('blocked') == 2 and res_b.get('totals', {}).get('rendered') == 0,
          str((res_b or {}).get('status')) + ' ' + str((res_b or {}).get('stoppedReason'))[:160])
    check('E1 blocked RESULT 逐镜记 blocked-fingerprint 且带原因 note',
          res_b and all(x['status'] == 'blocked-fingerprint' and x.get('note') for x in res_b.get('shots', [])),
          str(res_b.get('shots'))[:200] if res_b else '<无>')

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

    # ---------------- R1必修2：atmosphere-mix.py 进指纹（改混雾脚本/旧记录缺字段 → 拒绝复用）----------------
    out_atm = os.path.join(tmp, 'run-atmfp')
    inv_atm = os.path.join(tmp, 'inv-atmfp.log')
    r = run_sched(out_atm, 'dusk', base_env(stub, inv_atm))
    check('R1必修2 基线跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    atm14 = os.path.join(out_atm, 'control-24fps-dusk', 'pv14-bazaar-dusk', '.done.json')
    d_atm = jload(atm14) or {}
    fp_atm = d_atm.get('fingerprint') or {}
    check('R1必修2 .done.json 指纹含 atmosphereMixSha256 且=当前混雾脚本 sha',
          fp_atm.get('atmosphereMixSha256') == sha256_file(ATMOS_MIX), str(fp_atm.get('atmosphereMixSha256'))[:80])
    n_atm = len(invocations(inv_atm))

    def _tamper_fp(mutate):
        d = jload(atm14) or {}
        mutate(d.setdefault('fingerprint', {}))
        json.dump(d, open(atm14, 'w', encoding='utf-8'))

    _tamper_fp(lambda fp: fp.__setitem__('atmosphereMixSha256', '0' * 64))
    r = run_sched(out_atm, 'dusk', base_env(stub, inv_atm))
    out_txt = r.stdout + r.stderr
    check('R1必修2 只改混合脚本 sha → 拒绝复用旧 done（退出码非 0）',
          r.returncode != 0 and 'atmosphereMixSha256' in out_txt, 'rc=%d %s' % (r.returncode, out_txt.strip()[-200:]))
    check('R1必修2 拒绝时不渲染任何帧', len(invocations(inv_atm)) == n_atm, 'n=%d vs %d' % (len(invocations(inv_atm)), n_atm))
    _tamper_fp(lambda fp: fp.pop('atmosphereMixSha256', None))
    r = run_sched(out_atm, 'dusk', base_env(stub, inv_atm))
    check('R1必修2 旧记录缺该字段 → 同样判不匹配（退出码非 0）',
          r.returncode != 0 and 'atmosphereMixSha256' in (r.stdout + r.stderr),
          'rc=%d %s' % (r.returncode, (r.stdout + r.stderr).strip()[-200:]))
    check('R1必修2 缺字段拒绝时也不渲染', len(invocations(inv_atm)) == n_atm, 'n=%d' % len(invocations(inv_atm)))
    # 还原指纹后同 argv 应放行（证明拒绝只来自该字段）
    _tamper_fp(lambda fp: fp.__setitem__('atmosphereMixSha256', sha256_file(ATMOS_MIX)))
    r = run_sched(out_atm, 'dusk', base_env(stub, inv_atm))
    check('R1必修2 还原该字段后指纹一致（两镜 complete-preexisting）',
          r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])

    # ---------------- R1可选1：seg 纯度接入 .done 守卫（LUT 存在即按完整帧号全查）----------------
    # stub 不写 segmentation-lut.json → 上面的所有用例自动跳过纯度检查；这里在新目录渲染前
    # 先放一份 LUT（合法色不含 stub 灰度渐变色）模拟正式链路：写成功 .done.json 前必须过纯度。
    out_pur = os.path.join(tmp, 'run-purity')
    pr_root = os.path.join(out_pur, 'control-24fps-dusk')
    os.makedirs(pr_root, exist_ok=True)
    lut_atm = os.path.join(pr_root, 'segmentation-lut.json')
    with open(lut_atm, 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'unassigned': [255, 0, 255], 'colorSpace': 'test',
                   'idToRgb': {'x': [10, 20, 30]}}, f)
    inv_pur = os.path.join(tmp, 'inv-purity.log')
    r = run_sched(out_pur, 'dusk', base_env(stub, inv_pur))
    out_txt = r.stdout + r.stderr
    check('R1可选1 非 LUT seg 帧（stub 灰度）→ 守卫失败停下（退出码非 0）',
          r.returncode != 0 and 'seg 纯度' in out_txt, 'rc=%d %s' % (r.returncode, out_txt.strip()[-240:]))
    check('R1可选1 纯度拒绝时只渲了 pv14（pv15 未开始）', len(invocations(inv_pur)) == 1
          and '--shots pv14-bazaar-dusk' in invocations(inv_pur)[0],
          'n=%d' % len(invocations(inv_pur)))
    res_p = jload(os.path.join(out_pur, 'RESULT.json'))
    st_p = {x['id']: x['status'] for x in (res_p or {}).get('shots', [])}
    check('R1可选1 RESULT：pv14 failed-guard（纯度）、pv15 pending',
          st_p.get('pv14-bazaar-dusk') == 'failed-guard' and st_p.get('pv15-huxin-dusk') == 'pending',
          str(st_p))
    d_p = jload(os.path.join(pr_root, 'pv14-bazaar-dusk', '.done.json')) or {}
    check('R1可选1 .done.json 记 guard=fail 且 detail 提纯度',
          d_p.get('guard') == 'fail' and '纯度' in str(d_p.get('guardDetail', '')),
          str(d_p.get('guard')) + ' ' + str(d_p.get('guardDetail'))[:160])
    os.remove(lut_atm)   # 测试自建文件，移除

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
    corrupt_then_rerun('像素流损坏 PNG（尺寸/编码正确仅像素流坏）',
                       lambda: make_corrupt_pixel_png(os.path.join(beauty14, 'frame-063.png')))

    def _depth_8bit():
        from PIL import Image
        Image.new('RGB', (160, 90), (5, 5, 5)).save(os.path.join(depth14, 'frame-062.png'))
    corrupt_then_rerun('depth 非 16-bit（RGB 8-bit）', _depth_8bit)

    def _k_nan():
        p = os.path.join(cam14, 'frame-013.json')
        d = jload(p) or {}
        d['K'][0][0] = float('nan')
        json.dump(d, open(p, 'w', encoding='utf-8'))
    corrupt_then_rerun('K 矩阵含 NaN', _k_nan)

    def _mat_bool():
        p = os.path.join(cam14, 'frame-014.json')
        d = jload(p) or {}
        d['worldToCameraOpenGL'][0][0] = True  # json 布尔；bool 是 int 子类，旧判据会放行
        json.dump(d, open(p, 'w', encoding='utf-8'))
    corrupt_then_rerun('worldToCamera 矩阵含布尔', _mat_bool)

    # ---------------- 必修6：--extra 自管参数拒绝（完整名/缩写/= 形式）----------------
    # E1（pvbatch R2 可选3）：每个用例独立目录——同坏目录复用时，被改坏的调度器若在第 1 例
    # 真渲染过，后续用例会被旧指纹拦住、以错误原因变红，无法独立证明各自的拒绝路径。
    for ci, (label, extra) in enumerate((('--sho 缩写覆盖镜头', '--sho pv15-huxin-dusk'),
                                         ('--frames=5 覆盖帧范围', '--frames=5'),
                                         ('--fra 缩写覆盖帧范围', '--fra 5'),
                                         ('--out= 形式覆盖输出', '--out=/tmp/evil'),
                                         ('--passes 破坏通道契约', '--passes beauty'),
                                         ('--sc 缩写覆盖场景', '--sc /tmp/x.glb'),
                                         ('裸 -- 终止渲染器选项解析', '--'))):
        r = run_sched(os.path.join(tmp, 'run-extra-reject-%d' % ci), 'dusk', base_env(stub, invlog),
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
    #    R2 可选：stub 再起一个孙进程（同进程组睡 60s）——杀组必须连孙进程一起回收
    pidf3 = os.path.join(tmp, 'stub-pids3.txt')
    slow3 = base_env(stub, os.path.join(tmp, 'inv-lock3.log'), sleep=8, pidfile=pidf3, gpu_lock=gpu_lock) \
        | {'PV_BATCH_STUB_GRANDCHILD': '1'}
    pa = popen_sched(os.path.join(tmp, 'lock-e'), 'dusk', slow3, more=('--shots', 'pv14'))
    pids = wait_pidfile(pidf3)
    ORPHANS.extend(pids)
    pa.send_signal(signal.SIGTERM)
    rc_sig = pa.wait(timeout=30)
    child = pids[0] if pids else 0
    grand = pids[1] if len(pids) > 1 else 0
    check('必修5 SIGTERM 退出码 143（128+15）', rc_sig == 143, 'rc=%s' % rc_sig)
    check('必修5 SIGTERM 后渲染子进程（进程组）已终止回收', not child or wait_gone(child), 'pid=%s' % child)
    check('R2可选 SIGTERM 连孙进程一并回收（杀的是整个进程组）', not grand or wait_gone(grand), 'pid=%s' % grand)
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

    # f) R2 可选：GPU 锁空闲时单独验证 out-root 锁（此前同目录竞争用例先被 GPU 锁挡住）
    out_lr = os.path.join(tmp, 'r2-lockroot')
    os.makedirs(out_lr, exist_ok=True)
    lr_lock = os.path.join(out_lr, '.pv-batch.lock')
    lr_fd = os.open(lr_lock, os.O_CREAT | os.O_RDWR, 0o666)
    fcntl.flock(lr_fd, fcntl.LOCK_EX)
    r = run_sched(out_lr, 'dusk', base_env(stub, os.path.join(tmp, 'inv-lr.log'),
                                           gpu_lock=os.path.join(tmp, 'gpu-free.lock')), more=('--shots', 'pv14'))
    check('R2可选 out-root 锁单独互斥（GPU 锁空闲仍拒绝）',
          r.returncode != 0 and 'out-root' in (r.stdout + r.stderr),
          'rc=%d %s' % (r.returncode, (r.stdout + r.stderr).strip()[-200:]))
    fcntl.flock(lr_fd, fcntl.LOCK_UN)
    os.close(lr_fd)

    # ---------------- R2 必修1：重渲前作废旧完成标记 ----------------
    # a) 「缺一个 camera + 换配置」必须报错不渲染（指纹检查先于完整性分支；
    #    只选 pv14 隔离该镜——否则旧树上 pv15 的指纹报错会掩盖 pv14 这条路径）
    out_m1 = os.path.join(tmp, 'r2m1')
    inv_m1 = os.path.join(tmp, 'inv-r2m1.log')
    r = run_sched(out_m1, 'dusk', base_env(stub, inv_m1))
    check('R2必修1 基线跑 dusk 退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    n_m1 = len(invocations(inv_m1))
    os.remove(os.path.join(out_m1, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'cameras', 'frame-005.json'))
    r = run_sched(out_m1, 'dusk', base_env(stub, inv_m1), more=('--shots', 'pv14', '--extra', '--beauty-samples 999'))
    out_txt = r.stdout + r.stderr
    check('R2必修1 缺文件+换配置：默认报错不渲染（指纹先于完整性）',
          r.returncode != 0 and '指纹' in out_txt and '不一致' in out_txt,
          'rc=%d %s' % (r.returncode, out_txt.strip()[-260:]))
    check('R2必修1 缺文件+换配置：零渲染调用', len(invocations(inv_m1)) == n_m1,
          'n=%d（期望 %d）' % (len(invocations(inv_m1)), n_m1))
    res_m1a = jload(os.path.join(out_m1, 'RESULT.json'))
    check('E1 单镜指纹拒绝也写本次 blocked RESULT（覆盖基线 ok）',
          res_m1a and res_m1a.get('status') == 'blocked' and res_m1a.get('totals', {}).get('blocked') == 1
          and '指纹' in (res_m1a.get('stoppedReason') or ''),
          str((res_m1a or {}).get('stoppedReason'))[:160])

    # b) 帧不齐但配置一致 → 旧镜头目录（含旧 .done.json）整镜移 _discard 后干净目录重渲
    out_m1b = os.path.join(tmp, 'r2m1b')
    inv_m1b = os.path.join(tmp, 'inv-r2m1b.log')
    r = run_sched(out_m1b, 'dusk', base_env(stub, inv_m1b))
    check('R2必修1(b) 基线跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    os.remove(os.path.join(out_m1b, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'beauty', 'frame-010.png'))
    r = run_sched(out_m1b, 'dusk', base_env(stub, inv_m1b))
    check('R2必修1 帧不齐(配置一致)：移走重渲退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    disc_m1b = os.path.join(out_m1b, '_discard')
    ddirs_m1b = os.listdir(disc_m1b) if os.path.isdir(disc_m1b) else []
    moved = [d for d in ddirs_m1b if d.startswith('pv14-bazaar-dusk')]
    check('R2必修1 旧 pv14 目录已移入 _discard（含旧 .done.json 与 119 帧 beauty）',
          len(moved) == 1 and os.path.isfile(os.path.join(disc_m1b, moved[0], '.done.json'))
          and len(os.listdir(os.path.join(disc_m1b, moved[0], 'beauty'))) == 119, str(ddirs_m1b))
    check('R2必修1 完成后 _discard 无 pv15（完整镜不受影响）',
          not any(d.startswith('pv15') for d in ddirs_m1b), str(ddirs_m1b))
    check('R2必修1 重渲后 pv14 帧全齐（beauty 120）',
          len(os.listdir(os.path.join(out_m1b, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'beauty'))) == 120)
    res_m1b = jload(os.path.join(out_m1b, 'RESULT.json'))
    st_m1b = {x['id']: x['status'] for x in res_m1b['shots']} if res_m1b else {}
    check('R2必修1 RESULT：pv14 rendered-shot、pv15 complete-preexisting、discarded 带 reason',
          st_m1b.get('pv14-bazaar-dusk') == 'rendered-shot' and st_m1b.get('pv15-huxin-dusk') == 'complete-preexisting'
          and len(res_m1b.get('discarded', [])) == 1 and res_m1b['discarded'][0].get('reason'),
          str(st_m1b) + ' ' + str(res_m1b.get('discarded'))[:200])

    # c) 覆盖中断（stub 写一帧后被 SIGTERM）+ 用原配置再次续跑 → 不得被判为完成
    out_m1c = os.path.join(tmp, 'r2m1c')
    inv_m1c = os.path.join(tmp, 'inv-r2m1c.log')
    r = run_sched(out_m1c, 'dusk', base_env(stub, inv_m1c))
    check('R2必修1(c) 基线跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    os.remove(os.path.join(out_m1c, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'beauty', 'frame-010.png'))
    touch_png = os.path.join(out_m1c, 'control-24fps-dusk', 'pv14-bazaar-dusk', 'beauty', 'frame-010.png')
    env_touch = base_env(stub, inv_m1c) | {'PV_BATCH_STUB_TOUCH': touch_png}
    r = run_sched(out_m1c, 'dusk', env_touch)
    check('R2必修1 覆盖中断：调度器非 0 退出（渲染器被杀）', r.returncode != 0, 'rc=%d' % r.returncode)
    disc_m1c = os.path.join(out_m1c, '_discard')
    ddirs_m1c = os.listdir(disc_m1c) if os.path.isdir(disc_m1c) else []
    check('R2必修1 覆盖开始前旧 .done.json 已随旧目录移走（新目录无成功标记）',
          not os.path.exists(os.path.join(out_m1c, 'control-24fps-dusk', 'pv14-bazaar-dusk', '.done.json'))
          and any(d.startswith('pv14-bazaar-dusk') and os.path.isfile(os.path.join(disc_m1c, d, '.done.json'))
                  for d in ddirs_m1c), str(ddirs_m1c))
    r = run_sched(out_m1c, 'dusk', base_env(stub, inv_m1c))
    res_m1c = jload(os.path.join(out_m1c, 'RESULT.json'))
    st_m1c = {x['id']: x['status'] for x in res_m1c['shots']} if res_m1c else {}
    check('R2必修1 覆盖中断后原配置续跑：pv14 重新渲染而非判完成',
          r.returncode == 0 and st_m1c.get('pv14-bazaar-dusk') == 'rendered-shot'
          and st_m1c.get('pv15-huxin-dusk') == 'complete-preexisting', str(st_m1c))
    disc_m1c_all = os.listdir(disc_m1c) if os.path.isdir(disc_m1c) else []
    check('R2必修1 中断的半成品目录再移 _discard（两代旧目录都在，不删文件）',
          len([d for d in disc_m1c_all if d.startswith('pv14-bazaar-dusk')]) == 2, str(disc_m1c_all))

    # ---------------- R2 必修2：同值自管选项出现即拒绝 ----------------
    inv_m2 = os.path.join(tmp, 'inv-r2m2.log')
    for mi, (label, extra) in enumerate((('--preset=day（与首镜同值）', '--preset=day'),
                                         ('--sho 缩写（值=首镜 id）', '--sho pv01-aerial-reveal'))):
        # E1（R2 可选3）：独立目录——红检时缩写用例不得复用前一用例目录被旧指纹拦住
        r = run_sched(os.path.join(tmp, 'r2m2-%d' % mi), 'day', base_env(stub, inv_m2),
                      more=('--shots', 'pv01', '--extra=' + extra))
        out_txt = r.stdout + r.stderr
        check('R2必修2 拒绝同值自管选项 %s' % label,
              r.returncode != 0 and '自管' in out_txt and ('出现' in out_txt or '无关' in out_txt),
              'rc=%d %s' % (r.returncode, out_txt.strip()[-220:]))
    check('R2必修2 拒绝时未起任何渲染', len(invocations(inv_m2)) == 0, 'n=%d' % len(invocations(inv_m2)))

    # stub 采用真实 argparse「后值覆盖」语义（同名选项取最后一次出现）
    stub_out = os.path.join(tmp, 'stub-lastwins')
    r = subprocess.run([sys.executable, stub, '-b', '--', '--out', stub_out, '--shots', 'pv14-bazaar-dusk',
                        '--frames', '0', '--frames', '1'], capture_output=True, text=True, cwd=AREA)
    got_frames = sorted(os.listdir(os.path.join(stub_out, 'pv14-bazaar-dusk', 'beauty'))) \
        if os.path.isdir(os.path.join(stub_out, 'pv14-bazaar-dusk', 'beauty')) else []
    check('R2必修2 stub 后值覆盖语义（--frames 0 --frames 1 → 只渲 1）',
          r.returncode == 0 and got_frames == ['frame-001.png'], 'frames=%s rc=%d' % (got_frames, r.returncode))

    # E1（pvbatch R2 可选3）：stub 自身 argparse 语义——缩写唯一前缀展开、歧义/未知拒绝。
    # 旧 stub 只认完整名：--sho 会被静默忽略（want='' 不出帧），未知参数也被放过——红检时
    # 无法独立证明「缩写后的渲染行为」。此处直测 stub，期望值按 argparse 规则独立取得。
    stub_out_ab = os.path.join(tmp, 'stub-abbrev')
    r = subprocess.run([sys.executable, stub, '-b', '--', '--out', stub_out_ab, '--sho', 'pv14-bazaar-dusk',
                        '--fra', '0'], capture_output=True, text=True, cwd=AREA)
    ab_frames = sorted(os.listdir(os.path.join(stub_out_ab, 'pv14-bazaar-dusk', 'beauty'))) \
        if os.path.isdir(os.path.join(stub_out_ab, 'pv14-bazaar-dusk', 'beauty')) else []
    check('E1 stub 缩写展开（--sho→--shots、--fra→--frames）按真实语义出帧',
          r.returncode == 0 and ab_frames == ['frame-000.png'], 'rc=%d frames=%s' % (r.returncode, ab_frames))
    r = subprocess.run([sys.executable, stub, '-b', '--', '--out', os.path.join(tmp, 'stub-unknown'),
                        '--shots', 'pv14-bazaar-dusk', '--no-such-opt', '3'], capture_output=True, text=True, cwd=AREA)
    check('E1 stub 拒绝未知参数（argparse 退出码 2 + stderr 点名）',
          r.returncode == 2 and 'no-such-opt' in r.stderr, 'rc=%d err=%s' % (r.returncode, r.stderr.strip()[:140]))
    r = subprocess.run([sys.executable, stub, '-b', '--', '--out', os.path.join(tmp, 'stub-ambig'),
                        '--shots', 'pv14-bazaar-dusk', '--beauty-d'], capture_output=True, text=True, cwd=AREA)
    check('E1 stub 拒绝歧义缩写（--beauty-d 同时命中 beauty-device/denoise）',
          r.returncode == 2 and 'ambiguous' in r.stderr and 'beauty-device' in r.stderr and 'beauty-denoise' in r.stderr,
          'rc=%d err=%s' % (r.returncode, r.stderr.strip()[:160]))

    # ---------------- R2 必修3：layout 内容 sha 纳入指纹（真实 namespace 指向同一路径）----------------
    # E1（pvbatch R2 可选2）：旧负例用 PV_BATCH_LAYOUT_OVERRIDE 在 lay_a/lay_b 两个路径间切
    # 哈希对象，渲染器从未读过它们；现在搭隔离软链工作区——镜像 area 根（scripts/lighting/
    # out-zone 软链回真身），仅 baseline/layout.json 是可改副本。调度器与渲染器模块都从隔离区
    # 路径加载（软链不展开），渲染器自己的 argparse 默认 --layout = <隔离区 ROOT>/baseline/
    # layout.json，指纹哈希的就是渲染输入契约里那条路径的文件；同一路径上改内容即阻止复用。
    shadow = os.path.join(tmp, 'shadow-area')
    os.makedirs(os.path.join(shadow, 'baseline'))
    for d in ('scripts', 'lighting', 'out-zone'):
        os.symlink(os.path.join(AREA, d), os.path.join(shadow, d))
    lay_same = os.path.join(shadow, 'baseline', 'layout.json')
    shutil.copyfile(os.path.join(AREA, 'baseline', 'layout.json'), lay_same)
    sched_shadow = os.path.join(shadow, 'scripts', 'render-pv-batch.py')
    out_m3 = os.path.join(tmp, 'r2m3')
    inv_m3 = os.path.join(tmp, 'inv-r2m3.log')
    r = run_sched(out_m3, 'dusk', base_env(stub, inv_m3), more=('--shots', 'pv14'), sched=sched_shadow)
    check('R2必修3 layout 内容入指纹（隔离区基线跑退出码 0）', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    d_m3 = jload(os.path.join(out_m3, 'control-24fps-dusk', 'pv14-bazaar-dusk', '.done.json'))
    check('R2必修3 .done.json 指纹 layoutSha256 = 同一路径文件实际 sha（真实 namespace 取路径）',
          d_m3 and d_m3.get('fingerprint', {}).get('layoutSha256') == sha256_file(lay_same),
          str((d_m3 or {}).get('fingerprint', {}))[:200])
    with open(lay_same, 'a', encoding='utf-8') as f:  # 同一路径改内容：sha 变、JSON 仍合法
        f.write(' \n')
    r = run_sched(out_m3, 'dusk', base_env(stub, inv_m3), more=('--shots', 'pv14'), sched=sched_shadow)
    out_txt = r.stdout + r.stderr
    check('R2必修3 同路径 layout 内容变化阻止复用（按指纹报错）',
          r.returncode != 0 and '指纹' in out_txt and 'layoutSha256' in out_txt,
          'rc=%d %s' % (r.returncode, out_txt.strip()[-260:]))
    check('R2必修3 指纹报错时零渲染', len(invocations(inv_m3)) == 1, 'n=%d' % len(invocations(inv_m3)))
    res_m3 = jload(os.path.join(out_m3, 'RESULT.json'))
    check('E1 layout 拒绝同样写本次 blocked RESULT（覆盖基线 ok 收据）',
          res_m3 and res_m3.get('status') == 'blocked' and 'layoutSha256' in (res_m3.get('stoppedReason') or '')
          and res_m3.get('totals', {}).get('blocked') == 1,
          str((res_m3 or {}).get('stoppedReason'))[:200])
    r = run_sched(out_m3, 'dusk', base_env(stub, inv_m3), more=('--shots', 'pv14', '--extra=--layout ' + lay_same),
                  sched=sched_shadow)
    check('R2必修2/3 --layout 列为自管选项（--extra 出现即拒绝）',
          r.returncode != 0 and '自管' in (r.stdout + r.stderr) and 'layout' in (r.stdout + r.stderr),
          'rc=%d' % r.returncode)

    # ---------------- R2 必修4：启动前全量解析（未知参数/缺值在启动 Blender 前拒绝）----------------
    inv_m4 = os.path.join(tmp, 'inv-r2m4.log')
    r = run_sched(os.path.join(tmp, 'r2m4'), 'dusk', base_env(stub, inv_m4),
                  more=('--shots', 'pv14', '--extra=--beauty-denoise'))
    out_txt = r.stdout + r.stderr
    check('R2必修4 裸 --beauty-denoise（缺值）启动前被拒并提示正确写法',
          r.returncode != 0 and ('on' in out_txt and '渲染器' in out_txt) and '未启动 Blender' in out_txt,
          'rc=%d %s' % (r.returncode, out_txt.strip()[-260:]))
    r = run_sched(os.path.join(tmp, 'r2m4b'), 'dusk', base_env(stub, inv_m4),
                  more=('--shots', 'pv14', '--extra=--no-such-future-param 3'))
    out_txt = r.stdout + r.stderr
    check('R2必修4 未知参数启动前被拒（提示与渲染器 argparse 匹配）',
          r.returncode != 0 and 'no-such-future-param' in out_txt and '未启动 Blender' in out_txt,
          'rc=%d %s' % (r.returncode, out_txt.strip()[-260:]))
    check('R2必修4 两种拒绝都零渲染调用', len(invocations(inv_m4)) == 0, 'n=%d' % len(invocations(inv_m4)))

    # ---------------- R3 必修1：缺件负例 + 注入输入的真实 SHA 校验 ----------------
    # a) 注入的相机输入文件不存在 → 「指纹输入缺失」报错停下、零渲染（不跳过指纹门禁）
    inv_r3 = os.path.join(tmp, 'inv-r3.log')
    saved_cam, SYNTH['cameras'] = SYNTH['cameras'], os.path.join(tmp, 'no-such-pv-cameras.json')
    r = run_sched(os.path.join(tmp, 'r3-missing'), 'dusk', base_env(stub, inv_r3), more=('--shots', 'pv14'))
    out_txt = r.stdout + r.stderr
    check('R3必修1 缺件负例：注入的相机输入缺失 → 指纹门禁报错停下（零渲染）',
          r.returncode != 0 and '指纹输入缺失' in out_txt and 'camerasSha256' in out_txt
          and len(invocations(inv_r3)) == 0, 'rc=%d %s' % (r.returncode, out_txt.strip()[-220:]))
    SYNTH['cameras'] = saved_cam

    # b) 注入的相机输入内容变化（sha 变、仍是合法 JSON）→ camerasSha256 指纹不一致阻止复用
    out_r3b = os.path.join(tmp, 'r3-camsha')
    inv_r3b = os.path.join(tmp, 'inv-r3-camsha.log')
    r = run_sched(out_r3b, 'dusk', base_env(stub, inv_r3b), more=('--shots', 'pv14'))
    check('R3必修1 相机内容指纹基线跑退出码 0', r.returncode == 0, (r.stdout + r.stderr).strip()[-300:])
    n_r3b = len(invocations(inv_r3b))
    with open(SYNTH['cameras'], 'a', encoding='utf-8') as f:
        f.write(' \n')  # 尾随空白：json.load 不受影响（仍是合法输入），sha256 变化
    r = run_sched(out_r3b, 'dusk', base_env(stub, inv_r3b), more=('--shots', 'pv14'))
    out_txt = r.stdout + r.stderr
    check('R3必修1 注入相机输入内容变化：camerasSha256 阻止复用（按指纹报错、零渲染）',
          r.returncode != 0 and '指纹' in out_txt and 'camerasSha256' in out_txt
          and len(invocations(inv_r3b)) == n_r3b, 'rc=%d %s' % (r.returncode, out_txt.strip()[-240:]))

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
