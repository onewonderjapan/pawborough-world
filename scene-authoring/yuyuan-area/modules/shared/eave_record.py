"""eave_record.py — Blender 预载钩子：记录一次使用者构建里 eave_kit 出的每个网格（面朝向审计 / 回归对照用）。

eave_kit 只通过 init() 注入的 add_local 出网格；本钩子把 init 包一层：每次 kit 调 add_local 前后比对
bpy.data.objects，抓出使用者为这次调用新建的对象，按 matrix_world 取 Blender 世界坐标的顶点与面（即使用者
自己的局部系换算、翻面之后、导出之前的最终几何），另记 kit 局部原始输出（items / faces）的 sha256。
退出时写 JSON（EAVE_RECORD_OUT），供 eave_audit.py 做朝向审计、与 GLB 对照、前后逐字节比对。

用法（不改使用者脚本；两个 -P 顺序执行，同一解释器共享 sys.modules）：
  EAVE_RECORD_OUT=<json> blender -b -t 4 --python-exit-code 1 -P modules/shared/eave_record.py \
      -P modules/huxinting/build.py -- <使用者参数>
"""
import atexit
import hashlib
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eave_kit                                            # noqa: E402  与使用者 import 的是同一个模块对象

OUT = os.environ.get('EAVE_RECORD_OUT')
RECORDS = []
_H = hashlib.sha256()
_orig_init = eave_kit.init


def _local_digest(name, items, faces, material, part):
    s = repr((name, [(tuple(p), tuple(uv)) for p, uv in items], [tuple(f) for f in faces], material, part))
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def _init(add_local):
    def rec(name, items, faces, material, part):
        before = {o.as_pointer() for o in bpy.data.objects}
        r = add_local(name, items, faces, material, part)
        dg = _local_digest(name, items, faces, material, part)
        _H.update(dg.encode('ascii'))
        objs = []
        for o in bpy.data.objects:
            if o.as_pointer() in before or o.type != 'MESH':
                continue
            M = o.matrix_world
            me = o.data
            objs.append(dict(object=o.name, verts=[tuple(round(c, 6) for c in (M @ v.co)) for v in me.vertices],
                             faces=[tuple(p.vertices) for p in me.polygons], det=round(M.to_3x3().determinant(), 6)))
        RECORDS.append(dict(name=name, material=material, part=part, localSha256=dg, nItems=len(items),
                            nFaces=len(faces), objects=objs))
        return r
    return _orig_init(rec)


eave_kit.init = _init


def _dump():
    if not OUT:
        return
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(dict(script=sys.argv, calls=len(RECORDS), localSha256=_H.hexdigest(), records=RECORDS), f,
                  ensure_ascii=False)
    print('EAVE_RECORD', OUT, 'calls', len(RECORDS), 'localSha256', _H.hexdigest())


atexit.register(_dump)
