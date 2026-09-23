#!/usr/bin/env python3
"""Upload manifest assets to the private S3 archive (sha256-addressed, idempotent).

Counterpart of restore_migration_assets.py. For every selected manifest entry the
local file is hashed; it must match the manifest sha256. The object key is
<objectPrefix><sha[:2]>/<sha>; objects that already exist are skipped (head-object),
new ones are put with a SHA256 checksum that S3 verifies on arrival. A receipt with
per-object results is written to --receipt.

  python3 -X utf8 tools/upload_migration_assets.py --profile onewonder.root \
      --path scene-authoring/yuyuan-area/out-garden-kits/... [--path ...] \
      --receipt docs/migrations/<date>/CLOUD-RECEIPT.json
  (--changed-since <manifest.json> selects entries new or changed vs an older manifest)
"""
import argparse, base64, datetime, hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h


def aws(profile, region, *args, check=True):
    cmd = ['aws'] + (['--profile', profile] if profile else []) + ['--region', region] + list(args)
    return subprocess.run(cmd, check=check, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--manifest', type=Path, default=ROOT / 'docs/MIGRATION-ASSETS.json')
    ap.add_argument('--profile')
    ap.add_argument('--path', action='append', default=[])
    ap.add_argument('--changed-since', type=Path)
    ap.add_argument('--receipt', type=Path, required=True)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    m = json.loads(a.manifest.read_text(encoding='utf-8'))
    s = m['storage']
    entries = {f['path']: f for f in m['files']}
    sel = list(a.path)
    if a.changed_since:
        old = {f['path']: f['sha256'] for f in json.loads(a.changed_since.read_text(encoding='utf-8'))['files']}
        sel += [p for p, f in entries.items() if old.get(p) != f['sha256']]
    sel = sorted(set(sel))
    if not sel:
        sys.exit('nothing selected (use --path or --changed-since)')
    results, seen = [], set()
    for p in sel:
        f = entries.get(p)
        if f is None:
            sys.exit(f'not in manifest: {p}')
        local = ROOT / p
        h = sha256(local)
        if h.hexdigest() != f['sha256']:
            sys.exit(f'sha mismatch for {p}: local {h.hexdigest()} manifest {f["sha256"]}')
        key = s.get('objectPrefix', 'objects/sha256/') + f['sha256'][:2] + '/' + f['sha256']
        r = {'path': p, 'sha256': f['sha256'], 'bytes': f['bytes'], 'key': key}
        if f['sha256'] in seen:
            r['result'] = 'duplicate-in-batch'
        elif a.dry_run:
            r['result'] = 'dry-run'
        elif aws(a.profile, s['region'], 's3api', 'head-object', '--bucket', s['bucket'], '--key', key, check=False).returncode == 0:
            r['result'] = 'reused'
        else:
            b64 = base64.b64encode(h.digest()).decode()
            aws(a.profile, s['region'], 's3api', 'put-object', '--bucket', s['bucket'], '--key', key,
                '--body', str(local), '--checksum-algorithm', 'SHA256', '--checksum-sha256', b64)
            r['result'] = 'uploaded'
        seen.add(f['sha256'])
        results.append(r)
        print(r['result'], p)
    receipt = {
        'status': 'dry-run' if a.dry_run else 'complete',
        'finishedAt': datetime.datetime.now().astimezone().isoformat(),
        'bucket': s['bucket'], 'region': s['region'], 'public': False,
        'objects': len(results),
        'uploaded': sum(r['result'] == 'uploaded' for r in results),
        'reused': sum(r['result'] == 'reused' for r in results),
        'results': results,
    }
    a.receipt.parent.mkdir(parents=True, exist_ok=True)
    a.receipt.write_text(json.dumps(receipt, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({k: receipt[k] for k in ('status', 'objects', 'uploaded', 'reused')}))


if __name__ == '__main__':
    main()
