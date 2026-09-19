#!/usr/bin/env bash
# C2 — v1.0 candidate ONE-COMMAND verification (tools/verify_all.sh).
# npm install (if missing) -> full test suite -> regenerate VERSION.json and
# reconcile every recorded sha against disk -> dist build (+ world/building
# assets, which the committed build_review.mjs predates) -> two headless
# preview cruises (fangbang.html / temple-v2.html through the REAL pages,
# blank-frame guarded). Any step failing => non-zero exit.
# Report: artifacts/v1-candidate/verify-report.json
#
# Run: bash tools/verify_all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REPORT_DIR="artifacts/v1-candidate"
mkdir -p "$REPORT_DIR"
STEPS_JSONL="$(mktemp)"
STARTED_AT=$(date -Iseconds)
FAIL=0

step() { # step <name> <cmd...>
  local name="$1"; shift
  echo "==== [verify_all] $name"
  local t0 ms
  t0=$(date +%s%3N)
  if "$@" > "/tmp/verify_all_${name}.log" 2>&1; then
    ms=$(( $(date +%s%3N) - t0 ))
    printf '{"step":"%s","pass":true,"ms":%s}\n' "$name" "$ms" >> "$STEPS_JSONL"
    echo "ok   $name (${ms}ms)"
    return 0
  fi
  ms=$(( $(date +%s%3N) - t0 ))
  printf '{"step":"%s","pass":false,"ms":%s}\n' "$name" "$ms" >> "$STEPS_JSONL"
  echo "FAIL $name (see /tmp/verify_all_${name}.log)"
  FAIL=1
  return 0   # keep running the report writer even after a failure
}

step npm_install bash -c '[ -d node_modules ] || npm install --no-save playwright@1.63.0'
step tests node --test tests/*.test.mjs
step make_version node tools/make_version.mjs
step sha_reconcile node -e '
    const { createHash } = require("node:crypto");
    const { readFile } = require("node:fs/promises");
    (async () => {
      const v = JSON.parse(await readFile("VERSION.json", "utf8"));
      let checked = 0;
      for (const f of [...v.worldFiles, ...v.buildingFiles]) {
        const b = await readFile(f.path);
        const got = createHash("sha256").update(b).digest("hex");
        if (got !== f.sha256) throw new Error(`sha mismatch ${f.path}`);
        checked++;
      }
      console.log(`sha_reconcile ok ${checked} files`);
    })().catch((e) => { console.error(e.message); process.exit(1); });
  '
step dist_build bash -c 'npm run build && cp -r world building VERSION.json index-v1.html dist/'
# preview ports are overridable so a restore_check clone never fights the
# live workspace for 5306/5307 (defaults keep the standalone run predictable)
PA="${PREVIEW_PORT_A:-5306}"; PB="${PREVIEW_PORT_B:-5307}"
step preview_a bash -c "nohup node_modules/.bin/vite preview --host 127.0.0.1 --port $PA --strictPort >/tmp/verify_preview_$PA.log 2>&1 & sleep 2; curl -sf -o /dev/null http://127.0.0.1:$PA/fangbang.html"
step preview_b bash -c "nohup node_modules/.bin/vite preview --host 127.0.0.1 --port $PB --strictPort >/tmp/verify_preview_$PB.log 2>&1 & sleep 2; curl -sf -o /dev/null http://127.0.0.1:$PB/temple-v2.html"
step cruise node tools/cruise_dist.mjs --base-a http://127.0.0.1:$PA --base-b http://127.0.0.1:$PB
pkill -f "[v]ite preview --port $PA" 2>/dev/null || true
pkill -f "[v]ite preview --port $PB" 2>/dev/null || true

python3 - "$REPORT_DIR/verify-report.json" "$STARTED_AT" "$STEPS_JSONL" <<'EOF'
import json, sys, datetime
out, started, jsonl = sys.argv[1], sys.argv[2], sys.argv[3]
rows = [json.loads(l) for l in open(jsonl) if l.strip()]
report = {
    'tool': 'tools/verify_all.sh', 'startedAt': started,
    'finishedAt': datetime.datetime.now().astimezone().isoformat(),
    'pass': all(r['pass'] for r in rows) and len(rows) > 0, 'steps': rows,
    'logs': 'one /tmp/verify_all_<step>.log per step (transient)',
}
with open(out, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('VERIFY_REPORT', out, 'pass=', report['pass'])
EOF
rm -f "$STEPS_JSONL"
[ "$FAIL" = 0 ] && exit 0 || exit 1
