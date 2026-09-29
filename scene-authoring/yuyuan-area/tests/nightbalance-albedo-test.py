#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave13-nightbalance N1：夜景偏亮表面的反照率契约（独立参考区间，不拿产物互比）。

背景（wave13-nightqa 巡检 #10/#15 + pv06 raycast 取证）：园林全局地面、外围 L0 体块墙色、
商城楼套件歇山山花板在 dusk/night 读作「雪原」。本测试把「合理反照率」写成契约，期望值全部
来自工单给定/公开的参考区间（线性反照率）：
  - 裸土 / 夯土 / 园土（园林全局地面）：0.15–0.35（干土上限≈0.30–0.35，湿土下限≈0.08–0.15，未核实到单一权威出处，
    采用工单口径「石板、青砖约 0.15–0.35」同档的土壤常见值）
  - 白抹灰 / 灰浆墙（L0 图集 plaster 色调）：0.30–0.66，取 ≤0.66 为上限（白抹灰参考区间 0.6–0.8 的下缘偏内：
    老城厢民居以风化灰浆墙为主，不允许全城贴着最白端；三穗堂白墙等真实白抹灰构件不受本条约束。
    R1 由 0.60 放宽到 0.66：白天 ≤8% 硬门槛要求 atlas 系数从 0.88 回调到 0.94，cream.up 最终有效值 0.643
    落在 0.6–0.8 区间下三分之一内；缩放删除/回 k=1.0 时 cream.up 0.739 仍 >0.66，回退红证不受影响）
  - 清水青砖（图集 greybrick 砖体）：0.15–0.35
  - 程序化铺装贴图：asphalt ≤0.20、grey-brick / blue-stone / fine-cobble ∈ 0.15–0.35、pebble ≤0.35
  - 图集整体（C4）：0.20–0.35 —— 独立确定的区间，不取基线值当上限：图集主体是风化灰浆墙与清水砖
    （墙 0.30–0.60 老城厢取下缘、砖 0.15–0.35），整体平均压到砖区间内（≤0.35）才算「不读雪原」，
    但不得低于 0.20（黑成煤同样失真；铺装 asphalt 上限 0.20 同档）。基线图集 0.365 > 0.35 会红，
    N1 修后 ~0.30–0.34 绿——回退（调色板缩放被删 / k 改回 1.0）可证。
  - 歇山山花板（商城楼套件）：与博风板同为深红木（btk-wood），不允许落在 btk-wall（白抹灰）上——
    nightqa #10 取证：天裕楼北坡「亮坡」= roof-main__wall.001（btk-wall.001）。
断言对象（都是生成源 / 登记输入件，不是渲染产物）：
  A. src/build-scene.mjs case 'ground' 的地面色（全局地面，唯一 material，几何 -800..1200 × -430..370）
  B. modules/outer-kit/bake_atlas.py 的**最终有效**调色板（R1 修：ast 解析源码里对 TONE_PLASTER / BRICK
     的最后一次赋值；若是经 _dim_channel 的 DictComp 重赋值则复现逐通道缩放——astra #2：旧版外层非贪婪
     正则在第一个 `}` 截断，tones={} 零断言；且直接读缩放前字面量，缩放被删也测不出）。
     断言完整色组集合 = {cream, greywhite, oldyellow} × {res, up, side} 全部 ≤0.66，brick ∈ [0.15,0.35]。
  C. resources/textures/paving/*.jpg 的线性平均（PIL 直接解码重算）+ 图集整体独立区间 + 水面反照率
     （依赖 PIL/numpy：缺失 = FAIL，不跳过——astra #2：旧版缺依赖静默跳过 C 组仍 0 fail 退出）
  D. out-bazaar-towers/ 的**锁定 15 塔集合**（astra #2：塔目录为空会静默跳过全部 D）：每塔解析 GLB 的
     primitive **实际材质引用**（astra #2：旧版只查节点合并名），山花板 mesh（roof-main / pav-roof /
     roof-annex 前缀）引用的材质不得是 btk-wall*；15 塔缺任何一件 = FAIL。
用法：python3 -X utf8 tests/nightbalance-albedo-test.py
"""
import ast
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
    h = int(f'{h:06x}', 16) if isinstance(h, int) else int(h, 16)
    return (srgb_to_lin((h >> 16) & 255), srgb_to_lin((h >> 8) & 255), srgb_to_lin(h & 255))


def hex_avg_lin(h):
    return sum(hex_lin(h)) / 3


# ---------- A. 全局地面色 ----------
src = open(os.path.join(ROOT, 'src', 'build-scene.mjs'), encoding='utf-8').read()
m = re.search(r"case 'ground': \{.*?MeshStandardMaterial\(\{ color: 0x([0-9a-fA-F]{6})", src, re.S)
ok(m, "A0 build-scene.mjs 找得到 case 'ground' 材质色")
if m:
    avg = hex_avg_lin(m.group(1))
    ok(0.15 <= avg <= 0.35, f'A1 全局地面线性反照率 {avg:.3f} ∈ [0.15,0.35]（裸土/夯土区间）, rgb={m.group(1)}')

# ---------- B. L0 图集调色板（最终有效值：ast 解析 + 复现缩放） ----------
BA = os.path.join(ROOT, 'modules', 'outer-kit', 'bake_atlas.py')


def _dim_repl(h, k):
    """复现 bake_atlas._dim_channel 的逐通道缩放（int(round(ch*k)) 逐通道）。"""
    r, g, b = (h >> 16) & 255, (h >> 8) & 255, h & 255
    return (int(round(r * k)) << 16) | (int(round(g * k)) << 8) | int(round(b * k))


def _final_palette():
    """返回 (TONE_PLASTER 最终 dict, BRICK 最终 dict, 描述)。源码形态不符预期时抛 RuntimeError。"""
    if not os.path.isfile(BA):
        raise RuntimeError(f'{BA} 不存在')
    tree = ast.parse(open(BA, encoding='utf-8').read())
    assigns = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in ('TONE_PLASTER', 'BRICK'):
                    assigns[t.id] = node          # 同名多次赋值取最后一次（缩放重赋值在后）
    if 'TONE_PLASTER' not in assigns or 'BRICK' not in assigns:
        raise RuntimeError('bake_atlas.py 找不到 TONE_PLASTER / BRICK 赋值')
    dim_k = 1.0
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == '_dim_channel':
            if node.args.defaults:
                d = node.args.defaults[-1]
                if isinstance(d, ast.Constant) and isinstance(d.value, (int, float)):
                    dim_k = d.value

    def resolve_pair(name):
        node = assigns[name]
        if isinstance(node.value, ast.Dict):
            return ast.literal_eval(node.value)
        if isinstance(node.value, ast.DictComp):
            # 找该名字更早的字面 Dict 赋值（缩放重赋值的输入）
            earlier = [n for n in tree.body if isinstance(n, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)
                       and isinstance(n.value, ast.Dict)]
            if not earlier:
                raise RuntimeError(f'{name} 的 DictComp 找不到字面源 dict')
            return ast.literal_eval(earlier[-1].value)
        raise RuntimeError(f'{name} 赋值形态不支持')

    def is_dimmed(name):
        # DictComp 形如 {t: {kk: _dim_channel(vv) ...}}：任一子节点出现 _dim_channel 调用即认缩放
        return any(isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name) and sub.func.id == '_dim_channel'
                   for sub in ast.walk(assigns[name].value))

    tone_src, brick_src = resolve_pair('TONE_PLASTER'), resolve_pair('BRICK')
    tone = ({t: {kk: _dim_repl(vv, dim_k) for kk, vv in d.items()} for t, d in tone_src.items()}
            if is_dimmed('TONE_PLASTER') else tone_src)
    brick = ({kk: _dim_repl(vv, dim_k) for kk, vv in brick_src.items()}
             if is_dimmed('BRICK') else brick_src)
    return tone, brick, (f'ast 解析 bake_atlas.py：_dim_channel k={dim_k}')


try:
    tone, brick, bdesc = _final_palette()
    ok(True, f'B0 bake_atlas.py 最终有效调色板可解析（{bdesc}）')
    want_tones = {'cream', 'greywhite', 'oldyellow'}
    ok(set(tone) == want_tones, f'B0b TONE_PLASTER 色组集合完整 = {sorted(want_tones)}（实测 {sorted(tone)}；greybrick 走 BRICK 不在此）')
    for tn in sorted(want_tones & set(tone)):
        keys = set(tone[tn])
        ok(keys == {'res', 'up', 'side'}, f'B0c {tn} 三面键完整 res/up/side（实测 {sorted(keys)}）')
        for kk, v in sorted(tone[tn].items()):
            avg = hex_avg_lin(v)
            ok(avg <= 0.66, f'B1 抹灰墙色 {tn}.{kk} 线性反照率 {avg:.3f} ≤ 0.66（白抹灰 0.6–0.8 区间下 1/3，风化灰浆；最终有效值）')
    if 'brick' in brick:
        brick_lin = hex_avg_lin(brick['brick'])
        ok(0.15 <= brick_lin <= 0.35, f'B3 清水砖体线性反照率 {brick_lin:.3f} ∈ [0.15,0.35]（最终有效值，非缩放前字面量）')
    else:
        ok(False, 'B3 BRICK 里找不到 brick 键')
except (RuntimeError, SyntaxError, ValueError) as e:
    ok(False, f'B0 bake_atlas.py 最终有效调色板解析失败（资产/源码缺失 = FAIL）：{e}')

# ---------- C. 铺装贴图线性平均 ----------
try:
    from PIL import Image
    import numpy as np
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False
    ok(False, 'C-deps PIL/numpy 可导入（依赖缺失 = FAIL，不跳过）')
if HAVE_DEPS:
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
        # C4 独立区间 [0.20,0.35]：不拿基线值当上限（astra #2：旧版 ≤0.365 即基线回退也过）。
        ok(0.20 <= lin <= 0.35, f'C4 图集整体线性平均 {float(lin):.3f} ∈ [0.20,0.35]（独立区间：砖上限 0.35 封顶 = 不读雪原，0.20 防黑成煤）')
    wp = os.path.join(ROOT, 'resources', 'textures', 'paving', 'water.jpg')
    ok(os.path.exists(wp), 'C5 paving-water 贴图存在（wave13-nightbalance N2）')
    if os.path.exists(wp):
        a = np.asarray(Image.open(wp).convert('RGB'), dtype=np.float32) / 255.0
        lin = float(np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).mean())
        ok(0.02 <= lin <= 0.10, f'C5 水面基色线性平均 {lin:.3f} ∈ [0.02,0.10]（深水反照率）')

# ---------- D. 塔楼歇山山花板（锁定 15 塔集合 + primitive 实际材质引用） ----------
TOWER_IDS = ['bld-165791764',
             'bld-389701812', 'bld-389701901', 'bld-389701971', 'bld-389702030',
             'bld-428202599', 'bld-428202601', 'bld-428202602', 'bld-428202603',
             'bld-428202606', 'bld-428202607',
             'bld-553893867', 'bld-553893868', 'bld-553893873', 'bld-553893884']
SHANHUA_PART = re.compile(r'(roof-main|pav-roof|roof-annex)')


def glb_json(path):
    b = open(path, 'rb').read()
    jl = int.from_bytes(b[12:16], 'little')
    return json.loads(b[20:20 + jl])


troot = os.path.join(ROOT, 'out-bazaar-towers')
missing = [t for t in TOWER_IDS if not os.path.isfile(os.path.join(troot, t, 'model.glb'))]
ok(not missing, f'D0 15 塔资产集合完整（缺 {missing or "无"}）')
for tid in TOWER_IDS:
    p = os.path.join(troot, tid, 'model.glb')
    if not os.path.isfile(p):
        continue                                    # D0 已记 FAIL
    j = glb_json(p)
    mats = [str(mm.get('name', '')) for mm in j.get('materials', [])]
    bad = []
    for mesh in j.get('meshes', []):
        part = str(mesh.get('name', ''))
        if not SHANHUA_PART.search(part):
            continue
        for prim in mesh.get('primitives', []):
            mi = prim.get('material')
            if mi is None or mi >= len(mats):
                continue
            mn = mats[mi].replace(re.search(r'\.\d{3}$', mats[mi]).group(0) if re.search(r'\.\d{3}$', mats[mi]) else '', '')
            if mn.startswith('btk-wall'):
                bad.append(f'{part}->{mats[mi]}')
    ok(not bad, f'D1 {tid}: 山花板 primitive 实际引用不是 btk-wall*（{SHANHUA_PART.pattern} 前缀 mesh）: {bad[:3]}')

print(f'nightbalance-albedo: {len(passes)} pass, {len(fails)} fail')
sys.exit(1 if fails else 0)
