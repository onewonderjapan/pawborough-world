"""两份 JSON 逐字段对比（递归到叶子），打印每个不同的路径与新旧值；--allow <正则> 限定允许变的路径，其余有变 exit 1。
用法：python3 -X utf8 tests/templeqa-jsondiff.py <old.json> <new.json> [--allow '^\\.instances\\[\\d+\\]\\.sha256$']"""
import json, re, sys
a, b = json.load(open(sys.argv[1], encoding='utf-8')), json.load(open(sys.argv[2], encoding='utf-8'))
allow = re.compile(sys.argv[sys.argv.index('--allow') + 1]) if '--allow' in sys.argv else None
diffs = []
def walk(x, y, p):
    if type(x) != type(y):
        diffs.append((p, x, y)); return
    if isinstance(x, dict):
        for k in sorted(set(x) | set(y)):
            if k not in x or k not in y: diffs.append((p + '.' + k, x.get(k, '<absent>'), y.get(k, '<absent>')))
            else: walk(x[k], y[k], p + '.' + k)
    elif isinstance(x, list):
        if len(x) != len(y): diffs.append((p + '#len', len(x), len(y)))
        for i, (u, v) in enumerate(zip(x, y)): walk(u, v, f'{p}[{i}]')
    elif x != y: diffs.append((p, x, y))
walk(a, b, '')
bad = [d for d in diffs if not (allow and allow.search(d[0]))]
for p, x, y in diffs: print(('ALLOWED ' if allow and allow.search(p) else 'OTHER   ') + p, str(x)[:16], '->', str(y)[:16])
print(f'fields changed {len(diffs)}, outside allow-list {len(bad)}')
sys.exit(1 if bad else 0)
