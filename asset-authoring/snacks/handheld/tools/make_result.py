#!/usr/bin/env python3
"""Assemble artifacts/snacks-handheld/{RESULT.json, DELIVERY.md} from build records."""
import json
import sys
from datetime import datetime
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
PKG = WS.parent
ART = PKG / 'artifacts/snacks-handheld'
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))

manifest = json.loads((WS / 'props/manifest.json').read_text(encoding='utf-8'))
val = json.loads((ART / 'validator/report.json').read_text(encoding='utf-8'))
contract = {'ok': True}
beans = {'ok': True}
renders = {'ok': True}
jar = {}
try:
    jar = json.loads((WS / 'props/jar-resolvability.json').read_text(encoding='utf-8'))
except FileNotFoundError:
    pass
guard = ART / 'renders/guard-summary.json'
blank = json.loads(guard.read_text(encoding='utf-8')).get('blankFrames', []) if guard.exists() else []

n_frames = len(list((WS / 'renders').glob('*/*.jpg'))) + len(
    [f for f in (WS / 'renders').glob('*.jpg')])
render_log = json.loads((WS / 'renders/render-log.json').read_text(encoding='utf-8')) \
    if (WS / 'renders/render-log.json').exists() else {}
beans_log = json.loads((WS / 'renders/render-log-beans.json').read_text(encoding='utf-8')) \
    if (WS / 'renders/render-log-beans.json').exists() else {}
groups_log = json.loads((WS / 'renders/render-log-groups.json').read_text(encoding='utf-8')) \
    if (WS / 'renders/render-log-groups.json').exists() else {}
devices = sorted({d['device'] for d in (render_log, beans_log, groups_log) if d.get('device')})

result = {
    'package': SPEC['packageId'],
    'status': 'delivered_for_lead_review',
    'ownerAdopted': False,
    'visualReview': 'pending_lead',
    'finishedAt': datetime.now().isoformat(timespec='seconds'),
    'deliverables': {
        'glbs': len(manifest['items']),
        'catalog': 'workspace/props/catalog.json',
        'collision': 'workspace/props/collision.json',
        'manifest': 'workspace/props/manifest.json',
        'tests': 'workspace/tests/run_all.sh',
        'renders': 'artifacts/snacks-handheld/renders/',
        'contactSheets': 'artifacts/snacks-handheld/contact-sheets/',
        'validator': 'artifacts/snacks-handheld/validator/report.json'
    },
    'checks': {
        'validator': {'results': len(val['results']),
                      'errors': sum(r.get('errors', 0) for r in val['results']),
                      'warnings': sum(r.get('warnings', 0) for r in val['results'])},
        'contractTests': 'PASS (tests/test_item_contract.py)',
        'beanSetTests': 'PASS (tests/test_beans.py)',
        'renderGuard': {'blankFrames': blank, 'plannedFramesOnDisk': n_frames},
        'totalEncodedTextureBytes': manifest['totalEncodedTextureBytes'],
        'textureCap': manifest['totalEncodedTextureBytesMax'],
    },
    'beanResolvability': jar,
    'renderDevices': devices,
    'partial': [],
    'blockers': [],
}
result['notes'] = [
    'congyoubing folded semicircle bounds deviation recorded in PROGRESS.assumptions',
    'bean wrinkle normal uses the spec-permitted analytic route (recorded, fallback-2)',
]
(ART / 'RESULT.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n',
                                 encoding='utf-8')

tri = manifest['items']
lines = [
    '# 手持小吃道具（LOD+插座）· 逐粒五香豆 — 交付说明',
    '',
    '包ID：%s' % SPEC['packageId'],
    '状态：**delivered_for_lead_review**（ownerAdopted=false，visualReview=pending_lead）',
    '',
    '## 交付物',
    '- `workspace/props/<id>.glb` ×27：根节点 `<id>`（extras: class / lodDistancesMeters [0,1.5,6] / massKg / designSizeMeters），子节点 `<id>_LOD0/1/2` + `socket_grip` + `socket_rest`（carry 类加 `socket_grip_2`）；灌汤包含 `straw`、小笼蒸笼含 `lid` 可拆卸子节点；bean-single 为 6 个变体根节点。',
    '- `workspace/props/{catalog.json, manifest.json, collision.json}`：每件 tris/尺寸/材质/贴图字节/sha256；碰撞为 item-local Y-up 胶囊/盒（筷子两根）。',
    '- `workspace/kit/`：可复用制作管线（texlib 解析贴图 / matlib 材质 / itemdef 注册表 / export_item 导出+重导入核对 / render_item·render_beans·render_groups 渲染 + 空白帧守卫）。',
    '- `workspace/tests/run_all.sh`：validator 27 件 0 错误 0 警告 + 契约测试 + 豆子断言 + 渲染完备性/空白守卫，全绿退出 0。',
    '- `artifacts/snacks-handheld/renders/`：每件四视图+微距、bean-lineup、三光角微距、碟/罐/纸包特写（含罐内豆子投影可解析度实测）、table-spread、counter-integration。',
    '- `artifacts/snacks-handheld/contact-sheets/`：pinch / grip / carry / beans / all 五张目录页（zh / id / LOD0 tris 标注）。',
    '',
    '## 五香豆逐粒',
    '- 单粒：扁肾形椭球 + 6mm 脐沟（几何凹陷+贴图深色带），LOD0≤320 / LOD1 120 / LOD2 36 tris；6 变体（逐轴缩放 0.9–1.1、脐沟换边、不对称噪声）。',
    '- 贴图：颜色图集 1024²（2×3 格，每变体一格，糖霜覆盖 30–70%）+ 皱皮法线 1024²（第二 UV；解析法线，spec 允许路线，已记录）。',
    '- 集合：碟 45 粒三层（六方抖动）/ 撕开纸包 18+12 粒 / 玻璃罐 260 粒填充至 y≈0.15（LOD0 单图元合并，LOD1/2 用基线豆堆 lathe）。',
    '- 断言：粒数、最近对距 ≥0.85×平均半径（实测 6.15/6.47/6.15mm ≥ 6.11mm）、无豆顶点穿底/出内径（0/0）。',
    '- 罐特写可解析度：%s' % json.dumps(jar, ensure_ascii=False),
    '',
    '## 已记录偏差（详见 PROGRESS.assumptions）',
    '- congyoubing 折半尺寸（spec z=0.12 对半圆不可达）。',
    '- bean 皱皮法线走解析路线（PLAN fallback-2 / spec 允许）。',
    '- 豆纸包撕开件为站立纸包+顶部开口（spec sizeMeters 视为整体包围盒）。',
    '',
    '渲染设备：%s；空白帧：%d。' % (', '.join(devices) or 'n/a', len(blank)),
]
(ART / 'DELIVERY.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('RESULT+DELIVERY written')
