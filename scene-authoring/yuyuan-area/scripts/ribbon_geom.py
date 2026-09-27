# wave10-streetfix R3（审查必修3）：ribbon 路面几何的唯一权威实现，渲染端复算（repair-layout.py）
# 与测试（road-footprint-clearance-test.py / ribbon-parity-test.py）共用。
# 口径 = src/lib.mjs 的 ribbon()：每个折点用中心差分方向（pts[max(0,i-1)]→pts[min(n-1,i+1)]）
# 求法线，左右各偏移 width/2；每段画两个三角形（索引 a,b,a+1 / b,b+1,a+1）。
# R2 版把左右边串成一个外环再 buffer(0)：急弯/自交（bowtie）时丢掉实际渲染的区域
# （road-1064398308 外环法 4707.79 m² vs 渲染端三角形并集 4713.57 m²）。改为逐段构造两个
# 三角形取并集，与渲染端逐三角一致。
import math
from shapely.geometry import Polygon
from shapely.ops import unary_union


def ribbon_offset_points(pts, width):
    """ribbon() 的顶点表（左右两列，2n 个），与 lib.mjs pos 数组逐点对应。"""
    n = len(pts)
    left, right = [], []
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1
        nx, nz = -dz / L * width / 2, dx / L * width / 2
        left.append((pts[i][0] + nx, pts[i][1] + nz))
        right.append((pts[i][0] - nx, pts[i][1] - nz))
    return left, right


def ribbon_triangles(pts, width):
    """按 lib.mjs 索引 (2i,2i+2,2i+1)/(2i+2,2i+3,2i+1) 逐段构造两个三角形。
    返回 Polygon 列表（零面积三角形跳过——并集面积不受影响）。"""
    left, right = ribbon_offset_points(pts, width)
    tris = []
    for i in range(len(pts) - 1):
        for ring in ((left[i], left[i + 1], right[i]), (left[i + 1], right[i + 1], right[i])):
            t = Polygon(ring)
            if t.area > 0:
                if not t.is_valid:
                    t = t.buffer(0)
                tris.append(t)
    return tris


def ribbon_polygon(pts, width):
    """渲染端实际画出的路面区域 = 三角形并集（可返回 MultiPolygon）。"""
    return unary_union(ribbon_triangles(pts, width))
