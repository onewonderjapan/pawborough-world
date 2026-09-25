"""eave_kit 构件测试（纯 Python3，无 Blender）：python3 -X utf8 modules/shared/test_eave_kit.py

E1 面朝向：kit 在右手局部系 (u, v, h) 里出的每个网格，每个三角面的正面都朝外——瓦面朝上、檐底朝下、
檐口立面朝外、山花博风朝外、脊 / 戗脊 / 斗拱实体朝体外（判定见 eave_facing.py）。覆盖 kit 的全部出网格入口
（eave_skirt 标量 / 逐边序列 / 可调用 / 凹多边形 / 共线台阶 / 小亭起翘封顶 / 无檐底，xieshan_roof，zanjian_roof，
brackets）。另验检测本身不空转：同一批网格镜像后（不翻面）必须被判为反面。
E2 攒尖 n 边形（prm['sides']，n=4 逐字节同 E1）；另：新参数缺省时全部现有调用输出与 E1 逐字节相同（金值）。
"""
import hashlib
import math
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


# E1 提交时 kit 在 all_calls() 上的输出 sha256：E2–E4 的新参数缺省时，现有调用的输出必须逐字节不变
ALL_GOLDEN_E1 = '20d4c1b2adab4d5aa46557bbc3d25838d0fc7408df2a60e49644317b5e993004'


class DefaultsUnchangedTest(unittest.TestCase):
    def test_default_outputs_byte_identical_to_e1(self):
        self.assertEqual(digest(all_calls()), ALL_GOLDEN_E1)


# ---------------------------------------------------------------- E2 八角攒尖 ----
# 金值：E1 提交时 kit 在这些调用上的输出（名字 + 顶点 + UV + 面 + 材质 + part）的 sha256；E2 之后方形攒尖（缺省 / sides=4）必须逐字节相同
ZJ_CALLS = (('zj', (0, 4, 0, 4), 5.0, 9.0, {}), ('zj-big', (-3, 3, -3, 3), 5.0, 11.0, dict(rings=8, curve=1.3)),
            ('zj-rect', (0, 5, 0, 3.5), 4.0, 8.0, {}))
ZJ_GOLDEN_E1 = 'ca574d76fe987feba8355277917ba9fdeb2d7fb8f720bab4bfdffe6267d4bf24'


def zanjian_calls(extra=None):
    def run():
        for nm, rect, ze, ap, p in ZJ_CALLS:
            EK.zanjian_roof(nm, rect, ze, ap, dict(PRM, **p, **(extra or {})), 'p')
    return capture(run)


class ZanjianNgonTest(unittest.TestCase):
    def test_square_default_byte_identical(self):
        self.assertEqual(digest(zanjian_calls()), ZJ_GOLDEN_E1)
        self.assertEqual(digest(zanjian_calls(dict(sides=4))), ZJ_GOLDEN_E1)

    def test_ngon_path_reduces_to_square(self):
        """n 边形通路在 n=4、正方形 rect 上与方形代码逐点一致（≤1e-9），证明推广口径同方形。"""
        a = capture(lambda: EK.zanjian_roof('z', (-3, 3, -3, 3), 5.0, 11.0, PRM, 'p'))
        b = capture(lambda: EK._zanjian_ngon('z', (-3, 3, -3, 3), 5.0, 11.0, PRM, 'p', 4))
        self.assertEqual([(m['name'], m['faces'], m['material']) for m in a], [(m['name'], m['faces'], m['material']) for m in b])
        d = max(abs(x - y) for ma, mb in zip(a, b) for p, q in zip(ma['verts'], mb['verts']) for x, y in zip(p, q))
        self.assertLess(d, 1e-9)

    def octagon(self, **kw):
        return capture(lambda: EK.zanjian_roof('z8', (-3, 3, -3, 3), 5.0, 11.0, dict(PRM, sides=8, **kw), 'p'))

    def test_octagon_facing(self):
        for n in (3, 5, 6, 8, 12):
            res = EF.audit(capture(lambda: EK.zanjian_roof('zn', (-3, 3, -2.5, 2.5), 5.0, 10.0, dict(PRM, sides=n), 'p')))
            self.assertEqual((res['wrongTris'], res['unjudged'], res['unknownMeshes']), (0, 0, []), 'n=%d %s' % (n, EF.summary(res)))

    def test_octagon_geometry(self):
        ms = {m['name']: m for m in self.octagon()}
        self.assertEqual(sorted(ms), ['z8-board', 'z8-cone', 'z8-soffit', 'z8-tileend'])
        cone = ms['z8-cone']['verts']
        # 宝顶：最后一环收到中心、标高 = apex
        apex = [p for p in cone if abs(p[2] - 11.0) < 1e-9]
        self.assertTrue(apex and all(math.hypot(p[0], p[1]) < 1e-9 for p in apex))
        # 墙身 = 边心距 3 的正八边形（檐底内圈），檐口环边心距 = 3 + over（边中点无起翘 / 出翘）
        sof = ms['z8-soffit']['verts']
        inner = sof[1::2]
        R = 3.0 / math.cos(math.pi / 8)
        for p in inner:
            ang = math.atan2(p[1], p[0]) - (-math.pi / 2 - math.pi / 8)
            # 八边形上的点：到中心的距离 = 边心距 / cos(与所在边法线夹角)
            phi = (ang % (math.pi / 4)) - math.pi / 8
            self.assertAlmostEqual(math.hypot(p[0], p[1]), 3.0 / math.cos(phi), places=9)
        corners = [p for p in inner if abs(math.hypot(p[0], p[1]) - R) < 1e-9]
        self.assertEqual(len(corners), 8)
        # 8 重旋转对称：檐口外缘顶点集合绕中心转 45° 映回自身
        lip = [p for p in ms['z8-tileend']['verts'][0::2]]
        key = lambda p: (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        S = {key(p) for p in lip}
        c, s = math.cos(math.pi / 4), math.sin(math.pi / 4)
        self.assertEqual({key((c * p[0] - s * p[1], s * p[0] + c * p[1], p[2])) for p in lip}, S)
        # 八个翼角：外缘最高点在 8 个角点径向上，起翘 = qiao（檐口外缘 z - drop + qiao），出翘沿径向 chu / cos(π/8)
        top = max(p[2] for p in lip)
        side = 2 * (3.0 + PRM['over']) * math.tan(math.pi / 8)          # 起翘范围按檐口环边长封顶（同 eave_path 规则）
        qiao = PRM['qiao'] * min(1.0, 0.28 * side / PRM['reach']) ** 0.5
        self.assertLess(qiao, PRM['qiao'])
        self.assertAlmostEqual(top, 5.0 - PRM['drop'] + qiao, places=9)
        tips = [p for p in lip if abs(p[2] - top) < 1e-9]
        self.assertEqual(len(tips), 8)
        for p in tips:
            self.assertAlmostEqual(math.hypot(p[0], p[1]), (3.0 + PRM['over']) / math.cos(math.pi / 8) + PRM['chu'] / math.cos(math.pi / 8), places=9)
        # 边中点：起翘核已归零（reach 封顶 < 半边长），外缘不起翘、外伸 = over（边心距 3 + over）
        mids = [p for p in lip if abs(p[2] - (5.0 - PRM['drop'])) < 1e-9]
        self.assertEqual(len(mids), 8)
        for p in mids:
            self.assertAlmostEqual(math.hypot(p[0], p[1]), 3.0 + PRM['over'], places=9)

    def test_rotation_and_bad_sides(self):
        a = self.octagon()
        b = self.octagon(rotDeg=45.0)
        self.assertNotEqual(digest(a), digest(b))
        with self.assertRaises(ValueError):
            capture(lambda: EK.zanjian_roof('z2', (-1, 1, -1, 1), 3.0, 5.0, dict(PRM, sides=2), 'p'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
