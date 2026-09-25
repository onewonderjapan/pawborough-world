"""eave_kit 构件测试（纯 Python3，无 Blender）：python3 -X utf8 modules/shared/test_eave_kit.py

E1 面朝向：kit 在右手局部系 (u, v, h) 里出的每个网格，每个三角面的正面都朝外——瓦面朝上、檐底朝下、
檐口立面朝外、山花博风朝外、脊 / 戗脊 / 斗拱实体朝体外（判定见 eave_facing.py）。覆盖 kit 的全部出网格入口
（eave_skirt 标量 / 逐边序列 / 可调用 / 凹多边形 / 共线台阶 / 小亭起翘封顶 / 无檐底，xieshan_roof，zanjian_roof，
brackets）。另验检测本身不空转：同一批网格镜像后（不翻面）必须被判为反面。
"""
import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eave_kit as EK                                      # noqa: E402
import eave_facing as EF                                   # noqa: E402

PRM = dict(over=1.1, chu=0.3, qiao=0.8, reach=2.0, drop=0.3, tileH=0.12, boardH=0.2, soffitRise=0.15)
RECT = [(0, 0), (10, 0), (10, 6), (0, 6)]
L_SHAPE = [(0, 0), (10, 0), (10, 4), (5, 4), (5, 8), (0, 8)]
CW_RECT = list(reversed(RECT))


def capture(fn):
    """在录制注入口下跑 fn()，返回 [dict(name, verts, faces, material, part, items)]。"""
    out = []
    EK.init(lambda n, it, f, m, part: out.append(dict(name=n, verts=[tuple(p) for p, _ in it], faces=[tuple(x) for x in f],
                                                      material=m, part=part, items=it)))
    fn()
    return out


def digest(meshes):
    h = hashlib.sha256()
    for m in meshes:
        h.update(repr((m['name'], [(tuple(p), tuple(uv)) for p, uv in m['items']], m['faces'], m['material'],
                       m['part'])).encode('utf-8'))
    return h.hexdigest()


def all_calls():
    def run():
        EK.eave_skirt('sk-rect', RECT, 4.0, PRM, 'p')
        EK.eave_skirt('sk-cw', CW_RECT, 4.0, PRM, 'p')
        EK.eave_skirt('sk-l', L_SHAPE, 4.0, PRM, 'p')
        EK.eave_skirt('sk-small', [(0, 0), (3.2, 0), (3.2, 3.2), (0, 3.2)], 3.0, PRM, 'p')
        EK.eave_skirt('sk-nosoffit', RECT, 4.0, PRM, 'p', with_soffit=False)
        EK.eave_skirt('sk-rings', RECT, 4.0, dict(PRM, curve=1.3), 'p', root_rise=0.4, top_rings=4)
        EK.eave_skirt('sk-seq', RECT, 4.0, dict(PRM, over=[1.1, 0.0, 1.1, 0.5]), 'p')
        EK.eave_skirt('sk-step', [(0, 0), (5, 0), (10, 0), (10, 6), (0, 6), (0, 3)], 4.0,
                      dict(PRM, over=[1.1, 0.4, 1.1, 1.1, 1.1, 0.0]), 'p')
        EK.eave_skirt('sk-call', L_SHAPE, 4.0, dict(PRM, over=lambda a, b: 0.3 if a[0] == b[0] == 5 else 1.0), 'p')
        EK.xieshan_roof('xs', (0, 12, 0, 8), 5.0, dict(PRM, breakZ=6.0, ridgeZ=8.0, breakInset=2.0, gableInset=1.0), 'p')
        EK.xieshan_roof('xs-small', (-2, 2, -1.6, 1.6), 3.5, dict(PRM, breakZ=4.2, ridgeZ=5.2, breakInset=0.8, gableInset=0.4,
                                                                  ornamentScale='auto'), 'p')
        EK.zanjian_roof('zj', (0, 4, 0, 4), 5.0, 9.0, PRM, 'p')
        EK.zanjian_roof('zj-big', (-3, 3, -3, 3), 5.0, 11.0, dict(PRM, rings=8, curve=1.3), 'p')
        EK.brackets('bk', [(1, 0, 0, -1), (10, 3, 1, 0), (4, 6, 0, 1), (0, 2, -1, 0), (0.5, 0.5, -0.7071, -0.7071)], 4.0, 'p')
    return capture(run)


class FacingTest(unittest.TestCase):
    def test_every_mesh_classified(self):
        ms = all_calls()
        unknown = [m['name'] for m in ms if EF.classify(m['name'])[0] is None]
        self.assertEqual(unknown, [], 'eave_kit 出了检测不认得的网格名（新构件要在 eave_facing._ROLES 里登记角色）')

    def test_all_faces_outward(self):
        res = EF.audit(all_calls(), up=(0, 0, 1))
        print('\n  E1 facing:', EF.summary(res))
        self.assertEqual(res['unknownMeshes'], [])
        self.assertEqual(res['unjudged'], 0, 'faces the detector could not judge')
        self.assertEqual(res['conflicts'], 0, 'inconsistent winding cycles')
        self.assertEqual(res['wrongTris'], 0, EF.summary(res))

    def test_detector_not_vacuous(self):
        """镜像（v -> -v，不翻面）后同一批网格必须每个三角都判反，证明检测会失败、不空转。"""
        ms = all_calls()
        mir = [dict(name=m['name'], verts=[(p[0], -p[1], p[2]) for p in m['verts']], faces=m['faces']) for m in ms]
        a, b = EF.audit(ms), EF.audit(mir)
        self.assertEqual(b['tris'], a['tris'])
        self.assertEqual(b['wrongTris'], a['tris'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
