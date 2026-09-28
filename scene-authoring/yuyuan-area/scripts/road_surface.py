"""wave10-streetfix R4（审查必修1）：道路路面取面的共用实现。

契约与 src/build-scene.mjs road 分支（R3 必修2 修订版）逐字一致：
  surfaceFootprints 字段存在即权威 —— 空数组 = 该路空几何（不渲染 / 不可行走），
  绝不回退旧单块字段 surfaceFootprint 或 polyline 折线；仅当该字段不存在时才走旧回退链。

消费方（scripts/check-commercial-route.py、modules/bazaar-tower-kit/test_street_band.py、
tests/road-footprint-clearance-test.py）一律 import 本模块取面，不许各写一份 `or` 回退
（Python 空列表是假值，`get('surfaceFootprints') or ...` 会把「空数组=空几何」偷换成「回退旧面」，
这是第 3 轮审查抓到的假证据根源；JS 端同理用 Array.isArray 判定）。
字段类型检查（wave12-debt D6，与 src/build-scene.mjs road 分支对齐；R1 必修1 补完）：surfaceFootprints /
surfaceFootprint 存在但不是数组（含显式 null）= 数据损坏，直接抛错——不许静默回退（JS 端 Array.isArray 会把
非数组当「字段不存在」吞掉，Python 端键存在判断会把字符串当权威值，两端对非数组的处理必须都显式：
要么合法数组、要么报错，没有第三种静默路径）。类型检查先于取面优先级、同时覆盖两个字段——合法
surfaceFootprints=[] 不得遮蔽已损坏的 surfaceFootprint（R1 前旧实现 E2 {"surfaceFootprints": [],
"surfaceFootprint": "oops"} 提前返回 []、E1 {"surfaceFootprint": null} 走 get→None 回退，均与 JS 分歧，
tests/road-surface-contract-test.mjs 两端契约锁定）。
"""
from shapely.geometry import LineString, Polygon

NO_SURFACE = []          # 权威空几何：调用方视为该路没有面
NO_AUTHORITY = None      # 字段不存在：调用方可走 polyline ribbon 旧回退


def road_surface_footprints(g):
    """按契约解析路面字段，返回环列表（每环 = [[x,z],...]) 或 NO_AUTHORITY。

    类型检查（R1 必修1，与 JS 端 build-scene.mjs 逐字一致）先于取面优先级、同时覆盖两个字段：
    surfaceFootprints / surfaceFootprint 键存在但不是数组（含显式 null）→ 抛错，随后才是——
      - geometry 里存在 surfaceFootprints（键存在即权威，值原样返回，[] = 空几何）；
      - 否则存在旧单块 surfaceFootprint → [单块环]；
      - 否则 NO_AUTHORITY（调用方可按 polyline ribbon 回退）。
    """
    for fld in ('surfaceFootprints', 'surfaceFootprint'):
        if fld in g and not isinstance(g[fld], list):
            raise SystemExit(f'road {fld} 存在但不是数组（{type(g[fld]).__name__}），数据损坏，拒绝静默回退')
    if 'surfaceFootprints' in g:
        return g['surfaceFootprints']
    legacy = g.get('surfaceFootprint')
    if legacy:                      # 空列表保持旧口径：视为无旧单块字段，走 ribbon 回退
        return [legacy]
    return NO_AUTHORITY


def road_surface_polys(g):
    """消费方口径的路面多边形（shapely，已 buffer(0) 修复）；权威空数组 → 空列表。

    字段不存在时按折线 buffer(width/2, cap_style=2, join_style=2) 回退 —— 与
    check-commercial-route.py / test_street_band.py 的旧折线口径一致。
    """
    fps = road_surface_footprints(g)
    if fps is not None:
        return [Polygon(f).buffer(0) for f in fps]
    pl = g.get('polyline')
    if pl and len(pl) > 1:
        return [LineString(pl).buffer(g.get('width', 2.0) / 2, cap_style=2, join_style=2)]
    return NO_SURFACE
