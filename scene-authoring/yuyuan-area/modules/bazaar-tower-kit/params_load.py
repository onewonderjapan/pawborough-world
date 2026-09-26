"""bazaar-tower-kit 参数装载（wave7 K1「立面预设」）：纯 Python，build_tower / test_tower / render_tower / block_prep 共用。

- params 带 "preset": "<名>" 时，先读 presets/<名>.json 作底，再把本栋 params 深合并上去（dict 递归合并，其余覆盖）。
  名楼的完整 params（无 preset 键）原样返回，输出不变。
- "auto" 值（只在预设楼上用）：
  - frontEdge: "auto" → layout frontEdges 里与 footprint 边同序重合、≥ 5 m 的最长临街边 [i, i+1]；
  - massing.storeyHeightsM: "auto" → 照 layout levels / height：两层 = [3.8, H − 3.8]（6.8 m → 3.8 + 3.0）；
    三层及以上 = 底层 4.0，其余均分（13.6 / 4 → 4.0 + 3 × 3.2；10.2 / 3 → 4.0 + 2 × 3.1）；
  - facades.galleryStoreys: "upper" → 2..N。
"""
import copy, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PRESETS = ('gallery', 'shophouse', 'mall')


def merge(base, over):
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _fp(obj):
    fp = [list(q) for q in obj['geometry']['footprint']]
    return fp[:-1] if fp[0] == fp[-1] else fp


def auto_front_edge(obj):
    fp = _fp(obj)
    best = None
    for fe in obj.get('frontEdges', []):
        (a, b) = fe['edge']
        if fe.get('lenM', 0) < 5.0:
            continue
        for i in range(len(fp)):
            p, q = fp[i], fp[(i + 1) % len(fp)]
            if abs(p[0] - a[0]) < .02 and abs(p[1] - a[1]) < .02 and abs(q[0] - b[0]) < .02 and abs(q[1] - b[1]) < .02:
                L = math.hypot(q[0] - p[0], q[1] - p[1])
                if best is None or L > best[0]:
                    best = (L, [i, (i + 1) % len(fp)], fe['street'])
    return best


def auto_storeys(obj):
    n, h = int(obj.get('levels') or 2), float(obj.get('height') or 6.8)
    if n <= 2:
        return [3.8, round(h - 3.8, 3)] if n == 2 else [h]
    r = round((h - 4.0) / (n - 1), 4)
    return [4.0] + [r] * (n - 1)


def load(path, layout=None):
    p = path if os.path.isabs(path) else os.path.join(HERE, path)
    P = json.load(open(p, encoding='utf-8'))
    if not P.get('preset'):
        return P
    base = json.load(open(os.path.join(HERE, 'presets', P['preset'] + '.json'), encoding='utf-8'))
    P = merge(base, P)
    L = layout or json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
    obj = next(o for o in L['objects'] if o['id'] == P['id'])
    if P.get('frontEdge', 'auto') == 'auto':
        fe = auto_front_edge(obj)
        if fe is None:
            raise SystemExit('%s: no street edge >= 5 m matching the footprint order; set frontEdge by hand' % P['id'])
        P['frontEdge'], P['frontName'] = fe[1], fe[2]
    if P['massing'].get('storeyHeightsM', 'auto') == 'auto':
        P['massing']['storeyHeightsM'] = auto_storeys(obj)
        P['massing']['wallTopM'] = round(sum(P['massing']['storeyHeightsM']), 3)
    if P['facades'].get('galleryStoreys') == 'upper':
        P['facades']['galleryStoreys'] = list(range(2, len(P['massing']['storeyHeightsM']) + 1))
    P.setdefault('name', obj.get('name'))
    return P
