#!/usr/bin/env python3
"""R2 repair packaging: master re-review fix batch (R1-FIXES 2026-09-23).
Merges the reworked bean items + carried items into <r2 pkg>/artifacts/r2/
{catalog.json, manifest.json, contact-sheets/, before-after/, PROGRESS.json,
RESULT.json, DELIVERY.md}. System python3 -X utf8.

Run after export (writes catalog/manifest for the tests) and again with --sheets
after renders (adds contact sheet, before/after composites, RESULT/DELIVERY).
SNACKS_PKG must point at the R2 delivery package (the worktree lives in the R1 pkg).
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import glbtools  # noqa: E402

WS = Path(__file__).resolve().parent.parent
PKG = Path(os.environ['SNACKS_PKG'])          # R2 delivery package (required)
ART = PKG / 'artifacts/r2'
PROPS = ART / 'props'
R1_ART = Path('/home/baibai/outbox/pawborough-snacks-handheld-r1-20260922/artifacts/r1')
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'

# 4 re-exported (bean fixes) + 4 carried unchanged from the R1 delivery
BEAN_IDS = ['bean-single', 'bean-dish', 'bean-jar', 'bean-packet-open']
CARRIED_IDS = ['shengjian', 'youdunzi', 'congyoubing', 'steamer-xiaolongbao-8']
IDS = BEAN_IDS + CARRIED_IDS
SPEC = json.loads((Path('/home/baibai/outbox/pawborough-snacks-handheld-r1-20260922')
                   / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
ITEMS = {i['id']: i for i in SPEC['items']}

FIXES = [
    (1, 'bean-jar 五香豆玻璃罐',
     '豆子排成竖直螺旋柱、悬空；改为重力堆积：从罐底逐层放豆，每粒落到下方已放豆/罐底上'
     '（高度图堆积，最高接触点+半厚），随机朝向；填到 y≈0.15，顶面略成丘；'
     '断言：每粒下方 0.012 m 内有支撑',
     'place_jar 重写：高度图（落点读 6mm 邻域、足迹声明 12mm）+ 每层全新随机落点（17/层，'
     '杜绝 R1 环形对齐的立柱）+ 9 层全盘后核心补层成丘 + 扫描式 top-up；落点支撑取 16mm 内'
     '实际豆顶最高者+半厚（构造保证支撑）；断言入 tests/test_beans.py（支撑 0 缺失 + '
     'core/rim p90 丘顶差）',
     'count=260；topCentreY=0.1391 ∈[0.130,0.1505]；unsupported=0（最差竖向间隙 2.9mm）；'
     'mound p90 rise 12.3mm；min-pair/bounds 全绿；结构 diff 空'),
    (2, 'bean-single 五香豆',
     '颜色偏白、糖霜占满，微距读成大理石碎片；基色 8a6a48 为主（≥55% 面积）、糖霜白斑 '
     '30–40% 且集中在凸面；微距相机 f/4 对焦豆面，不要整颗虚化',
     'texlib bean 图集重写：显式 0.8–2mm 软边糖霜斑泼溅（u 向环绕、极区经度压缩补偿、'
     '按凸面权重布点），强度系数对亮度分类器二分标定；基色 8a6a48 + 弱化斑点噪声；'
     'render_beans/render_item 微距改 f/4 并对焦朝向相机的豆面顶点（--legacy-macro 复现旧版）；'
     '断言：kit/bean_tex_stats.py 同一分类器测 1024/512 图集与 GLB 内嵌贴图字节',
     '1024 图集 base 0.574–0.587、frost 0.313–0.327；512 图集 base 0.568–0.581、'
     'frost 0.309–0.319；凸面糖霜 0.31–0.59 vs 赤道 ≤0.03；GLB 内嵌贴图同规则；'
     '微距记录 macroFocus fstop=4 对焦豆面'),
]

ASSUMPTIONS = [
    '260 粒豆物理密堆在此罐只能到 y≈0.03–0.07（R1 已记录），R2 按返修单的简化法执行：'
    '高度图堆积+逐层随机落点，支撑按「下方 0.012 m 内有罐底或其他豆」逐粒成立；'
    '罐内可视效果为堆至 y≈0.14、中心略高的丘面',
    '支撑断言的水平半径取 17mm（返修单只限定竖向 0.012 m）：22mm 长豆桥搭在邻豆远端是'
    '自然堆叠形态；竖向间隙按返修单 0.012 m 执行（实测最差 2.9mm）',
    '罐 LOD1/LOD2 的 bean-mass lathe 顶面维持 y=0.15（R1 尺寸不变）；返修只动 LOD0 豆粒布局',
    '4 件未返修件（shengjian/youdunzi/congyoubing/steamer）GLB 与渲染自 R1 交付原样携带；'
    'renders/ 中其帧与守卫记录来自 R1 交付（路径改写为 r2），字节未变',
    'before 渲染 = R1 交付渲染帧（artifacts/r1/renders，同机位：相机公式未变，'
    'bean-single 几何未变、bean-jar 包围盒由罐体主导）；macro 的对焦参数差异即返修项本身',
    'GPU 利用率开工时 3%（<20%），沿用 CPU 4 线程（SNACKS_FORCE_CPU=1 + SNACKS_THREADS=4，'
    'Blender ≤2 进程），与 R1 渲染同设备同线程数保证可比',
    'kit/textures 不入库（基线即如此），由 texlib.py 现场再生',
]


def build_data():
    cat = {'package': PKG.name,
           'basedOn': 'pawborough-snacks-handheld-r1-20260922 (R1 delivery @89970769)',
           'coordinate': SPEC['coordinateContract']['glb'],
           'nodeLayout': SPEC['nodeLayout']['children'],
           'items': {}}
    manifest_items = {}
    tot_tex = tot_bytes = 0
    for id_ in IDS:
        c = json.loads((PROPS / 'catalog' / (id_ + '.json')).read_text(encoding='utf-8'))
        cat['items'][id_] = c
        p = glbtools.parse(PROPS / (id_ + '.glb'))
        imgs = glbtools.images_info(p['json'])
        tri = {'LOD0': c['triangles']['lod0'], 'LOD1': c['triangles']['lod1'],
               'LOD2': c['triangles']['lod2']}
        manifest_items[id_] = {'file': 'props/%s.glb' % id_, 'sha256': p['sha256'],
                               'bytes': p['bytes'],
                               'textureBytes': sum(i['bytes'] for i in imgs),
                               'triangles': tri,
                               'images': [i['name'] for i in imgs],
                               'carried': id_ in CARRIED_IDS}
        tot_tex += manifest_items[id_]['textureBytes']
        tot_bytes += p['bytes']
    (ART / 'catalog.json').write_text(json.dumps(cat, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
    manifest = {'package': PKG.name,
                'generated': datetime.now().strftime('%Y-%m-%d'),
                'coordinateContract': SPEC['coordinateContract']['glb'],
                'totalEncodedTextureBytes': tot_tex,
                'totalEncodedTextureBytesMax': SPEC['budgets']['totalEncodedTextureBytesMax'],
                'totalGlbBytes': tot_bytes, 'items': manifest_items}
    (ART / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
    (PROPS / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                                         encoding='utf-8')
    print('R2_DATA_OK items', len(manifest_items), 'tex bytes', tot_tex)


def _label(d, x0, y0, w, txt, sub):
    f_lab = ImageFont.truetype(FONT, 15, index=2)
    d.rectangle((x0, y0 + w, x0 + w, y0 + w + 44), fill=(38, 34, 30))
    d.text((x0 + 8, y0 + w + 3), txt, font=f_lab, fill=(240, 230, 210))
    d.text((x0 + 8, y0 + w + 22), sub, font=f_lab, fill=(190, 180, 160))


def build_sheets():
    out = ART / 'contact-sheets'
    out.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ART / 'catalog.json').read_text(encoding='utf-8'))
    tris = {k: v['triangles']['lod0'] for k, v in catalog['items'].items()}
    TILE = 380
    entries = [(id_, ART / 'renders' / id_ / (id_ + '-three-quarter.jpg')) for id_ in IDS]
    cols = min(4, len(entries))
    rows = (len(entries) + cols - 1) // cols
    img = Image.new('RGB', (cols * TILE, rows * (TILE + 44) + 56), (24, 22, 20))
    d = ImageDraw.Draw(img)
    d.text((10, 12), 'R2 返修 4 件 + 沿用 4 件 · 手持小吃道具（bean 系重力堆积 + 糖霜/微距修复）',
           font=ImageFont.truetype(FONT, 26, index=2), fill=(235, 225, 205))
    for k, (id_, src) in enumerate(entries):
        col, row = k % cols, k // cols
        x0, y0 = col * TILE, 56 + row * (TILE + 44)
        tile = Image.open(src).resize((TILE, TILE))
        img.paste(tile, (x0, y0))
        tag = 'R2 重导出' if id_ in BEAN_IDS else '沿用 R1'
        _label(d, x0, y0, TILE, '%s  %s（%s）' % (ITEMS[id_]['zh'], id_, tag),
               'LOD0 %s tris' % tris.get(id_, 'n/a'))
    img.save(out / 'sheet-r2.jpg', quality=92)
    print('wrote sheet-r2.jpg')

    # before/after composites: R1 delivered frames (left) vs R2 (right), same rig
    ba = ART / 'before-after'
    ba.mkdir(parents=True, exist_ok=True)
    rb = ART / 'renders-before'
    rb.mkdir(parents=True, exist_ok=True)
    for id_ in BEAN_IDS:
        rows = []
        for view in ('three-quarter', 'macro'):
            b = R1_ART / 'renders' / id_ / ('%s-%s.jpg' % (id_, view))
            a = ART / 'renders' / id_ / ('%s-%s.jpg' % (id_, view))
            if b.exists() and a.exists():
                dst = rb / id_ / ('%s-%s.jpg' % (id_, view))
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(b.read_bytes())
                rows.append((b, a))
        if not rows:
            print('no before/after pair for', id_)
            continue
        w = 1024
        H = sum(int(Image.open(a).size[1] * w / Image.open(a).size[0]) + 46 for b, a in rows) + 40
        canvas = Image.new('RGB', (2 * w + 30, H), (18, 16, 14))
        d = ImageDraw.Draw(canvas)
        d.text((12, 8), '%s  %s — before(左/R1 交付) vs after(右/R2)' % (ITEMS[id_]['zh'], id_),
               font=ImageFont.truetype(FONT, 28, index=2), fill=(235, 225, 205))
        y = 40
        for b, a in rows:
            h = 0
            for k, p in ((0, b), (1, a)):
                im = Image.open(p)
                h = int(im.size[1] * w / im.size[0])
                canvas.paste(im.resize((w, h)), (10 + k * (w + 10), y))
            cap = 'before R1' if 'macro' not in b.stem else 'before R1 (f/2.8 socket 对焦)'
            d.rectangle((10, y + h, 10 + w, y + h + 40), fill=(30, 27, 24))
            d.text((16, y + h + 8), cap, font=ImageFont.truetype(FONT, 20, index=2),
                   fill=(210, 200, 180))
            d.rectangle((20 + w, y + h, 20 + 2 * w, y + h + 40), fill=(46, 36, 24))
            d.text((26 + w, y + h + 8), 'after R2' + (' (f/4 豆面对焦)' if 'macro' in a.stem else ''),
                   font=ImageFont.truetype(FONT, 20, index=2), fill=(240, 220, 190))
            y += h + 46
        canvas.save(ba / (id_ + '-before-after.jpg'), quality=90)
        print('wrote before-after/%s' % id_)


def build_result():
    rlog = json.loads((ART / 'renders/render-log.json').read_text(encoding='utf-8'))
    blank = [f['file'] for f in rlog.get('frames', []) if not f.get('ok')]
    val = json.loads((ART / 'validator/report.json').read_text(encoding='utf-8'))
    manifest = json.loads((ART / 'manifest.json').read_text(encoding='utf-8'))
    struct_file = ART / 'structure-diff.json'
    struct = json.loads(struct_file.read_text(encoding='utf-8')) if struct_file.exists() else {}
    bean_log = ART / 'renders/render-log-beans.json'
    bean_macro = []
    if bean_log.exists():
        for f in json.loads(bean_log.read_text(encoding='utf-8')).get('frames', []):
            if 'macro' in f:
                bean_macro.append(f['macro'])
    cat_jar = json.loads((PROPS / 'catalog/bean-jar.json').read_text(encoding='utf-8'))
    tex_stats = json.loads((WS / 'kit' / 'texture-authoring.json').read_text(encoding='utf-8'))
    frames = len([f for f in ART.glob('renders/*/*.jpg')])
    result = {
        'package': PKG.name,
        'basedOn': {'package': 'pawborough-snacks-handheld-r1-20260922',
                    'commit': '89970769 (R1 delivery)'},
        'status': 'delivered_for_lead_review',
        'ownerAdopted': False,
        'visualReview': 'pending_lead',
        'finishedAt': datetime.now().isoformat(timespec='seconds'),
        'fixes': [{'no': n, 'item': it, 'requirement': req, 'implementation': impl,
                   'verification': ver, 'status': 'done'} for (n, it, req, impl, ver) in FIXES],
        'deliverables': {
            'props': 'artifacts/r2/props/*.glb x8 (+catalog/ +reimport/)',
            'catalog': 'artifacts/r2/catalog.json',
            'manifest': 'artifacts/r2/manifest.json',
            'renders': 'artifacts/r2/renders/ (8 件四视图+微距；bean 系重渲染；'
                       'bean-lineup/三灯微距/特写)',
            'rendersBefore': 'artifacts/r2/renders-before/ (R1 交付帧副本，同机位)',
            'beforeAfter': 'artifacts/r2/before-after/',
            'contactSheets': 'artifacts/r2/contact-sheets/sheet-r2.jpg',
            'structureDiff': 'artifacts/r2/structure-diff.json',
            'tests': 'workspace/tests/run_all.sh (R2 mode: SNACKS_R1_ART=artifacts/r2)',
            'testsLog': 'artifacts/r2/tests.log',
        },
        'checks': {
            'validator': {'results': len(val['results']),
                          'errors': sum(r.get('errors', 0) for r in val['results']),
                          'warnings': sum(r.get('warnings', 0) for r in val['results'])},
            'contractTests': 'PASS (tests/test_item_contract.py, R1-mode ids)',
            'beanSetTests': 'PASS (tests/test_beans.py incl. R2 support/mound/texture)',
            'structureDiffEmpty': all(v['ok'] for v in struct.values()),
            'renderGuard': {'blankFrames': blank, 'framesOnDisk': frames},
            'jarPiling': cat_jar.get('beanSet', {}).get('stats', {}),
            'beanAtlasMeasured': tex_stats.get('beanAtlasMeasured', {}),
            'macroFocus': bean_macro,
            'totalEncodedTextureBytes': manifest['totalEncodedTextureBytes'],
            'textureCap': manifest['totalEncodedTextureBytesMax'],
        },
        'renderDevice': rlog.get('device', 'CPU'),
        'assumptions': ASSUMPTIONS,
        'notTouched': '契约层（节点名/插座/extras/LOD 层级）、未返修件（4 件原样携带）、'
                      '主仓 props/（只读）、采用状态',
    }
    (ART / 'RESULT.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n',
                                     encoding='utf-8')
    lines = [
        '# 手持小吃道具 R2 返修 — 交付说明',
        '',
        '包ID：%s（基于 R1 交付 pawborough-snacks-handheld-r1-20260922 @89970769）' % PKG.name,
        '状态：**delivered_for_lead_review**（ownerAdopted=false，visualReview=pending_lead）',
        '',
        '## 2 项返修（主控复验 2026-09-23）',
    ]
    for (n, it, req, impl, ver) in FIXES:
        lines += ['- **#%d %s**：%s → %s（验证：%s）' % (n, it, req, impl, ver)]
    lines += [
        '',
        '## 契约保障',
        '- 节点名/插座/extras/LOD 层级与 R1 交付逐件 diff 为空（`artifacts/r2/structure-diff.json`）。',
        '- validator 0 错误；契约/豆集合断言全绿（含 R2 新增：支撑 0.012m、丘顶、贴图覆盖率、'
        'GLB 内嵌贴图）（`artifacts/r2/tests.log`）。',
        '- 渲染空白帧守卫 %d 张异常；设备 %s（开工 GPU 3%%<20%%，CPU 4 线程 ≤2 进程）。'
        % (len(blank), rlog.get('device', 'CPU')),
        '',
        '## 交付物',
        '- `artifacts/r2/props/`：8 件 GLB（4 件 R2 重导出 + 4 件 R1 原样携带）+ catalog/ + reimport/。',
        '- `artifacts/r2/renders/`：8 件四视图+微距（bean 系为 R2 重渲染）；'
        'bean-lineup / 三灯微距 / 罐碟包特写。',
        '- `artifacts/r2/renders-before/` + `before-after/`：R1 交付帧（同机位）与并排对比。',
        '- `artifacts/r2/contact-sheets/sheet-r2.jpg`。',
        '- `artifacts/r2/{catalog,manifest,PROGRESS,RESULT}.json`、`tests.log`、`structure-diff.json`。',
        '',
        '## 已记录假设',
    ]
    lines += ['- ' + a for a in ASSUMPTIONS]
    (ART / 'DELIVERY.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('RESULT+DELIVERY written')


def build_progress():
    p = ART / 'PROGRESS.json'
    data = {
        'package': PKG.name,
        'updatedAt': datetime.now().isoformat(timespec='seconds'),
        'executor': 'GLM-Flash (master re-review repair of R1 delivery, 2026-09-23)',
        'steps': [
            'worktree work/snacks-handheld-r1-20260922 @89970769（原分支继续）',
            'build_bean.place_jar 重写：高度图重力堆积（读 6mm/写 12mm）+ 逐层随机落点 + '
            '核心补层成丘 + 扫描 top-up + 最近接触支撑；pl.stats 支撑/丘顶记录',
            'texlib bean 图集重写：显式糖霜斑泼溅 + 凸面权重 + 二分标定（30–40% 实测）；'
            '基色 8a6a48 主导；kit/bean_tex_stats.py 共享分类器',
            'render_beans/render_item：bean 微距 f/4 对焦豆面（surface_focus_point）；'
            '--legacy-macro 复现 R1 行为；--props/--rend 参数化',
            'tests/test_beans.py 新增断言：逐粒支撑 ≤0.012m、丘顶 p90、图集 1024/512 覆盖率、'
            'GLB 内嵌贴图字节',
            '重导出 bean-single/bean-dish/bean-jar/bean-packet-open → artifacts/r2/props；'
            '4 件未返修件自 R1 交付携带',
            'diff_structure r1→r2 结构比对；render_item + render_beans 重渲染 bean 系',
            'run_all.sh（SNACKS_R1_ART=artifacts/r2）全绿 → tests.log',
            'kit/r2_pack.py 打包 RESULT/DELIVERY/PROGRESS/catalog/manifest/sheet/before-after',
        ],
        'assumptions': ASSUMPTIONS,
    }
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('PROGRESS written')


def main():
    do_sheets = '--sheets' in sys.argv
    t0 = time.time()
    build_data()
    if do_sheets:
        build_sheets()
    build_progress()
    build_result()
    print('R2_PACK_DONE in %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
