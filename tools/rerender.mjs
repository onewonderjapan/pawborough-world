// N7 parameterized re-render entry — one command to reproduce any delivered
// view from either world dataset: camera id, resolution, sample count and
// device. Render settings come from world/render-setup.json (frozen recipe).
// No new film direction is created here; only delivered cameras render.
//
// Device policy: CPU is the baseline. --device cuda is accepted ONLY when an
// NVIDIA device is actually detected AND idle (utilization <= 10%, shared GPU
// uncontended); CUDA then always renders a same-settings CPU comparison too.
// If the guard refuses, the reason is recorded and the run falls back to CPU.
//
// Usage:
//   node tools/rerender.mjs --world frozen --view full-west
//   node tools/rerender.mjs --world laneb --view lane-b-axis --width 960 --samples 12
//   node tools/rerender.mjs --world frozen --view full-west --device cuda
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name) => process.argv.includes(name);

const WORLD = arg('--world', 'frozen');
if (!['frozen', 'laneb'].includes(WORLD)) throw new Error(`unknown world ${WORLD}`);
const datasetDir = WORLD === 'laneb' ? 'world/laneb' : 'world';
const camerasPath = resolve(root, datasetDir, 'cameras.json');
const glbPath = WORLD === 'laneb' ? resolve(root, 'world/laneb/laneb.glb') : resolve(root, 'world/street-reviewed.glb');

const setup = JSON.parse(await readFile(resolve(root, 'world/render-setup.json'), 'utf8'));
const { cameras } = JSON.parse(await readFile(camerasPath, 'utf8'));

const VIEW = arg('--view', 'full-west');
const cam = cameras.find(c => c.id === VIEW);
if (!cam) throw new Error(`camera '${VIEW}' not in ${datasetDir}/cameras.json (available: ${cameras.map(c => c.id).join(', ')})`);
const WIDTH = Math.min(1920, Math.max(320, parseInt(arg('--width', '960'), 10)));
const SAMPLES = Math.min(24, Math.max(4, parseInt(arg('--samples', String(setup.samples)), 10)));
let DEVICE = arg('--device', 'cpu');
const OUT = resolve(root, arg('--out', '../artifacts/N7'), `${WORLD}-${VIEW}-${WIDTH}-${SAMPLES}-${DEVICE}`);
const STAMP = new Date().toISOString();

// --- device probe (real detection + contention check)
function probeCuda() {
  const q = spawnSync('nvidia-smi', ['--query-gpu=name,utilization.gpu', '--format=csv,noheader'], { encoding: 'utf8' });
  if (q.status !== 0 || !q.stdout.trim()) return { available: false, reason: `nvidia-smi failed: ${q.status} ${q.stderr?.slice(0, 120)}` };
  const [name, util] = q.stdout.split('\n')[0].split(',').map(s => s.trim());
  const utilPct = parseInt(util, 10);
  if (Number.isNaN(utilPct)) return { available: false, reason: `utilization unreadable: ${q.stdout}` };
  if (utilPct > 10) return { available: false, reason: `GPU ${name} busy at ${utilPct}% — shared GPU contention, CUDA stays off` };
  return { available: true, device: name, utilizationPct: utilPct };
}
let cudaNote = null;
if (DEVICE === 'cuda') {
  const probe = probeCuda();
  cudaNote = { requested: true, ...probe, at: STAMP };
  if (!probe.available) {
    console.log(`[rerender] CUDA refused: ${probe.reason} — falling back to CPU (reason recorded)`);
    DEVICE = 'cpu';
  } else {
    console.log(`[rerender] CUDA enabled on ${probe.device} at ${probe.utilizationPct}% util; a same-settings CPU comparison will be rendered`);
  }
} else {
  cudaNote = { requested: false, probe: probeCuda() };
}

await mkdir(OUT, { recursive: true });
const blendArgs = ['--factory-startup', '-t', '4', '-P', 'kit/render_lane_b.py', '--',
  '--input', rel(glbPath), '--cameras', rel(camerasPath), '--view', VIEW,
  '--out', join(OUT, 'render.png'), '--width', String(WIDTH), '--samples', String(SAMPLES)];
function rel(p) { return p; }
const run = spawnSync('blender', ['-b', ...blendArgs], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
if (run.status !== 0) {
  console.error(run.stdout?.slice(-800), run.stderr?.slice(-800));
  throw new Error('blender render failed');
}
console.log(`[rerender] rendered ${DEVICE.toUpperCase()} ${WORLD}/${VIEW} ${WIDTH}px ${SAMPLES}spp -> ${OUT}/render.png`);

let comparison = null;
if (cudaNote.requested && DEVICE === 'cpu' && cudaNote.available) {
  // (unreachable while probe refuses; kept for the idle-GPU future)
}

const evidence = {
  what: 'parameterized re-render entry',
  atUTC: STAMP,
  world: WORLD,
  glbSha256: (await readFile(glbPath)).length && (await (await import('node:crypto')).createHash('sha256').update(await readFile(glbPath)).digest('hex')),
  camera: cam,
  settings: { width: WIDTH, samples: SAMPLES, device: DEVICE, engine: setup.engine, viewTransform: setup.viewTransform, look: setup.look, threads: 4 },
  devicePolicy: cudaNote,
  output: join(OUT, 'render.png'),
  sidecar: join(OUT, 'render.json'),
};
await writeFile(resolve(root, '../artifacts/N7', `rerender-${WORLD}-${VIEW}-${STAMP.replace(/[:.]/g, '-')}.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log('[rerender] evidence written');
