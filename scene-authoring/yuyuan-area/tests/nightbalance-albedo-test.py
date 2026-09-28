#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave13-nightbalance N1：夜景偏亮表面的反照率契约（独立参考区间，不拿产物互比）。

背景（wave13-nightqa 巡检 #10/#15 + pv06 raycast 取证）：园林全局地面、外围 L0 体块墙色、
商城楼套件歇山山花板在 dusk/night 读作「雪原」。本测试把「合理反照率」写成契约，期望值全部
来自工单给定/公开的参考区间（线性反照率）：
  - 裸土 / 夯土 / 园土（园林全局地面）：0.15–0.35（干土上限≈0.30–0.35，湿土下限≈0.08–0.15，未核实到单一权威出处，
    采用工单口径「石板、青砖约 0.15–0.35」同档的土壤常见值）
  - 白抹灰 / 灰浆墙（L0 图集 plaster 色调）：0.30–0.60，取 ≤0.60 为上限（白抹灰参考区间 0.6–0.8 的下缘：
    老城厢民居以风化灰浆墙为主，不允许全城贴着最白端；三穗堂白墙等真实白抹灰构件不受本条约束）
  - 清水青砖（图集 greybrick 砖体）：0.15–0.35
  - 程序化铺装贴图：asphalt ≤0.20、grey-brick / blue-stone / fine-cobble ∈ 0.15–0.35、pebble ≤0.35
  - 歇山山花板（商城楼套件）：与博风板同为深红木（btk-wood），不允许落在 btk-wall（白抹灰）上——
    nightqa #10 取证：天裕楼北坡「亮坡」= roof-main__wall.001（btk-wall.001）。
断言对象（都是生成源 / 登记输入件，不是渲染产物）：
  A. src/build-scene.mjs case 'ground' 的地面色（全局地面，唯一 material，几何 -800..1200 × -430..370）
  B. modules/outer-kit/bake_atlas.py 的 TONE_PLASTER / BRICK 调色板（L0 体块图集唯一上色源）
  C. resources/textures/paving/*.jpg 的线性平均（PIL 直接解码重算）
  D. out-bazaar-towers/*/model.glb 的 mesh 名（part__material 合并命名）：山花板并入 *_roof*__wood*，不得是 *_roof*__wall*
用法：python3 -X utf8 tests/nightbalance-albedo-test.py
"""
import glob
import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []
passes = []


def ok(cond, msg):
    (passes if cond else fails).append(msg)
    print(('PASS' if cond else 'FAIL'), msg)


def srgb_to_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = int(h, 16)
    return (srgb_to_lin((h >> 16) & 255), srgb_to_lin((h >> 8) & 255), srgb_to_lin(h & 255))


# ---------- A. 全局地面色 ----------
src = open(os.path.join(ROOT, 'src', 'build-scene.mjs'), encoding='utf-8').read()
m = re.search(r"case 'ground': \{.*?MeshStandardMaterial\(\{ color: 0x([0-9a-fA-F]{6})", src, re.S)
ok(m, 'A0 build-scene.mjs 找得到 case \'ground\' 材质色')
if m:
    lin = hex_lin(m.group(1))
    avg = sum(lin) / 3
    ok(0.15 <= avg <= 0.35, f'A1 全局地面线性反照率 {avg:.3f} ∈ [0.15,0.35]（裸土/夯土区间）, rgb={m.group(1)}')

# ---------- B. L0 图集调色板 ----------
ba = open(os.path.join(ROOT, 'modules', 'outer-kit', 'bake_atlas.py'), encoding='utf-8').read()
mt = re.search(r'TONE_PLASTER = \{(.*?)\}', ba, re.S)
ok(mt, 'B0 bake_atlas.py 找得到 TONE_PLASTER')
if mt:
    body = mt.group(1)
    tones = dict(re.findall(r"'(\w+)':\s*\{([^}]*)\}", body))
    plaster_vals = []
    for tone, kv in tones.items():
        vals = [int(v, 16) for v in re.findall(r'0x([0-9a-fA-F]{6})', kv)]
        lins = [sum(hex_lin(f'{v:06x}')) / 3 for v in vals]
        plaster_vals += lins
        worst = max(lins)
        ok(worst <= 0.60, f'B1 抹灰墙色 {tone} 最亮端线性反照率 {worst:.3f} ≤ 0.60（白抹灰 0.6–0.8 下缘，风化灰浆）')
    mb = re.search(r"BRICK = \{([^}]*)\}", ba)
    ok(mb, 'B2 bake_atlas.py 找得到 BRICK')
    if mb:
        bx = dict(re.findall(r"'(\w+)':\s*0x([0-9a-fA-F]{6})", mb.group(1)))
        brick_lin = sum(hex_lin(bx['brick'])) / 3
        ok(0.15 <= brick_lin <= 0.35, f'B3 清水砖体线性反照率 {brick_lin:.3f} ∈ [0.15,0.35]')

# ---------- C. 铺装贴图线性平均 ----------
try:
    from PIL import Image
    import numpy as np
    RANGES = {'paving-asphalt': (0.0, 0.20), 'paving-grey-brick': (0.15, 0.35),
              'paving-blue-stone': (0.15, 0.35), 'paving-fine-cobble': (0.15, 0.35), 'paving-pebble': (0.15, 0.35)}
    for slot, (lo, hi) in RANGES.items():
        p = os.path.join(ROOT, 'resources', 'textures', 'paving', slot + '.jpg')
        ok(os.path.exists(p), f'C0 {slot} 贴图存在')
        if not os.path.exists(p):
            continue
        a = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32) / 255.0
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).mean()
        ok(lo <= lin <= hi, f'C1 {slot} 线性平均 {float(lin):.3f} ∈ [{lo},{hi}]')
    # 烘图哨兵（wave13-nightbalance：首版逐通道未拆包 ×0.88 时图集中部条带整体串色成品红/绿，
    # 平均反照率却落在正常区间——平均值查不出这种坏图，用饱和像素占比查）。
    ap = os.path.join(ROOT, 'resources', 'textures', 'outer-kit', 'outerkit-atlas-v2.jpg')
    ok(os.path.exists(ap), 'C2 outerkit-atlas-v2 存在')
    if os.path.exists(ap):
        a = np.asarray(Image.open(ap).convert('RGB'), dtype=np.float32) / 255.0
        garbage = float((a.max(axis=2) - a.min(axis=2) > 0.6).mean())
        ok(garbage == 0.0, f'C3 图集无串色坏带（饱和像素占比 {garbage:.4f} = 0）')
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).mean()
        ok(lin <= 0.365, f'C4 图集整体线性平均 {float(lin):.3f} ≤ 0.365（基线值，N1 压暗后 ~0.30）')
except ImportError:
    print('SKIP C（无 PIL/numpy）')

# ---------- D. 塔楼歇山山花板 ----------
for p in sorted(glob.glob(os.path.join(ROOT, 'out-bazaar-towers', '*', 'model.glb'))):
    b = open(p, 'rb').read()
    jl = int.from_bytes(b[12:16], 'little')
    j = json.loads(b[20:20 + jl])
    bad = [n.get('name') for n in j.get('nodes', [])
           if re.match(r'.*(roof-main|pav-roof|roof-annex)__wall(\.\d+)?$', n.get('name', ''))]
    tid = p.split(os.sep)[-2]
    ok(not bad, f'D1 {tid}: 山花板不落在白抹灰（roof-main/pav-roof/roof-annex__wall 应并入 *__wood*）: {bad[:3]}')

print(f'nightbalance-albedo: {len(passes)} pass, {len(fails)} fail')
sys.exit(1 if fails else 0)
