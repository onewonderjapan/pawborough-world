#!/usr/bin/env bash
# C5 — restore check (V10): prove a brand-new environment can find every
# asset and boot. Clones this batch's branch (--shared, so only a fresh
# worktree + alternates link) into /tmp/claude-1000/pawborough-restore-<ts>/,
# runs tools/verify_all.sh THERE (fresh node_modules via npm install, fresh
# dist build, sha reconciliation, two preview cruises), and records the
# outcome in artifacts/v1-candidate/restore-report.json.
# Fallback #7: if /tmp runs out of space, the clone goes to <batch>/restore/
# and is removed afterwards in both cases (the report is the artifact).
#
# Run: bash tools/restore_check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
WS="$(pwd)"
TS=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="artifacts/v1-candidate"
mkdir -p "$REPORT_DIR"
# the branch lives in the repo's common dir (this workspace is a worktree)
GITDIR="$(git rev-parse --git-common-dir)"; GITDIR="$(cd "$GITDIR" && pwd)"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEST="/tmp/claude-1000/pawborough-restore-$TS"
mkdir -p /tmp/claude-1000 2>/dev/null || true
if ! df -m /tmp | awk 'NR==2 {exit !(($4)>3000)}'; then
  DEST="../restore/pawborough-restore-$TS"
  mkdir -p "$(dirname "$DEST")"
fi
STARTED_AT=$(date -Iseconds)
echo "==== [restore_check] git clone --shared --branch $BRANCH -> $DEST"
CLONE_LOG=/tmp/restore_clone_$TS.log
if ! git clone --shared --branch "$BRANCH" "$GITDIR" "$DEST" >"$CLONE_LOG" 2>&1; then
  echo "FAIL clone"; cat "$CLONE_LOG"
  python3 - "$REPORT_DIR/restore-report.json" "$STARTED_AT" "$DEST" false "git clone --shared failed: see $CLONE_LOG" <<'EOF'
import json, sys, datetime
out, started, dest, ok, err = sys.argv[1:6]
json.dump({'tool': 'tools/restore_check.sh', 'startedAt': started,
           'finishedAt': datetime.datetime.now().astimezone().isoformat(),
           'clone': dest, 'pass': ok == 'true', 'error': err},
          open(out, 'w'), ensure_ascii=False, indent=2)
EOF
  exit 1
fi
HEAD_IN_CLONE=$(git -C "$DEST" rev-parse HEAD)

echo "==== [restore_check] verify_all.sh in the clone (fresh environment)"
VERIFY_LOG=/tmp/restore_verify_$TS.log
if (cd "$DEST" && PREVIEW_PORT_A=5316 PREVIEW_PORT_B=5317 bash tools/verify_all.sh) >"$VERIFY_LOG" 2>&1; then
  VERIFY_PASS=true
else
  VERIFY_PASS=false
fi
tail -3 "$VERIFY_LOG"

python3 - "$REPORT_DIR/restore-report.json" "$STARTED_AT" "$DEST" "$VERIFY_PASS" "$HEAD_IN_CLONE" "$VERIFY_LOG" "$WS/artifacts/v1-candidate/verify-report.json" <<'EOF'
import json, sys, datetime, os
out, started, dest, ok, head, vlog, vreport = sys.argv[1:8]
entry = {
    'tool': 'tools/restore_check.sh', 'startedAt': started,
    'finishedAt': datetime.datetime.now().astimezone().isoformat(),
    'clone': dest, 'head': head, 'pass': ok == 'true',
    'verifyLog': vlog,
}
if os.path.exists(vreport):
    entry['verifyReport'] = json.load(open(vreport))
json.dump(entry, open(out, 'w'), ensure_ascii=False, indent=2)
open(out, 'a').write('\n')
print('RESTORE_REPORT', out, 'pass=', entry['pass'])
EOF

if [ "$VERIFY_PASS" = true ]; then
  echo "==== [restore_check] removing the throwaway clone"
  rm -rf "$DEST"
fi
[ "$VERIFY_PASS" = true ] && exit 0 || exit 1
