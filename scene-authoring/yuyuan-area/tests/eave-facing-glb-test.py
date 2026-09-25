"""eave_kit 面朝向——产物（GLB）级检测（wave6-eavekit E1）。纯 Python3。

运行时 web/main.js 对无贴图材质强制 FrontSide（背面剔除），eave_kit 出的面朝反了从外面看就是透的。
判定口径同 modules/shared/eave_facing.py（瓦面朝上、檐底朝下、檐口立面朝外、山花博风朝外、脊 / 戗脊 / 斗拱朝体外），
这里读使用者导出的 GLB（glTF 逆时针为正面、Y 向上），不读任何模块自报数字：
  1) 湖心亭 OUT_DIR/huxin-ting.glb：节点名保留 kit 网格名（huxin-ting__<kit 调用名>-<后缀>），逐网格全角色审计；
  2) 厅堂套件 out-garden-kits/hallkit-<id>/model.glb：hall-bracket__* 节点只装 eave_kit.brackets 的斗拱块，
     按焊接连通分量拆成一个个闭合块，逐块射线奇偶判朝体外。
商城楼套件把 kit 网格与自有网格按 (part, 材质) 合并，GLB 里认不出 kit 面：其逐面审计走
modules/shared/eave_record.py + eave_audit.py（Blender 重跑构建、按位置回到 GLB 逐面对照），见工单 artifacts。

用法：OUT_DIR=out-zone python3 -X utf8 tests/eave-facing-glb-test.py   （HUXINTING=0 / HALL_KIT=0 时跳过对应段）
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(ROOT, 'modules', 'shared'))
import eave_facing as EF                                   # noqa: E402
import eave_audit as EA                                    # noqa: E402

OUT = os.path.join(ROOT, os.environ.get('OUT_DIR', 'out-zone'))
HX_GLB = os.environ.get('HUXINTING_GLB') or os.path.join(OUT, 'huxin-ting.glb')
HALL_DIR = os.environ.get('HALL_KIT_OUT') or os.path.join(ROOT, 'out-garden-kits')
# 湖心亭 build.py 调 eave_kit 用的名字（eave_skirt towerskirt<i> / zanjian_roof towerroof / xieshan_roof mainroof, porchroof）；
# <瓦面名>-wa 是湖心亭自己铺的瓦垄（不是 kit 出的网格），排除
HX_KIT = re.compile(r'^huxin-ting__((towerskirt\d+|towerroof|mainroof|porchroof)-(?!.*-wa$).+)$')

npass = nfail = nskip = 0
failures = []


def ok(name, cond, detail=''):
    global npass, nfail
    if cond:
        npass += 1
        print('PASS', name)
    else:
        nfail += 1
        failures.append('%s: %s' % (name, detail))
        print('FAIL', name, detail)


def skip(name, why):
    global nskip
    nskip += 1
    print('SKIP', name, '-', why)


def components(V, T, q=1e-4):
    """按位置焊接后的三角连通分量 → [(verts, tris)]。"""
    key = [(round(v[0] / q), round(v[1] / q), round(v[2] / q)) for v in V]
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for t in T:
        r0 = find(key[t[0]])
        for i in t[1:]:
            r = find(key[i])
            if r != r0:
                parent[r] = r0
    groups = {}
    for t in T:
        groups.setdefault(find(key[t[0]]), []).append(t)
    return [(V, ts) for ts in groups.values()]


# ---------------- 1) 湖心亭 ----------------
if os.environ.get('HUXINTING') == '0':
    skip('huxinting eave_kit facing', 'HUXINTING=0')
elif not os.path.exists(HX_GLB):
    ok('huxinting GLB exists', False, HX_GLB)
else:
    ms = []
    for nm, V, T in EA.glb_triangles(HX_GLB):
        m = HX_KIT.match(nm or '')
        if m:
            ms.append(dict(name=m.group(1), verts=V, faces=T))
    res = EF.audit(ms, up=(0, 1, 0))
    print('  huxinting', EF.summary(res))
    ok('huxinting: kit meshes found (%d)' % len(ms), len(ms) >= 20)
    ok('huxinting: every kit mesh has a facing role', not res['unknownMeshes'], res['unknownMeshes'][:5])
    ok('huxinting: every kit triangle judged (unjudged %d, conflicts %d)' % (res['unjudged'], res['conflicts']),
       res['unjudged'] == 0 and res['conflicts'] == 0)
    for role in ('surface', 'soffit', 'fascia', 'gable', 'solid'):
        rb = res['byRole'].get(role, dict(tris=0, wrong=0))
        ok('huxinting: %s faces outward (%d wrong of %d)' % (role, rb['wrong'], rb['tris']), rb['tris'] > 0 and rb['wrong'] == 0)

# ---------------- 2) 厅堂套件斗拱 ----------------
if os.environ.get('HALL_KIT') == '0':
    skip('hall-kit bracket facing', 'HALL_KIT=0')
else:
    ids = json.load(open(os.path.join(ROOT, 'modules', 'hall-kit', 'ids.json'), encoding='utf-8'))['ids']
    total = wrong = blocks = missing = 0
    bad = []
    for hid in ids:
        glb = os.path.join(HALL_DIR, 'hallkit-' + hid, 'model.glb')
        if not os.path.exists(glb):
            missing += 1
            continue
        ms = []
        for nm, V, T in EA.glb_triangles(glb):
            if (nm or '').startswith('hall-bracket__'):
                for i, (VV, TT) in enumerate(components(V, T)):
                    ms.append(dict(name='hall-bracket-%d-0' % (len(ms)), verts=VV, faces=TT))
        res = EF.audit(ms, up=(0, 1, 0))
        blocks += len(ms)
        total += res['tris']
        wrong += res['wrongTris']
        if res['wrongTris']:
            bad.append('%s %d' % (hid, res['wrongTris']))
    ok('hall-kit: all %d GLBs present' % len(ids), missing == 0, '%d missing under %s' % (missing, HALL_DIR))
    ok('hall-kit: bracket blocks face outward (%d wrong of %d tris, %d blocks)' % (wrong, total, blocks),
       blocks > 0 and wrong == 0, ', '.join(bad[:8]))

print('RESULT pass=%d fail=%d skipped=%d' % (npass, nfail, nskip))
if nfail:
    print('FAILURES:', ' | '.join(failures))
    sys.exit(1)
