"""wave7 K1：其余 11 座无名 / 未接入 bazaarBlock 的套件化诊断（只出诊断，不接入 ids.json）。

逐栋：按 layout 选立面预设 → 写最小 params（preset + id，其余 auto）→ 生成器出 GLB 到 out-bazaar-towers-prep/<id>/ →
test_tower（--source module，STRICT）+ roof_cover 俯视覆盖 + gltfpack 压缩估算 → 汇总成 block-batch-prep.json。
位置 / 临街边 / 共享边一律从 baseline/layout.json 重算（test_tower 与本脚本各自算），不读生成器自报数字判定。

用法（在 scene-authoring/yuyuan-area 下）：
  python3 -X utf8 modules/bazaar-tower-kit/block_prep.py [--ids a,b,...] [--no-build] [--out modules/bazaar-tower-kit/block-batch-prep.json]
Blender 一次只起一个（串行）。
"""
import json, math, os, re, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import params_load                                               # noqa: E402
import roof_cover as RC                                          # noqa: E402

A = sys.argv[1:]
def arg(f, d=None):
    return A[A.index(f) + 1] if f in A else d

IDS = ['bld-165791764', 'bld-389701901', 'bld-389701971', 'bld-389702030', 'bld-428202604', 'bld-428202606',
       'bld-428202607', 'bld-553893867', 'bld-553893868', 'bld-553893873', 'bld-553893884']
IDS = arg('--ids', ','.join(IDS)).split(',')
OUTR = 'out-bazaar-towers-prep'
BLENDER = os.path.expanduser('~/.local/bin/blender')
GLTFPACK = os.environ.get('GLTFPACK', '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack')
OUT_DIR = os.environ.get('OUT_DIR', 'out-zone')
LAYOUT = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
BYID = {o['id']: o for o in LAYOUT['objects']}
try:
    KINDS = set(json.load(open(os.path.join(HERE, '..', 'hall-kit', 'defaults.json'), encoding='utf-8'))['sharedEdgeKinds'])
except Exception:
    KINDS = {'hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock', 'outerBuilding'}


def fp_of(o):
    f = [tuple(q) for q in o['geometry']['footprint']]
    return f[:-1] if f[0] == f[-1] else f


def turn(a, b, c):
    t1 = math.atan2(b[1] - a[1], b[0] - a[0])
    t2 = math.atan2(c[1] - b[1], c[0] - b[0])
    return math.degrees((t2 - t1 + math.pi) % (2 * math.pi) - math.pi)


def shared_segments(o):
    """layout 重算：本栋边与其他会渲染建筑 footprint 边重合（端点离直线 ≤ 0.05、重叠 ≥ 0.3 m）的段。"""
    fp = fp_of(o)
    out = []
    for i in range(len(fp)):
        a, b = fp[i], fp[(i + 1) % len(fp)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.3:
            continue
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        for q in LAYOUT['objects']:
            if q['id'] == o['id'] or q.get('skipRender') or q.get('kind') not in KINDS:
                continue
            qf = (q.get('geometry') or {}).get('footprint')
            if not qf or len(qf) < 3:
                continue
            for j in range(len(qf)):
                c, d = qf[j], qf[(j + 1) % len(qf)]
                if abs(-(c[0] - a[0]) * uz + (c[1] - a[1]) * ux) > 0.05 or abs(-(d[0] - a[0]) * uz + (d[1] - a[1]) * ux) > 0.05:
                    continue
                tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz
                td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz
                lo, hi = max(0.0, min(tc, td)), min(L, max(tc, td))
                if hi - lo >= 0.3:
                    out.append({'fpEdge': i, 'other': q['id'], 'otherKind': q.get('kind'), 'otherName': q.get('name'),
                                'overlapM': round(hi - lo, 2)})
    return out


def street_edges(o):
    fp = fp_of(o)
    out = []
    for fe in o.get('frontEdges', []):
        (a, b) = fe['edge']
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1.5:
            continue
        k = next((i for i in range(len(fp)) if abs(fp[i][0] - a[0]) < .02 and abs(fp[i][1] - a[1]) < .02), None)
        out.append({'fpEdge': k, 'street': fe['street'], 'lenM': round(L, 2)})
    return out


def area(fp):
    return abs(sum(fp[i][0] * fp[(i + 1) % len(fp)][1] - fp[(i + 1) % len(fp)][0] * fp[i][1] for i in range(len(fp)))) / 2


def pick_preset(o):
    """推荐立面预设：两层（6.8 m）= 两层店屋；≥ 3 层且占地 ≥ 1500 m² = 大体量商场；其余 ≥ 3 层 = 名楼式多层外廊。"""
    lv, A_ = int(o.get('levels') or 2), area(fp_of(o))
    if lv <= 2:
        return 'shophouse', '两层（%.1f m）：两层店屋' % o.get('height', 0)
    if A_ >= 1500:
        return 'mall', '%d 层、占地 %.0f m² ≥ 1500：大体量商场（外廊铺满四周太重，底层招牌 + 窗带）' % (lv, A_)
    return 'gallery', '%d 层、占地 %.0f m²：名楼式多层外廊' % (lv, A_)


def glb_image_bytes(path):
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    return sum(j['bufferViews'][im['bufferView']]['byteLength'] for im in j.get('images', []) if 'bufferView' in im)


def cm_bytes(path):
    """同 compress-zones.mjs 参数压一次（-cc -kn -ke -vp 16 -vt 14），返回字节数。"""
    with tempfile.TemporaryDirectory() as td:
        dst = os.path.join(td, 'x.cm.glb')
        subprocess.run([GLTFPACK, '-cc', '-kn', '-ke', '-vp', '16', '-vt', '14', '-i', path, '-o', dst],
                       check=True, capture_output=True)
        return os.path.getsize(dst), glb_image_bytes(dst)


def procedural_bytes(bid):
    """程序化 bazaarBlock 在 OUT_DIR 分区件里的网格字节（节点名含 |id|，accessor 字节合计）× 该件 cm 压缩比。"""
    man = json.load(open(os.path.join(ROOT, OUT_DIR, 'zones-manifest.json'), encoding='utf-8'))
    for z in man['zones']:
        if z['id'] != 'bazaar' or not z.get('file'):
            continue
        b = open(os.path.join(ROOT, OUT_DIR, z['file']), 'rb').read()
        jl = struct.unpack_from('<I', b, 12)[0]
        j = json.loads(b[20:20 + jl])
        roots = [i for i, n in enumerate(j['nodes']) if ('|%s|' % bid) in n.get('name', '') or n.get('name') == bid]
        if not roots:
            continue
        keep, st = set(), list(roots)
        while st:
            i = st.pop()
            keep.add(i)
            st.extend(j['nodes'][i].get('children', []))
        acc = set()
        tris = 0
        for i in keep:
            m = j['nodes'][i].get('mesh')
            if m is None:
                continue
            for p in j['meshes'][m]['primitives']:
                acc.update(p['attributes'].values())
                if 'indices' in p:
                    acc.add(p['indices'])
                    tris += j['accessors'][p['indices']]['count'] // 3
        raw = sum(j['bufferViews'][j['accessors'][a]['bufferView']]['byteLength'] for a in acc if 'bufferView' in j['accessors'][a])
        ratio = (z.get('cm') or {}).get('ratio', 0.35)
        return {'file': z['file'], 'rawBytes': raw, 'cmEst': int(raw * ratio), 'tris': tris, 'zoneCmRatio': ratio}
    return None


def run_test(bid, params_abs, out_rel):
    env = dict(os.environ, OUT_DIR=OUT_DIR, SKIP_WALK='1', STRICT='1')
    r = subprocess.run([sys.executable, '-X', 'utf8', os.path.join(HERE, 'test_tower.py'), '--id', bid, '--params', params_abs,
                        '--out', out_rel], cwd=ROOT, env=env, capture_output=True, text=True)
    fails = [l[5:] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
    m = re.search(r'test_tower: (\d+) pass, (\d+) fail, (\d+) skip', r.stdout)
    return {'pass': int(m.group(1)) if m else None, 'fail': int(m.group(2)) if m else None, 'skip': int(m.group(3)) if m else None,
            'fails': fails}


def main():
    res = []
    os.makedirs(os.path.join(ROOT, OUTR), exist_ok=True)
    for bid in IDS:
        o = BYID[bid]
        fp = fp_of(o)
        preset, why = pick_preset(o)
        d = os.path.join(ROOT, OUTR, bid)
        os.makedirs(d, exist_ok=True)
        pp = os.path.join(d, 'params.json')
        fe_note = None
        if params_load.auto_front_edge(o, LAYOUT) is None:
            # 没有 ≥ 5 m 的非共享临街边（临街边整条贴着邻栋）：诊断里退而用最长的非共享边当正面，并记为问题
            sh = params_load.shared_edge_len(o, LAYOUT)
            cand = [(math.hypot(fp[(i + 1) % len(fp)][0] - fp[i][0], fp[(i + 1) % len(fp)][1] - fp[i][1]), i) for i in range(len(fp))
                    if sh.get(i, 0.0) <= 0.5 * math.hypot(fp[(i + 1) % len(fp)][0] - fp[i][0], fp[(i + 1) % len(fp)][1] - fp[i][1])]
            k = max(cand)[1]
            fe = [k, (k + 1) % len(fp)]
            fe_note = '无 ≥ 5 m 的非共享临街边（layout 登记的临街边与邻栋共享），诊断用最长非共享边 %s 当正面' % fe
        else:
            fe = 'auto'
        if not os.path.exists(pp) or '--no-build' not in A:
            json.dump({'id': bid, 'preset': preset, 'frontEdge': fe}, open(pp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        rec = {'id': bid, 'name': o.get('name'), 'levels': o.get('levels'), 'heightM': o.get('height'),
               'footprintAreaM2': round(area(fp), 1), 'footprintVerts': len(fp),
               'reflexCorners': sum(1 for i in range(len(fp)) if turn(fp[i - 1], fp[i], fp[(i + 1) % len(fp)]) < -5),
               'offAxisCorners': sum(1 for i in range(len(fp)) if 5 < abs(turn(fp[i - 1], fp[i], fp[(i + 1) % len(fp)])) and
                                     abs(abs(turn(fp[i - 1], fp[i], fp[(i + 1) % len(fp)])) - 90) > 5),
               'streetEdges': street_edges(o), 'sharedEdges': shared_segments(o),
               'presetRecommended': preset, 'presetWhy': why}
        if fe_note:
            rec['frontEdgeNote'] = fe_note
        try:
            P = params_load.load(pp)
            rec['frontEdge'] = {'fpEdge': P['frontEdge'], 'street': P.get('frontName')}
            rec['storeyHeightsM'] = P['massing']['storeyHeightsM']
        except SystemExit as ex:
            rec['buildError'] = str(ex)
            res.append(rec)
            continue
        log = os.path.join(d, 'build.log')
        if '--no-build' not in A:
            r = subprocess.run([BLENDER, '-b', '-t', '4', '--python-exit-code', '1', '-P', os.path.join(HERE, 'build_tower.py'), '--',
                                '--params', pp, '--out', os.path.join(OUTR, bid)], cwd=ROOT, capture_output=True, text=True)
            open(log, 'w').write(r.stdout[-20000:] + r.stderr[-20000:])
            if r.returncode != 0:
                tb = [l for l in (r.stdout + r.stderr).splitlines() if 'Error' in l or 'SystemExit' in l or 'raise' in l]
                rec['buildError'] = (tb[-1] if tb else 'blender exit %d' % r.returncode)[:300]
                res.append(rec)
                print('BUILD FAIL', bid, rec['buildError'])
                continue
        glb = os.path.join(d, 'model.glb')
        meas = json.load(open(os.path.join(d, 'measurements.json'), encoding='utf-8'))
        rc = RC.raster(RC.load_glb(glb, bid), fp, 0.1)
        rc.pop('_grids')
        cm, cm_img = cm_bytes(glb)
        proc = procedural_bytes(bid)
        tt = run_test(bid, pp, os.path.join(OUTR, bid))
        rec.update({
            'tris': meas['triangles'], 'glbBytes': os.path.getsize(glb), 'maxHeightM': meas['maxY'],
            'roofCover': rc['roofCover'], 'flat': rc['flat'], 'empty': rc['empty'],
            'flatM2ByNode': dict(list(rc['flatM2ByNode'].items())[:4]),
            'annexRoofs': len(meas.get('annexRoofs', [])), 'leanTo': len(meas.get('leanTo', [])), 'parapets': len(meas.get('parapets', [])),
            'generatorSharedEdges': meas.get('sharedEdges', []),
            'cmBytes': cm, 'cmImageBytes': cm_img, 'cmGeometryBytes': cm - cm_img,
            'proceduralReplaced': proc,
            'testTower': tt,
        })
        res.append(rec)
        print('PREP', bid, preset, rec['tris'], rec['glbBytes'], 'cover', rec['roofCover'], 'fail', tt['fail'])
    return res


# ---------------------------------------------------------------- 汇总：预计问题 / 建议 / 预算
# 首载增量标定（wave7 K0 实测）：5 座名楼 BAZAAR_TOWERS 开 − 关 的核心首载（garden / temple / bazaar / pond 各件 .cm.glb 合计）
# = 1,869,272 B；同一口径的估算 Σ(单楼 gltfpack 后字节 − 内嵌贴图字节) − Σ(被替换程序化体块网格字节 × 所在件压缩比)
# = 1,676,229 B → 标定系数 1.115（分件导出的节点 / 材质 / accessor 开销）。贴图：预设楼只用名楼已有的同名同尺寸贴图，
# 分区导出按名 + 尺寸去重，增量记 0。
CAL = {'measuredDeltaBytes': 1869272, 'estimatedSameMethodBytes': 1676229, 'factor': 1.115}
BUDGET = 2_000_000
TEST_TXT = {
    'test9a': '檐口越过共享边', 'test9b': '构件插进邻栋 footprint', 'test14a': '腰檐在墙线内回折', 'test14b': '共享段上仍有腰檐瓦面',
    'test15a': '航拍平带（屋面覆盖 < 97%）', 'test15b': '平屋顶 > 3%', 'test1a': '出檐超包络（非正交 footprint 处主屋面翼角）',
    'test3e': '无店面玻璃', 'test12': '无匾额 / 招牌', 'test10a': '正面不是 layout 临街边', 'test10b': '临街边店面玻璃不足',
}
NOTES = {}      # 执行者看图后的补充（visual），由 block_prep_notes.json 读入


def summarize(raw):
    notes = {}
    npath = os.path.join(HERE, 'block_prep_notes.json')
    if os.path.exists(npath):
        notes = json.load(open(npath, encoding='utf-8'))
    blocks, est = [], 0.0
    for r in raw:
        fails = [f for f in r.get('testTower', {}).get('fails', []) if not f.startswith('test6')]
        probs = []
        for f in fails:
            key = f.split(' ')[0]
            probs.append('%s %s：%s' % (key, TEST_TXT.get(key, ''), f[len(key):].strip()[:160]))
        if r.get('frontEdgeNote'):
            probs.insert(0, r['frontEdgeNote'])
        if r['footprintVerts'] >= 12 or r['reflexCorners'] >= 3:
            probs.append('复杂平面：%d 顶点、%d 个阴角、%d 个非正交角——顶层轴向矩形 + 附属屋面 / 披檐拼接，屋面块数多' %
                         (r['footprintVerts'], r['reflexCorners'], r['offAxisCorners']))
        shl = sum(s['overlapM'] for s in r['sharedEdges'])
        if shl > 0:
            probs.append('共享边 %.1f m（%d 段，邻栋 %s）' % (shl, len(r['sharedEdges']), sorted({s['other'] for s in r['sharedEdges']})))
        if r.get('buildError'):
            probs.insert(0, '生成失败：' + r['buildError'])
        n = notes.get(r['id'], {})
        probs += n.get('problems', [])
        if r.get('buildError'):
            rec = 'skip'
        elif n.get('recommendation'):
            rec = n['recommendation']
        elif not fails:
            rec = 'direct'
        else:
            rec = 'special'
        geo = r.get('cmGeometryBytes')
        proc = (r.get('proceduralReplaced') or {}).get('cmEst', 0)
        delta = int(((geo or 0) - proc) * CAL['factor']) if geo is not None else None
        if delta is not None:
            est += delta
        blocks.append({
            'id': r['id'], 'name': r.get('name'), 'levels': r['levels'], 'heightM': r['heightM'], 'storeyHeightsM': r.get('storeyHeightsM'),
            'footprintAreaM2': r['footprintAreaM2'], 'footprintVerts': r['footprintVerts'],
            'roofCover': r.get('roofCover'), 'flatRoof': r.get('flat'), 'emptyInFootprint': r.get('empty'),
            'roofPieces': {'annexXieshan': r.get('annexRoofs'), 'leanTo': r.get('leanTo'), 'parapet': r.get('parapets')},
            'sharedEdges': r['sharedEdges'], 'streetEdges': r['streetEdges'], 'frontEdge': r.get('frontEdge'),
            'presetRecommended': r['presetRecommended'], 'presetWhy': r['presetWhy'],
            'tris': r.get('tris'), 'glbBytes': r.get('glbBytes'), 'maxHeightM': r.get('maxHeightM'),
            'cmGeometryBytes': geo, 'proceduralReplacedCmBytes': proc, 'firstLoadDeltaEstBytes': delta,
            'testTower': {k: r.get('testTower', {}).get(k) for k in ('pass', 'fail', 'skip')},
            'expectedProblems': probs,
            'recommendation': rec, 'recommendationText': {'direct': '直接放', 'special': '特殊处理', 'skip': '跳过'}[rec],
            'recommendationWhy': n.get('why', '生成器现状 test_tower 除未登记外 0 失败、俯视覆盖 ≥ 97%' if rec == 'direct' else ''),
            'visualVerdict': n.get('visual'),
        })
    tot_raw = sum(b['glbBytes'] or 0 for b in blocks)
    # K2 实测修正：贴图只在同一分区件里去重，新开一件就要再带一整套贴图（≈ 单楼内嵌贴图字节，cm 后 ≈ 0.35 MB）。
    # 11 座几何合计（原始 GLB − 各自内嵌贴图，件内只留一套）约 9 MB，按 10 MB 余量线可装进一个新件 → 记 1 套贴图
    img_set = max((r.get('cmImageBytes') or 0) for r in raw)

    new_parts = max(1, math.ceil((tot_raw - (len([b for b in blocks if b['glbBytes']]) - 1) * 360000) / 10_000_000))
    est_tex = new_parts * img_set
    out = {
        'ticket': 'wave7-bazaarblocks-20260926 K1', 'status': 'diagnosis only — not in ids.json',
        'generator': 'modules/bazaar-tower-kit/build_tower.py（一个生成器；立面预设 presets/{gallery,shophouse,mall}.json 经 params_load 合并）',
        'method': '逐栋最小 params {id, preset, frontEdge:auto} → 生成 → test_tower（layout 重算，STRICT）+ roof_cover 俯视 z-buffer + gltfpack 压缩；'
                  '6.8 m 按两层（3.8 + 3.0），10.2 m / 3 层 = 4.0 + 3.1 × 2，13.6 m / 4 层 = 4.0 + 3.2 × 3；产物在 out-bazaar-towers-prep/（不入库）',
        'presetRule': '两层 = shophouse（两层店屋）；≥ 3 层且占地 ≥ 1500 m² = mall（大体量商场）；其余 = gallery（名楼式多层外廊）',
        'blocks': blocks,
        'budget': {
            'firstLoadDeltaEstBytes_all11': int(est + est_tex), 'budgetBytes': BUDGET, 'withinBudget': est + est_tex <= BUDGET,
            'geometryPartBytes': int(est), 'textureSetPerNewZonePartBytes': img_set, 'newZoneParts': new_parts,
            'k2Check': {'samples': ['bld-389701901', 'bld-165791764'], 'measuredDeltaBytes': 704852,
                        'estimatedBytes': 187897 + 247243 + img_set,
                        'note': 'K2 实测：两座样板进新件 zone-bazaar-4，核心首载 +704,852 B（zone-bazaar-4 cm 735,920 − zone-bazaar-2 减 31,068）；'
                                '同法估算 788,562 B（高估 12%）。K1 初版估算漏了「新件要再带一套贴图」，已修正'},
            'calibration': CAL,
            'basis': '每栋：gltfpack（同 compress-zones 参数）后字节 − 内嵌贴图字节（已由名楼带入首载、分件导出去重）− 被替换的程序化体块在 '
                     'zone-bazaar-2 的网格字节 × 该件压缩比；合计 × 标定系数 1.115（K0 实测 5 座名楼 1,869,272 B / 同法估算 1,676,229 B）',
            'rawGlbBytes_all11': tot_raw,
            'zoneParts': '现 zone-bazaar-3 原始 9.53 MB（test6 余量线 10 MB）装不下；11 座原始 GLB 合计 %.1f MB，件内贴图只留一套后约 %.1f MB，'
                         '可全放进一个新件 zone-bazaar-4（K2 两座样板已在该件，实测原始 2.31 MB）' % (tot_raw / 1e6, (tot_raw - 10 * 360000) / 1e6),
        },
    }
    out['budget'].update(notes.get('_budget', {}))
    return out


if __name__ == '__main__':
    if '--summarize' in A:
        raw = json.load(open(os.path.join(ROOT, OUTR, 'prep-raw.json'), encoding='utf-8'))
    else:
        raw = main()
        dst = arg('--raw', os.path.join(ROOT, OUTR, 'prep-raw.json'))
        json.dump(raw, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('RAW', dst)
    summ = summarize(raw)
    dst = arg('--out', os.path.join(HERE, 'block-batch-prep.json'))
    json.dump(summ, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('PREP_JSON', dst, 'est delta', summ['budget']['firstLoadDeltaEstBytes_all11'])
