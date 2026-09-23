#!/usr/bin/env python3
"""Manifest: sha256 + sizes of delivered GLBs and analytic maps."""
import hashlib
import json
import os
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(MODULE, os.pardir, os.pardir, "out-tree-kit"))


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    entries = {}
    for sub in ("glb", "textures"):
        d = os.path.join(OUT, sub)
        for fn in sorted(os.listdir(d)):
            p = os.path.join(d, fn)
            entries[f"{sub}/{fn}"] = {
                "sha256": sha256(p),
                "bytes": os.path.getsize(p),
            }
    manifest = {
        "packageId": "pawborough-w1-tree-kit-20260922",
        "outTreeKit": entries,
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"manifest.json: {len(entries)} files")


if __name__ == "__main__":
    main()
