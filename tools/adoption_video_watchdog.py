"""Monitor only this batch's renderer and publish only verified encodes."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]

def receipt(path, data):
    data['updatedAt'] = dt.datetime.now().astimezone().isoformat()
    tmp = path.with_suffix('.writing.json')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)

def complete_frames(frames):
    """Encode only a contiguous prefix of complete PNG files."""
    n = 0
    while True:
        try:
            with (frames / f'frame-{n:05d}.png').open('rb') as f:
                if f.read(8) != b'\x89PNG\r\n\x1a\n': break
                f.seek(-12, 2)
                if f.read() != b'\x00\x00\x00\x00IEND\xaeB`\x82': break
        except (OSError, ValueError):
            break
        n += 1
    return n

def render_pids(frames):
    result = []
    for p in Path('/proc').iterdir():
        if not p.name.isdigit(): continue
        try:
            args = p.joinpath('cmdline').read_bytes().decode().strip('\0').split('\0')
            if Path(args[0]).name != 'blender': continue
            i = args.index('--frames')
            if Path(args[i+1]).resolve() == frames.resolve(): result.append(int(p.name))
        except (OSError, ValueError, IndexError, UnicodeError):
            continue
    return result

def assemble(frames, output, expected, reason, ffmpeg='ffmpeg', ffprobe='ffprobe'):
    report = output.with_suffix('.status.json')
    n = complete_frames(frames)
    data = dict(status='assembling', renderedFrames=n, expectedFrames=expected, reason=reason)
    receipt(report, data)
    try:
        if n == 0: raise RuntimeError('no complete contiguous frames')
        if expected <= 0 or n > expected: raise RuntimeError('invalid expected/frame count')
        tmp = output.with_name(output.stem + '.encoding.mp4')
        with output.with_suffix('.encode.log').open('ab') as log:
            subprocess.run([ffmpeg, '-nostdin', '-y', '-threads', '2', '-framerate', '24',
                '-start_number', '0', '-i', str(frames/'frame-%05d.png'), '-frames:v', str(n),
                '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', str(tmp)],
                stdout=log, stderr=log, check=True)
        info = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-count_frames',
            '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,duration',
            '-of', 'json', str(tmp)], text=True, encoding='utf-8'))['streams'][0]
        actual = int(info['nb_read_frames'])
        if actual != n: raise RuntimeError(f'encoded frame count {actual} != {n}')
        if abs(float(info['duration']) - n/24) > .05: raise RuntimeError('duration mismatch')
        os.replace(tmp, output)
        data.update(status='complete' if n == expected else 'partial', encodedFrames=actual,
                    durationSeconds=float(info['duration']), output=str(output))
        receipt(report, data)
        return data
    except Exception as exc:
        data.update(status='failed', error=str(exc))
        receipt(report, data)
        raise

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--frames', type=Path, default=ROOT/'artifacts/adoption-east/frames')
    p.add_argument('--output', type=Path, default=ROOT/'artifacts/adoption-east/clipA-full.mp4')
    p.add_argument('--expected-frames', type=int)
    p.add_argument('--cutoff', default='2026-09-20T08:15:00+09:00')
    p.add_argument('--assemble-only', action='store_true')
    args = p.parse_args()
    expected = args.expected_frames
    if expected is None:
        expected = json.loads((args.frames.parent/'render-log.json').read_text(encoding='utf-8'))['framesPlanned']
    reason = 'manual_assembly'
    if not args.assemble_only:
        cutoff = dt.datetime.fromisoformat(args.cutoff).timestamp()
        last = complete_frames(args.frames)
        changed = start = time.time()
        while True:
            now, n = time.time(), complete_frames(args.frames)
            if n != last: last, changed = n, now
            pids = render_pids(args.frames)
            if n >= expected: reason = 'all_frames'; break
            if now >= cutoff:
                reason = 'wall_clock_cap'
                for pid in pids:
                    if pid in render_pids(args.frames): os.kill(pid, signal.SIGTERM)
                for _ in range(60):
                    if not render_pids(args.frames): break
                    time.sleep(1)
                if render_pids(args.frames): raise RuntimeError('renderer did not stop; refusing concurrent assembly')
                break
            if n == 0 and now-start >= 600:
                receipt(args.output.with_suffix('.status.json'), dict(status='failed', reason='STARTUP_FAILED', renderedFrames=0))
                raise RuntimeError('STARTUP_FAILED')
            if n > 0 and not pids and now-changed >= 60:
                reason = 'renderer_exited_early'; break
            if pids and now-changed >= 600:
                receipt(args.output.with_suffix('.status.json'), dict(status='stalled', renderedFrames=n, expectedFrames=expected))
            time.sleep(30)
    print(json.dumps(assemble(args.frames, args.output, expected, reason), ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
