#!/usr/bin/env bash
# K1 watchdog (adoption batch) — manages ONLY this batch's render process.
# - startup-failure detection: if no frame appears within 10 min of start,
#   report STARTUP_FAILED and exit non-zero (do NOT wait out the cap).
# - self-completion detection: frame count static for 5 min after >100 frames.
# - hard cap at the 11h wall clock, then assemble clipA-full from the frames.
set -u
WS=/home/baibai/outbox/pawborough-adoption-east-night-20260919/workspace
FRAMES="$WS/artifacts/adoption-east/frames"
cd "$WS"
CAP_EPOCH=$(date -d '2026-09-20 08:15' +%s)
START=$(date +%s)
LAST=-1; SAME=0; STARTUP_GRACE=600

while [ "$(date +%s)" -lt "$CAP_EPOCH" ]; do
  N=$(ls "$FRAMES"/frame-*.png 2>/dev/null | wc -l)
  NOW=$(date +%s)
  if [ "$N" -eq 0 ] && [ "$N" = "$LAST" ] && [ $((NOW - START)) -gt "$STARTUP_GRACE" ]; then
    echo "STARTUP_FAILED: no frames after 10min at $(date -Iseconds)"
    exit 2
  fi
  if [ "$N" -gt 100 ] && [ "$N" = "$LAST" ]; then
    SAME=$((SAME+1))
    if [ "$SAME" -ge 5 ]; then echo "render self-completed (~$N frames) at $(date -Iseconds)"; break; fi
  else
    SAME=0
  fi
  LAST=$N
  sleep 60
done
# kill ONLY this batch's render (its command line carries the batch frames path)
pkill -f "adoption-east/frames" 2>/dev/null || true
sleep 5
N=$(ls "$FRAMES"/frame-*.png 2>/dev/null | wc -l)
if [ "$N" -lt 25 ]; then echo "ASSEMBLE_SKIPPED frames=$N"; exit 3; fi
ffmpeg -y -framerate 24 -i "$FRAMES/frame-%05d.png" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p "$WS/artifacts/adoption-east/clipA-full.mp4" 2>>/tmp/clipa_ffmpeg.log
echo "WATCHDOG_DONE at $(date -Iseconds) frames=$N"
