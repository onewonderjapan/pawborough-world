"""play-only 闭门叠加层（工单 C 20261001「明显关门」）。

把实际导出的展示 facadeBay（bazaar 商业展示面）在原黑门前加一层实心双扇
木门 overlay：拼板/横闩/铜门环清楚可见，每 parentBuilding 至多一块淡米小牌
「暂不开放」。原世界 GLB/门片/碰撞一概不改——楼体 footprint 碰撞本来就在
facade 后面，overlay 不新增任何碰撞。

坐标换算（冻结口径，勿改）：
  GLB Y-up (x,y,z) -> Blender (x,-z,y)；GLB yaw rotY -> Blender rotateZ 同正号。
  本脚本直接把顶点烘到 Blender 世界坐标（物体零变换），对每个开间局部
  (u 沿墙, y 高度, z 向街) 用：
    Blender = (tx + u·cosθ + z·sinθ, -tz + u·sinθ - z·cosθ, h)
  其中 tx,tz = 布局位 + dir*0.16（buildFacadeBay 公式）。export_yup 导出后
  与 three 端 buildFacadeBay 的 mesh.position/rotation.y 数学等价（测试按
  GLB 实际顶点复核，不信任本注释）。

结构（合并成少数 primitive，目标 <=8 draw calls）：
  play-closed-facades (root, extras 带 closedFacadeIds)
  ├─ facades-wood        双扇门板（中棕 #96613e）
  ├─ facades-wood-dark   门框/拼板缝（深棕 #6f4728）
  ├─ facades-bar         横闩（#543d2a）
  ├─ facades-copper      门环（铜）
  └─ facades-plaques     淡米小牌（内嵌 PNG「暂不开放」）

Run:
  # 1) 标签 PNG（系统 python3 + Pillow + 本机 CJK 字体，防中文方块）
  python3 scripts/build-play-closed-facades.py --label-only \
      --label-png /abs/artifacts/facades/plaque-label.png
  # 2) Blender 构建
  blender -b --factory-startup -P scripts/build-play-closed-facades.py -- \
      --area /abs/scene-authoring/yuyuan-area \
      --out /abs/artifacts/facades \
      --label-png /abs/artifacts/facades/plaque-label.png \
      --manifest /abs/scene-authoring/yuyuan-area/inputs/play-closed-facades.json
输出：play-closed-facades.glb + measurements.json（GLB 不进 Git，恢复走
inputs/play-closed-facades.json 的 SHA/bytes/provenance 与 resources/play-facades/）。
"""
import argparse
import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

# ---- 固定外观（工单 C；不要新艺术方向） ----
COLOR_WOOD = '96613e'        # 中棕木门板（比旧黑门 0x3f3a34 亮）
COLOR_WOOD_DARK = '6f4728'   # 门框/拼板缝（同族深一档）
COLOR_BAR = '543d2a'         # 横闩
COLOR_COPPER = 'b87333'      # 铜门环
PLAQUE_TEXT = '暂不开放'
PLAQUE_FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
PLAQUE_W, PLAQUE_H, PLAQUE_D = 0.46, 0.22, 0.02

# buildFacadeBay 复用常量（src/build-scene.mjs，勿改）
BAY_FRONT_OFFSET = 0.16      # g.position = x + dir*0.16
DOOR_H = 2.5                 # 旧门高
PILASTER_W = 0.16            # 壁柱宽（door 侧向余量计算用）
GRILLE_FRONT_Z = 0.17        # 旧格栅/窗最前 localZ（slats 0.12+0.05）
OVERLAY_BACK_Z = 0.175       # overlay 背面 >= .17 避闪烁（对 slats 0.17 留 5mm）
LEAF_D = 0.055               # 门板厚
LEAF_GAP = 0.012             # 双扇中缝
FRAME_W = 0.09               # 门框宽
FRAME_D = 0.09
BAR_H, BAR_D = 0.09, 0.055
RING_R, RING_TUBE = 0.052, 0.0085
GROOVE_W, GROOVE_D = 0.014, 0.004
GROOVES_PER_LEAF = 3         # 拼板缝/扇


def lin(hexstr):
    return tuple(((int(hexstr[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4))


# ---------- 纯几何桶（不依赖 bpy；标签模式/测试共用口径） ----------

class Bucket:
    """按材料聚合的三角形桶。顶点直接烘到 Blender 世界坐标。"""

    def __init__(self):
        self.verts = []
        self.faces = []          # 顶点索引四元组（quad）
        self.uv_faces = {}       # face_idx -> [(u,v) x4]（仅 plaque 需要贴图）

    def add_quad(self, pts):
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append((base, base + 1, base + 2, base + 3))
        return len(self.faces) - 1

    def triangles(self):
        return 2 * len(self.faces)


class BayFrame:
    """一个 facadeBay 的局部->Blender世界 变换（冻结口径）。"""

    def __init__(self, px, pz, dx, dz, rot_y):
        self.tx = px + dx * BAY_FRONT_OFFSET
        self.tz = pz + dz * BAY_FRONT_OFFSET
        self.c = math.cos(rot_y)
        self.s = math.sin(rot_y)

    def to_blender(self, u, h, z):
        return (self.tx + u * self.c + z * self.s,
                -self.tz + u * self.s - z * self.c,
                h)


def add_box(bucket, frame, u0, u1, y0, y1, z0, z1):
    """facade 局部轴对齐盒：u 沿墙 / y 高度 / z 向街。绕序一律从外侧看逆时针
    （法线朝外），贴图面才不会从街面看是镜像。"""
    if u1 - u0 <= 1e-6 or y1 - y0 <= 1e-6 or z1 - z0 <= 1e-6:
        raise ValueError(f'empty box {u0},{u1},{y0},{y1},{z0},{z1}')
    P = lambda u, y, z: frame.to_blender(u, y, z)  # noqa: E731
    v = [P(u0, y0, z1), P(u1, y0, z1), P(u1, y1, z1), P(u0, y1, z1),   # 前面 +z
         P(u0, y0, z0), P(u1, y0, z0), P(u1, y1, z0), P(u0, y1, z0)]   # 背面 -z
    bucket.add_quad([v[0], v[1], v[2], v[3]])   # front（法线 +z_local，向街）
    bucket.add_quad([v[4], v[7], v[6], v[5]])   # back（-z）
    bucket.add_quad([v[0], v[3], v[7], v[4]])   # -u 侧
    bucket.add_quad([v[1], v[5], v[6], v[2]])   # +u 侧
    bucket.add_quad([v[0], v[4], v[5], v[1]])   # 底
    bucket.add_quad([v[2], v[6], v[7], v[3]])   # 顶


def add_plaque(bucket, frame, u_center, y_center, z_back):
    """淡米小牌：前面整幅 UV 0..1（法线向街，非镜像），其它面采样纯米色角。"""
    z1 = z_back + PLAQUE_D
    u0, u1 = u_center - PLAQUE_W / 2, u_center + PLAQUE_W / 2
    y0, y1 = y_center - PLAQUE_H / 2, y_center + PLAQUE_H / 2
    P = lambda u, y, z: frame.to_blender(u, y, z)  # noqa: E731
    v = [P(u0, y0, z1), P(u1, y0, z1), P(u1, y1, z1), P(u0, y1, z1),
         P(u0, y0, z_back), P(u1, y0, z_back), P(u1, y1, z_back), P(u0, y1, z_back)]
    fi = bucket.add_quad([v[0], v[1], v[2], v[3]])
    bucket.uv_faces[fi] = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    fi = bucket.add_quad([v[4], v[7], v[6], v[5]])
    bucket.uv_faces[fi] = [(0.01, 0.01)] * 4
    fi = bucket.add_quad([v[0], v[3], v[7], v[4]])
    bucket.uv_faces[fi] = [(0.01, 0.01)] * 4
    fi = bucket.add_quad([v[1], v[5], v[6], v[2]])
    bucket.uv_faces[fi] = [(0.01, 0.01)] * 4
    fi = bucket.add_quad([v[0], v[4], v[5], v[1]])
    bucket.uv_faces[fi] = [(0.01, 0.01)] * 4
    fi = bucket.add_quad([v[2], v[6], v[7], v[3]])
    bucket.uv_faces[fi] = [(0.01, 0.01)] * 4


def add_torus(bucket, frame, u_center, y_center, z_face, major=RING_R, minor=RING_TUBE,
              seg_major=10, seg_minor=6):
    """铜门环：环面平行门面（u-y 平面），挂在 z_face 前。"""
    ring = []
    for i in range(seg_major):
        a = 2 * math.pi * i / seg_major
        ring.append((u_center + major * math.cos(a), y_center + major * math.sin(a)))
    for i in range(seg_major):
        a0, a1 = 2 * math.pi * i / seg_major, 2 * math.pi * (i + 1) / seg_major
        c0, c1 = math.cos(a0), math.sin(a0)
        d0, d1 = math.cos(a1), math.sin(a1)
        for j in range(seg_minor):
            b0 = 2 * math.pi * j / seg_minor
            b1 = 2 * math.pi * (j + 1) / seg_minor
            r0, r1 = minor * math.cos(b0), minor * math.cos(b1)
            q0, q1 = minor * math.sin(b0), minor * math.sin(b1)
            pts = [frame.to_blender(ring[i][0] + r0 * c0, ring[i][1] + r0 * d0, z_face + q0),
                   frame.to_blender(ring[i][0] + r1 * c0, ring[i][1] + r1 * d0, z_face + q1),
                   frame.to_blender(ring[i + 1 if i + 1 < seg_major else 0][0] + r1 * c1,
                                    ring[i + 1 if i + 1 < seg_major else 0][1] + r1 * d1, z_face + q1),
                   frame.to_blender(ring[i + 1 if i + 1 < seg_major else 0][0] + r0 * c1,
                                    ring[i + 1 if i + 1 < seg_major else 0][1] + r0 * d1, z_face + q0)]
            bucket.add_quad(pts)


# ---------- 布局提取 / 排除校验（纯 Python，主控可独立复核） ----------

def js_hash_str(s):
    """src/build-scene.mjs hashStr 的 Python 等价（doorVariant 旧回退口径）。"""
    h = 0
    for ch in str(s):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        if h >= 0x80000000:
            h -= 0x100000000
    return abs(h)


def glb_node_names(path):
    """只解析 GLB JSON chunk 的节点名/口径字段，绝不 dump 整个 GLB。"""
    with open(path, 'rb') as f:
        struct.unpack('<III', f.read(12))
        clen, _ = struct.unpack('<II', f.read(8))
        doc = json.loads(f.read(clen))
    return doc, [str(n.get('name', '')) for n in doc.get('nodes', [])]


def extract_bay_ids(area):
    """扫 out-zone/zone-*.glb，取实际导出的 facadeBay 节点 id（extras.id 校验）。"""
    ids = {}
    for p in sorted((area / 'out-zone').glob('zone-*.glb')):
        if p.name.endswith('.cm.glb'):
            continue
        doc, names = glb_node_names(p)
        nodes = doc.get('nodes', [])
        for name in names:
            m = re.match(r'[^|]+\|(facade-[^|]+)\|facadeBay', name)
            if not m:
                continue
            extras = next((n.get('extras') or {} for n in nodes if str(n.get('name', '')) == name), {})
            ex_id = extras.get('id')
            if ex_id and ex_id != m.group(1):
                raise SystemExit(f'FAIL: extras.id {ex_id} != node id {m.group(1)} in {p.name}')
            ids[m.group(1)] = p.name
    return ids


def point_poly_dist(px, pz, poly):
    """点 vs 多边形：内部返回 <=0 的负距离，外部返回最近边距离。"""
    inside = False
    best = float('inf')
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i][0], poly[i][1]
        x2, z2 = poly[(i + 1) % n][0], poly[(i + 1) % n][1]
        if (z1 > pz) != (z2 > pz):
            xin = (x2 - x1) * (pz - z1) / (z2 - z1) + x1
            if px < xin:
                inside = not inside
        dx, dz = x2 - x1, z2 - z1
        L2 = dx * dx + dz * dz
        t = 0 if L2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (pz - z1) * dz) / L2))
        best = min(best, math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz)))
    return -best if inside else best


def build_targets(area, glb_ids):
    """从 layout 提取闭门目标（buildFacadeBay 公式同源），校验排除项。

    真通路上的开间（街口门洞，collision openings 可通行）不封——从目标里
    排除并记录；除此之外的硬性异常（layout/GLB 不一致、非 bazaar）才失败。
    """
    layout = json.loads((area / 'out-zone' / 'layout.json').read_text(encoding="utf-8"))
    bays = [o for o in layout['objects']
            if o.get('kind') == 'facadeBay' and o.get('disposition') == 'rendered']
    missing = [o['id'] for o in bays if o['id'] not in glb_ids]
    extra = sorted(set(glb_ids) - {o['id'] for o in bays})
    if missing:
        raise SystemExit(f'FAIL: {len(missing)} 个 layout facadeBay 未在实际 GLB 导出: {missing[:5]}…')
    if extra:
        raise SystemExit(f'FAIL: GLB 有 layout 之外的 facade 节点: {extra[:5]}…')

    passages = layout.get('reviewRepair', {}).get('passages', [])
    excluded = []
    targets = []
    for o in sorted(bays, key=lambda x: x['id']):
        g = o['geometry']
        px, pz = g['position']
        dx, dz = g['dir']
        rot = g['rotY']
        w = g.get('width', 4.6)
        variant = o.get('doorVariant') or ('center' if js_hash_str(o['id']) % 2 == 0 else 'offsetLeft')
        door_w = min(1.9, w * 0.4)
        door_x = 0.0 if variant == 'center' else -w * 0.22
        frame = BayFrame(px, pz, dx, dz, rot)
        # 真通路排除：门中心（含门环外扩）落在 passage 矩形 0.6m 邻域内不封
        c = frame.to_blender(door_x, 1.25, 0.225)
        glb_center = (c[0], -c[1])     # Blender y -> GLB z 取负（冻结换算）
        on_passage = None
        for pas in passages:
            for rect in pas.get('rectangles', []):
                d = point_poly_dist(glb_center[0], glb_center[1], rect)
                if d <= 0.6:
                    on_passage = {'roadId': pas.get('roadId'), 'distanceM': round(d, 3)}
                    break
            if on_passage:
                break
        if on_passage:
            excluded.append({'id': o['id'], 'parentBuilding': o.get('parentBuilding'),
                             'reason': 'onRealPassage', **on_passage})
            continue
        targets.append({
            'id': o['id'],
            'parentBuilding': o.get('parentBuilding'),
            'zone': o.get('zone'),
            'trade': o.get('trade'),
            'doorVariant': variant,
            'position': [px, pz],
            'dir': [dx, dz],
            'rotY': rot,
            'width': w,
            'height': o.get('height', 4.0),
            'doorW': door_w,
            'doorX': door_x,
            'glbSource': glb_ids[o['id']],
            # 期望门面（复核用）：门板前面中心 / 法线（GLB 世界系）
            'doorFrontCenterGlb': [round(glb_center[0], 5), 1.25, round(glb_center[1], 5)],
            'doorNormalGlb': [round(math.sin(rot), 6), round(math.cos(rot), 6)],
        })
    if any(t['zone'] != 'bazaar' for t in targets):
        raise SystemExit('FAIL: 闭门目标含非 bazaar 开间（真庙门/园门不得入列）')
    return layout, targets, excluded


# ---------- 门体布局（每开间；局部坐标，之后烘进桶） ----------

def door_parts(t):
    """返回该开间的几何描述（局部 u/y/z），供烘桶与 measurements 双方使用。"""
    w, door_w, door_x = t['width'], t['doorW'], t['doorX']
    z0 = OVERLAY_BACK_Z
    leaf_w = door_w / 2 - LEAF_GAP / 2
    leaves = []
    for side in (-1, 1):
        cu = door_x + side * (leaf_w / 2 + LEAF_GAP / 2)
        leaves.append({'centerU': cu, 'halfW': leaf_w / 2})
    return {
        'leaves': leaves,
        'leafZ': (z0, z0 + LEAF_D),
        'frameU': (door_x - door_w / 2 - FRAME_W, door_x + door_w / 2 + FRAME_W),
        'barY': 1.38,
        'ringU': (door_x - door_w * 0.25, door_x + door_w * 0.25),
        'ringY': 1.05,
    }


def choose_plaque_bay(targets):
    """每 parentBuilding 恰一块小牌：稳定取最小 id 的开间；位置取门旁余量大的侧。"""
    by_parent = {}
    for t in targets:
        by_parent.setdefault(t['parentBuilding'], []).append(t)
    plaques = {}
    for parent, ts in by_parent.items():
        t = min(ts, key=lambda x: x['id'])
        w, door_w, door_x = t['width'], t['doorW'], t['doorX']
        pil_in = w / 2 - PILASTER_W
        side = 1 if (pil_in - (door_x + door_w / 2)) >= ((door_x - door_w / 2) + pil_in) else -1
        u = door_x + side * (door_w / 2 + 0.28 + PLAQUE_W / 2)
        if abs(u) + PLAQUE_W / 2 > pil_in:      # 侧向放不下：门楣上方（仍在雨棚 2.915 之下）
            u, y = door_x, 2.62
        else:
            y = 1.9
        plaques[parent] = {'bayId': t['id'], 'u': round(u, 4), 'y': y}
    return plaques


def bake(buckets, targets, plaques):
    for t in targets:
        f = BayFrame(*t['position'], *t['dir'], t['rotY'])
        p = door_parts(t)
        zl, zh = p['leafZ']
        for leaf in p['leaves']:
            u0, u1 = leaf['centerU'] - leaf['halfW'], leaf['centerU'] + leaf['halfW']
            add_box(buckets['wood'], f, u0, u1, 0.0, DOOR_H, zl, zh)
            # 拼板缝：竖向深色细条，微出门板前面
            span = u1 - u0
            for k in range(1, GROOVES_PER_LEAF + 1):
                gu = u0 + span * k / (GROOVES_PER_LEAF + 1)
                add_box(buckets['woodDark'], f, gu - GROOVE_W / 2, gu + GROOVE_W / 2,
                        0.08, DOOR_H - 0.08, zh - 0.002, zh + GROOVE_D)
        # 门框：双竖梃 + 上槛
        fu0, fu1 = p['frameU']
        for fu in (fu0, fu1):
            add_box(buckets['woodDark'], f, fu, fu + FRAME_W, 0.0, DOOR_H + FRAME_W,
                    OVERLAY_BACK_Z, OVERLAY_BACK_Z + FRAME_D)
        add_box(buckets['woodDark'], f, fu0, fu1, DOOR_H, DOOR_H + FRAME_W,
                OVERLAY_BACK_Z, OVERLAY_BACK_Z + FRAME_D)
        # 横闩：贯通双扇 + 两端托架
        by = p['barY']
        add_box(buckets['bar'], f, fu0 + 0.03, fu1 - 0.03, by - BAR_H / 2, by + BAR_H / 2,
                zh - 0.002, zh + BAR_D)
        for bu in (fu0 + 0.09, fu1 - 0.09):
            add_box(buckets['bar'], f, bu - 0.025, bu + 0.025, by - BAR_H / 2 - 0.05, by,
                    zh - 0.002, zh + 0.02)
        # 铜门环 ×2 + 挂座
        for ru in p['ringU']:
            add_torus(buckets['copper'], f, ru, p['ringY'], zh + RING_TUBE + 0.004)
            add_box(buckets['copper'], f, ru - 0.013, ru + 0.013, p['ringY'] + RING_R - 0.006,
                    p['ringY'] + RING_R + 0.014, zh, zh + 0.024)
    for parent, pl in plaques.items():
        t = next(x for x in targets if x['id'] == pl['bayId'])
        f = BayFrame(*t['position'], *t['dir'], t['rotY'])
        add_plaque(buckets['plaque'], f, pl['u'], pl['y'], OVERLAY_BACK_Z)


# ---------- 标签 PNG（系统 python3 + Pillow；中文必须真字形，防方块） ----------

def write_label_png(path):
    from PIL import Image, ImageDraw, ImageFont
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    W, H = 256, 128
    img = Image.new('RGB', (W, H), (232, 223, 200))       # 淡米底 #e8dfc8
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(PLAQUE_FONT, 52, index=0)
    text = PLAQUE_TEXT
    tb = d.textbbox((0, 0), text, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    d.text(((W - tw) / 2 - tb[0], (H - th) / 2 - tb[1] - 2), text, fill=(84, 61, 42), font=font)
    img.save(path, 'PNG', optimize=True)
    return {'path': str(path), 'bytes': path.stat().st_size,
            'font': 'Noto Serif CJK (ttc)', 'text': text, 'sizePx': [W, H]}


# ---------- Blender 场景（导入 bpy 仅在此函数内） ----------

def build_glb(area, out_dir, label_png, buckets_spec, targets):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)

    def mat(name, color, rough, metal=0.0, emit=None):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        pr = m.node_tree.nodes.get('Principled BSDF')
        pr.inputs['Base Color'].default_value = (*lin(color), 1)
        pr.inputs['Roughness'].default_value = rough
        pr.inputs['Metallic'].default_value = metal
        if emit:   # 极淡暖自发光：夜间路灯下门扇结构仍可读（白天视觉无感）
            pr.inputs['Emission Color'].default_value = (*lin(emit), 1)
            pr.inputs['Emission Strength'].default_value = 1.0
        return m

    materials = {
        'wood': mat('facades-wood', COLOR_WOOD, 0.5, emit='241206'),
        'woodDark': mat('facades-wood-dark', COLOR_WOOD_DARK, 0.55, emit='1a0e05'),
        'bar': mat('facades-bar', COLOR_BAR, 0.5, emit='160c04'),
        'copper': mat('facades-copper', COLOR_COPPER, 0.38, 0.85),
    }
    pm = bpy.data.materials.new('facades-plaque')
    pm.use_nodes = True
    nt = pm.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.7
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(label_png))
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    materials['plaque'] = pm

    root = bpy.data.objects.new('play-closed-facades', None)
    bpy.context.scene.collection.objects.link(root)
    # closure facade IDs 随 root extras 进 GLB（运行时/主控复核用，仅小字段）
    root['kind'] = 'playClosedFacades'
    root['closedCount'] = len(targets)
    root['closedFacadeIds'] = [t['id'] for t in targets]
    root['overlayBackLocalZ'] = OVERLAY_BACK_Z
    stats = {}
    for key, bucket in buckets_spec.items():
        me = bpy.data.meshes.new(f'facades-{key}')
        me.from_pydata([v for v in bucket.verts], [], [list(f) for f in bucket.faces])
        me.validate(verbose=False)
        if bucket.uv_faces:
            uv = me.uv_layers.new(name='UVMap')
            for fi, uvs in bucket.uv_faces.items():
                for li in range(4):
                    uv.data[fi * 4 + li].uv = uvs[li]
        ob = bpy.data.objects.new(f'facades-{key}', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = root
        ob.data.materials.append(materials[key])
        stats[key] = {'verts': len(bucket.verts), 'faces': len(bucket.faces),
                      'triangles': bucket.triangles()}
    bpy.context.view_layer.update()
    out_dir.mkdir(parents=True, exist_ok=True)
    glb_path = out_dir / 'play-closed-facades.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', export_yup=True,
                              export_apply=False, export_extras=True)
    return glb_path, stats


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ---------- main ----------

def main():
    # Blender 下 sys.argv 前段是 blender 自身参数；系统 python3 直跑没有 '--'
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--area', type=Path, default=None)
    ap.add_argument('--out', type=Path, default=None)
    ap.add_argument('--label-png', type=Path, required=True)
    ap.add_argument('--manifest', type=Path, default=None,
                    help='写 inputs/play-closed-facades.json（SHA/bytes/provenance/targets）')
    ap.add_argument('--label-only', action='store_true',
                    help='系统 python3 模式：只生成标签 PNG 后退出')
    a = ap.parse_args(argv)
    label_png = Path(a.label_png).resolve()

    if a.label_only or shutil.which('blender') is None:
        info = write_label_png(label_png)
        print(json.dumps({'labelPng': info}, ensure_ascii=False))
        if a.label_only:
            return
        raise SystemExit('FAIL: 未找到 blender，仅完成了标签 PNG')
    if not a.area or not a.out:
        ap.error('--area/--out 必填（--label-only 模式除外）')
    area = a.area.resolve()
    out_dir = a.out.resolve()

    t0 = time.time()
    print(f'[facades] scan zone GLBs for exported facadeBay ids …', flush=True)
    glb_ids = extract_bay_ids(area)
    layout, targets, excluded = build_targets(area, glb_ids)
    plaques = choose_plaque_bay(targets)
    print(f'[facades] targets={len(targets)} buildings={len(set(t["parentBuilding"] for t in targets))} '
          f'plaques={len(plaques)} excludedOnPassage={len(excluded)}  ({time.time() - t0:.1f}s)', flush=True)

    if not label_png.exists():
        raise SystemExit(f'FAIL: 标签 PNG 缺失（先跑 --label-only）：{label_png}')
    buckets = {k: Bucket() for k in ('wood', 'woodDark', 'bar', 'copper', 'plaque')}
    bake(buckets, targets, plaques)

    glb_path, stats = build_glb(area, out_dir, label_png, buckets, targets)
    sha = sha256_of(glb_path)
    gbytes = glb_path.stat().st_size
    doc, _ = glb_node_names(glb_path)
    n_mat = len(doc.get('materials', []))
    n_mesh = len(doc.get('meshes', []))
    tris = sum(s['triangles'] for s in stats.values())
    root_extras = next((n.get('extras') for n in doc.get('nodes', [])
                        if str(n.get('name', '')) == 'play-closed-facades'), None)
    # root extras：closure facade IDs（运行时追溯；小字段）
    root_extras = root_extras or {}
    assert root_extras.get('closedCount') == len(targets), 'root extras closedCount mismatch'

    layout_sha = sha256_of(area / 'out-zone' / 'layout.json')
    label_sha = sha256_of(label_png)
    scan = {}
    for p in sorted((area / 'out-zone').glob('zone-*.glb')):
        if p.name.endswith('.cm.glb'):
            continue
        cnt = sum(1 for v in glb_ids.values() if v == p.name)
        if cnt:
            scan[p.name] = cnt

    measurements = {
        'generatedAt': '2026-10-02',
        'generator': 'scripts/build-play-closed-facades.py',
        'coordinateRule': 'GLB Y-up (x,y,z)->Blender (x,-z,y); GLB yaw rotY -> Blender rotateZ 同正号; '
                          '局部正Z(向街)对应 Blender 负Y；顶点烘世界坐标，export_yup 导出',
        'overlayBackLocalZ': OVERLAY_BACK_Z,
        'oldDoorFrontLocalZ': 0.15,
        'colors': {'wood': '#' + COLOR_WOOD, 'woodDark': '#' + COLOR_WOOD_DARK,
                   'bar': '#' + COLOR_BAR, 'copper': '#' + COLOR_COPPER,
                   'plaque': '#e8dfc8/' + PLAQUE_TEXT,
                   'nightLegibility': 'wood roughness 0.5 + 微弱暖自发光(#241206)，昼间视觉无感、夜间结构可读'},
        'glb': {'path': str(glb_path), 'sha256': sha, 'bytes': gbytes,
                'triangles': tris, 'materials': n_mat, 'meshes': n_mesh,
                'perBucket': stats},
        'labelPng': {'path': str(label_png), 'sha256': label_sha,
                     'bytes': Path(label_png).stat().st_size},
        'source': {'layout': 'out-zone/layout.json', 'layoutSha256': layout_sha,
                   'zoneGlbScan': scan, 'exportedBayIds': len(glb_ids)},
        'closedCount': len(targets),
        'parentBuildings': len(set(t['parentBuilding'] for t in targets)),
        'plaqueAssignments': plaques,
        'excludedOnPassage': excluded,
        'excluded': ['真庙门/园门/月洞门（非 bazaar facadeBay）',
                     '真通路（reviewRepair.passages 0.6m 邻域，见 excludedOnPassage）',
                     '小吃摊（独立 stall 对象，非 facadeBay）'],
        'newColliders': 0,
    }
    (out_dir / 'measurements.json').write_text(
        json.dumps(measurements, ensure_ascii=False, indent=1), encoding='utf-8')

    if a.manifest:
        rel_label = Path('artifacts/facades') / label_png.name
        manifest = {
            'labelZh': '已关闭的商铺门面（play 叠加层）',
            'note': 'play 模式专用：由 scripts/build-play-closed-facades.py 依据 out-zone/layout.json 的 '
                    'facadeBay（与导出 zone GLB 节点一一对应）生成实心闭门 overlay；复用 buildFacadeBay 公式'
                    '（pos+dir*.16、rotY、doorW=min(1.9,w*.4)、doorX=0 或 -w*.22），overlay 背面 localZ>=.17。'
                    '只封实际导出的展示门面：真庙门/园门/月洞门/真通路/小吃摊不封；不新增碰撞与室内。'
                    'GLB 不入库（resources/ gitignore），SHA256 由浏览器加载时校验；复建命令见 measurements.json。',
            'facades': {
                'id': 'play-closed-facades',
                'path': 'resources/play-facades/play-closed-facades.glb',
                'up': 'Y',
                'root': 'play-closed-facades',
                'sha256': sha,
                'bytes': gbytes,
                'triangles': tris,
                'drawCalls': n_mesh,
                'closedCount': len(targets),
                'parentBuildings': len(set(t['parentBuilding'] for t in targets)),
                'plaqueCount': len(plaques),
                'plaqueText': PLAQUE_TEXT,
                'excludedOnPassage': excluded,
                'labelPng': {'sha256': label_sha, 'provenance': str(rel_label)},
                'source': {'layout': 'out-zone/layout.json', 'layoutSha256': layout_sha,
                           'zoneGlbScan': scan, 'generator': 'scripts/build-play-closed-facades.py'},
            },
            'targets': targets,
        }
        a.manifest.resolve().parent.mkdir(parents=True, exist_ok=True)
        a.manifest.resolve().write_text(json.dumps(manifest, ensure_ascii=False, indent=1),
                                        encoding='utf-8')
        print(f'[facades] manifest -> {a.manifest}', flush=True)
    print(json.dumps({'sha256': sha, 'bytes': gbytes, 'triangles': tris,
                      'materials': n_mat, 'meshes': n_mesh, 'closed': len(targets),
                      'plaques': len(plaques), 'seconds': round(time.time() - t0, 1)},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
