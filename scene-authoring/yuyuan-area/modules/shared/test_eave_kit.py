"""eave_kit 构件测试（纯 Python3，无 Blender）：python3 -X utf8 modules/shared/test_eave_kit.py

E1 面朝向：kit 在右手局部系 (u, v, h) 里出的每个网格，每个三角面的正面都朝外——瓦面朝上、檐底朝下、
檐口立面朝外、山花博风朝外、脊 / 戗脊 / 斗拱实体朝体外（判定见 eave_facing.py）。覆盖 kit 的全部出网格入口
（eave_skirt 标量 / 逐边序列 / 可调用 / 凹多边形 / 共线台阶 / 小亭起翘封顶 / 无檐底，xieshan_roof，zanjian_roof，
brackets）。另验检测本身不空转：同一批网格镜像后（不翻面）必须被判为反面。
E2 攒尖 n 边形（prm['sides']，n=4 逐字节同 E1）；另：新参数缺省时全部现有调用输出与 E1 逐字节相同（金值）。
E3 按角不起翘（noLift）+ 按边断开端头收口（endCaps）：朝向、断面封死（开口边只剩贴墙一圈）、端面位置、端部不起翘。
E4 封檐板材质键（boardMaterial）：缺省不变；给了只换 -board 的材质，其余逐字节不变。
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


# ---------------------------------------------------------------- E3 按角不起翘 + 端头收口 ----
def _plan_dist_to_poly(p, poly):
    best = 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t))
    return best


def _boundary_edges(meshes, q=1e-6):
    """焊接后只被一个三角用到的边（开口边）。"""
    cnt = {}
    for m in meshes:
        V = m['verts']
        for f in m['faces']:
            for a, b, c in [(f[0], f[k], f[k + 1]) for k in range(1, len(f) - 1)]:
                P = [tuple(round(x / q) for x in V[i]) for i in (a, b, c)]
                if len(set(P)) < 3:
                    continue
                for e in range(3):
                    k = tuple(sorted((P[e], P[(e + 1) % 3])))
                    cnt[k] = cnt.get(k, 0) + 1
    return [tuple(tuple(x * q for x in p) for p in k) for k, n in cnt.items() if n == 1]


class NoLiftEndCapTest(unittest.TestCase):
    RING = [(0, 0), (6, 0), (12, 0), (12, 7), (0, 7)]      # 南边在 (6,0) 分两段；东边 = 共享边

    def skirt(self, **kw):
        return {m['name']: m for m in capture(lambda: EK.eave_skirt('e', self.RING, 4.0, dict(PRM, **kw), 'p'))}

    def test_defaults_unchanged_when_keys_absent(self):
        a = capture(lambda: EK.eave_skirt('e', self.RING, 4.0, PRM, 'p'))
        b = capture(lambda: EK.eave_skirt('e', self.RING, 4.0, dict(PRM, noLift=None, endCaps=None), 'p'))
        self.assertEqual(digest(a), digest(b))

    def test_facing_with_caps_and_nolift(self):
        cases = [dict(endCaps=[2]), dict(endCaps=[1, 2]), dict(noLift=[3]), dict(noLift=lambda p: p[0] > 11, endCaps=[2]),
                 dict(endCaps=[True, False, True, False, False], over=[1.1, 0.6, 1.1, 1.1, 1.1])]
        for kw in cases:
            ms = list(self.skirt(**kw).values())
            res = EF.audit(ms)
            self.assertEqual((res['wrongTris'], res['unjudged'], res['conflicts'], res['unknownMeshes']), (0, 0, 0, []),
                             '%r %s' % (kw, EF.summary(res)))
        L = [(0, 0), (10, 0), (10, 4), (5, 4), (5, 8), (0, 8)]
        res = EF.audit(capture(lambda: EK.eave_skirt('l', list(reversed(L)), 4.0, dict(PRM, endCaps=[0], noLift=[2]), 'p')))
        self.assertEqual((res['wrongTris'], res['unjudged']), (0, 0), EF.summary(res))

    def test_end_cap_closes_section(self):
        """断开处端面把断面封死：瓦面 + 瓦头 + 封檐板 + 檐底 + 端面焊接后，开口边只剩贴墙的一圈（墙线上）。"""
        ms = self.skirt(endCaps=[2])
        self.assertIn('e-endcap', ms)
        open_edges = _boundary_edges(ms.values())
        self.assertTrue(open_edges)
        off = [e for e in open_edges if max(_plan_dist_to_poly(p, self.RING) for p in e) > 1e-6]
        self.assertEqual(off, [], '端头 / 檐口有不贴墙的开口边（方形截断没封死）')
        # 不加端头的同一断开：开口边离墙 → 说明本检测会失败
        no_cap = {k: v for k, v in ms.items() if k != 'e-endcap'}
        self.assertTrue([e for e in _boundary_edges(no_cap.values()) if max(_plan_dist_to_poly(p, self.RING) for p in e) > 1e-6])

    def test_end_cap_position_and_no_lift(self):
        """东边断开：南檐止于东墙线 x = 12 的竖面（不越共享边）、端部不起翘不出翘、外伸 = over；北檐同理。"""
        ms = self.skirt(endCaps=[2])
        allv = [p for m in ms.values() for p in m['verts']]
        self.assertLessEqual(max(p[0] for p in allv), 12.0 + 1e-9)
        cap = ms['e-endcap']['verts']
        self.assertTrue(all(abs(p[0] - 12.0) < 1e-9 for p in cap))
        lips = ms['e-tileend']['verts'][0::2]
        z_lip = 4.0 - PRM['drop']
        south_end = [p for p in lips if abs(p[0] - 12.0) < 1e-9 and p[1] < 0]
        north_end = [p for p in lips if abs(p[0] - 12.0) < 1e-9 and p[1] > 7]
        self.assertEqual(len(south_end), 1)
        self.assertEqual(len(north_end), 1)
        for p, y in ((south_end[0], -PRM['over']), (north_end[0], 7 + PRM['over'])):
            self.assertAlmostEqual(p[1], y, places=9)
            self.assertAlmostEqual(p[2], z_lip, places=9)
        # 西侧两个阳角照常起翘
        west = [p for p in lips if p[0] < 0]
        self.assertAlmostEqual(max(p[2] for p in west), z_lip + PRM['qiao'] * (0.28 * 6.0 / PRM['reach']) ** 0.5, places=9)

    def test_no_lift_corner(self):
        """noLift 的阳角：外缘 = 两边偏移线交点（斜接、无出翘），起翘 0；另三个角不受影响。"""
        base = self.skirt()
        nl = self.skirt(noLift=[3])                         # 顶点 3 = (12, 7)
        lips_b = base['e-tileend']['verts'][0::2]
        lips_n = nl['e-tileend']['verts'][0::2]
        z_lip = 4.0 - PRM['drop']
        c = [p for p in lips_n if abs(p[0] - (12 + PRM['over'])) < 1e-9 and abs(p[1] - (7 + PRM['over'])) < 1e-9]
        self.assertEqual(len(c), 1)
        self.assertAlmostEqual(c[0][2], z_lip, places=9)
        near = [p for p in lips_n if p[0] > 11 and p[1] > 6]
        self.assertTrue(all(abs(p[2] - z_lip) < 1e-9 for p in near))
        # 西南角（顶点 0）在两版里一样
        sw_b = sorted(p for p in lips_b if p[0] < 1 and p[1] < 1)
        sw_n = sorted(p for p in lips_n if p[0] < 1 and p[1] < 1)
        self.assertEqual([tuple(round(x, 9) for x in p) for p in sw_b], [tuple(round(x, 9) for x in p) for p in sw_n])

    def test_flag_specs_and_errors(self):
        a = self.skirt(endCaps=[2])
        b = self.skirt(endCaps=[False, False, True, False, False])
        c = self.skirt(endCaps=lambda p, q: p[0] == q[0] == 12)
        self.assertEqual(digest(list(a.values())), digest(list(b.values())))
        self.assertEqual(digest(list(a.values())), digest(list(c.values())))
        with self.assertRaises(ValueError):
            self.skirt(endCaps=[0, 1, 2, 3, 4])
        with self.assertRaises(ValueError):
            self.skirt(endCaps=[True, False])


# ---------------------------------------------------------------- E4 封檐板材质可配 ----
class BoardMaterialTest(unittest.TestCase):
    def calls(self, **kw):
        def run():
            EK.eave_skirt('sk', RECT, 4.0, dict(PRM, **kw), 'p')
            EK.eave_skirt('sk-cap', RECT, 4.0, dict(PRM, endCaps=[1], **kw), 'p')
            EK.xieshan_roof('xs', (0, 12, 0, 8), 5.0, dict(PRM, breakZ=6.0, ridgeZ=8.0, breakInset=2.0, gableInset=1.0, **kw), 'p')
            EK.zanjian_roof('zj', (0, 4, 0, 4), 5.0, 9.0, dict(PRM, **kw), 'p')
            EK.zanjian_roof('z8', (-3, 3, -3, 3), 5.0, 11.0, dict(PRM, sides=8, **kw), 'p')
        return capture(run)

    def test_default_is_wood_and_unchanged(self):
        self.assertEqual(digest(self.calls()), digest(self.calls(boardMaterial='wood')))
        self.assertEqual(digest(all_calls()), ALL_GOLDEN_E1)
        self.assertEqual({m['material'] for m in self.calls() if m['name'].endswith('-board')}, {'wood'})

    def test_board_material_key(self):
        a, b = self.calls(), self.calls(boardMaterial='lacquer-red')
        self.assertEqual(len(a), len(b))
        boards = 0
        for ma, mb in zip(a, b):
            self.assertEqual((ma['name'], ma['items'], ma['faces'], ma['part']), (mb['name'], mb['items'], mb['faces'], mb['part']))
            if ma['name'].endswith('-board'):
                boards += 1
                self.assertEqual((ma['material'], mb['material']), ('wood', 'lacquer-red'))
            else:
                self.assertEqual(ma['material'], mb['material'], ma['name'])      # 博风板 / 斗拱等其余件不跟着变
        self.assertEqual(boards, 5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
