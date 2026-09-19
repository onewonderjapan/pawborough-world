#!/usr/bin/env bash
# R (closeout batch 20260919) — restore verification WITHOUT shared alternates.
# Unlike tools/restore_check.sh (git clone --shared = alternates link, fine for
# its era but NOT a portable-restore claim), this script proves the exact
# release commit can be restored on the SAME HOST into a fresh directory that
# depends on nothing under the source worktree:
#
#   1. full local clone (no --shared) of the repo -> <package>/restore/<ts>/
#   2. checkout the EXACT release commit
#   3. prove isolation: no .git/objects/info/alternates, no path into the
#      source workspace
#   4. git lfs pull (real bytes), sentinel GLB magic + the 225 original-asset
#      shas verified against the closeout baseline
#   5. npm ci, npm run build, full test suite, official browser gate
#
# Preserved (never deleted) for owner review. The report is bound to
# RELEASE_COMMIT and records the same-host caveat: same-machine new-directory
# restore; NOT a claim about offline/net-new environments or W2.
#
# Run: RELEASE_COMMIT=<sha> bash tools/closeout_restore_check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
WS="$(pwd)"
RELEASE_COMMIT="${RELEASE_COMMIT:?RELEASE_COMMIT=<sha> required}"
TS=$(date +%Y%m%d-%H%M%S)
DEST="../restore/pawborough-world-closeout-restore-$TS"
mkdir -p "$(dirname "$DEST")"
STARTED_AT=$(date -Iseconds)
GITDIR="$(git rev-parse --git-common-dir)"; GITDIR="$(cd "$GITDIR" && pwd)"
LOG="$DEST.log"; : >"$LOG"

fail() { python3 - artifacts/world-closeout/restore-report.json "$STARTED_AT" "$DEST" "$RELEASE_COMMIT" "$1" <<'EOF'
import json, sys, datetime
out, started, dest, commit, err = sys.argv[1:6]
json.dump({'tool': 'tools/closeout_restore_check.sh', 'startedAt': started,
           'finishedAt': datetime.datetime.now().astimezone().isoformat(),
           'restoreDir': dest, 'releaseCommit': commit, 'pass': False, 'error': err},
          open(out, 'w'), ensure_ascii=False, indent=2)
EOF
echo "RESTORE_FAIL $1 (log: $LOG)"; exit 1; }

echo "==== [closeout_restore] full clone (no --shared) -> $DEST @ $RELEASE_COMMIT" | tee -a "$LOG"
git clone --no-hardlinks "$GITDIR" "$DEST" >>"$LOG" 2>&1 || fail "git clone failed"
git -C "$DEST" checkout "$RELEASE_COMMIT" >>"$LOG" 2>&1 || fail "checkout $RELEASE_COMMIT failed"
HEAD_IN_CLONE=$(git -C "$DEST" rev-parse HEAD)
[ "$HEAD_IN_CLONE" = "$RELEASE_COMMIT" ] || fail "HEAD $HEAD_IN_CLONE != $RELEASE_COMMIT"

# isolation: alternates file must not exist; no config path may reference the
# source workspace
[ ! -e "$DEST/.git/objects/info/alternates" ] || fail "clone uses alternates — not a portable restore"
if grep -rl "$(pwd)" "$DEST/.git/config" >>"$LOG" 2>&1; then fail "clone config references the source workspace path"; fi

# real asset bytes
git -C "$DEST" lfs install --local >>"$LOG" 2>&1 || true
git -C "$DEST" lfs pull >>"$LOG" 2>&1 || fail "git lfs pull"
SENTINEL=$(head -c 4 "$DEST/world/street-reviewed.glb" 2>/dev/null)
[ "$SENTINEL" = "glTF" ] || fail "sentinel GLB is not real bytes (got '$SENTINEL')"

# original-asset lock: the 225 baseline originals must hash identically here
node - "$DEST" <<'EOF' || fail "original-asset shas differ from the closeout baseline"
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
(async () => {
  const dest = process.argv[2];
  const baseline = JSON.parse(await readFile(resolve(process.cwd(), 'artifacts/world-closeout/baseline.json'), 'utf8'));
  const originals = baseline.files.filter((f) => f.class === 'originalGlb');
  let checked = 0; const bad = [];
  for (const f of originals) {
    try {
      const b = await readFile(resolve(dest, f.path));
      if (createHash('sha256').update(b).digest('hex') !== f.sha256) bad.push(f.path);
      checked++;
    } catch { bad.push(f.path + ': missing'); }
  }
  if (bad.length) { console.error('ASSET_DRIFT\n' + bad.slice(0, 10).join('\n')); process.exit(1); }
  console.log(`ok   ${checked} original GLBs byte-identical to the closeout baseline`);
})().catch((e) => { console.error(e.message); process.exit(1); });
EOF

# dependencies + build + tests + official browser gate
( cd "$DEST" && npm ci >>"$LOG" 2>&1 ) || fail "npm ci"
( cd "$DEST" && npm install --no-save --no-audit --no-fund playwright >>"$LOG" 2>&1 ) || fail "playwright install"
( cd "$DEST" && npm run build >>"$LOG" 2>&1 ) || fail "npm run build"
( cd "$DEST" && node --test tests/*.test.mjs >>"$LOG" 2>&1 ) || fail "test suite"
( cd "$DEST" && node tools/full_browser_gate.mjs >>"$LOG" 2>&1 ) || fail "browser gate"
GATE=$(tail -20 "$LOG" | grep -o 'BROWSER_GATE_PASS' || true)
[ "$GATE" = "BROWSER_GATE_PASS" ] || fail "browser gate did not report PASS"

python3 - artifacts/world-closeout/restore-report.json "$STARTED_AT" "$DEST" "$RELEASE_COMMIT" ok <<'EOF'
import json, sys, datetime
out, started, dest, commit, err = sys.argv[1:6]
json.dump({'tool': 'tools/closeout_restore_check.sh', 'startedAt': started,
           'finishedAt': datetime.datetime.now().astimezone().isoformat(),
           'restoreDir': dest, 'releaseCommit': commit, 'pass': True,
           'scope': 'same-host fresh-directory restore; no shared alternates; assets byte-locked to the closeout baseline; full build+tests+browser gate rerun in the clone',
           'caveat': 'same-machine new-directory restore only — NOT a claim about W2 state or offline/net-new environments',
           'preserved': 'restore directory is kept for owner review (not deleted)'},
          open(out, 'w'), ensure_ascii=False, indent=2)
EOF
echo "RESTORE_PASS commit=$RELEASE_COMMIT dir=$DEST"
