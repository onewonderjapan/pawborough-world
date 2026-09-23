#!/usr/bin/env bash
# Regenerate the whole 6-unit batch into a NEW out directory (refuses to
# overwrite an existing one; never touches source products).
#   bash generator/build_all.sh out/batch-<name>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="$ROOT/${1:?usage: build_all.sh out/batch-<name> (target must not exist)}"
if [ -e "$OUT" ]; then
  echo "REFUSE: $OUT already exists (batch never overwrites existing products)" >&2
  exit 1
fi
mkdir -p "$OUT"
IDS="shop-01-narrow shop-02-double shop-03-threebay shop-04-recess shop-05-corner shop-06-endcap"
for id in $IDS; do
  mkdir -p "$OUT/$id"
  blender -b --factory-startup -t 4 -P "$HERE/build_shophouse.py" -- \
    "$HERE/recipes/$id.json" "$OUT/$id"
  cp "$HERE/recipes/$id.json" "$OUT/$id/recipe-copy.json"
done
echo "BATCH_READY $OUT"
