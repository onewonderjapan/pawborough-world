// meshopt compression of the runtime zone GLBs (owner decision G6 "compressed default", 2026-09-23 applied to area zones).
// zone-<id>.glb -> zone-<id>.cm.glb with gltfpack -cc -kn (EXT_meshopt_compression + KHR_mesh_quantization, node names kept,
// textures untouched). Positions 16-bit and UVs 14-bit: site modules are in world coordinates and use metric (tiling) UVs,
// so the default 14/12 bits would cost ~1 cm / ~3 % of a tile. Validator must report 0 errors; manifest gets cm entries.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateBytes } from 'gltf-validator';
const OUT = path.resolve(process.env.OUT_DIR || 'out');
const GLTFPACK = process.env.GLTFPACK ?? '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack';
const ARGS = ['-cc', '-kn', '-ke', '-vp', '16', '-vt', '14'];   // -ke keeps node extras (viewer reads id/zone/kind)
const mp = path.join(OUT, 'zones-manifest.json');
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
let tool = 'gltfpack';
try { tool = execFileSync(GLTFPACK, ['-v'], { encoding: 'utf8' }).split('\n')[0].trim(); } catch (e) { tool = String(e.stdout || e.stderr || '').split('\n')[0].trim() || tool; }
let bad = 0;
for (const z of m.zones.filter(z => z.file)) {
  const src = path.join(OUT, z.file), dst = src.replace(/\.glb$/, '.cm.glb');
  execFileSync(GLTFPACK, [...ARGS, '-i', src, '-o', dst], { stdio: 'pipe' });
  const b = fs.readFileSync(dst);
  const res = await validateBytes(new Uint8Array(b));
  z.cm = { file: path.basename(dst), bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex'),
           ratio: +(b.length / z.bytes).toFixed(3), validatorErrors: res.issues.numErrors, validatorWarnings: res.issues.numWarnings,
           withinCap: b.length <= m.capPerZoneBytes };
  if (res.issues.numErrors) { bad++; console.error('validator errors', z.file, JSON.stringify(res.issues.messages.slice(0, 3))); }
  console.log(`${z.file} ${(z.bytes / 1e6).toFixed(2)}MB -> ${z.cm.file} ${(b.length / 1e6).toFixed(2)}MB (x${z.cm.ratio}) err=${res.issues.numErrors} warn=${res.issues.numWarnings}`);
}
m.compression = { tool, codec: 'gltfpack ' + ARGS.join(' ') + ' (EXT_meshopt_compression + KHR_mesh_quantization; textures untouched)',
                  runtimeDefault: 'cm', totalCmBytes: m.zones.reduce((s, z) => s + (z.cm?.bytes || 0), 0) };
fs.writeFileSync(mp, JSON.stringify(m, null, 1));
console.log(`COMPRESS DONE total ${(m.totalBytes / 1e6).toFixed(1)}MB -> ${(m.compression.totalCmBytes / 1e6).toFixed(1)}MB`);
process.exit(bad ? 2 : 0);
