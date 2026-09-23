#!/usr/bin/env python3
"""Render completeness + blank-guard verification (DESIGN_SPEC.verification.renders)."""
import json
import os
import sys
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
PKG = WS.parent
PKG = WS.parent
while not (PKG / 'DESIGN_SPEC.json').exists() and PKG != PKG.parent:
    PKG = PKG.parent
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
REND = Path(os.environ.get('SNACKS_REND', str(WS / 'renders')))
ART = Path(os.environ.get('SNACKS_ART', str(PKG / 'artifacts/snacks-handheld')))
IDS_FILTER = [s for s in os.environ.get('SNACKS_IDS', '').split(',') if s]

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def main():
    log_file = REND / 'render-log.json'
    check(log_file.exists(), 'render-log.json missing')
    stats = {}
    if log_file.exists():
        log = json.loads(log_file.read_text(encoding='utf-8'))
        for f in log.get('frames', []):
            stats[f['file']] = f
        if log.get('device') == 'CPU':
            pass  # allowed fallback
    items = [i['id'] for i in SPEC['items'] if not IDS_FILTER or i['id'] in IDS_FILTER]
    views = SPEC['renderSpec']['perItemSheet']['views']
    blank = []
    for id_ in items:
        d = REND / id_
        for v in views:
            f = d / ('%s-%s.jpg' % (id_, v))
            if not check(f.exists(), '%s-%s: frame missing' % (id_, v)):
                continue
            st = stats.get(str(f))
            if st is None:
                check(False, '%s-%s: no guard record' % (id_, v))
                continue
            if not st.get('ok'):
                blank.append(str(f))
        m = d / ('%s-macro.jpg' % id_)
        if check(m.exists(), '%s: macro missing' % id_):
            st = stats.get(str(m))
            if st:
                check(st.get('ok'), '%s: macro blank' % id_)
        # R1 #7: items with a removable lid child get an extra lid-off frame
        if id_ == 'steamer-xiaolongbao-8':
            f = d / (id_ + '-lid-off.jpg')
            if check(f.exists(), '%s: lid-off frame missing' % id_):
                st = stats.get(str(f))
                if st is None:
                    check(False, '%s: lid-off no guard record' % id_)
                elif not st.get('ok'):
                    blank.append(str(f))
    if not IDS_FILTER:
        # bean extras (full-batch mode only)
        for f in ('renders/bean-lineup.jpg', 'renders/bean-macro-key.jpg',
                  'renders/bean-macro-rim.jpg', 'renders/bean-macro-top.jpg',
                  'renders/bean-dish-close.jpg', 'renders/bean-jar-close.jpg',
                  'renders/bean-packet-close.jpg',
                  'renders/table-spread.jpg', 'renders/counter-integration.jpg'):
            check((WS / f).exists(), '%s missing' % f)
    res = {'blankFrames': blank}
    (ART / 'renders/guard-summary.json').parent.mkdir(parents=True, exist_ok=True)
    (ART / 'renders/guard-summary.json').write_text(
        json.dumps(res, indent=2) + '\n', encoding='utf-8')
    if blank:
        check(False, 'blank frames: %d (see guard-summary.json)' % len(blank))
    if failures:
        print('--- RENDER FAILURES (%d) ---' % len(failures))
        for f in failures:
            print(' FAIL', f)
        sys.exit(1)
    print('RENDERS_OK all planned frames present, guard passed')


if __name__ == '__main__':
    main()
