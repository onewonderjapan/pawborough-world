#!/usr/bin/env bash
# F5 render watchdog: at the 9h render wall-clock cap, stop the walkthrough
# render and assemble both clips (clipA partial if frames < planned).
set -u
cd /home/baibai/outbox/pawborough-corridor-video-night-20260919/workspace
CAP_EPOCH=$(date -d '2026-09-19 13:05' +%s)
while [ "$(date +%s)" -lt "$CAP_EPOCH" ]; do
  # if the render finished on its own, assemble early
  if grep -q WALKTHROUGH_DONE /tmp/clipa_render.log 2>/dev/null; then
    echo "render self-completed at $(date -Iseconds)"
    break
  fi
  sleep 60
done
pkill -f 'render_walkthrough.py' 2>/dev/null || true
sleep 5
python3 tools/make_clip.py --clip a
python3 tools/make_clip.py --clip b
echo "WATCHDOG_DONE at $(date -Iseconds)"
