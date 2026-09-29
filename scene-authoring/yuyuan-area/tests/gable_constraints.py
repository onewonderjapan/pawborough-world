#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-gable R1：山尖装饰冻结尺寸/比例约束（唯一来源，测试文件只许 import，不许另写数字）。

独立冻结的含义：这里的上下限**不读生成器、不读 records.json**。两个消费方：
  tests/gable-ornament-test.py  —— 应用到生成器设计值（records.json designValues）
  tests/gable-product-check.py  —— 应用到实际 GLB 测量值（判「输出符合输入」之外的「输入本身合理」，
                                   生成器参数与 records 同步越界时 GLB 实测照样红）

来源（R1 审查必修3，2026-09-29）：
  - 形制与视觉比例：湖心亭实拍 PBR-SH-0004-017.jpg（/home/baibai/outbox/
    pawborough-shanghai-reference-library-20260913/originals/，本地参考库已有，R0 未利用）——
    照片中博风板为窄条，宽度约为山面跨度的 10–20%；悬鱼（若有）长约为山尖高的 1/3–1/2。
    照片不能证明精确米制尺寸，故区间放宽为形制带；**所有米制尺寸仍标注未核实**。
  - 通用形制边界：悬鱼悬于山尖内，垂长不得超过山尖高；悬鱼宽长比按鱼形（近菱形）取 0.2–0.8。
"""

# 博风板宽 / 山花底跨度（实测山花三角底边）。实拍形制 0.10–0.20，放宽带。
BOFENG_W_PER_SPAN = (0.04, 0.30)
# 博风板宽 / 山尖高（ridgeZ−breakZ）。
BOFENG_W_PER_RISE = (0.05, 0.60)
# 悬鱼垂长 / 山尖高。实拍 ≈0.3–0.5，放宽带；上限 0.85 使「拉长到 1.2× 山尖高」必败。
XUANYU_L_PER_RISE = (0.15, 0.85)
# 悬鱼垂长不得超过山尖高（悬鱼悬在山尖三角形内）。
XUANYU_L_MAX_RISE = 1.0
# 悬鱼宽 / 悬鱼长（鱼形比例）。
XUANYU_W_PER_L = (0.20, 0.80)
# 悬鱼出平面厚（薄板读感）。
XUANYU_PROUD = (0.01, 0.08)
# 博风出平面厚。
BOFENG_PROUD = (0.02, 0.10)

NAMES = (
    ('bofengWidth/span', BOFENG_W_PER_SPAN),
    ('bofengWidth/rise', BOFENG_W_PER_RISE),
    ('xuanyuLen/rise', XUANYU_L_PER_RISE),
    ('xuanyuW/xuanyuLen', XUANYU_W_PER_L),
)


def ratio_ok(tag, value):
    """按名字取带判比例；tag 形如 'bofengWidth/span'。未知名字报错（防测试绕过冻结表）。"""
    for nm, (lo, hi) in NAMES:
        if nm == tag:
            return lo <= value <= hi, '%s=%s 不在冻结带 [%s, %s]' % (tag, round(value, 4), lo, hi)
    raise KeyError(tag)
