#!/usr/bin/env python3
"""R1 structure diff: reworked GLBs vs the delivered originals.
Contract: node names/tree, socket names + translations, root extras, and LOD child
structure must be IDENTICAL (R1-FIXES). Triangle counts and materials may change.
System python3 -X utf8. Exit 1 on any diff.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import glbtools  # noqa: E402


def tree_signature(g):
    """[(name, depth, mesh|None, children-names)] per node, scene order."""
    out = []
    for rec in glbtools.flat_nodes(g):
        n = rec['node']
        kids = [g['nodes'][c].get('name', '#%d' % c) for c in n.get('children', [])]
        out.append((rec['depth'], rec['name'], n.get('mesh') is not None, tuple(sorted(kids))))
    return sorted(out)


def sockets(g):
    out = {}
    for rec in glbtools.flat_nodes(g):
        n = rec['node']
        if rec['name'].startswith('socket'):
            out[rec['name']] = (tuple(round(v, 6) for v in n.get('translation', [0, 0, 0])),
                                tuple(n.get('rotation', [0, 0, 0, 1])))
    return out


def root_extras(g):
    out = {}
    for rec in glbtools.flat_nodes(g):
        if rec['depth'] == 0:
            out[rec['name']] = rec['node'].get('extras', {})
    return out


def main():
    ap_ids = None
    args = sys.argv[1:]
    if '--ids' in args:
        ap_ids = args[args.index('--ids') + 1].split(',')
    r1_dir = Path(args[args.index('--r1') + 1]) if '--r1' in args else None
    old_dir = Path(args[args.index('--orig') + 1]) if '--orig' in args else None
    WS = Path(__file__).resolve().parent.parent
    env = os.environ.get('SNACKS_PKG')
    try:
        import subprocess
        top = subprocess.run(['git', '-C', str(WS), 'rev-parse', '--show-toplevel'],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        top = ''
    if env:
        PKG = Path(env)
    elif top and (Path(top).parent / 'DESIGN_SPEC.json').exists():
        PKG = Path(top).parent
    else:
        PKG = WS.parent
        while not (PKG / 'DESIGN_SPEC.json').exists() and PKG != PKG.parent:
            PKG = PKG.parent
    r1_dir = r1_dir or PKG / 'artifacts/r1/props'
    old_dir = old_dir or Path('/home/baibai/work/onewonderjapan/pawborough-world/'
                              'asset-authoring/snacks/handheld/props')
    ids = ap_ids or json.loads((r1_dir / 'manifest.json').read_text(encoding='utf-8'))['items'].keys()
    report = {}
    bad = False
    for id_ in ids:
        diffs = []
        a = glbtools.parse(Path(old_dir) / (id_ + '.glb'))
        b = glbtools.parse(Path(r1_dir) / (id_ + '.glb'))
        ta, tb = tree_signature(a['json']), tree_signature(b['json'])
        # mesh flags may not change, but tri counts may: compare tree WITHOUT mesh flag,
        # then re-check mesh presence per node name
        strip = lambda t: sorted((d, n, k) for (d, n, _m, k) in t)
        if strip(ta) != strip(tb):
            sa, sb = set(strip(ta)), set(strip(tb))
            diffs.append('node tree: only-orig %s only-r1 %s' % (sorted(sa - sb), sorted(sb - sa)))
        ma = {n: m for (d, n, m, k) in ta}
        mb = {n: m for (d, n, m, k) in tb}
        lost = sorted(n for n in ma if ma[n] and not mb.get(n))
        gained = sorted(n for n in mb if mb[n] and not ma.get(n))
        if lost or gained:
            diffs.append('mesh presence: lost %s gained %s' % (lost, gained))
        ka, kb = sockets(a['json']), sockets(b['json'])
        if ka != kb:
            diffs.append('sockets: orig %s r1 %s' % (ka, kb))
        ea, eb = root_extras(a['json']), root_extras(b['json'])
        if ea != eb:
            diffs.append('root extras: orig %s r1 %s' % (ea, eb))
        report[id_] = {'ok': not diffs, 'diffs': diffs}
        bad = bad or bool(diffs)
        print('DIFF', id_, 'OK' if not diffs else diffs)
    out = PKG / 'artifacts/r1/structure-diff.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if bad:
        sys.exit(1)
    print('STRUCTURE_DIFF_EMPTY', len(list(ids)), 'items')


if __name__ == '__main__':
    main()
