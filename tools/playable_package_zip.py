#!/usr/bin/env python3
# world-playable package zipper — deterministic content, no long videos, no
# .blend sources (never in the package dir anyway). The ZIP's own SHA-256 is
# written OUTSIDE the archive (delivery receipt), and the in-package
# package-manifest.json excludes itself (no self-hash cycle).
#   python3 tools/playable_package_zip.py <dist-dir> <out-zip>
import hashlib
import os
import sys
import zipfile

EXCLUDE_SUFFIX = ('.zip', '.blend', '.blend1')


def main():
    if len(sys.argv) != 3:
        print('usage: python3 tools/playable_package_zip.py <dist-dir> <out-zip>', file=sys.stderr)
        return 2
    src, out = sys.argv[1], sys.argv[2]
    entries = []
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            if f.endswith(EXCLUDE_SUFFIX):
                continue
            p = os.path.join(root, f)
            entries.append((os.path.relpath(p, src).replace(os.sep, '/'), p))
    entries.sort()
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for arc, p in entries:
            # fixed timestamp: archive content is reproducible from the same tree
            info = zipfile.ZipInfo(arc, date_time=(2026, 9, 20, 0, 0, 0))
            info.external_attr = 0o644 << 16
            with open(p, 'rb') as fh:
                z.writestr(info, fh.read())
    digest = hashlib.sha256(open(out, 'rb').read()).hexdigest()
    print(f'ZIP_OK {out} {len(entries)} files sha256={digest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
