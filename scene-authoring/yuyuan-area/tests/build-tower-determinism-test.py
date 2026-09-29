#!/usr/bin/env python3
"""build_tower 跨进程确定性：同一栋楼连续生成两次，model.glb 必须逐字节相等。

R1（wave13-debt2）：bmesh.ops.bevel（华宝 bevelM>0 的柱/背板/压顶，和丰石狮）与
bpy.ops.mesh.primitive_uv_sphere（和丰/悦宾红灯笼、华宝宝顶球）的输出元素序随进程内存
布局漂移——三栋 colonnade 楼两次生成 GLB 字节不同（三角形集合相同、顺序不同）。修复后
bevel 路径与 sphere 走内容规范序重建，本测试取这 3 栋各跑两遍 Blender 断言逐字节相等。
"""
import hashlib
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(HERE)
KIT = os.path.join(AREA, 'modules', 'bazaar-tower-kit')
CASES = [
    ('params/huabao-bld-428202599.json', 'bld-428202599 华宝（colonnade+bevel+宝顶球）'),
    ('params/hefeng-bld-389701812.json', 'bld-389701812 和丰（colonnade+石狮 bevel+灯笼球）'),
    ('params/yuebin-bld-428202602.json', 'bld-428202602 悦宾（colonnade+灯笼球）'),
]

FAILS = []


def check(name, ok, detail=''):
    print('%s %s%s' % ('PASS' if ok else 'FAIL', name, ('：' + detail) if detail else ''))
    if not ok:
        FAILS.append(name)
    return ok


def build(params_rel, out):
    return subprocess.run(
        ['blender', '-b', '-t', '4', '--python-exit-code', '1',
         '-P', os.path.join(KIT, 'build_tower.py'),
         '--', '--params', params_rel, '--out', out],
        capture_output=True, text=True, cwd=AREA)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


tmp = tempfile.mkdtemp(prefix='btk-determinism-')
try:
    for params_rel, label in CASES:
        outs = [os.path.join(tmp, 'run%d' % i) for i in (1, 2)]
        shas = []
        for i, out in enumerate(outs):
            r = build(params_rel, out)
            glb = os.path.join(out, 'model.glb')
            if r.returncode != 0 or not os.path.isfile(glb) \
                    or 'BAZAAR_TOWER_BUILT' not in r.stdout:
                check('build_tower 跨进程确定性 %s（第 %d 次生成）' % (label, i + 1), False,
                      'rc=%d %s' % (r.returncode, (r.stdout + r.stderr).strip()[-200:]))
                shas = None
                break
            shas.append(sha256_file(glb))
        if shas is not None:
            check('build_tower 跨进程确定性 %s（连续两次生成 model.glb 逐字节相等）' % label,
                  shas[0] == shas[1], 'sha1=%s… sha2=%s…' % (shas[0][:12], shas[1][:12]))
        for out in outs:
            shutil.rmtree(out, ignore_errors=True)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if FAILS:
    print('build-tower-determinism-test：%d 项 FAIL' % len(FAILS))
    raise SystemExit(1)
print('build-tower-determinism-test：all green（3 栋 colonnade 楼 ×2 次生成逐字节相等）')
