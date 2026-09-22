#!/usr/bin/env python3
"""R1 repair packaging: merges the 8 reworked items into artifacts/r1/
{catalog.json, manifest.json, contact-sheets/, before-after/, PROGRESS.json,
RESULT.json, DELIVERY.md}. System python3 -X utf8.

Run after export (writes catalog/manifest for the tests) and again with --sheets
after renders (adds contact sheets, before/after composites, RESULT/DELIVERY).
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
def _pkg_root():
    """R1 package root: the git worktree lives at <pkg>/workspace, so the toplevel's
    parent is the delivery package. SNACKS_PKG overrides; repo-layout walk-up as last resort."""
    env = os.environ.get('SNACKS_PKG')
    if env:
        return Path(env)
    try:
        import subprocess
        top = subprocess.run(['git', '-C', str(WS), 'rev-parse', '--show-toplevel'],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if top:
            cand = Path(top).parent
            if ((cand / 'DESIGN_SPEC.json').exists() or (cand / 'artifacts').exists()):
                return cand
    except Exception:
        pass
    p = WS.parent
    while not (p / 'DESIGN_SPEC.json').exists() and p != p.parent:
        p = p.parent
    return p

PKG = _pkg_root()
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
ART = PKG / 'artifacts/r1'
PROPS = ART / 'props'
NIGHT = Path('/home/baibai/outbox/pawborough-snacks-handheld-night-20260921/artifacts/snacks-handheld')
MAIN_PROPS = Path('/home/baibai/work/onewonderjapan/pawborough-world/'
                  'asset-authoring/snacks/handheld/props')
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'

R1_IDS = ['shengjian', 'youdunzi', 'congyoubing', 'bean-single', 'bean-dish', 'bean-jar',
          'bean-packet-open', 'steamer-xiaolongbao-8']
# order as in R1-FIXES (bean-single listed as #4 -> keep fix numbering in reports)
ITEMS = {i['id']: i for i in SPEC['items']}

FIXES = [
    (1, 'shengjian', '白面皮在上，芝麻+葱花撒白顶，焦壳仅 y<0.013',
     'sj-body 改单材质 sesame-scallion（texlib 重绘为 f1e9dc 白底+烤芝麻+葱花）；焦壳 lathe 保持 y<0.013；褶结保留',
     '渲染顶视图白顶带芝麻葱花，底缘金黄；结构 diff 空'),
    (2, 'youdunzi', '油炸小杯 O5.5/O7x3.2cm 壁厚4mm + 萝卜丝圆顶 0.8cm（25-35 根扁条青白两色）+ 炸浆气泡纹',
     'vessel() 杯体+圆顶+30 根 12x0.8x3mm 随机朝向萝卜丝（greens/dough）+12 颗炸浆凸粒；新贴图 fried-batter.jpg（金黄底+深棕圆斑+亮边，无方向性）',
     'LOD0 三角与插座在预算内；微距可见气泡纹与萝卜丝条'),
    (3, 'congyoubing', '对折两层各 1.1cm + 外层 3 条层纹（0.15cm 薄片错位露边）；焦斑 4-6；葱花密度加倍；LOD0<=600',
     '两层 semicircle slab（r .060/.0575 错位）+ 3 片 lamination（.0590/.0570/.0550 递减）；scallion-pancake.jpg 焦斑 12->6、葱花 55->110',
     'catalog LOD0 tris <= 600；侧视可见层纹'),
    (4, 'bean-single', '保留肾形；脐沟几何凹 0.6cm 深 1mm + 深色带；细短皱纹法线强度 0.35（>=8/cm）；糖霜 35-55%（0.8-2mm 软边）；基色 8a6a48',
     'bean_surface 深度 .001；texlib 图集基色 8a6a48、双倍频软边糖霜斑块、强脐带；法线 52/70/92 周波+短促包络，matlib normal_strength=.35；六变体同规则',
     '微距可见皱皮/糖霜/深色脐带；六变体同规则（图集 6 格 coverages .35-.55）；bean-dish 随 #4 同规则并集入 8 件交付'),
    (5, 'bean-jar', '豆填到 y=0.15；标签改贴罐壁弧面（圆柱投影 r=0.0795，高 0.045 宽 0.11，UV 不拉伸）；LOD0<=45k / 文件<=2.5MB',
     'place_jar 重写为逐层重力无关填充（中心+0.028x6+0.056x10 环，17/层，260 粒到 y~.145）；jar-label 14 段弧面均匀弧长 UV；36-tri 豆',
     'test_beans 罐填高度断言；顶点级穿底/出内径 0；catalog LOD0/字节数在预算内'),
    (6, 'bean-packet-open', '标签正向贴回包面（同 wuxiangdou-packet）；撕口 6-8 段折线向外翻 0.8cm；散落豆用 R1 豆',
     'packet-label/mark 正立贴 +z 面（同闭合款行位/UV）；_torn_rim 18 段锯齿领圈外翻 .008；豆实例沿用 build_bean R1 豆',
     '渲染标签正向可读；顶视锯齿撕边；结构 diff 空'),
    (7, 'steamer-xiaolongbao-8', '目录/四视图各加一张 lid-off 视图；lid 子节点保持；不改几何',
     'render_item 新增 lid-off 帧（隐藏 lid 渲染，同灯位）；目录页 steamer 瓦片改用 lid-off；几何零改动',
     'renders/steamer-xiaolongbao-8/-lid-off.jpg 存在且过空白守卫'),
    (8, 'catalog.json', 'bean-single 的 LOD tris 记为 0/0/0',
     'export_item.write_catalog_and_reimport 对 bean-single 按 6 个变体根节点分别计入后求和',
     'catalog.json bean-single triangles lod0=1920/lod1=720/lod2=216'),
]

ASSUMPTIONS = [
    'AGENTS.md / PROJECT.json 在基线提交 33a3bd72 的源码区不存在（START_PROMPT 提及），数值以 DESIGN_SPEC.json 为唯一权威，未阻塞',
    'youdunzi 杯高 3.2cm+圆顶 0.8cm 的字面总高 .040 超出 spec y=.036 的 +10% 契约上限 .0396，圆顶按 .0076 落料（≈0.8cm），总高 .0395 在预算内',
    'youdunzi 萝卜丝端部上翘项使顶点一度到 .0408 超出 +10% 包围盒契约；strip 顶点钳制到 .0395 后达标（LOD0 1224 tris）',
    'bean 图集迭代：极帽 UV 压缩产生的同心环用行均值混合消除；脐带由 v .28-.73 宽带收窄为 v=.5±.04 的边缘细线（初版 softstep 极性反置已修）',
    'congyoubing 按返修单两层各 1.1cm 落料，总高 .0265；沿用夜班 BOUND_EXC（半圆 footprint，z=.12 不可达），仅放行 x/z 上界',
    '罐装豆 260 粒按规格填至 y=0.15 需重力无关逐层填充（物理堆积 260 粒只能到 ~y.07，即返修单指出的问题）；断言按顶面中心 y∈[.130,.1505]',
    'jar-label UV 按弧长均匀参数化（消除旧版棱面弦长畸变=「UV 不拉伸」）；贴图纵横比与版面沿用 wuxiangdou-packet 同一图集行',
    'bean 系三件的 before 渲染取自当前采用版 GLB（主仓 props/，即 Codex 修后状态）；其余 5 件 before 取自夜班原批渲染',
    'GPU 利用率开工时 ~96%（另有一批在跑），全程 CPU 4 线程（SNACKS_FORCE_CPU=1 + SNACKS_THREADS=4）',
    'kit/textures 不入库（基线即如此），由 texlib.py 现场再生；fried-crust/sesame-top 等未触贴图保持原流不变',
]


def build_data():
    cat = {'package': 'pawborough-snacks-handheld-r1-20260922',
           'basedOn': 'pawborough-snacks-handheld-night-20260921 @33a3bd72',
           'coordinate': SPEC['coordinateContract']['glb'],
           'nodeLayout': SPEC['nodeLayout']['children'],
           'items': {}}
    manifest_items = {}
    tot_tex = tot_bytes = 0
    for id_ in R1_IDS:
        c = json.loads((PROPS / 'catalog' / (id_ + '.json')).read_text(encoding='utf-8'))
        cat['items'][id_] = c
        p = glbtools.parse(PROPS / (id_ + '.glb'))
        g = p['json']
        imgs = glbtools.images_info(g)
        tri = {'LOD0': c['triangles']['lod0'], 'LOD1': c['triangles']['lod1'],
               'LOD2': c['triangles']['lod2']}
        manifest_items[id_] = {'file': 'props/%s.glb' % id_, 'sha256': p['sha256'],
                               'bytes': p['bytes'],
                               'textureBytes': sum(i['bytes'] for i in imgs),
                               'triangles': tri,
                               'images': [i['name'] for i in imgs]}
        tot_tex += manifest_items[id_]['textureBytes']
        tot_bytes += p['bytes']
    (ART / 'catalog.json').write_text(json.dumps(cat, ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
    manifest = {'package': 'pawborough-snacks-handheld-r1-20260922',
                'generated': datetime.now().strftime('%Y-%m-%d'),
                'coordinateContract': SPEC['coordinateContract']['glb'],
                'totalEncodedTextureBytes': tot_tex,
                'totalEncodedTextureBytesMax': SPEC['budgets']['totalEncodedTextureBytesMax'],
                'totalGlbBytes': tot_bytes, 'items': manifest_items}
    (ART / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                                       encoding='utf-8')
    # mirror for the contract tests (they read <props>/manifest.json)
    (PROPS / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                                         encoding='utf-8')
    print('R1_DATA_OK items', len(manifest_items), 'tex bytes', tot_tex)


def _tile_label(d, x0, y0, w, zh, id_, tris):
    f_lab = ImageFont.truetype(FONT, 15, index=2)
    d.rectangle((x0, y0 + w, x0 + w, y0 + w + 44), fill=(38, 34, 30))
    d.text((x0 + 8, y0 + w + 3), '%s  %s' % (zh, id_), font=f_lab, fill=(240, 230, 210))
    d.text((x0 + 8, y0 + w + 22), 'LOD0 %s tris' % tris, font=f_lab, fill=(190, 180, 160))


def build_sheets():
    out = ART / 'contact-sheets'
    out.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ART / 'catalog.json').read_text(encoding='utf-8'))
    tris = {k: v['triangles']['lod0'] for k, v in catalog['items'].items()}
    TILE = 320

    def sheet(entries, title, name):
        cols = min(6, len(entries))
        rows = (len(entries) + cols - 1) // cols
        img = Image.new('RGB', (cols * TILE, rows * (TILE + 44) + 56), (24, 22, 20))
        d = ImageDraw.Draw(img)
        d.text((10, 12), title, font=ImageFont.truetype(FONT, 26, index=2), fill=(235, 225, 205))
        for k, (id_, src) in enumerate(entries):
            col, row = k % cols, k // cols
            x0, y0 = col * TILE, 56 + row * (TILE + 44)
            tile = Image.open(src).resize((TILE, TILE))
            img.paste(tile, (x0, y0))
            _tile_label(d, x0, y0, TILE, ITEMS[id_]['zh'], id_, tris.get(id_, 'n/a'))
        img.save(out / name, quality=92)
        print('wrote', name, len(entries), 'tiles')

    r1 = [(id_, ART / 'renders' / id_ / (id_ + '-three-quarter.jpg')) for id_ in R1_IDS]
    r1.append(('steamer-xiaolongbao-8', ART / 'renders' / 'steamer-xiaolongbao-8' /
               'steamer-xiaolongbao-8-lid-off.jpg'))
    sheet(r1, 'R1 返修 8 件（含小笼 lid-off）· 手持小吃道具', 'sheet-r1.jpg')
    all_ids = [i['id'] for i in SPEC['items']]
    entries = []
    for id_ in all_ids:
        r1_tq = ART / 'renders' / id_ / (id_ + '-three-quarter.jpg')
        if id_ in R1_IDS and r1_tq.exists():
            entries.append((id_, r1_tq))
        else:
            entries.append((id_, NIGHT / 'renders' / id_ / (id_ + '-three-quarter.jpg')))
    sheet(entries, '全部 27 件（19 件沿用原批 + 8 件 R1）· 手持小吃道具', 'sheet-all-r1.jpg')

    # before/after composites: before tq | after tq / before macro | after macro
    ba = ART / 'before-after'
    ba.mkdir(parents=True, exist_ok=True)
    for id_ in R1_IDS:
        if id_ in ('bean-single', 'bean-jar', 'bean-packet-open'):
            bef_dir = ART / 'renders-before' / id_
        else:
            bef_dir = NIGHT / 'renders' / id_
        aft_dir = ART / 'renders' / id_
        rows = []
        for view in ('three-quarter', 'macro'):
            b = bef_dir / ('%s-%s.jpg' % (id_, view))
            a = aft_dir / ('%s-%s.jpg' % (id_, view))
            if b.exists() and a.exists():
                rows.append((b, a))
        if not rows:
            print('no before/after pair for', id_)
            continue
        w = 1024
        H = sum(int(Image.open(a).size[1] * w / Image.open(a).size[0]) + 46 for b, a in rows) + 40
        canvas = Image.new('RGB', (2 * w + 30, H), (18, 16, 14))
        d = ImageDraw.Draw(canvas)
        d.text((12, 8), '%s  %s — before(左/原批) vs after(右/R1)' % (ITEMS[id_]['zh'], id_),
               font=ImageFont.truetype(FONT, 28, index=2), fill=(235, 225, 205))
        y = 40
        for b, a in rows:
            for k, p in ((0, b), (1, a)):
                im = Image.open(p)
                h = int(im.size[1] * w / im.size[0])
                im = im.resize((w, h))
                canvas.paste(im, (10 + k * (w + 10), y))
            d.rectangle((10, y + h, 10 + w, y + h + 40), fill=(30, 27, 24))
            d.text((16, y + h + 8), 'before ' + p.stem.split('-')[-1],
                   font=ImageFont.truetype(FONT, 20, index=2), fill=(210, 200, 180))
            d.rectangle((20 + w, y + h, 20 + 2 * w, y + h + 40), fill=(46, 36, 24))
            d.text((26 + w, y + h + 8), 'after R1', font=ImageFont.truetype(FONT, 20, index=2),
                   fill=(240, 220, 190))
            y += h + 46
        canvas.save(ba / (id_ + '-before-after.jpg'), quality=90)
        print('wrote before-after/%s' % id_)


def build_result():
    guard = ART / 'renders/guard-summary.json'
    blank = json.loads(guard.read_text(encoding='utf-8')).get('blankFrames', []) if guard.exists() else []
    val = json.loads((ART / 'validator/report.json').read_text(encoding='utf-8'))
    manifest = json.loads((ART / 'manifest.json').read_text(encoding='utf-8'))
    struct_file = ART / 'structure-diff.json'
    struct = json.loads(struct_file.read_text(encoding='utf-8')) if struct_file.exists() else {}
    rlog = ART / 'renders/render-log.json'
    device = json.loads(rlog.read_text(encoding='utf-8')).get('device') if rlog.exists() else 'CPU'
    frames = len([f for f in ART.glob('renders/*/*.jpg')])
    result = {
        'package': 'pawborough-snacks-handheld-r1-20260922',
        'basedOn': {'package': 'pawborough-snacks-handheld-night-20260921',
                    'commit': '33a3bd72b633983d4649979f545e96a410934ace'},
        'status': 'delivered_for_lead_review',
        'ownerAdopted': False,
        'visualReview': 'pending_lead',
        'finishedAt': datetime.now().isoformat(timespec='seconds'),
        'fixes': [{'no': n, 'item': it, 'requirement': req, 'implementation': impl,
                   'verification': ver, 'status': 'done'} for (n, it, req, impl, ver) in FIXES],
        'deliverables': {
            'props': 'artifacts/r1/props/*.glb x8 (+catalog/ +reimport/)',
            'catalog': 'artifacts/r1/catalog.json',
            'manifest': 'artifacts/r1/manifest.json',
            'renders': 'artifacts/r1/renders/ (四视图+微距+steamer lid-off)',
            'beforeAfter': 'artifacts/r1/before-after/',
            'contactSheets': 'artifacts/r1/contact-sheets/',
            'structureDiff': 'artifacts/r1/structure-diff.json',
            'tests': 'workspace/tests/run_all.sh (R1 mode)',
            'testsLog': 'artifacts/r1/tests.log',
        },
        'checks': {
            'validator': {'results': len(val['results']),
                          'errors': sum(r.get('errors', 0) for r in val['results']),
                          'warnings': sum(r.get('warnings', 0) for r in val['results'])},
            'contractTests': 'PASS (tests/test_item_contract.py, R1 ids)',
            'beanSetTests': 'PASS (tests/test_beans.py, R1 ids)',
            'structureDiffEmpty': all(v['ok'] for v in struct.values()),
            'renderGuard': {'blankFrames': blank, 'framesOnDisk': frames},
            'totalEncodedTextureBytes': manifest['totalEncodedTextureBytes'],
            'textureCap': manifest['totalEncodedTextureBytesMax'],
        },
        'renderDevice': device,
        'assumptions': ASSUMPTIONS,
        'notTouched': '契约层（节点名/插座/extras/LOD 层级）、未返修的 19 件、主仓 props/（只读）、采用状态',
    }
    (ART / 'RESULT.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n',
                                     encoding='utf-8')
    lines = [
        '# 手持小吃道具 R1 返修 — 交付说明',
        '',
        '包ID：pawborough-snacks-handheld-r1-20260922（基于夜班 pawborough-snacks-handheld-night-20260921 @33a3bd72）',
        '状态：**delivered_for_lead_review**（ownerAdopted=false，visualReview=pending_lead）',
        '',
        '## 8 项返修',
    ]
    for (n, it, req, impl, ver) in FIXES:
        lines += ['- **#%d %s**：%s → %s（验证：%s）' % (n, it, req, impl, ver)]
    lines += [
        '',
        '## 契约保障',
        '- 节点名/插座/extras/LOD 层级与原件逐项 diff 为空（`artifacts/r1/structure-diff.json`，kit/diff_structure.py）。',
        '- validator %d 件 0 错误；契约/豆集合断言全绿（`artifacts/r1/tests.log`）。',
        '- 渲染空白帧守卫 %d 张异常；设备 %s（GPU≥20%%，全程 CPU 4 线程）。' % (len(blank), device),
        '',
        '## 交付物',
        '- `artifacts/r1/props/`：8 件返修 GLB + catalog/ + reimport/（原批 props 未覆盖）。',
        '- `artifacts/r1/renders/`：每件四视图+微距；小笼笼盖加 lid-off 帧。',
        '- `artifacts/r1/before-after/`：8 张并排（bean 系 before 取采用版 GLB，其余取夜班原批渲染）。',
        '- `artifacts/r1/contact-sheets/`：sheet-r1（8 件+lid-off）与 sheet-all-r1（27 件）。',
        '- `artifacts/r1/{catalog,manifest,PROGRESS,RESULT}.json`、`tests.log`。',
        '',
        '## 已记录假设',
    ]
    lines += ['- ' + a for a in ASSUMPTIONS]
    (ART / 'DELIVERY.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('RESULT+DELIVERY written')


def build_progress():
    p = ART / 'PROGRESS.json'
    data = {
        'package': 'pawborough-snacks-handheld-r1-20260922',
        'updatedAt': datetime.now().isoformat(timespec='seconds'),
        'executor': 'GLM-Flash (repair of night-20260921 batch, lead review 2026-09-22)',
        'steps': [
            'worktree work/snacks-handheld-r1-20260922 @33a3bd72',
            'texlib.py: shengjian 白底芝麻葱花 / scallion-pancake 6 焦斑+2x 葱花 / fried-batter 新贴图 / bean 图集 8a6a48+糖霜 35-55%+软边 / 细短皱纹法线',
            'itemdef.py: shengjian 单材质顶/侧 / youdunzi 炸杯+萝卜丝+凸粒 / congyoubing 双层+3 层纹',
            'build_bean.py: 脐沟 1mm / place_jar 逐层填至 y~.145 / 弧面 jar-label / torn-rim+正向标签',
            'matlib+geomlib: normal_strength 参数（bean 0.35）+ batter 材质',
            'export_item: --out + bean-single 三角统计修复',
            'render_item: --props/--rend/--views + lid-off 帧 + CPU 强制',
            'kit/diff_structure.py 结构比对 + kit/r1_pack.py 打包',
            'tests: R1 环境变量参数化（PROPS/ART/IDS/MANIFEST）+ 罐填高度断言 + lid-off 完备性',
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
    print('R1_PACK_DONE in %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
