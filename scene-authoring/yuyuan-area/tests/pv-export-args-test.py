#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard R2 必修2：PV 导出命令的真实参数解析检查（R1 审查唯一必修 P1）。

背景：R1 的生成器自检（pv-docs.check_export_commands）只做文字正则匹配，查不出
「--cameras … 后多出的第二个 --」——第二个 -- 会终止 argparse 选项解析，渲染前即报
`the following arguments are required: --out`。本检查不重写任何解析规则：

  1. 用生成器（scripts/pv-docs.py 的 light_groups + export_command）现生成全部命令
     （默认 19 条 = 3 条分组 + 16 条逐镜）；
  2. 按 Blender 规则取第一个 -- 之后的参数，交给 render-control-passes.py 自己的
     parse_args()（stub bpy 后加载原模块；该文件末尾是无条件 main()，加载时只截掉
     这一行、其余原样执行，结尾不再是裸 main() 即报错退出，不许静默跳过）；
  3. 断言：全部解析成功；--scene / --cameras / --out / --shots / --beauty / --preset
     均按选项读到；--preset = 该镜 pv-shots.json 的 light；--beauty = cycles；
     分组命令的 --shots 依序恰好覆盖全部分镜、逐镜命令各只含该镜。

--docs <AI-HANDOFF.md> 可选：对已交付文档里的命令做同一套检查（§1 分组 + §5 逐镜），
保证交付物与生成器一致。

红绿对照（R2）：449661a7 生成器上 19/19 失败（artifacts/r2/logs/pv-export-args-RED.log），
删第二个 -- 后 19/19 通过（pv-export-args-GREEN.log）。

用法：python3 -X utf8 tests/pv-export-args-test.py [--script <pv-docs.py>] [--docs <AI-HANDOFF.md>]
"""
import contextlib
import importlib.util
import io
import os
import sys
import types

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PV_SHOTS = os.path.join(AREA, 'scripts', 'pv-shots.json')
PV_DOCS = os.path.join(AREA, 'scripts', 'pv-docs.py')
RENDERER = os.path.join(AREA, 'scripts', 'render-control-passes.py')
# --out 根目录对解析无影响，取个稳定占位即可
PV_ROOT = 'artifacts/pv'
BLENDER_LEAD = '~/.local/bin/blender'


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_renderer(path):
    """加载渲染器模块但停在主流程之前：末尾无条件 main() 只在 Blender --python 下该跑。"""
    src = open(path, encoding='utf-8').read().rstrip()
    if not src.endswith('\nmain()'):
        raise SystemExit('E: %s 末尾不是裸 main()，加载护栏失效，拒绝继续（不许静默跳过）' % path)
    body = src[:src.rindex('\nmain()')]
    # parse_args() 不触 bpy；stub 仅为让模块级 import 通过。渲染器文件不动。
    sys.modules.setdefault('bpy', types.ModuleType('bpy'))
    mod = types.ModuleType('render_control_passes_under_test')
    mod.__file__ = path
    exec(compile(body, path, 'exec'), mod.__dict__)
    return mod


def parse_with_renderer(rcp, cmd_one_line):
    """按 Blender 规则（第一个 -- 之后交给脚本）用渲染器自己的 parse_args() 解析一条命令。"""
    toks = cmd_one_line.split()
    if '--' not in toks:
        return None, '命令里没有 --（Blender 与脚本参数分隔符缺失）'
    sys.argv = ['render-control-passes.py'] + toks[toks.index('--'):]
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            ns = rcp.parse_args()
        return ns, None
    except SystemExit as e:
        msg = err.getvalue().strip().splitlines()
        return None, 'argparse 拒绝（退出码 %s）：%s' % (e.code, msg[-1] if msg else '<无输出>')


def expected_commands(pv_docs, shots):
    """由生成器现生成应有命令：[(tag, 单行命令, [id…])]，分组在前、逐镜在后（与 AI-HANDOFF 同序）。"""
    flat = lambda cmd: ' '.join(cmd.replace(' \\\n', ' ').split())
    out = []
    for light, ids in pv_docs.light_groups(shots):
        out.append(('group:%s' % light, flat(pv_docs.export_command(ids, light, PV_ROOT)), ids))
    for s in shots:
        out.append(('shot:%s' % s['id'], flat(pv_docs.export_command([s['id']], s['light'], PV_ROOT)), [s['id']]))
    return out


def check_one(rcp, by_id, tag, cmd, ids):
    ns, err = parse_with_renderer(rcp, cmd)
    if err:
        return False, err
    lights = {by_id[i]['light'] for i in ids if i in by_id}
    if lights != {ns.preset}:
        return False, '--preset=%r 但该组镜头 light=%s' % (ns.preset, sorted(lights))
    if ns.beauty != 'cycles':
        return False, '--beauty=%r（须 cycles，workbench 出不了灯光参考帧）' % ns.beauty
    if ns.scene != 'out-zone/scene-areas.glb' or ns.cameras != 'out-zone/pv-cameras.json':
        return False, '--scene/--cameras 未按选项读到（%r / %r）——典型第二个 -- 症状' % (ns.scene, ns.cameras)
    return True, 'preset=%s shots=%s out=%s' % (ns.preset, ns.shots, ns.out)


def run_suite(rcp, by_id, entries, label):
    ok_n = 0
    for tag, cmd, ids in entries:
        ok, msg = check_one(rcp, by_id, tag, cmd, ids)
        print('%s %s %s：%s' % ('PASS' if ok else 'FAIL', label, tag, msg))
        ok_n += 1 if ok else 0
    print('%s：%d/%d pass' % (label, ok_n, len(entries)))
    return ok_n == len(entries)


def extract_doc_commands(doc_path):
    """从 AI-HANDOFF.md 抽命令：§1 的分组命令 + §5 的逐镜命令（```bash 栅栏内、续行拼接）。"""
    cmds = {'group': [], 'shot': []}
    section = None
    buf = []

    def flush():
        if buf:
            one = ' '.join(' '.join(buf).split())
            if one.startswith(BLENDER_LEAD):
                cmds[section].append(one)
            del buf[:]

    for ln in open(doc_path, encoding='utf-8').read().splitlines():
        if ln.startswith('## '):
            flush()
            section = 'group' if ln.startswith('## 1.') else 'shot' if ln.startswith('## 5.') else None
            continue
        if ln.startswith('```'):
            flush()
            continue
        if not section or not ln.strip():
            continue
        piece = ln.rstrip()
        if piece.endswith('\\'):
            buf.append(piece[:-1].strip())
        else:
            buf.append(piece.strip())
            flush()
    flush()
    return cmds


def main():
    rest = sys.argv[1:]
    script = rest[rest.index('--script') + 1] if '--script' in rest else PV_DOCS
    docs = rest[rest.index('--docs') + 1] if '--docs' in rest else None
    import json
    shots = json.load(open(PV_SHOTS, encoding='utf-8'))['shots']
    by_id = {s['id']: s for s in shots}
    pv_docs = load_module(script, 'pv_docs_under_test')
    rcp = load_renderer(RENDERER)

    all_ok = run_suite(rcp, by_id, expected_commands(pv_docs, shots),
                       '生成器(%s)' % os.path.relpath(script, AREA))

    if docs:
        got = extract_doc_commands(docs)
        exp = expected_commands(pv_docs, shots)
        n_group = sum(1 for t, _, _ in exp if t.startswith('group:'))
        struct_ok = (len(got['group']) == n_group and len(got['shot']) == len(shots))
        if not struct_ok:
            print('FAIL 文档(%s) 命令条数：分组 %d（应 %d）、逐镜 %d（应 %d）'
                  % (docs, len(got['group']), n_group, len(got['shot']), len(shots)))
            all_ok = False
        else:
            entries = ([('group#%d' % i, c, ids) for i, ((_, _, ids), c) in
                        enumerate(zip(exp[:n_group], got['group']))]
                       + [('shot#%d' % i, c, [s['id']]) for i, (s, c) in enumerate(zip(shots, got['shot']))])
            all_ok = run_suite(rcp, by_id, entries, '文档(%s)' % docs) and all_ok

    if not all_ok:
        raise SystemExit(1)
    print('pv-export-args-test: all green')


if __name__ == '__main__':
    main()
