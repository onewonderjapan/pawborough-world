#!/usr/bin/env bash
# Preserve the existing cutoff; Python tracks only this batch's Blender and verifies the MP4.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 -X utf8 "$SCRIPT_DIR/adoption_video_watchdog.py" "$@"
