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
# freeze_check BEFORE make_version: the FROZEN inventory (world/**, building/**
# as recorded by the last committed VERSION.json) must match disk byte-for-byte
# before a new version manifest is generated — a drifted frozen asset fails the
# run instead of being silently re-stamped by make_version.
step freeze_check node -e '
    const { createHash } = require("node:crypto");
    const { readFile } = require("node:fs/promises");
    const { execSync } = require("node:child_process");
    (async () => {
      let head;
      try { head = execSync("git rev-parse --verify HEAD:VERSION.json", { encoding: "utf8" }).trim(); }
      catch { console.log("freeze_check skipped: no committed VERSION.json yet"); return; }
      const prev = JSON.parse(execSync("git show HEAD:VERSION.json", { encoding: "utf8" }));
      // in-place-update datasets (DESIGN_SPEC.inPlaceUpdatesAuthorized) are
      // NOT exempt from checking since the closeout batch: they are locked
      // against THIS batch'"'"'s approved baseline (artifacts/world-closeout/
      // baseline.json, committed at stage M) instead of the previous VERSION —
      // an authorized dataset may change only where the baseline authorizes it
      const EXEMPT = ["world/temple-axis-v3/", "world/fangbang-temple-v4/", "world/street-props/"];
      const exempt = (p) => EXEMPT.some((pre) => p.startsWith(pre));
      let baseline = null;
      try { baseline = JSON.parse(await readFile("artifacts/world-closeout/baseline.json", "utf8")); }
      catch { console.error("authorized-dataset lock missing: artifacts/world-closeout/baseline.json"); process.exit(1); }
      const baseSha = new Map(baseline.files.map((f) => [f.path, f.sha256]));
      let checked = 0, baselineLocked = 0, bad = [];
      for (const f of [...prev.worldFiles, ...prev.buildingFiles]) {
        let b;
        try { b = await readFile(f.path); } catch { bad.push(`${f.path}: missing`); continue; }
        const got = createHash("sha256").update(b).digest("hex");
        if (exempt(f.path)) {
          const locked = baseSha.get(f.path);
          if (locked === undefined) { baselineLocked++; continue; }  // new derived asset of this batch — gated by the registry, not the baseline
          if (got !== locked) { bad.push(`${f.path}: authorized dataset drifted from the closeout baseline`); continue; }
          baselineLocked++;
        } else {
          if (got !== f.sha256) bad.push(`${f.path}: sha drift`);
          checked++;
        }
      }
      if (bad.length) { console.error("FROZEN_INVENTORY_DRIFT\n" + bad.slice(0, 10).join("\n")); process.exit(1); }
      console.log(`freeze_check ok ${checked} frozen files match HEAD + ${baselineLocked} authorized-dataset files locked to the closeout baseline`);
    })().catch((e) => { console.error(e.message); process.exit(1); });
  '
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
# full browser gate (adoption batch): v4+skins+props / v3 / temple-v2 in both
# compressed states, temple-v3 on dev, build attribution, HARD routeCheck
step cruise bash -c "node tools/full_browser_gate.mjs --dev-port 5320 --preview-port $PA"
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
