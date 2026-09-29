#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-pvbatch P1 / R1+R2 返修 / R3 输入注入：PV 正式帧批量渲染调度器（纯 python3，不依赖 bpy）。

按 wave11-pvboard 交接的 3 条分组命令 + 16 条逐镜命令调度 scripts/render-control-passes.py
批量出 PV 四通道控制层 + Cycles beauty 参考帧。命令构造直接 import scripts/pv-docs.py 的
export_command / light_groups（同一套规则，不复制拼命令逻辑）；本单不改渲染器本身，
机主拍板的采样类参数经 --extra 原样透传（如 --beauty-samples 128 --beauty-denoise on——
降噪参数带值 on|off，与渲染器参数契约一致）。

R3 返修要点（REVIEW-astra-R2 必修1，测试可复现性）：
  --scene/--cameras 输入路径注入：测试可用合成场景 GLB 与相机 json 替换 pv-docs 规范命令里
  的 out-zone 输入（新环境无 out-zone/pv-cameras.json 时调度测试不再依赖工作区产物）。注入
  同步作用于实际执行 argv、调度器期望 token（自管字段断言不产生伪差异）、指纹输入 sha 与
  齐全判定期望尺寸——四处用同一份输入；输入文件缺失仍走「指纹输入缺失」报错，不跳过任何
  指纹门禁。不设时行为与此前逐字节一致（生产路径不变）。

R2 返修要点（REVIEW-astra-R1 必修 1-4 + 可选；R1 修复全部保留不回退）：
  1. 重渲前作废旧完成标记：指纹检查先于完整性分支（文件不齐不能掩盖配置不一致）；
     任何对已有镜头目录的覆盖开始前，先把整个旧镜头目录（含 .done.json）原子移入
     <out-root>/_discard/<id>-<时间戳>/，在干净目录整镜重渲；只有本次全部完成且守卫
     通过才写新的成功记录。配置不一致仍默认报错（--rerender-mismatch 才移走重渲）；
     文件不齐但配置一致时同样先移走再整镜重渲——旧成功标记在任何覆盖路径上都不存活。
  2. --extra 拒绝自管选项的**出现**（与值是否等于首镜无关）：用渲染器自己的 parser 逐
     token 识别完整名、缩写、= 形式，出现即拒绝。启动每条 Blender 命令前再用渲染器
     parser 完整解析实际执行的 argv，断言自管字段等于调度器期望（由规范命令独立重建）；
     --fast-group 组命令另须与逐镜命令在除 --shots 外的自管字段上逐镜等价，等价才把
     组渲出的镜头按逐镜规范 argv 记指纹。
  3. layout 纳入指纹：从真实 parser 最终 namespace 取 --layout 路径（默认
     baseline/layout.json），把内容 sha256（或缺失状态）写进指纹；--layout 列为自管
     选项，同路径 layout 内容变化即阻止复用。
  4. 启动前全量解析：正式与冒烟运行都要求整条 argv 被当前渲染器 parser 成功解析才
     启动 Blender——未知参数、缺值（如降噪开关漏写 on|off 值）都在启动前拒绝并提示
     正确写法（启动前一次性预检 + 每条命令执行前再校验）。
  可选：像素流损坏 PNG 负例（尺寸/编码正确仅像素流坏，独立证明 load()）；out-root 锁
     单独验证与 SIGTERM 孙进程回收；可信续跑分支 RESULT 回填守卫状态并注明来源；
     camera 矩阵拒绝 NaN/Infinity/布尔值。

wave13-debt2 E1（pvbatch R2 可选 1-3 收口）：
  1. 指纹拒绝的提前退出也写本次 RESULT.json（status=blocked + 原因，build_result 唯一出口）——
     旧成功收据不再存活过拒绝点。
  2. layout 指纹无环境变量旁路：始终哈希渲染器 parser namespace 的路径
     （<渲染器 ROOT>/baseline/layout.json）；PV_BATCH_LAYOUT_OVERRIDE 撤销。
  3.（测试侧）stub 按 argparse 语义展开缩写、拒绝未知参数；--sho 红检用例改独立目录。

R1 返修要点（REVIEW-astra 必修 1-8；设计原则：宁可慢、宁可停，也不把不可信的帧当完成）：
  1. 配置指纹：每镜守卫后原子写 <out-root>/control-24fps-<light>/<id>/.done.json，内容 =
     实际 argv 数组（逐镜规范形式；组渲出的镜头也记其逐镜等价 argv，避免组/单镜差异误报。
     nice 不入指纹：不影响输出）、渲染脚本 sha256、presets.json sha256、场景 GLB sha256、
     相机输入 sha256、layout sha256、帧数、mode、守卫结果。续跑只有「帧齐全 + 记录存在 +
     指纹完全一致 + guard=pass」才跳过；无记录 / 不一致（含正式模式读到 smoke 记录）默认
     报错停下并说明是哪个字段不同；加 --rerender-mismatch 才把整镜移到
     <out-root>/_discard/<id>-<时间戳>/ 后重渲（不删文件）。守卫失败的镜头同样写记录
     （guard=fail）：续跑时重新守卫，仍失败就仍停——完整文件没有可信记录不算完成（必修 3）。
  2. 齐全判定：PNG verify() 后重新打开 load() 完整解码，校验尺寸（相机输入 json 的
     width/height；PV_BATCH_FRAME_SIZE=WxH 可覆盖，测试 stub 用）与通道编码（depth 须
     16-bit I 系；beauty/normal/segmentation 须 RGB）；cameras JSON 逐帧解析并校验
     shot / frame / width / height / K(3x3) / worldToCameraOpenGL/OpenCV(4x4)。
  3. 守卫时机：默认逐镜调用渲染器（每镜渲完立即守卫，失败即停，不开始下一镜）；
     组命令整组渲仅在 --fast-group 显式开启，RESULT 标注 fastGroup 与「守卫滞后」。
  4. 锁：<out-root>/.pv-batch.lock 与全机 GPU 锁（默认 /tmp/pawborough-gpu.lock，
     PV_BATCH_GPU_LOCK 可覆盖）都用 fcntl.flock 内核互斥——不做「检查 PID 后覆盖」的接管，
     进程退出自动释放。渲染器独立进程组启动（start_new_session）；调度器收到 SIGINT/SIGTERM
     时终止整个进程组并 wait 回收。锁 fd 经 pass_fds 传给渲染子进程：父进程被杀时锁仍由
     存活的渲染进程持有，GPU 不会被误判空闲。
  5. --extra：只 shlex.split 一次、从构造到执行一律参数数组；安检用渲染器自己的 argparse
     （参考 tests/pv-export-args-test.py 的加载方式，不重写解析规则）行为级判定：自管选项
     （--out/--shots/--scene/--cameras/--preset/--frames/--passes/--layout，含缩写与 = 形式）
     **出现即拒绝**，与值是否等于首镜无关（R2 必修2：同值自管参数可能改写后续镜头）；
     非自管参数须能被当前渲染器 parser 成功解析，未知参数 / 缺值在启动 Blender 前拒绝并
     提示正确写法。--out-root 路径不能含空格（pv-docs 规范命令按空格拼接、无引号）。
  6. 冒烟隔离：--frames N 强制输出到 <out-root>/_smoke/ 子目录（.done.json 标 mode=smoke，
     RESULT/进度/日志/联系表同在 _smoke 下）；正式模式拒绝把 smoke 记录当完成，也不在
     正式目录写冒烟产物。

断点续跑（镜粒度）：帧齐全且指纹一致的镜头跳过；指纹检查先于完整性判定——配置不一致的镜
（无论帧全不全）默认报错停下，--rerender-mismatch 才整镜重渲；帧不齐的镜先把整个旧镜头目录
（含旧 .done.json）原子移入 _discard/ 再在干净目录整镜重渲（逐帧确定性输出，不做帧级增量），
旧成功标记在任何覆盖路径上都不存活。

质量守卫：每镜完成后抽 beauty 首/中/末帧，按 COMMON 空白判据（灰度 std < 2/255 或主灰阶
> 95% 像素，与 check-pv-frames.py BLANK 同口径，直方图实现免 numpy）判空白；全黑/全白即
标记该镜失败并停止整批。

用法（在 scene-authoring/yuyuan-area 下）：
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --group all                        # 全量 16 镜（默认逐镜，每镜即守卫）
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --group all --fast-group           # 组渲模式（守卫滞后到组命令结束）
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --group day --dry-run              # 只打印命令 + 实际执行 argv
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --group day --shots pv01 --frames 2 # 冒烟：只渲前 2 帧，产物在 <out-root>/_smoke/
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --extra "--beauty-samples 128 --beauty-denoise on"
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --extra "--beauty-samples 256" --rerender-mismatch
      # 换配置续跑：指纹不一致的镜整镜移 _discard/ 后重渲（不删文件）

环境变量：
  PV_BATCH_BLENDER      渲染可执行文件（默认 ~/.local/bin/blender）。测试指向写占位 PNG 的 stub。
  PV_BATCH_GPU_LOCK     全机 GPU 锁路径（默认 /tmp/pawborough-gpu.lock；测试隔离用）。
  PV_BATCH_FRAME_SIZE   齐全性判定期望尺寸 WxH（默认取相机输入 json 的 width/height；测试 stub 用）。
"""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import importlib.util
import io
import json
import math
import os
import shlex
import signal
import subprocess
import sys
import time
import types

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PV_SHOTS = os.path.join(AREA, 'scripts', 'pv-shots.json')
PV_DOCS = os.path.join(AREA, 'scripts', 'pv-docs.py')
RENDERER = os.path.join(AREA, 'scripts', 'render-control-passes.py')
ATMOS_MIX = os.path.join(AREA, 'scripts', 'atmosphere-mix.py')   # R1必修2：渲染器子进程调用的混雾脚本，进指纹
CANON_BLENDER = '~/.local/bin/blender'  # pv-docs 命令的规范前缀；执行时可被 PV_BATCH_BLENDER 替换
GPU_LOCK_DEFAULT = '/tmp/pawborough-gpu.lock'
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')
# COMMON 空白帧判据（与 scripts/check-pv-frames.py 的 BLANK 同口径：灰度 std<2 灰阶、主灰阶>95% 像素）
BLANK_STD_MAX = 2.0
BLANK_DOMINANT_MAX = 0.95
# 必修6/R2必修2：调度器自管的渲染器选项（出现即拒绝；缩写与 = 形式同样拒绝——用渲染器自己的 parser 判定）
SELF_MANAGED = ('out', 'shots', 'scene', 'cameras', 'preset', 'frames', 'passes', 'layout')
# .done.json 指纹参与逐字段比较的字段（mode 并入：正式/冒烟记录不互通；R2 必修3 并入 layoutSha256；
# R1必修2 并入 atmosphereMixSha256——渲染器以子进程调 atmosphere-mix.py 混雾，改混合脚本必须拒绝
# 复用旧 done；旧记录缺该字段时 old_fp.get(k)=None ≠ 新 sha，天然判不匹配）
FP_FIELDS = ('argv', 'rendererSha256', 'atmosphereMixSha256', 'presetsSha256', 'sceneSha256',
             'camerasSha256', 'layoutSha256', 'framesCount', 'mode')
INPUT_SHA_KEYS = (('--scene', 'sceneSha256'), ('--cameras', 'camerasSha256'), ('--presets', 'presetsSha256'))
DEPTH_MODES = ('I', 'I;16', 'I;16L', 'I;16B')  # 16-bit 深度 PNG 的 PIL 模式


class SignalStop(Exception):
    """SIGINT/SIGTERM 到达：终止渲染进程组并回收后向上抛，统一收尾写 RESULT。"""

    def __init__(self, signum):
        Exception.__init__(self, 'signal %d' % signum)
        self.signum = signum


CURRENT_CHILD = {'p': None}


def install_signal_handlers():
    def _h(signum, frame):
        raise SignalStop(signum)

    signal.signal(signal.SIGINT, _h)
    signal.signal(signal.SIGTERM, _h)


def kill_child_group(log=None):
    """终止当前渲染子进程的整个进程组（start_new_session → pgid == 子 pid）并回收。"""
    p = CURRENT_CHILD['p']
    if p is None:
        return
    try:
        os.killpg(p.pid, signal.SIGTERM)
        if log:
            log('信号：已向渲染进程组 pid %d 发 SIGTERM，等待回收' % p.pid)
        try:
            p.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait()
    except ProcessLookupError:
        pass
    finally:
        CURRENT_CHILD['p'] = None


def load_pv_docs():
    """加载 pv-docs.py 复用其命令构造（文件名带连字符，不能直接 import）。"""
    spec = importlib.util.spec_from_file_location('pv_docs_for_batch', PV_DOCS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_renderer_module():
    """只读加载渲染器模块以复用其 argparse（参考 tests/pv-export-args-test.py；不重写解析规则）。"""
    src = open(RENDERER, encoding='utf-8').read().rstrip()
    if not src.endswith('\nmain()'):
        raise SystemExit('E: %s 末尾不是裸 main()，加载护栏失效（同 pv-export-args-test 口径，拒绝继续）' % RENDERER)
    body = src[:src.rindex('\nmain()')]
    sys.modules.setdefault('bpy', types.ModuleType('bpy'))
    mod = types.ModuleType('render_control_passes_for_extra_check')
    mod.__file__ = RENDERER
    exec(compile(body, RENDERER, 'exec'), mod.__dict__)
    return mod


def parse_renderer_argv(rcp, renderer_tokens):
    """按 Blender 规则（第一个 -- 之后交给脚本）用渲染器自己的 parse_args() 解析一条参数。

    返回 (namespace, None) 或 (None, 错误末行)。"""
    old_argv = sys.argv
    sys.argv = ['render-control-passes.py', '--'] + list(renderer_tokens)
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            ns = rcp.parse_args()
        return ns, None
    except SystemExit as e:
        lines = err.getvalue().strip().splitlines()
        return None, (lines[-1] if lines else 'argparse 退出码 %s' % e.code)
    finally:
        sys.argv = old_argv


def check_extra_tokens(extra_tokens, base_render_tokens, rcp):
    """--extra 安检（必修6 + R2 必修2）：自管选项**出现即拒绝**，与值是否等于首镜无关。

    逐 token 探针：把候选 token 的选项名 + 探针值追加到基础命令后用渲染器自己的 parse_args()
    解析（argparse 后值覆盖语义）——token 能把某自管字段吃成探针值，说明它就是（或缩写是）
    自管选项，拒绝。覆盖完整名（--preset）、缩写（--pre/--sho）、= 形式（--preset=day）与
    尾部缺值（--preset）等一切形态；同值绕过（--preset=day 且首镜也是 day）同样命中。
    非自管 token 不在此拒——能否被当前渲染器解析由启动前全量解析（R2 必修4）裁决。"""
    if not extra_tokens:
        return
    if '--' in extra_tokens:
        raise SystemExit('E: --extra 不许包含裸 --（会终止渲染器选项解析、破坏自管参数契约）：%r' % (extra_tokens,))
    names = ', '.join('--' + k for k in SELF_MANAGED)
    probe = '__PV_BATCH_EXTRA_PROBE__'
    for t in extra_tokens:
        if not t.startswith('-'):
            continue
        nsp, _ = parse_renderer_argv(rcp, base_render_tokens + [t.split('=', 1)[0], probe])
        if nsp is None:
            continue
        hit = ['--' + k for k in SELF_MANAGED if getattr(nsp, k, None) == probe]
        if hit:
            raise SystemExit('E: --extra 含调度器自管选项 %r（命中 %s）——出现即拒绝，与值是否等于'
                             '首镜无关（同值自管参数可能改写后续镜头/分组）；自管项：%s'
                             % (t, ', '.join(hit), names))


def renderer_tokens_from_exec(argv_exec):
    """实际执行 argv → 渲染器参数段（Blender 约定第一个 -- 之后交给脚本）。

    兼容可选的 nice 前缀；--extra 禁含裸 --、规范命令也只有脚本前一个 --，取第一个即安全。"""
    if '--' not in argv_exec:
        raise SystemExit('E: 执行 argv 缺少 Blender/脚本分隔符 --：%s' % ' '.join(argv_exec))
    return argv_exec[argv_exec.index('--') + 1:]


def verify_exec_argv(rcp, argv_exec, expect_tokens, label):
    """R2 必修2/4：启动 Blender 前，用渲染器自己的 parser 完整解析实际执行的 argv。

    解析失败（未知参数 / 缺值 / 非法 choices）→ 启动前拒绝并提示正确写法；
    解析成功 → 断言自管字段与调度器期望（由规范命令独立重建的 token）完全一致。
    返回实际 namespace（组渲等价验证复用）。"""
    toks = renderer_tokens_from_exec(argv_exec)
    ns, err = parse_renderer_argv(rcp, toks)
    if ns is None:
        raise SystemExit('E: [%s] 实际执行 argv 无法被当前渲染器解析，未启动 Blender：%s\n'
                         '  argv: %s\n  提示：参数须与 scripts/render-control-passes.py 的 argparse 匹配——'
                         '缺值参数须带值（降噪开关写 --beauty-denoise=on 或 --beauty-denoise on 形式）；'
                         '未知参数待渲染器升级支持后再用' % (label, err, ' '.join(shlex.quote(t) for t in toks)))
    ens, eerr = parse_renderer_argv(rcp, expect_tokens)
    if ens is None:
        raise SystemExit('E: [%s] 调度器期望 argv 解析失败（内部错误）：%s\n  期望: %s'
                         % (label, eerr, ' '.join(shlex.quote(t) for t in expect_tokens)))
    bad = [(k, getattr(ns, k, None), getattr(ens, k, None)) for k in SELF_MANAGED
           if getattr(ns, k, None) != getattr(ens, k, None)]
    if bad:
        raise SystemExit('E: [%s] 启动前校验失败：自管字段与调度器期望不符，拒绝启动 Blender：%s\n'
                         '  实际 argv: %s' % (label, '；'.join('--%s：%r ≠ %r' % b for b in bad),
                                              ' '.join(shlex.quote(t) for t in toks)))
    return ns


def verify_group_equivalence(rcp, group_ns, member_expect, label):
    """R2 必修2：--fast-group 组命令与逐镜命令在除 --shots 外的自管字段上逐镜等价，
    等价才允许把组渲出的镜头按逐镜规范 argv 记指纹（否则指纹会包装出「伪等价」）。"""
    for sid, member_tokens in member_expect:
        mns, merr = parse_renderer_argv(rcp, member_tokens)
        if mns is None:
            raise SystemExit('E: [%s] 逐镜期望 argv 解析失败（内部错误）：%s' % (label, merr))
        bad = [(k, getattr(group_ns, k, None), getattr(mns, k, None)) for k in SELF_MANAGED
               if k != 'shots' and getattr(group_ns, k, None) != getattr(mns, k, None)]
        if bad:
            raise SystemExit('E: [%s] 组命令与逐镜命令 %s 不等价（%s）——拒绝按逐镜规范 argv 记指纹'
                             % (label, sid, '；'.join('--%s：%r ≠ %r' % b for b in bad)))


def load_shots(path):
    doc = json.load(open(path, encoding='utf-8'))
    fps = doc.get('fps', 24)
    shots = []
    for s in doc['shots']:
        n = int(round(float(s['durationS']) * fps))
        if n <= 0:
            raise SystemExit('E: %s 时长 %.3fs × %dfps = %d 帧 ≤ 0' % (s['id'], s['durationS'], fps, n))
        shots.append({'id': s['id'], 'light': s['light'], 'frames': n})
    return shots, fps


def match_shots(shots, tokens):
    """--shots 既有完整 id 也接受镜号前缀（pv01 → pv01-aerial-reveal）；歧义/未命中即报错。"""
    out, errs = [], []
    for t in tokens:
        hit = [s for s in shots if s['id'] == t or s['id'].startswith(t + '-') or s['id'].startswith(t)]
        if not hit:
            errs.append('--shots %s 未命中任何镜头（16 镜见 scripts/pv-shots.json）' % t)
        elif len(hit) > 1 and not any(s['id'] == t for s in hit):
            errs.append('--shots %s 歧义：%s' % (t, ', '.join(s['id'] for s in hit)))
        else:
            out.extend(hit)
    if errs:
        raise SystemExit('E: ' + '; '.join(errs))
    seen, uniq = set(), []
    for s in out:
        if s['id'] not in seen:
            seen.add(s['id'])
            uniq.append(s)
    return uniq


def flatten(cmd):
    return ' '.join(cmd.replace(' \\\n', ' ').split())


def build_commands(pv_docs, groups, product_root):
    """[(tag, 单行规范命令, [shot…])]：组命令在前、逐镜在后，全部来自 pv-docs.export_command。

    extra 不拼进规范命令（显示层另行追加带引号形式，执行层用参数数组）。"""
    out = []
    for light, ids in groups:
        out.append(('group:%s' % light, flatten(pv_docs.export_command(ids, light, product_root)), ids))
    for light, ids in groups:
        for sid in ids:
            out.append(('shot:%s' % sid, flatten(pv_docs.export_command([sid], light, product_root)), [sid]))
    return out


def replace_input_tokens(toks, overrides):
    """R3 必修1：--scene/--cameras 输入注入——对 shlex 后的参数段原位替换选项值（--opt value 与
    --opt=value 都认）。替换发生在实际执行 argv 与调度器期望 token 两处的同一环节，指纹 sha
    （input_sha_from_argv 读实际 argv）与齐全判定期望尺寸（读 parser namespace 的 --cameras）
    都从这同一份 argv 派生，三处天然同源。参数段里没有对应选项或缺值即报错——注入不许悄悄失效。"""
    out = list(toks)
    for name, new in overrides.items():
        if not new:
            continue
        hit = False
        i = 0
        while i < len(out):
            t = out[i]
            if t == name:
                if i + 1 >= len(out) or out[i + 1].startswith('--'):
                    raise SystemExit('E: 参数段中 %s 缺值，无法应用输入覆盖（注入不得悄悄失效）' % name)
                out[i + 1] = new
                hit = True
                i += 2
                continue
            if t.startswith(name + '='):
                out[i] = '%s=%s' % (name, new)
                hit = True
            i += 1
        if not hit:
            raise SystemExit('E: 参数段中没有 %s，无法应用输入覆盖（注入不得悄悄失效）：%s' % (name, ' '.join(out)))
    return out


def exec_argv_of(canonical_cmd, blender_exec, extra_tokens, frames_first_n, nice, input_overrides=None):
    """规范命令 → 实际 argv 数组：shlex 解析（不再用裸 split，带引号参数不拆）、替换渲染可执行
    文件（PV_BATCH_BLENDER 测试替换点）、附加 extra token 与 --frames、可选 nice 前缀。
    input_overrides：--scene/--cameras 输入路径注入（R3 必修1，测试自带合成输入用）。"""
    toks = shlex.split(canonical_cmd)
    if toks[0] != CANON_BLENDER:
        raise SystemExit('E: 命令前缀不是 %s：%s' % (CANON_BLENDER, canonical_cmd))
    if input_overrides:
        toks = replace_input_tokens(toks, input_overrides)
    argv = [os.path.expanduser(blender_exec)] + toks[1:] + list(extra_tokens)
    if frames_first_n is not None:
        argv += ['--frames', ','.join(str(k) for k in range(frames_first_n))]
    if nice is not None:
        argv = ['nice', '-n', str(nice)] + argv
    return argv


# ---------------- 指纹输入 sha ----------------

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def input_sha_from_argv(argv):
    """从渲染 argv 取 --scene/--cameras/--presets 输入文件的 sha256（相对路径按 AREA=cwd 解析；
    --presets 缺省用渲染器默认 lighting/presets.json）。文件缺失记 None（=指纹不一致）。"""
    picked = {}
    for i, t in enumerate(argv):
        if not t.startswith('--'):
            continue
        if '=' in t:
            name, val = t.split('=', 1)
        else:
            name = t
            val = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else None
        for k, field in INPUT_SHA_KEYS:
            if name == k and val is not None:
                picked[field] = val
    if 'presetsSha256' not in picked:
        picked['presetsSha256'] = os.path.join(AREA, 'lighting', 'presets.json')
    out = {}
    for field, val in picked.items():
        p = val if os.path.isabs(val) else os.path.join(AREA, val)
        out[field] = sha256_file(p) if os.path.isfile(p) else None
    return out


def layout_sha_from_ns(ns):
    """R2 必修3：从渲染器 parser 最终 namespace 取 --layout 路径（渲染器 argparse 默认
    <渲染器 ROOT>/baseline/layout.json，绝对路径），对其内容做 sha256；文件缺失记 None
    （=指纹不一致，阻止复用）。相对路径按渲染器 cwd（AREA）解析。没有环境变量旁路——
    哈希对象就是渲染输入契约里那条路径的文件本身，同一路径内容变化必然进指纹
    （E1/pvbatch R2 可选2：撤销 PV_BATCH_LAYOUT_OVERRIDE，它会使哈希对象偏离真实渲染输入）。"""
    p = getattr(ns, 'layout', '') or ''
    if not p:
        return None, p
    if not os.path.isabs(p):
        p = os.path.join(AREA, p)
    return (sha256_file(p) if os.path.isfile(p) else None), p


def frame_expect_size(cameras_input):
    """齐全性判定期望尺寸：PV_BATCH_FRAME_SIZE=WxH 覆盖（测试 stub 用），否则相机输入 json 的
    width/height；都拿不到时兜底 1280x720（分辨率错误由渲染器/后续校验兜底）。"""
    env = os.environ.get('PV_BATCH_FRAME_SIZE', '').strip().lower()
    if env:
        try:
            w, h = env.split('x')
            return int(w), int(h)
        except ValueError:
            raise SystemExit('E: PV_BATCH_FRAME_SIZE 须为 WxH（得到 %r）' % env)
    try:
        doc = json.load(open(cameras_input, encoding='utf-8'))
        return int(doc['width']), int(doc['height'])
    except Exception:
        return 1280, 720


# ---------------- 断点续跑：帧文件齐全性（必修2 强化）----------------

def frame_png_ok(path, expect_wh, depth16):
    """verify() 后重新打开 load() 完整解码；校验尺寸与通道编码（depth 16-bit、其余 RGB）。

    返回 None=通过，否则失败原因（供进度 note 与测试断言）。"""
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        return 'missing'
    from PIL import Image
    try:
        with Image.open(path) as im:
            im.verify()
    except Exception:
        return 'verify-failed'
    try:
        with Image.open(path) as im:
            im.load()
            if im.size != expect_wh:
                return 'size%dx%d(期望%dx%d)' % (im.size[0], im.size[1], expect_wh[0], expect_wh[1])
            if depth16 and im.mode not in DEPTH_MODES:
                return 'mode%s(非16-bit)' % im.mode
            if not depth16 and im.mode != 'RGB':
                return 'mode%s(非RGB)' % im.mode
    except Exception:
        return 'decode-failed'
    return None


def camera_json_ok(path, sid, k, expect_wh):
    """cameras 侧车 JSON：解析为 dict 且 shot/frame/width/height 与该帧一致、K 为 3x3、
    worldToCameraOpenGL/OpenCV 为 4x4。返回 None=通过，否则原因。"""
    try:
        doc = json.load(open(path, encoding='utf-8'))
    except Exception:
        return 'json-parse-failed'
    if not isinstance(doc, dict):
        return 'not-object'
    if doc.get('shot') != sid:
        return 'shot=%r' % doc.get('shot')
    if doc.get('frame') != k:
        return 'frame=%r' % doc.get('frame')
    if (doc.get('width'), doc.get('height')) != expect_wh:
        return 'wh=%r,%r' % (doc.get('width'), doc.get('height'))

    def num(v):
        # R2 可选：布尔（bool 是 int 子类）与非有限值（json 的 NaN/Infinity）都不是可用矩阵元素
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

    def mat(v, rows, cols):
        return isinstance(v, list) and len(v) == rows and all(
            isinstance(r, list) and len(r) == cols and all(num(x) for x in r) for r in v)

    if not mat(doc.get('K'), 3, 3):
        return 'K'
    for key in ('worldToCameraOpenGL', 'worldToCameraOpenCV'):
        if not mat(doc.get(key), 4, 4):
            return key
    return None


def shot_dir_of(product_root, light, sid):
    return os.path.join(product_root, 'control-24fps-%s' % light, sid)


def shot_state(product_root, light, sid, n, expect_wh):
    """镜粒度齐全性：四通道 frame-000..n-1（verify+load+尺寸/编码）+ cameras json（解析+字段）。"""
    base = shot_dir_of(product_root, light, sid)
    per = {}
    ok = True
    for ch in CHANNELS:
        good, first_bad = 0, None
        for k in range(n):
            why = frame_png_ok(os.path.join(base, ch, 'frame-%03d.png' % k), expect_wh, ch == 'depth')
            if why is None:
                good += 1
            elif first_bad is None:
                first_bad = 'frame-%03d:%s' % (k, why)
        per[ch] = {'ok': good, 'missing': n - good, 'firstBad': first_bad}
        ok = ok and good == n
    cam_good, cam_bad, cam_first = 0, 0, None
    for k in range(n):
        why = camera_json_ok(os.path.join(base, 'cameras', 'frame-%03d.json' % k), sid, k, expect_wh)
        if why is None:
            cam_good += 1
        else:
            cam_bad += 1
            if cam_first is None:
                cam_first = 'frame-%03d:%s' % (k, why)
    per['cameras'] = {'ok': cam_good, 'missing': cam_bad, 'firstBad': cam_first}
    ok = ok and cam_bad == 0
    return ok, per


# ---------------- 空白帧守卫（COMMON 判据，灰度直方图实现，免 numpy）----------------

def gray_stats(path):
    """返回 (std, dominant占比)；解码失败返回 None。"""
    try:
        from PIL import Image
        with Image.open(path) as im:
            hist = im.convert('L').histogram()
    except Exception:
        return None
    n = float(sum(hist))
    if n <= 0:
        return None
    mean = sum(i * c for i, c in enumerate(hist)) / n
    var = sum(c * (i - mean) ** 2 for i, c in enumerate(hist)) / n
    return var ** 0.5, max(hist) / n


def guard_shot(product_root, light, sid, n):
    """抽首/中/末帧 beauty 判空白。返回 (ok, 详情)。任一抽样帧空白即判失败（全黑/全白必中）。"""
    idx = sorted({0, (n - 1) // 2, n - 1})
    detail = []
    ok = True
    base = os.path.join(product_root, 'control-24fps-%s' % light, sid, 'beauty')
    for k in idx:
        st = gray_stats(os.path.join(base, 'frame-%03d.png' % k))
        if st is None:
            detail.append({'frame': k, 'error': 'decode-failed'})
            ok = False
            continue
        std, dom = st
        blank = std < BLANK_STD_MAX or dom > BLANK_DOMINANT_MAX
        detail.append({'frame': k, 'grayStd': round(std, 2), 'dominantFrac': round(dom, 4), 'blank': blank})
        if blank:
            ok = False
    return ok, {'sample': 'fml', 'frames': detail}


# ---------------- .done.json 完成记录（必修1/3/7）----------------

def read_done(sdir):
    p = os.path.join(sdir, '.done.json')
    try:
        d = json.load(open(p, encoding='utf-8'))
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def write_done(sdir, record):
    write_json(os.path.join(sdir, '.done.json'), record)


def seg_purity_check(product_root, light, sid, n_frames, log):
    """R1可选1：写成功完成记录前按镜头声明的完整帧号跑 seg 纯度（非 LUT 像素必须 0、
    缺帧 FAIL，不许只查目录里恰好存在的帧；显式 --frames 全帧号集，--report 禁用）。
    LUT 不存在（stub 测试链路 / 本次未渲 segmentation 通道）返回 None=检查不适用；
    失败返回错误摘要字符串，通过返回 None。"""
    control_dir = os.path.join(product_root, 'control-24fps-%s' % light)
    lut = os.path.join(control_dir, 'segmentation-lut.json')
    if not os.path.isfile(lut):
        return None
    import subprocess
    cmd = ['python3', '-X', 'utf8', os.path.join(AREA, 'scripts', 'check-seg-purity.py'),
           '--control', control_dir, '--lut', lut, '--shot', sid,
           '--frames', ','.join(str(k) for k in range(n_frames))]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        log('seg purity %s: exit %d\n%s' % (sid, r.returncode, (r.stdout + r.stderr).strip()[-800:]))
        return ('seg 纯度检查未过（check-seg-purity exit %d，帧 0..%d 全查）：%s'
                % (r.returncode, n_frames - 1, (r.stdout + r.stderr).strip()[-400:]))
    return None


def completion_guard(product_root, light, sid, n_frames, log):
    """写「成功完成记录」前的唯一守卫（新渲染与续跑共用，astra pvquality R1 必修1）：
    beauty 首/中/末空白守卫通过后，再跑 seg 纯度检查。返回 (ok, detail, purity_fail)。"""
    g_ok, g_detail = guard_shot(product_root, light, sid, n_frames)
    purity_fail = seg_purity_check(product_root, light, sid, n_frames, log) if g_ok else None
    if purity_fail is not None:
        g_ok = False
        g_detail = dict(g_detail or {})
        g_detail['segPurity'] = purity_fail
    return g_ok, g_detail, purity_fail


def fingerprint_diff(old_fp, new_fp):
    """逐字段比较指纹；返回差异说明列表（空 = 一致）。"""
    if not isinstance(old_fp, dict):
        return ['指纹记录缺失']

    def brief(v, nv=None):
        if isinstance(v, list) and isinstance(nv, list):
            for i, (x, y) in enumerate(zip(v, nv)):
                if x != y:
                    return '首个不同 token #%d：%r → %r' % (i, x, y)
            if len(v) != len(nv):
                return '长度 %d → %d（多出 %r）' % (len(v), len(nv), (nv[len(v):] or v[len(nv):]))
            return '一致'
        if isinstance(v, str):
            return v[:16] + ('…' if len(v) > 16 else '')
        return repr(v)

    out = []
    for k in FP_FIELDS:
        ov, nv = old_fp.get(k), (new_fp or {}).get(k)
        if ov != nv:
            out.append('%s（%s）' % (k, brief(ov, nv)))
    return out


# ---------------- 联系表（PIL：首/中/末 × 四通道）----------------

def make_sheet(product_root, light, sid, n, dst):
    from PIL import Image, ImageDraw, ImageFont

    def open_tile(path):
        """8-bit 通道直接转 RGB；16-bit depth（mode I，值 0..65535，背景 far 可略超）仿射压到 0-255 再钳位。"""
        src = Image.open(path)
        if src.mode in DEPTH_MODES:
            src = src.point(lambda v: v * 255 / 65535)
        return src.convert('RGB').resize((tw, th))

    def font(sz):
        for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
            if os.path.exists(p):
                return ImageFont.truetype(p, sz)
        return ImageFont.load_default()

    idx = sorted({0, (n - 1) // 2, n - 1})
    tw, th, lab, pad = 320, 180, 22, 4
    W = pad + len(CHANNELS) * (tw + pad)
    H = pad + lab * 2 + len(idx) * (th + lab + pad)
    im = Image.new('RGB', (W, H), (24, 24, 24))
    dr = ImageDraw.Draw(im)
    dr.text((pad, 4), '%s  [%s]  %d frames  fml x %s' % (sid, light, n, '/'.join(CHANNELS)), fill=(240, 240, 240),
            font=font(16))
    y = lab + 8
    f8, f9 = font(14), font(15)
    for j, ch in enumerate(CHANNELS):
        dr.text((pad + j * (tw + pad), y), ch, fill=(160, 200, 255), font=f9)
    y += lab
    for r, k in enumerate(idx):
        for j, ch in enumerate(CHANNELS):
            dr.text((pad + j * (tw + pad), y), 'frame-%03d' % k, fill=(200, 200, 200), font=f8)
            x0 = pad + j * (tw + pad)
            tile = Image.new('RGB', (tw, th), (48, 16, 16))
            try:
                tile = open_tile(os.path.join(product_root, 'control-24fps-%s' % light, sid, ch, 'frame-%03d.png' % k))
            except Exception as e:
                dr.text((x0 + 8, y + th // 2), 'missing (%s)' % type(e).__name__, fill=(255, 120, 120), font=f8)
            im.paste(tile, (x0, y + lab))
        y += th + lab + pad
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst)


# ---------------- 锁（必修5）----------------

def acquire_flock(path, label, log):
    """内核互斥锁：fcntl.flock 非阻塞独占。不做「检查 PID 后覆盖」的接管——持有者死了锁自动
    释放，活着就报错。返回 fd（进程生命周期内保持打开；并经 pass_fds 传给渲染子进程）。"""
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o666)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        try:
            holder = open(path, encoding='utf-8').read().strip()
        except OSError:
            holder = ''
        os.close(fd)
        raise SystemExit('E: %s（%s）已被占用：flock 非阻塞获取失败（记录 pid %s；锁随持有进程退出自动释放，'
                         '不猜陈旧——若确认无渲染在跑，检查是否有存活 Blender 子进程仍持有锁 fd）' % (label, path, holder or '?'))
    try:
        os.ftruncate(fd, 0)
        os.write(fd, ('%d\n' % os.getpid()).encode())
    except OSError:
        pass
    log('锁就绪 %s（flock 内核互斥，pid %d）' % (path, os.getpid()))
    return fd


def now_iso():
    return datetime.datetime.now().isoformat(timespec='seconds')


def main():
    ap = argparse.ArgumentParser(description='PV 正式帧批量渲染调度器（wave12-pvbatch R1）')
    ap.add_argument('--out-root', required=True, help='批产物根目录（--frames 冒烟时产物在 <out-root>/_smoke/）：control-24fps-<light>/、logs/、sheets/、pv-batch-progress.json、RESULT.json')
    ap.add_argument('--group', default='all', choices=('day', 'dusk', 'night', 'all'), help='按光照组选镜（默认 all）')
    ap.add_argument('--shots', default='', help='逗号分隔镜头（完整 id 或 pv01 式前缀），与 --group 取交集')
    ap.add_argument('--extra', default='', help='透传给渲染器的额外参数（shlex 解析一次；自管参数拒绝；如 "--beauty-samples 128 --beauty-denoise on"）')
    ap.add_argument('--frames', type=int, default=None, metavar='N', help='每镜只渲前 N 帧（冒烟；产物强制写 <out-root>/_smoke/）')
    ap.add_argument('--fast-group', action='store_true', help='组命令整组渲（守卫滞后到组命令结束；默认逐镜即守卫）')
    ap.add_argument('--rerender-mismatch', action='store_true', help='续跑指纹不一致/无记录的镜不报错停，而是整镜移 _discard/ 后重渲（不删文件）')
    ap.add_argument('--nice', type=int, nargs='?', const=10, default=None, metavar='N', help='渲染进程降权（nice -n N，缺省 10；不入指纹）')
    ap.add_argument('--dry-run', action='store_true', help='只打印将执行的命令、实际执行 argv 与预计帧数，不渲染、不写任何文件')
    ap.add_argument('--pv', default=PV_SHOTS, help='分镜正本（默认 scripts/pv-shots.json）')
    ap.add_argument('--scene', default='', help='R3：覆盖渲染 --scene 输入路径（默认沿用 pv-docs 规范命令的 out-zone/scene-areas.glb；测试自带合成场景输入用。注入同一份路径进实际 argv/指纹 sha/尺寸读取，不跳过任何门禁）')
    ap.add_argument('--cameras', default='', help='R3：覆盖渲染 --cameras 输入路径（默认沿用 out-zone/pv-cameras.json；测试自带合成相机输入用。齐全判定期望尺寸也从这份输入读，PV_BATCH_FRAME_SIZE 仍可再覆盖）')
    a = ap.parse_args()
    INPUT_OVERRIDES = {k: v for k, v in (('--scene', a.scene), ('--cameras', a.cameras)) if v}

    if a.frames is not None and a.frames < 1:
        raise SystemExit('E: --frames 须 ≥ 1')
    if ' ' in os.path.abspath(a.out_root):
        raise SystemExit('E: --out-root 路径不能含空格（pv-docs 规范命令按空格拼接、无引号）：%s' % a.out_root)
    extra_display = a.extra.strip()
    extra_tokens = shlex.split(extra_display) if extra_display else []
    mode = 'smoke' if a.frames is not None else 'formal'
    product_root = os.path.join(a.out_root, '_smoke') if mode == 'smoke' else a.out_root

    pv_docs = load_pv_docs()
    shots, fps = load_shots(a.pv)
    sel = shots
    if a.group != 'all':
        sel = [s for s in sel if s['light'] == a.group]
    if a.shots:
        keep = {s['id'] for s in match_shots(shots, [t for t in a.shots.split(',') if t])}
        sel = [s for s in sel if s['id'] in keep]
    if not sel:
        raise SystemExit('E: 选择为空（--group %s --shots %s）' % (a.group, a.shots))
    if a.frames is not None:
        for s in sel:
            s['framesFull'] = s['frames']
            s['frames'] = min(s['frames'], a.frames)
    for s in sel:
        s.setdefault('framesFull', s['frames'])
    shot_by_id = {s['id']: s for s in sel}

    # 与 pv-docs 同一套分组规则（连续同 light 归一组）构造 19 条规范命令
    groups = pv_docs.light_groups(sel)
    plan = build_commands(pv_docs, groups, product_root)
    cmd_by_tag = {tag: (cmd, ids) for tag, cmd, ids in plan}
    shot_cmds = {ids[0]: cmd for tag, cmd, ids in plan if tag.startswith('shot:')}
    total_sel_frames = sum(s['frames'] for s in sel)

    blender_exec = os.environ.get('PV_BATCH_BLENDER', CANON_BLENDER)

    def display_cmd(cmd):
        return cmd + (' ' + ' '.join(shlex.quote(t) for t in extra_tokens) if extra_tokens else '')

    def exec_argv(canonical_cmd, with_nice):
        return exec_argv_of(canonical_cmd, blender_exec, extra_tokens, a.frames,
                            a.nice if with_nice else None, input_overrides=INPUT_OVERRIDES)

    # --extra 安检（必修6 + R2 必修2 自管选项出现即拒绝）：渲染器自己的 argparse 行为级判定
    rcp = load_renderer_module()

    def expect_render_tokens(canonical_cmd):
        """R2 必修2：调度器期望的渲染器参数段——由规范命令独立重建（shlex 后取 -- 段，
        再附 extra 与 --frames），与实际执行 argv 的构造路径彼此独立，可交叉验证。
        R3 必修1：--scene/--cameras 输入覆盖在此同步替换（与 exec_argv 同一 overrides 表），
        两路 token 保持等价，自管字段断言不因注入产生伪差异。"""
        toks = shlex.split(canonical_cmd)
        out = toks[toks.index('--') + 1:]
        if INPUT_OVERRIDES:
            out = replace_input_tokens(out, INPUT_OVERRIDES)
        out = out + list(extra_tokens)
        if a.frames is not None:
            out += ['--frames', ','.join(str(k) for k in range(a.frames))]
        return out

    base_toks = shlex.split(shot_cmds[sel[0]['id']])
    check_extra_tokens(extra_tokens, base_toks[base_toks.index('--') + 1:], rcp)
    # R2 必修4：启动前全量解析（拿锁、建目录、启动 Blender 之前）——extra 对每条命令相同，
    # 解析成败与 --shots 值无关，首条命令即可代表；未知参数 / 缺值在此拒绝并提示正确写法
    verify_exec_argv(rcp, exec_argv(shot_cmds[sel[0]['id']], True),
                     expect_render_tokens(shot_cmds[sel[0]['id']]), 'prelaunch:%s' % sel[0]['id'])

    # 指纹公共输入 sha 与齐全性判定期望尺寸（layout 从真实 parser 最终 namespace 取路径：R2 必修3）
    fp_argv0 = exec_argv(shot_cmds[sel[0]['id']], False)
    fp_ns, fp_ns_err = parse_renderer_argv(rcp, renderer_tokens_from_exec(fp_argv0))
    if fp_ns is None:
        raise SystemExit('E: 首镜渲染 argv 解析失败（内部错误）：%s' % fp_ns_err)
    fp_inputs = input_sha_from_argv(fp_argv0)
    fp_inputs['layoutSha256'], layout_path_used = layout_sha_from_ns(fp_ns)
    renderer_sha = sha256_file(RENDERER) if os.path.isfile(RENDERER) else None
    # R1必修2：混雾脚本是渲染器的行为输入（atmosphere 声明镜头的 beauty 由它覆写），
    # sha 进指纹；文件缺失记 None（=指纹不一致，阻止复用）。
    atmos_sha = sha256_file(ATMOS_MIX) if os.path.isfile(ATMOS_MIX) else None
    # R3 必修1：期望尺寸从实际渲染 argv 解析出的 --cameras 输入读（含注入覆盖）——与实际命令、
    # 指纹 sha 用同一份输入；parser namespace 为空才退回旧的 out-zone 固定路径。
    cameras_input = getattr(fp_ns, 'cameras', '') or ''
    if not cameras_input:
        cameras_input = os.path.join(AREA, 'out-zone', 'pv-cameras.json')
    elif not os.path.isabs(cameras_input):
        cameras_input = os.path.join(AREA, cameras_input)
    expect_wh = frame_expect_size(cameras_input)

    def fingerprint_of(sid):
        fp = {'argv': exec_argv(shot_cmds[sid], False),  # 逐镜规范实际 argv（nice 不入指纹）
              'rendererSha256': renderer_sha, 'atmosphereMixSha256': atmos_sha,
              'framesCount': shot_by_id[sid]['frames'], 'mode': mode}
        fp.update(fp_inputs)
        return fp

    if a.dry_run:
        print('# pv-batch dry-run  group=%s shots=%d/%d fps=%d planned-frames=%d out-root=%s' % (
            a.group, len(sel), len(shots), fps, total_sel_frames, a.out_root))
        print('# mode=%s product-root=%s 执行模型：%s' % (
            mode, product_root, 'A 组命令整组渲（--fast-group，守卫滞后）+ B 逐镜补缺' if a.fast_group
            else '默认逐镜调用（每镜渲完立即守卫，失败即停不开始下一镜）'))
        if extra_display:
            print('# extra(shlex 解析一次): %s' % ' '.join(shlex.quote(t) for t in extra_tokens))
        if os.environ.get('PV_BATCH_BLENDER'):
            print('# renderer override: PV_BATCH_BLENDER=%s' % os.environ['PV_BATCH_BLENDER'])
        if INPUT_OVERRIDES:
            print('# input override: %s' % ', '.join('%s=%s' % (k.lstrip('-'), v) for k, v in INPUT_OVERRIDES.items()))
        if a.frames is not None:
            print('# frames: 每镜只渲前 %d 帧（--frames，冒烟产物在 _smoke/）' % a.frames)
        if a.nice is not None:
            print('# nice: -n %d' % a.nice)
        for tag, cmd, ids in plan:
            fr = sum(s['frames'] for s in sel if s['id'] in set(ids))
            kind = 'group' if tag.startswith('group:') else 'shot '
            print('[%s %s] shots=%d frames=%d' % (kind, tag, len(ids), fr))
            print(display_cmd(cmd))
            print('  exec-argv: %s' % ' '.join(shlex.quote(t) for t in exec_argv(cmd, True)))
            # R2 必修2/4：dry-run 同样逐条全量解析 + 自管字段断言 + 组/逐镜等价（不渲染也先暴露）
            ns_cmd = verify_exec_argv(rcp, exec_argv(cmd, True), expect_render_tokens(cmd), tag)
            if kind == 'group':
                verify_group_equivalence(rcp, ns_cmd,
                                         [(i, expect_render_tokens(shot_cmds[i])) for i in ids], tag)
        skipped = sum(1 for s in sel if shot_state(product_root, s['light'], s['id'], s['frames'], expect_wh)[0]) \
            if os.path.isdir(product_root) else 0
        print('# commands=%d  selected-frames=%d  already-complete-shots=%d' % (len(plan), total_sel_frames, skipped))
        return 0

    # ---------------- 实跑 ----------------
    miss = [f for f in ('presetsSha256', 'sceneSha256', 'camerasSha256', 'layoutSha256') if fp_inputs.get(f) is None]
    if renderer_sha is None:
        miss.append('rendererSha256')
    if atmos_sha is None:
        miss.append('atmosphereMixSha256')   # R1必修2：混雾脚本缺失同样禁止跑批
    if miss:
        raise SystemExit('E: 指纹输入缺失（%s）——先完成公共验收重建并确认 out-zone 输入件，再跑批' % ', '.join(miss))

    os.makedirs(os.path.join(product_root, 'logs'), exist_ok=True)
    os.makedirs(os.path.join(product_root, 'sheets'), exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    log_path = os.path.join(product_root, 'logs', 'pv-batch-%s.log' % stamp)
    logf = open(log_path, 'a', encoding='utf-8')

    def log(msg):
        line = '[%s] %s' % (datetime.datetime.now().strftime('%H:%M:%S'), msg)
        print(line, flush=True)
        logf.write(line + '\n')
        logf.flush()

    install_signal_handlers()
    gpu_lock_path = os.environ.get('PV_BATCH_GPU_LOCK', GPU_LOCK_DEFAULT)
    lock_fds = []
    try:
        lock_fds.append(acquire_flock(gpu_lock_path, '全机 GPU 锁（所有 out-root 共用）', log))
        lock_fds.append(acquire_flock(os.path.join(a.out_root, '.pv-batch.lock'), 'out-root 锁', log))
    except SystemExit:
        logf.close()
        raise

    progress_path = os.path.join(product_root, 'pv-batch-progress.json')
    prog = {'version': 2, 'outRoot': a.out_root, 'productRoot': product_root, 'mode': mode,
            'fastGroup': bool(a.fast_group), 'gpuLock': gpu_lock_path,
            'group': a.group, 'shotsFilter': a.shots,
            'fps': fps, 'dryRun': False, 'renderer': blender_exec, 'extra': extra_display,
            'extraArgv': extra_tokens, 'framesFirstN': a.frames, 'nice': a.nice, 'log': log_path,
            'startedAt': now_iso(), 'updatedAt': now_iso(), 'etaSeconds': None,
            'stoppedReason': None,
            'shots': {s['id']: {'light': s['light'], 'status': 'pending', 'attempts': 0,
                                'framesExpected': s['frames'], 'framesDone': 0,
                                'secondsTotal': None, 'secondsPerFrame': None,
                                'guard': 'not-run', 'guardDetail': None, 'command': display_cmd(shot_cmds[s['id']]),
                                'note': None}
                      for s in sel}}

    def eta_update():
        done_spf = [p['secondsPerFrame'] for p in prog['shots'].values() if p['secondsPerFrame']]
        pending = [p['framesExpected'] for p in prog['shots'].values() if p['status'] in ('pending', 'running')]
        if done_spf and pending:
            prog['etaSeconds'] = round(sum(pending) * (sum(done_spf) / len(done_spf)), 0)
        elif not pending:
            prog['etaSeconds'] = 0
        prog['updatedAt'] = now_iso()
        write_json(progress_path, prog)

    # ---------------- 续跑评估（必修1/3/7 + R2 必修1：可信才跳过）----------------
    problems = []      # [(sid, 原因)] —— 无记录 / 指纹不一致 / mode 不符
    reguard_fail = None
    for s in sel:
        sid = s['id']
        p = prog['shots'][sid]
        sdir = shot_dir_of(product_root, s['light'], sid)
        d = read_done(sdir)
        # mode 门禁最先：含 smoke 记录的目录不许当正式根用（反之亦然），帧不全也不许覆盖
        if d is not None and d.get('mode') != mode:
            reason = '完成记录 mode=%r 与本次 mode=%r 不符（正式模式拒绝把 smoke 记录当完成，反之亦然）' % (
                d.get('mode'), mode)
            problems.append((sid, reason))
            p.update(status='blocked-fingerprint', note=reason)
            continue
        # R2 必修1：指纹检查先于完整性分支——文件不齐不能掩盖配置不一致
        #（「缺文件 + 换配置」默认报错停下，不因帧不全直接转待渲绕过比较）
        if d is not None:
            diff = fingerprint_diff(d.get('fingerprint'), fingerprint_of(sid))
            if diff:
                reason = '指纹不一致：%s' % '；'.join(diff)
                problems.append((sid, reason))
                p.update(status='blocked-fingerprint', note=reason)
                continue
        ok, per = shot_state(product_root, s['light'], sid, s['frames'], expect_wh)
        p['framesDone'] = per['beauty']['ok']
        if not ok:
            # R2 必修1：帧不齐（指纹一致或无记录）→ 待渲；渲染开始前整个旧镜头目录会被
            # 原子移入 _discard/（含旧 .done.json），在干净目录整镜重渲，不会覆盖出混合产物
            p.update(note='帧文件不齐全，待渲（渲染前旧目录整镜移 _discard，干净目录重渲）：%s'
                     % json.dumps(per, ensure_ascii=False))
            continue
        if d is None:
            reason = '帧齐全但无完成记录（.done.json 缺失或不可解析）——没有可信记录的完整文件不算完成'
        elif d.get('guard') == 'pass':
            # R2 可选3：可信续跑分支回填守卫状态并注明来源（此前 RESULT 里一直是 not-run）
            p.update(status='complete-preexisting', framesDone=s['frames'],
                     guard=d.get('guard', 'not-run'), guardDetail=d.get('guardDetail'),
                     note='帧齐全且 .done.json 指纹一致、守卫 pass，跳过；guard 状态取自完成记录（本次未重跑守卫）')
            continue
        else:
            # guard != pass（必修3）：重新守卫，仍失败就仍停——不重渲、更不洗白
            g_ok, g_detail, _purity = completion_guard(product_root, s['light'], sid, s['frames'], log)
            p['guard'] = 'pass' if g_ok else 'fail'
            p['guardDetail'] = g_detail
            if g_ok:
                write_done(sdir, {'version': 1, 'mode': mode, 'finishedAt': now_iso(),
                                  'fingerprint': fingerprint_of(sid), 'guard': 'pass', 'guardDetail': g_detail,
                                  'note': '上次守卫失败/未过：续跑重新守卫通过'})
                p.update(status='complete-preexisting', framesDone=s['frames'],
                         note='上次守卫失败/未过：本次重新守卫通过（.done.json 已更新）')
            else:
                p.update(status='failed-guard',
                         note='上次守卫失败：续跑重新守卫仍失败（未调用渲染器）')
                prog['stoppedReason'] = '%s 续跑重新守卫仍失败' % sid
                reguard_fail = reguard_fail or sid
            continue
        problems.append((sid, reason))
        p.update(status='blocked-fingerprint', note=reason)

    log('pv-batch 开始（mode=%s%s）：%d 镜 / %d 帧（group=%s shots=%s extra=%r frames=%s nice=%s）' % (
        mode, '，--fast-group 组渲（守卫滞后）' if a.fast_group else '，默认逐镜即守卫',
        len(sel), total_sel_frames, a.group, a.shots or '-', extra_display or '-', a.frames, a.nice))
    pre = [sid for sid in prog['shots'] if prog['shots'][sid]['status'] == 'complete-preexisting']
    if pre:
        log('断点续跑：%d 镜可信跳过（指纹一致+守卫 pass）：%s' % (len(pre), ', '.join(pre)))

    discarded = []

    def build_result(status, stopped_reason):
        """RESULT 构造唯一出口（E1/pvbatch R2 可选1）：正常结束、失败、指纹拒绝提前退出共用
        同一构造，每次运行都在 product_root 留下本次收据——旧的成功 RESULT 不再存活过拒绝点。"""
        res = {'version': 2, 'tool': 'scripts/render-pv-batch.py', 'outRoot': a.out_root,
               'productRoot': product_root, 'mode': mode, 'fastGroup': bool(a.fast_group),
               'startedAt': prog['startedAt'], 'finishedAt': now_iso(),
               'group': a.group, 'shotsFilter': a.shots, 'extra': extra_display, 'extraArgv': extra_tokens,
               'framesFirstN': a.frames, 'fps': fps, 'log': log_path, 'gpuLock': gpu_lock_path,
               'discarded': discarded,
               'status': status,
               'stoppedReason': stopped_reason,
               'shots': []}
        for s in sel:
            p = prog['shots'][s['id']]
            res['shots'].append({'id': s['id'], 'light': s['light'], 'frames': s['frames'],
                                 'framesFull': s['framesFull'], 'status': p['status'],
                                 'secondsTotal': p['secondsTotal'], 'secondsPerFrame': p['secondsPerFrame'],
                                 'guard': p['guard'], 'command': p['command'], 'note': p['note']})
        res['totals'] = {'shots': len(sel), 'frames': total_sel_frames,
                         'rendered': sum(1 for x in res['shots'] if x['status'].startswith('rendered-')),
                         'skippedComplete': sum(1 for x in res['shots'] if x['status'] == 'complete-preexisting'),
                         'failed': sum(1 for x in res['shots'] if x['status'].startswith('failed-')),
                         'blocked': sum(1 for x in res['shots'] if x['status'] == 'blocked-fingerprint'),
                         'seconds': round(sum(x['secondsTotal'] or 0 for x in res['shots']), 1)}
        return res

    if problems and not a.rerender_mismatch:
        eta_update()
        for sid, reason in problems:
            log('BLOCK %s：%s' % (sid, reason))
        # E1（R2 可选1）：指纹拒绝的提前退出也写本次 RESULT.json（status=blocked + 原因）——
        # 拒绝点覆盖旧收据，且 stoppedReason 汇总逐镜拒绝原因，收据自足（不必翻日志）。
        res_blocked = build_result(
            'blocked',
            '%d 镜续跑校验未过（指纹/完成记录问题），未渲染任何帧：%s'
            % (len(problems), '；'.join('%s %s' % (sid, reason) for sid, reason in problems)))
        write_json(os.path.join(product_root, 'RESULT.json'), res_blocked)
        log('已写本次 blocked RESULT 收据：%s' % os.path.join(product_root, 'RESULT.json'))
        logf.close()
        raise SystemExit('E: %d 镜续跑校验未过，已停下（未渲染任何帧）——宁可停，不把不可信的帧当完成：\n  %s\n'
                         '   要用本次配置整镜重渲：加 --rerender-mismatch（整镜移到 _discard/，不删文件）'
                         % (len(problems), '\n  '.join('%s：%s' % (sid, reason) for sid, reason in problems)))

    def discard_before_render(sid, reason):
        """R2 必修1：任何对已有镜头目录的覆盖开始前，先把整个旧镜头目录（含 .done.json）
        原子移入 <product-root>/_discard/<id>-<时间戳>/——旧成功标记在覆盖路径上不可能存活；
        在干净目录整镜重渲，只有本次全部完成且守卫通过才写新的成功记录。目录不存在则无事可做。"""
        src = shot_dir_of(product_root, shot_by_id[sid]['light'], sid)
        if not os.path.isdir(src):
            return
        droot = os.path.join(product_root, '_discard')
        os.makedirs(droot, exist_ok=True)
        base = '%s-%s' % (sid, stamp)
        dst = os.path.join(droot, base)
        n = 1
        while os.path.exists(dst):  # 同秒内同镜多次移走时加序号，不覆盖既有 _discard 内容
            n += 1
            dst = os.path.join(droot, '%s-%d' % (base, n))
        os.replace(src, dst)  # 同文件系统内原子移走整个目录
        rel = os.path.relpath(dst, product_root)
        discarded.append({'id': sid, 'movedTo': rel, 'reason': reason})
        prog['shots'][sid].update(note='%s；旧目录已原子移到 %s（不删文件）' % (reason, rel))
        log('DISCARD %s：%s；整镜移到 %s' % (sid, reason, dst))

    if problems and a.rerender_mismatch:
        for sid, reason in problems:
            prog['shots'][sid].update(status='pending')
            discard_before_render(sid, '%s（--rerender-mismatch 整镜重渲）' % reason)

    stop = {'reason': reguard_fail and ('%s 续跑重新守卫仍失败' % reguard_fail)}
    exit_code = 0

    def run_renderer(tag, argv_exec):
        """跑一条命令（cwd=area 根；渲染器独立进程组；锁 fd 传子进程）。返回 (exit code, 秒)。"""
        display = ' '.join(shlex.quote(t) for t in argv_exec)
        log('RUN %s -> %s' % (tag, display))
        t0 = time.monotonic()
        with open(log_path, 'a', encoding='utf-8') as lf:
            lf.write('\n===== %s =====\n%s\n' % (tag, display))
            lf.flush()
            try:
                p = subprocess.Popen(argv_exec, cwd=AREA, stdout=lf, stderr=subprocess.STDOUT,
                                     start_new_session=True, pass_fds=tuple(lock_fds))
                CURRENT_CHILD['p'] = p
                rc = p.wait()
            except FileNotFoundError as e:
                lf.write('E: 渲染可执行文件不存在：%s\n' % e)
                rc = 127
            except SignalStop:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                    log('收到信号：已向渲染进程组 pid %d 发 SIGTERM，等待回收' % p.pid)
                    rc = p.wait(timeout=30)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        os.killpg(p.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    rc = p.wait()
                CURRENT_CHILD['p'] = None
                raise
            finally:
                CURRENT_CHILD['p'] = None
        dt = time.monotonic() - t0
        log('RUN %s exit=%d %.1fs' % (tag, rc, dt))
        return rc, dt

    def done_record(sid, guard, guard_detail, argv_exec_display, note=None):
        rec = {'version': 1, 'mode': mode, 'finishedAt': now_iso(),
               'fingerprint': fingerprint_of(sid), 'guard': guard, 'guardDetail': guard_detail}
        if argv_exec_display:
            rec['argvExecuted'] = argv_exec_display
        if note:
            rec['note'] = note
        return rec

    def finalize_shot(sid, rendered_via, seconds, group_phase=False, argv_exec_display=None):
        """齐全性复核 + 空白守卫 + .done.json + 进度更新。返回 True=继续，False=停下。

        守卫通过 → 写 .done.json(guard=pass)；守卫失败 → 也写 .done.json(guard=fail)：
        续跑将对该镜重新守卫（必修3），不会被「帧齐全」洗白。
        组阶段（group_phase）：组命令后仍缺帧的镜头退回 pending 交给逐镜阶段补渲。"""
        s = shot_by_id[sid]
        ok, per = shot_state(product_root, s['light'], sid, s['frames'], expect_wh)
        p = prog['shots'][sid]
        p['framesDone'] = per['beauty']['ok']
        if not ok:
            if group_phase:
                p.update(status='pending', note='组命令后仍缺帧，交给逐镜补渲（镜粒度）：%s' % json.dumps(per, ensure_ascii=False))
                return True
            p.update(status='failed-incomplete', note='渲染后帧文件仍不齐全：%s' % json.dumps(per, ensure_ascii=False))
            prog['stoppedReason'] = '%s 渲染后仍缺帧' % sid
            return False
        p['secondsTotal'] = round(seconds, 1)
        p['secondsPerFrame'] = round(seconds / max(1, s['frames']), 2)
        # R1可选1 + R1审查必修1：beauty 守卫 + seg 纯度（按镜头声明完整帧号，LUT 不存在 = 不适用）
        g_ok, g_detail, purity_fail = completion_guard(product_root, s['light'], sid, s['frames'], log)
        p['guard'] = 'pass' if g_ok else 'fail'
        p['guardDetail'] = g_detail
        sdir = shot_dir_of(product_root, s['light'], sid)
        write_done(sdir, done_record(sid, p['guard'], g_detail, argv_exec_display))
        if not g_ok:
            why = ('seg 纯度检查未过' if purity_fail is not None else 'beauty 首/中/末空白（COMMON 判据）')
            p.update(status='failed-guard', note='%s；已写 .done.json(guard=fail)，续跑将重新守卫' % why)
            prog['stoppedReason'] = '%s %s（守卫失败）' % (sid, why)
            return False
        p['status'] = 'rendered-%s' % rendered_via
        if rendered_via == 'group':
            p['note'] = '--fast-group 组渲：守卫滞后到组命令结束才执行'
        return True

    # ---------------- A 组命令（仅 --fast-group 显式开启；守卫滞后标注）----------------
    try:
        if a.fast_group:
            for light, ids in groups:
                if stop['reason']:
                    break
                missing = [sid for sid in ids if prog['shots'][sid]['status'] == 'pending']
                if not missing or len(missing) < len(ids):
                    if missing:
                        log('组 %s 跳过组命令（%d/%d 镜已齐），缺失镜头交给逐镜补渲：%s'
                            % (light, len(ids) - len(missing), len(ids), ','.join(missing)))
                    else:
                        log('组 %s 全部镜头已齐，跳过组命令' % light)
                    continue
                tag = 'group:%s' % light
                cmd = cmd_by_tag[tag][0]
                argv_exec = exec_argv(cmd, True)
                # R2 必修2/4：启动前全量解析 + 自管字段断言；组命令与逐镜命令等价（除 --shots）
                # 验证通过才允许把组渲出的镜头按逐镜规范 argv 记指纹
                g_ns = verify_exec_argv(rcp, argv_exec, expect_render_tokens(cmd), tag)
                verify_group_equivalence(rcp, g_ns,
                                         [(i, expect_render_tokens(shot_cmds[i])) for i in ids], tag)
                for sid in ids:
                    prog['shots'][sid].update(status='running', attempts=prog['shots'][sid]['attempts'] + 1,
                                              command=display_cmd(cmd))
                # R2 必修1：组命令覆盖开始前，先把待渲镜头的旧目录（含旧 .done.json）整镜移走
                for sid in missing:
                    discard_before_render(sid, '组命令覆盖开始前移走旧镜头目录（含旧 .done.json），干净目录整镜重渲')
                eta_update()
                rc, dt = run_renderer(tag, argv_exec)
                ok_all = True
                for sid in ids:
                    if not finalize_shot(sid, 'group', dt / len(ids), group_phase=True,
                                         argv_exec_display=' '.join(shlex.quote(t) for t in argv_exec)):
                        stop['reason'] = prog['stoppedReason']
                        ok_all = False
                        break
                    eta_update()
                if not ok_all:
                    break
                if rc != 0:
                    log('WARN 组命令 %s 退出码 %d（已完成的镜头保留；仍缺的镜头由逐镜阶段补）' % (tag, rc))

        # ---------------- B 逐镜命令（默认路径：每镜渲完立即守卫，失败即停）----------------
        if not stop['reason']:
            for s in sel:
                sid = s['id']
                if stop['reason']:
                    break
                p = prog['shots'][sid]
                if p['status'] != 'pending':
                    continue
                cmd = shot_cmds[sid]
                argv_exec = exec_argv(cmd, True)
                # R2 必修2/4：启动 Blender 前全量解析实际 argv + 断言自管字段等于调度器期望
                verify_exec_argv(rcp, argv_exec, expect_render_tokens(cmd), 'shot:%s' % sid)
                p.update(status='running', attempts=p['attempts'] + 1, command=display_cmd(cmd))
                # R2 必修1：覆盖开始前把旧镜头目录（含旧 .done.json）整镜移走，干净目录重渲
                discard_before_render(sid, '覆盖开始前移走旧镜头目录（含旧 .done.json），干净目录整镜重渲')
                eta_update()
                rc, dt = run_renderer('shot:%s' % sid, argv_exec)
                if rc != 0:
                    p.update(status='failed-render', note='渲染器退出码 %d' % rc)
                    prog['stoppedReason'] = '%s 渲染器退出码 %d' % (sid, rc)
                    stop['reason'] = prog['stoppedReason']
                    break
                if not finalize_shot(sid, 'shot', dt, argv_exec_display=' '.join(shlex.quote(t) for t in argv_exec)):
                    stop['reason'] = prog['stoppedReason']
                    break
                eta_update()
    except SignalStop as e:
        kill_child_group(log)
        stop['reason'] = '收到信号 %s：已终止渲染进程组并回收' % signal.Signals(e.signum).name
        exit_code = 128 + e.signum
        log('STOP %s' % stop['reason'])

    # ---------------- 收尾 ----------------
    for sid, p in prog['shots'].items():
        if p['status'] == 'running':
            p.update(status='pending', note='未轮到（批次提前停止）')
    for s in sel:
        p = prog['shots'][s['id']]
        if p['status'] in ('complete-preexisting', 'rendered-group', 'rendered-shot'):
            try:
                make_sheet(product_root, s['light'], s['id'], s['frames'],
                           os.path.join(product_root, 'sheets', '%s.png' % s['id']))
                p['sheet'] = 'sheets/%s.png' % s['id']
            except Exception as e:
                p['sheet'] = 'error:%s' % e
                log('WARN 联系表失败 %s：%r' % (s['id'], e))
    prog['updatedAt'] = now_iso()
    prog['stoppedReason'] = stop['reason']
    eta_update()
    result = build_result('failed' if stop['reason'] else 'ok', stop['reason'])
    write_json(os.path.join(product_root, 'RESULT.json'), result)
    log('pv-batch 结束：status=%s rendered=%d skipped=%d failed=%d%s' % (
        result['status'], result['totals']['rendered'], result['totals']['skippedComplete'],
        result['totals']['failed'], ('（%s）' % stop['reason']) if stop['reason'] else ''))
    for fd in lock_fds:
        os.close(fd)  # flock 随 fd 关闭释放（渲染子进程已全部回收）
    logf.close()
    return exit_code if exit_code else (1 if stop['reason'] else 0)


if __name__ == '__main__':
    sys.exit(main())
