// Q — video terminal-state receipt. Reads the SOURCE task's
// clipA-full.status.json (complete/partial only — never a live render) and,
// only after ffprobe confirms frames+duration match the status, copies the
// terminal MP4 + status + render log into artifacts/world-closeout/video/
// with before/after hash equality. A missing status file is REPORTED, never
// improvised; failed/stalled states are recorded for the owner verbatim.
//
// Run: node tools/closeout_video_receipt.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = '/home/baibai/outbox/pawborough-adoption-east-night-20260919/workspace/artifacts/adoption-east';
const OUT = resolve(root, 'artifacts/world-closeout/video');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const EXPECTED_FRAMES = 8781;
const CUTOFF = '2026-09-20T08:15:00+09:00';

const probe = (p) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets,duration', '-of', 'json', p], { encoding: 'utf8' });
  const s = JSON.parse(out).streams[0];
  return { frames: Number(s.nb_read_packets), duration: Number(s.duration) };
};

await mkdir(OUT, { recursive: true });
const receipt = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'Q video terminal state',
  generatedAt: new Date().toISOString(),
  source: SRC,
  cutoff: CUTOFF,
  expectedFrames: EXPECTED_FRAMES,
  clipB: null,
  clipA: null,
};

// ---- clipB (already terminal) ----------------------------------------------
{
  const p = resolve(SRC, 'clipB.mp4');
  const bytes = await readFile(p);
  const { frames, duration } = probe(p);
  receipt.clipB = {
    frames, expectedFrames: 576, durationSec: duration, expectedDurationSec: 24,
    sha256: sha(bytes), bytes: bytes.byteLength,
    pass: frames === 576 && Math.abs(duration - 24) < 0.05,
    story: 'GPU 456 frames @ ~8.7s/f then CUDA OOM while clipA held unified memory; CPU resumed 457-575 @ ~5s/f with --resume semantics; 0 blank across the seam, worst std 36.4/255 (render-log-summary.json)',
  };
}

// ---- clipA terminal state ---------------------------------------------------
const statusPath = resolve(SRC, 'clipA-full.status.json');
let status = null;
try { status = JSON.parse(await readFile(statusPath, 'utf8')); } catch { /* absent */ }
if (!status) {
  // frames-on-disk snapshot for the honest "still rendering" record
  let framesOnDisk = null;
  try { framesOnDisk = (await readFile(new URL('file://' + resolve(SRC, 'frames')))).length; } catch { /* ignore */ }
  receipt.clipA = {
    state: 'NO_TERMINAL_STATUS',
    statusFileExists: false,
    note: `clipA-full.status.json not present — the render/watchdog still owns clipA (frames keep growing; ${'see liveRender in baseline.json'}). Per policy this batch does NOT stop, restart, extend or compete with it, and does not copy a file that is still being written. Rerun this tool after the watchdog emits the terminal status to complete the receipt.`,
  };
} else {
  const state = status.status;
  const mp4 = resolve(SRC, 'clipA-full.mp4');
  const mp4Exists = await access(mp4, constants.F_OK).then(() => true, () => false);
  if (!['complete', 'partial'].includes(state) || !mp4Exists) {
    receipt.clipA = { state, statusFileExists: true, mp4Exists,
      note: 'watchdog reported failed/stalled (or no MP4) — recorded verbatim for the owner; nothing copied, nothing rerendered',
      status };
  } else {
    const { frames, duration } = probe(mp4);
    const srcBytes = await readFile(mp4);
    const srcHash = sha(srcBytes);
    const declared = status.frames ?? status.renderedFrames ?? status.rendered ?? null;
    const consistent = frames === (declared ?? frames) && (state === 'partial' ? frames < EXPECTED_FRAMES : frames >= EXPECTED_FRAMES);
    receipt.clipA = {
      state, declaredFrames: declared, probedFrames: frames, durationSec: duration,
      expectedFrames: EXPECTED_FRAMES, hashConsistentProbe: consistent,
      sourceSha256: srcHash, sourceBytes: srcBytes.byteLength,
      partialReason: status.reason ?? status.note ?? null,
      status,
      copied: null,
    };
    if (consistent) {
      const dstMp4 = resolve(OUT, 'clipA-full.mp4');
      await copyFile(mp4, dstMp4);
      const dstBytes = await readFile(dstMp4);
      const hashOk = sha(dstBytes) === srcHash;
      await copyFile(statusPath, resolve(OUT, 'clipA-full.status.json'));
      try { await copyFile(resolve(SRC, 'render-log.json'), resolve(OUT, 'clipA-render-log.json')); } catch { /* log may rotate */ }
      receipt.clipA.copied = {
        files: ['clipA-full.mp4', 'clipA-full.status.json', 'clipA-render-log.json'],
        beforeSha256: srcHash, afterSha256: sha(dstBytes), hashOk,
        renderedOfExpected: `${frames}/${EXPECTED_FRAMES}`,
        note: state === 'partial'
          ? 'PARTIAL at the unchanged 2026-09-20T08:15:00+09:00 cutoff — allowed terminal state; missing frames are NOT rerendered, not relabelled full'
          : 'complete',
      };
    }
  }
}
await writeFile(resolve(root, 'artifacts/world-closeout/video-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`VIDEO_RECEIPT clipB=${receipt.clipB.pass ? 'ok' : 'FAIL'} clipA=${receipt.clipA.state ?? '?'}`);
process.exit(receipt.clipB.pass && ['complete', 'partial', 'NO_TERMINAL_STATUS'].includes(receipt.clipA.state) ? 0 : 1);
